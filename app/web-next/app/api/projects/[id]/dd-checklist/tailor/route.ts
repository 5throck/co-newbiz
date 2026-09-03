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
import { tailorDdChecklist, DD_TAILOR_STAGE, DD_DOMAINS, type DdDomain } from "../../../../../../lib/dd-checklist-tailor.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";

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

  const body = (await request.json().catch(() => null)) as { domains?: string[] } | null;
  let domains: DdDomain[] = [...DD_DOMAINS];
  if (body?.domains?.length) {
    if (!body.domains.every((d) => (DD_DOMAINS as readonly string[]).includes(d))) {
      return badRequest("invalid_request", `domains는 ${DD_DOMAINS.join(" | ")} 중 선택입니다.`);
    }
    domains = [...new Set(body.domains)] as DdDomain[];
  }

  const existing = getDb()
    .query(
      `SELECT id FROM process_run
       WHERE entity_type = 'project' AND entity_id = ? AND stage = ? AND status != 'failed'
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(id, DD_TAILOR_STAGE) as { id: string } | undefined;
  if (existing) {
    return ok({ runId: existing.id, alreadyRun: true, domains }, 200);
  }

  try {
    const result = await tailorDdChecklist(id, { actor: ctx.userId, domains, source: "web" });
    if (result.status === "failed") {
      return badRequest("tailor_failed", `일부 활동이 실패했습니다 — run ${result.processRunId} 상태를 확인하세요.`);
    }
    return ok({ runId: result.processRunId, proposedCount: result.proposedCount, domains }, 201);
  } catch (err) {
    return badRequest("tailor_failed", err instanceof Error ? err.message : String(err));
  }
}
