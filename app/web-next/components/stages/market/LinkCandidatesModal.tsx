"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import type { MarketAnalysisStageState } from "./useMarketList.ts";

export function LinkCandidatesModal({ ctx }: { ctx: MarketAnalysisStageState }) {
  const { linkModal, setLinkModal, toggleCandidate, rerunProxyAnalysis, runWithSelections, canCurate } = ctx;
  return (
    <>{linkModal.open && (
        <div className="modal-backdrop" onClick={() => { if (!linkModal.running) setLinkModal((prev) => ({ ...prev, open: false })); }}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label="가치사슬 연계 산업 선택"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[length:var(--fs-body)] mb-1">
              {linkModal.rerunAnalysisId ? "가치사슬 연계 산업 선택" : "가치사슬 연계 산업 미리보기"} — <span className="font-semibold">{linkModal.primaryName}</span>
            </h2>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              {linkModal.rerunAnalysisId
                ? "재분석 대상 산업과 연관성이 있는 산업 후보입니다. 선택한 산업은 '연계 대기'로 등록되며, 재분석이 완료된 뒤 한 건씩 자동으로 시작됩니다. 마스터에 없는 산업은 시작 시 자동 등록됩니다."
                : `첫 분석은 '${linkModal.primaryName}'만 진행됩니다. 아래는 함께 볼 만한 연계 산업 제안이며, 분석이 완료되면 리포트에서 '연계 산업 이어서 분석'으로 선택·추가할 수 있습니다.`}
            </p>
            {linkModal.loading ? (
              <p className="text-[length:var(--fs-body)]" role="status">연계 산업 후보를 도출하는 중입니다 (수 초 소요) — 아직 분석은 시작되지 않았습니다.</p>
            ) : linkModal.candidates.length === 0 && linkModal.substitutes.length === 0 ? (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                연관 산업 후보를 도출하지 못했습니다 — 이 산업만 분석을 진행할 수 있습니다.
              </p>
            ) : (
              <>
                <ul className="sizing-note-list mb-2" aria-label="연관 산업 후보">
                  {linkModal.candidates.map((c) => (
                    <li key={c.name_ko}>
                      <label className={`flex items-start gap-2 text-[length:var(--fs-caption)] ${linkModal.rerunAnalysisId && !c.locked ? "cursor-pointer" : ""}`}>
                        {linkModal.rerunAnalysisId ? (
                          <input
                            type="checkbox"
                            checked={linkModal.selected.has(c.name_ko)}
                            disabled={c.locked}
                            onChange={() => toggleCandidate(c.name_ko, c.locked)}
                            className="mt-1"
                          />
                        ) : (
                          <span className="mt-1 inline-block w-3.5" aria-hidden="true" />
                        )}
                        <span>
                          <span className="font-semibold">{c.relation}</span> · {c.name_ko}{" "}
                          <span className={`status-chip ${c.industry_id ? "status-green" : "status-amber"}`}>
                            {c.industry_id ? "분석 가능" : "미등록 — 자동 등록"}
                          </span>
                          {c.locked && <span className="control-chip status-green" title="이미 등록된 연계 산업 — 재분석 시 자동 반영, 해제 불가">등록됨 · 고정</span>}
                          {c.source === "proxy" && <span className="status-chip status-not-started" title="AI 1차 추천 — 검증 전 가설입니다.">제안 (검증 전)</span>}
                          {c.source === "link" && <span className="status-chip status-green">연계 근거</span>}
                          {c.source === "analysis" && <span className="status-chip status-not-started">과거 분석</span>}
                          {c.note && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{c.note}</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                {linkModal.substitutes.length > 0 && (
                  <div className="mb-2">
                    <p className="text-[length:var(--fs-caption)] font-semibold">대체 위협 (검토 필요) — 6축 연관성 분석 영역</p>
                    <ul className="sizing-note-list" aria-label="대체 위협 후보">
                      {linkModal.substitutes.map((sub) => (
                        <li key={sub.name_ko} className="text-[length:var(--fs-caption)]">
                          {sub.name_ko}
                          {sub.note && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{sub.note}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {linkModal.rerunAnalysisId && (
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                    이미 등록된 수요 산업은 재분석에 자동으로 반영됩니다 — 위 목록에서 제외할 수 없습니다.
                    {linkModal.selected.size >= 5 && " 대기 큐는 최대 5건까지 선택할 수 있습니다."}
                  </p>
                )}
                {canCurate && (
                  <button type="button" className="btn-ghost btn-sm" disabled={linkModal.loading || linkModal.running} onClick={() => void rerunProxyAnalysis()}>
                    후보 다시 도출
                  </button>
                )}
              </>
            )}
            <div className="flex justify-end gap-2 mt-3">
              <button type="button" className="btn-ghost" disabled={linkModal.running} onClick={() => setLinkModal((prev) => ({ ...prev, open: false }))}>
                취소
              </button>
              {canCurate && (
              <button type="button" className="btn-primary" disabled={linkModal.running} onClick={() => void runWithSelections()}>
                {linkModal.running
                  ? "분석 시작 중..."
                  : linkModal.rerunAnalysisId
                    ? linkModal.selected.size > 0 ? `재분석 시작 (연계 ${linkModal.selected.size}건은 완료 후 자동 시작)` : "재분석 시작"
                    : "이 산업만 분석"}
              </button>
              )}
            </div>
          </div>
        </div>
      )}</>
  );
}
