// Maker/checker countersign of an IC GO - ADR-0186 D6, design 3.6 and 3.14.
//
// The person who records an entity_ic / group_ic decision (the maker, gate_decision.decided_by) cannot be its
// approver. An IC GO becomes effective only when the two-tier approval chain (ADR-0028/0029) holds an
// `approved` or `conditional` decision on THAT decision by a DIFFERENT authenticated user who holds the
// matching human-role grant (entity-ic-reviewer for entity_ic, group-ic-reviewer for group_ic). The grant is
// read inside the write transaction (no cache); a grant revoked after it was issued answers 409 grant_revoked.
//
// This module is the engine; the route (projects/[id]/gate-decisions/[decisionId]/countersign) establishes
// "human cookie session, analyst-or-higher, project visible". The checks here are intrinsic to the act of
// countersigning (a new endpoint, nothing legacy depends on it), so they do not sit behind the family flag:
// family `maker_checker` decides only whether consumers READ an un-countersigned GO as not-GO (enforce) and
// whether a would-block is audited (shadow).
//
// Outcomes on the chain row: approved | conditional -> the GO is effective; rejected |
// withdrawn_pending_resubmission -> the GO stays non-effective and the disagreement is on the record (both rows
// kept); the maker may record a new decision, which needs a new countersign.
import type { Database } from "bun:sqlite";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { ensureApprovalChain, recordDecision, type ApprovalDecision } from "../../../db/lib/approval-chain.ts";
import { CHECKER_ROLE, countersignState, isIcGate, latestProjectDecision, type CountersignState, type IcGate } from "../../../db/lib/gate-effective.ts";
import { hasHumanRole } from "../../../db/lib/human-roles.ts";
import { insertConditions, type NewCondition } from "../../../db/repositories/condition-precedent.repository.ts";
import type { IntegrityFailure } from "./gate-integrity.ts";
import { validateRationale } from "./rationale-check.ts";

export const COUNTERSIGN_DECISIONS = ["approved", "conditional", "rejected", "withdrawn_pending_resubmission"] as const;

export interface CountersignInput {
  projectId: string;
  decisionId: string;
  checkerId: string;
  decision: ApprovalDecision;
  reason: string;
  conditions: readonly NewCondition[];
  now: string;
}

export type CountersignResult =
  | { ok: true; gate: IcGate; decision: ApprovalDecision; state: CountersignState; conditionIds: string[] }
  | { ok: false; failure: IntegrityFailure };

const refuse = (status: IntegrityFailure["status"], code: string, message: string, details?: Record<string, unknown>): CountersignResult => ({ ok: false, failure: { status, code, message, details } });

/** Did this user ever hold the role (any revoked row)? Distinguishes grant_revoked from human_role_required. */
function everHeld(db: Database, userId: string, role: string): boolean {
  return !!db.query("SELECT 1 FROM app_user_human_role WHERE user_id = ? AND role_key = ? LIMIT 1").get(userId, role);
}

/**
 * Record the checker's decision on an IC GO. Runs in one BEGIN IMMEDIATE transaction; any refusal leaves no
 * state change (no chain row touched, no audit row other than the committed ones).
 */
export function countersignDecision(db: Database, input: CountersignInput): CountersignResult {
  return db
    .transaction((): CountersignResult => {
      const d = db
        .query("SELECT id, gate, decision, decided_by, entity_type, entity_id FROM gate_decision WHERE id = ?")
        .get(input.decisionId) as { id: string; gate: string; decision: string; decided_by: string; entity_type: string; entity_id: string } | null;
      if (!d || d.entity_type !== "project" || d.entity_id !== input.projectId) return refuse(404, "not_found", "Not found.");
      if (!isIcGate(d.gate) || d.decision !== "go") {
        return refuse(409, "countersign_not_applicable", "Only an entity_ic or group_ic GO is countersigned; HOLD and KILL are effective immediately.");
      }
      const gate: IcGate = d.gate;
      const latest = latestProjectDecision(db, input.projectId, gate);
      if (!latest || latest.id !== d.id) {
        return refuse(409, "decision_superseded", "This decision is stale or has been superseded by a later decision on the same gate; countersign the latest one.");
      }
      const state = countersignState(db, input.projectId, { id: d.id, gate: d.gate, decision: d.decision, decided_by: d.decided_by });
      if (state === "legacy") {
        return refuse(409, "countersign_not_applicable", "This GO was recorded before the maker/checker contract (at or before the persisted legacy cutoff); it is effective as recorded and needs no countersign.");
      }
      if (state === "countersigned" || state === "countersign_rejected") {
        return refuse(409, "already_countersigned", "This decision already carries a countersign decision; the maker records a new decision if the outcome should change.");
      }

      // Maker / checker: the recorder cannot approve their own decision.
      if (d.decided_by === input.checkerId) {
        return refuse(403, "checker_must_differ", "The reviewer who countersigns an investment committee decision must differ from the person who recorded it.");
      }
      // The grant is re-read here, inside the transaction (no cached role).
      const role = CHECKER_ROLE[gate];
      if (!hasHumanRole(db, input.checkerId, [role])) {
        return everHeld(db, input.checkerId, role)
          ? refuse(409, "grant_revoked", `The ${role} grant needed to countersign was revoked; the countersign is invalid.`)
          : refuse(403, "human_role_required", `Countersigning the ${gate} decision requires an active ${role} human-role grant; an administrator issues grants.`);
      }
      const check = validateRationale(input.reason, "ack");
      if (!check.ok) {
        return refuse(422, "rationale_insufficient", `The countersign reason does not meet the minimum substance profile (${check.reason}).`, { field: "reason", reason: check.reason, profile: "ack" });
      }
      if (input.decision === "conditional" && input.conditions.length === 0) {
        return refuse(422, "conditions_required", "A conditional countersign names at least one condition precedent (conditions[]) so it can be tracked and cleared.");
      }
      if (input.decision !== "conditional" && input.conditions.length > 0) {
        return refuse(400, "invalid_request", "conditions[] apply to a conditional countersign only.");
      }

      ensureApprovalChain(db, { projectId: input.projectId, recordedBy: d.decided_by, now: input.now });
      recordDecision(db, {
        projectId: input.projectId,
        level: gate === "entity_ic" ? "entity" : "group",
        decision: input.decision,
        decidedAt: input.now,
        conditions: input.conditions.length > 0 ? input.conditions.map((c) => c.text).join("; ") : undefined,
        decidedBy: input.checkerId,
        gateDecisionId: d.id,
        decisionReason: input.reason,
        now: input.now,
      });
      // The chain row of this gate carries the maker too (recorded_by is updated for the decision it now belongs to).
      db.run("UPDATE approval_chain SET recorded_by = ? WHERE project_id = ? AND gate = ?", [d.decided_by, input.projectId, gate]);
      const conditionIds = insertConditions(db, {
        projectId: input.projectId, decisionId: d.id, gate, items: input.conditions.map((c) => ({ ...c, origin: "countersign" as const })), createdBy: input.checkerId, now: input.now,
      });
      appendAudit(db, { actor: input.checkerId, action: "gate_decision.countersign", target: `${input.projectId}:${gate}:${d.id}:${input.decision}`, now: input.now });
      for (const cid of conditionIds) appendAudit(db, { actor: input.checkerId, action: "condition.create", target: `${input.projectId}:${gate}:${cid}`, now: input.now });
      const next = countersignState(db, input.projectId, { id: d.id, gate: d.gate, decision: d.decision, decided_by: d.decided_by });
      return { ok: true, gate, decision: input.decision, state: next, conditionIds };
    })
    .immediate();
}
