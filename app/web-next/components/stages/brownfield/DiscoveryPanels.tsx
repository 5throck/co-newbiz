"use client";

// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.
import type { BrownfieldStageState } from "./useBrownfieldTargets.ts";

export function WebDiscoveryPanel({ ctx }: { ctx: BrownfieldStageState }) {
  const { selected, discoveryPanel, webBusy, setDiscoveryPanel, webModalFocus, webProposals, webNote, webSource, acceptProposal, setWebProposals, generateWebProposals } = ctx;
  return (
    <>{selected && discoveryPanel === "web" && (
        <div className="modal-backdrop" onClick={() => { if (!webBusy) setDiscoveryPanel(null); }} onKeyDown={webModalFocus.onKeyDown}>
          <div ref={webModalFocus.panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-label="웹검색 후보 제안" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>웹검색 후보 제안</h2>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setDiscoveryPanel(null)} disabled={webBusy} aria-label="닫기">닫기</button>
            </div>
            <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              실시간 웹 검색으로 근거를 찾고, 그 근거에 등장하는 회사만 후보로 제안합니다 (근거 없는
              회사명은 만들지 않습니다). 검색을 쓸 수 없으면 AI 자체 지식 기반 미검증 제안으로 대체됩니다.
              등록은 항목별 "후보 전체 목록에 등록" 클릭으로만 이뤄집니다.
            </p>
            {webBusy && webProposals === null ? (
              <p className="my-4 text-center text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">웹 검색·제안 생성 중...</p>
            ) : webProposals !== null && webProposals.length === 0 ? (
              <>
                <p className="my-4 text-center text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{webNote ?? "제안할 후보가 없습니다 — 목표 시장 정의를 구체화한 뒤 다시 시도하세요."}</p>
                <div className="flex justify-end">
                  <button type="button" className="btn-ghost btn-sm" disabled={webBusy} onClick={() => void generateWebProposals()}>다시 시도</button>
                </div>
              </>
            ) : (
              <>
                {webProposals !== null && (
                  <p className="mb-2 text-[length:var(--fs-caption)]">
                    <span className={`status-chip ${webSource === "llm" ? "status-green" : webSource === "llm_knowledge" ? "status-red" : "status-amber"}`}>
                      {webSource === "llm" ? "제안 · 웹검색 근거" : webSource === "llm_knowledge" ? "제안 · 미검증 (근거 없음)" : "제안 · 결정론 폴백"}
                    </span>
                    {webNote && <span className="ml-2 text-[color:var(--muted-fg)]">{webNote}</span>}
                  </p>
                )}
                <div className="grid grid-cols-1 gap-2 mb-3" style={{ maxHeight: "60vh", overflowY: "auto" }}>
                  {(webProposals ?? []).map((s) => (
                    <div key={s.company_name} className="sizing-grade-card mb-0">
                      <div className="flex items-start justify-between gap-2">
                        <strong className="text-[length:var(--fs-body)]">{s.company_name}</strong>
                        <span className="status-chip status-not-started" title="출처 도메인 신뢰도 — 정부·공시 A, 주요 언론·컨설팅 B, 기타 C">
                          신뢰도 {s.reliability}
                        </span>
                      </div>
                      <p className="mb-1 text-[length:var(--fs-caption)]">{s.rationale}</p>
                      {s.sources.slice(0, 2).map((src) => (
                        <a key={src.url} href={src.url} target="_blank" rel="noreferrer" className="block text-[length:var(--fs-caption)] text-[color:var(--accent)] underline truncate" title={src.title}>
                          출처: {src.url}
                        </a>
                      ))}
                      <span className="flex items-center gap-1 mt-1">
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={webBusy}
                          onClick={() => void acceptProposal(s.company_name, s.dart_corp_code ?? null, "web_proposal", `웹 검색 제안 — ${s.rationale.slice(0, 80)} (출처: ${s.sources[0]?.url ?? "없음"})`)}
                        >
                          후보 전체 목록에 등록
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          title="이 제안을 목록에서 지웁니다 — 등록하지 않고 무시(재생성 시 다시 나올 수 있음)"
                          onClick={() => setWebProposals((prev) => (prev ?? []).filter((p) => p.company_name !== s.company_name))}
                        >
                          무시
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-ghost btn-sm" disabled={webBusy} onClick={() => void generateWebProposals()}>
                    {webBusy ? "재생성 중..." : "다시 생성"}
                  </button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setDiscoveryPanel(null)}>닫기</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}</>
  );
}

export function UniverseEditModal({ ctx }: { ctx: BrownfieldStageState }) {
  const { editingUniverse, savingUniverse, uniReco, uniBusy, universeDraft, uniRecoApplied, setUniReco, setUniRecoApplied, closeUniverseEditor, universeModalFocus, generateUniReco, applyUniReco, UniverseForm } = ctx;
  return (
    <>{editingUniverse && (
        <div className="modal-backdrop" onClick={() => { if (!savingUniverse) closeUniverseEditor(); }} onKeyDown={universeModalFocus.onKeyDown}>
          <div ref={universeModalFocus.panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-label="목표 시장 정의 수정" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>목표 시장 정의 수정</h2>
              <button type="button" className="btn-ghost btn-sm" onClick={closeUniverseEditor} disabled={savingUniverse} aria-label="닫기">닫기</button>
            </div>
            <p className="mb-3 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">저장하기 전까지는 아무 값도 반영되지 않습니다.</p>

            {/* D — 선정 기준 LLM 초안. 적용은 아래 정의 입력에 바로 반영되고,
                선정 기준·최소 후보 수는 사람이 정한 값을 그대로 둔다. */}
            <div className="sizing-grade-card mb-3">
              <h4 className="text-[length:var(--fs-caption)] mb-2">
                정의 초안 생성 <span className="status-chip status-amber">제안 · AI</span>
              </h4>
              <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                S1 시장분석 + S3 필요 역량 산출물을 근거로 정의 문구 초안을 제안합니다. "적용"은 아래 <b>정의</b> 입력만 채웁니다 —
                후보 자격 기준·최소 후보 수는 그대로 유지되며, 실제 저장은 "목표 시장 저장" 버튼(사람 클릭)으로 확정됩니다 (경계 #2).
              </p>
              {uniReco === null ? (
                <button type="button" className="btn-ghost btn-sm" disabled={uniBusy} onClick={() => void generateUniReco()}>
                  {uniBusy ? "초안 생성 중..." : "정의 초안 생성"}
                </button>
              ) : uniReco.criteria ? (() => {
                const rationaleAlreadySaved = !!uniReco.criteria.rationale && uniReco.criteria.rationale.trim() === universeDraft.definition.trim();
                return (
                  <div>
                    <p className="mb-1 text-[length:var(--fs-caption)]">
                      <span className={`status-chip mr-1 ${uniRecoApplied ? "status-green" : "status-amber"}`}>{uniRecoApplied ? "적용됨" : "제안"}</span>
                      {uniReco.source === "llm" ? "AI" : "결정론"}
                    </p>
                    <ul className="sizing-note-list mb-2">
                      {uniReco.criteria.industry && <li>산업: {uniReco.criteria.industry}</li>}
                      {uniReco.criteria.region && <li>지역: {uniReco.criteria.region}</li>}
                      {uniReco.criteria.size && <li>규모: {uniReco.criteria.size}</li>}
                    </ul>
                    {uniReco.criteria.rationale && (
                      rationaleAlreadySaved ? (
                        <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">근거: 아래 정의 입력과 동일합니다.</p>
                      ) : (
                        <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">근거: {uniReco.criteria.rationale}</p>
                      )
                    )}
                    <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">이 제안이 본 산출물: {uniReco.manifest.join(" · ") || "(근거 없음)"}</p>
                    <div className="flex items-center gap-1">
                      <button type="button" className="btn-ghost btn-sm" disabled={rationaleAlreadySaved} onClick={() => applyUniReco(uniReco.criteria!)}>
                        {rationaleAlreadySaved ? "이미 반영됨" : uniRecoApplied ? "다시 적용" : "정의 입력에 적용"}
                      </button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => { setUniReco(null); setUniRecoApplied(false); }}>닫기</button>
                      <button type="button" className="btn-ghost btn-sm" disabled={uniBusy} onClick={() => void generateUniReco()}>{uniBusy ? "재생성 중..." : "재생성"}</button>
                    </div>
                  </div>
                );
              })() : (
                <div>
                  <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--amber-fg)]">{uniReco.note ?? "초안을 만들 수 없습니다."}</p>
                  <button type="button" className="btn-ghost btn-sm" disabled={uniBusy} onClick={() => void generateUniReco()}>{uniBusy ? "재생성 중..." : "다시 시도"}</button>
                </div>
              )}
            </div>

            <UniverseForm />
          </div>
        </div>
      )}</>
  );
}
