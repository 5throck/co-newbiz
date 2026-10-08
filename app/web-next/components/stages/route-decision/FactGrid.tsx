"use client";

// Split from components/stages/RouteDecisionStage.tsx (Wave U-3 decomposition); behavior unchanged.
import type { RouteDecisionStageState } from "./useRouteDecision.ts";
import type { OpportunityRow } from "./types.ts";

export function FactGrid({ ctx, selected }: { ctx: RouteDecisionStageState; selected: OpportunityRow }) {
  const { advisory, setTab, reco, canAct, recoLoading, generateRecommendation, recoError, confirm, applyRecommendation } = ctx;
  return (
    <>{selected && advisory !== null && (() => {
        const trackLabel = advisory.recommendedTrack === "neutral" ? "중립 (신호 부족)" : advisory.recommendedTrack === "greenfield" ? "Greenfield" : "Brownfield";
        const supporting = advisory.signals
          .filter((s) => s.leans === advisory.recommendedTrack)
          .sort((a, b) => b.weight - a.weight);
        const neutralCount = advisory.signals.filter((s) => s.leans === "neutral").length;
        const gfPct = Math.round((advisory.greenfieldScore / Math.max(1, advisory.greenfieldScore + advisory.brownfieldScore)) * 100);
        return (
          <div className="card" id="reco-card">
            <h2 className="flex items-center gap-2">
              진출방식 추천 <span className="status-chip status-not-started">제안</span>
            </h2>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              원칙 (경계 #2): 최종 결정은 사람이 기록합니다 — 이 카드는 S1~S3 산출물에서 자동으로 만든 <b>제안</b>이며, 아래 &quot;결정&quot; 탭에 반영한 뒤 자유롭게 수정할 수 있습니다.
            </p>
            <p className="text-[0.95rem] mb-0">
              추천: <strong className={advisory.recommendedTrack === "greenfield" ? "text-[color:var(--green-fg)]" : advisory.recommendedTrack === "brownfield" ? "text-[color:var(--amber-fg)]" : undefined}>{trackLabel}</strong>
            </p>
            <div className="route-score-bar" role="img" aria-label={`Greenfield ${advisory.greenfieldScore}점, Brownfield ${advisory.brownfieldScore}점`}>
              <div className="route-score-bar-seg gf" style={{ width: `${gfPct}%` }} />
              <div className="route-score-bar-seg bf" style={{ width: `${100 - gfPct}%` }} />
            </div>
            <div className="route-score-legend mb-2">
              <span>Greenfield <strong className="tabular-nums">{advisory.greenfieldScore}</strong></span>
              <span>Brownfield <strong className="tabular-nums">{advisory.brownfieldScore}</strong></span>
            </div>
            {advisory.recommendedTrack !== "neutral" && (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
                신호 {advisory.signals.length}건 중 {supporting.length}건이 {trackLabel}, {neutralCount}건 중립 (근거 전체는{" "}
                <button type="button" className="text-[color:var(--accent)] underline" onClick={() => setTab("eval")}>평가 근거 탭</button>)
              </p>
            )}
            {advisory.reReviewTriggers.length > 0 && (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg)] mb-2">점검: {advisory.reReviewTriggers.join(" / ")}</p>
            )}
            {supporting.length > 0 ? (
              <ul className="sizing-note-list mb-2">
                {supporting.map((s) => <li key={s.key}>{s.label} — {s.note}</li>)}
              </ul>
            ) : (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">신호가 뚜렷한 방향을 가리키지 않습니다.</p>
            )}

            {/* AI 서술 초안 — 신호 요약을 문장으로 확장한 LLM 초안. 기존 reco 상태 그대로. */}
            <div className="sizing-grade-card mb-3">
              <h4 className="text-[length:var(--fs-body)] mb-2 flex items-center gap-2">
                AI 서술 초안
                {reco && (
                  <span className="status-chip status-not-started">
                    {reco.source === "llm" ? `제안 · LLM${reco.provider ? ` · ${reco.provider}` : ""}` : "제안 · 결정론 폴백"}
                  </span>
                )}
                {canAct && reco && (
                  <button type="button" className="btn-ghost btn-sm ml-auto" disabled={recoLoading} onClick={() => void generateRecommendation()}>
                    재생성
                  </button>
                )}
              </h4>
              {recoError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2">{recoError}</p>}
              {canAct && !reco && !recoLoading && !recoError && (
                <div className="flex flex-wrap items-center gap-2 mb-0">
                  <button type="button" className="btn-ghost" onClick={() => void generateRecommendation()}>
                    ▶ LLM 추천 생성
                  </button>
                  <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">권장 트랙·라우트·5기준 채점 초안(점수+근거)과 결정 근거 서술 초안을 작성해 채움을 돕습니다.</span>
                </div>
              )}
              {recoLoading && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">S1~S3 산출물과 어드바이저 신호를 근거로 초안을 작성하는 중...</p>}
              {reco && (
                <>
                  {reco.note && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{reco.note}</p>}
                  {reco.recommendation.rationale_draft && (
                    <p className="text-[length:var(--fs-caption)] mb-2"><span className="font-semibold">근거 초안:</span> {reco.recommendation.rationale_draft}</p>
                  )}
                  {reco.recommendation.alternatives_draft && (
                    <p className="text-[length:var(--fs-caption)] mb-2"><span className="font-semibold">대안 검토 초안:</span> {reco.recommendation.alternatives_draft}</p>
                  )}
                  {reco.recommendation.cautions.length > 0 && (
                    <>
                      <p className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg, var(--accent))] font-semibold mb-1">유의</p>
                      <ul className="sizing-note-list mb-0">
                        {reco.recommendation.cautions.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>

            {canAct && reco && (
              <div className="flex flex-wrap items-center gap-2 mb-0">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => confirm("추천을 결정 탭에 반영할까요?", applyRecommendation, {
                    body: "현재 입력한 트랙·라우트·채점·근거를 추천 초안으로 덮어씁니다 — 반영 후에도 자유롭게 수정할 수 있고, 결정은 결정 탭의 '결정' 버튼을 누른 사람에게 기록됩니다.",
                    confirmLabel: "반영",
                  })}
                >
                  결정 탭에 반영
                </button>
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">반영은 입력값 채움일 뿐입니다 — 최종 기록은 &quot;결정&quot; 탭의 &apos;결정&apos; 버튼 (사람 클릭).</span>
              </div>
            )}
          </div>
        );
      })()}</>
  );
}
