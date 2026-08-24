// @version 1.4.0
/**
 * project_variable_snapshot filler — the run-scoped variable snapshot writer
 * the thresholds records' var contracts define. Design of record:
 * docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md
 * Decision 2 (run-scoped snapshot + F-7/F-8/F-9 filler discipline), ADR-0046
 * §5. Contracts of record, implemented 1:1:
 *   docs/decisions/market-thresholds.md          D-M-MKT-3 / -5 / -6
 *   docs/decisions/risk-thresholds.md            D-M-RISK-5
 *   docs/decisions/technical-execution-thresholds.md D-M-TE-8 ("Filler
 *   semantics pinned")
 *
 * READER DISCIPLINE (F-7/F-8, same as applies-when.ts / validator-
 * completeness.ts): hand-written static SQL per variable family, parameter
 * binding only, never dynamic identifier interpolation, never a
 * {table, column} descriptor. dimension_input is ONE source among several —
 * it serves only the four asserted market vars; everything else is computed
 * from evidence tables. No rule evaluation happens here: the filler writes
 * rows, Kleene evaluation (predicate.ts) reads them. Every var gets an
 * explicit row each run, `missing` included, so the ledger shows what was
 * considered (the "never an absence of rows" discipline).
 *
 * ACTIVATION (PR-9) deliberately NOT wired here: no caller invokes this yet.
 * Runs are immutable (ADR-0005), so a run is filled exactly once — a second
 * fill of the same run fails on the composite PRIMARY KEY, by design.
 *
 * ── INDUSTRY BINDING (ADR-0054, migration 0021) — the 1.0.0 gap, closed ──
 * project_industry is the binding of record between a project and the
 * industries it reviews: LIVE rows (superseded_by IS NULL) are the DEFAULT
 * industry set for the fact_industry family, and the industryIds option
 * UNIONS with the bound set (explicit caller supplement for tests/direct
 * runs) — it never replaces it. No bindings and no option → still
 * fail-closed: the three fact vars are written `missing`, never guessed.
 * Multiple DISTINCT live bindings are legal (multi-industry targets are
 * real); the multi-industry reading below (ambiguous → `missing`, no
 * invented aggregation) is unchanged and now reachable via bindings.
 *
 * ── DOCUMENTED READINGS (contract ambiguities resolved conservatively) ────
 *   growth (D-M-MKT-3)     read as the latest period's market_growth_yoy_ratio
 *                          metric — the record's own metric table maps that
 *                          key to market.growth_rate and describes it as
 *                          "trailing 1-year YoY" (the two-latest-periods
 *                          computation is the metric pipeline's, not the
 *                          filler's); no TAM-level-derived fallback exists.
 *   evidence_ref strictness applied UNCONDITIONALLY (not Pre-FS-only): the
 *                          record's Pre-FS sentence states the rule; nothing
 *                          re-opens it at other gates, so the filler enforces
 *                          it everywhere a fact value lacks a source.
 *   multi-industry facts   ambiguous → `missing`. The record resolves per
 *                          (industry, metric); a project-level var over two
 *                          industries has no decided aggregation.
 *   switching_cost_grade   worst-of = LOWEST ordinal across contributing
 *                          links (negligible < low < moderate < high <
 *                          very_high) — the weakest lock-in wins, mirroring
 *                          D-M-MKT-6's worst-of spirit for bargaining power.
 *   arg-max ties (D-M-MKT-6) two links sharing the max HHI → link_fit_quality
 *                          takes the MIN r2 among them (conservative).
 *   permit_edge cycle      throws — a cyclic dependency graph has no critical
 *                          path; failing loud beats silently truncating.
 */

import type { Database } from "bun:sqlite";
import { getDb } from "../client.ts";
import { evaluateValidatorCompleteness } from "./validator-completeness.ts";
import type { MaValidatorKey } from "./validator-applicability.ts";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export type SnapshotStatus = "present" | "missing" | "stale" | "low_confidence";

/** One project_variable_snapshot row, in INSERT column order. */
export interface SnapshotWrite {
  var_key: string;
  value_num: number | null;
  value_text: string | null;
  evidence_ref: string | null;
  observed_at: string | null;
  status: SnapshotStatus;
}

export interface SnapshotFillOptions {
  runId: string;
  projectId: string;
  /**
   * Caller-supplied industries for the fact_industry family — UNIONS with
   * the project's live project_industry bindings (ADR-0054, migration
   * 0021), never replaces them. Kept for tests and direct runs. Default
   * (none): the bound set alone; no bindings → fail-closed missing.
   */
  industryIds?: readonly string[];
  /** Staleness reference clock; tests pin it. Default: now. */
  now?: Date;
}

export interface SnapshotFillResult {
  runId: string;
  projectId: string;
  /** Rows written, one per var — 22 (the filler's own completeness invariant). */
  rows: SnapshotWrite[];
}

/** D-M-MKT-5: vars derived from value_chain_link are excluded on r2 < 0.6 — the same criterion gradeChain() applies (D-M4-1). */
export const LINK_FIT_R2_FLOOR = 0.6;

/** Days per month the permit critical path uses (D-M-TE-8: "days ÷ 30.44, 1 decimal"). */
export const DAYS_PER_MONTH = 30.44;

/** The exact var set this filler owns — every evidence_var seeded by 0017/0018/0019. */
export const SNAPSHOT_VAR_KEYS: readonly string[] = [
  // 0017 — market
  "market.bargaining_power_hhi",
  "market.switching_cost_grade",
  "market.tam",
  "market.growth_rate",
  "market.top3_share",
  "market.entry_barrier",
  "right_to_win.customer_overlap",
  "right_to_win.tech_overlap",
  "right_to_win.brand_transferability",
  "market.link_fit_quality",
  // 0018 — technical_execution / risk
  "tech.trl_grade",
  "tech.ip_ownership_status",
  "cert.non_transferable_on_coc",
  "permit.critical_path_duration",
  "permit.unresolved_on_critical_path",
  "risk.contingent_expected_value",
  "risk.contingent_max_amount",
  "risk.contingent_max_probability",
  "risk.covenants_breached",
  "risk.partner_candidates_active",
  "risk.partner_dependency_risk",
  // 0019 — the D-M-TE-8 load-bearing count
  "cert.load_bearing_non_transferable_on_coc",
  // 0025 — ADR-0062 antitrust early-screen tripwire (the 0018-D4 reversal)
  "antitrust.presumption_screens_triggered",
  // 0026 — ADR-0063 Class C evidence extension (the #4/#14/#28/#29 var halves)
  "pmi.key_talent_attrition_90d",
  "pmi.synergy_run_rate_certified",
  "dealshape.viable_shapes",
  "permit.critical_path_exceeds_incentive_deadline",
  // 0027 — ADR-0064 extension round 2 (#5/#6/#7/#8/#9/#10/#17/#19 var halves)
  "fin.wacc_source_status",
  "cert.load_bearing_unconfirmed",
  "cert.transferability_inferred_count",
  "validators.applicable_missing",
  "legal.employment_transfer_consent_regime_determined",
  "classification.origin_live_missing",
];

function missing(varKey: string): SnapshotWrite {
  return { var_key: varKey, value_num: null, value_text: null, evidence_ref: null, observed_at: null, status: "missing" };
}

// ---------------------------------------------------------------------------
// Family A — fact_industry (D-M-MKT-3): tam / growth_rate / top3_share
// ---------------------------------------------------------------------------

/** The record's metric_key convention → snapshot var_key (D-M-MKT-3 table). */
const FACT_METRIC_BY_VAR: ReadonlyArray<{ varKey: string; metricKey: string }> = [
  { varKey: "market.tam", metricKey: "market_tam_krw" },
  { varKey: "market.growth_rate", metricKey: "market_growth_yoy_ratio" },
  { varKey: "market.top3_share", metricKey: "market_top3_share_ratio" },
];

interface FactRow {
  industry_id: string;
  value: number;
  revision_no: number;
  period_id: string;
  fiscal_year: number;
  period_end: string;
  source_code: string | null;
}

const SQL_FACT_ROWS =
  "SELECT fi.industry_id, fi.value, fi.revision_no, p.id AS period_id, p.fiscal_year, p.end_date AS period_end, ms.code AS source_code " +
  "FROM fact_industry fi " +
  "JOIN md_period p ON p.id = fi.period_id " +
  "LEFT JOIN md_source ms ON ms.id = fi.source_id " +
  "WHERE p.period_type = 'year' AND fi.industry_id = ? AND fi.metric_key = ? " +
  "ORDER BY p.fiscal_year DESC, p.end_date DESC, p.id DESC, fi.revision_no DESC";

/** Age in days between a period end and `now` — negative when the period end is in the future (never stale). */
function ageInDays(periodEnd: string, now: Date): number {
  return (now.getTime() - new Date(periodEnd).getTime()) / 86_400_000;
}

function fillFactVars(db: Database, projectId: string, industryIds: readonly string[], now: Date): SnapshotWrite[] {
  const out: SnapshotWrite[] = [];
  for (const { varKey, metricKey } of FACT_METRIC_BY_VAR) {
    // One industry may bind at most once; dedupe defensively.
    const industries = [...new Set(industryIds)];
    // Latest annual row per industry — the ORDER BY gives latest-first; the
    // first row per period_id carries the winning revision_no within it.
    const latest = new Map<string, FactRow>();
    for (const industryId of industries) {
      const rows = db.query(SQL_FACT_ROWS).all(industryId, metricKey) as unknown as FactRow[];
      if (rows.length > 0 && !latest.has(rows[0].industry_id)) latest.set(rows[0].industry_id, rows[0]);
    }
    if (latest.size === 0 || latest.size > 1) {
      // No industry has rows, or the value is ambiguous across industries → missing (module docs).
      out.push(missing(varKey));
      continue;
    }
    const row = [...latest.values()][0];
    // D-M-MKT-3: evidence_ref is mandatory — a non-null value without one is
    // `missing` at Pre-FS strictness (applied unconditionally, module docs).
    if (row.source_code === null) {
      out.push({ var_key: varKey, value_num: row.value, value_text: null, evidence_ref: null, observed_at: row.period_end, status: "missing" });
      continue;
    }
    const maxAgeRow = db.query("SELECT max_age_days FROM evidence_var WHERE var_key = ?").get(varKey) as unknown as { max_age_days: number | null } | undefined;
    const maxAge = maxAgeRow?.max_age_days ?? null;
    const stale = maxAge !== null && ageInDays(row.period_end, now) > maxAge;
    out.push({
      var_key: varKey,
      value_num: row.value,
      value_text: null,
      evidence_ref: row.source_code,
      observed_at: row.period_end,
      status: stale ? "stale" : "present",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Family B — value_chain_link (D-M-MKT-5 / -6 / -2): hhi / fit / switching
// ---------------------------------------------------------------------------

interface LinkRow {
  id: string;
  concentration_hhi: number | null;
  switching_cost_grade: string | null;
  r2: number | null;
  assessed_at: string;
}

/** switching_cost_grade ordinal (D-M-MKT-2) — LOWEST ordinal = weakest lock-in = worst. */
const SWITCHING_ORDINAL: Record<string, number> = { negligible: 0, low: 1, moderate: 2, high: 3, very_high: 4 };

const SQL_LINK_ROWS = "SELECT id, concentration_hhi, switching_cost_grade, r2, assessed_at FROM value_chain_link WHERE project_id = ?";

function fillValueChainVars(db: Database, projectId: string): SnapshotWrite[] {
  const links = db.query(SQL_LINK_ROWS).all(projectId) as unknown as LinkRow[];
  // D-M-MKT-5: a NULL-r2 link contributes nothing — no var may derive from it.
  const contributing = links.filter((l) => l.r2 !== null);

  const bargaining = missing("market.bargaining_power_hhi");
  const fit = missing("market.link_fit_quality");
  const switching = missing("market.switching_cost_grade");

  // D-M-MKT-6: bargaining power = MAX concentration_hhi across ALL contributing
  // links; link_fit_quality = the r2 of the arg-max link, written truthfully
  // even below the floor (conjunct 2 of market-dd-bargaining-power decides).
  const hhiRows = contributing.filter((l) => l.concentration_hhi !== null);
  if (hhiRows.length > 0) {
    const maxHhi = Math.max(...hhiRows.map((l) => l.concentration_hhi as number));
    const argMax = hhiRows.filter((l) => l.concentration_hhi === maxHhi);
    const fitR2 = Math.min(...argMax.map((l) => l.r2 as number)); // tie → conservative min (module docs)
    const assessedAt = argMax.map((l) => l.assessed_at).sort().at(-1) as string;
    bargaining.value_num = maxHhi;
    bargaining.observed_at = assessedAt;
    // D-M-MKT-5: r2 < 0.6 → excluded as low_confidence — the value is written,
    // the status is what excludes it from Kleene evaluation (non-present).
    bargaining.status = fitR2 < LINK_FIT_R2_FLOOR ? "low_confidence" : "present";
    fit.value_num = fitR2;
    fit.observed_at = assessedAt;
    fit.status = "present";
  }

  // D-M-MKT-2/-8 spirit: worst-of = lowest ordinal (weakest lock-in) across
  // contributing links carrying a grade. Present when any worst-grade link is
  // trusted (r2 >= floor); low_confidence when only sub-floor links carry it.
  const gradeRows = contributing.filter((l) => l.switching_cost_grade !== null);
  if (gradeRows.length > 0) {
    const worstOrdinal = Math.min(...gradeRows.map((l) => SWITCHING_ORDINAL[l.switching_cost_grade as string]));
    const selected = gradeRows.filter((l) => SWITCHING_ORDINAL[l.switching_cost_grade as string] === worstOrdinal);
    const trusted = selected.some((l) => (l.r2 as number) >= LINK_FIT_R2_FLOOR);
    switching.value_text = (Object.keys(SWITCHING_ORDINAL) as string[]).find((g) => SWITCHING_ORDINAL[g] === worstOrdinal) as string;
    switching.observed_at = selected.map((l) => l.assessed_at).sort().at(-1) as string;
    switching.status = trusted ? "present" : "low_confidence";
  }

  return [bargaining, fit, switching];
}

// ---------------------------------------------------------------------------
// Family C — asserted dimension_input (live + reviewed only)
// ---------------------------------------------------------------------------

/** The five asserted vars (0017 market set + ADR-0063 legal fact); value column per the registry's value_type. */
const ASSERTED_VARS: ReadonlyArray<{ varKey: string; kind: "text" | "num" }> = [
  { varKey: "market.entry_barrier", kind: "text" },
  { varKey: "right_to_win.customer_overlap", kind: "num" },
  { varKey: "right_to_win.tech_overlap", kind: "num" },
  { varKey: "right_to_win.brand_transferability", kind: "num" },
  { varKey: "legal.employment_transfer_consent_regime_determined", kind: "text" },
];

interface DimensionInputRow {
  var_key: string;
  value_text: string | null;
  value_num: number | null;
  evidence_ref: string;
  observed_at: string;
}

const SQL_ASSERTED_ROWS =
  "SELECT var_key, value_text, value_num, evidence_ref, observed_at FROM dimension_input " +
  "WHERE project_id = ? AND superseded_by IS NULL AND reviewed_by IS NOT NULL AND var_key IN " +
  "('market.entry_barrier','right_to_win.customer_overlap','right_to_win.tech_overlap','right_to_win.brand_transferability','legal.employment_transfer_consent_regime_determined')";

function fillAssertedVars(db: Database, projectId: string): SnapshotWrite[] {
  // The reviewed_by gate is the write path's approval step (repository
  // discipline): an unreviewed or superseded assertion is NOT evidence.
  const live = new Map<string, DimensionInputRow>();
  for (const row of db.query(SQL_ASSERTED_ROWS).all(projectId) as unknown as DimensionInputRow[]) {
    if (!live.has(row.var_key)) live.set(row.var_key, row);
  }
  return ASSERTED_VARS.map(({ varKey, kind }) => {
    const row = live.get(varKey);
    if (!row) return missing(varKey);
    return {
      var_key: varKey,
      value_num: kind === "num" ? row.value_num : null,
      value_text: kind === "text" ? row.value_text : null,
      evidence_ref: row.evidence_ref,
      observed_at: row.observed_at,
      status: "present" as SnapshotStatus,
    };
  });
}

// ---------------------------------------------------------------------------
// Family D — technical_execution (D-M-TE-8 "Filler semantics pinned")
// ---------------------------------------------------------------------------

/** ip_ownership_status total order — higher = worse clarity (D-M-TE-8). */
const IP_ORDINAL: Record<string, number> = {
  owned_by_target: 0,
  owned_by_originator: 1,
  jointly_owned: 2,
  licensed_in: 3,
  disputed: 4,
};

function maxCreatedAt(rows: Array<{ created_at: string }>): string | null {
  return rows.length > 0 ? (rows.map((r) => r.created_at).sort().at(-1) as string) : null;
}

function fillTrlVar(db: Database, projectId: string): SnapshotWrite {
  const rows = db
    .query("SELECT trl_grade, created_at FROM dd_finding WHERE project_id = ? AND trl_grade IS NOT NULL")
    .all(projectId) as unknown as Array<{ trl_grade: string; created_at: string }>;
  if (rows.length === 0) return missing("tech.trl_grade");
  // TRL MIN across dd_finding — least mature finding wins (D-M-TE-8).
  let worst: string | null = null;
  for (const row of rows) {
    const m = row.trl_grade.match(/^TRL([1-9])$/);
    if (m === null) throw new Error(`snapshot-filler: dd_finding.trl_grade '${row.trl_grade}' is not TRL1..TRL9 (0019 CHECK violated)`);
    const level = Number(m[1]);
    if (worst === null || level < Number(worst.slice(3))) worst = row.trl_grade;
  }
  return { var_key: "tech.trl_grade", value_num: null, value_text: worst, evidence_ref: null, observed_at: maxCreatedAt(rows), status: "present" };
}

function fillIpVar(db: Database, projectId: string): SnapshotWrite {
  const rows = db
    .query("SELECT ip_ownership_status, created_at FROM dd_finding WHERE project_id = ? AND ip_ownership_status IS NOT NULL")
    .all(projectId) as unknown as Array<{ ip_ownership_status: string; created_at: string }>;
  if (rows.length === 0) return missing("tech.ip_ownership_status");
  // Worst per the total order: disputed > licensed_in > jointly_owned >
  // owned_by_originator > owned_by_target (D-M-TE-8).
  const worst = rows.map((r) => r.ip_ownership_status).sort((a, b) => IP_ORDINAL[b] - IP_ORDINAL[a])[0];
  return { var_key: "tech.ip_ownership_status", value_num: null, value_text: worst, evidence_ref: null, observed_at: maxCreatedAt(rows), status: "present" };
}

function countRows(sql: string, projectId: string, db: Database): number {
  return (db.query(sql).get(projectId) as unknown as { n: number }).n;
}

const SQL_CERT_TOTAL = "SELECT COUNT(*) AS n FROM certification WHERE project_id = ?";
const SQL_CERT_NON_TRANSFERABLE =
  "SELECT COUNT(*) AS n FROM certification WHERE project_id = ? AND transferable_on_coc = 'no' AND transferability_basis = 'verified'";
const SQL_CERT_LOAD_BEARING =
  "SELECT COUNT(*) AS n FROM certification WHERE project_id = ? AND transferable_on_coc = 'no' AND transferability_basis = 'verified' AND load_bearing = 1";

function fillCertCountVars(db: Database, projectId: string): SnapshotWrite[] {
  if (countRows(SQL_CERT_TOTAL, projectId, db) === 0) {
    // No certification rows at all → UNASSESSED, not a zero count (D-M-TE-8).
    return [missing("cert.non_transferable_on_coc"), missing("cert.load_bearing_non_transferable_on_coc")];
  }
  // A position counts only on a verified basis — 'no' transferability with an
  // inferred basis is never load-bearing evidence (the write path blocks
  // inferred 'no'; the filler enforces the same at read time). NULL (no
  // position taken) and 'yes' never count. Zero is a valid present count.
  const nonTransferable = countRows(SQL_CERT_NON_TRANSFERABLE, projectId, db);
  const loadBearing = countRows(SQL_CERT_LOAD_BEARING, projectId, db);
  return [
    { var_key: "cert.non_transferable_on_coc", value_num: nonTransferable, value_text: null, evidence_ref: null, observed_at: null, status: "present" },
    { var_key: "cert.load_bearing_non_transferable_on_coc", value_num: loadBearing, value_text: null, evidence_ref: null, observed_at: null, status: "present" },
  ];
}

interface PermitRow {
  id: string;
  statutory_days: number | null;
  status: string;
}

/** The statuses that keep a permit ON the critical-path graph (D-M-TE-8: "not_started|in_progress"). */
const PERMIT_UNRESOLVED_STATUSES: readonly string[] = ["not_started", "in_progress"];

/**
 * Longest path over the induced permit DAG: nodes = the project's unresolved
 * permits, a node's weight = its statutory_days (NULL → 0, D-M-TE-8), the
 * path's weight = the sum over its nodes. Kahn topological order — a cycle
 * throws (module docs). Returns total days and the node count of the arg-max
 * path (ties on duration prefer MORE unresolved permits — the larger exposure).
 */
function longestPermitPath(unresolved: Map<string, number>, edges: ReadonlyArray<readonly [string, string]>): { days: number; nodes: number } {
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of unresolved.keys()) {
    inDeg.set(id, 0);
    adj.set(id, []);
  }
  for (const [from, to] of edges) {
    if (!unresolved.has(from) || !unresolved.has(to)) continue; // induced subgraph only
    adj.get(from)!.push(to);
    inDeg.set(to, (inDeg.get(to) as number) + 1);
  }
  const queue: string[] = [...unresolved.keys()].filter((id) => (inDeg.get(id) as number) === 0);
  const dist = new Map<string, number>(); // total statutory days of the best path ending at node, inclusive
  const nodeCount = new Map<string, number>(); // permits on that path, inclusive
  const pred = new Map<string, string | null>();
  for (const id of unresolved.keys()) {
    dist.set(id, unresolved.get(id) as number);
    nodeCount.set(id, 1);
    pred.set(id, null);
  }
  let visited = 0;
  while (queue.length > 0) {
    const u = queue.shift() as string;
    visited++;
    for (const v of adj.get(u) as string[]) {
      const cand = (dist.get(u) as number) + (unresolved.get(v) as number);
      const candNodes = (nodeCount.get(u) as number) + 1;
      const better = cand > (dist.get(v) as number) || (cand === (dist.get(v) as number) && candNodes > (nodeCount.get(v) as number));
      if (better) {
        dist.set(v, cand);
        nodeCount.set(v, candNodes);
        pred.set(v, u);
      }
      const d = (inDeg.get(v) as number) - 1;
      inDeg.set(v, d);
      if (d === 0) queue.push(v);
    }
  }
  if (visited !== unresolved.size) {
    throw new Error("snapshot-filler: permit_edge contains a cycle among project permits — no critical path exists (D-M-TE-8 expects a DAG)");
  }
  let bestId: string | null = null;
  for (const [id, d] of dist) {
    const better = bestId === null || d > (dist.get(bestId) as number) || (d === (dist.get(bestId) as number) && (nodeCount.get(id) as number) > (nodeCount.get(bestId) as number));
    if (better) bestId = id;
  }
  let nodes = 0;
  for (let cur: string | null = bestId; cur !== null; cur = pred.get(cur) ?? null) nodes++;
  return { days: dist.get(bestId as string) as number, nodes };
}

function fillPermitVars(db: Database, projectId: string): SnapshotWrite[] {
  const resolved = resolvePermitCriticalPath(db, projectId);
  if (resolved === null) {
    // No permit rows at all → UNASSESSED (D-M-TE-8).
    return [missing("permit.critical_path_duration"), missing("permit.unresolved_on_critical_path")];
  }
  return [
    { var_key: "permit.critical_path_duration", value_num: resolved.durationMonths, value_text: null, evidence_ref: null, observed_at: null, status: "present" },
    { var_key: "permit.unresolved_on_critical_path", value_num: resolved.unresolvedNodes, value_text: null, evidence_ref: null, observed_at: null, status: "present" },
  ];
}

/** Shared by the D-M-TE-8 pair and the ADR-0063 deadline-exceeds var. Null = no permit rows (nothing to resolve). */
function resolvePermitCriticalPath(db: Database, projectId: string): { durationMonths: number; unresolvedNodes: number } | null {
  const permits = db.query("SELECT id, statutory_days, status FROM permit WHERE project_id = ?").all(projectId) as unknown as PermitRow[];
  if (permits.length === 0) return null;
  // Granted/denied/withdrawn permits leave the graph — a resolved permit is
  // no longer on any critical path. Isolated unresolved permits are paths of one.
  const unresolved = new Map<string, number>();
  for (const p of permits) {
    if (PERMIT_UNRESOLVED_STATUSES.includes(p.status)) unresolved.set(p.id, p.statutory_days ?? 0); // NULL statutory_days → 0 (D-M-TE-8)
  }
  // permit_edge is not project-scoped: restrict to this project's unresolved
  // permits so no other project's graph leaks into the path.
  const edgeRows = db.query("SELECT from_permit_id, to_permit_id FROM permit_edge").all() as unknown as Array<{ from_permit_id: string; to_permit_id: string }>;
  const edges = edgeRows.map((e) => [e.from_permit_id, e.to_permit_id] as const);
  const { days, nodes } = unresolved.size === 0 ? { days: 0, nodes: 0 } : longestPermitPath(unresolved, edges);
  const durationMonths = Math.round((days / DAYS_PER_MONTH) * 10) / 10; // D-M-TE-8: ÷30.44, 1 decimal
  return { durationMonths, unresolvedNodes: nodes };
}

// ---------------------------------------------------------------------------
// Family E — risk (D-M-RISK-5 filler contracts)
// ---------------------------------------------------------------------------

interface ContingentRow {
  probability: number;
  amount_expected: number;
}

/** The contingent-liability validator whose coverage row makes a zero-row EV a present 0.0 (D-M-RISK-5). */
const CONTINGENT_VALIDATOR_KEY: MaValidatorKey = "contingent-liability";

function contingentCoverageComplete(db: Database, projectId: string, runId: string, now: Date): boolean {
  const evaluation = evaluateValidatorCompleteness(projectId, runId, db, { now });
  const validator = evaluation.validators.find((v) => v.key === CONTINGENT_VALIDATOR_KEY);
  // Completed = pass/blocked/reason_required/waived, or a live not_applicable
  // skip — anything except 'missing' is coverage (the engine's own semantics).
  return validator !== undefined && validator.status !== "missing";
}

function fillContingentVars(db: Database, projectId: string, runId: string, now: Date): SnapshotWrite[] {
  // Storage convention (ADR-0061): money columns are INTEGER KRW-millions.
  // The pinned risk rules compare raw won (1e10 = 100억), so the filler is
  // the unit boundary: storage ×1e6 → snapshot raw-won. Rules stay untouched.
  const SCALE = 1_000_000;
  const rows = db.query("SELECT probability, amount_expected FROM contingent_liability WHERE project_id = ?").all(projectId) as unknown as ContingentRow[];
  const ev = missing("risk.contingent_expected_value");
  const maxAmount = missing("risk.contingent_max_amount");
  const maxProb = missing("risk.contingent_max_probability");
  if (rows.length > 0) {
    let expectedValue = 0;
    for (const r of rows) expectedValue += r.probability * r.amount_expected;
    ev.value_num = expectedValue * SCALE;
    ev.status = "present";
    maxAmount.value_num = Math.max(...rows.map((r) => r.amount_expected)) * SCALE;
    maxAmount.status = "present";
    maxProb.value_num = Math.max(...rows.map((r) => r.probability));
    maxProb.status = "present";
  } else if (contingentCoverageComplete(db, projectId, runId, now)) {
    // Zero rows AND a coverage row = a considered nothing: 0.0 EV, 0 max
    // amount, 0.0 max probability — present, never missing (D-M-RISK-5).
    ev.value_num = 0;
    ev.status = "present";
    maxAmount.value_num = 0;
    maxAmount.status = "present";
    maxProb.value_num = 0;
    maxProb.status = "present";
  }
  return [ev, maxAmount, maxProb];
}

function fillCovenantVar(db: Database, projectId: string): SnapshotWrite {
  const row = missing("risk.covenants_breached");
  // The LATEST simulation of this project decides (D-M-RISK-5).
  const sim = db
    .query("SELECT s.id AS sim_id, s.created_at FROM simulation s JOIN run r ON r.id = s.run_id WHERE r.project_id = ? ORDER BY s.created_at DESC, s.id DESC LIMIT 1")
    .get(projectId) as unknown as { sim_id: string; created_at: string } | null;
  if (sim) {
    const breached = (db.query("SELECT COUNT(*) AS n FROM covenant_test WHERE simulation_id = ? AND breached = 1").get(sim.sim_id) as unknown as { n: number }).n;
    row.value_num = breached;
    row.observed_at = sim.created_at;
    row.status = "present";
    return row;
  }
  const debtCount = (db.query("SELECT COUNT(*) AS n FROM debt_instrument WHERE project_id = ?").get(projectId) as unknown as { n: number }).n;
  if (debtCount === 0) {
    // No debt instruments → legitimately nothing to test: present 0.
    row.value_num = 0;
    row.status = "present";
  }
  // Debt exists but no simulation ran → missing: the covenant test is owed, not zero.
  return row;
}

interface PartnerCandidateRow {
  status: string;
  dependency_risk: string | null;
}

/** D-M-RISK-5: only these statuses count toward the active pool. */
const PARTNER_ACTIVE_STATUSES: readonly string[] = ["contacted", "in_negotiation", "signed"];

/** dependency_risk severity order — higher = worse (D-M-RISK-5). */
const DEPENDENCY_ORDINAL: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 };

function fillPartnerVars(db: Database, projectId: string): SnapshotWrite[] {
  const active = missing("risk.partner_candidates_active");
  const dependency = missing("risk.partner_dependency_risk");
  const hypothesis = db
    .query("SELECT vehicle, hypothesized_at FROM deal_structure_hypothesis WHERE project_id = ? ORDER BY hypothesized_at DESC, id DESC LIMIT 1")
    .get(projectId) as unknown as { vehicle: string | null; hypothesized_at: string } | null;
  if (!hypothesis) {
    // deal_structure_hypothesis unrecorded is the ONLY missing condition.
    return [active, dependency];
  }
  const candidates = db.query("SELECT status, dependency_risk FROM partner_candidate WHERE project_id = ?").all(projectId) as unknown as PartnerCandidateRow[];
  active.value_num = candidates.filter((c) => PARTNER_ACTIVE_STATUSES.includes(c.status)).length;
  active.observed_at = hypothesis.hypothesized_at;
  active.status = "present";
  // A declared non-JV vehicle states no partner requirement: 'none', determinately.
  if (hypothesis.vehicle !== null && hypothesis.vehicle !== "jv") {
    dependency.value_text = "none";
    dependency.observed_at = hypothesis.hypothesized_at;
    dependency.status = "present";
    return [active, dependency];
  }
  // jv — or an unsettled (NULL) vehicle with the requirement still open: the
  // dependency is whatever the candidates show, missing when none is assessed.
  const severities = candidates
    .map((c) => c.dependency_risk)
    .filter((s): s is string => s !== null)
    .map((s) => DEPENDENCY_ORDINAL[s]);
  if (severities.length > 0) {
    const worst = Math.max(...severities);
    dependency.value_text = (Object.keys(DEPENDENCY_ORDINAL) as string[]).find((g) => DEPENDENCY_ORDINAL[g] === worst) as string;
    dependency.observed_at = hypothesis.hypothesized_at;
    dependency.status = "present";
  }
  return [active, dependency];
}

// ---------------------------------------------------------------------------
// Family F — antitrust early screen (ADR-0062, migration 0025)
// ---------------------------------------------------------------------------

/**
 * Count of antitrust_finding rows inside the 2023 DOJ/FTC structural-
 * presumption zone (post-merger HHI > 1,800 AND delta > 100 — thresholds of
 * record live in docs/decisions/2026-08-24-class-c-decisions.md + ADR-0062;
 * regulators index-adjust them, so they are registry-predicate constants,
 * never schema or profile constants).
 *
 * Honesty rule: NO antitrust_finding row means the screen has not been run —
 * `missing` (UNASSESSED at evaluation), never present-0. Any finding row
 * (including remedy_type='none' outcomes) makes the count determinate.
 */
function fillAntitrustVar(db: Database, projectId: string): SnapshotWrite {
  const row = missing("antitrust.presumption_screens_triggered");
  const any = (db.query("SELECT COUNT(*) AS n FROM antitrust_finding WHERE project_id = ?").get(projectId) as unknown as { n: number }).n;
  if (any === 0) return row;
  const tripped = (db.query(
    "SELECT COUNT(*) AS n FROM antitrust_finding WHERE project_id = ? AND hhi_after IS NOT NULL AND hhi_before IS NOT NULL AND hhi_after > 1800 AND (hhi_after - hhi_before) > 100",
  ).get(projectId) as unknown as { n: number }).n;
  row.value_num = tripped;
  row.evidence_ref = "antitrust_finding";
  const latest = db.query("SELECT MAX(created_at) AS at FROM antitrust_finding WHERE project_id = ?").get(projectId) as unknown as { at: string | null };
  row.observed_at = latest.at;
  row.status = "present";
  return row;
}

// ---------------------------------------------------------------------------
// Family G — Class C extension (ADR-0063, migration 0026): PMI / deal-shape /
// incentive-deadline vars. Threshold halves live in
// docs/decisions/2026-08-24-class-c-decisions.md (gd-0024-class-c-decisions);
// this filler owns the VAR halves only.
// ---------------------------------------------------------------------------

/**
 * #28: regretted key-talent departures within 90 days of each roster row's
 * close-lock, over the whole locked roster. No roster = not measured =
 * missing (the close-locked list is a day-1 artifact; its absence means the
 * ratio does not exist yet, never zero).
 */
function fillKeyTalentAttritionVar(db: Database, projectId: string): SnapshotWrite {
  const row = missing("pmi.key_talent_attrition_90d");
  const total = (db.query("SELECT COUNT(*) AS n FROM pmi_key_talent WHERE project_id = ?").get(projectId) as unknown as { n: number }).n;
  if (total === 0) return row;
  const regretted = (db.query(
    "SELECT COUNT(*) AS n FROM pmi_key_talent WHERE project_id = ? AND status = 'departed_regretted' AND exit_date IS NOT NULL AND exit_date <= date(locked_at, '+90 days')",
  ).get(projectId) as unknown as { n: number }).n;
  row.value_num = Math.round((regretted / total) * 10000) / 10000;
  row.evidence_ref = "pmi_key_talent";
  const latest = db.query("SELECT MAX(locked_at) AS at FROM pmi_key_talent WHERE project_id = ?").get(projectId) as unknown as { at: string | null };
  row.observed_at = latest.at;
  row.status = "present";
  return row;
}

/**
 * #29: 'certified' requires a certification row meeting the decided rule
 * verbatim — run-rate >=90% (>=9000 bp of committed cost-synergy run-rate)
 * AND sustained >=2 quarters. A closed deal (roster exists) with no cert row
 * is determinately 'not_certified' — the halt condition, honestly stated.
 * No roster either = pre-close, missing.
 */
function fillSynergyCertVar(db: Database, projectId: string): SnapshotWrite {
  const row = missing("pmi.synergy_run_rate_certified");
  const rosterCount = (db.query("SELECT COUNT(*) AS n FROM pmi_key_talent WHERE project_id = ?").get(projectId) as unknown as { n: number }).n;
  const certs = db.query("SELECT run_rate_bp, sustained_quarters, signed_at FROM pmi_synergy_certification WHERE project_id = ? ORDER BY signed_at DESC").all(projectId) as unknown as Array<{ run_rate_bp: number; sustained_quarters: number; signed_at: string }>;
  if (certs.length > 0) {
    const best = certs.some((c) => c.run_rate_bp >= 9000 && c.sustained_quarters >= 2);
    row.value_text = best ? "certified" : "not_certified";
    row.observed_at = certs[0].signed_at;
    row.status = "present";
    return row;
  }
  if (rosterCount > 0) {
    row.value_text = "not_certified";
    row.status = "present";
    return row;
  }
  return row;
}

/** #14: P3 evaluations exist → present count of viable=1 shapes; none evaluated → missing (P3 not reached). */
function fillViableShapesVar(db: Database, projectId: string): SnapshotWrite {
  const row = missing("dealshape.viable_shapes");
  const total = (db.query("SELECT COUNT(*) AS n FROM deal_shape_evaluation WHERE project_id = ?").get(projectId) as unknown as { n: number }).n;
  if (total === 0) return row;
  row.value_num = (db.query("SELECT COUNT(*) AS n FROM deal_shape_evaluation WHERE project_id = ? AND viable = 1").get(projectId) as unknown as { n: number }).n;
  row.evidence_ref = "deal_shape_evaluation";
  const latest = db.query("SELECT MAX(evaluated_at) AS at FROM deal_shape_evaluation WHERE project_id = ?").get(projectId) as unknown as { at: string | null };
  row.observed_at = latest.at;
  row.status = "present";
  return row;
}

/**
 * #4: the earliest recorded incentive deadline vs the permit critical path.
 * Time-relative by nature (months remaining shrinks daily), so observed_at is
 * pinned to the fill moment and the snapshot's immutability carries the rest.
 * Missing when EITHER side is unmeasured — never a defaulted no.
 */
function fillPermitDeadlineVar(db: Database, projectId: string, now: Date): SnapshotWrite {
  const row = missing("permit.critical_path_exceeds_incentive_deadline");
  const deadlineRow = db.query("SELECT MIN(deadline) AS deadline FROM project_incentive_deadline WHERE project_id = ?").get(projectId) as unknown as { deadline: string | null };
  if (!deadlineRow?.deadline) return row;
  const cp = resolvePermitCriticalPath(db, projectId);
  if (cp === null) return row;
  const daysRemaining = (Date.parse(deadlineRow.deadline) - now.getTime()) / 86_400_000;
  const monthsRemaining = daysRemaining / DAYS_PER_MONTH;
  row.value_text = cp.durationMonths > monthsRemaining ? "yes" : "no";
  row.evidence_ref = "project_incentive_deadline";
  row.observed_at = now.toISOString();
  row.status = "present";
  return row;
}

// ---------------------------------------------------------------------------
// Family H — extension round 2 (ADR-0064, migration 0027): finance-source,
// certification trio, six-validator completeness, classification presence.
// All sources pre-exist; thresholds were wording-decided in ADR-0060 rows
// 5-10 with the Class C record supplying governance discipline.
// ---------------------------------------------------------------------------

/**
 * #5/#6: WACC and hurdle IRR must be kind='user' (the wacc-input-session
 * convention). Any 'assumed' row among the two keys marks the whole status
 * assumed — a provisional discount rate invalidates the analysis (policy
 * §2.2); both keys absent = not yet sessioned = missing.
 */
function fillWaccSourceVar(db: Database, runId: string): SnapshotWrite {
  const row = missing("fin.wacc_source_status");
  const rows = db.query("SELECT assumption_key, kind FROM assumption WHERE run_id = ? AND assumption_key IN ('wacc','hurdle_irr')").all(runId) as unknown as Array<{ assumption_key: string; kind: string }>;
  const byKey = new Map(rows.map((r) => [r.assumption_key, r.kind]));
  if (!byKey.has("wacc") && !byKey.has("hurdle_irr")) return row;
  row.value_text = [byKey.get("wacc"), byKey.get("hurdle_irr")].some((k) => k === "assumed") ? "assumed" : "sourced";
  row.evidence_ref = "assumption";
  const latest = db.query("SELECT MAX(as_of) AS at FROM assumption WHERE run_id = ? AND assumption_key IN ('wacc','hurdle_irr')").get(runId) as unknown as { at: string | null };
  row.observed_at = latest.at;
  row.status = "present";
  return row;
}

/** #7/#8 tripwire: load-bearing certifications whose transferability was never confirmed. Present-always count (sibling of the 0019 pair). */
function fillCertUnconfirmedVar(db: Database, projectId: string): SnapshotWrite {
  const row = missing("cert.load_bearing_unconfirmed");
  row.value_num = (db.query("SELECT COUNT(*) AS n FROM certification WHERE project_id = ? AND load_bearing = 1 AND transferability_basis IS NULL").get(projectId) as unknown as { n: number }).n;
  row.status = "present";
  return row;
}

/** #9 tripwire: rows whose basis is 'inferred'. The repository write-block keeps this at zero through the API — a nonzero count proves a raw-SQL bypass. */
function fillCertInferredVar(db: Database, projectId: string): SnapshotWrite {
  const row = missing("cert.transferability_inferred_count");
  row.value_num = (db.query("SELECT COUNT(*) AS n FROM certification WHERE project_id = ? AND transferability_basis = 'inferred'").get(projectId) as unknown as { n: number }).n;
  row.status = "present";
  return row;
}

/** #10: APPLICABLE validators without coverage — the completeness engine's own halt set, surfaced as a snapshot var. */
function fillValidatorsMissingVar(db: Database, projectId: string, runId: string, now: Date): SnapshotWrite {
  const row = missing("validators.applicable_missing");
  const evaluation = evaluateValidatorCompleteness(projectId, runId, db, { now });
  row.value_num = evaluation.halt.missing.length;
  row.evidence_ref = "validator_completeness";
  row.observed_at = now.toISOString();
  row.status = "present";
  return row;
}

/** #19: live origin classification present? Zero live rows at the entity-establishment gate IS the finding. */
function fillClassificationPresenceVar(db: Database, projectId: string): SnapshotWrite {
  const row = missing("classification.origin_live_missing");
  row.value_num = (db.query("SELECT COUNT(*) AS n FROM project_case_classification WHERE project_id = ? AND superseded_by IS NULL").get(projectId) as unknown as { n: number }).n;
  row.status = "present";
  return row;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const SQL_INSERT_SNAPSHOT =
  "INSERT INTO project_variable_snapshot (run_id, project_id, var_key, value_num, value_text, evidence_ref, observed_at, status) VALUES (?,?,?,?,?,?,?,?)";

/** ADR-0054: the project's LIVE target-market industries — the default fact-family set. */
const SQL_BOUND_INDUSTRIES = "SELECT industry_id FROM project_industry WHERE project_id = ? AND superseded_by IS NULL ORDER BY industry_id";

/**
 * Fill a run's variable snapshot: one explicit row per evidence var the
 * 0017-0027 seed sets define (33), statuses per the record
 * contracts. Runs are immutable — filling an already-filled run throws on
 * the PK.
 */
export function fillSnapshot(opts: SnapshotFillOptions, db: Database = getDb()): SnapshotFillResult {
  const now = opts.now ?? new Date();
  const run = db.query("SELECT project_id FROM run WHERE id = ?").get(opts.runId) as unknown as { project_id: string } | null;
  if (run === null) throw new Error(`snapshot-filler: run '${opts.runId}' does not exist`);
  if (run.project_id !== opts.projectId) {
    throw new Error(`snapshot-filler: run '${opts.runId}' belongs to project '${run.project_id}', not '${opts.projectId}'`);
  }
  // ADR-0054: live project_industry rows are the DEFAULT set; the option
  // supplements (unions), never replaces. Union order is bound-first; the
  // dedupe below keeps one row per industry regardless of who supplied it.
  const boundIndustryIds = (db.query(SQL_BOUND_INDUSTRIES).all(opts.projectId) as unknown as Array<{ industry_id: string }>).map((r) => r.industry_id);
  const industryIds = [...new Set([...boundIndustryIds, ...(opts.industryIds ?? [])])];
  const rows: SnapshotWrite[] = [
    ...fillFactVars(db, opts.projectId, industryIds, now),
    ...fillValueChainVars(db, opts.projectId),
    ...fillAssertedVars(db, opts.projectId),
    fillTrlVar(db, opts.projectId),
    fillIpVar(db, opts.projectId),
    ...fillCertCountVars(db, opts.projectId),
    ...fillPermitVars(db, opts.projectId),
    ...fillContingentVars(db, opts.projectId, opts.runId, now),
    fillCovenantVar(db, opts.projectId),
    ...fillPartnerVars(db, opts.projectId),
    fillAntitrustVar(db, opts.projectId),
    fillKeyTalentAttritionVar(db, opts.projectId),
    fillSynergyCertVar(db, opts.projectId),
    fillViableShapesVar(db, opts.projectId),
    fillPermitDeadlineVar(db, opts.projectId, now instanceof Date ? now : new Date(now)),
    fillWaccSourceVar(db, opts.runId),
    fillCertUnconfirmedVar(db, opts.projectId),
    fillCertInferredVar(db, opts.projectId),
    fillValidatorsMissingVar(db, opts.projectId, opts.runId, now instanceof Date ? now : new Date(now)),
    fillClassificationPresenceVar(db, opts.projectId),
  ];
  const written = new Set(rows.map((r) => r.var_key));
  if (rows.length !== SNAPSHOT_VAR_KEYS.length || SNAPSHOT_VAR_KEYS.some((k) => !written.has(k))) {
    throw new Error("snapshot-filler: internal invariant violated — families did not produce exactly one row per seeded var");
  }
  db.transaction(() => {
    for (const r of rows) {
      db.run(SQL_INSERT_SNAPSHOT, [opts.runId, opts.projectId, r.var_key, r.value_num, r.value_text, r.evidence_ref, r.observed_at, r.status]);
    }
  })();
  return { runId: opts.runId, projectId: opts.projectId, rows };
}
