// @version 1.0.0
/**
 * covenant-headroom — S10 financing-plan output "커버넌트 여력" (flow.spec S10
 * financing-plan activity; procedures/_shared/deal-structuring step 3 fin-03;
 * ADR-0122 #2 lists covenant headroom as a heatmap input). Reads the latest
 * simulation's covenant_test rows for the project and reports, per covenant
 * key, the tightest headroom across periods. Direction (is the covenant a
 * ceiling or a floor?) comes from debt_instrument.covenant_json; when no
 * instrument declares it the headroom is null and only the engine's
 * `breached` flag is reported — never a guessed sign. No simulation, no
 * covenant rows → insufficient_evidence (values are never invented).
 */
import type { getDb } from "../../../db/client.ts";

type Db = ReturnType<typeof getDb>;

export type CovenantDirection = "max" | "min" | "unknown";
export type CovenantStatus = "breached" | "tight" | "ok" | "unknown_direction";

export interface CovenantHeadroomRow {
  covenant_key: string;
  direction: CovenantDirection;
  /** Tightest headroom across periods as a fraction of the threshold (0.08 = 8%); null when direction is unknown. */
  min_headroom_pct: number | null;
  /** Period id where the tightest headroom (or the first breach) occurs. */
  tightest_period: string | null;
  periods: number;
  breached_periods: number;
  status: CovenantStatus;
}

export interface CovenantHeadroomView {
  status: "computed" | "insufficient_evidence";
  reason?: "no_simulation" | "no_covenant_tests";
  simulation_id: string | null;
  covenants: CovenantHeadroomRow[];
}

/** Headroom below this fraction of the threshold is reported `tight`. */
export const TIGHT_HEADROOM_PCT = 0.1;

/**
 * Parse the per-instrument covenant_json into covenant key (lower-cased) →
 * direction. Accepted shapes (all lenient, unknown keys ignored):
 *   { "<key>": { "direction": "max" | "min" } }
 *   { "<key>": { "max": n } } / { "<key>": { "min": n } }
 *   { "<key>_min": n } / { "<key>_max": n }        (the /debt page's JSON form)
 *   [ { "key": "<key>", "direction": "max" | "min" } ]
 *   "DSCR >= 1.3 · NetLev <= 3.5x"                 (the /debt page's text form)
 * A key is registered both as written and with its _min/_max suffix stripped.
 */
export function parseCovenantDirections(raw: string | null | undefined): Record<string, CovenantDirection> {
  if (!raw?.trim()) return {};
  const out: Record<string, CovenantDirection> = {};
  const put = (key: string, dir: CovenantDirection) => {
    const k = key.trim().toLowerCase();
    if (!k) return;
    out[k] = dir;
    const stripped = k.replace(/[_-]?(min|max|floor|ceiling|lower|upper)$/i, "");
    if (stripped && stripped !== k) out[stripped] = dir;
  };
  const dirFromName = (name: string): CovenantDirection | null => {
    if (/max|ceiling|upper|<=|≤|상한/i.test(name)) return "max";
    if (/min|floor|lower|>=|≥|하한/i.test(name)) return "min";
    return null;
  };
  const fromSpec = (spec: unknown): CovenantDirection | null => {
    if (!spec || typeof spec !== "object") return null;
    const o = spec as Record<string, unknown>;
    if (o.direction === "max" || o.direction === "min") return o.direction;
    if (o.type === "max" || o.type === "min") return o.type;
    if (typeof o.max === "number") return "max";
    if (typeof o.min === "number") return "min";
    return null;
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    for (const m of raw.matchAll(/([A-Za-z][A-Za-z0-9_]*)\s*(>=|<=|≥|≤|>|<)\s*[0-9.]+/g)) {
      put(m[1], /^(>=|≥|>)$/.test(m[2]) ? "min" : "max");
    }
    return out;
  }
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const key = typeof (entry as { key?: unknown })?.key === "string" ? (entry as { key: string }).key : null;
      const dir = fromSpec(entry);
      if (key && dir) put(key, dir);
    }
    return out;
  }
  if (parsed && typeof parsed === "object") {
    for (const [key, spec] of Object.entries(parsed as Record<string, unknown>)) {
      const dir = typeof spec === "number" ? dirFromName(key) : fromSpec(spec);
      if (dir) put(key, dir);
    }
  }
  return out;
}

/** Signed headroom as a fraction of |threshold| — positive = inside the covenant. */
export function headroomPct(direction: CovenantDirection, threshold: number, projected: number): number | null {
  if (direction === "unknown" || !Number.isFinite(threshold) || threshold === 0) return null;
  const room = direction === "max" ? threshold - projected : projected - threshold;
  return Math.round((room / Math.abs(threshold)) * 10000) / 10000;
}

export function covenantHeadroom(db: Db, projectId: string): CovenantHeadroomView {
  const sim = db
    .query(
      `SELECT s.id FROM simulation s JOIN run r ON r.id = s.run_id
       WHERE r.project_id = ? ORDER BY s.created_at DESC, s.id DESC LIMIT 1`,
    )
    .get(projectId) as { id: string } | undefined;
  if (!sim) return { status: "insufficient_evidence", reason: "no_simulation", simulation_id: null, covenants: [] };

  const tests = db
    .query(
      `SELECT period_id, covenant_key, threshold, projected_value, breached
       FROM covenant_test WHERE simulation_id = ? ORDER BY covenant_key, period_id`,
    )
    .all(sim.id) as Array<{ period_id: string; covenant_key: string; threshold: number; projected_value: number; breached: number }>;
  if (tests.length === 0) return { status: "insufficient_evidence", reason: "no_covenant_tests", simulation_id: sim.id, covenants: [] };

  const directions: Record<string, CovenantDirection> = {};
  const instruments = db
    .query("SELECT covenant_json FROM debt_instrument WHERE project_id = ?")
    .all(projectId) as Array<{ covenant_json: string | null }>;
  for (const i of instruments) Object.assign(directions, parseCovenantDirections(i.covenant_json));

  const byKey = new Map<string, CovenantHeadroomRow>();
  for (const t of tests) {
    const direction = directions[t.covenant_key.toLowerCase()] ?? "unknown";
    const pct = headroomPct(direction, t.threshold, t.projected_value);
    const row = byKey.get(t.covenant_key) ?? {
      covenant_key: t.covenant_key,
      direction,
      min_headroom_pct: null,
      tightest_period: null,
      periods: 0,
      breached_periods: 0,
      status: "ok",
    };
    row.periods += 1;
    if (t.breached === 1) {
      row.breached_periods += 1;
      if (row.tightest_period === null || row.status !== "breached") row.tightest_period = t.period_id;
    }
    if (pct !== null && (row.min_headroom_pct === null || pct < row.min_headroom_pct)) {
      row.min_headroom_pct = pct;
      if (row.breached_periods === 0) row.tightest_period = t.period_id;
    }
    byKey.set(t.covenant_key, row);
  }
  for (const row of byKey.values()) {
    if (row.breached_periods > 0) row.status = "breached";
    else if (row.direction === "unknown") row.status = "unknown_direction";
    else if (row.min_headroom_pct !== null && row.min_headroom_pct < TIGHT_HEADROOM_PCT) row.status = "tight";
    else row.status = "ok";
  }
  return { status: "computed", simulation_id: sim.id, covenants: [...byKey.values()] };
}
