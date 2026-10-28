"use client";

import { fmtNpvEok } from "@/lib/npv-format";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { useTranslations } from "next-intl";
import { api } from "../../../../lib/api.ts";
import { ColGroup, PageState, useToast } from "../../../../components/ui.tsx";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

const BACKTEST_COL_PCT = [30, 10, 15, 15, 15, 15] as const;

// 예측-실적 백테스트 (ADR-0123 #3) — 조직 집계(전체 검토/안건)를 보여주고 이 검토/안건의
// 행을 강조한다. 증거 부족은 honest degradation (가공 없음). 2026-10-21: 편향 통계
// (부호 평균 괴리·과대/과소 건수·방향), kill 학습 딜 코퍼스 포함, 그리고 데이터 신뢰도
// 등급 조정 제안·승인(사람) — 승인된 조정은 RAG 신뢰도 캡을 낮추기만 한다 (경계 #4).
interface Row { project_id: string; project_no: string; name: string; corpus: "active" | "killed"; forecast_npv_krw_m: number; actual_npv_krw_m?: number; deviation_pct?: number; status: string }
interface Bias { n: number; mean_signed_deviation_pct: number | null; median_signed_deviation_pct: number | null; over_forecast_count: number; under_forecast_count: number; direction: "over_forecast" | "under_forecast" | "balanced" | "insufficient_evidence"; suggested_grade: "B" | "C" | null }
interface Org { scored: number; within: number; outlier: number; insufficient: number; killed_in_corpus: number; avg_abs_deviation_pct: number | null; bias: Bias }
interface Proposal { id: string; scope: "org" | "project"; project_id: string | null; proposed_grade: "A" | "B" | "C"; rationale: string; status: "proposed" | "approved" | "rejected"; proposed_by: string; proposed_at: string; decided_by: string | null; decided_at: string | null; decision_rationale: string | null }

// i18n: bias direction chips resolve through pages.projects.backtest.dir* keys at render time.
const DIRECTION_KEY: Record<Bias["direction"], string> = { over_forecast: "dirOver", under_forecast: "dirUnder", balanced: "dirBalanced", insufficient_evidence: "dirInsufficient" };
const signedPct = (v: number) => `${v > 0 ? "+" : ""}${v}%`;

function BacktestView() {
  const t = useTranslations("pages.projects.backtest");
  const tc = useTranslations("common");
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ scope: "org" | "project"; proposed_grade: "A" | "B" | "C"; rationale: string }>({ scope: "org", proposed_grade: "B", rationale: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [decisionText, setDecisionText] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    api.get<{ rows: Row[]; org: Org }>(`/api/portfolio/backtest`)
      .then((r) => { setRows(r.data.rows); setOrg(r.data.org); })
      .catch((e) => setError(e instanceof Error ? e.message : tc("errors.loadFailed")));
    api.get<{ proposals: Proposal[] }>(`/api/portfolio/backtest/proposals`)
      .then((r) => setProposals(r.data.proposals))
      .catch(() => setProposals([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const outliers = (rows ?? []).filter((r) => r.status === "outlier");
  const bias = org?.bias ?? null;

  async function propose(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy("propose");
    try {
      await api.post(`/api/portfolio/backtest/proposals`, { action: "propose", scope: form.scope, project_id: form.scope === "project" ? id : undefined, proposed_grade: form.proposed_grade, rationale: form.rationale });
      toast(t("proposedToast"));
      setForm({ scope: "org", proposed_grade: "B", rationale: "" });
      load();
    } catch (err) {
      toast(err instanceof Error ? t("proposeFailedWith", { message: err.message }) : t("proposeFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function decide(p: Proposal, action: "approve" | "reject") {
    if (busy) return;
    setBusy(p.id);
    try {
      await api.post(`/api/portfolio/backtest/proposals`, { action, id: p.id, decision_rationale: decisionText[p.id] ?? "" });
      toast(action === "approve" ? t("approvedToast") : t("rejectedToast"));
      load();
    } catch (err) {
      toast(err instanceof Error ? t("decideFailedWith", { message: err.message }) : t("decideFailed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>{t("heading")} <span className="chip gray">{t("orgChip")}</span></h1>
      <p className="objective">{t("objective")}</p>
      {error && <PageState state="error" errorText={error} onRetry={() => window.location.reload()} />}

      <section className="market-section" aria-label={t("biasHeading")} data-testid="backtest-bias">
        <h2 className=" mb-2">{t("biasHeading")} <span className="note">{t("biasNote")}</span></h2>
        {org === null || bias === null ? <PageState state="loading" /> : (
          <ul className="sizing-note-list">
            <li>
              <span className={`status-chip ${bias.direction === "over_forecast" ? "status-red" : bias.direction === "under_forecast" ? "status-amber" : bias.direction === "balanced" ? "status-green" : "status-gray"}`}>{t(DIRECTION_KEY[bias.direction])}</span>
              {" "}{t("scoredLine", { n: org.scored, within: org.within, outlier: org.outlier, insufficient: org.insufficient, killed: org.killed_in_corpus })}
            </li>
            <li>{t("meanDevLine", {
              mean: bias.mean_signed_deviation_pct != null ? signedPct(bias.mean_signed_deviation_pct) : t("noMeanSample"),
              median: bias.median_signed_deviation_pct != null ? signedPct(bias.median_signed_deviation_pct) : "—",
              over: bias.over_forecast_count, under: bias.under_forecast_count, abs: org.avg_abs_deviation_pct ?? "—",
            })}</li>
            {bias.suggested_grade && <li><span className="status-chip status-amber">{t("hintChip")}</span> {t("hintLead")}<strong>{bias.suggested_grade}</strong>{t("hintTail")}</li>}
          </ul>
        )}
      </section>

      <section className="market-section" aria-label={t("tableAria")}>
        {outliers.length > 0 && (
          <p className="text-[length:var(--fs-caption)] mb-2"><span className="status-chip status-red">{t("chipOutlier")}</span> {t("outlierLead", { count: outliers.length })}</p>
        )}
        {rows === null ? <PageState state="loading" /> : rows.length === 0 ? (
          <PageState state="empty" emptyText={t("empty")} />
        ) : (
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-40" aria-label={t("tableAria")}>
              <caption className="sr-only">{t("heading")}</caption>
              <ColGroup widths={BACKTEST_COL_PCT} />
              <thead><tr><th>{t("thProject")}</th><th>{t("thCorpus")}</th><th className="col-num">{t("thForecast")}</th><th className="col-num">{t("thActual")}</th><th className="col-num">{t("thDeviation")}</th><th>{t("thVerdict")}</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.project_id} className={r.project_id === id ? "row-selected" : undefined}>
                  <td className="font-semibold cell-truncate">{r.name} <span className="note">{r.project_id === id ? t("thisDealNote") : ""}</span></td>
                  <td>{r.corpus === "killed" ? <span className="status-chip status-gray" title={t("killedTitle")}>{t("killedChip")}</span> : <span className="note">{t("activeNote")}</span>}</td>
                  <td className="col-num tabular-nums">{fmtNpvEok(r.forecast_npv_krw_m)}</td>
                  <td className="col-num tabular-nums">{r.actual_npv_krw_m != null ? fmtNpvEok(r.actual_npv_krw_m) : "—"}</td>
                  <td className="col-num tabular-nums">{r.deviation_pct != null ? signedPct(r.deviation_pct) : "—"}</td>
                  <td>{r.status === "within_band" ? <span className="status-chip status-green">{t("statusWithin")}</span> : r.status === "outlier" ? <span className="status-chip status-red">{t("chipOutlier")}</span> : <span className="status-chip status-gray">{t("statusInsufficient")}</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="market-section" aria-label={t("proposalsHeading")} data-testid="confidence-proposals">
        <h2 className=" mb-2">{t("proposalsHeading")} <span className="note">{t("proposalsNote")}</span></h2>
        {proposals === null ? <PageState state="loading" /> : proposals.length === 0 ? (
          <p className="note">{t("noProposals")}</p>
        ) : (
          <ul className="sizing-note-list">
            {proposals.map((p) => (
              <li key={p.id}>
                <span className={`status-chip ${p.status === "approved" ? "status-green" : p.status === "rejected" ? "status-gray" : "status-amber"}`}>{p.status === "approved" ? t("stApproved") : p.status === "rejected" ? t("stRejected") : t("stProposed")}</span>
                {" "}<strong>{p.scope === "org" ? t("scopeOrg") : t("scopeProject")}</strong>{" "}{t("gradeArrow")}{" "}<strong>{p.proposed_grade}</strong> · {p.rationale}
                <span className="note ml-1">({p.proposed_by}, {p.proposed_at.slice(0, 10)}{p.decided_by ? t("decidedSuffix", { by: p.decided_by, date: p.decided_at?.slice(0, 10) ?? "" }) : ""})</span>
                {p.decision_rationale && <span className="note block ml-1">{t("decisionRationale", { value: p.decision_rationale })}</span>}
                {canAct && p.status === "proposed" && p.proposed_by !== me?.userId && (
                  <span className="actions-row ml-2 flex flex-wrap gap-1 items-center">
                    <input aria-label={t("decisionAria")} className="sizing-new-input sizing-new-input-sm" style={{ minWidth: "12rem" }} placeholder={t("decisionPlaceholder")} value={decisionText[p.id] ?? ""} onChange={(e) => setDecisionText((cur) => ({ ...cur, [p.id]: e.target.value }))} />
                    <button type="button" className="btn-ghost btn-sm" disabled={busy === p.id} onClick={() => void decide(p, "approve")}>{tc("approve")}</button>
                    <button type="button" className="btn-ghost btn-sm" disabled={busy === p.id} onClick={() => void decide(p, "reject")}>{t("stRejected")}</button>
                  </span>
                )}
                {canAct && p.status === "proposed" && p.proposed_by === me?.userId && <span className="note ml-2">{t("proposerNote")}</span>}
              </li>
            ))}
          </ul>
        )}
        {canAct && (
          <form className="flex flex-wrap items-end gap-2 mt-2" onSubmit={propose}>
            <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">{t("lblScope")}</span>
              <select className="sizing-new-input sizing-new-input-sm" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as "org" | "project" })}><option value="org">{t("optOrg")}</option><option value="project">{t("optThisDeal")}</option></select></label>
            <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">{t("lblGrade")}</span>
              <select className="sizing-new-input sizing-new-input-sm" value={form.proposed_grade} onChange={(e) => setForm({ ...form, proposed_grade: e.target.value as "A" | "B" | "C" })}><option value="A">A</option><option value="B">B</option><option value="C">C</option></select></label>
            <label className="text-[length:var(--fs-caption)] flex-1 min-w-[16rem]"><span className="block mb-1">{t("lblRationale")}</span>
              <input className="sizing-new-input w-full" value={form.rationale} onChange={(e) => setForm({ ...form, rationale: e.target.value })} placeholder={t("phRationale")} required /></label>
            <button type="submit" className="btn-ghost btn-sm" disabled={busy === "propose"}>{busy === "propose" ? t("proposing") : t("stProposed")}</button>
          </form>
        )}
      </section>
    </main>
  );
}

export default function BacktestPage() {
  return <Suspense fallback={null}><BacktestView /></Suspense>;
}
