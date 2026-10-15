// ADR-0176 slice 2: rebuild the simulation inputs from the SAVED S5 plan (same derivation the
// S5 page uses client-side), so a stored run is tied to stored data and never to unsaved edits.
import type { Database } from "bun:sqlite";
import { readRegister } from "./capability-attainability.ts";
import { deriveCapabilityCostLines, DEFAULT_HORIZON_YEARS, isCapabilityEntry, isPlanMetaEntry, normalizeLegacyLine, planMetaOf, simOverridesOf, sourceRowOf } from "./capability-cost-lines.ts";
import { fitPlanToHorizon, isStaffingPlanEntry, staffingPlanOf } from "./staffing-plan.ts";
import type { InvestmentVectorsInput } from "./investment-vectors.ts";

/** Null when the opportunity has no saved plan lines at all (nothing to simulate). */
export function loadInvestmentVectorsInput(db: Database, oppId: string): InvestmentVectorsInput | null {
  const assessment = db
    .query("SELECT business_case_lines_json FROM greenfield_assessment WHERE opportunity_id = ? ORDER BY updated_at DESC LIMIT 1")
    .get(oppId) as { business_case_lines_json: string | null } | null;
  let lines: unknown = null;
  try { lines = assessment?.business_case_lines_json ? JSON.parse(assessment.business_case_lines_json) : null; } catch { lines = null; }
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const meta = planMetaOf(lines);
  const horizon = meta?.horizonYears ?? DEFAULT_HORIZON_YEARS;
  const reg = readRegister(db, oppId);
  const costView = deriveCapabilityCostLines((reg?.rows ?? []).map(sourceRowOf), lines);
  const reflectedKeys = new Set(costView.lines.filter((l) => l.reflected).map((l) => l.capabilityKey));
  const manual = (lines.filter((l) => !isCapabilityEntry(l) && !isPlanMetaEntry(l) && !isStaffingPlanEntry(l)) as Array<Record<string, unknown>>).map(normalizeLegacyLine);
  const stored = staffingPlanOf(lines);
  const fitted = stored ? fitPlanToHorizon(stored, horizon) : null;
  return {
    manual,
    capLines: costView.lines,
    horizon,
    reflectedKeys,
    staffing: fitted && fitted.rows.length > 0 ? fitted : null,
    overrides: simOverridesOf(meta),
  };
}
