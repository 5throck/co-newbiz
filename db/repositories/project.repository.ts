// @version 1.2.0
/**
 * Project repository — the reference implementation of the deny-by-default
 * access pattern (FR-SEC-01/02/03/04/06, docs/security/security-model.md §2).
 *
 * RULE: every read here takes a `callerId` and filters through
 * `project_member` — there is no function that returns project data without
 * an explicit membership check. `admin` role is NOT special-cased here on
 * purpose: system-administration privilege never implies deal-data
 * visibility (FR-SEC-02). Every other repository in this codebase must
 * follow this same shape — this file is the pattern other repositories are
 * reviewed against, not just an example.
 *
 * v1.1.0 (Wave 5.5) adds two enforcements at this same layer:
 *   - wall_group exclusion (FR-SEC-04): a user whose app_user.wall_group
 *     equals a project's classification wall_group is walled off from it,
 *     membership row or not — an information wall overrides membership;
 *   - MNPI read logging (FR-SEC-06): every read that returns an
 *     mnpi_flag=1 project writes data_access_log, so "every access logged"
 *     holds because the enforcement layer itself logs, not because every
 *     caller remembers to.
 *
 * Membership WRITE operations live in db/lib/access-control.ts (grant /
 * revoke with mandatory need-to-know basis, insider-list maintenance, and
 * audit) — deliberately NOT here, so there is exactly one write path and it
 * cannot skip the basis check.
 */

import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";
import { appendAudit, grantProjectMembership, logDataAccess } from "../lib/access-control.ts";

export interface ProjectRow {
  id: string;
  project_no: string;
  created_at: string;
  /** Wave B1 lifecycle: explicit operator state, distinct from derived KILL gate verdicts. */
  status?: "open" | "closed" | "archived";
  closed_at?: string | null;
  closure_reason?: string | null;
  /** 0013 classification vocabulary — set at promotion (ADR-0095); the definitive value is classified on project_classification. */
  origin?: string | null;
  /** greenfield/brownfield snapshot of the opportunity's route decision at promotion time (ADR-0095). */
  track?: "greenfield" | "brownfield" | null;
  /** The opportunity this project was promoted from (null for pre-promotion projects). */
  source_opportunity_id?: string | null;
  /** ADR-0104 — charter: display name + structured sections + KPI pre-commit (built at promotion, amendable). */
  project_name?: string | null;
  charter_json?: string | null;
  charter_confirmed_at?: string | null;
  /** 0081 deletion mark — set when the deal is tombstoned (still fully stored). */
  deleted_at?: string | null;
  deleted_by?: string | null;
  delete_reason?: string | null;
  /** Wave D2: derived market-evidence freshness signal, never stored on md_project. */
  is_stale?: boolean;
  stale_reasons?: string[];
}

/**
 * Typed failure of promoteOpportunity — `code` is what the API layer maps to
 * HTTP statuses (not_found → 404, already_promoted / precondition_failed → 400),
 * so the route never has to string-match error messages.
 */
export class PromotionError extends Error {
  constructor(
    public code: "not_found" | "already_promoted" | "precondition_failed",
    message: string,
  ) {
    super(message);
  }
}

/** A promoted project row, as returned by promoteOpportunity. */
export interface PromotedProject {
  project: ProjectRow;
  opportunityId: string;
  promotedAt: string;
}

interface PromotionSourceRow {
  id: string;
  project_id: string | null;
  track: "greenfield" | "brownfield" | null;
}

interface GreenfieldAssessmentCheck {
  capability_gaps_json: string | null;
  entry_strategy: string | null;
  alternatives_considered: string | null;
}

/**
 * Promotion preconditions — the API checks FACTS, not judgements (ADR-0095 §1):
 * promotion decides nothing, the fs/dd/entity_ic/group_ic gates stay
 * human-authority (ADR-0053). Each check verifies that the PRIOR STAGE'S WORK
 * EXISTS, never that a human approved an outcome:
 *
 *   - greenfield → S5 completion satisfied: the latest greenfield_assessment row
 *     for the opportunity (0056) has ≥1 capability gap, an entry strategy, and
 *     the alternatives considered — exactly the S5 completion criteria that
 *     app/web-next/lib/process-flow.ts evaluates (evaluateOpportunityStage S5).
 *
 *   - brownfield → an S7 Short List exists: at least one brownfield_target row
 *     (0055) for the opportunity with status='shortlisted' — i.e. a candidate
 *     survived target screening, per the 0062 target-universe work. Excluded
 *     candidates never satisfy this, and no ranking quality is judged here.
 *
 * Both tracks additionally require an S4 route_decision to exist, because the
 * project's `track` snapshot is copied from it — promotion without a track
 * would leave S8–S12 surfaces unable to pick their procedure set.
 */
function assertPromotionPreconditions(db: ReturnType<typeof getDb>, opp: PromotionSourceRow): void {
  if (!opp.track) {
    throw new PromotionError(
      "precondition_failed",
      "No route_decision exists for this opportunity — the S4 track decision (greenfield/brownfield) is required before promotion (S8+ surfaces key off the track).",
    );
  }
  if (opp.track === "greenfield") {
    const a = db
      .query(
        `SELECT capability_gaps_json, entry_strategy, alternatives_considered
         FROM greenfield_assessment WHERE opportunity_id = ? ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(opp.id) as GreenfieldAssessmentCheck | undefined;
    let gapCount = 0;
    try {
      gapCount = a?.capability_gaps_json ? (JSON.parse(a.capability_gaps_json) as unknown[]).length : 0;
    } catch {
      /* unparseable = empty */
    }
    if (!a || gapCount === 0 || !a.entry_strategy || !a.alternatives_considered) {
      throw new PromotionError(
        "precondition_failed",
        "Greenfield S5 completion is not satisfied — greenfield_assessment needs ≥1 capability gap, an entry strategy, and the alternatives considered (flow.spec S5 completionCriteria).",
      );
    }
  } else {
    const shortlisted = db
      .query("SELECT COUNT(*) AS c FROM brownfield_target WHERE opportunity_id = ? AND status = 'shortlisted'")
      .get(opp.id) as { c: number };
    if (shortlisted.c === 0) {
      throw new PromotionError(
        "precondition_failed",
        "Brownfield S7 Short List does not exist — at least one brownfield_target with status='shortlisted' is required before promotion (flow.spec S7).",
      );
    }
  }
}

/**
 * Promote an opportunity to a project (ADR-0095) — the single procedure that
 * turns the S1–S7 opportunity carrier into the S8–S12 project carrier.
 *
 * ZERO-MEMBER-INVISIBILITY RATIONALE: under the deny-by-default access model
 * (FR-SEC-01) a project with zero active members is permanently invisible —
 * every read in this repository filters through project_member. The membership
 * grant (step 3) therefore MUST commit atomically with the project insert; a
 * promotion that committed without it would create a project nobody, including
 * its promoter, could ever read back. The grant itself goes through
 * grantProjectMembership in db/lib/access-control.ts — the single membership
 * write path that enforces the mandatory need-to-know basis and rejects phantom
 * accounts (FR-SEC-08) — promotion calls it, it does not inline its own
 * membership INSERT.
 *
 * Single transaction, in order:
 *   1. md_project insert (ULID id, generated project_no, track snapshot from the
 *      opportunity's latest route_decision, source_opportunity_id);
 *   2. opportunity update — project_id set, promoted_at stamped;
 *   3. grantProjectMembership — promoter as `lead`, mandatory needToKnowBasis;
 *   4. appendAudit (opportunity_promoted).
 *
 * An already-promoted opportunity (project_id set) is rejected, not silently
 * idempotent — a second promotion would be a data-integrity event worth
 * surfacing (ADR-0095 §4).
 *
 * project_no note: no minting convention exists in the codebase (createProject
 * takes the number from its caller; fixtures use `NP-<suffix>`). Promotion
 * mints `PRJ-<last 6 ULID chars>` — unique by construction, no sequence table
 * added in this phase.
 */
export function promoteOpportunity(
  opportunityId: string,
  opts: {
    promotedBy: string;
    needToKnowBasis: string;
    origin?: "internal" | "external" | "hybrid" | "joint";
    /** ADR-0104 charter — display name + structured charter JSON built by lib/project-charter.ts. */
    projectName?: string;
    charterJson?: string;
  },
): PromotedProject {
  if (!opts.needToKnowBasis?.trim()) {
    throw new PromotionError("precondition_failed", "needToKnowBasis is mandatory — the promoter's membership grant needs a recorded basis (FR-SEC-01).");
  }
  const db = getDb();
  const now = new Date().toISOString();

  const run = db.transaction((): PromotedProject => {
    const opp = db
      .query("SELECT id, project_id FROM opportunity WHERE id = ?")
      .get(opportunityId) as PromotionSourceRow | undefined;
    if (!opp) {
      throw new PromotionError("not_found", `opportunity '${opportunityId}' not found.`);
    }
    if (opp.project_id) {
      throw new PromotionError("already_promoted", `opportunity '${opportunityId}' is already promoted to project '${opp.project_id}'.`);
    }

    const route = db
      .query("SELECT track FROM route_decision WHERE opportunity_id = ? ORDER BY decided_at DESC, id DESC LIMIT 1")
      .get(opportunityId) as { track: "greenfield" | "brownfield" } | undefined;
    const track = route?.track ?? null;
    assertPromotionPreconditions(db, { id: opp.id, project_id: opp.project_id, track });

    const id = ulid();
    const row: ProjectRow = {
      id,
      project_no: `PRJ-${id.slice(-6)}`,
      created_at: now,
      origin: opts.origin ?? null,
      track,
      source_opportunity_id: opportunityId,
      project_name: opts.projectName ?? null,
      charter_json: opts.charterJson ?? null,
    };
    db.run(
      `INSERT INTO md_project (id, project_no, created_at, origin, source_opportunity_id, track, project_name, charter_json)
       VALUES (?,?,?,?,?,?,?,?)`,
      [row.id, row.project_no, row.created_at, row.origin, row.source_opportunity_id, row.track, row.project_name, row.charter_json],
    );

    // Brownfield: link the top shortlisted target's md_company so project→company
    // joins work without the legacy backlink (ADR-0104 §company-linkage).
    if (track === "brownfield") {
      const top = db
        .query(
          `SELECT company_name FROM brownfield_target
           WHERE opportunity_id = ? AND status = 'shortlisted' ORDER BY rank LIMIT 1`,
        )
        .get(opportunityId) as { company_name: string } | undefined;
      if (top) {
        const mc = db.query("SELECT id FROM md_company WHERE name_ko = ?").get(top.company_name) as { id: string } | undefined;
        if (mc) db.run("UPDATE md_project SET company_id = ? WHERE id = ?", [mc.id, id]);
      }
    }

    db.run("UPDATE opportunity SET project_id = ?, promoted_at = ? WHERE id = ?", [row.id, now, opportunityId]);

    // Same transaction as the insert — see the zero-member-invisibility JSDoc.
    grantProjectMembership(db, {
      projectId: row.id,
      userId: opts.promotedBy,
      projectRole: "lead",
      grantedBy: opts.promotedBy,
      needToKnowBasis: opts.needToKnowBasis,
      now,
    });

    appendAudit(db, { actor: opts.promotedBy, action: "opportunity_promoted", target: `${opportunityId}:${row.id}`, now });

    return { project: row, opportunityId, promotedAt: now };
  });

  return run();
}

export interface ProjectMemberRow {
  project_id: string;
  user_id: string;
  project_role: "lead" | "contributor" | "reviewer" | "observer";
  granted_by: string;
  granted_at: string;
  revoked_at: string | null;
  need_to_know_basis: string;
}

export interface VisibilityOptions {
  /**
   * Exclude mnpi_flag=1 projects from the result. The MCP layer passes
   * `true` by default (FR-SYS-02); web/API calls for authenticated members
   * leave it false — membership already gates those, and members see the
   * MNPI banner instead (security-model §6).
   */
  excludeMnpi?: boolean;
  /**
   * Set when this call IS the audited scoped-token override of the MCP
   * default exclusion (FR-SEC-06: the override itself is an audit event).
   * Every MNPI project returned under this flag is audit-logged.
   */
  mnpiScopeOverrideBy?: string;
  /** Include closed/archived projects. Default false keeps active deal surfaces clean. */
  includeClosed?: boolean;
  /**
   * Include delete-marked projects (deleted_at set). Deletion is a tombstone,
   * never a row removal (deal-deletion-playbook): default false keeps every
   * active surface clean, while the archive viewer passes true so the full
   * original data stays inspectable for audit.
   */
  includeDeleted?: boolean;
  /** Restrict to one lifecycle status ('open' | 'closed' | 'archived'). */
  status?: "open" | "closed" | "archived";
}

interface VisibleProjectRow extends ProjectRow {
  mnpi_flag: number;
}


// Wave D2 — derived project list freshness. This mirrors snapshot-filler's
// fact_industry mapping but returns only list-row signal metadata; it never
// stores stale state on md_project.
const PROJECT_STALE_METRICS: ReadonlyArray<{ varKey: string; metricKey: string; label: string }> = [
  { varKey: "market.tam", metricKey: "market_tam_krw", label: "TAM" },
  { varKey: "market.growth_rate", metricKey: "market_growth_yoy_ratio", label: "성장률" },
  { varKey: "market.top3_share", metricKey: "market_top3_share_ratio", label: "상위3사 점유율" },
];

function ageInDaysForProjectList(periodEnd: string, now: Date): number {
  return (now.getTime() - new Date(periodEnd).getTime()) / 86_400_000;
}

function marketStaleReasons(projectId: string, now = new Date()): string[] {
  const db = getDb();
  const industries = db
    .query("SELECT industry_id FROM project_industry WHERE project_id = ? AND superseded_by IS NULL ORDER BY industry_id")
    .all(projectId) as Array<{ industry_id: string }>;
  if (industries.length === 0) return [];
  const reasons: string[] = [];
  for (const { varKey, metricKey, label } of PROJECT_STALE_METRICS) {
    const maxAgeRow = db.query("SELECT max_age_days FROM evidence_var WHERE var_key = ?").get(varKey) as { max_age_days: number | null } | undefined;
    if (maxAgeRow?.max_age_days == null) continue;
    for (const { industry_id } of industries) {
      const row = db
        .query(
          `SELECT p.end_date AS period_end
           FROM fact_industry fi JOIN md_period p ON p.id = fi.period_id
           WHERE p.period_type = 'year' AND fi.industry_id = ? AND fi.metric_key = ?
           ORDER BY p.fiscal_year DESC, p.end_date DESC, p.id DESC, fi.revision_no DESC LIMIT 1`,
        )
        .get(industry_id, metricKey) as { period_end: string } | undefined;
      if (!row) continue;
      if (ageInDaysForProjectList(row.period_end, now) > maxAgeRow.max_age_days) reasons.push(`${label} ${row.period_end.slice(0, 10)} 기준`);
    }
  }
  return [...new Set(reasons)];
}

function attachStaleSignals<T extends ProjectRow>(rows: T[]): T[] {
  return rows.map((row) => {
    const stale_reasons = marketStaleReasons(row.id);
    return { ...row, is_stale: stale_reasons.length > 0, stale_reasons };
  });
}

function logMnpiReads(rows: VisibleProjectRow[], callerId: string, opts: VisibilityOptions): void {
  const mnpiRows = rows.filter((r) => r.mnpi_flag === 1);
  if (mnpiRows.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();
  for (const r of mnpiRows) {
    logDataAccess(db, {
      userId: callerId, tableKey: "project", recordRef: r.id, projectId: r.id,
      action: "read", at: now,
    });
    if (opts.mnpiScopeOverrideBy) {
      appendAudit(db, {
        actor: opts.mnpiScopeOverrideBy, action: "mnpi_scope_override", target: r.id, now,
      });
    }
  }
}

/**
 * List projects visible to `callerId` — deny-by-default: a project with no
 * active `project_member` row for this user is absent from the result,
 * full stop. There is no admin bypass and no unfiltered variant of this
 * function anywhere in the codebase.
 */
export function listVisibleProjects(callerId: string, opts: VisibilityOptions = {}): ProjectRow[] {
  const db = getDb();
  const rows = db
    .query(
      `SELECT p.id, p.project_no, p.project_name, p.created_at, p.status, p.closed_at, p.closure_reason,
              p.origin, p.track, p.source_opportunity_id, p.deleted_at, COALESCE(c.mnpi_flag, 0) AS mnpi_flag
       FROM md_project p
       JOIN project_member m ON m.project_id = p.id
       LEFT JOIN project_classification c ON c.project_id = p.id
       LEFT JOIN app_user u ON u.user_id = m.user_id
       WHERE m.user_id = ? AND m.revoked_at IS NULL
         AND (c.wall_group IS NULL OR u.wall_group IS NULL OR c.wall_group != u.wall_group)
         AND (? = 0 OR COALESCE(c.mnpi_flag, 0) = 0)
         AND (? = 1 OR p.status = 'open')
         AND (p.deleted_at IS NULL OR ? = 1)
         AND (? IS NULL OR p.status = ?)
       ORDER BY p.created_at DESC`
    )
    .all(
      callerId,
      opts.excludeMnpi ? 1 : 0,
      opts.includeClosed ? 1 : 0,
      opts.includeDeleted ? 1 : 0,
      opts.status ?? null,
      opts.status ?? null,
    ) as VisibleProjectRow[];
  logMnpiReads(rows, callerId, opts);
  return attachStaleSignals(rows.map(({ mnpi_flag: _mnpi, ...rest }) => rest));
}

/**
 * Get a single project — returns null (not a permission error) for a
 * non-member, per FR-SEC-01: existence itself is protected, so the caller
 * cannot distinguish "doesn't exist" from "exists but you can't see it".
 */
export function getProjectIfVisible(
  callerId: string,
  projectId: string,
  opts: VisibilityOptions = {}
): ProjectRow | null {
  const db = getDb();
  const row = db
    .query(
      `SELECT p.id, p.project_no, p.project_name, p.created_at, p.status, p.closed_at, p.closure_reason,
              p.origin, p.track, p.source_opportunity_id, p.deleted_at, COALESCE(c.mnpi_flag, 0) AS mnpi_flag
       FROM md_project p
       JOIN project_member m ON m.project_id = p.id
       LEFT JOIN project_classification c ON c.project_id = p.id
       LEFT JOIN app_user u ON u.user_id = m.user_id
       WHERE m.user_id = ? AND m.revoked_at IS NULL AND p.id = ?
         AND (c.wall_group IS NULL OR u.wall_group IS NULL OR c.wall_group != u.wall_group)
         AND (? = 0 OR COALESCE(c.mnpi_flag, 0) = 0)
         AND (? = 1 OR p.status = 'open')
         AND (p.deleted_at IS NULL OR ? = 1)`
    )
    .get(
      callerId,
      projectId,
      opts.excludeMnpi ? 1 : 0,
      opts.includeClosed ? 1 : 0,
      opts.includeDeleted ? 1 : 0,
    ) as VisibleProjectRow | undefined;
  if (!row) return null;
  logMnpiReads([row], callerId, opts);
  const { mnpi_flag: _mnpi, ...rest } = row;
  return attachStaleSignals([rest])[0];
}

export function createProject(projectNo: string): ProjectRow {
  const db = getDb();
  const row: ProjectRow = { id: ulid(), project_no: projectNo, created_at: new Date().toISOString(), status: "open" };
  db.run(`INSERT INTO md_project (id, project_no, created_at) VALUES (?, ?, ?)`, [
    row.id,
    row.project_no,
    row.created_at,
  ]);
  return row;
}

export class ProjectLifecycleError extends Error {
  constructor(
    public code: "not_found" | "invalid_status" | "precondition_failed",
    message: string,
  ) {
    super(message);
  }
}

export function closeProject(
  projectId: string,
  opts: { status?: "closed" | "archived"; closureReason: string; closedBy: string },
): ProjectRow {
  const targetStatus = opts.status ?? "closed";
  if (targetStatus !== "closed" && targetStatus !== "archived") {
    throw new ProjectLifecycleError("invalid_status", "status must be 'closed' or 'archived'.");
  }
  if (!opts.closureReason?.trim()) {
    throw new ProjectLifecycleError("precondition_failed", "closureReason is required for project closure/archival.");
  }
  const db = getDb();
  const now = new Date().toISOString();
  const row = db.transaction(() => {
    const existing = db.query("SELECT id, project_no FROM md_project WHERE id = ?").get(projectId) as
      | { id: string; project_no: string }
      | undefined;
    if (!existing) throw new ProjectLifecycleError("not_found", `project '${projectId}' not found.`);
    db.run(
      "UPDATE md_project SET status = ?, closed_at = COALESCE(closed_at, ?), closure_reason = ? WHERE id = ?",
      [targetStatus, now, opts.closureReason.trim(), projectId],
    );
    db.run(
      "UPDATE pipeline_run SET status = 'completed', current_stage = COALESCE(current_stage, 'closed'), paused_reason = NULL, updated_at = ? WHERE entity_type = 'project' AND entity_id = ? AND status IN ('running','paused_for_human')",
      [now, projectId],
    );
    appendAudit(db, { actor: opts.closedBy, action: `project_${targetStatus}`, target: projectId, now });
    return db.query("SELECT * FROM md_project WHERE id = ?").get(projectId) as ProjectRow;
  })();
  return row;
}
