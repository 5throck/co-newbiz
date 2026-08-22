/**
 * @version 1.0.0
 * project_industry repository — the governance-controlled write path ADR-0054
 * Decision 5 deferred to this PR (the 0013 precedent: schema and write path
 * land separately; see ADR-0056). db/lib/snapshot-filler.ts (1.1.0) remains
 * the single reader — live = superseded_by IS NULL is the reader contract.
 *
 * Layering doctrine (same as classification.repository.ts): DB CHECKs and
 * indexes constrain SHAPE (append-only rows, partial unique live slot,
 * rationale NOT NULL); this repository enforces GOVERNANCE — active
 * membership (FR-SEC-08 via requireActiveMember), insider status on MNPI
 * projects (FR-SEC-06 via requireInsiderIfMnpi), and write logging
 * (appendAudit + logDataAccess). A raw INSERT can bypass the governance
 * layer at the SQL level, but this file is the only project_industry writer
 * application code may import.
 *
 * Semantics (ADR-0056):
 *   - bind(different industry)  → plain append; multiple DISTINCT live
 *     industries per project are legal (0021 header) — the multi-industry
 *     consequence is decided at read time by the filler, not banned here.
 *   - bind(same industry, live) → re-bind via the classification supersede
 *     sequence: successor born non-live → predecessor retires → successor
 *     goes live (the reverse order trips idx_project_industry_live).
 *   - retire                    → born-dead self-superseded successor: the
 *     retire marker row is inserted with superseded_by = its own id (born
 *     non-live, never goes live — classification's third step is skipped
 *     deliberately), then the target row's superseded_by is pointed at it.
 *     The marker carries who/when/why of the unbind, so "which industries
 *     did this project review against last quarter" stays answerable.
 */
import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";
import { appendAudit, logDataAccess, requireActiveMember, requireInsiderIfMnpi } from "../lib/access-control.ts";

const SELECT_ROW = "SELECT id, project_id, industry_id, bound_by, bound_at, rationale, superseded_by FROM project_industry WHERE id = ?";
const SELECT_LIVE_FOR_INDUSTRY =
  "SELECT id, project_id, industry_id, bound_by, bound_at, rationale, superseded_by FROM project_industry WHERE project_id = ? AND industry_id = ? AND superseded_by IS NULL";

export interface ProjectIndustryRow {
  id: string;
  project_id: string;
  industry_id: string;
  bound_by: string;
  bound_at: string;
  rationale: string;
  superseded_by: string | null;
}

export interface BindIndustryInput {
  project_id: string;
  industry_id: string;
  bound_by: string;
  rationale: string;
  /** Caller-supplied for tests / deterministic ids; ulid() otherwise. */
  id?: string;
  now?: string;
}

export interface RetireIndustryInput {
  project_id: string;
  industry_id: string;
  retired_by: string;
  rationale: string;
  id?: string;
  now?: string;
}

interface WriteGuardInput {
  project_id: string;
  industry_id: string;
  actor: string;
  rationale: string;
  now?: string;
}

/**
 * All governance checks run BEFORE the transaction opens (the
 * classification.repository.ts discipline): by the time anything is written,
 * every rejection has already happened, so no partial state is reachable.
 */
function checkProjectIndustryWrite(db: ReturnType<typeof getDb>, input: WriteGuardInput): string {
  const now = input.now ?? new Date().toISOString();

  if (!input.rationale?.trim()) {
    throw new Error(
      "project_industry_write_rejected: rationale is mandatory on every row — a binding is a judged claim, and who judged it and why are inseparable (migration 0021 header).",
    );
  }

  const project = db.query("SELECT id FROM md_project WHERE id = ?").get(input.project_id) as { id: string } | null;
  if (!project) {
    throw new Error(`project_industry_write_rejected: project '${input.project_id}' does not exist (md_project).`);
  }
  const industry = db.query("SELECT id FROM md_industry WHERE id = ?").get(input.industry_id) as { id: string } | null;
  if (!industry) {
    throw new Error(`project_industry_write_rejected: industry '${input.industry_id}' does not exist (md_industry).`);
  }

  // FR-SEC-08 + FR-SEC-06: active membership always; current insider status
  // at write time on MNPI projects.
  requireActiveMember(db, input.project_id, input.actor);
  requireInsiderIfMnpi(db, input.project_id, input.actor);

  return now;
}

function insertRow(
  db: ReturnType<typeof getDb>,
  input: { id: string; project_id: string; industry_id: string; actor: string; now: string; rationale: string },
  bornNonLiveAgainst: string | null,
): void {
  db.run(
    "INSERT INTO project_industry (id, project_id, industry_id, bound_by, bound_at, rationale, superseded_by) VALUES (?,?,?,?,?,?,?)",
    [input.id, input.project_id, input.industry_id, input.actor, input.now, input.rationale, bornNonLiveAgainst],
  );
}

/**
 * Binds a project to a target-market industry. Binding a DIFFERENT industry
 * while others are live is legal (multi-industry targets are real); binding
 * the SAME industry as a live row is a re-bind that supersedes in place,
 * keeping the full history.
 */
export function bindIndustry(input: BindIndustryInput, db: ReturnType<typeof getDb> = getDb()): ProjectIndustryRow {
  const now = checkProjectIndustryWrite(db, { ...input, actor: input.bound_by });

  const predecessor = db.query(SELECT_LIVE_FOR_INDUSTRY).get(input.project_id, input.industry_id) as
    | ProjectIndustryRow
    | undefined;
  const id = input.id ?? ulid();

  db.transaction(() => {
    if (predecessor) {
      // Re-bind — the classification supersede sequence (0013). Inserting
      // the successor live-first would violate idx_project_industry_live
      // while the predecessor still occupies the slot; the reverse order
      // (predecessor retires first) would orphan the slot if the insert
      // failed mid-transaction. Born non-live → retire → go live.
      insertRow(db, { ...input, id, actor: input.bound_by, now }, predecessor.id);
      db.run("UPDATE project_industry SET superseded_by = ? WHERE id = ?", [id, predecessor.id]);
      db.run("UPDATE project_industry SET superseded_by = NULL WHERE id = ?", [id]);
    } else {
      insertRow(db, { ...input, id, actor: input.bound_by, now }, null);
    }
    logDataAccess(db, {
      userId: input.bound_by,
      tableKey: "project_industry",
      recordRef: `${input.project_id}:${id}`,
      projectId: input.project_id,
      action: "write",
      at: now,
    });
    appendAudit(db, {
      actor: input.bound_by,
      action: predecessor ? "project_industry_rebound" : "project_industry_bound",
      target: `${input.project_id}:${input.industry_id}`,
      now,
    });
  })();

  return db.query(SELECT_ROW).get(id) as ProjectIndustryRow;
}

/**
 * Unbinds a live binding via the born-dead self-superseded successor
 * convention (ADR-0056, resolving ADR-0054 Decision 5). Returns the retire
 * marker row — `superseded_by === id` is its signature, and its rationale
 * records why the binding ended.
 */
export function retireIndustry(input: RetireIndustryInput, db: ReturnType<typeof getDb> = getDb()): ProjectIndustryRow {
  const now = checkProjectIndustryWrite(db, { ...input, actor: input.retired_by });

  const live = db.query(SELECT_LIVE_FOR_INDUSTRY).get(input.project_id, input.industry_id) as
    | ProjectIndustryRow
    | undefined;
  if (!live) {
    throw new Error(
      `project_industry_write_rejected: project '${input.project_id}' has no live binding for industry '${input.industry_id}' — nothing to retire.`,
    );
  }
  const id = input.id ?? ulid();

  db.transaction(() => {
    // Born-dead: superseded_by = own id at INSERT. Non-null, so the partial
    // live index never sees this row as live; the self-FK resolves because
    // ids are caller-supplied (or ulid()) before the statement runs. This
    // row never goes live — the whole point is an append-only record of the
    // unbind, not a replacement binding.
    insertRow(db, { ...input, id, actor: input.retired_by, now }, id);
    db.run("UPDATE project_industry SET superseded_by = ? WHERE id = ?", [id, live.id]);
    logDataAccess(db, {
      userId: input.retired_by,
      tableKey: "project_industry",
      recordRef: `${input.project_id}:${id}`,
      projectId: input.project_id,
      action: "write",
      at: now,
    });
    appendAudit(db, {
      actor: input.retired_by,
      action: "project_industry_retired",
      target: `${input.project_id}:${input.industry_id}`,
      now,
    });
  })();

  return db.query(SELECT_ROW).get(id) as ProjectIndustryRow;
}

/** The live (superseded_by IS NULL) bindings of a project — the filler's default fact-family industry set. */
export function getLiveBindings(projectId: string, db: ReturnType<typeof getDb> = getDb()): ProjectIndustryRow[] {
  return db
    .query(
      "SELECT id, project_id, industry_id, bound_by, bound_at, rationale, superseded_by FROM project_industry WHERE project_id = ? AND superseded_by IS NULL ORDER BY bound_at DESC, id DESC",
    )
    .all(projectId) as ProjectIndustryRow[];
}
