// POST /api/brownfield/[oppId]/eval-draft-runs — start an S6 bulk AI evaluation run (ADR-0199 A1, spec
// 2026-11-16-s6-bulk-ai-eval-versioning §4). Drafting is a PROPOSAL (not human-only): every version it produces is an
// immutable draft, and only the human-only confirm route turns one into a recorded verdict. Analyst+.
// Body { categories?: "both"|"financial"|"technical", target_ids?: string[], web_evidence?: boolean,
// force_refresh?: boolean } — web_evidence and force_refresh default to false and are stored on the run so a resume
// keeps them. An active run for the opportunity is REUSED (`meta.reused: true`). Returns 202 { run_id }; the engine
// works in the background. Audit target_eval.bulk_run.start.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import {
  createRun,
  getActiveRun,
  EvalDraftError,
  RUN_CATEGORY_SELECTIONS,
  type RunCategorySelection,
} from "../../../../../../../db/repositories/brownfield-eval-draft.repository.ts";
import { authenticate, callPathOf, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, fail, notFound, ok } from "../../../../../lib/envelope.ts";
import { listTargets } from "../../../../../lib/brownfield-targets.ts";
import {
  activeEngineRunForOpportunity,
  launchBulkEval,
  noteRunStart,
  startCooldownRemaining,
} from "../../../../../lib/brownfield-eval-bulk.ts";
import { promotedCarrierResponse, trackConflictResponse } from "../../../../../lib/route-track-guard.ts";

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "write", {
    viewerMessage: "Starting an AI evaluation run requires the analyst role or higher.",
  });
  if (denied) return denied;
  const { oppId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  const conflict = trackConflictResponse(
    db,
    oppId,
    "brownfield",
    "S6 일괄 AI 평가는 Brownfield Route에서만 할 수 있습니다 — 이 기회의 현재 Route 결정은 Greenfield입니다.",
  );
  if (conflict) return conflict;
  // A promoted opportunity is governed by project membership / MNPI-insider checks this surface does not apply.
  const promoted = promotedCarrierResponse(
    db,
    oppId,
    "이 기회는 이미 프로젝트로 승격되었습니다 — 일괄 AI 평가는 승격 전에만 시작할 수 있습니다.",
  );
  if (promoted) return promoted;

  const body = ((await request.json().catch(() => null)) ?? {}) as {
    categories?: unknown;
    target_ids?: unknown;
    web_evidence?: unknown;
    force_refresh?: unknown;
  };
  const categories = (body.categories ?? "both") as RunCategorySelection;
  if (!(RUN_CATEGORY_SELECTIONS as readonly string[]).includes(categories))
    return badRequest("invalid_request", `categories must be one of: ${RUN_CATEGORY_SELECTIONS.join(" | ")}.`);
  for (const flag of ["web_evidence", "force_refresh"] as const) {
    if (body[flag] !== undefined && typeof body[flag] !== "boolean")
      return badRequest("invalid_request", `${flag} must be a boolean.`);
  }
  const candidates = listTargets(oppId).filter((t) => t.status !== "excluded");
  let ids = candidates.map((t) => t.id);
  if (body.target_ids !== undefined) {
    if (!Array.isArray(body.target_ids) || body.target_ids.some((x) => typeof x !== "string"))
      return badRequest("invalid_request", "target_ids must be an array of strings.");
    const wanted = new Set(body.target_ids as string[]);
    ids = ids.filter((id) => wanted.has(id)); // longlist order, non-excluded members of this opportunity only
    if (ids.length !== wanted.size)
      return badRequest("invalid_request", "target_ids must be non-excluded candidates of this opportunity.");
  }
  if (ids.length === 0) return badRequest("no_candidates", "There are no candidates to evaluate.");

  // An engine still finishing (e.g. a cancelled run's current item) blocks a new start; an active DB run is reused below.
  const activeRun = getActiveRun(db, oppId);
  const engineRun = activeEngineRunForOpportunity(oppId);
  if (!activeRun && engineRun) {
    return fail(409, "engine_active", "A previous run is still finishing its current step.", { run_id: engineRun });
  }
  if (!activeRun) {
    const wait = startCooldownRemaining(ctx.userId);
    if (wait > 0) return fail(429, "start_cooldown", `Wait ${Math.ceil(wait / 1000)}s before starting another run.`);
  }
  const now = new Date().toISOString();
  const via = callPathOf(ctx);
  let created: ReturnType<typeof createRun>;
  try {
    created = createRun(db, {
      opportunityId: oppId,
      categories,
      targetIds: ids,
      webEvidence: body.web_evidence === true,
      forceRefresh: body.force_refresh === true,
      startedBy: ctx.userId,
      startedVia: via,
      now,
    });
  } catch (e) {
    if (e instanceof EvalDraftError)
      return e.kind === "not_found"
        ? notFound()
        : e.kind === "conflict"
          ? fail(409, "conflict", e.message)
          : badRequest("invalid_request", e.message);
    throw e;
  }
  if (!created.reused) {
    noteRunStart(ctx.userId);
    appendAudit(db, {
      actor: ctx.userId,
      action: "target_eval.bulk_run.start",
      target: `${oppId}:run:${created.run.id}:targets=${ids.length}:categories=${categories}`,
      now,
    });
    launchBulkEval(db, created.run.id);
  }
  return ok({ run_id: created.run.id, status: created.run.status }, 202, { reused: created.reused });
}
