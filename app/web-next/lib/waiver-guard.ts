// Waiver hardening rules - ADR-0186 D5 / design 3.5. Pure checks that return an
// IntegrityFailure (or null) so the issue route, the approve route and the
// legacy PATCH approve share one definition. The families decide whether a
// failure blocks (applyFamily); the dedicated approve route always enforces.
import type { Database } from "bun:sqlite";
import { hasHumanRole, isGrantableRole } from "../../../db/lib/human-roles.ts";
import { type IntegrityFailure } from "./gate-integrity.ts";
import { getChecklistItems } from "./library.ts";

/** Maximum waiver term, owner decision 2 (2026-10-27). */
export const WAIVER_MAX_DAYS = 90;
const DAY_MS = 86_400_000;

/** `approver_role` values a waiver may name: the human roles that may approve (owner decision 4). */
export const WAIVER_APPROVER_ROLES = ["entity-ic-reviewer", "group-ic-reviewer"] as const;

/**
 * Issue-time rules for the `waiver` family. clause_ref is `<checklist_id> <item_id>`;
 * it must resolve to a checklist item (policy-clause waivers are not supported), a
 * mandatory item with waiver_eligible=false is 422 not_waivable, and the named
 * approver_role must be one of the approver human roles.
 */
export function waiverIssueFailure(opts: { clauseRef: string; approverRole: string; db: Database; projectId: string }): IntegrityFailure | null {
  const parts = opts.clauseRef.trim().split(/\s+/);
  if (parts.length !== 2) {
    return { status: 422, code: "clause_unresolved", message: "clause_ref must be '<checklist_id> <item_id>' naming a DD checklist item; policy-clause waivers are not supported." };
  }
  const [checklistId, itemId] = parts;
  let mandatory = true;
  let waiverEligible = true;
  if (checklistId.startsWith("custom:")) {
    const custom = opts.db
      .query("SELECT id FROM project_checklist_item_custom WHERE id = ? AND project_id = ? AND status = 'approved'")
      .get(itemId, opts.projectId);
    if (!custom) return { status: 422, code: "clause_unresolved", message: `clause_ref ${opts.clauseRef} does not resolve to an approved checklist item.` };
  } else {
    const item = getChecklistItems(checklistId)?.find((i) => i.id === itemId);
    if (!item) return { status: 422, code: "clause_unresolved", message: `clause_ref ${opts.clauseRef} does not resolve to a checklist item.` };
    mandatory = item.mandatory;
    waiverEligible = item.waiver_eligible;
  }
  if (mandatory && !waiverEligible) {
    return { status: 422, code: "not_waivable", message: `Item ${itemId} of ${checklistId} is mandatory and not waiver-eligible; it has no waiver path (a missing validator is a Kill Criterion).` };
  }
  if (!(WAIVER_APPROVER_ROLES as readonly string[]).includes(opts.approverRole)) {
    return { status: 422, code: "approver_role_invalid", message: `approver_role must be one of ${WAIVER_APPROVER_ROLES.join(" | ")}.` };
  }
  return null;
}

export interface WaiverForApproval {
  requested_by: string;
  approver_role: string;
  expires_at: string;
}

/**
 * Approval-time rules: approver differs from requester, holds an active grant
 * of the waiver's approver_role (deny-by-default), and the term from approval
 * does not exceed 90 days. The caller establishes "human cookie session".
 */
export function waiverApproveFailure(db: Database, waiver: WaiverForApproval, approverId: string, now: string): IntegrityFailure | null {
  if (waiver.requested_by === approverId) {
    return { status: 403, code: "approver_must_differ", message: "The approver of a waiver must differ from its requester." };
  }
  if (!isGrantableRole(waiver.approver_role) || !hasHumanRole(db, approverId, [waiver.approver_role])) {
    return { status: 403, code: "human_role_required", message: `Approving this waiver requires an active ${waiver.approver_role} human-role grant.` };
  }
  const maxExpiry = new Date(Date.parse(now) + WAIVER_MAX_DAYS * DAY_MS).toISOString();
  if (waiver.expires_at > maxExpiry) {
    return { status: 422, code: "waiver_term_too_long", message: `A waiver may run at most ${WAIVER_MAX_DAYS} days from approval; shorten expires_at and re-request.` };
  }
  return null;
}
