"use client";

import { fmtNpvEok } from "@/lib/npv-format";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { api } from "../../../../lib/api.ts";
import { ColGroup, PageState } from "../../../../components/ui.tsx";

const BACKTEST_COL_PCT = [32, 17, 17, 17, 17] as const;

// 예측-실적 백테스트 (ADR-0123 #3) — 조직 집계(전체 검토/안건)를 보여주고 이 검토/안건의
// 행을 강조한다. 증거 부족은 honest degradation (가공 없음).
interface Row { project_id: string; project_no: string; name: string; forecast_npv_krw_m: number; actual_npv_krw_m?: number; deviation_pct?: number; status: string }

function BacktestView() {
  const { id } = useParams<{ id: string }>();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ rows: Row[] }>(`/api/portfolio/backtest`)
      .then((r) => setRows(r.data.rows))
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  const outliers = (rows ?? []).filter((r) => r.status === "outlier");

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>예측-실적 백테스트 <span className="chip gray">조직 집계</span></h1>
      <p className="objective">S8의 예측(NPV 중앙값)과 S12 실적을 자동 대조해 추정 정확도를 증명합니다 — 증거 부족은 가공하지 않고 표시합니다.</p>
      {error && <PageState state="error" errorText={error} onRetry={() => window.location.reload()} />}
      <section className="market-section" aria-label="백테스트">
        {outliers.length > 0 && (
          <p className="text-[length:var(--fs-caption)] mb-2"><span className="status-chip status-red">과대 편향 감지</span> 이탈 아웃라이어 {outliers.length}건 — 원인 태그가 다음 신뢰도 등급에 반영됩니다 (학습 루프).</p>
        )}
        {rows === null ? <PageState state="loading" /> : rows.length === 0 ? (
          <PageState state="empty" emptyText="백테스트 대상(채택된 케이스가 있는 프로젝트)이 없습니다." />
        ) : (
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-40" aria-label="백테스트">
              <caption className="sr-only">예측-실적 백테스트</caption>
              <ColGroup widths={BACKTEST_COL_PCT} />
              <thead><tr><th>프로젝트</th><th className="col-num">NPV 예측 (중앙값)</th><th className="col-num">실적 환산</th><th className="col-num">괴리</th><th>판정</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.project_id} className={r.project_id === id ? "row-selected" : undefined}>
                  <td className="font-semibold cell-truncate">{r.name} <span className="note">{r.project_id === id ? "· 이 검토/안건" : ""}</span></td>
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
    </main>
  );
}

export default function BacktestPage() {
  return <Suspense fallback={null}><BacktestView /></Suspense>;
}
