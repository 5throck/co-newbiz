// @version 1.0.0
/**
 * baseline-variance — S12 output "실행 기준선 대비 차이 (greenfield)" (flow.spec
 * S12 outputs/completionCriteria, ADR-0161: reference evidence, never gating).
 * Compares the S11 CONFIRMED execution baseline (capex tranches, hiring plan,
 * ramp-up KPI targets, permit/certification milestones, incentive obligations
 * — lib/greenfield-execution) with what the review cycle's venture_scorecard
 * rows actually recorded. Derived only: no table, no writes. Where the
 * scorecard has no row for a baseline item the row says insufficient_evidence
 * — the gap is reported, never filled in.
 */
import type { getDb } from "../../../db/client.ts";
import { latestConfirmedBaseline, trancheReconciliation, type BaselineEntries } from "./greenfield-execution.ts";
import { resolveTrack } from "./project-track.ts";

type Db = ReturnType<typeof getDb>;

export type VarianceArea = "capex" | "hiring" | "kpi" | "permits" | "certifications" | "incentives";
export type VarianceStatus = "on_plan" | "behind" | "ahead" | "insufficient_evidence";

export interface BaselineVarianceRow {
  area: VarianceArea;
  key: string;
  label: string;
  baseline: number | null;
  actual: number | null;
  /** actual − baseline in the row's unit; null when either side is missing. */
  variance: number | null;
  status: VarianceStatus;
  /** How "better" was read for this row — stated, never silent. */
  comparison: "count_due_by_cycle" | "higher_is_better_assumed" | "tranche_release_progress" | "reference_only";
  note: string | null;
}

export interface BaselineVarianceView {
  status: "not_applicable" | "no_confirmed_baseline" | "no_scorecard_cycle" | "computed";
  review_cycle: string | null;
  baseline_confirmed_at: string | null;
  rows: BaselineVarianceRow[];
  summary: Record<VarianceStatus, number>;
  gate_blocking: false;
}

const num = (v: string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** 'YYYY-QN' → the quarter's last day 'YYYY-MM-DD'; null for other shapes. */
export function quarterEnd(cycle: string): string | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(cycle);
  if (!m) return null;
  const month = Number(m[2]) * 3;
  const last = new Date(Date.UTC(Number(m[1]), month, 0)).getUTCDate();
  return `${m[1]}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

/** Hiring plan rows name a quarter ('YYYY-QN'); other shapes are treated as due (counted). */
const quarterDue = (q: string, cycle: string) => !/^\d{4}-Q[1-4]$/.test(q) || q <= cycle;

interface ScorecardRow { section: string; measure_key: string; target_value: string | null; actual_value: string | null; status: string }

function row(partial: Omit<BaselineVarianceRow, "variance" | "status"> & { status?: VarianceStatus }): BaselineVarianceRow {
  const variance = partial.baseline != null && partial.actual != null ? Math.round((partial.actual - partial.baseline) * 1000) / 1000 : null;
  let status: VarianceStatus = partial.status ?? "insufficient_evidence";
  if (!partial.status) {
    if (variance === null) status = "insufficient_evidence";
    else status = variance < 0 ? "behind" : variance > 0 ? "ahead" : "on_plan";
  }
  return { ...partial, variance, status };
}

export function buildBaselineVariance(db: Db, projectId: string, entries: BaselineEntries, cycle: string, scorecard: ScorecardRow[]): BaselineVarianceRow[] {
  const end = quarterEnd(cycle);
  const sc = (key: string) => scorecard.find((r) => r.measure_key === key);
  const rows: BaselineVarianceRow[] = [];

  // Capex — tranche release progress against the baseline tranche schedule; the
  // scorecard's capex_deployed_vs_tranche row (if any) supplies the deployed figure.
  const rec = trancheReconciliation(projectId, db);
  if (rec.tranches.length > 0) {
    const released = rec.tranches.filter((t) => t.status === "released").reduce((a, t) => a + t.amount, 0);
    const deployed = sc("capex_deployed_vs_tranche");
    rows.push(row({
      area: "capex", key: "capex_deployed_vs_tranche", label: "설비투자 집행 (트랜치 대비)",
      baseline: released, actual: deployed ? num(deployed.actual_value) : null,
      comparison: "tranche_release_progress",
      note: `트랜치 ${rec.tranches.length}개 · 계획 합계 ${rec.tranche_total} · 릴리스 ${released}${deployed ? "" : " — 스코어카드에 집행 실적 행 없음"}`,
    }));
  }

  // Hiring — headcount due by the cycle vs the scorecard's headcount_vs_plan actual.
  if (entries.hiring_plan.length > 0) {
    const due = entries.hiring_plan.filter((h) => quarterDue(h.quarter, cycle)).reduce((a, h) => a + h.headcount, 0);
    const hc = sc("headcount_vs_plan");
    rows.push(row({
      area: "hiring", key: "headcount_vs_plan", label: "채용 (계획 대비 인원)",
      baseline: due, actual: hc ? num(hc.actual_value) : null, comparison: "count_due_by_cycle",
      note: hc ? null : "스코어카드에 headcount_vs_plan 행 없음",
    }));
  }

  // Ramp-up KPI targets — each target due by the cycle vs goal:<metric_key> (or the bare key).
  for (const k of entries.kpi_targets) {
    if (end && k.due > end) continue;
    const r = sc(`goal:${k.metric_key}`) ?? sc(k.metric_key);
    rows.push(row({
      area: "kpi", key: k.metric_key, label: `가동 KPI — ${k.metric_key}${k.unit ? ` (${k.unit})` : ""}`,
      baseline: k.target_value, actual: r ? num(r.actual_value) : null, comparison: "higher_is_better_assumed",
      note: r ? `기한 ${k.due}` : `기한 ${k.due} — 스코어카드에 실적 행 없음`,
    }));
  }

  // Permit / certification milestones — count due by the cycle vs *_milestones_met actual.
  for (const [area, list, key, label] of [
    ["permits", entries.permit_milestones, "permit_milestones_met", "인허가 마일스톤 달성"],
    ["certifications", entries.certification_milestones, "certification_milestones_met", "인증 마일스톤 달성"],
  ] as const) {
    if (list.length === 0) continue;
    const due = list.filter((m) => !end || m.target_date <= end).length;
    const met = sc(key);
    rows.push(row({
      area, key, label, baseline: due, actual: met ? num(met.actual_value) : null, comparison: "count_due_by_cycle",
      note: `기한 도래 ${due}/${list.length}${met ? "" : " — 스코어카드에 달성 건수 행 없음"}`,
    }));
  }

  // Incentive obligations — reference only (no scorecard measure exists for them).
  const dueObligations = entries.incentive_obligations.filter((o) => !o.deadline || !end || o.deadline <= end);
  if (entries.incentive_obligations.length > 0) {
    rows.push(row({
      area: "incentives", key: "incentive_obligations_due", label: "인센티브 의무 (기한 도래)",
      baseline: dueObligations.length, actual: null, comparison: "reference_only", status: "insufficient_evidence",
      note: `기한 도래 ${dueObligations.length}/${entries.incentive_obligations.length} — 이행 여부는 인센티브 화면·증적으로 확인`,
    }));
  }
  return rows;
}

export function baselineVariance(db: Db, projectId: string, reviewCycle?: string | null): BaselineVarianceView {
  const empty: Record<VarianceStatus, number> = { on_plan: 0, behind: 0, ahead: 0, insufficient_evidence: 0 };
  const base = { review_cycle: null, baseline_confirmed_at: null, rows: [], summary: { ...empty }, gate_blocking: false as const };
  if (resolveTrack(projectId, db).track !== "greenfield") return { status: "not_applicable", ...base };
  const baseline = latestConfirmedBaseline(projectId, db);
  if (!baseline?.confirmation) return { status: "no_confirmed_baseline", ...base };
  const cycle = reviewCycle ?? (db.query("SELECT MAX(review_cycle) AS c FROM venture_scorecard WHERE project_id = ?").get(projectId) as { c: string | null }).c;
  if (!cycle) return { status: "no_scorecard_cycle", ...base, baseline_confirmed_at: baseline.confirmation.confirmed_at ?? baseline.recorded_at };
  const scorecard = db
    .query("SELECT section, measure_key, target_value, actual_value, status FROM venture_scorecard WHERE project_id = ? AND review_cycle = ?")
    .all(projectId, cycle) as ScorecardRow[];
  const rows = buildBaselineVariance(db, projectId, baseline.entries, cycle, scorecard);
  const summary = { ...empty };
  for (const r of rows) summary[r.status] += 1;
  return { status: "computed", review_cycle: cycle, baseline_confirmed_at: baseline.confirmation.confirmed_at ?? baseline.recorded_at, rows, summary, gate_blocking: false };
}
