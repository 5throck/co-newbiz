// @version 1.0.0
/**
 * Uncertainty scope of an S8 run (Monte Carlo verification D7, 2026-10-28).
 *
 * The NPV p05/p50/p95 band only reflects the drivers that are actually DRAWN. In the default
 * S8 job-spec that is revenue growth (plus the FX index when active, plus the confirmed S5
 * investment-plan draws under an s5_plan basis); opex/capex ratios, the initial investment,
 * the ramp-up curve and the discount rate (WACC) are constants. This module states that
 * fact explicitly so a reader never mistakes a narrow band for a precise forecast, and the
 * run snapshot (business_case_model.inputs_json) records it next to the drivers it describes.
 *
 * Pure and client-safe (no DB import): the generator writes `uncertainty_scope` into the job
 * spec; the read side re-derives it from the stored drivers for snapshots that predate it.
 * It never invents a distribution - quant-methodologist owns adding new uncertain drivers.
 */

export type UncertaintyDriver =
  | "revenue_growth"
  | "fx_index"
  | "s5_investment"
  | "revenue_y1"
  | "ramp_up"
  | "opex_ratio"
  | "capex_ratio"
  | "initial_investment"
  | "exit_ev_revenue"
  | "discount_rate";

/** Why an S5 run did or did not feed this run. */
export type S5RunUse = "applied" | "none_confirmed" | "basis_not_paired" | "no_s5_plan";

export interface UncertaintyScope {
  version: 1;
  /** Drivers drawn in the simulation (the band reflects exactly these). */
  varied: UncertaintyDriver[];
  /** Drivers held at a single value (their uncertainty is NOT in the band). */
  held_constant: UncertaintyDriver[];
  s5_run: S5RunUse;
  /** Hash of the S5 simulation run paired in (present only when `s5_run === "applied"`). */
  s5_sim_hash?: string | null;
}

const CONSTANT_DRIVER_KEYS: UncertaintyDriver[] = ["revenue_y1", "ramp_up", "opex_ratio", "capex_ratio", "initial_investment", "exit_ev_revenue"];

/**
 * Derive the scope from a job-spec's first case drivers (+ the S5 pairing facts the drivers
 * cannot express). `discount_rate` is always constant in the engine contract.
 */
export function deriveUncertaintyScope(
  drivers: Record<string, { dist?: string } | undefined>,
  s5: { run: S5RunUse; simHash?: string | null },
): UncertaintyScope {
  const varied: UncertaintyDriver[] = [];
  const held: UncertaintyDriver[] = [];
  for (const key of ["revenue_growth", "fx_index"] as const) {
    const d = drivers[key];
    if (d && d.dist && d.dist !== "constant") varied.push(key);
    else if (d) held.push(key);
  }
  for (const key of CONSTANT_DRIVER_KEYS) {
    const d = drivers[key];
    if (!d) continue;
    if (d.dist && d.dist !== "constant") varied.push(key);
    else held.push(key);
  }
  if (s5.run === "applied") {
    varied.push("s5_investment");
    // The S5 capex schedule is drawn per iteration; the ratio driver is zeroed under the plan.
    const i = held.indexOf("capex_ratio");
    if (i >= 0) held.splice(i, 1);
  }
  held.push("discount_rate");
  return { version: 1, varied, held_constant: held, s5_run: s5.run, ...(s5.run === "applied" ? { s5_sim_hash: s5.simHash ?? null } : {}) };
}

/** Parse the scope out of a stored snapshot (inputs_json); legacy snapshots are derived from their drivers. */
export function uncertaintyScopeOfSnapshot(inputsJson: string | null | undefined): UncertaintyScope | null {
  if (!inputsJson) return null;
  try {
    const spec = JSON.parse(inputsJson) as { uncertainty_scope?: UncertaintyScope; cases?: Array<{ drivers?: Record<string, { dist?: string }> }>; drivers?: Record<string, { dist?: string }> };
    if (spec.uncertainty_scope && Array.isArray(spec.uncertainty_scope.varied) && Array.isArray(spec.uncertainty_scope.held_constant)) return spec.uncertainty_scope;
    const drivers = spec.cases?.[0]?.drivers ?? spec.drivers;
    // Legacy snapshot: the S5 pairing is not recorded, so it is not claimed either way.
    return drivers ? deriveUncertaintyScope(drivers, { run: "no_s5_plan" }) : null;
  } catch {
    return null;
  }
}

/**
 * Read-time scope of one case: the band label exists only where a simulation band is shown, so a
 * case without simulation rows (e.g. a manual / greenfield_cost model) is null. Otherwise the
 * stored scope, or - for snapshots that predate it - the one derived from the stored drivers.
 */
export function uncertaintyScopeForCase(inputsJson: string | null | undefined, simulationCount: number): UncertaintyScope | null {
  return simulationCount > 0 ? uncertaintyScopeOfSnapshot(inputsJson) : null;
}

/** True when the only drawn driver is revenue growth - the common case the owner-mandated label addresses. */
export function isGrowthOnly(scope: UncertaintyScope): boolean {
  return scope.varied.length === 1 && scope.varied[0] === "revenue_growth";
}
