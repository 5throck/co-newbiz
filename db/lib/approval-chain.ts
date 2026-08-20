// @version 1.0.0
/**
 * Two-tier approval-chain engine — design v1.0 §2-3, ADR-0028, ADR-0029,
 * FR-GOV-04..06, docs/approval-chain-spec.md.
 *
 * ADR-0028: Entity IC approval is a HARD precondition for Group-level entry.
 * Skipping the entity stage is blocked by the engine, and the block is
 * recorded explicitly in approval_chain.blocked_reason — an audit reader
 * must see WHY a group step is not_ready, not just that it is.
 *
 * ADR-0029: the Group IC is a RANKING across same-cycle proposals, not an
 * isolated approve/reject. rankGroupAgenda orders a cycle's agenda rows by
 * the three ranking inputs from rag-framework.md §6 / pilot 004 §6:
 * IRR-over-hurdle spread, RAG grade, and capital requested.
 *
 * FR-GOV-06 (pilot 003 finding F-2): `withdrawn_pending_resubmission` is a
 * decision state of its own. A proposal withdrawn pending resubmission has
 * NOT been approved — it must not open the group gate.
 */

import type { Database } from "bun:sqlite";
import { ulid } from "./ulid.ts";

export type ApprovalDecision =
  | "approved"
  | "rejected"
  | "conditional"
  | "withdrawn_pending_resubmission";

export type ApprovalStatus =
  | "not_ready"
  | "pending"
  | "approved"
  | "rejected"
  | "conditional"
  | "withdrawn_pending_resubmission";

/** Entity decisions that satisfy the ADR-0028 group-entry precondition. */
const ENTITY_ENTRY_SATISFYING: readonly ApprovalDecision[] = ["approved", "conditional"] as const;

const GATE_ENTITY_IC = "entity_ic";
const GATE_GROUP_IC = "group_ic";

function getChainRow(
  db: Database,
  projectId: string,
  level: "entity" | "group",
): {
  id: string;
  status: ApprovalStatus;
  decision: ApprovalDecision | null;
  blocked_reason: string | null;
} | null {
  return (
    (db
      .query(
        "SELECT id, status, decision, blocked_reason FROM approval_chain WHERE project_id = ? AND level = ? ORDER BY sequence DESC LIMIT 1",
      )
      .get(projectId, level) as {
      id: string;
      status: ApprovalStatus;
      decision: ApprovalDecision | null;
      blocked_reason: string | null;
    } | null) ?? null
  );
}

export interface EnsureChainOptions {
  projectId: string;
  /** Approver role recorded on the entity IC step (default "entity_ic"). */
  entityApproverRole?: string;
  /** Approver role recorded on the group IC step (default "group_ic"). */
  groupApproverRole?: string;
  now: string;
}

/**
 * Create the two-step chain (entity IC sequence 1, group IC sequence 2) if
 * absent. Idempotent — safe to call on every gate transition. Both steps
 * start `pending` for the entity step and `not_ready` for the group step;
 * enterGroupReview() flips the group step based on the entity decision.
 */
export function ensureApprovalChain(db: Database, options: EnsureChainOptions): void {
  const existing = db
    .query("SELECT level FROM approval_chain WHERE project_id = ?")
    .all(options.projectId) as { level: "entity" | "group" }[];
  const have = new Set(existing.map((r) => r.level));

  if (!have.has("entity")) {
    db.run(
      "INSERT INTO approval_chain (id, project_id, level, gate, sequence, approver_role, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        ulid(),
        options.projectId,
        "entity",
        GATE_ENTITY_IC,
        1,
        options.entityApproverRole ?? "entity_ic",
        "pending",
        options.now,
        options.now,
      ],
    );
  }
  if (!have.has("group")) {
    db.run(
      "INSERT INTO approval_chain (id, project_id, level, gate, sequence, approver_role, status, blocked_reason, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        ulid(),
        options.projectId,
        "group",
        GATE_GROUP_IC,
        2,
        options.groupApproverRole ?? "group_ic",
        "not_ready",
        "Entity IC has not approved — group-level entry is blocked (ADR-0028).",
        options.now,
        options.now,
      ],
    );
  }
}

export interface RecordDecisionOptions {
  projectId: string;
  level: "entity" | "group";
  decision: ApprovalDecision;
  decidedAt: string;
  /** Free-text conditions when decision = 'conditional' (recommended). */
  conditions?: string;
  now: string;
}

export interface RecordDecisionResult {
  status: ApprovalStatus;
  /** Side effect on the other level's row, if any. */
  groupGate: { opened: boolean; status: ApprovalStatus } | null;
}

/**
 * Record an IC decision. The decision column and the status column carry the
 * same four-state value (except not_ready/pending, which are pre-decision
 * statuses). A satisfying entity decision (approved / conditional)
 * immediately opens the group gate; a non-satisfying one keeps it blocked
 * with the reason updated to cite the actual decision.
 */
export function recordDecision(db: Database, options: RecordDecisionOptions): RecordDecisionResult {
  const row = getChainRow(db, options.projectId, options.level);
  if (!row) {
    throw new Error(
      `No approval_chain row for project ${options.projectId} at level '${options.level}' — call ensureApprovalChain() first.`,
    );
  }
  db.run(
    "UPDATE approval_chain SET decision = ?, status = ?, decided_at = ?, conditions = ?, updated_at = ? WHERE id = ?",
    [
      options.decision,
      options.decision,
      options.decidedAt,
      options.conditions ?? null,
      options.now,
      row.id,
    ],
  );

  let groupGate: RecordDecisionResult["groupGate"] = null;
  if (options.level === "entity") {
    const entered = enterGroupReview(db, { projectId: options.projectId, now: options.now });
    const group = getChainRow(db, options.projectId, "group");
    groupGate = { opened: entered.entered, status: group?.status ?? "not_ready" };
  }
  return { status: options.decision, groupGate };
}

export interface EnterGroupReviewOptions {
  projectId: string;
  now: string;
}

export interface EnterGroupReviewResult {
  /** True when group-level entry is allowed (entity decision satisfies ADR-0028). */
  entered: boolean;
  status: ApprovalStatus;
  blockedReason: string | null;
}

/**
 * FR-GOV-04 / ADR-0028 gate. Attempt to move the project into group-level
 * review:
 *   - entity decision approved / conditional  -> group step becomes pending
 *   - entity decision missing                -> blocked, reason recorded
 *   - rejected                               -> blocked, reason recorded
 *   - withdrawn_pending_resubmission         -> blocked, reason recorded
 *     (FR-GOV-06: withdraw-and-re-propose is NOT an approval — pilot 003
 *     Doosan finding F-2. A resubmission starts a new entity decision.)
 */
export function enterGroupReview(db: Database, options: EnterGroupReviewOptions): EnterGroupReviewResult {
  const group = getChainRow(db, options.projectId, "group");
  if (!group) {
    throw new Error(
      `No group approval_chain row for project ${options.projectId} — call ensureApprovalChain() first.`,
    );
  }
  const entity = getChainRow(db, options.projectId, "entity");
  const entityDecision = entity?.decision ?? null;

  if (entityDecision !== null && ENTITY_ENTRY_SATISFYING.includes(entityDecision)) {
    db.run(
      "UPDATE approval_chain SET status = 'pending', blocked_reason = NULL, updated_at = ? WHERE id = ?",
      [options.now, group.id],
    );
    return { entered: true, status: "pending", blockedReason: null };
  }

  const reason =
    entityDecision === null
      ? "Entity IC has not decided — group-level entry is blocked (ADR-0028)."
      : entityDecision === "withdrawn_pending_resubmission"
        ? "Entity IC decision is withdrawn_pending_resubmission — withdrawal is not approval; the project must be re-decided at entity level before group entry (FR-GOV-06, pilot 003 F-2)."
        : `Entity IC decision is '${entityDecision}' — group-level entry is blocked (ADR-0028).`;
  db.run(
    "UPDATE approval_chain SET status = 'not_ready', blocked_reason = ?, updated_at = ? WHERE id = ?",
    [reason, options.now, group.id],
  );
  return { entered: false, status: "not_ready", blockedReason: reason };
}

export interface SubmitToAgendaOptions {
  projectId: string;
  cycle: string;
  /** Submitting entity — an md_entity(id) value (FK enforced). */
  entityId: string;
  capitalRequest: number;
  /** IRR-over-hurdle spread in percentage points — ranking input #1. */
  irrOverHurdlePp: number | null;
  /** Current overall RAG grade — ranking input #2. */
  ragGrade: "green" | "amber" | "red" | null;
  submittedAt: string;
}

/**
 * Submit an entity-approved project to a group agenda cycle. Guarded by the
 * same ADR-0028 precondition as group entry — an agenda row for a project
 * whose group gate is blocked would let it rank anyway, which would make the
 * block decorative.
 */
export function submitToGroupAgenda(db: Database, options: SubmitToAgendaOptions): string {
  const group = getChainRow(db, options.projectId, "group");
  if (!group || group.status === "not_ready") {
    throw new Error(
      `Project ${options.projectId} cannot join group agenda cycle '${options.cycle}': entity IC approval precondition not met (ADR-0028)${group?.blocked_reason ? ` — ${group.blocked_reason}` : "."}`,
    );
  }
  const id = ulid();
  db.run(
    "INSERT INTO group_agenda (id, cycle, project_id, entity_id, submitted_at, capital_request, irr_over_hurdle_pp, rag_grade) VALUES (?,?,?,?,?,?,?,?)",
    [
      id,
      options.cycle,
      options.projectId,
      options.entityId,
      options.submittedAt,
      options.capitalRequest,
      options.irrOverHurdlePp,
      options.ragGrade,
    ],
  );
  return id;
}

export interface RankedAgendaRow {
  id: string;
  project_id: string;
  capital_request: number;
  irr_over_hurdle_pp: number | null;
  rag_grade: "green" | "amber" | "red" | null;
  priority_rank: number | null;
}

/**
 * ADR-0029 ranking for one cycle. Sort policy (rag-framework.md §6):
 *   1. Red-graded proposals rank LAST regardless of financials — a Red
 *      project cannot out-rank an Amber one on IRR alone (FR-RAG-01 in the
 *      ranking context).
 *   2. IRR-over-hurdle spread, descending (value over the bar wins).
 *   3. Capital requested, descending (bigger asks compete first for the
 *      same scarce pool — the group IC's core question).
 *   4. Submitted earlier wins (ties broken by queue order).
 * Writes priority_rank 1..N and returns the ordered rows. This ranking is a
 * DECISION-SUPPORT ordering: the group IC (humans) may override it, and the
 * override is recorded in group_agenda.rationale.
 */
export function rankGroupAgenda(db: Database, cycle: string): RankedAgendaRow[] {
  const rows = db
    .query(
      "SELECT id, project_id, capital_request, irr_over_hurdle_pp, rag_grade, priority_rank FROM group_agenda WHERE cycle = ?",
    )
    .all(cycle) as RankedAgendaRow[];

  const sorted = [...rows].sort((a, b) => {
    const redA = a.rag_grade === "red" ? 1 : 0;
    const redB = b.rag_grade === "red" ? 1 : 0;
    if (redA !== redB) return redA - redB; // non-Red first
    const irrA = a.irr_over_hurdle_pp ?? Number.NEGATIVE_INFINITY;
    const irrB = b.irr_over_hurdle_pp ?? Number.NEGATIVE_INFINITY;
    if (irrA !== irrB) return irrB - irrA; // higher spread first
    if (a.capital_request !== b.capital_request) return b.capital_request - a.capital_request;
    return 0; // stable sort keeps submission order for full ties
  });

  sorted.forEach((row, index) => {
    db.run("UPDATE group_agenda SET priority_rank = ? WHERE id = ?", [index + 1, row.id]);
    row.priority_rank = index + 1;
  });
  return sorted;
}
