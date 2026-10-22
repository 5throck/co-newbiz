"use client";

// WACC 입력 세션 — 베타 추정 패널 (ADR-0115).
// (a) 동종사 인용: 공표 베타(AlphaSpread 등) → Hamada 비레버드 → 중앙값 βU
// (b) 시계열 회귀: 붙여넣은 price/index 시계열 → OLS β·R²·연율화 변동성(자산 vs 시장)
// 승인된 UI 목업(docs/designs/mockups/2026-09-10-wacc-capm-ui-mockup_ko.html) 기준.

import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { EChart } from "../EChart.tsx";
import { ColGroup } from "../ui.tsx";
import { TabNav } from "../TabNav.tsx";
import {
  medianBetaUnlevered,
  parseSeriesInput,
  scatterPoints,
  type BetaRegressionResult,
} from "../../../../db/lib/beta-regression.ts";
import {
  betaSeriesUrl,
  defaultSourceMode,
  runDisabledReason,
  seriesRange,
  type BetaSourceMode,
  indexOptionLabel,
  indexPairingNote,
  parseBetaSeriesResponse,
  shouldFillRows,
  showsRunbook,
  statusMessage,
  statusTone,
  type BetaCollection,
  type BetaIndexMarket,
  type BetaIndexOption,
} from "../../lib/beta-collection-view.ts";

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
  // Regression needs at least 2 parseable rows.
  const canRunRegression = collectedRowCount >= 2;
  const [sourceChoice, setSourceChoice] = useState<BetaSourceMode | null>(null);
  const [loadedInfo, setLoadedInfo] = useState<{ count: number; first: string; last: string } | null>(null);
  const [insufficientRows, setInsufficientRows] = useState(false);
  const [collection, setCollection] = useState<BetaCollection | null>(null);
  const sourceMode: BetaSourceMode = sourceChoice ?? defaultSourceMode(collection?.status);
  const [copied, setCopied] = useState(false);
  // 지수 선택 — null이면 API 기본값(종목 상장시장 지수). 사용자가 고르면 ?index= 로 전달.
  const [indexChoice, setIndexChoice] = useState<BetaIndexMarket | null>(null);
  const [indexOptions, setIndexOptions] = useState<BetaIndexOption[]>([]);
  const [defaultIndex, setDefaultIndex] = useState<BetaIndexMarket | null>(null);
  // fill=false is the read-only status probe on mount; the textarea stays untouched.
  const fetchCollected = async (fill: boolean, index: BetaIndexMarket | null = indexChoice) => {
    if (fill) {
      setLoading(true);
      setLoadError(null);
      setInsufficientRows(false);
      setLoadedInfo(null);
    }
    try {
      const res = await fetch(betaSeriesUrl(projectId, index));
      const body: unknown = await res.json().catch(() => null);
      const parsed = parseBetaSeriesResponse(res.ok, body);
      if (!parsed.ok) {
        if (fill) setLoadError(parsed.message);
        return;
      }
      const c = parsed.collection;
      setCollection(c);
      if (parsed.indexOptions.length > 0) setIndexOptions(parsed.indexOptions);
      if (index === null && parsed.defaultIndex) setDefaultIndex(parsed.defaultIndex);
      if (!fill) return;
      // Do not fill the textarea when nothing usable was collected.
      if (c && !shouldFillRows(c.status)) return;
      const rows = parsed.rows;
      const csv = rows.map((r) => `${r.date},${r.price},${r.index}`).join("\n");
      onRegressionText(csv);
      setInsufficientRows(rows.length < 63);
      if (rows.length > 0) {
        const dates = rows.map((r) => r.date).sort();
        setLoadedInfo({ count: rows.length, first: dates[0], last: dates[dates.length - 1] });
      }
    } catch {
      if (fill) setLoadError("수집 데이터를 불러오지 못했습니다.");
    } finally {
      if (fill) setLoading(false);
    }
  };
  const loadCollectedSeries = () => fetchCollected(true);
  useEffect(() => {
    void fetchCollected(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  const copyRunbook = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
    } catch {
      setCopied(false);
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
          <table className="data-table table-fixed-pct tmin-48" aria-label="동종사 공표 베타">
            <caption className="sr-only">동종사 공표 베타 — 레버드 β·D/E·βU 환산·출처</caption>
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
            <button type="button" className="btn-ghost btn-sm" onClick={() => onPeers([...peers, { name: "", beta: "", de: "", source: "" }])}>+ 행 추가</button>
            <span className="text-[length:var(--fs-caption)]">
              중앙값 βU: <b className="tabular-nums">{peerMedian != null ? num(peerMedian) : "—"}</b>
            </span>
          </div>
        </div>
      ) : (
        <div>
          {/* Step 1 card: source switch (collected | paste) -> data + status. Step 2 card: compute. Tab order follows DOM order. */}
          <section className="card" aria-labelledby="beta-step1-title">
            <h4 id="beta-step1-title" className="font-semibold mb-2">1. 데이터 가져오기 {/* INTERIM-WORDING */}</h4>
            <TabNav
              label="데이터 입력 방식"
              tabs={[{ key: "collected", label: "수집 데이터 사용" }, { key: "paste", label: "직접 붙여넣기" }]}
              active={sourceMode}
              onSelect={(k) => setSourceChoice(k as BetaSourceMode)}
              className="mb-3"
            />
            {sourceMode === "collected" ? (
              <div role="tabpanel" aria-label="수집 데이터 사용">
                <div className="flex flex-wrap items-center gap-3">
                  {indexOptions.length > 0 && (
                    <label className="flex items-center gap-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                      <span>시장 지수</span> {/* INTERIM-WORDING */}
                      <select
                        className="form-input !h-[33px] !py-0" /* design-token-exempt: control height aligned to sibling row (one-off) */
                        value={indexChoice ?? defaultIndex ?? "KOSPI"}
                        onChange={(e) => {
                          const next = e.target.value as BetaIndexMarket;
                          const choice = next === defaultIndex ? null : next;
                          setIndexChoice(choice);
                          void fetchCollected(false, choice);
                        }}
                      >
                        {indexOptions.map((o) => (
                          <option key={o.label} value={o.label}>
                            {indexOptionLabel(o.label, collection?.listing_market)}
                            {o.count === 0 ? " — 수집 없음" : "" /* INTERIM-WORDING */}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button type="button" className="btn-ghost btn-sm" disabled={loading} aria-busy={loading} aria-label="수집 데이터 불러오기" onClick={() => void loadCollectedSeries()}>
                    {loading ? "불러오는 중…" : "수집 데이터 불러오기"}
                  </button>
                </div>
                <div aria-live="polite" className="mt-3">
                  {loadedInfo && (
                    <p className="text-[length:var(--fs-caption)] font-semibold text-[color:var(--accent)] mb-2">
                      ✓ {loadedInfo.count}일 불러옴 ({loadedInfo.first} ~ {loadedInfo.last}) {/* INTERIM-WORDING */}
                    </p>
                  )}
                  {collection && (
                    <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)] text-[length:var(--fs-caption)]">
                      <p className={`font-semibold ${statusTone(collection.status) === "ok" ? "text-[color:var(--accent)]" : statusTone(collection.status) === "warn" ? "text-[color:var(--warning,var(--warning-fg,var(--muted-fg)))]" : "text-[color:var(--red-fg,var(--danger))]"}`}>
                        {statusTone(collection.status) === "ok" ? "✓" : statusTone(collection.status) === "warn" ? "⚠" : "✕"} {statusMessage(collection)}
                      </p>
                      <dl className="mt-1 grid gap-x-3 gap-y-0.5 grid-cols-[max-content_1fr] text-[color:var(--muted-fg)] tabular-nums">
                        <dt>{`종목${collection.subject_company_name ? ` (${collection.subject_company_name})` : ""}`}</dt>
                        <dd>{seriesRange(collection.price)}</dd>
                        <dt>{`${collection.index_market ?? "KOSPI"} 지수`}</dt>
                        <dd>{seriesRange(collection.index)}</dd>
                        <dt>짝지은 지수</dt> {/* INTERIM-WORDING */}
                        <dd>{indexPairingNote(collection, indexChoice !== null)}</dd>
                        <dt>정렬</dt> {/* INTERIM-WORDING */}
                        <dd>거래일 {collection.aligned.count}일 / 최소 {collection.min_rows}일 {collection.aligned.count >= collection.min_rows ? "✓" : "⚠ 부족"}</dd>
                      </dl>
                      {showsRunbook(collection.status) && (
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <code className="font-mono select-all rounded border border-[color:var(--border-subtle)] px-1.5 py-0.5">{collection.runbook_command}</code>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => void copyRunbook(collection.runbook_command)}>
                            {copied ? "복사됨" : "명령 복사"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {collectedRowCount > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">불러온 원시 행 보기 ({collectedRowCount}행)</summary> {/* INTERIM-WORDING */}
                    <pre className="font-mono text-[length:var(--fs-caption)] max-h-48 overflow-auto mt-1 p-2 rounded border border-[color:var(--border-subtle)]" tabIndex={0} aria-label="불러온 원시 행 (읽기 전용)">{regressionText}</pre>
                  </details>
                )}
              </div>
            ) : (
              <div role="tabpanel" aria-label="직접 붙여넣기">
                <textarea className="form-input font-mono text-[length:var(--fs-caption)] w-full" rows={5} value={regressionText}
                  aria-label="시계열 데이터 (date, price, index)" aria-describedby="beta-paste-hint"
                  placeholder="date,price,index 형식으로 붙여넣기 (CSV/TSV)" /* INTERIM-WORDING */
                  onChange={(e) => onRegressionText(e.target.value)} />
                <p id="beta-paste-hint" className="mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">한 줄에 날짜, 종가, 지수값 순서로 입력합니다. {/* INTERIM-WORDING */}</p>
              </div>
            )}
            {loadError && <p role="alert" className="text-[color:var(--red-fg,var(--danger))] text-[length:var(--fs-caption)] mt-2">✕ {loadError}</p>}
            {insufficientRows && collectedRowCount < 63 && (
              <p role="status" className="text-[color:var(--warning,var(--warning-fg,var(--muted-fg)))] text-[length:var(--fs-caption)] mt-2">
                시계열 회귀에는 최소 약 3개월(거래일 63개) 데이터가 필요합니다 — 현재 {collectedRowCount}건
              </p>
            )}
          </section>

          <section className="card mt-3" aria-labelledby="beta-step2-title">
            <h4 id="beta-step2-title" className="font-semibold mb-2">2. 계산 {/* INTERIM-WORDING */}</h4>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-ghost btn-sm font-bold text-[color:var(--accent)] border-[color:var(--primary-border)]"
                disabled={!canRunRegression}
                aria-describedby={canRunRegression ? undefined : "beta-regression-disabled-reason"}
                aria-label="회귀 실행"
                onClick={onRunRegression}
              >
                ↻ 회귀 실행
              </button>
              {!canRunRegression && (
                <span id="beta-regression-disabled-reason" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {runDisabledReason(collectedRowCount, collection?.status)}
                </span>
              )}
            </div>
          </section>
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
