// POST /api/projects/[id]/dd-checklist/tailor — trigger the S9 industry-
// tailored DD checklist benchmarking chain (ADR-0099 §3). Async-STYLE
// contract ({ runId }), but bun's SQLite layer is synchronous, so the chain
// completes within the request; the process_run/activity_run/agent_run rows
// are written progressively by runActivityChain. Analyst+. Tailoring writes
// PROPOSALS only (status 'proposed', no state rows) — never an approval,
// never a gate_decision (boundary #2).
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { tailorDdChecklist, DD_TAILOR_STAGE, DD_TAILOR_DOMAINS, type DdTailorDomain } from "../../../../../../lib/dd-checklist-tailor.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { scopeOrResponse } from "../../../../../../lib/dd-target-http.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";

// Idempotency contract: if a non-failed tailoring run for this project's S9
// stage already exists, the EXISTING run is returned with 200 and
// alreadyRun: true instead of duplicating proposals. A FAILED run does not
// block a retry.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "체크리스트 맞춤 생성은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();

  const body = (await request.json().catch(() => null)) as { domains?: string[]; target_id?: string; regenerate?: boolean } | null;
  // 2026-10-19 decider: regenerate replaces UNAPPROVED drafts (status 'proposed' only —
  // approved/rejected items are recorded review outcomes and stay) so a prompt or context
  // improvement can re-draft them. Audited; the deletion never touches approvals or state rows.
  const regenerate = body?.regenerate === true;
  if (regenerate) {
    const scopePre = scopeOrResponse(id, body?.target_id);
    if ("response" in scopePre) return scopePre.response;
    const del = getDb().run(
      scopePre.targetId === null
        ? "DELETE FROM project_checklist_item_custom WHERE project_id = ? AND status = 'proposed' AND target_id IS NULL"
        : "DELETE FROM project_checklist_item_custom WHERE project_id = ? AND status = 'proposed' AND target_id = ?",
      scopePre.targetId === null ? [id] : [id, scopePre.targetId],
    );
    appendAudit(getDb(), {
      actor: ctx.userId,
      action: "dd_tailor.regenerated",
      target: `${id}:${scopePre.targetId ?? "project"}`,
      now: new Date().toISOString(),
    });
  }
  // ADR-0157: tailoring for an opened comparison target writes proposals scoped to it.
  const scope = scopeOrResponse(id, body?.target_id);
  if ("response" in scope) return scope.response;
  let domains: DdTailorDomain[] = [...DD_TAILOR_DOMAINS];
  if (body?.domains?.length) {
    if (!body.domains.every((d) => (DD_TAILOR_DOMAINS as readonly string[]).includes(d))) {
      return badRequest("invalid_request", `domains는 ${DD_TAILOR_DOMAINS.join(" | ")} 중 선택입니다.`);
    }
    domains = [...new Set(body.domains)] as DdTailorDomain[];
  }

  const existing = regenerate ? undefined : getDb()
    .query(
      `SELECT id FROM process_run
       WHERE entity_type = 'project' AND entity_id = ? AND stage = ? AND status != 'failed'
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(id, DD_TAILOR_STAGE) as { id: string } | undefined;
  // After an S8 re-selection (ADR-0157) the old run's proposals were stamped to the former
  // target; the newly selected scope has none, so it may be tailored afresh.
  const reselected = !!getDb().query("SELECT 1 FROM dd_target_open WHERE project_id = ? AND source = 'reselection' LIMIT 1").get(id);
  const scopeHasProposals = !!getDb().query("SELECT 1 FROM project_checklist_item_custom WHERE project_id = ? AND target_id IS NULL LIMIT 1").get(id);
  if (scope.targetId === null && existing && !(reselected && !scopeHasProposals)) {
    return ok({ runId: existing.id, alreadyRun: true, domains }, 200);
  }
  if (scope.targetId !== null) {
    const proposed = getDb()
      .query("SELECT 1 FROM project_checklist_item_custom WHERE project_id = ? AND target_id = ? LIMIT 1")
      .get(id, scope.targetId);
    if (proposed) return ok({ runId: null, alreadyRun: true, domains, target_id: scope.targetId }, 200);
  }

  try {
    const result = await tailorDdChecklist(id, { actor: ctx.userId, domains, source: "web", targetId: scope.targetId });
    if (result.status === "failed") {
      return badRequest("tailor_failed", `일부 활동이 실패했습니다 — run ${result.processRunId} 상태를 확인하세요.`);
    }
    return ok({ runId: result.processRunId, proposedCount: result.proposedCount, domains }, 201);
  } catch (err) {
    return badRequest("tailor_failed", err instanceof Error ? err.message : String(err));
  }
}
