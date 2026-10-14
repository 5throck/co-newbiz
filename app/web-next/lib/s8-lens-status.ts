// S8 two-lens status (ADR-0169, design 2026-10-14-s8-technical-financial-lens §2.2).
// Pure and client-safe: the deterministic status rules for the summary strip.
// Decision support only: nothing here caps a grade, edits a number or blocks a
// gate; the final judgement and every gate approval stay with people.
import { LENS_STATUS_LABEL, type LensStatus } from "./technical-lens.ts";

export { LENS_STATUS_LABEL };
export type { LensStatus };

/** One constant for the financial thresholds (reuses the FS kill criterion "hurdle miss on base"). */
export const FINANCIAL_LENS_THRESHOLDS = { downsideNpvP50MinKrwM: 0 } as const;

export const LENS_STRIP_CAPTION = "판단 보조 — 최종 판단과 게이트 승인은 사람이 합니다";
export const TECHNICAL_CAUTION_WARNING = "기술적 타당성 주의 — 재무 수치는 필요 역량·기술 확보를 전제로 합니다";
export const LENS_STRIP_HELP =
  "충족: 모든 항목을 사람이 판정했고 문제가 없음. 주의: 확인이 필요한 항목이 있음. 미판정: 사람이 판정하지 않은 항목이 있음. 등급 상한이나 게이트 차단에는 쓰이지 않습니다.";

export const LENS_VIEW: Record<LensStatus, { icon: string; label: string; cls: string }> = {
  met: { icon: "✓", label: LENS_STATUS_LABEL.met, cls: "status-green" },
  caution: { icon: "!", label: LENS_STATUS_LABEL.caution, cls: "status-amber" },
  undetermined: { icon: "?", label: LENS_STATUS_LABEL.undetermined, cls: "status-not-started" },
};

export interface FinancialLensInput {
  /** A human-adopted case exists. */
  hasAdoptedCase: boolean;
  /** Base-scenario p50 IRR (fraction, 0.15 = 15%); null when no simulation. */
  baseIrr: number | null;
  /** Hurdle IRR (fraction); null when none is confirmed (the comparison is then skipped). */
  hurdleIrr: number | null;
  /** Downside-scenario NPV p50 in KRW million; null when missing. */
  downsideNpvP50: number | null;
  /** Goals with status "missed" for the adopted case. */
  missedGoals: number;
  goalCount: number;
}

export interface FinancialLensSummary {
  status: LensStatus;
  reasons: string[];
  baseIrr: number | null;
  hurdleIrr: number | null;
  downsideNpvP50: number | null;
  missedGoals: number;
  goalCount: number;
}

/** 미판정 without an adopted case or base simulation; 주의 on a hurdle miss, a missed goal or downside NPV p50 < 0; else 충족. */
export function financialLensStatus(i: FinancialLensInput): FinancialLensSummary {
  const base = { baseIrr: i.baseIrr, hurdleIrr: i.hurdleIrr, downsideNpvP50: i.downsideNpvP50, missedGoals: i.missedGoals, goalCount: i.goalCount };
  if (!i.hasAdoptedCase) return { status: "undetermined", reasons: ["채택된 사업성 케이스가 없습니다."], ...base };
  if (i.baseIrr === null) return { status: "undetermined", reasons: ["기본 시나리오 시뮬레이션이 없습니다."], ...base };
  const reasons: string[] = [];
  if (i.hurdleIrr !== null && i.baseIrr < i.hurdleIrr) reasons.push("기본 시나리오 IRR이 목표 수익률에 못 미칩니다.");
  if (i.missedGoals > 0) reasons.push(`미달 사업 목표 ${i.missedGoals}건`);
  if (i.downsideNpvP50 !== null && i.downsideNpvP50 < FINANCIAL_LENS_THRESHOLDS.downsideNpvP50MinKrwM) reasons.push("하방 시나리오 NPV(p50)가 0 미만입니다.");
  return { status: reasons.length > 0 ? "caution" : "met", reasons, ...base };
}

export interface LensCardView {
  status: LensStatus;
  icon: string;
  label: string;
  cls: string;
}
export function lensCard(status: LensStatus): LensCardView {
  return { status, ...LENS_VIEW[status] };
}

export interface S8LensStripView {
  technical: LensCardView & { judged: number; total: number; cautionCount: number; worstItem: string | null; mismatchCount: number };
  financial: LensCardView & { reasons: string[] };
  /** Shown only for a technical 주의; warning, never a cap. */
  warning: string | null;
  caption: string;
  help: string;
}

export function buildLensStripView(
  technical: { status: LensStatus; judged: number; total: number; cautionCount: number; worstItem: string | null; mismatchCount?: number },
  financial: { status: LensStatus; reasons: string[] },
): S8LensStripView {
  return {
    technical: { ...lensCard(technical.status), judged: technical.judged, total: technical.total, cautionCount: technical.cautionCount, worstItem: technical.worstItem, mismatchCount: technical.mismatchCount ?? 0 },
    financial: { ...lensCard(financial.status), reasons: financial.reasons },
    warning: technical.cautionCount > 0 ? TECHNICAL_CAUTION_WARNING : null,
    caption: LENS_STRIP_CAPTION,
    help: LENS_STRIP_HELP,
  };
}

/** One informational gate-brief line (fs gate); never a block. */
export function technicalLensBriefLine(t: { status: LensStatus; judged: number; total: number; cautionItems: string[] }): string {
  const items = t.cautionItems.length > 0 ? `, 주의 항목 ${t.cautionItems.join("·")}` : "";
  return `기술적 타당성: ${LENS_STATUS_LABEL[t.status]} (판정 ${t.judged}/${t.total}${items}) — 참고 정보이며 승인 조건이 아닙니다`;
}
