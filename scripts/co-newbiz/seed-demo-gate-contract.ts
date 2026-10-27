// @version 1.0.0
// Demo gate decisions recorded THROUGH the ADR-0186 contract (owner decision O-5, design phase P5).
//
// The S1-S12 demo seeds used to write `gate_decision` rows with raw SQL ("S1-S12 demo human-final gate approval"), which
// bypassed the acknowledged-GO snapshot, the six-validator rule, the confirmed discount rate and the maker/checker
// countersign. This module records the demo ladder with the same functions the Route Handlers call
// (recordGateDecisionRow, countersignDecision, closeCondition, recordWaccSession, decideWaiver, ...), with every
// gate-integrity family forced to `enforce` for the duration, so the seeded deals are valid under the new contract.
//
// Demo identities (no login: the accounts are `disabled` with an unusable hash):
//   demo-seed            the maker (recorder of every decision)
//   demo-entity-reviewer holds entity-ic-reviewer (countersigns entity_ic, approves the waiver)
//   demo-group-reviewer  holds group-ic-reviewer  (countersigns group_ic, clears the group_ic condition)
//   demo-admin           issued the two grants
// All writes are idempotent: every step is guarded by "already recorded".
import type { Database } from "bun:sqlite";
import { appendAudit } from "../../db/lib/access-control.ts";
import { decideWaiver, issueWaiver } from "../../db/lib/compliance.ts";
import { issueHumanRoleGrant, hasHumanRole } from "../../db/lib/human-roles.ts";
import { setProjectWaccSubject, recordWaccSession } from "../../db/lib/wacc.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { closeCondition, openConditions } from "../../db/repositories/condition-precedent.repository.ts";
import { GATE_INTEGRITY_FAMILIES, gateIntegrityEnvName } from "../../app/web-next/lib/gate-integrity-flags.ts";
import { clearSnapshotCache, previewGateSnapshot } from "../../app/web-next/lib/gate-snapshot.ts";
import { recordGateDecisionRow, type ProvidedAck } from "../../app/web-next/lib/gate-decision-contract.ts";
import { countersignDecision } from "../../app/web-next/lib/gate-countersign.ts";
import { getChecklistItems } from "../../app/web-next/lib/library.ts";
import { upsertChecklistState } from "../../app/web-next/lib/dd-checklist-tailor.ts";
import { BF_FEASIBILITY_CHECKLIST_ID } from "../../app/web-next/lib/dd-checklist-tailor.ts";
import { maValidatorRuleKey, MA_VALIDATOR_APPLICABILITY } from "../../db/lib/validator-applicability.ts";

export const DEMO_MAKER = "demo-seed";
export const DEMO_ENTITY_REVIEWER = "demo-entity-reviewer";
export const DEMO_GROUP_REVIEWER = "demo-group-reviewer";
export const DEMO_ADMIN = "demo-admin";

const ACK_REASON = "데모 시드: 사람이 스냅샷의 해당 항목을 검토하고 승계 사유를 기록함";

/** Run `fn` with every gate-integrity family on `enforce`, restoring the previous environment afterwards. */
export function withEnforcedContract<T>(fn: () => T): T {
  const names = GATE_INTEGRITY_FAMILIES.map(gateIntegrityEnvName);
  const saved = names.map((n) => process.env[n]);
  for (const n of names) process.env[n] = "enforce";
  clearSnapshotCache();
  try {
    return fn();
  } finally {
    names.forEach((n, i) => { if (saved[i] === undefined) delete process.env[n]; else process.env[n] = saved[i]; });
    clearSnapshotCache();
  }
}

/** Disabled demo accounts and the two IC reviewer grants. */
export function ensureDemoReviewers(db: Database, now: string): void {
  for (const userId of [DEMO_MAKER, DEMO_ENTITY_REVIEWER, DEMO_GROUP_REVIEWER, DEMO_ADMIN]) {
    db.run(
      `INSERT OR IGNORE INTO app_user (id, user_id, display_name, role, status, password_salt, password_hash, password_iterations, must_change_password, created_at)
       VALUES (?,?,?,?, 'disabled', 'disabled', 'disabled', 1, 1, ?)`,
      [ulid(), userId, `${userId} (demo, no login)`, userId === DEMO_ADMIN ? "admin" : "analyst", now],
    );
  }
  for (const [userId, role] of [[DEMO_ENTITY_REVIEWER, "entity-ic-reviewer"], [DEMO_GROUP_REVIEWER, "group-ic-reviewer"]] as const) {
    if (!hasHumanRole(db, userId, [role])) {
      const id = issueHumanRoleGrant(db, { userId, roleKey: role, grantedBy: DEMO_ADMIN, now });
      appendAudit(db, { actor: DEMO_ADMIN, action: "grant.issue", target: `${userId}:${role}:${id}`, now });
    }
  }
}

/** The maker leads the demo project; the two reviewers are members so they can see (and countersign) it. */
export function ensureDemoMembers(db: Database, projectId: string, now: string): void {
  for (const [userId, role] of [[DEMO_MAKER, "lead"], [DEMO_ENTITY_REVIEWER, "member"], [DEMO_GROUP_REVIEWER, "member"]] as const) {
    db.run(
      "INSERT OR IGNORE INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
      [projectId, userId, role, DEMO_ADMIN, now, "S1-S12 demo gate contract"],
    );
  }
}

/** Timestamps that strictly increase so "latest decision" is unambiguous inside one seed run. */
export function makeClock(): () => string {
  let t = Date.now();
  return () => new Date((t += 5)).toISOString();
}

export interface DecisionStep {
  entityType: "opportunity" | "project";
  entityId: string;
  gate: string;
  decision: "go" | "hold" | "kill";
  rationale: string;
  missing?: string[];
  learning?: string;
  conditions?: Array<{ text: string; clear_by: "group_ic" | "establishment" | "closing" }>;
  /** Persist an AI brief record recommending this and send its id (D9 divergence: the GO then carries `divergence`). */
  briefRecommended?: "go" | "hold" | "kill";
  divergence?: string;
}

function recorded(db: Database, s: Pick<DecisionStep, "entityType" | "entityId" | "gate" | "decision">): string | null {
  const row = db
    .query(
      `SELECT g.id FROM gate_decision g JOIN gate_decision_snapshot n ON n.decision_id = g.id
       WHERE g.entity_type = ? AND g.entity_id = ? AND g.gate = ? AND g.decision = ? AND g.decided_by = ? ORDER BY g.decided_at DESC LIMIT 1`,
    )
    .get(s.entityType, s.entityId, s.gate, s.decision, DEMO_MAKER) as { id: string } | null;
  return row?.id ?? null;
}

/** Record one decision through the contract. Returns the (new or already recorded) decision id. */
export function recordStep(db: Database, step: DecisionStep, clock: () => string): string {
  const existing = recorded(db, step);
  if (existing) return existing;
  let briefId: string | null = null;
  if (step.briefRecommended) {
    briefId = ulid();
    db.run(
      "INSERT INTO gate_brief_record (id, entity_type, entity_id, gate, recommended, confidence, source, generated_by, generated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [briefId, step.entityType, step.entityId, step.gate, step.briefRecommended, "medium", "synthesis", DEMO_MAKER, clock()],
    );
  }
  if (step.entityType === "project") ensureDemoMembers(db, step.entityId, clock());
  clearSnapshotCache();
  const preview = previewGateSnapshot({ entityType: step.entityType, entityId: step.entityId, gate: step.gate, actor: DEMO_MAKER, briefId, db }, { fresh: true });
  const acks: ProvidedAck[] = preview.snapshot.required_acks.map((a) => ({ key: a.key, kind: a.kind, reason: ACK_REASON }));
  const result = recordGateDecisionRow(db, {
    entityType: step.entityType,
    entityId: step.entityId,
    gate: step.gate,
    decision: step.decision,
    storedRationale: step.rationale,
    missingArtifactsJson: step.decision === "hold" ? JSON.stringify(step.missing ?? ["데모: 보완이 필요한 산출물"]) : null,
    actor: DEMO_MAKER,
    gateEvaluationId: null,
    learningCapture: step.decision === "kill" ? (step.learning ?? null) : null,
    judgementConfirmationsJson: null,
    extras: {
      snapshotHash: preview.hash,
      acknowledgements: step.decision === "go" ? acks : [],
      briefId,
      divergenceReason: step.divergence ?? null,
      killOverrideId: null,
    },
    conditions: step.conditions,
    now: clock(),
  });
  if (!result.ok) {
    throw new Error(`demo seed: ${step.entityType} ${step.entityId} ${step.gate} ${step.decision} refused by the gate contract - ${result.failure.code}: ${result.failure.message} ${JSON.stringify(result.failure.details ?? {}).slice(0, 600)}`);
  }
  return result.id;
}

/** The checker's act on an IC GO (idempotent). */
export function countersign(db: Database, projectId: string, decisionId: string, checker: string, reason: string, clock: () => string): void {
  const done = db.query("SELECT 1 FROM approval_chain WHERE gate_decision_id = ? AND decided_by = ? AND status IN ('approved','conditional')").get(decisionId, checker);
  if (done) return;
  const r = countersignDecision(db, { projectId, decisionId, checkerId: checker, decision: "approved", reason, conditions: [], now: clock() });
  if (!r.ok) throw new Error(`demo seed: countersign refused - ${r.failure.code}: ${r.failure.message}`);
}

/** Clear every open group_ic condition of the project (the clearer is neither the creator nor the recorder). */
export function clearGroupIcConditions(db: Database, projectId: string, clearer: string, clock: () => string): void {
  for (const c of openConditions(db, projectId, ["group_ic"])) {
    closeCondition(db, { projectId, id: c.id, to: "cleared", by: clearer, note: "데모 시드: 그룹 심의 전에 조건 이행 여부를 확인하고 해제함", now: clock() });
    appendAudit(db, { actor: clearer, action: "condition.clear", target: `${projectId}:${c.gate}:${c.id}`, now: clock() });
  }
}

/** WACC session through the same service the WACC route uses: subject confirmed, WACC and hurdle recorded kind=user. */
export function recordDemoWacc(db: Database, projectId: string, opts: { subject: "target" | "project_newco" | "promoter"; subjectCompanyId: string | null; clock: () => string }): void {
  const has = db.query("SELECT 1 FROM assumption a JOIN run r ON r.id = a.run_id WHERE r.project_id = ? AND a.assumption_key = 'wacc' AND a.kind = 'user' AND r.subject_company_id IS ?").get(projectId, opts.subjectCompanyId);
  if (has) return;
  const now = opts.clock();
  setProjectWaccSubject(db, projectId, opts.subject, "데모 시드: WACC 적용 주체를 사람이 확정함", DEMO_MAKER, now);
  recordWaccSession(db, {
    projectId, wacc: 0.09, hurdleIrr: 0.12, mode: "direct", rationale: "데모 시드: 사람이 확정한 할인율과 허들 IRR", anchorRef: "demo:wacc-session",
    subjectCompanyId: opts.subjectCompanyId, actor: DEMO_MAKER, now,
  });
}

/** The six M&A validator records (compliance_check rows the completeness engine counts). */
export function recordDemoValidators(db: Database, projectId: string, clock: () => string): void {
  for (const row of MA_VALIDATOR_APPLICABILITY) {
    if (!row.in_core) continue;
    const rule = maValidatorRuleKey(row.key);
    if (db.query("SELECT 1 FROM compliance_check WHERE project_id = ? AND gate = 'DD' AND rule_key = ?").get(projectId, rule)) continue;
    db.run(
      "INSERT INTO compliance_check (id, project_id, gate, rule_key, layer, result, detail, detected_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), projectId, "DD", rule, "procedure", "pass", `${row.key} validator recorded (demo seed)`, clock()],
    );
  }
}

/**
 * Waiver path: one waiver-eligible mandatory DD item is `waived` instead of `pass`. The waiver is requested by the maker and
 * approved by a different grant holder (decideWaiver), exactly the D5 shape. Returns the checklist/item judged.
 */
export function recordDemoWaiver(db: Database, projectId: string, checklistId: string, clock: () => string): { itemId: string; waiverId: string } | null {
  const item = (getChecklistItems(checklistId) ?? []).find((i) => i.mandatory && i.waiver_eligible);
  if (!item) return null;
  const clauseRef = `${checklistId} ${item.id}`;
  const existing = db.query("SELECT id FROM waiver WHERE project_id = ? AND clause_ref = ?").get(projectId, clauseRef) as { id: string } | null;
  let doc = db.query("SELECT id FROM governance_doc WHERE key = 'neb-policy' LIMIT 1").get() as { id: string } | null;
  if (!doc) {
    db.run(
      `INSERT OR IGNORE INTO governance_doc (id, layer, key, title, scope, version, enforceability, owner_agent, doc_path, effective_from)
       VALUES ('demo-govdoc-neb-policy','policy','neb-policy','Group New Business Review Policy (demo reference)','shared','1.0.0','mandatory','process-governance-manager','policies/group/neb-policy.md',?)`,
      [clock()],
    );
    doc = { id: "demo-govdoc-neb-policy" };
  }
  const now = clock();
  let waiverId = existing?.id ?? null;
  if (!waiverId) {
    const expires = new Date(Date.parse(now) + 60 * 86_400_000).toISOString();
    waiverId = issueWaiver(db, {
      projectId, governanceDocId: doc.id, clauseRef, reason: "데모 시드: 이 항목은 근거 자료가 입수되기 전까지 기한부로 면제함",
      requestedBy: DEMO_MAKER, approverRole: "entity-ic-reviewer", expiresAt: expires, now,
    });
    appendAudit(db, { actor: DEMO_MAKER, action: "waiver.request", target: `${projectId}:${doc.id}:${clauseRef}:${waiverId}`, now });
    decideWaiver(db, { id: waiverId, decision: "approve", decidedBy: DEMO_ENTITY_REVIEWER, now: clock() });
    appendAudit(db, { actor: DEMO_ENTITY_REVIEWER, action: "waiver.approve", target: `${projectId}:${waiverId}`, now: clock() });
  }
  upsertChecklistState(projectId, checklistId, item.id, "waived", DEMO_MAKER, { note: "면제(데모): 승인된 기한부 면제", waiverId });
  return { itemId: item.id, waiverId };
}

/** The waiver-eligible mandatory item of a checklist the seed leaves to the waiver path (null when none). */
export function waiverItemFor(checklistId: string): string | null {
  return (getChecklistItems(checklistId) ?? []).find((i) => i.mandatory && i.waiver_eligible)?.id ?? null;
}

/**
 * bf-01 / bf-02 / bf-03 of the brownfield feasibility checklist, written AFTER the records they summarise exist (six
 * validators, a confirmed WACC session, an fs GO) with notes that cite those records - not the blanket "Demo DD completed".
 */
export function recordHonestFeasibilityRows(db: Database, projectId: string, clock: () => string): void {
  const rows: Array<[string, string]> = [
    ["bf-01", "Derived from the six recorded M&A validators (compliance_check ma-validator-*)."],
    ["bf-02", "Discount rate human-confirmed in the WACC session (subject, WACC and hurdle IRR kind=user)."],
    ["bf-03", "Certification transferability recorded; confirmed against the certifying body's rules (demo seed)."],
  ];
  for (const [itemId, note] of rows) {
    upsertChecklistState(projectId, BF_FEASIBILITY_CHECKLIST_ID, itemId, "pass", DEMO_MAKER, { note, evidenceRef: "demo:gate-contract" });
  }
  void clock;
}

/** A minimal, clearly labelled opportunity that the KILL path stops at screening. */
export function seedKilledOpportunity(db: Database, id: string, name: string, clock: () => string): void {
  db.run(
    "INSERT OR IGNORE INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [id, name, "industry", "selected", DEMO_MAKER, clock()],
  );
}
