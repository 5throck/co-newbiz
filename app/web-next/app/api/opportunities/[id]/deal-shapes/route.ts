// S7 deal-shape evaluation at opportunity scope (ADR-0194 item A, migration 0188; moved from S4 to S7 by the owner decision
// of 2026-11-08). One row = one human verdict on one deal shape; the live viable count is the data source of kill criterion
// #9 (deal-shape-chain:no_viable_deal_shape, brownfield-only, opportunity target_screening). POST is refused with 409
// deal_shape_not_open before S7 or when the current route decision is not brownfield (lib/deal-shape-guard.ts). Append-only: re-posting a shape supersedes its live row (history is kept, nothing deleted).
// evaluated_by is ALWAYS the session user (the body cannot name one). Record-only: no scoring, recommendation or
// draft path writes here (risk-officer A-1) - an agent may record only a verdict the calling user explicitly gave.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import {
  DEAL_SHAPES,
  DEAL_SHAPE_INTENTS,
  DealShapeError,
  listDealShapeEvaluations,
  recordDealShapeEvaluation,
} from "../../../../../../../db/repositories/opportunity-deal-shape.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { dealShapeWriteGuard, DEAL_SHAPE_NOT_OPEN } from "../../../../../lib/deal-shape-guard.ts";
import { badRequest, fail, notFound, ok } from "../../../../../lib/envelope.ts";
import { route } from "../../../../../lib/route.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  {
    const denied = requireBusinessActor(auth.auth, "read");
    if (denied) return denied;
  }
  const { id } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();
  const { live, history } = listDealShapeEvaluations(db, id);
  const evaluated = new Set(live.map((r) => r.shape));
  return ok(
    {
      opportunity_id: id,
      live,
      history,
      // Shapes with no live verdict: not yet evaluated (neither viable nor non-viable).
      unevaluated_shapes: DEAL_SHAPES.filter((s) => !evaluated.has(s)),
      // What kill criterion #9 reads: null when nothing is recorded (the criterion is then unassessed, never "zero viable").
      viable_count: live.length === 0 ? null : live.filter((r) => r.viable).length,
      vocabulary: { shapes: DEAL_SHAPES, intents: DEAL_SHAPE_INTENTS },
    },
    200,
    { count: live.length },
  );
});

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  {
    const denied = requireBusinessActor(ctx, "write", {
      viewerMessage: "Recording a deal-shape evaluation requires the analyst role or higher.",
    });
    if (denied) return denied;
  }
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body))
    return badRequest("invalid_request", "A JSON body {shape, intent, viable, rationale, evidence_ref?} is required.");
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();
  const refusal = dealShapeWriteGuard(id);
  if (refusal) return fail(409, DEAL_SHAPE_NOT_OPEN, refusal.message, { reason: refusal.reason });
  const now = new Date().toISOString();
  try {
    // Any evaluated_by / evaluator field in the body is ignored: the verdict belongs to the calling session user.
    const row = recordDealShapeEvaluation(db, {
      opportunityId: id,
      shape: body.shape,
      intent: body.intent,
      viable: body.viable,
      rationale: body.rationale,
      evidenceRef: body.evidence_ref,
      evaluatedBy: ctx.userId,
      now,
    });
    appendAudit(db, {
      actor: ctx.userId,
      action: "opportunity.deal_shape.record",
      target: `${id}:${row.shape}:${row.id}`,
      now,
    });
    return ok(row, 201);
  } catch (e) {
    if (e instanceof DealShapeError)
      return e.kind === "opportunity_not_found" ? notFound() : badRequest("invalid_request", e.message);
    throw e;
  }
});
