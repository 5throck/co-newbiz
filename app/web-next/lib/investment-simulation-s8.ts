// ADR-0176 slice 3: S8 consumption of the S5 investment simulation, provenance and staleness.
// Pure read side. The S8 generator takes the latest CONFIRMED S5 run's draw factors (per-draw
// pairing: draw index d is the same factor draw at S5 and S8, recomputed from the stored seed, draw
// count and ranges - per-draw vectors are never stored). A run is only ever confirmed by a person.
// Staleness follows the ADR-0170 pattern: compare hashes, flag, never auto-recompute. A missing S5
// simulation is surfaced, never blocking: no gate block, no grade effect.
import type { Database } from "bun:sqlite";
import { getLatestConfirmedInvestmentSimulationRun } from "../../../db/repositories/investment-simulation-run.repository.ts";
import { drawInvestmentFactors, simulationInputHash } from "./investment-simulation.ts";
import { loadInvestmentVectorsInput } from "./investment-simulation-input.ts";
import type { effectiveAssumptions } from "./investment-vectors.ts";

/** Per-draw group factors of the latest confirmed S5 run (ramp/salary groups need staffing, which S8 does not carry). */
export interface S5SimConsumption {
  runId: string;
  inputHash: string;
  seed: number;
  drawCount: number;
  capFactors: number[];
  manFactors: number[];
}

/** Draw index used by S8 iteration `it` - the S8 iteration count differs from the S5 draw count. */
export const pairedDrawIndex = (iteration: number, drawCount: number): number => iteration % drawCount;

/** Latest confirmed run's draw factors for the opportunity, or null (no table/column yet, no run, none confirmed). */
export function resolveS5SimConsumption(db: Database, opportunityId: string | null | undefined): S5SimConsumption | null {
  if (!opportunityId) return null;
  try {
    const run = getLatestConfirmedInvestmentSimulationRun(opportunityId, db);
    if (!run) return null;
    const eff = run.assumptions as ReturnType<typeof effectiveAssumptions>;
    const factors = drawInvestmentFactors(run.seed, run.draw_count, eff);
    return {
      runId: run.id,
      inputHash: run.input_hash,
      seed: run.seed,
      drawCount: run.draw_count,
      capFactors: factors.map((f) => f.cap),
      manFactors: factors.map((f) => f.man),
    };
  } catch {
    return null; // migration 0144/0146 pending: behave as "no run"
  }
}

/** `s5_sim=<hash>` / `s5_sim=none` fragment of a valuation_simulation note, or null when absent (ratio basis / legacy notes). */
export function s5SimFragmentOfNote(note: string | null | undefined): string | null {
  const m = /(?:^|;\s*)s5_sim=([^;\s]+)/.exec(note ?? "");
  return m ? m[1] : null;
}

export type S5SimState = "not_applicable" | "none" | "in_effect" | "stale";
export type S5SimStaleReason = "run_confirmed_after_generation" | "run_changed" | "s5_lines_changed" | "run_missing";

export interface S5SimStatus {
  state: S5SimState;
  /** `재평가 필요` badge flag (state === "stale"). */
  stale: boolean;
  reason: S5SimStaleReason | null;
  /** Hash recorded by the latest S8 case (or "none"). */
  used: string | null;
  /** Latest confirmed S5 run hash, if any. */
  latest: string | null;
  label: string;
}

const LABEL: Record<S5SimState, string> = {
  not_applicable: "",
  none: "투자 불확실성 미반영 (S5 시뮬레이션 없음)",
  in_effect: "S5 투자 시뮬레이션 반영",
  stale: "재평가 필요",
};

/**
 * Staleness of the latest S8 s5_plan case against the S5 simulation. Reads the project's most recent
 * s5_plan valuation_simulation note; never recomputes anything. `not_applicable` when no s5_plan case
 * has been generated (ratio basis, brownfield, nothing run yet).
 */
export function s5SimStatusForProject(db: Database, projectId: string): S5SimStatus {
  const mk = (state: S5SimState, reason: S5SimStaleReason | null, used: string | null, latest: string | null): S5SimStatus =>
    ({ state, stale: state === "stale", reason, used, latest, label: LABEL[state] });
  const proj = db.query("SELECT source_opportunity_id FROM md_project WHERE id = ?").get(projectId) as { source_opportunity_id: string | null } | null;
  const row = db
    .query("SELECT note FROM valuation_simulation WHERE project_id = ? AND note LIKE '%basis=s5_plan%' ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(projectId) as { note: string | null } | null;
  const used = s5SimFragmentOfNote(row?.note);
  if (!row || used === null) return mk("not_applicable", null, null, null);
  let latest: string | null = null;
  let current: string | null = null;
  const opp = proj?.source_opportunity_id ?? null;
  if (opp) {
    try {
      const run = getLatestConfirmedInvestmentSimulationRun(opp, db);
      if (run) {
        latest = run.input_hash;
        const input = loadInvestmentVectorsInput(db, opp);
        current = input ? simulationInputHash(input, run.seed, run.draw_count) : null;
      }
    } catch {
      latest = null;
    }
  }
  if (used === "none") return latest ? mk("stale", "run_confirmed_after_generation", used, latest) : mk("none", null, used, null);
  if (!latest) return mk("stale", "run_missing", used, null);
  if (latest !== used) return mk("stale", "run_changed", used, latest);
  if (current !== latest) return mk("stale", "s5_lines_changed", used, latest);
  return mk("in_effect", null, used, latest);
}
