// S7 deal-shape evaluation at opportunity scope (ADR-0194 item A, migration 0188; moved from S4 to S7 by the owner decision
// of 2026-11-08; reshaped to overall-viability-first by ADR-0201 / migration 0198). The live set is either ONE overall
// "no shape is viable" row or one or more viable shape rows; every POST replaces the whole set (append-only superseded_by chain,
// nothing deleted) and must carry the live_token of the set the person read (409 deal_shape_stale otherwise). The viable count
// is the data source of kill criterion #9 (deal-shape-chain:no_viable_deal_shape, brownfield-only, opportunity target_screening).
// POST is refused with 409 deal_shape_not_open before S7 or when the current route decision is not brownfield
// (lib/deal-shape-guard.ts). evaluated_by is ALWAYS the session user (the body cannot name one). Record-only: no scoring,
// recommendation or draft path writes here (risk-officer A-1) - an agent may record only a verdict the calling user explicitly gave.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import {
  DEAL_SHAPES,
  DEAL_SHAPE_INTENTS,
  DealShapeError,
  type DealShapeWriteResult,
  listDealShapeEvaluations,
  recordOverallNotViable,
  recordViableShapes,
} from "../../../../../../../db/repositories/opportunity-deal-shape.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { dealShapeWriteGuard, DEAL_SHAPE_NOT_OPEN } from "../../../../../lib/deal-shape-guard.ts";
import { fail, notFound, ok } from "../../../../../lib/envelope.ts";
import { route } from "../../../../../lib/route.ts";

const MAX_BODY_BYTES = 64 * 1024;
const tooLarge = () => fail(413, "payload_too_large", `The request body must be at most ${MAX_BODY_BYTES} bytes.`);
const bad = (message: string, details?: Record<string, unknown>) => fail(400, "invalid_request", message, details);

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
  const { live, overall, history, verdict, live_token } = listDealShapeEvaluations(db, id);
  const selected = new Set(live.map((r) => r.shape));
  const unselected = DEAL_SHAPES.filter((s) => !selected.has(s));
  return ok(
    {
      opportunity_id: id,
      verdict,
      overall,
      live,
      history,
      live_token,
      // Shapes with no live shape row (not selected). unevaluated_shapes is an alias kept for one release (ADR-0201).
      unselected_shapes: unselected,
      unevaluated_shapes: unselected,
      // What kill criterion #9 reads: null when nothing is recorded (unassessed, never "zero viable"); an overall row reads 0.
      viable_count: live.length === 0 && !overall ? null : live.filter((r) => r.viable).length,
      vocabulary: { shapes: DEAL_SHAPES, intents: DEAL_SHAPE_INTENTS },
    },
    200,
    { count: live.length + (overall ? 1 : 0) },
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
  // A verdict is at most 8 shapes x (2000 + 2000) chars; refuse anything bigger before parsing (Content-Length first, then the real text).
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge();
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_BYTES) return tooLarge();
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(text) as Record<string, unknown> | null;
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return bad(
      "A JSON body {viable: false, rationale, evidence_ref?, live_token} or {viable: true, intent, shapes: [{shape, rationale, evidence_ref?}], live_token} is required.",
    );
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();
  if (typeof body.viable !== "boolean")
    return bad("viable must be a boolean (true = a shape is viable, false = no shape is viable).", {
      field: "viable",
    });
  if ("shape" in body && body.shape !== undefined)
    return bad("The single-shape body is no longer accepted; use the overall-first contract (viable, then shapes[]).", {
      field: "shape",
    });
  if (body.viable === false) {
    for (const f of ["shapes", "intent"])
      if (body[f] !== undefined)
        return bad("No shape or intent when not viable: record one overall rationale only.", { field: f });
  }
  const refusal = dealShapeWriteGuard(id);
  if (refusal) return fail(409, DEAL_SHAPE_NOT_OPEN, refusal.message, { reason: refusal.reason });
  const now = new Date().toISOString();
  try {
    // Any evaluated_by / evaluator field in the body is ignored: the verdict belongs to the calling session user.
    // The audit entry is written inside the repository transaction: if it throws, the write rolls back (no unaudited verdict).
    const onWrite = (r: DealShapeWriteResult) =>
      appendAudit(db, {
        actor: ctx.userId,
        action: body.viable ? "opportunity.deal_shape.record_viable_set" : "opportunity.deal_shape.record_not_viable",
        target: `${id}:${r.rows.map((x) => x.id).join(",")}:superseded=${r.superseded.join(",")}`,
        now,
      });
    const base = { opportunityId: id, liveToken: body.live_token, evaluatedBy: ctx.userId, now, onWrite };
    const result =
      body.viable === false
        ? recordOverallNotViable(db, { ...base, rationale: body.rationale, evidenceRef: body.evidence_ref })
        : recordViableShapes(db, { ...base, intent: body.intent, shapes: body.shapes });
    if (!result.changed)
      return ok({ verdict: body.viable ? "viable" : "not_viable", rows: [], superseded: [], changed: false }, 200);
    return ok(
      {
        verdict: body.viable ? "viable" : "not_viable",
        rows: result.rows,
        superseded: result.superseded,
        changed: true,
      },
      201,
    );
  } catch (e) {
    if (e instanceof DealShapeError) {
      if (e.kind === "opportunity_not_found") return notFound();
      if (e.kind === "stale") return fail(409, "deal_shape_stale", e.message, e.details);
      return bad(e.message, e.details);
    }
    throw e;
  }
});
