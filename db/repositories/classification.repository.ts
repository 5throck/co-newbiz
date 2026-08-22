// @version 1.1.0
/**
 * Classification repository — the single write path for
 * `project_case_classification` rows (PR-5b, design of record
 * docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md
 * Decision 5a, ADR-0047 §1).
 *
 * LAYERING (same doctrine as the certification repository): the DB CHECKs
 * from migration 0013 constrain SHAPE (enum values, one live row per
 * project); THIS layer enforces GOVERNANCE — the Decision-5a authority
 * asymmetry, FR-SEC-08 membership, FR-SEC-06 insider status, and write
 * logging. A raw INSERT bypassing this file can still land an approval-free
 * internal-origin row at the SQL level; every code caller cannot, because
 * this is the only writer the application layer is allowed to import
 * (constraint: no route/MCP/CLI writes around it).
 *
 * DECISION 5a — the asymmetry, and why it is enforced HERE:
 *   origin='external' only WIDENS the validator set → single-writer with a
 *   mandatory rationale.
 *   origin ∈ {internal, hybrid, joint} REDUCES the validator set → such a
 *   row is a waiver with none of a waiver's controls unless the repository
 *   prices it like one: approver_role at process-governance-manager
 *   authority or higher, plus approved_by (a DIFFERENT active member) and
 *   approved_at. Missing any one of the three → named error, no partial
 *   state (all checks run before the transaction opens).
 * Downgrade protection: superseding a live external row with a
 * reducing-type origin needs the full approval set on the NEW row even
 * though the OLD row was single-writer — the validator set narrows at the
 * moment of supersession, so that is the moment the control must fire.
 */

import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";
import { appendAudit, logDataAccess, requireActiveMember, requireInsiderIfMnpi } from "../lib/access-control.ts";
// The PR-5c wiring below is the other half of the ONE deliberate import
// cycle in the db layer (compliance.repository.ts imports isReducingOrigin
// from this file). Both sides use the other's binding only inside functions,
// so ESM live bindings resolve it after both modules initialize.
import { invalidateNotApplicable } from "./compliance.repository.ts";

export interface ClassificationRow {
  id: string;
  project_id: string;
  case_type: "greenfield" | "brownfield";
  origin: "internal" | "external" | "hybrid" | "joint";
  technology_track: "none" | "rbd";
  classified_by: string;
  approver_role: string | null;
  approved_by: string | null;
  approved_at: string | null;
  classified_at: string;
  rationale: string;
  superseded_by: string | null;
}

/** Origins that REDUCE the validator set (Decision 5a's controlled direction). */
export const REDUCING_ORIGINS = ["internal", "hybrid", "joint"] as const;
export type ReducingOrigin = (typeof REDUCING_ORIGINS)[number];

export function isReducingOrigin(origin: string): origin is ReducingOrigin {
  return (REDUCING_ORIGINS as readonly string[]).includes(origin);
}

/**
 * Role-authority list for classification approval — Decision 5a's floor is
 * process-governance-manager; the two entries above it are the authorities
 * governance-operations.md §2/§5 already establishes as HIGHER (Group IC
 * approves regulation-layer waivers; the PM approves change plans over the
 * domain leads). An ordered list, not a free string: issueWaiver() takes
 * approverRole as free text and that is the exact weakness Decision 5a
 * refuses to copy. If this roster ever grows beyond these three, that is a
 * governance-model change — write an ADR before extending it.
 */
export const CLASSIFICATION_APPROVER_AUTHORITY = [
  "process-governance-manager", // procedure-layer owner (governance-operations §2)
  "pm", // New Business Review Lead — approves change plans over the domain leads (§5)
  "group_ic", // regulation-layer waiver authority — outranks the procedure layer (§2)
] as const;

export type ClassificationApproverRole = (typeof CLASSIFICATION_APPROVER_AUTHORITY)[number];

export function hasClassificationApprovalAuthority(role: string): role is ClassificationApproverRole {
  return (CLASSIFICATION_APPROVER_AUTHORITY as readonly string[]).includes(role);
}

export interface ClassificationApproval {
  approver_role: string;
  approved_by: string;
  approved_at: string;
}

export interface ClassifyInput {
  project_id: string;
  case_type: "greenfield" | "brownfield";
  origin: "internal" | "external" | "hybrid" | "joint";
  technology_track?: "none" | "rbd";
  classified_by: string;
  rationale: string;
  /** Required (and only meaningful) when origin reduces the validator set. */
  approval?: ClassificationApproval;
  now?: string;
}

const SELECT_ROW = `SELECT id, project_id, case_type, origin, technology_track,
  classified_by, approver_role, approved_by, approved_at, classified_at, rationale, superseded_by
  FROM project_case_classification WHERE id = ?`;

const SELECT_LIVE = `SELECT id, project_id, case_type, origin, technology_track,
  classified_by, approver_role, approved_by, approved_at, classified_at, rationale, superseded_by
  FROM project_case_classification WHERE project_id = ? AND superseded_by IS NULL`;

/**
 * Decision 5a + FR-SEC-06/08 gate, shared by classify() and supersede().
 * Runs BEFORE any transaction opens so a rejected write leaves zero partial
 * state. Returns the approver trio normalized for the INSERT (null for the
 * widening direction — approval columns on an external row would be noise).
 */
function checkClassificationWrite(
  db: ReturnType<typeof getDb>,
  input: ClassifyInput
): { approval: ClassificationApproval | null; now: string } {
  const now = input.now ?? new Date().toISOString();

  if (!input.rationale?.trim()) {
    throw new Error(
      "classification_write_rejected: rationale is mandatory for every classification — an unexplained classification is unauditable (Decision 5a).",
    );
  }

  // FR-SEC-08 + FR-SEC-06: the acting user must be an active member, and on
  // an MNPI project a current insider (live list, checked at write time).
  requireActiveMember(db, input.project_id, input.classified_by);
  requireInsiderIfMnpi(db, input.project_id, input.classified_by);

  if (!isReducingOrigin(input.origin)) {
    return { approval: null, now };
  }

  const a = input.approval;
  if (!a || !a.approver_role?.trim() || !a.approved_by?.trim() || !a.approved_at?.trim()) {
    const missing = !a || !a.approver_role?.trim() ? "approver_role" : !a.approved_by?.trim() ? "approved_by" : "approved_at";
    throw new Error(
      `classification_write_rejected: origin='${input.origin}' reduces the validator set — two-party approval is mandatory (Decision 5a: priced at no less than a waiver) and '${missing}' is missing.`,
    );
  }
  if (!hasClassificationApprovalAuthority(a.approver_role)) {
    throw new Error(
      `classification_write_rejected: approver_role '${a.approver_role}' lacks classification approval authority — Decision 5a requires process-governance-manager authority or higher (${CLASSIFICATION_APPROVER_AUTHORITY.join(", ")}).`,
    );
  }
  if (a.approved_by === input.classified_by) {
    throw new Error(
      `classification_write_rejected: approved_by must be a project_member DISTINCT from classified_by ('${input.classified_by}') — one person approving their own validator-set reduction is the single-writer write this control exists to prevent (Decision 5a).`,
    );
  }
  requireActiveMember(db, input.project_id, a.approved_by);
  // The approver sees the classification payload by approving it — MNPI
  // projects require insider status here too, for the same write-time-check
  // reason as the acting user.
  requireInsiderIfMnpi(db, input.project_id, a.approved_by);

  return { approval: a, now };
}

function insertClassificationRow(
  db: ReturnType<typeof getDb>,
  input: ClassifyInput,
  approval: ClassificationApproval | null,
  now: string,
  supersededBy: string | null
): string {
  const id = ulid();
  db.run(
    `INSERT INTO project_case_classification
       (id, project_id, case_type, origin, technology_track, classified_by,
        approver_role, approved_by, approved_at, classified_at, rationale, superseded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      input.project_id,
      input.case_type,
      input.origin,
      input.technology_track ?? "none",
      input.classified_by,
      approval?.approver_role ?? null,
      approval?.approved_by ?? null,
      approval?.approved_at ?? null,
      now,
      input.rationale,
      supersededBy,
    ]
  );
  return id;
}

/** The live (superseded_by IS NULL) classification row, or null when unclassified. */
export function getLiveClassification(projectId: string, db: ReturnType<typeof getDb> = getDb()): ClassificationRow | null {
  return (db.query(SELECT_LIVE).get(projectId) as ClassificationRow | undefined) ?? null;
}

/**
 * Write a project's FIRST classification. A live row already existing is an
 * error, not an overwrite — re-classification has exactly one legal path
 * (supersede()), which is what keeps the append-only history complete.
 */
export function classify(input: ClassifyInput, db: ReturnType<typeof getDb> = getDb()): ClassificationRow {
  const existing = getLiveClassification(input.project_id, db);
  if (existing) {
    throw new Error(
      `classification_write_rejected: project '${input.project_id}' already has a live classification (${existing.id}, origin='${existing.origin}') — supersede() is the only legal re-classification path; classify() never overwrites (append-only history, Decision 5b).`,
    );
  }

  const { approval, now } = checkClassificationWrite(db, input);
  let id = "";
  db.transaction(() => {
    id = insertClassificationRow(db, input, approval, now, null);
    logDataAccess(db, {
      userId: input.classified_by,
      tableKey: "project_case_classification",
      recordRef: `${input.project_id}:${id}`,
      projectId: input.project_id,
      action: "write",
      at: now,
    });
    appendAudit(db, {
      actor: input.classified_by,
      action: "case_classified",
      target: `${input.project_id}:${input.case_type}/${input.origin}/${input.technology_track ?? "none"}`,
      now,
    });
  })();
  return db.query(SELECT_ROW).get(id) as ClassificationRow;
}

/**
 * Re-classify: append the successor and retire the live predecessor in ONE
 * transaction, in the single legal statement order migration 0013 documents
 * (its test file proves the reverse order trips the partial unique index):
 *
 *   1. successor is BORN NON-LIVE — INSERT with superseded_by = predecessor
 *      id, so idx_case_classification_live (partial, WHERE superseded_by IS
 *      NULL) does not fire on the insert;
 *   2. predecessor RETIRES — UPDATE its superseded_by to the successor id,
 *      freeing the live slot (its self-FK is satisfied: the successor
 *      exists);
 *   3. successor GOES LIVE — UPDATE its superseded_by to NULL, claiming the
 *      freed slot.
 *
 * Reversing steps 2 and 3 fails: the successor going live while the
 * predecessor still occupies the (project) slot trips the partial unique
 * index — the database itself rejects any other order, which is why the
 * sequence is a fact about the schema, not a convention of this file.
 *
 * (4) not_applicable invalidation sweep (PR-5c, ADR-0048 §5, constraint 4):
 * once the successor is live, every live not_applicable compliance row of
 * the project is marked invalidated IN THIS SAME TRANSACTION — a skip can
 * never outlive the classification that justified it, and a reclassification
 * plus the retirement of its skips is one atomic event. The affected
 * validators re-enter the required set on the next completeness evaluation.
 *
 * Downgrade protection (constraint 5): the Decision-5a checks run against
 * the NEW row regardless of what the OLD row was — superseding a live
 * external classification with a reducing origin still needs the full
 * approval trio.
 */
export function supersede(input: ClassifyInput, db: ReturnType<typeof getDb> = getDb()): ClassificationRow {
  const predecessor = getLiveClassification(input.project_id, db);
  if (!predecessor) {
    throw new Error(
      `classification_write_rejected: project '${input.project_id}' has no live classification to supersede — classify() writes the first row (append-only history, Decision 5b).`,
    );
  }

  const { approval, now } = checkClassificationWrite(db, input);
  let id = "";
  db.transaction(() => {
    // (1) successor born non-live
    id = insertClassificationRow(db, input, approval, now, predecessor.id);
    // (2) predecessor retires — frees the live slot
    db.run("UPDATE project_case_classification SET superseded_by = ? WHERE id = ?", [id, predecessor.id]);
    // (3) successor goes live — claims the freed slot
    db.run("UPDATE project_case_classification SET superseded_by = NULL WHERE id = ?", [id]);
    // (4) skips retired with their justification (same transaction — ADR-0048 §5)
    invalidateNotApplicable(db, {
      project_id: input.project_id,
      retired_classification_id: predecessor.id,
      superseded_by_classification_id: id,
      actor: input.classified_by,
      now,
    });
    logDataAccess(db, {
      userId: input.classified_by,
      tableKey: "project_case_classification",
      recordRef: `${input.project_id}:${id}`,
      projectId: input.project_id,
      action: "write",
      at: now,
    });
    appendAudit(db, {
      actor: input.classified_by,
      action: "case_reclassified",
      target: `${input.project_id}:${predecessor.origin}->${input.origin}`,
      now,
    });
  })();
  return db.query(SELECT_ROW).get(id) as ClassificationRow;
}
