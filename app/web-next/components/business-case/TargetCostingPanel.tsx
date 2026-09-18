"use client";

// TargetCostingPanel — S8 타겟코스팅 카드 (design
// 2026-09-18-s8-business-case-evaluation REQ-W2, skill target-costing-analysis).
// 시장가격을 목표마진으로 역산한 허용원가와 추정 단위원가의 격차를 기록하고,
// 임계(+10%) 초과 격차는 downside 시나리오 opex 드라이버에 반영됨을 표시한다.

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.ts";

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

const won = (v: number): string => `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} 원`;
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

export function TargetCostingPanel({ projectId }: { projectId: string }) {
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
      setError(e instanceof Error ? e.message : "타겟코스팅 분석을 불러오지 못했습니다.");
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
      if (res.data.proposals.length === 0) setError(res.data.note || "가격 후보가 없습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "가격 초안 생성에 실패했습니다.");
    } finally {
      setDrafting(false);
    }
  }

  function useProposal(p: PriceProposal) {
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
    setMessage(`가격 ${p.unit_price.toLocaleString()} ${p.currency}/${p.unit} 을(를) 채웠습니다 — 출처: ${p.source_name}. 저장으로 확정하세요.`);
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
          ? `저장 완료 — 격차 ${pct(res.data.analysis.gapRatio)} (임계 초과). 하락 시나리오 재생성 시 opex 드라이버에 반영됩니다.`
          : `저장 완료 — 격차 ${pct(res.data.analysis.gapRatio)} (임계 이내).`,
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "타겟코스팅 분석 저장에 실패했습니다.");
    }
  }

  return (
    <>
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem] mb-2">✕ {error}</p>}
      {message && <p className="text-[color:var(--green-fg)] text-[0.82rem] mb-2">✓ {message}</p>}

      <section className="market-section sizing-step" aria-label="최근 타겟코스팅 분석">
        <h3 className="sizing-step-title">
          타겟코스팅 격차 분석
          <span className="status-chip status-info">임계 +{Math.round(threshold * 100)}% — 초과 시 downside opex 반영</span>
        </h3>
        {!latest ? (
          <p className="text-sm text-[color:var(--muted-fg)]">
            아직 분석 기록이 없습니다. 아래 폼에서 시장가격·목표마진·추정 단위원가를 입력해 첫 격차를 기록하세요.
          </p>
        ) : (
          <>
            <dl className="grid gap-2 md:grid-cols-3 text-sm">
              <div><dt className="text-[color:var(--muted-fg)]">시장가격</dt><dd className="font-semibold tabular-nums">{won(latest.marketPrice)}</dd></div>
              <div><dt className="text-[color:var(--muted-fg)]">목표마진</dt><dd className="font-semibold">{pct(latest.targetMargin)}</dd></div>
              <div><dt className="text-[color:var(--muted-fg)]">허용원가</dt><dd className="font-semibold tabular-nums">{won(latest.allowableCost)}</dd></div>
              <div><dt className="text-[color:var(--muted-fg)]">추정 단위원가</dt><dd className="font-semibold tabular-nums">{won(latest.estimatedUnitCost)}</dd></div>
              <div>
                <dt className="text-[color:var(--muted-fg)]">격차</dt>
                <dd className="font-semibold tabular-nums">
                  {won(latest.gap)}
                  <span className={`status-chip ml-1 ${latest.thresholdExceeded ? "status-danger" : "status-info"}`}>
                    {pct(latest.gapRatio)} {latest.thresholdExceeded ? "⚠ 임계 초과" : "임계 이내"}
                  </span>
                </dd>
              </div>
              <div><dt className="text-[color:var(--muted-fg)]">출처</dt><dd>{latest.source === "peer_benchmark" ? "peer 벤치마크" : "사용자 입력"}</dd></div>
            </dl>
            {latest.levers.length > 0 && (
              <p className="text-[0.8rem] text-[color:var(--muted-fg)] mt-2">축소 방안: {latest.levers.join(" · ")}</p>
            )}
            {latest.thresholdExceeded && (
              <p className="text-[0.8rem] text-[color:var(--muted-fg)] mt-2">
                하락(downside) 시나리오 생성 시 opex 드라이버에 이 격차가 반영됩니다 — 시나리오 비교 탭에서 재생성하세요.
              </p>
            )}
          </>
        )}
      </section>

      <section className="market-section sizing-step mt-3" aria-label="타겟코스팅 분석 실행">
        <h3 className="sizing-step-title">분석 실행</h3>
        <form className="grid gap-3" onSubmit={submit} style={{ maxWidth: 560 }}>
          <div className="flex items-center gap-2">
            <button type="button" className="outline-button" onClick={fetchDraft} disabled={drafting}>
              {drafting ? "검색 중…" : "가격 초안 (웹검색)"}
            </button>
            {chosenEvidence && (
              <span className="status-chip status-info">웹 근거 채택됨 — 저장 시 함께 기록</span>
            )}
          </div>
          {draft && draft.proposals.length > 0 && (
            <div className="grid gap-2">
              {draft.proposals.map((p, i) => (
                <div key={`${p.source_url}-${p.unit_price}`} className="grid gap-1 border rounded p-2 text-sm" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold tabular-nums">{p.unit_price.toLocaleString()} {p.currency}/{p.unit}</span>
                    <button type="button" className="outline-button btn-sm" onClick={() => useProposal(p)}>이 가격 사용</button>
                  </div>
                  <div className="text-[color:var(--muted-fg)] text-[0.78rem]">
                    <a href={p.source_url} target="_blank" rel="noreferrer" className="underline">{p.source_name}</a>
                    {" · 확신도 "}{p.confidence}
                  </div>
                  {p.quote && <div className="text-[0.78rem]">"{p.quote.slice(0, 160)}"</div>}
                  <span className="sr-only">{i}</span>
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-2 md:grid-cols-2">
            <label className="grid gap-1 text-sm">시장가격 (원/EA)<input className="form-input" value={marketPrice} onChange={(e) => setMarketPrice(e.target.value)} placeholder="12000" /></label>
            <label className="grid gap-1 text-sm">목표마진 (비율, 예: 0.15)<input className="form-input" value={targetMargin} onChange={(e) => setTargetMargin(e.target.value)} placeholder="0.15" /></label>
            <label className="grid gap-1 text-sm">추정 단위원가 (원/EA)<input className="form-input" value={estimatedUnitCost} onChange={(e) => setEstimatedUnitCost(e.target.value)} placeholder="11800" /></label>
            <label className="grid gap-1 text-sm">출처<select className="form-input" value={"user"} onChange={() => undefined}><option value="user">사용자 입력</option></select></label>
          </div>
          <label className="grid gap-1 text-sm">축소 방안 (쉼표 구분, 선택)<input className="form-input" value={levers} onChange={(e) => setLevers(e.target.value)} placeholder="설계-to-cost, 소싱 단가 협상" /></label>
          {gapRatioPreview !== null && (
            <p className="text-[0.82rem] text-[color:var(--muted-fg)]">
              미리보기 — 허용원가 {won(allowable!)} · 격차 {won(gapPreview!)} ({pct(gapRatioPreview)})
            </p>
          )}
          <button className="primary-button justify-self-start" type="submit">격차 분석 저장</button>
          <p className="text-[color:var(--muted-fg)] text-[0.78rem]">
            격차 = 추정 단위원가 − 허용원가(시장가격 × (1 − 목표마진)). 기록은 제안이며 판정은 사람의 몫입니다.
          </p>
        </form>
      </section>
    </>
  );
}
