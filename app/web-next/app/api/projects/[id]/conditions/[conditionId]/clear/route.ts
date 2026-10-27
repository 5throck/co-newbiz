// POST /api/projects/:id/conditions/:conditionId/clear - close an open condition precedent as satisfied
// (ADR-0186 D4, design 3.4). Body: { note, evidence_ref? } - a `closing` condition needs evidence_ref. Human cookie
// session only; the clearer holds an entity-ic-reviewer or group-ic-reviewer grant (403 human_role_required) and is
// not the person who created the condition (403 clearer_must_differ). Audited (condition.clear).
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit, requireInsiderIfMnpi } from "../../../../../../../../../db/lib/access-control.ts";
import { closeCondition, ConditionError, getCondition, type ConditionRow } from "../../../../../../../../../db/repositories/condition-precedent.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { grantFailure, humanSessionDenied, rateLimited, recordRefusal, type IntegrityFailure } from "../../../../../../../lib/gate-integrity.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";
import { validateRationale } from "../../../../../../../lib/rationale-check.ts";
import { route } from "../../../../../../../lib/route.ts";

const CONDITION_CLEAR_ROLES = ["entity-ic-reviewer", "group-ic-reviewer"] as const;

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string; conditionId: string }> }) => {
  const early = humanSessionDenied(request, null);
  if (early) return early;
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const human = humanSessionDenied(request, ctx);
  if (human) return human;
  const { id, conditionId } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const db = getDb();
  try {
    requireInsiderIfMnpi(db, id, ctx.userId);
  } catch (e) {
    return forbidden("insider_required", (e as Error).message);
  }
  const limited = rateLimited("condition_clear", ctx.userId);
  if (limited) return limited;
  const biz = requireBusinessActor(ctx, "write");
  if (biz) return biz;
  const body = (await request.json().catch(() => null)) as { note?: string; evidence_ref?: string } | null;
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const now = new Date().toISOString();
  const target = `${id}:${conditionId}`;
  try {
    // Security review J2: the grant is read INSIDE the write transaction, before the condition's state is revealed.
    const out = db.transaction((): { failure: IntegrityFailure } | { row: ConditionRow } => {
      const g = grantFailure(db, ctx.userId, CONDITION_CLEAR_ROLES);
      if (g) return { failure: g };
      if (!note) return { failure: { status: 400, code: "invalid_request", message: "note is required - state how the condition was satisfied." } };
      const check = validateRationale(note, "ack");
      if (!check.ok) return { failure: { status: 422, code: "rationale_insufficient", message: `The clearing note does not meet the minimum substance profile (${check.reason}).`, details: { field: "note", reason: check.reason, profile: "ack" } } };
      const closed = closeCondition(db, { projectId: id, id: conditionId, to: "cleared", by: ctx.userId, note: note.slice(0, 2000), evidenceRef: body?.evidence_ref?.trim().slice(0, 2048), now });
      appendAudit(db, { actor: ctx.userId, action: "condition.clear", target: `${id}:${closed.gate}:${conditionId}`, now });
      return { row: closed };
    }).immediate();
    if ("failure" in out) {
      if (out.failure.status >= 403) recordRefusal(db, { actor: ctx.userId, scope: "condition.clear", target }, out.failure.code);
      return fail(out.failure.status, out.failure.code, out.failure.message, out.failure.details);
    }
    return ok({ condition: out.row }, 200);
  } catch (err) {
    if (err instanceof ConditionError) {
      if (err.code === "not_found") return notFound();
      if (err.code === "same_person") {
        recordRefusal(db, { actor: ctx.userId, scope: "condition.clear", target }, "clearer_must_differ");
        return forbidden("clearer_must_differ", err.message);
      }
      if (err.code === "evidence_required") return badRequest("evidence_required", err.message);
      recordRefusal(db, { actor: ctx.userId, scope: "condition.clear", target }, "condition_not_open");
      return fail(409, "condition_not_open", err.message);
    }
    throw err;
  }
});
