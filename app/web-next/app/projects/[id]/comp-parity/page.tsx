"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { api } from "../../../../lib/api.ts";
import { PageState, useToast } from "../../../../components/ui.tsx";

// 경영진 보상·임금 형평 (hr-integration-agent) — Wave 0 REST B9.
// 집계 전용 (k-익명성 ≥3) + 경영진 참조만 노출 (SEC-05, 개인 노출 없음).
interface Parity { job_family: string; grade: string | null; headcount: number; target_median: number; acquirer_median: number; gap_pct: number; annual_cost_delta: number }
interface Pkg { id: string; executive_ref: string; role_title: string; base_pay: number; coc_trigger: number; coc_payout_estimate: number | null; flight_risk: string | null; value_impact: number | null }

function CompView() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ parity: Parity[]; management_packages: Pkg[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ parity: Parity[]; management_packages: Pkg[] }>(`/api/projects/${encodeURIComponent(id)}/comp-parity`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, [id]);

  const fmt = (v: number | null) => (v == null ? "—" : v.toLocaleString("ko-KR"));

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>경영진 보상·임금 형평</h1>
      <p className="objective">경영진 보상 구조와 인수사-피인수사 임금 형평을 분석합니다 — 집계 전용(3인 미만 억제), 개인 노출 없음.</p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <div className="grid2e">
        <section className="market-section" aria-label="경영진 보상 패키지">
          <h2 className="text-[0.9rem] mb-2">경영진 보상 패키지</h2>
          {data === null ? <PageState state="loading" /> : data.management_packages.length === 0 ? (
            <PageState state="empty" emptyText="등록된 보상 패키지가 없습니다." />
          ) : (
            <table className="data-table" aria-label="보상 패키지">
              <thead><tr><th>임원 참조</th><th>역할</th><th className="col-num">기본급</th><th>CoC</th><th>리스크</th></tr></thead>
              <tbody>{data.management_packages.map((r) => (
                <tr key={r.id}>
                  <td><code className="dd-item-id">{r.executive_ref}</code></td>
                  <td>{r.role_title}</td>
                  <td className="col-num tabular-nums">{fmt(r.base_pay)}</td>
                  <td>{r.coc_trigger ? <span className="status-chip status-amber">트리거</span> : <span className="status-chip status-gray">없음</span>}</td>
                  <td>{r.flight_risk ? <span className={`status-chip ${r.flight_risk === "high" ? "status-red" : r.flight_risk === "medium" ? "status-amber" : "status-green"}`}>{r.flight_risk}</span> : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>
        <section className="market-section" aria-label="임금 형평">
          <h2 className="text-[0.9rem] mb-2">임금 형평 (직군 집계)</h2>
          {data === null ? <PageState state="loading" /> : data.parity.length === 0 ? (
            <PageState state="empty" emptyText="등록된 형평 데이터가 없습니다." />
          ) : (
            <table className="data-table" aria-label="임금 형평">
              <thead><tr><th>직군</th><th className="col-num">피인수 중위</th><th className="col-num">인수 중위</th><th className="col-num">격차</th></tr></thead>
              <tbody>{data.parity.map((r, i) => (
                <tr key={i}>
                  <td className="font-semibold">{r.job_family}{r.grade ? ` (${r.grade})` : ""}</td>
                  <td className="col-num tabular-nums">{fmt(r.target_median)}</td>
                  <td className="col-num tabular-nums">{fmt(r.acquirer_median)}</td>
                  <td className="col-num tabular-nums"><span className={`status-chip ${Math.abs(r.gap_pct) >= 10 ? "status-amber" : "status-green"}`}>{r.gap_pct > 0 ? "+" : ""}{r.gap_pct}%</span></td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <p className="note" style={{ marginBottom: 0 }}>단위: 원/월 · 보상 정책 결정은 PMI 화면으로 이관</p>
        </section>
      </div>
    </main>
  );
}

export default function CompPage() {
  return <Suspense fallback={null}><CompView /></Suspense>;
}
