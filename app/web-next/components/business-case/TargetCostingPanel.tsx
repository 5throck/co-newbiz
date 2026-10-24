"use client";

// TargetCostingPanel — S8 타겟코스팅 카드 (design
// 2026-09-18-s8-business-case-evaluation REQ-W2, skill target-costing-analysis).
// 시장가격을 목표마진으로 역산한 허용원가와 추정 단위원가의 격차를 기록하고,
// 임계(+10%) 초과 격차는 downside 시나리오 opex 드라이버에 반영됨을 표시한다.

import { TranslatorFn } from "../../i18n/config.ts";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { ParamTable } from "../ui.tsx";
import { useTranslations } from "next-intl";

interface PriceProposal {
  unit_price: number;
  currency: string;
  unit: string;
  source_url: string;
  source_name: string;
  quote: string;
  confidence: "high" | "medium" | "low";
}

interface PriceDraft {
  proposals: PriceProposal[];
  queries: string[];
  note: string;
  source: string;
}

interface GapAnalysis {
  id: string;
  marketPrice: number;
  targetMargin: number;
  allowableCost: number;
  estimatedUnitCost: number;
  gap: number;
  gapRatio: number;
  thresholdExceeded: boolean;
  levers: string[];
  source: string;
  rationale: string | null;
  created_by: string;
  created_at: string;
}

const won = (v: number, t: TranslatorFn): string => t("p1Krw", { p1: v.toLocaleString(undefined, { maximumFractionDigits: 1 }) });
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

export function TargetCostingPanel({ projectId }: { projectId: string }) {const t = useTranslations("stages.s8.targetCostingPanel"); const tc = useTranslations("common");
  const [latest, setLatest] = useState<GapAnalysis | null>(null);
  const [threshold, setThreshold] = useState(0.1);
  const [marketPrice, setMarketPrice] = useState("");
  const [targetMargin, setTargetMargin] = useState("0.15");
  const [estimatedUnitCost, setEstimatedUnitCost] = useState("");
  const [levers, setLevers] = useState("");
  const [draft, setDraft] = useState<PriceDraft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [chosenEvidence, setChosenEvidence] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ latest: GapAnalysis | null; threshold: number }>(
        `/api/projects/${encodeURIComponent(projectId)}/target-costing`,
      );
      setLatest(res.data.latest);
      setThreshold(res.data.threshold);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failedToLoadTheTarget"));
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  // live preview of the gap for the values being typed
  const allowable = Number.isFinite(Number(marketPrice)) && marketPrice !== "" ? Number(marketPrice) * (1 - Number(targetMargin || 0)) : null;
  const gapPreview = allowable !== null && estimatedUnitCost !== "" && Number.isFinite(Number(estimatedUnitCost))
    ? Number(estimatedUnitCost) - allowable
    : null;
  const gapRatioPreview = gapPreview !== null && allowable ? gapPreview / allowable : null;

  async function fetchDraft() {
    setMessage(null);
    setError(null);
    setDrafting(true);
    try {
      const res = await api.post<PriceDraft>(
        `/api/projects/${encodeURIComponent(projectId)}/target-costing/price-draft`,
        {},
      );
      setDraft(res.data);
      if (res.data.proposals.length === 0) setError(res.data.note || t("noPriceCandidates"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToGenerateThePrice"));
    } finally {
      setDrafting(false);
    }
  }

  function useProposal(p: PriceProposal) {const t = useTranslations("stages.s8.targetCostingPanel");
    setMarketPrice(String(p.unit_price));
    setChosenEvidence({
      unit_price: p.unit_price,
      currency: p.currency,
      unit: p.unit,
      source_url: p.source_url,
      source_name: p.source_name,
      quote: p.quote,
      searched_at: new Date().toISOString(),
    });
    setMessage(t("filledInPriceP1P2", { p1: p.unit_price.toLocaleString(), p2: p.currency, p3: p.unit, p4: p.source_name }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    try {
      const res = await api.post<{ analysis: GapAnalysis }>(
        `/api/projects/${encodeURIComponent(projectId)}/target-costing`,
        {
          market_price: Number(marketPrice),
          target_margin: Number(targetMargin),
          estimated_unit_cost: Number(estimatedUnitCost),
          levers: levers.split(",").map((l) => l.trim()).filter((l) => l !== ""),
          source: chosenEvidence ? "peer_benchmark" : "user",
          price_evidence: chosenEvidence ?? undefined,
          rationale: chosenEvidence ? `${chosenEvidence.source_url ?? ""}` : undefined,
        },
      );
      setMessage(
        res.data.analysis.thresholdExceeded
          ? t("savedGapP1ThresholdExceeded", { p1: pct(res.data.analysis.gapRatio) })
          : t("savedGapP1WithinThreshold", { p1: pct(res.data.analysis.gapRatio) }),
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToSaveTheTarget"));
    }
  }

  return (
    <>
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
      {message && <p className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-2">✓ {message}</p>}

      <section className="market-section sizing-step" aria-label={t("latestTargetCostingAnalysis")}>
        <h3 className="sizing-step-title">
          {t("targetCostingGapAnalysis")}
          <span className="status-chip status-info">{t("threshold")}{Math.round(threshold * 100)}{t("downsideOpexReflectedWhenExceeded")}</span>
        </h3>
        {!latest ? (
          <p className="text-sm text-[color:var(--muted-fg)]">
            {t("noAnalysisRecordYetEnter")}
          </p>
        ) : (
          <>
            <ParamTable
              caption={t("latestGapAnalysis")}
              labelHeader={tc("items")}
              rows={[
                { label: t("marketPrice"), value: won(latest.marketPrice, t) },
                { label: t("targetMargin"), value: pct(latest.targetMargin) },
                { label: t("allowedCost"), value: won(latest.allowableCost, t) },
                { label: t("estimatedUnitCost"), value: won(latest.estimatedUnitCost, t) },
                {
                  label: tc("gap"),
                  value: won(latest.gap, t),
                  source: (
                    <span className={`status-chip ${latest.thresholdExceeded ? "status-danger" : "status-info"}`}>
                      {pct(latest.gapRatio)} {latest.thresholdExceeded ? t("thresholdExceeded") : t("withinThreshold")}
                    </span>
                  ),
                },
                { label: tc("source"), value: latest.source === "peer_benchmark" ? t("peerBenchmark") : t("userInput") },
              ]}
            />
            {latest.levers.length > 0 && (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2">{t("downsizingPlan")} {latest.levers.join(" · ")}</p>
            )}
            {latest.thresholdExceeded && (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2">
                {t("whenGeneratingTheDownsideScenario")}
              </p>
            )}
          </>
        )}
      </section>

      <section className="market-section sizing-step mt-3" aria-label={t("runTargetCostingAnalysis")}>
        <h3 className="sizing-step-title">{t("runAnalysis")}</h3>
        <form className="grid gap-3" onSubmit={submit} style={{ maxWidth: 560 }}>
          <div className="flex items-center gap-2">
            <button type="button" className="outline-button" onClick={fetchDraft} disabled={drafting}>
              {drafting ? t("item") : t("priceDraftWebSearch")}
            </button>
            {chosenEvidence && (
              <span className="status-chip status-info">{t("webEvidenceAcceptedRecordedTogether")}</span>
            )}
          </div>
          {draft && draft.proposals.length > 0 && (
            <div className="grid gap-2">
              {draft.proposals.map((p, i) => (
                <div key={`${p.source_url}-${p.unit_price}`} className="grid gap-1 border rounded p-2 text-sm" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold tabular-nums">{p.unit_price.toLocaleString()} {p.currency}/{p.unit}</span>
                    <button type="button" className="outline-button btn-sm" onClick={() => useProposal(p)}>{t("useThisPrice")}</button>
                  </div>
                  <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                    <a href={p.source_url} target="_blank" rel="noreferrer" className="underline">{p.source_name}</a>
                    {t("confidence")}{p.confidence}
                  </div>
                  {p.quote && <div className="text-[length:var(--fs-caption)]">"{p.quote.slice(0, 160)}"</div>}
                  <span className="sr-only">{i}</span>
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-2 md:grid-cols-2">
            <label className="grid gap-1 text-sm">{t("marketPriceKrwEa")}<input className="form-input" value={marketPrice} onChange={(e) => setMarketPrice(e.target.value)} placeholder="12000" /></label>
            <label className="grid gap-1 text-sm">{t("targetMarginRatioEG")}<input className="form-input" value={targetMargin} onChange={(e) => setTargetMargin(e.target.value)} placeholder="0.15" /></label>
            <label className="grid gap-1 text-sm">{t("estimatedUnitCostKrwEa")}<input className="form-input" value={estimatedUnitCost} onChange={(e) => setEstimatedUnitCost(e.target.value)} placeholder="11800" /></label>
            <label className="grid gap-1 text-sm">{tc("source")}<select className="form-input" value={"user"} onChange={() => undefined}><option value="user">{t("userInput2")}</option></select></label>
          </div>
          <label className="grid gap-1 text-sm">{t("downsizingPlanCommaSeparatedOptional")}<input className="form-input" value={levers} onChange={(e) => setLevers(e.target.value)} placeholder={t("sourcingPriceNegotiation")} /></label>
          {gapRatioPreview !== null && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("previewAllowedCost")} {won(allowable!, t)} {t("gap")} {won(gapPreview!, t)} ({pct(gapRatioPreview)})
            </p>
          )}
          <button className="primary-button justify-self-start" type="submit">{t("saveGapAnalysis")}</button>
          <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
            {t("gapEstimatedUnitCostAllowed")}
          </p>
        </form>
      </section>
    </>
  );
}
