// @version 1.0.0
/**
 * Compliance / waiver / interpretation engine — design v1.0 §2-5, ADR-0036,
 * ADR-0037, FR-GOV-09..12, docs/governance-operations.md.
 *
 * ADR-0037 gate blocking: a gate is BLOCKED when a mandatory deliverable is
 * missing or a mandatory checklist item is incomplete — unless an active
 * (non-expired) waiver covers that rule. The reverse case is equally
 * binding: RECOMMENDED items must NOT block; their result is
 * `reason_required` (explain why you skipped it), because a guideline that
 * blocks is a guideline pretending to be a policy (design §2-0 five-layer
 * enforceability). One rule has NO waiver path at all: the Brown Field
 * six-validator completeness check — waivable rules are marked
 * waiverEligible=false at the requirement level, so the engine refuses
 * rather than trusting a waiver row that should never exist.
 *
 * ADR-0036 waivers: expires_at is NOT NULL at the schema level and the
 * engine refuses to issue one without an explicit expiry — an indefinite
 * waiver is a de facto unrecorded repeal of its clause. Date is
 * authoritative over the status column: an 'active' row whose expires_at
 * has passed does not unblock anything. Concentration (>= 3 waivers on the
 * same clause) is an AMENDMENT TRIGGER, not a compliance failure — the
 * clause is telling you the rule no longer matches reality.
 *
 * FR-GOV-12 interpretations: a later answer never silently contradicts an
 * earlier one — supersession is explicit via the `supersedes` link.
 */

import type { Database } from "bun:sqlite";
import { ulid } from "./ulid.ts";

// ---------------------------------------------------------------------------
// Gate checking
// ---------------------------------------------------------------------------

export interface GateRequirement {
  /** Stable rule key, e.g. 'bf-six-validator-completeness'. */
  ruleKey: string;
  layer: "policy" | "procedure" | "guideline" | "checklist" | "template";
  /** Mandatory rules block; recommended rules require a reason instead (§2-0). */
  mandatory: boolean;
  /** Rules with no waiver path (the BF six-validator check) set this false. */
  waiverEligible?: boolean;
  /** Whether the deliverable exists / the checklist item is complete. */
  satisfied: boolean;
  /** governance_doc + clause this rule comes from — the waiver anchor. */
  governanceDocId?: string;
  clauseRef?: string;
}

export interface GateCheckResultRow {
  ruleKey: string;
  result: "pass" | "blocked" | "reason_required" | "waived";
  detail: string;
  waiverId: string | null;
}

export interface GateCheckResult {
  /** True when the gate may be passed (no blocked rows remain). */
  pass: boolean;
  rows: GateCheckResultRow[];
}

export interface CheckGateOptions {
  projectId: string;
  gate: string;
  requirements: GateRequirement[];
  now: string;
}

/**
 * FR-GOV-09 / ADR-0037: evaluate every requirement of a gate and persist one
 * compliance_check row per requirement. Result semantics:
 *   pass             — satisfied (nothing to check)
 *   blocked          — mandatory AND unsatisfied AND no active waiver
 *   waived           — mandatory AND unsatisfied BUT covered by an active
 *                      waiver (the waiver id is recorded on the row)
 *   reason_required  — recommended AND unsatisfied (never blocks)
 */
export function checkGate(db: Database, options: CheckGateOptions): GateCheckResult {
  const rows: GateCheckResultRow[] = [];

  for (const req of options.requirements) {
    if (req.satisfied) {
      rows.push({ ruleKey: req.ruleKey, result: "pass", detail: "Requirement satisfied.", waiverId: null });
      continue;
    }

    if (!req.mandatory) {
      rows.push({
        ruleKey: req.ruleKey,
        result: "reason_required",
        detail: `Recommended item '${req.ruleKey}' not satisfied — a documented reason is required, but the gate is not blocked (design §2-0 enforceability layers).`,
        waiverId: null,
      });
      continue;
    }

    const waiverEligible = req.waiverEligible ?? true;
    const activeWaiver = waiverEligible && req.governanceDocId && req.clauseRef
      ? findActiveWaiver(db, { projectId: options.projectId, governanceDocId: req.governanceDocId, clauseRef: req.clauseRef, now: options.now })
      : null;

    if (activeWaiver) {
      rows.push({
        ruleKey: req.ruleKey,
        result: "waived",
        detail: `Mandatory item '${req.ruleKey}' unsatisfied but covered by active waiver ${activeWaiver.id} (expires ${activeWaiver.expires_at}) — date is authoritative over the status column (ADR-0036).`,
        waiverId: activeWaiver.id,
      });
      continue;
    }

    rows.push({
      ruleKey: req.ruleKey,
      result: "blocked",
      detail: waiverEligible
        ? `Mandatory item '${req.ruleKey}' unsatisfied with no active waiver — gate blocked (ADR-0037).`
        : `Mandatory item '${req.ruleKey}' unsatisfied — gate blocked; this rule has NO waiver path (${req.ruleKey} is waiverEligible=false, ADR-0037).`,
      waiverId: null,
    });
  }

  for (const row of rows) {
    db.run(
      "INSERT INTO compliance_check (id, project_id, gate, rule_key, layer, result, detail, waiver_id, detected_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), options.projectId, options.gate, row.ruleKey, options.requirements.find((r) => r.ruleKey === row.ruleKey)!.layer, row.result, row.detail, row.waiverId, options.now],
    );
  }

  return { pass: rows.every((r) => r.result !== "blocked"), rows };
}

// ---------------------------------------------------------------------------
// Waivers
// ---------------------------------------------------------------------------

export interface IssueWaiverOptions {
  projectId: string;
  governanceDocId: string;
  clauseRef: string;
  reason: string;
  requestedBy: string;
  approverRole: string;
  /** ADR-0036: mandatory. Refuse to issue an indefinite waiver. */
  expiresAt: string;
  /** Approve immediately (status active) instead of leaving it pending. */
  approvedBy?: string;
  approvedAt?: string;
  now: string;
}

/**
 * File a waiver request. expiresAt is REQUIRED — an indefinite waiver is a
 * de facto repeal of the clause and the engine refuses to create one even
 * though the caller could theoretically have written NULL via raw SQL (the
 * schema also rejects it). Approval is a separate act unless approvedBy is
 * given (admin console path).
 */
export function issueWaiver(db: Database, options: IssueWaiverOptions): string {
  if (!options.expiresAt) {
    throw new Error("Waiver without expires_at refused — an indefinite waiver is a de facto repeal of its clause (ADR-0036).");
  }
  const id = ulid();
  const approved = options.approvedBy !== undefined;
  db.run(
    "INSERT INTO waiver (id, project_id, governance_doc_id, clause_ref, reason, requested_by, approver_role, approved_by, approved_at, expires_at, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      options.projectId,
      options.governanceDocId,
      options.clauseRef,
      options.reason,
      options.requestedBy,
      options.approverRole,
      options.approvedBy ?? null,
      options.approvedAt ?? null,
      options.expiresAt,
      approved ? "active" : "pending",
      options.now,
    ],
  );
  return id;
}

export interface ActiveWaiver {
  id: string;
  expires_at: string;
}

/**
 * A waiver unblocks a rule only when ALL of: status='active',
 * approved_at NOT NULL, and expires_at strictly in the future. The date
 * comparison is authoritative — a status column can be stale, an expiry
 * date cannot (ADR-0036).
 */
export function findActiveWaiver(
  db: Database,
  options: { projectId: string; governanceDocId: string; clauseRef: string; now: string },
): ActiveWaiver | null {
  const row = db
    .query(
      "SELECT id, expires_at FROM waiver WHERE project_id = ? AND governance_doc_id = ? AND clause_ref = ? AND status = 'active' AND approved_at IS NOT NULL AND expires_at > ? ORDER BY expires_at DESC LIMIT 1",
    )
    .get(options.projectId, options.governanceDocId, options.clauseRef, options.now) as ActiveWaiver | undefined;
  return row ?? null;
}

export interface WaiverConcentration {
  governanceDocId: string;
  clauseRef: string;
  count: number;
}

/**
 * FR-GOV-11: >= threshold waivers on the same clause (default 3) is an
 * amendment trigger — the clause itself is out of step with reality. This is
 * reported to the governance pipeline (policy:impact input), NOT recorded as
 * a compliance failure: the waivers were each individually valid.
 */
export function waiverConcentration(db: Database, threshold = 3): WaiverConcentration[] {
  return db
    .query(
      "SELECT governance_doc_id AS governanceDocId, clause_ref AS clauseRef, COUNT(*) AS count FROM waiver GROUP BY governance_doc_id, clause_ref HAVING COUNT(*) >= ? ORDER BY count DESC",
    )
    .all(threshold) as WaiverConcentration[];
}

// ---------------------------------------------------------------------------
// Interpretation registry
// ---------------------------------------------------------------------------

export interface RecordInterpretationOptions {
  governanceDocId: string;
  clauseRef: string;
  question: string;
  answer: string;
  askedBy: string;
  answeredBy: string;
  answeredAt: string;
  /** Earlier interpretation this answer replaces (explicit supersession). */
  supersedes?: string | null;
  published?: boolean;
}

/**
 * FR-GOV-12: record a Q&A pair. Supersession is explicit: if `supersedes`
 * is given, it must target an interpretation of the SAME doc + clause — a
 * later answer may refine an earlier one but never silently contradict an
 * answer to a different question.
 */
export function recordInterpretation(db: Database, options: RecordInterpretationOptions): string {
  if (options.supersedes) {
    const target = db
      .query("SELECT governance_doc_id, clause_ref FROM interpretation WHERE id = ?")
      .get(options.supersedes) as { governance_doc_id: string; clause_ref: string } | null;
    if (!target) {
      throw new Error(`interpretation ${options.supersedes} does not exist — cannot supersede a phantom row.`);
    }
    if (target.governance_doc_id !== options.governanceDocId || target.clause_ref !== options.clauseRef) {
      throw new Error(
        `Supersession refused: interpretation ${options.supersedes} belongs to ${target.governance_doc_id}/${target.clause_ref}, but the new answer targets ${options.governanceDocId}/${options.clauseRef} — a later answer never silently contradicts an earlier one (FR-GOV-12).`,
      );
    }
  }
  const id = ulid();
  db.run(
    "INSERT INTO interpretation (id, governance_doc_id, clause_ref, question, answer, asked_by, answered_by, answered_at, supersedes, published) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      options.governanceDocId,
      options.clauseRef,
      options.question,
      options.answer,
      options.askedBy,
      options.answeredBy,
      options.answeredAt,
      options.supersedes ?? null,
      options.published ? 1 : 0,
    ],
  );
  return id;
}

export interface InterpretationRow {
  id: string;
  clause_ref: string;
  question: string;
  answer: string;
  answered_at: string;
  supersedes: string | null;
  published: number;
}

/**
 * Search the registry: published answers first, then unpublished; within
 * each group, newest first. Callers resolve the effective answer for a
 * clause by following the supersedes chain (an answer that has been
 * superseded is history, not guidance).
 */
export function searchInterpretations(
  db: Database,
  query: { governanceDocId?: string; clauseRef?: string; text?: string },
): InterpretationRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.governanceDocId) {
    where.push("governance_doc_id = ?");
    params.push(query.governanceDocId);
  }
  if (query.clauseRef) {
    where.push("clause_ref = ?");
    params.push(query.clauseRef);
  }
  if (query.text) {
    where.push("(question LIKE ? OR answer LIKE ?)");
    const like = `%${query.text}%`;
    params.push(like, like);
  }
  const sql =
    "SELECT id, clause_ref, question, answer, answered_at, supersedes, published FROM interpretation" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY published DESC, answered_at DESC";
  return db.query(sql).all(...(params as never[])) as InterpretationRow[];
}
