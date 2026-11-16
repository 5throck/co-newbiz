// S6 evaluation-criteria panel helpers (ADR-0199): pure, client-safe. The DART reuse window mirrors
// db/repositories/dart-evidence-cache.repository.ts (that module pulls node:crypto, so it cannot be bundled here);
// tests/unit/s6-ai-eval-criteria-panel.test.ts asserts these constants equal the repository's.
import { type FinancialDataRef, parseRubric, rubricDefaults } from "../../../lib/brownfield-financial-rubric.ts";

export const DART_REUSE_DAYS = 30;
export const DART_REUSE_DAYS_FILING_SEASON = 7;

export interface CriterionRow {
  id: string;
  category: "financial" | "technical";
  source: "builtin" | "seeded" | "custom";
  label: string;
  data_ref: string | null;
  weight: number;
  rubric_json: string | null;
}

/** True when every threshold equals the code default (a missing/invalid rubric_json is the default). */
export function isDefaultRubric(ref: FinancialDataRef, json: string | null): boolean {
  const cur = parseRubric(ref, json);
  const def = rubricDefaults(ref);
  return Object.keys(def).every((k) => cur[k] === def[k]);
}

/** i18n key suffix + params of the plain-language rule sentence for one financial item, from live values. */
export function ruleSentence(ref: FinancialDataRef, rubric: Record<string, number>) {
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  switch (ref) {
    case "revenue_5y":
      return {
        key: "revenue",
        params: { ...rubric, cagrPassS: sign(rubric.cagrPass), cagrPartialS: sign(rubric.cagrPartial) },
      };
    case "operating_profit_5y":
      return { key: "operating", params: { ...rubric } };
    case "net_income_5y":
      return { key: "netIncome", params: { ...rubric } };
    case "debt_5y":
      return { key: "debt", params: { ...rubric } };
  }
}

/** Thresholds as a compact `key=value` line for a financial item's rubric snapshot (version comparison). */
export function rubricLine(rubric: Record<string, unknown> | null | undefined): string | null {
  if (!rubric) return null;
  const parts = Object.entries(rubric)
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => `${k} ${v}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** True when two snapshots of the same criterion carry different thresholds. */
export function rubricChanged(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
) {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}
