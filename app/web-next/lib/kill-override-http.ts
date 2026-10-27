// Group IC kill-criteria override routes - shared handlers for both carriers (ADR-0186 D1 / D6, owner
// decision O-7, design 3.6 and 3.14). Issued by a person holding `group-ic-reviewer`, with a reason (ack
// substance profile), before the formal group_ic sitting is allowed. The gate-decision write (family
// `kill_binding`) honours an active override, and refuses it when its issuer is the person recording the GO
// (issuer is not the recorder of the decision it unblocks). Cookie session only; audited
// `kill_override.issue` / `kill_override.revoke`; rows are revoked, never deleted.
//
// Only a criterion whose registry action is `halt` can be overridden (the others are acknowledged, not
// binding), and only one that belongs to the entity's procedure universe.
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { appendAudit, logDataAccess, requireInsiderIfMnpi } from "../../../db/lib/access-control.ts";
import { insertKillOverride, KillOverrideError, listKillOverrides, revokeKillOverride } from "../../../db/repositories/kill-override.repository.ts";
import { authenticate, requireBusinessActor } from "./auth.ts";
import { badRequest, fail, forbidden, notFound, ok } from "./envelope.ts";
import { grantFailure, humanSessionDenied, rateLimited, recordRefusal, type IntegrityFailure } from "./gate-integrity.ts";
import { OPPORTUNITY_PROCEDURES } from "./gate-snapshot.ts";
import { applicableKillProcedures, loadKillCriteriaRegistry } from "./ic-review-steps.ts";
import type { LadderTrack } from "./gate-sequence-view.ts";
import { visibleProject } from "./project-visibility.ts";
import { validateRationale } from "./rationale-check.ts";

export type OverrideEntity = "opportunity" | "project";
export const KILL_OVERRIDE_ROLES = ["group-ic-reviewer"] as const;

/** Procedures whose kill criteria a gate of this entity evaluates. */
function procedureUniverse(db: Database, entityType: OverrideEntity, entityId: string): string[] {
  if (entityType === "project") return applicableKillProcedures(db, entityId);
  const set = new Set<string>();
  for (const track of [null, "greenfield", "brownfield"] as Array<LadderTrack | null>) {
    for (const gate of Object.keys(OPPORTUNITY_PROCEDURES)) for (const p of OPPORTUNITY_PROCEDURES[gate](track)) set.add(p);
  }
  return [...set];
}

function entityVisible(ctxAuth: Parameters<typeof visibleProject>[0], entityType: OverrideEntity, entityId: string): boolean {
  if (entityType === "project") return !!visibleProject(ctxAuth, entityId, { includeClosed: true });
  return !!getDb().query("SELECT id FROM opportunity WHERE id = ?").get(entityId);
}

export async function listOverridesHandler(request: Request, entityType: OverrideEntity, entityId: string): Promise<Response> {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (entityType === "opportunity") {
    // Opportunities are not membership-scoped: same read guard as the opportunity gate-decisions route (admin excluded by role separation).
    const denied = requireBusinessActor(auth.auth, "read");
    if (denied) return denied;
  }
  if (!entityVisible(auth.auth, entityType, entityId)) return notFound();
  if (entityType === "project") {
    // Security review J6: reads match the writes - MNPI insider check and a read access-log row.
    const db = getDb();
    try {
      requireInsiderIfMnpi(db, entityId, auth.auth.userId);
    } catch (e) {
      return forbidden("insider_required", (e as Error).message);
    }
    logDataAccess(db, { userId: auth.auth.userId, tableKey: "kill_criteria_override", recordRef: entityId, projectId: entityId, action: "read", at: new Date().toISOString() });
  }
  const includeRevoked = new URL(request.url).searchParams.get("include_revoked") === "1";
  const overrides = listKillOverrides(entityType, entityId, { includeRevoked });
  return ok({ overrides }, 200, { count: overrides.length });
}

const refuse = (f: IntegrityFailure) => fail(f.status, f.code, f.message, f.details);
type Failed = { failure: IntegrityFailure };

export async function issueOverrideHandler(request: Request, entityType: OverrideEntity, entityId: string): Promise<Response> {
  const early = humanSessionDenied(request, null);
  if (early) return early;
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const human = humanSessionDenied(request, ctx);
  if (human) return human;
  const biz = requireBusinessActor(ctx, "write");
  if (biz) return biz;
  if (!entityVisible(ctx, entityType, entityId)) return notFound();
  const db = getDb();
  if (entityType === "project") {
    try {
      requireInsiderIfMnpi(db, entityId, ctx.userId);
    } catch (e) {
      return forbidden("insider_required", (e as Error).message);
    }
  }
  const limited = rateLimited("kill_override", ctx.userId);
  if (limited) return limited;
  const body = (await request.json().catch(() => null)) as { procedure_key?: string; criterion_id?: string; reason?: string } | null;
  const procedureKey = body?.procedure_key?.trim();
  const criterionId = body?.criterion_id?.trim();
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const now = new Date().toISOString();
  const target = `${entityType}:${entityId}`;
  try {
    // Security review J2: the grant is read INSIDE the write transaction, before anything about the criterion is revealed.
    const out = db.transaction((): Failed | { id: string } => {
      const g = grantFailure(db, ctx.userId, KILL_OVERRIDE_ROLES);
      if (g) return { failure: g };
      if (!procedureKey || !criterionId) return { failure: { status: 400, code: "invalid_request", message: "procedure_key and criterion_id are required." } };
      if (!reason) return { failure: { status: 400, code: "invalid_request", message: "reason is required - an override without its reasoning is not recordable." } };
      const check = validateRationale(reason, "ack");
      if (!check.ok) return { failure: { status: 422, code: "rationale_insufficient", message: `The override reason does not meet the minimum substance profile (${check.reason}).`, details: { field: "reason", reason: check.reason, profile: "ack" } } };
      if (!procedureUniverse(db, entityType, entityId).includes(procedureKey)) {
        return { failure: { status: 422, code: "override_not_applicable", message: `procedure_key ${procedureKey} is not part of this entity's kill-criteria procedures.` } };
      }
      const entry = loadKillCriteriaRegistry(procedureKey).find((e) => e.criterion_id === criterionId);
      if (!entry) return { failure: { status: 422, code: "override_not_applicable", message: `criterion ${criterionId} does not exist in ${procedureKey}.` } };
      if (entry.action !== "halt") {
        return { failure: { status: 422, code: "override_not_applicable", message: `criterion ${criterionId} has action ${entry.action}: only a binding (halt) criterion is overridden; the others are acknowledged on the GO.` } };
      }
      const newId = insertKillOverride(db, { entityType, entityId, procedureKey, criterionId, reason: reason.slice(0, 2000), issuedBy: ctx.userId, now });
      appendAudit(db, { actor: ctx.userId, action: "kill_override.issue", target: `${entityType}:${entityId}:${procedureKey}:${criterionId}:${newId}`, now });
      return { id: newId };
    }).immediate();
    if ("failure" in out) {
      // B2: a refused attempt leaves an audit row (403 / 409 / 422 only; shape errors are noise).
      if (out.failure.status >= 403) recordRefusal(db, { actor: ctx.userId, scope: "kill_override.issue", target }, out.failure.code);
      return refuse(out.failure);
    }
    return ok({ id: out.id, entity_type: entityType, entity_id: entityId, procedure_key: procedureKey, criterion_id: criterionId, issued_by: ctx.userId, issued_at: now }, 201);
  } catch (err) {
    if (err instanceof KillOverrideError) {
      recordRefusal(db, { actor: ctx.userId, scope: "kill_override.issue", target }, "override_exists");
      return fail(409, "override_exists", err.message);
    }
    throw err;
  }
}

export async function revokeOverrideHandler(request: Request, entityType: OverrideEntity, entityId: string, overrideId: string): Promise<Response> {
  const early = humanSessionDenied(request, null);
  if (early) return early;
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const human = humanSessionDenied(request, ctx);
  if (human) return human;
  const biz = requireBusinessActor(ctx, "write");
  if (biz) return biz;
  if (!entityVisible(ctx, entityType, entityId)) return notFound();
  const limited = rateLimited("kill_override", ctx.userId);
  if (limited) return limited;
  const db = getDb();
  const now = new Date().toISOString();
  const target = `${entityType}:${entityId}:${overrideId}`;
  try {
    const out = db.transaction((): Failed | { row: ReturnType<typeof revokeKillOverride> } => {
      const g = grantFailure(db, ctx.userId, KILL_OVERRIDE_ROLES);
      if (g) return { failure: g };
      const revoked = revokeKillOverride(db, { entityType, entityId, id: overrideId, revokedBy: ctx.userId, now });
      appendAudit(db, { actor: ctx.userId, action: "kill_override.revoke", target: `${entityType}:${entityId}:${revoked.procedure_key}:${revoked.criterion_id}:${overrideId}`, now });
      return { row: revoked };
    }).immediate();
    if ("failure" in out) {
      recordRefusal(db, { actor: ctx.userId, scope: "kill_override.revoke", target }, out.failure.code);
      return refuse(out.failure);
    }
    return ok({ override: out.row }, 200);
  } catch (err) {
    if (err instanceof KillOverrideError) {
      if (err.code === "not_found") return notFound();
      recordRefusal(db, { actor: ctx.userId, scope: "kill_override.revoke", target }, "override_already_revoked");
      return fail(409, "override_already_revoked", err.message);
    }
    throw err;
  }
}
