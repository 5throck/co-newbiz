// @version 1.0.0
/**
 * kosis-units.ts — explicit mapping from KOSIS unit strings to md_unit rows.
 *
 * The design contract (2026-09-09-source-adapter-framework-design_ko.md §2.3):
 * a KOSIS unit string that has no entry here is QUARANTINED, never
 * auto-converted — a silently wrong unit poisons every downstream analysis
 * (FR-DATA-03: cross-dimension conversions go through proxy_link, not ad hoc
 * math). Extend this table when onboarding a series with a new unit.
 */

export interface KosisUnitMapping {
  /** md_unit.code to upsert/use */
  unitCode: string;
  /** md_unit.dimension — conversions across dimensions are forbidden */
  dimension: string;
  /** md_unit.si_coefficient (value × coefficient = SI base) */
  siCoefficient: number;
}

export const KOSIS_UNITS: Record<string, KosisUnitMapping> = {
  "명": { unitCode: "persons", dimension: "count", siCoefficient: 1 },
  "개소": { unitCode: "count", dimension: "count", siCoefficient: 1 },
  "억원": { unitCode: "krw_100m", dimension: "krw", siCoefficient: 1e8 },
  "조원": { unitCode: "krw_1t", dimension: "krw", siCoefficient: 1e12 },
  "백만원": { unitCode: "krw_1m", dimension: "krw", siCoefficient: 1e6 },
  "%": { unitCode: "percent", dimension: "ratio", siCoefficient: 0.01 },
  "지수": { unitCode: "index", dimension: "index", siCoefficient: 1 },
  "톤": { unitCode: "ton", dimension: "mass", siCoefficient: 1000 },
  "kW": { unitCode: "kw", dimension: "power", siCoefficient: 1000 },
  "MW": { unitCode: "mw", dimension: "power", siCoefficient: 1e6 },
  "GWh": { unitCode: "gwh", dimension: "energy", siCoefficient: 3.6e12 },
};

/** Resolve a KOSIS unit string; null means quarantine (unknown unit). */
export function resolveKosisUnit(unit: string | undefined): KosisUnitMapping | null {
  if (!unit) return null;
  const key = unit.trim();
  return KOSIS_UNITS[key] ?? null;
}
