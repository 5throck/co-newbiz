// Client-safe types and formatting for business-target standards
// (md_business_target, ADR-0114). Split from lib/business-targets.ts so the
// admin console and the fs evidence table can format values in the browser —
// the server module owns the DB logic and re-exports from here.

import { fmtNpvEok } from "./npv-format.ts";

export type TargetDirection = "gte" | "lte"; // gte = 이상, lte = 이하

export type TargetUnit = "krw_m" | "pct" | "years" | "none";

export interface MetricPreset {
  key: string;
  label: string; // Korean UI label
  direction: TargetDirection;
  unit: TargetUnit;
  /** false → the fs evidence table shows "수동 확인" instead of a computed actual. */
  computable: boolean;
}

/** Curated presets — stored as metric_key rows so operators can add rows without
 * a migration; anything outside this list must use metric_key='custom' + label. */
export const METRIC_PRESETS: MetricPreset[] = [
  { key: "revenue", label: "연매출 (최종 연도)", direction: "gte", unit: "krw_m", computable: true },
  { key: "operating_margin", label: "영업이익률 (최종 연도)", direction: "gte", unit: "pct", computable: true },
  { key: "period", label: "사업계획 기간", direction: "lte", unit: "years", computable: true },
  { key: "npv", label: "NPV (권장 시나리오 p50)", direction: "gte", unit: "krw_m", computable: true },
  { key: "irr", label: "IRR (권장 시나리오 p50)", direction: "gte", unit: "pct", computable: true },
];

export const CUSTOM_METRIC_KEY = "custom";

const DIRECTIONS = new Set<TargetDirection>(["gte", "lte"]);

export function parseDirection(value: unknown): TargetDirection | null {
  return typeof value === "string" && DIRECTIONS.has(value as TargetDirection) ? (value as TargetDirection) : null;
}

export function parseTargetValue(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function presetFor(metricKey: string): MetricPreset | null {
  return METRIC_PRESETS.find((p) => p.key === metricKey) ?? null;
}

/** Storage units (ADR-0061 money = KRW millions, ratios for %) vs the input
 * units the UI collects from the operator. */
export interface UnitSpec {
  /** Operator-facing unit label next to the value input. */
  inputLabel: string;
  /** multiplier: stored = input × factor. */
  factor: number;
}

export function unitSpec(unit: TargetUnit): UnitSpec {
  if (unit === "krw_m") return { inputLabel: "억원", factor: 100 };
  if (unit === "pct") return { inputLabel: "%", factor: 0.01 };
  if (unit === "years") return { inputLabel: "년", factor: 1 };
  return { inputLabel: "", factor: 1 };
}

/** Display formatting shared by the admin console and the fs evidence table.
 * Money targets are stored in KRW millions (ADR-0061) and shown in 억원. */
export function formatTargetValue(value: number, unit: TargetUnit): string {
  if (unit === "krw_m") return fmtNpvEok(value);
  if (unit === "pct") return `${(value * 100).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
  if (unit === "none") return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}년`;
}

export function formatDirectionLabel(direction: TargetDirection): string {
  return direction === "gte" ? "이상" : "이하";
}

export function formatDirectionSymbol(direction: TargetDirection): string {
  return direction === "gte" ? "≥" : "≤";
}
