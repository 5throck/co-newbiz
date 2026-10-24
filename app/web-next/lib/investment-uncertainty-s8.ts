// ADR-0176 slice 4: S8 evaluation surface for investment uncertainty. Pure read side - the values
// come from the latest CONFIRMED S5 simulation run (S5 owns editing, confirming and re-running).
// Everything here is labeled simulation output / proposal: no gate block, no grade cap, no adoption
// trigger. A missing or stale run is informational, never blocking.
import type { Database } from "bun:sqlite";
import { getLatestConfirmedInvestmentSimulationRun } from "../../../db/repositories/investment-simulation-run.repository.ts";
import { sourceOpportunityOf } from "./capability-attainability.ts";
import { s5SimStatusForProject, type S5SimStaleReason, type S5SimState } from "./investment-simulation-s8.ts";
import type { SimulationResults, TornadoKey } from "./investment-simulation.ts";
import { formatInteger, type Locale } from "./format.ts";

export const INVEST_UNCERTAINTY_LABEL = "시뮬레이션 산출물(제안) - 게이트·등급·채택에 영향 없음";
export const INVEST_UNCERTAINTY_NONE_LINE = "투자 불확실성: 확정된 S5 투자 시뮬레이션이 없습니다 - 참고 정보이며 차단하지 않습니다";

export const INVEST_TORNADO_LABEL: Record<TornadoKey, string> = {
  salary: "급여", salaryIncrease: "급여 인상률", onCost: "가산율", ramp: "투입 시점",
  capability: "역량 비용", manualLines: "일반 항목", fx: "환율 (미적용)",
};

export interface InvestUncertaintyRun {
  id: string;
  hash: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  drawCount: number;
}

export interface InvestUncertaintyView {
  /** True when a confirmed S5 run exists; false -> only the informational line is shown. */
  hasRun: boolean;
  /** Source opportunity (S5 owner) for the link to the S5 simulation tab; null when unknown. */
  opportunityId: string | null;
  run: InvestUncertaintyRun | null;
  /** 총 투자비 over the horizon, 백만원. */
  total: { p50: number; p95: number } | null;
  /** Present only when the person set an envelope on the run. */
  exceed: { envelopeKrwM: number; probability: number } | null;
  topSensitivities: Array<{ key: TornadoKey; label: string; share: number; swingKrwM: number }>;
  /** Whether the latest S8 case's NPV distribution includes investment uncertainty (chip). */
  npv: { state: S5SimState; stale: boolean; reason: S5SimStaleReason | null; label: string; includes: boolean };
  disclaimer: string;
  infoLine: string | null;
}

/** Block data for the S8 evaluation summary. Never throws: a failure degrades to "no run". */
export function buildInvestUncertainty(db: Database, projectId: string): InvestUncertaintyView {
  const empty = (state?: ReturnType<typeof s5SimStatusForProject>, opportunityId: string | null = null): InvestUncertaintyView => ({
    hasRun: false, opportunityId, run: null, total: null, exceed: null, topSensitivities: [],
    npv: { state: state?.state ?? "not_applicable", stale: state?.stale ?? false, reason: state?.reason ?? null, label: state?.label ?? "", includes: false },
    disclaimer: INVEST_UNCERTAINTY_LABEL, infoLine: INVEST_UNCERTAINTY_NONE_LINE,
  });
  try {
    const status = s5SimStatusForProject(db, projectId);
    const opp = sourceOpportunityOf(db, projectId);
    const run = opp ? getLatestConfirmedInvestmentSimulationRun(opp, db) : null;
    if (!run) return empty(status, opp);
    const r = run.results as SimulationResults;
    return {
      hasRun: true,
      opportunityId: opp,
      run: { id: run.id, hash: run.input_hash, confirmedBy: run.confirmed_by, confirmedAt: run.confirmed_at, drawCount: run.draw_count },
      total: { p50: r.total.p50, p95: r.total.p95 },
      exceed: r.exceed ? { envelopeKrwM: r.exceed.envelopeKrwM, probability: r.exceed.probability } : null,
      topSensitivities: (r.tornado ?? []).filter((t) => t.active).slice(0, 3).map((t) => ({ key: t.key, label: INVEST_TORNADO_LABEL[t.key], share: t.share, swingKrwM: t.swingKrwM })),
      npv: { state: status.state, stale: status.stale, reason: status.reason, label: status.label, includes: status.state === "in_effect" },
      disclaimer: INVEST_UNCERTAINTY_LABEL,
      infoLine: null,
    };
  } catch {
    return empty(); // migration 0144/0146 pending or unreadable: behave as "no run"
  }
}

const fmt = (n: number, locale: Locale | string = "ko"): string => formatInteger(Math.round(n), locale);

/** Compact brief text for the fs gate brief and the AI judgement support; labeled simulation output. */
export function investUncertaintyBriefText(v: InvestUncertaintyView, locale: Locale | string = "ko"): string {
  if (!v.hasRun || !v.run || !v.total) return INVEST_UNCERTAINTY_NONE_LINE;
  const parts = [
    `총 투자비 p50 ${fmt(v.total.p50, locale)} / p95 ${fmt(v.total.p95, locale)} 백만원`,
    v.exceed ? `예산 상한 ${fmt(v.exceed.envelopeKrwM, locale)} 백만원 초과 확률 ${(v.exceed.probability * 100).toFixed(1)}%` : "",
    v.topSensitivities.length > 0 ? `주요 민감도 ${v.topSensitivities.map((t) => `${t.label} ${(t.share * 100).toFixed(0)}%`).join(", ")}` : "",
    v.npv.state === "stale" ? "NPV 분포 투자 불확실성 반영: 재평가 필요" : v.npv.includes ? "NPV 분포에 투자 불확실성 반영" : "NPV 분포에 투자 불확실성 미반영",
  ].filter(Boolean);
  return `${parts.join(" · ")} (S5 확정 실행 ${v.run.hash.slice(0, 12)}, 확정 ${v.run.confirmedBy ?? "-"} @ ${(v.run.confirmedAt ?? "").slice(0, 10)}) - ${INVEST_UNCERTAINTY_LABEL}`;
}
