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
import { useTranslations } from "next-intl";
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
}) {const t = useTranslations("stages.s8.wacc.betaPanel"); const tc = useTranslations("common");
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
      return t("marketP1AssetP2", { p1: (d[0] * 100).toFixed(2), p2: (d[1] * 100).toFixed(2) });
    } },
    xAxis: { type: "value", name: t("marketDailyReturns"), nameLocation: "middle", nameGap: 26, nameTextStyle: { fontSize: 10 },
      axisLabel: { fontSize: 10, formatter: (v: number) => `${(v * 100).toFixed(1)}%` } },
    yAxis: { type: "value", name: t("asset"), nameTextStyle: { fontSize: 10 },
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
      if (fill) setLoadError(t("failedToLoadCollectedData"));
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
          {t("aPeerCitation")}
        </button>
        <button
          type="button"
          onClick={() => onBetaTab("regression")}
          className={`rounded-full border px-3 py-1 text-[length:var(--fs-caption)] ${betaTab === "regression" ? "border-[color:var(--primary-border)] bg-[color:var(--primary-bg)] text-[color:var(--accent)] font-bold" : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-fg)]"}`}
        >
          {t("bRegression")}
        </button>
      </div>
      <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mb-2">
        {betaTab === "peer"
          ? t("convertsListedPeersPublishedBetas")
          : t("pasteDailyReturnsOfThe")}
      </p>

      {betaTab === "peer" ? (
        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
          <table className="data-table table-fixed-pct tmin-48" aria-label={t("peerPublishedBeta")}>
            <caption className="sr-only">{t("peerPublishedBetaLeveredBeta")}</caption>
            <ColGroup widths={PEER_BETA_COL_PCT} />
            <thead>
              <tr className="text-left text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] border-b border-[color:var(--border-bright)]">
                <th className="py-1.5 px-1.5">{t("peerCompany")}</th>
                <th className="py-1.5 px-1.5 text-right">{t("publishedBetaLevered")}</th>
                <th className="py-1.5 px-1.5 text-right">D/E</th>
                <th className="py-1.5 px-1.5 text-right">{t("betauComputed")}{peerTaxRate != null ? `, t=${(peerTaxRate * 100).toFixed(0)}%` : t("taxRate4Required")})</th>
                <th className="py-1.5 px-1.5">{tc("source")}</th>
                <th className="px-1.5" aria-label={t("deleteRow")} />
              </tr>
            </thead>
            <tbody>
              {peers.map((p, i) => {
                const u = peerBeta(p);
                return (
                  <tr key={i} className="border-b border-[color:var(--border-subtle)]">
                    <td className="py-1 px-1.5"><input className="form-input" value={p.name} placeholder={t("peerCompanyName")} onChange={(e) => onPeers(peers.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} /></td>
                    <td className="py-1 px-1.5"><input className="form-input text-right" value={p.beta} placeholder="1.35" onChange={(e) => onPeers(peers.map((r, j) => (j === i ? { ...r, beta: e.target.value } : r)))} /></td>
                    <td className="py-1 px-1.5"><input className="form-input text-right" value={p.de} placeholder="0.90" onChange={(e) => onPeers(peers.map((r, j) => (j === i ? { ...r, de: e.target.value } : r)))} /></td>
                    <td className="py-1 px-1.5 text-right tabular-nums font-semibold">{u != null ? num(u) : "—"}</td>
                    <td className="py-1 px-1.5"><input className="form-input" value={p.source} placeholder="AlphaSpread · 2026-09" onChange={(e) => onPeers(peers.map((r, j) => (j === i ? { ...r, source: e.target.value } : r)))} /></td>
                    <td className="px-1.5">
                      <button type="button" className="text-[color:var(--muted-fg)] hover:text-[color:var(--danger)] px-1" aria-label={t("deleteP1Row", { p1: p.name || t("peerP1", { p1: i + 1 }) })} onClick={() => onPeers(peers.filter((_, j) => j !== i))}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center gap-3 mt-2">
            <button type="button" className="btn-ghost btn-sm" onClick={() => onPeers([...peers, { name: "", beta: "", de: "", source: "" }])}>{t("addRow")}</button>
            <span className="text-[length:var(--fs-caption)]">
              {t("medianBetau")} <b className="tabular-nums">{peerMedian != null ? num(peerMedian) : "—"}</b>
            </span>
          </div>
        </div>
      ) : (
        <div>
          {/* Step 1 card: source switch (collected | paste) -> data + status. Step 2 card: compute. Tab order follows DOM order. */}
          <section className="card" aria-labelledby="beta-step1-title">
            <h4 id="beta-step1-title" className="font-semibold mb-2">{t("n1ImportData")} {/* INTERIM-WORDING */}</h4>
            <TabNav
              label={t("dataInputMethod")}
              tabs={[{ key: "collected", label: t("useCollectedData") }, { key: "paste", label: t("pasteDirectly") }]}
              active={sourceMode}
              onSelect={(k) => setSourceChoice(k as BetaSourceMode)}
              className="mb-3"
            />
            {sourceMode === "collected" ? (
              <div role="tabpanel" aria-label={t("useCollectedData2")}>
                <div className="flex flex-wrap items-center gap-3">
                  {indexOptions.length > 0 && (
                    <label className="flex items-center gap-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                      <span>{t("marketIndex")}</span> {/* INTERIM-WORDING */}
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
                            {o.count === 0 ? t("noCollection") : "" /* INTERIM-WORDING */}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button type="button" className="btn-ghost btn-sm" disabled={loading} aria-busy={loading} aria-label={t("loadCollectedData")} onClick={() => void loadCollectedSeries()}>
                    {loading ? tc("loadingEllipsis") : t("loadCollectedData2")}
                  </button>
                </div>
                <div aria-live="polite" className="mt-3">
                  {loadedInfo && (
                    <p className="text-[length:var(--fs-caption)] font-semibold text-[color:var(--accent)] mb-2">
                      ✓ {loadedInfo.count}{t("daysLoaded")}{loadedInfo.first} ~ {loadedInfo.last}) {/* INTERIM-WORDING */}
                    </p>
                  )}
                  {collection && (
                    <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)] text-[length:var(--fs-caption)]">
                      <p className={`font-semibold ${statusTone(collection.status) === "ok" ? "text-[color:var(--accent)]" : statusTone(collection.status) === "warn" ? "text-[color:var(--warning,var(--warning-fg,var(--muted-fg)))]" : "text-[color:var(--red-fg,var(--danger))]"}`}>
                        {statusTone(collection.status) === "ok" ? "✓" : statusTone(collection.status) === "warn" ? "⚠" : "✕"} {statusMessage(collection)}
                      </p>
                      <dl className="mt-1 grid gap-x-3 gap-y-0.5 grid-cols-[max-content_1fr] text-[color:var(--muted-fg)] tabular-nums">
                        <dt>{t("stockP1", { p1: collection.subject_company_name ? ` (${collection.subject_company_name})` : "" })}</dt>
                        <dd>{seriesRange(collection.price)}</dd>
                        <dt>{t("p1Index", { p1: collection.index_market ?? "KOSPI" })}</dt>
                        <dd>{seriesRange(collection.index)}</dd>
                        <dt>{t("pairedIndex")}</dt> {/* INTERIM-WORDING */}
                        <dd>{indexPairingNote(collection, indexChoice !== null)}</dd>
                        <dt>{t("sort")}</dt> {/* INTERIM-WORDING */}
                        <dd>{t("transactionDate")} {collection.aligned.count}{t("daysMinimum")} {collection.min_rows}{t("d")} {collection.aligned.count >= collection.min_rows ? "✓" : t("insufficient")}</dd>
                      </dl>
                      {showsRunbook(collection.status) && (
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <code className="font-mono select-all rounded border border-[color:var(--border-subtle)] px-1.5 py-0.5">{collection.runbook_command}</code>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => void copyRunbook(collection.runbook_command)}>
                            {copied ? t("copied") : t("copyCommand")}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {collectedRowCount > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("viewImportedRawRows")}{collectedRowCount}{t("row")}</summary> {/* INTERIM-WORDING */}
                    <pre className="font-mono text-[length:var(--fs-caption)] max-h-48 overflow-auto mt-1 p-2 rounded border border-[color:var(--border-subtle)]" tabIndex={0} aria-label={t("importedRawRows")}>{regressionText}</pre>
                  </details>
                )}
              </div>
            ) : (
              <div role="tabpanel" aria-label={t("pasteDirectly2")}>
                <textarea className="form-input font-mono text-[length:var(--fs-caption)] w-full" rows={5} value={regressionText}
                  aria-label={t("timeSeriesDataDatePrice")} aria-describedby="beta-paste-hint"
                  placeholder={t("pasteAsDatePriceIndex")} /* INTERIM-WORDING */
                  onChange={(e) => onRegressionText(e.target.value)} />
                <p id="beta-paste-hint" className="mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("enterOneLineAsDate")} {/* INTERIM-WORDING */}</p>
              </div>
            )}
            {loadError && <p role="alert" className="text-[color:var(--red-fg,var(--danger))] text-[length:var(--fs-caption)] mt-2">✕ {loadError}</p>}
            {insufficientRows && collectedRowCount < 63 && (
              <p role="status" className="text-[color:var(--warning,var(--warning-fg,var(--muted-fg)))] text-[length:var(--fs-caption)] mt-2">
                {t("regressionNeedsAboutThreeMonths")} {collectedRowCount}{tc("countUnit")}
              </p>
            )}
          </section>

          <section className="card mt-3" aria-labelledby="beta-step2-title">
            <h4 id="beta-step2-title" className="font-semibold mb-2">{t("n2Calculate")} {/* INTERIM-WORDING */}</h4>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-ghost btn-sm font-bold text-[color:var(--accent)] border-[color:var(--primary-border)]"
                disabled={!canRunRegression}
                aria-describedby={canRunRegression ? undefined : "beta-regression-disabled-reason"}
                aria-label={t("runRegression")}
                onClick={onRunRegression}
              >
                {t("runRegression2")}
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
                  <dt className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("betaBetaLevered")}</dt>
                  <dd className="font-bold text-[1.05rem] tabular-nums">{num(regression.beta)}</dd>
                </div>
                <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)]">
                  <dt className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("coefficientOfDetermination")}</dt>
                  <dd className="font-bold text-[1.05rem] tabular-nums">{regression.r2.toFixed(2)}</dd>
                </div>
                <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)]">
                  <dt className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("sample")}</dt>
                  <dd className="font-bold text-[1.05rem] tabular-nums">{regression.n}{t("d2")} <span className="text-[length:var(--fs-caption)] font-normal text-[color:var(--muted-fg)]">{regression.windowStart} ~ {regression.windowEnd}</span></dd>
                </div>
                <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)]">
                  <dt className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("alphaAnnualized")}</dt>
                  <dd className="font-bold text-[1.05rem] tabular-nums">{pct(regression.annualAlpha)}</dd>
                </div>
              </dl>

              <div className="mt-3">
                <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] font-semibold">{t("annualizedVolatilityVsMarketAverage")}</div>
                <div className="grid grid-cols-[10rem_1fr_4rem] gap-2 items-center text-[length:var(--fs-caption)] mt-1">
                  <span>{t("targetAssets")}</span>
                  <div className="h-2.5 rounded-full bg-[color:var(--muted-bg)] overflow-hidden"><div className="h-full rounded-full bg-[color:var(--accent)]" style={{ width: `${(regression.annualVolAsset / volMax) * 100}%` }} /></div>
                  <span className="text-right font-bold tabular-nums">{pct(regression.annualVolAsset)}</span>
                  <span>{t("marketIndex2")}</span>
                  <div className="h-2.5 rounded-full bg-[color:var(--muted-bg)] overflow-hidden"><div className="h-full rounded-full bg-[color:var(--accent)] opacity-50" style={{ width: `${(regression.annualVolMarket / volMax) * 100}%` }} /></div>
                  <span className="text-right font-bold tabular-nums">{pct(regression.annualVolMarket)}</span>
                </div>
                <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mt-1">
                  {t("volatilityRatioVsMarket")} {num(regression.volRatio)}{t("beta")} {num(regression.beta)}{t("interpretTogetherOfTheMarket")} {num(regression.beta)}{t("xMoveIdiosyncraticVarianceIs")} {(100 - regression.r2 * 100).toFixed(0)}%.
                </p>
              </div>

              {scatter.pts.length > 0 && (
                <div className="mt-3">
                  <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] font-semibold">{t("regressionScatterDailyReturns")}</div>
                  <EChart option={scatterOption} height={220} ariaLabel={t("betaRegressionScatter")} />
                </div>
              )}
            </>
          )}

          {/* 회귀 대상 종목의 자본구조 — βU 환산 입력 */}
          <div className="grid md:grid-cols-2 xl:grid-cols-[9.5rem_7rem_1fr_7.5rem] gap-2 items-end mt-4 text-sm border-t border-[color:var(--border-subtle)] pt-3">
            <div>
              <div className="text-[length:var(--fs-body)] font-semibold">{tc("observedDE")}</div>
              <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("theRegressionStockSCapital")}</div>
            </div>
            <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("value")}
              <input className="form-input" value={observedDe.value} placeholder="0.90" onChange={(e) => onObservedDe({ ...observedDe, value: e.target.value })} />
            </label>
            <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("sourceName")}
              <input className="form-input" value={observedDe.source} placeholder={t("latestClosingDebtEquityDart")} onChange={(e) => onObservedDe({ ...observedDe, source: e.target.value })} />
            </label>
            <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("asOfDate")}
              <input className="form-input" value={observedDe.asOf} placeholder="2026-06-30" onChange={(e) => onObservedDe({ ...observedDe, asOf: e.target.value })} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
