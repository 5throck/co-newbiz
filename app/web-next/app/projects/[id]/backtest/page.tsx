"use client";

import { fmtNpvEok } from "@/lib/npv-format";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
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

const DIRECTION_LABEL: Record<Bias["direction"], string> = { over_forecast: "과대 예측 편향", under_forecast: "과소 예측 편향", balanced: "편향 없음", insufficient_evidence: "표본 부족" };

function BacktestView() {
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
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
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
      toast("신뢰도 등급 조정 제안을 기록했습니다 — 다른 사람이 승인하면 RAG 신뢰도 캡에 반영됩니다 (하향 전용).");
      setForm({ scope: "org", proposed_grade: "B", rationale: "" });
      load();
    } catch (err) {
      toast(err instanceof Error ? `제안 실패: ${err.message}` : "제안 실패");
    } finally {
      setBusy(null);
    }
  }

  async function decide(p: Proposal, action: "approve" | "reject") {
    if (busy) return;
    setBusy(p.id);
    try {
      await api.post(`/api/portfolio/backtest/proposals`, { action, id: p.id, decision_rationale: decisionText[p.id] ?? "" });
      toast(action === "approve" ? "제안을 승인했습니다 — 데이터 신뢰도 캡이 즉시 낮아집니다." : "제안을 반려했습니다.");
      load();
    } catch (err) {
      toast(err instanceof Error ? `결정 실패: ${err.message}` : "결정 실패");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>예측-실적 백테스트 <span className="chip gray">조직 집계</span></h1>
      <p className="objective">S8의 예측(NPV 중앙값)과 S12 실적을 자동 대조해 추정 정확도를 증명합니다 — 증거 부족은 가공하지 않고 표시하며, 중단(kill) 학습 딜도 코퍼스에 포함합니다.</p>
      {error && <PageState state="error" errorText={error} onRetry={() => window.location.reload()} />}

      <section className="market-section" aria-label="편향 탐지" data-testid="backtest-bias">
        <h2 className="text-[0.9rem] mb-2">편향 탐지 <span className="note">— 부호 괴리 = (실적 − 예측) ÷ 예측 · 음수 = 과대 예측</span></h2>
        {org === null || bias === null ? <PageState state="loading" /> : (
          <ul className="sizing-note-list">
            <li>
              <span className={`status-chip ${bias.direction === "over_forecast" ? "status-red" : bias.direction === "under_forecast" ? "status-amber" : bias.direction === "balanced" ? "status-green" : "status-gray"}`}>{DIRECTION_LABEL[bias.direction]}</span>
              {" "}채점 {org.scored}건 (예측권 내 {org.within} · 아웃라이어 {org.outlier} · 증거 부족 {org.insufficient} · 중단 학습 딜 {org.killed_in_corpus})
            </li>
            <li>부호 평균 괴리 {bias.mean_signed_deviation_pct != null ? `${bias.mean_signed_deviation_pct > 0 ? "+" : ""}${bias.mean_signed_deviation_pct}%` : "— (표본 3건 미만)"} · 중앙값 {bias.median_signed_deviation_pct != null ? `${bias.median_signed_deviation_pct > 0 ? "+" : ""}${bias.median_signed_deviation_pct}%` : "—"} · 과대 {bias.over_forecast_count}건 / 과소 {bias.under_forecast_count}건 · 절대 평균 {org.avg_abs_deviation_pct ?? "—"}%</li>
            {bias.suggested_grade && <li><span className="status-chip status-amber">제안 힌트</span> 과대 예측 편향이 데이터 신뢰도 등급 <strong>{bias.suggested_grade}</strong> 수준의 캡을 시사합니다 — 사람이 아래에서 제안하고 다른 사람이 승인합니다 (자동 조정 없음).</li>}
          </ul>
        )}
      </section>

      <section className="market-section" aria-label="백테스트">
        {outliers.length > 0 && (
          <p className="text-[length:var(--fs-caption)] mb-2"><span className="status-chip status-red">아웃라이어</span> 예측권(±20%) 이탈 {outliers.length}건 — 원인 태그가 다음 신뢰도 등급 제안의 근거가 됩니다 (학습 루프).</p>
        )}
        {rows === null ? <PageState state="loading" /> : rows.length === 0 ? (
          <PageState state="empty" emptyText="백테스트 대상(채택된 케이스가 있는 프로젝트)이 없습니다." />
        ) : (
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-40" aria-label="백테스트">
              <caption className="sr-only">예측-실적 백테스트</caption>
              <ColGroup widths={BACKTEST_COL_PCT} />
              <thead><tr><th>프로젝트</th><th>코퍼스</th><th className="col-num">NPV 예측 (중앙값)</th><th className="col-num">실적 환산</th><th className="col-num">괴리</th><th>판정</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.project_id} className={r.project_id === id ? "row-selected" : undefined}>
                  <td className="font-semibold cell-truncate">{r.name} <span className="note">{r.project_id === id ? "· 이 검토/안건" : ""}</span></td>
                  <td>{r.corpus === "killed" ? <span className="status-chip status-gray" title="kill_with_learning_captured 결정으로 종료된 딜 — 학습 코퍼스">중단 학습</span> : <span className="note">진행</span>}</td>
                  <td className="col-num tabular-nums">{fmtNpvEok(r.forecast_npv_krw_m)}</td>
                  <td className="col-num tabular-nums">{r.actual_npv_krw_m != null ? fmtNpvEok(r.actual_npv_krw_m) : "—"}</td>
                  <td className="col-num tabular-nums">{r.deviation_pct != null ? `${r.deviation_pct > 0 ? "+" : ""}${r.deviation_pct}%` : "—"}</td>
                  <td>{r.status === "within_band" ? <span className="status-chip status-green">예측권 내</span> : r.status === "outlier" ? <span className="status-chip status-red">아웃라이어</span> : <span className="status-chip status-gray">증거 부족</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="market-section" aria-label="신뢰도 등급 조정 제안" data-testid="confidence-proposals">
        <h2 className="text-[0.9rem] mb-2">데이터 신뢰도 등급 조정 제안 <span className="note">— 제안·승인 모두 사람 · 승인은 캡을 낮추기만 함</span></h2>
        {proposals === null ? <PageState state="loading" /> : proposals.length === 0 ? (
          <p className="note">기록된 제안이 없습니다.</p>
        ) : (
          <ul className="sizing-note-list">
            {proposals.map((p) => (
              <li key={p.id}>
                <span className={`status-chip ${p.status === "approved" ? "status-green" : p.status === "rejected" ? "status-gray" : "status-amber"}`}>{p.status === "approved" ? "승인" : p.status === "rejected" ? "반려" : "제안"}</span>
                {" "}<strong>{p.scope === "org" ? "조직" : "프로젝트"}</strong> → 등급 <strong>{p.proposed_grade}</strong> · {p.rationale}
                <span className="note ml-1">({p.proposed_by}, {p.proposed_at.slice(0, 10)}{p.decided_by ? ` → ${p.decided_by} ${p.decided_at?.slice(0, 10)}` : ""})</span>
                {p.decision_rationale && <span className="note block ml-1">결정 근거: {p.decision_rationale}</span>}
                {canAct && p.status === "proposed" && (
                  <span className="actions-row ml-2 flex flex-wrap gap-1 items-center">
                    <input aria-label="결정 근거" className="sizing-new-input sizing-new-input-sm" style={{ minWidth: "12rem" }} placeholder="결정 근거 (5자 이상)" value={decisionText[p.id] ?? ""} onChange={(e) => setDecisionText((cur) => ({ ...cur, [p.id]: e.target.value }))} />
                    <button type="button" className="btn-ghost btn-sm" disabled={busy === p.id} onClick={() => void decide(p, "approve")}>승인</button>
                    <button type="button" className="btn-ghost btn-sm" disabled={busy === p.id} onClick={() => void decide(p, "reject")}>반려</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {canAct && (
          <form className="flex flex-wrap items-end gap-2 mt-2" onSubmit={propose}>
            <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">범위</span>
              <select className="sizing-new-input sizing-new-input-sm" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as "org" | "project" })}><option value="org">조직 전체</option><option value="project">이 검토/안건</option></select></label>
            <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">제안 등급</span>
              <select className="sizing-new-input sizing-new-input-sm" value={form.proposed_grade} onChange={(e) => setForm({ ...form, proposed_grade: e.target.value as "A" | "B" | "C" })}><option value="A">A</option><option value="B">B</option><option value="C">C</option></select></label>
            <label className="text-[length:var(--fs-caption)] flex-1 min-w-[16rem]"><span className="block mb-1">근거 (10자 이상)</span>
              <input className="sizing-new-input w-full" value={form.rationale} onChange={(e) => setForm({ ...form, rationale: e.target.value })} placeholder="과대 예측 편향 −23% (n=5) — 시장 전망 가정의 체계적 낙관" required /></label>
            <button type="submit" className="btn-ghost btn-sm" disabled={busy === "propose"}>{busy === "propose" ? "제안 중..." : "제안"}</button>
          </form>
        )}
      </section>
    </main>
  );
}

export default function BacktestPage() {
  return <Suspense fallback={null}><BacktestView /></Suspense>;
}
