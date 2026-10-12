// @version 1.0.0
/**
 * Venture/JV scorecard repository — ADR-0059 §1: the E.4 storage layer for
 * the recurring scorecard outputs that persisted as procedure artifacts only
 * until migration 0024 — jv-lifecycle-governance#2 (jv_health_scorecard,
 * seven dimensions) and portfolio-venture-monitoring#1
 * (portfolio_scorecard_rollup, bifurcated financial/strategic). One row per
 * (venture, section, measure, cycle) with a REQUIRED target per measure (the
 * single insufficient_evidence escape) — balanced-scorecard discipline,
 * CHECK-constrained at the table and re-validated here.
 *
 * This repository is the table's ONLY writer (raw SQL writes exist nowhere
 * else; test fixtures are not a write path). Weights are deliberately NOT a
 * column (ADR-0052 open question (b)) — when decided they enter via the
 * governance-doc reference pattern, never a silent default. The JV monitor's
 * seven dimensions map into financial/strategic sections at the PRODUCING
 * step; measure_key preserves dimension identity, so a rollup never flattens
 * what the JV procedure measured.
 *
 * recordVentureScorecardCycle: one call = one review cycle for one project
 * under one source procedure. Guards (all before the transaction opens,
 * kill-criteria.repository order): input shape (source_procedure enum,
 * review_cycle 'YYYY-Qn') → run exists and belongs to the project → no
 * prior rows for (project_id, source_procedure, review_cycle) — one record
 * per project+procedure+cycle, the cycle is the immutable unit (ADR-0005) →
 * FR-SEC-08 membership + FR-SEC-06 insider status for the actor (agents
 * inherit the calling user's identity — design boundary #1) → rows
 * non-empty → ≤ SCORECARD_MEASURE_CAP rows per section (the ~20
 * balanced-scorecard cap, the rollup template's "per section family") →
 * per-row enum/target/evidence validation (evidence_ref reuses the ADR-0058
 * citation vocabulary via isValidEvidenceRef).
 *
 * getVentureScorecard: member+MNPI guarded read of one project's rows for an
 * explicit cycle or its latest (MAX(review_cycle) lexicographic — safe
 * because the GLOB CHECK pins the 'YYYY-Qn' shape); [] when none.
 *
 * getPortfolioRollup: the E.4 portfolio view's data core — PURE query, NO
 * identity checks (the PR-3 server route owns visibility for its caller; the
 * CLI is the group-operator surface, same posture as watch:run). Resolves
 * the latest cycle when none is given and groups one cycle's rows into the
 * shape templates/deliverables/portfolio-scorecard-rollup-template.md
 * renders: bifurcated financial/strategic sections, class rollup over BOTH
 * sections (ventures = distinct project count), the insufficient_evidence
 * exception list, and run/cycle provenance.
 *
 * Consumers: scripts/co-newbiz/scorecard-rollup.ts (the `scorecard:rollup`
 * CLI) reads via getPortfolioRollup; the producing procedure steps and the
 * PR-3 server route adopt this writer when they land.
 */

import type { Database } from "bun:sqlite";
import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";
import { appendAudit, logDataAccess, requireActiveMember, requireInsiderIfMnpi } from "../lib/access-control.ts";
import { isValidEvidenceRef, EVIDENCE_REF_SHAPES } from "../lib/evidence-ref.ts";

/** The two procedures whose scorecard outputs share this table (ADR-0059 §2, discriminator column). */
export type ScorecardSourceProcedure = "jv-lifecycle-governance" | "portfolio-venture-monitoring";
export const SCORECARD_SOURCE_PROCEDURES: readonly ScorecardSourceProcedure[] = ["jv-lifecycle-governance", "portfolio-venture-monitoring"];

/** The CVC four-type taxonomy plus jv (ADR-0059 §2; canonical reporting order). */
export type ScorecardVentureClass = "driving" | "enabling" | "emergent" | "passive" | "jv";
export const SCORECARD_VENTURE_CLASSES: readonly ScorecardVentureClass[] = ["driving", "enabling", "emergent", "passive", "jv"];

export type ScorecardSection = "financial" | "strategic";
export type ScorecardStatus = "on_target" | "deviation" | "insufficient_evidence";

/**
 * Balanced-scorecard measure-set discipline (ADR-0059 §2): ~20 measures per
 * SECTION per record call — a practice enforced by the writer, not a schema
 * constant. The rollup template phrases it as "~20 measures per section
 * family".
 */
export const SCORECARD_MEASURE_CAP = 20;

const REVIEW_CYCLE_RE = /^\d{4}-Q[1-4]$/;

export interface ScorecardRowInput {
  venture_class: ScorecardVentureClass;
  section: ScorecardSection;
  measure_key: string;
  /** Required unless status = 'insufficient_evidence' (the table CHECK re-enforces this). */
  target_value: string | null;
  actual_value: string | null;
  status: ScorecardStatus;
  /** ADR-0058 citation vocabulary: doc:<id> / src:<code> / https://<url>. */
  evidence_ref: string;
  observed_at: string;
}

export interface RecordVentureScorecardInput {
  runId: string;
  projectId: string;
  sourceProcedure: ScorecardSourceProcedure;
  /** 'YYYY-Qn' — the shared JV-monitor + portfolio cadence axis (GLOB CHECK shape). */
  reviewCycle: string;
  rows: ScorecardRowInput[];
  /** The acting user (FR-SEC-08/06 guarded; recorded via the audit + data_access rows). */
  actor: string;
  now?: string;
}

export interface RecordVentureScorecardResult {
  rowIds: string[];
  runId: string;
  projectId: string;
  reviewCycle: string;
  rowCount: number;
}

/** One stored scorecard row, table-column shaped. */
export interface ScorecardRow {
  id: string;
  run_id: string;
  project_id: string;
  source_procedure: string;
  review_cycle: string;
  venture_class: string;
  section: string;
  measure_key: string;
  target_value: string | null;
  actual_value: string | null;
  status: string;
  evidence_ref: string;
  observed_at: string;
  created_at: string;
}

/** A stored row as the portfolio rollup reports it — table columns + project_no (JOIN md_project). */
export interface PortfolioRollupRow extends ScorecardRow {
  project_no: string;
}

export interface ClassRollupEntry {
  venture_class: string;
  /** Distinct project count — the class rollup counts ventures, not rows. */
  ventures: number;
  measures: number;
  on_target: number;
  deviation: number;
  insufficient_evidence: number;
}

export interface PortfolioRollup {
  review_cycle: string | null;
  resolved_from: "explicit" | "latest";
  financial: PortfolioRollupRow[];
  strategic: PortfolioRollupRow[];
  /** Grouped by venture_class over BOTH sections (ADR-0059: report by class, do not flatten). */
  class_rollup: ClassRollupEntry[];
  /** The per-measure exception list — every row whose evidence could not carry a target. */
  insufficient_evidence: { project_id: string; section: string; measure_key: string }[];
  provenance: { runs: string[]; review_cycles_available: string[] };
}

function rowHasTarget(r: ScorecardRowInput): boolean {
  return r.target_value !== null && r.target_value.trim() !== "";
}

/** Record one review cycle's scorecard rows for one project under one source procedure. */
export function recordVentureScorecardCycle(input: RecordVentureScorecardInput, db: Database = getDb()): RecordVentureScorecardResult {
  const now = input.now ?? new Date().toISOString();

  // Input-shape guards (fail fast; the keys below feed the prior-record query).
  if (!SCORECARD_SOURCE_PROCEDURES.includes(input.sourceProcedure as ScorecardSourceProcedure)) {
    throw new Error(
      `venture_scorecard_rejected: source_procedure '${input.sourceProcedure}' is outside the vocabulary (${SCORECARD_SOURCE_PROCEDURES.join("|")}) — the table stores exactly the two producing procedures (ADR-0059).`,
    );
  }
  if (!REVIEW_CYCLE_RE.test(input.reviewCycle ?? "")) {
    throw new Error(
      `venture_scorecard_rejected: review_cycle '${input.reviewCycle}' must match YYYY-Q[1-4] (e.g. '2026-Q4') — the shared JV-monitor + portfolio cadence axis (migration 0024 GLOB CHECK).`,
    );
  }

  const run = db.query("SELECT id, project_id FROM run WHERE id = ?").get(input.runId) as
    | { id: string; project_id: string }
    | undefined;
  if (!run) {
    throw new Error(`venture_scorecard_rejected: run '${input.runId}' does not exist — scorecard rows are run-scoped (migration 0024).`);
  }
  if (run.project_id !== input.projectId) {
    throw new Error(
      `venture_scorecard_rejected: run '${input.runId}' belongs to project '${run.project_id}', not '${input.projectId}' — a scorecard record cannot cross projects (ADR-0005).`,
    );
  }

  const prior = (
    db
      .query("SELECT COUNT(*) AS n FROM venture_scorecard WHERE project_id = ? AND source_procedure = ? AND review_cycle = ?")
      .get(input.projectId, input.sourceProcedure, input.reviewCycle) as { n: number }
  ).n;
  if (prior > 0) {
    throw new Error(
      `venture_scorecard_rejected: project '${input.projectId}' already has a recorded '${input.sourceProcedure}' scorecard for cycle '${input.reviewCycle}' (${prior} row(s)) — one record per project+procedure+cycle; the cycle is the immutable unit (ADR-0005).`,
    );
  }

  // C2 (ADR-0104) — charter KPI pre-commits become default targets: a row
  // whose measure_key matches a charter KPI key and carries no target inherits
  // the charter's target text, so "승격 때 약속한 것" is the S12 yardstick.
  let charterKpis: Array<{ key: string; label?: string; target: string }> = [];
  try {
    const charterRow = db.query("SELECT charter_json FROM md_project WHERE id = ?").get(input.projectId) as
      | { charter_json: string | null }
      | undefined;
    if (charterRow?.charter_json) {
      const parsed = JSON.parse(charterRow.charter_json) as { versions?: Array<{ kpis?: Array<{ key: string; label?: string; target: string }> }> };
      const versions = parsed.versions ?? [];
      charterKpis = versions[versions.length - 1]?.kpis ?? [];
    }
  } catch { /* malformed charter — no default targets */ }

  requireActiveMember(db, input.projectId, input.actor);
  requireInsiderIfMnpi(db, input.projectId, input.actor);

  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new Error(
      `venture_scorecard_rejected: rows is mandatory and non-empty — an empty scorecard records nothing and would silently pass for 'never recorded' (ADR-0049 at read time).`,
    );
  }

  // Measure-set discipline: the cap is per SECTION per record call.
  const perSection = new Map<ScorecardSection, number>();
  for (const r of input.rows) {
    perSection.set(r.section, (perSection.get(r.section) ?? 0) + 1);
  }
  for (const [section, n] of perSection) {
    if (n > SCORECARD_MEASURE_CAP) {
      throw new Error(
        `venture_scorecard_rejected: ${n} rows in section '${section}' exceeds the SCORECARD_MEASURE_CAP of ${SCORECARD_MEASURE_CAP} measures per section — balanced-scorecard discipline (ADR-0059 §2); split the cycle or drop measures.`,
      );
    }
  }

  // Per-row validation, before any write: enums, measure identity, the
  // target-required rule, the ADR-0058 evidence vocabulary, observed_at shape.
  const seenMeasures = new Set<string>();
  for (let i = 0; i < input.rows.length; i++) {
    const r = input.rows[i];
    const at = `rows[${i}]`;
    if (!SCORECARD_VENTURE_CLASSES.includes(r.venture_class as ScorecardVentureClass)) {
      throw new Error(
        `venture_scorecard_rejected: ${at} venture_class '${r.venture_class}' is outside the taxonomy (${SCORECARD_VENTURE_CLASSES.join("|")}) — ADR-0059 §2.`,
      );
    }
    if (r.section !== "financial" && r.section !== "strategic") {
      throw new Error(`venture_scorecard_rejected: ${at} section '${r.section}' must be 'financial' or 'strategic' (the bifurcated rollup shape, ADR-0059).`);
    }
    if (r.status !== "on_target" && r.status !== "deviation" && r.status !== "insufficient_evidence") {
      throw new Error(`venture_scorecard_rejected: ${at} status '${r.status}' must be on_target|deviation|insufficient_evidence (migration 0024 CHECK).`);
    }
    if (!(r.measure_key ?? "").trim()) {
      throw new Error(`venture_scorecard_rejected: ${at} measure_key is mandatory — a row without its measure identity cannot be rolled up or trended.`);
    }
    // C2 (ADR-0104) — charter KPI pre-commit fills a missing target.
    if (!rowHasTarget(r)) {
      const kpi = charterKpis.find((k) => k.key === r.measure_key);
      if (kpi && kpi.target.trim()) r.target_value = kpi.target;
    }
    if (!rowHasTarget(r) && r.status !== "insufficient_evidence") {
      throw new Error(
        `venture_scorecard_rejected: ${at} measure '${r.measure_key}' has no target_value — a measure without a target is invalid; record status 'insufficient_evidence' instead (balanced-scorecard discipline, ADR-0059 §2).`,
      );
    }
    if (!isValidEvidenceRef(r.evidence_ref ?? "")) {
      throw new Error(
        `venture_scorecard_rejected: ${at} measure '${r.measure_key}' evidence_ref is not a resolvable citation (${r.evidence_ref}) — accepted shapes: ${EVIDENCE_REF_SHAPES.join(", ")} (ADR-0058 vocabulary).`,
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}/.test(r.observed_at ?? "")) {
      throw new Error(`venture_scorecard_rejected: ${at} measure '${r.measure_key}' observed_at '${r.observed_at}' must be an ISO-shaped timestamp (YYYY-MM-DD...).`);
    }
    // The UNIQUE (run_id, source_procedure, review_cycle, section,
    // measure_key) key (migration 0139, ADR-0164 — 0024's key widened with
    // review_cycle so one run can hold every quarter) is constant per call —
    // a duplicate measure in one section is a caller bug worth a named error
    // instead of the raw SQLite abort mid-transaction.
    const key = `${r.section} ${r.measure_key}`;
    if (seenMeasures.has(key)) {
      throw new Error(
        `venture_scorecard_rejected: measure '${r.measure_key}' appears twice in section '${r.section}' — one row per measure per section per procedure per run (migration 0024 UNIQUE).`,
      );
    }
    seenMeasures.add(key);
  }

  const rowIds: string[] = [];
  db.transaction(() => {
    const insert = db.prepare(
      "INSERT INTO venture_scorecard (id, run_id, project_id, source_procedure, review_cycle, venture_class, section, measure_key, target_value, actual_value, status, evidence_ref, observed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (const r of input.rows) {
      const id = ulid();
      insert.run([
        id,
        input.runId,
        input.projectId,
        input.sourceProcedure,
        input.reviewCycle,
        r.venture_class,
        r.section,
        r.measure_key,
        rowHasTarget(r) ? r.target_value : null,
        r.actual_value ?? null,
        r.status,
        r.evidence_ref,
        r.observed_at,
        now,
      ] as any);
      rowIds.push(id);
    }
    logDataAccess(db, {
      userId: input.actor,
      tableKey: "venture_scorecard",
      recordRef: `${input.projectId}:${input.sourceProcedure}:${input.reviewCycle}`,
      projectId: input.projectId,
      action: "write",
      at: now,
    });
    appendAudit(db, {
      actor: input.actor,
      action: "venture_scorecard_recorded",
      target: `${input.projectId}:${input.sourceProcedure}:${input.reviewCycle} rows=${input.rows.length}`,
      now,
    });
  })();

  return { rowIds, runId: input.runId, projectId: input.projectId, reviewCycle: input.reviewCycle, rowCount: input.rows.length };
}

/**
 * Read one project's scorecard rows — the given review cycle, or the
 * project's latest (MAX(review_cycle), lexicographic-safe via the GLOB
 * CHECK). Member + MNPI guarded (listVisibleProjects precedent); one
 * data_access row (action "read") per call. Empty array when the project has
 * no scorecard rows at all.
 */
export function getVentureScorecard(
  input: { projectId: string; reviewCycle?: string; actor: string; now?: string },
  db: Database = getDb(),
): ScorecardRow[] {
  const now = input.now ?? new Date().toISOString();

  if (!(input.actor ?? "").trim()) {
    throw new Error(`venture_scorecard_read_rejected: actor is mandatory — a scorecard read without its reader is unauditable (design boundary #1).`);
  }
  requireActiveMember(db, input.projectId, input.actor);
  requireInsiderIfMnpi(db, input.projectId, input.actor);

  const cycle =
    input.reviewCycle ??
    ((db.query("SELECT MAX(review_cycle) AS c FROM venture_scorecard WHERE project_id = ?").get(input.projectId) as { c: string | null }).c ??
      undefined);

  const rows = cycle
    ? (db
        .query("SELECT * FROM venture_scorecard WHERE project_id = ? AND review_cycle = ? ORDER BY review_cycle, source_procedure, section, measure_key")
        .all(input.projectId, cycle) as ScorecardRow[])
    : [];

  logDataAccess(db, {
    userId: input.actor,
    tableKey: "venture_scorecard",
    recordRef: `${input.projectId}:${cycle ?? "*"}`,
    projectId: input.projectId,
    action: "read",
    at: now,
  });
  return rows;
}

/**
 * The portfolio rollup's data core (ADR-0059 E.4): one review cycle's rows
 * across projects, grouped into the shape the rollup template renders. PURE
 * query — no identity checks by design: the server route owns visibility for
 * its caller, and the CLI (`scorecard:rollup`) is the group-operator surface
 * (same posture as watch:run). Resolves the latest cycle within the
 * projectIds scope when no explicit cycle is given.
 */
export function getPortfolioRollup(
  input: { reviewCycle?: string; projectIds?: readonly string[] },
  db: Database = getDb(),
): PortfolioRollup {
  const scope = input.projectIds && input.projectIds.length > 0 ? input.projectIds : null;
  const placeholders = scope ? scope.map(() => "?").join(",") : "";
  const scopeParams = scope ?? [];

  // What cycles exist in scope — the trend-and-trigger axis the rollup's
  // consumers navigate (never latest-value-only, ADR-0059 §2).
  const reviewCyclesAvailable = (
    db
      .query(
        `SELECT DISTINCT v.review_cycle
         FROM venture_scorecard v JOIN md_project p ON p.id = v.project_id
         WHERE p.status = 'open'${scope ? ` AND v.project_id IN (${placeholders})` : ""}
         ORDER BY v.review_cycle`,
      )
      .all(...scopeParams) as Array<{ review_cycle: string }>
  ).map((r) => r.review_cycle);

  const explicit = input.reviewCycle ?? null;
  const resolved = explicit ?? (reviewCyclesAvailable.length > 0 ? reviewCyclesAvailable[reviewCyclesAvailable.length - 1] : null);

  const rows = resolved
    ? (db
        .query(
          `SELECT v.*, p.project_no
           FROM venture_scorecard v JOIN md_project p ON p.id = v.project_id
           WHERE p.status = 'open' AND v.review_cycle = ?${scope ? ` AND v.project_id IN (${placeholders})` : ""}
           ORDER BY p.project_no, v.section, v.measure_key`,
        )
        .all(resolved, ...scopeParams) as PortfolioRollupRow[])
    : [];

  const financial = rows.filter((r) => r.section === "financial");
  const strategic = rows.filter((r) => r.section === "strategic");

  // Class rollup over BOTH sections; ventures counts DISTINCT projects, so a
  // venture active in both sections still counts once (ADR-0059: report by
  // class, do not flatten).
  const byClass = new Map<string, { venture_class: string; ventures: Set<string>; measures: number; on_target: number; deviation: number; insufficient_evidence: number }>();
  for (const r of rows) {
    let e = byClass.get(r.venture_class);
    if (!e) {
      e = { venture_class: r.venture_class, ventures: new Set(), measures: 0, on_target: 0, deviation: 0, insufficient_evidence: 0 };
      byClass.set(r.venture_class, e);
    }
    e.ventures.add(r.project_id);
    e.measures += 1;
    if (r.status === "on_target") e.on_target += 1;
    else if (r.status === "deviation") e.deviation += 1;
    else if (r.status === "insufficient_evidence") e.insufficient_evidence += 1;
  }
  const classRollup: ClassRollupEntry[] = [...byClass.values()]
    .sort(
      (a, b) =>
        SCORECARD_VENTURE_CLASSES.indexOf(a.venture_class as ScorecardVentureClass) -
        SCORECARD_VENTURE_CLASSES.indexOf(b.venture_class as ScorecardVentureClass),
    )
    .map((e) => ({
      venture_class: e.venture_class,
      ventures: e.ventures.size,
      measures: e.measures,
      on_target: e.on_target,
      deviation: e.deviation,
      insufficient_evidence: e.insufficient_evidence,
    }));

  return {
    review_cycle: resolved,
    resolved_from: explicit ? "explicit" : "latest",
    financial,
    strategic,
    class_rollup: classRollup,
    insufficient_evidence: rows
      .filter((r) => r.status === "insufficient_evidence")
      .map((r) => ({ project_id: r.project_id, section: r.section, measure_key: r.measure_key })),
    provenance: {
      runs: [...new Set(rows.map((r) => r.run_id))],
      review_cycles_available: reviewCyclesAvailable,
    },
  };
}
