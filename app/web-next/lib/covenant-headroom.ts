// @version 2.0.0
/**
 * covenant-headroom — S10 financing-plan output "커버넌트 여력" (flow.spec S10
 * financing-plan activity; procedures/_shared/deal-structuring step 3 fin-03;
 * ADR-0122 #2 lists covenant headroom as a heatmap input).
 *
 * 2026-10-28 (D1, owner decision, ADR-0187 decision log): the headroom is COMPUTED by the same
 * deterministic function the S10 gate and the RAG covenant variable use
 * (lib/covenant-dscr.ts computeDownsideDscr: the adopted S8 case's downside CFADS against the
 * financing plan's debt terms). It no longer reads simulation/covenant_test rows - nothing ever
 * wrote them. The DSCR row's threshold is the declared DSCR covenant (debt_instrument.covenant_json)
 * or, when none is declared, the S10 floor (S10_MIN_DOWNSIDE_DSCR). Missing inputs →
 * insufficient_evidence naming the input (values are never invented).
 */
import type { getDb } from "../../../db/client.ts";
import { computeDownsideDscr, S10_MIN_DOWNSIDE_DSCR, type DscrReason, type DscrReport } from "./covenant-dscr.ts";

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
  /** insufficient_evidence only: why the DSCR could not be computed (see DscrReport.reason). */
  reason?: DscrReason;
  /** insufficient_evidence only: Korean message naming the missing input. */
  message?: string | null;
  covenants: CovenantHeadroomRow[];
  /** The deterministic computation behind the rows (scenario, per-year CFADS / service / DSCR). */
  dscr: DscrReport;
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
  const dscr = computeDownsideDscr(db, projectId);
  if (dscr.status !== "computed") {
    return { status: "insufficient_evidence", reason: dscr.reason, message: dscr.message, covenants: [], dscr };
  }
  const tested = dscr.periods.filter((p) => p.dscr !== null);
  if (tested.length === 0 || dscr.min_dscr === null) return { status: "computed", covenants: [], dscr };
  const declared = dscr.covenant_tests.length > 0;
  const threshold = declared ? dscr.covenant_tests[0].threshold : S10_MIN_DOWNSIDE_DSCR;
  const pct = headroomPct("min", threshold, dscr.min_dscr);
  const breachedYears = tested.filter((p) => (p.dscr as number) < threshold);
  const row: CovenantHeadroomRow = {
    covenant_key: "DSCR",
    direction: "min",
    min_headroom_pct: pct,
    tightest_period: breachedYears.length > 0 ? `Y${breachedYears[0].year}` : `Y${dscr.min_dscr_year}`,
    periods: tested.length,
    breached_periods: breachedYears.length,
    status: "ok",
  };
  if (row.breached_periods > 0) row.status = "breached";
  else if (row.min_headroom_pct !== null && row.min_headroom_pct < TIGHT_HEADROOM_PCT) row.status = "tight";
  return { status: "computed", covenants: [row], dscr };
}
