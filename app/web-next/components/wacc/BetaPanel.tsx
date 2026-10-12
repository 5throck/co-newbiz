"use client";

// WACC 입력 세션 — 베타 추정 패널 (ADR-0115).
// (a) 동종사 인용: 공표 베타(AlphaSpread 등) → Hamada 비레버드 → 중앙값 βU
// (b) 시계열 회귀: 붙여넣은 price/index 시계열 → OLS β·R²·연율화 변동성(자산 vs 시장)
// 승인된 UI 목업(docs/designs/mockups/2026-09-10-wacc-capm-ui-mockup_ko.html) 기준.

import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { EChart } from "../EChart.tsx";
import { ColGroup } from "../ui.tsx";
import {
  medianBetaUnlevered,
  parseSeriesInput,
  scatterPoints,
  type BetaRegressionResult,
} from "../../../../db/lib/beta-regression.ts";

// 동종사 베타 6열 — 동종사명·출처가 텍스트 입력 셀이라 table-scroll 안에서 고정 비율 유지.
const PEER_BETA_COL_PCT = [24, 14, 10, 18, 24, 10] as const;

export interface PeerRow {
  name: string;
  beta: string;
  de: string;
  source: string;
}

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
const num = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "—");

export function BetaPanel({
  projectId,
  betaTab,
  onBetaTab,
  peers,
  onPeers,
  peerTaxRate,
  regressionText,
  onRegressionText,
  regression,
  regressionError,
  onRunRegression,
  observedDe,
  onObservedDe,
}: {
  /** WACC 베타 시계열 수집 데이터 조회 대상 프로젝트 — "수집 데이터 불러오기" 액션용. */
  projectId: string;
  betaTab: "peer" | "regression";
  onBetaTab: (t: "peer" | "regression") => void;
  peers: PeerRow[];
  onPeers: (rows: PeerRow[]) => void;
  /** 한계 세율 (④ 입력과 공유) — 비레버드 환산 표시용. null이면 환산 열은 "—" */
  peerTaxRate: number | null;
  regressionText: string;
  onRegressionText: (t: string) => void;
  regression: BetaRegressionResult | null;
  regressionError: string | null;
  onRunRegression: () => void;
  observedDe: { value: string; source: string; asOf: string };
  onObservedDe: (f: { value: string; source: string; asOf: string }) => void;
}) {
  const peerBeta = (p: PeerRow) => {
    const b = Number(p.beta);
    const de = Number(p.de);
    if (!Number.isFinite(b) || !Number.isFinite(de) || peerTaxRate == null || b <= 0 || de < 0) return null;
    return b / (1 + (1 - peerTaxRate) * de);
  };
  const numericPeers = peers
    .filter((p) => p.name.trim() !== "" && p.beta.trim() !== "")
    .map((p) => ({ label: p.name, betaLevered: Number(p.beta), deRatio: Number(p.de) || 0, taxRate: peerTaxRate ?? 0 }));
  let peerMedian: number | null = null;
  try {
    if (numericPeers.length > 0) peerMedian = medianBetaUnlevered(numericPeers).median;
  } catch {
    peerMedian = null;
  }

  const scatter = useMemo<{ pts: { x: number; y: number }[]; line: [number, number][] }>(() => {
    if (!regression) return { pts: [], line: [] };
    try {
      const rows = parseSeriesInput(regressionText);
      const pts = scatterPoints(rows);
      if (pts.length === 0) return { pts: [], line: [] };
      const xs = pts.map((p) => p.x);
      const xmin = Math.min(...xs);
      const xmax = Math.max(...xs);
      return { pts, line: [[xmin, regression.beta * xmin], [xmax, regression.beta * xmax]] };
    } catch {
      return { pts: [], line: [] };
    }
  }, [regression, regressionText]);

  const scatterOption: EChartsOption = {
    grid: { left: 56, right: 20, top: 20, bottom: 44 },
    tooltip: { trigger: "item", formatter: (p: unknown) => {
      const d = (p as { seriesType: string; value: [number, number] }).value;
      return `시장 ${(d[0] * 100).toFixed(2)}% / 자산 ${(d[1] * 100).toFixed(2)}%`;
    } },
    xAxis: { type: "value", name: "시장 일별 수익률", nameLocation: "middle", nameGap: 26, nameTextStyle: { fontSize: 10 },
      axisLabel: { fontSize: 10, formatter: (v: number) => `${(v * 100).toFixed(1)}%` } },
    yAxis: { type: "value", name: "자산", nameTextStyle: { fontSize: 10 },
      axisLabel: { fontSize: 10, formatter: (v: number) => `${(v * 100).toFixed(1)}%` } },
    series: [
      { type: "scatter", symbolSize: 6, itemStyle: { opacity: 0.45 }, data: scatter.pts.map((p) => [p.x, p.y]) },
      ...(scatter.line.length === 2
        ? [{ type: "line" as const, data: scatter.line, showSymbol: false, lineStyle: { width: 2 } }]
        : []),
    ],
  };

  const volMax = regression ? Math.max(regression.annualVolAsset, regression.annualVolMarket) : 1;

  // 수집 데이터 불러오기 — GET /api/projects/[id]/wacc/beta-series 의 정렬된
  // date/price/index 행을 붙여넣기 상자에 채운다. 붙여넣기 입력은 그대로 유지.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const collectedRowCount = useMemo(() => {
    try {
      return parseSeriesInput(regressionText).length;
    } catch {
      return 0;
    }
  }, [regressionText]);
  const [insufficientRows, setInsufficientRows] = useState(false);
  const loadCollectedSeries = async () => {
    setLoading(true);
    setLoadError(null);
    setInsufficientRows(false);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/wacc/beta-series`);
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: { message?: string }; data?: { rows?: Array<{ date: string; price: number; index: number }> } } | null;
      if (!res.ok || !body?.ok || !body.data) {
        setLoadError(body?.error?.message ?? "수집 데이터를 불러오지 못했습니다.");
        return;
      }
      const rows = body.data.rows ?? [];
      const csv = rows.map((r) => `${r.date},${r.price},${r.index}`).join("\n");
      onRegressionText(csv);
      setInsufficientRows(rows.length < 63);
    } catch {
      setLoadError("수집 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="flex gap-1.5 mb-2">
        <button
          type="button"
          onClick={() => onBetaTab("peer")}
          className={`rounded-full border px-3 py-1 text-[length:var(--fs-caption)] ${betaTab === "peer" ? "border-[color:var(--primary-border)] bg-[color:var(--primary-bg)] text-[color:var(--accent)] font-bold" : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-fg)]"}`}
        >
          (a) 동종사 인용
        </button>
        <button
          type="button"
          onClick={() => onBetaTab("regression")}
          className={`rounded-full border px-3 py-1 text-[length:var(--fs-caption)] ${betaTab === "regression" ? "border-[color:var(--primary-border)] bg-[color:var(--primary-bg)] text-[color:var(--accent)] font-bold" : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-fg)]"}`}
        >
          (b) 시계열 회귀
        </button>
      </div>
      <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mb-2">
        {betaTab === "peer"
          ? "상장 동종사의 공표 베타(AlphaSpread·ValueInvesting.io 등)를 비레버드 베타(βU)로 환산해 중앙값을 사용합니다."
          : "비교대상(또는 유사 상장사) 종가와 시장지수의 일별 수익률을 붙여넣으면 회귀로 β·R²·변동성을 산출합니다. 형식: date, price, index (CSV/TSV)."}
      </p>

      {betaTab === "peer" ? (
        <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
          <table className="w-full text-[length:var(--fs-body)] table-fixed-pct tmin-48">
            <ColGroup widths={PEER_BETA_COL_PCT} />
            <thead>
              <tr className="text-left text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] border-b border-[color:var(--border-bright)]">
                <th className="py-1.5 px-1.5">동종사</th>
                <th className="py-1.5 px-1.5 text-right">공표 β (레버드)</th>
                <th className="py-1.5 px-1.5 text-right">D/E</th>
                <th className="py-1.5 px-1.5 text-right">βU (산출{peerTaxRate != null ? `, t=${(peerTaxRate * 100).toFixed(0)}%` : " — 세율 ④ 필요"})</th>
                <th className="py-1.5 px-1.5">출처</th>
                <th className="px-1.5" aria-label="행 삭제" />
              </tr>
            </thead>
            <tbody>
              {peers.map((p, i) => {
                const u = peerBeta(p);
                return (
                  <tr key={i} className="border-b border-[color:var(--border-subtle)]">
                    <td className="py-1 px-1.5"><input className="form-input" value={p.name} placeholder="동종사명" onChange={(e) => onPeers(peers.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} /></td>
                    <td className="py-1 px-1.5"><input className="form-input text-right" value={p.beta} placeholder="1.35" onChange={(e) => onPeers(peers.map((r, j) => (j === i ? { ...r, beta: e.target.value } : r)))} /></td>
                    <td className="py-1 px-1.5"><input className="form-input text-right" value={p.de} placeholder="0.90" onChange={(e) => onPeers(peers.map((r, j) => (j === i ? { ...r, de: e.target.value } : r)))} /></td>
                    <td className="py-1 px-1.5 text-right tabular-nums font-semibold">{u != null ? num(u) : "—"}</td>
                    <td className="py-1 px-1.5"><input className="form-input" value={p.source} placeholder="AlphaSpread · 2026-09" onChange={(e) => onPeers(peers.map((r, j) => (j === i ? { ...r, source: e.target.value } : r)))} /></td>
                    <td className="px-1.5">
                      <button type="button" className="text-[color:var(--muted-fg)] hover:text-[color:var(--danger)] px-1" aria-label={`${p.name || `동종사 ${i + 1}`} 행 삭제`} onClick={() => onPeers(peers.filter((_, j) => j !== i))}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center gap-3 mt-2">
            <button type="button" className="ghost-button" onClick={() => onPeers([...peers, { name: "", beta: "", de: "", source: "" }])}>+ 행 추가</button>
            <span className="text-[length:var(--fs-caption)]">
              중앙값 βU: <b className="tabular-nums">{peerMedian != null ? num(peerMedian) : "—"}</b>
            </span>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap gap-3 items-start">
            <textarea className="form-input font-mono text-[length:var(--fs-caption)] flex-1 min-w-[280px]" rows={5} value={regressionText}
              placeholder={"date,price,index\n2026-09-10,68400,3421.8\n2026-09-09,67900,3405.2\n…"}
              onChange={(e) => onRegressionText(e.target.value)} />
            <button type="button" className="ghost-button" onClick={onRunRegression}>↻ 회귀 실행</button>
            <button type="button" className="ghost-button" disabled={loading} onClick={() => void loadCollectedSeries()}>
              {loading ? "불러오는 중…" : "수집 데이터 불러오기"}
            </button>
          </div>
          {loadError && <p role="alert" className="text-[color:var(--red-fg,var(--danger))] text-[length:var(--fs-caption)] mt-2">✕ {loadError}</p>}
          {insufficientRows && collectedRowCount < 63 && (
            <p role="status" className="text-[color:var(--warning,var(--warning-fg,var(--muted-fg)))] text-[length:var(--fs-caption)] mt-2">
              시계열 회귀에는 최소 약 3개월(거래일 63개) 데이터가 필요합니다 — 현재 {collectedRowCount}건
            </p>
          )}
          {regressionError && <p role="alert" className="text-[color:var(--red-fg,var(--danger))] text-[length:var(--fs-caption)] mt-2">✕ {regressionError}</p>}
          {regression && (
            <>
              <dl className="grid gap-2 md:grid-cols-4 mt-3 text-sm">
                <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)]">
                  <dt className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">베타 (β, 레버드)</dt>
                  <dd className="font-bold text-[1.05rem] tabular-nums">{num(regression.beta)}</dd>
                </div>
                <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)]">
                  <dt className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">결정계수 (R²)</dt>
                  <dd className="font-bold text-[1.05rem] tabular-nums">{regression.r2.toFixed(2)}</dd>
                </div>
                <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)]">
                  <dt className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">표본</dt>
                  <dd className="font-bold text-[1.05rem] tabular-nums">{regression.n}일 <span className="text-[length:var(--fs-caption)] font-normal text-[color:var(--muted-fg)]">{regression.windowStart} ~ {regression.windowEnd}</span></dd>
                </div>
                <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)]">
                  <dt className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">α (연율)</dt>
                  <dd className="font-bold text-[1.05rem] tabular-nums">{pct(regression.annualAlpha)}</dd>
                </div>
              </dl>

              <div className="mt-3">
                <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] font-semibold">연율화 변동성 — 시장 평균 대비</div>
                <div className="grid grid-cols-[10rem_1fr_4rem] gap-2 items-center text-[length:var(--fs-caption)] mt-1">
                  <span>대상 자산</span>
                  <div className="h-2.5 rounded-full bg-[color:var(--muted-bg)] overflow-hidden"><div className="h-full rounded-full bg-[color:var(--accent)]" style={{ width: `${(regression.annualVolAsset / volMax) * 100}%` }} /></div>
                  <span className="text-right font-bold tabular-nums">{pct(regression.annualVolAsset)}</span>
                  <span>시장 지수</span>
                  <div className="h-2.5 rounded-full bg-[color:var(--muted-bg)] overflow-hidden"><div className="h-full rounded-full bg-[color:var(--accent)] opacity-50" style={{ width: `${(regression.annualVolMarket / volMax) * 100}%` }} /></div>
                  <span className="text-right font-bold tabular-nums">{pct(regression.annualVolMarket)}</span>
                </div>
                <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mt-1">
                  시장 대비 변동성 비율 {num(regression.volRatio)}× — 베타 {num(regression.beta)}와 함께 해석: 시장 변동의 {num(regression.beta)}배 움직임, 고유변동(1−R²)은 {(100 - regression.r2 * 100).toFixed(0)}%.
                </p>
              </div>

              {scatter.pts.length > 0 && (
                <div className="mt-3">
                  <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] font-semibold">회귀 산점도 (일별 수익률)</div>
                  <EChart option={scatterOption} height={220} ariaLabel="베타 회귀 산점도" />
                </div>
              )}
            </>
          )}

          {/* 회귀 대상 종목의 자본구조 — βU 환산 입력 */}
          <div className="grid md:grid-cols-2 xl:grid-cols-[9.5rem_7rem_1fr_7.5rem] gap-2 items-end mt-4 text-sm border-t border-[color:var(--border-subtle)] pt-3">
            <div>
              <div className="text-[length:var(--fs-body)] font-semibold">관측 D/E</div>
              <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">회귀 대상 종목의 자본구조 — βU 환산에 사용</div>
            </div>
            <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">값
              <input className="form-input" value={observedDe.value} placeholder="0.90" onChange={(e) => onObservedDe({ ...observedDe, value: e.target.value })} />
            </label>
            <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">출처명
              <input className="form-input" value={observedDe.source} placeholder="최근 결산 기준 부채/자기자본 (DART)" onChange={(e) => onObservedDe({ ...observedDe, source: e.target.value })} />
            </label>
            <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">기준일
              <input className="form-input" value={observedDe.asOf} placeholder="2026-06-30" onChange={(e) => onObservedDe({ ...observedDe, asOf: e.target.value })} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
