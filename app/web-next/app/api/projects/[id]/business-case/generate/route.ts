// POST /api/projects/[id]/business-case/generate — trigger the automatic
// 3-case generation (ADR-0098 §3). Async-STYLE contract ({ runId }), but
// bun's SQLite layer is synchronous, so generation completes within the
// request; the process_run/activity_run/agent_run rows are written
// progressively by runActivityChain, so the GET status route always shows
// real per-activity state. Analyst+. Generation writes PROPOSALS only —
// never an adoption marker, never a gate_decision (boundary #2).
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { generateBusinessCases } from "../../../../../../lib/business-case-generator.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";

// Idempotency contract: if a non-failed generation run for this project's S8
// stage already exists, the EXISTING run is returned with 200 and
// alreadyRun: true instead of duplicating a 12-activity chain. A FAILED run
// does not block a retry. `{ regenerate: true }` bypasses the guard and
// starts a NEW run — used by the "대상별 재생성" action (e.g. after ADR-0143
// to produce per-target models); still analyst+ and proposals-only (boundary #2).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Business-case auto-generation requires the analyst role or higher.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();

  let regenerate = false;
  try {
    const body = (await request.json()) as { regenerate?: unknown };
    regenerate = body?.regenerate === true;
  } catch {
    // empty body — ordinary generate path
  }

  if (!regenerate) {
    const existing = getDb()
      .query(
        `SELECT id FROM process_run
         WHERE entity_type = 'project' AND entity_id = ? AND stage = 's8_business_case_generation' AND status != 'failed'
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get(id) as { id: string } | undefined;
    if (existing) {
      return ok({ runId: existing.id, alreadyRun: true }, 200);
    }
  }

  try {
    const result = await generateBusinessCases(id, { actor: ctx.userId, source: "web" });
    if (result.status === "failed") {
      return badRequest("generation_failed", `Some activities failed — check the status of run ${result.processRunId}.`);
    }
    return ok({ runId: result.processRunId, recommendedScenario: result.recommendedScenario }, 201);
  } catch (err) {
    return badRequest("generation_failed", err instanceof Error ? err.message : String(err));
  }
}
