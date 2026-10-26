// Waiver decision — PATCH records the human approve/reject/revoke
// (db/lib/compliance.ts decideWaiver). Approve flips pending → active with
// the approver record; reject records the schema-reserved 'rejected' state;
// revoke is only for invalidated justification — otherwise expiry IS the
// enforcement mechanism (skills/waiver-management).
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { decideWaiver, type WaiverDecision } from "../../../../../../../../db/lib/compliance.ts";
import { authenticate, humanOnlyDenied } from "../../../../../../lib/auth.ts";
import { applyFamily, type IntegrityFailure } from "../../../../../../lib/gate-integrity.ts";
import { waiverApproveFailure } from "../../../../../../lib/waiver-guard.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";

const DECISIONS = new Set<WaiverDecision>(["approve", "reject", "revoke"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; waiverId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Waiver judgements require the analyst role or higher.");
  const { id, waiverId } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { decision?: string } | null;
  const decision = body?.decision as WaiverDecision | undefined;
  if (!decision || !DECISIONS.has(decision)) {
    return badRequest("invalid_request", `decision must be one of ${[...DECISIONS].join("|")}.`);
  }
  const db = getDb();
  const waiver = db.query("SELECT id, project_id, requested_by, approver_role, expires_at FROM waiver WHERE id = ?").get(waiverId) as
    | { id: string; project_id: string; requested_by: string; approver_role: string; expires_at: string }
    | undefined;
  if (!waiver || waiver.project_id !== id) return notFound();

  const now = new Date().toISOString();
  // ADR-0186 D5 (family `waiver`): approval through this legacy route is held to the same rules as
  // POST .../approve. off = legacy; shadow = recorded, not blocked; enforce = blocked.
  if (decision === "approve") {
    // All modes: nobody approves their own request, and an expired request cannot be approved.
    if (waiver.requested_by === ctx.userId) return forbidden("approver_must_differ", "The approver of a waiver must differ from its requester.");
    if (waiver.expires_at <= now) return badRequest("invalid_transition", "expires_at already passed - approve a re-filed request instead.");
    const denied = applyFamily("waiver", { entityType: "project", entityId: id, gate: "waiver_approve", actor: ctx.userId }, (): IntegrityFailure | null => {
      if (humanOnlyDenied(ctx, "human session required")) {
        return { status: 403, code: "human_only", message: "Waiver approval is exercised from a human web session; bearer tokens and agent sessions cannot approve." };
      }
      return waiverApproveFailure(db, waiver, ctx.userId, now);
    });
    if (denied) return denied;
  }
  try {
    const row = decideWaiver(db, { id: waiverId, decision, decidedBy: ctx.userId, now });
    appendAudit(db, { actor: ctx.userId, action: `waiver.${decision}`, target: `${id}:${waiverId}`, now });
    return ok({ id: row.id, status: row.status, approved_by: row.approved_by, approved_at: row.approved_at });
  } catch (err) {
    return badRequest("invalid_transition", err instanceof Error ? err.message : String(err));
  }
}
