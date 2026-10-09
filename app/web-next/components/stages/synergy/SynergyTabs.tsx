"use client";

// Split from components/stages/SynergyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import type { SynergyResultState } from "./useSynergyResult.ts";
import type { SynergyPayload } from "./types.ts";

export function SynergyOverviewTab({ ctx, p }: { ctx: SynergyResultState; p: SynergyPayload }) {
  const { tab, confirmError, currentScore, synState, currentRationale, canCurate, opportunityId, confirmForm, setConfirmForm, confirmSaving, confirmSynergyScore, retractSynergyScore } = ctx;
  return (
    <>{tab === "overview" && (
            <div className="text-[0.88rem]">
              <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge">◎</span> 프로파일 요약 — 상세는 그룹/계열사 분석 담당</h3>
              <div className="sizing-grade-card mb-3">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <strong className="text-[0.9rem]">{p.target?.name ?? p.company.name}</strong>
                  {p.dataSources?.dart && <span className="status-chip status-green">DART {p.dataSources.dartYear ?? ""}</span>}
                  {(p.financialStrengths?.length ?? 0) > 0 && <span className="status-chip status-in-progress">강점 {p.financialStrengths.length}건</span>}
                  {(p.financialWeaknesses?.length ?? 0) > 0 && <span className="status-chip status-not-started">약점 {p.financialWeaknesses.length}건</span>}
                  {p.profileRef && (
                    <a
                      href={p.profileRef.kind === "affiliate" ? `/our-company?member=${encodeURIComponent(p.profileRef.id)}` : "/our-company"}
                      className="text-[color:var(--accent)] underline text-[length:var(--fs-caption)]"
                    >
                      상세 프로파일 보기 →
                    </a>
                  )}
                </div>
                <p className="mb-0 text-[length:var(--fs-body)]" style={{ whiteSpace: "pre-line" }}>{p.businessAssessment}</p>
              </div>
              {p.opportunity && (
                <div className="sizing-grade-card mb-3">
                  <h4 className="text-[length:var(--fs-body)] mb-2">연결 기회 — S2 기회발굴</h4>
                  <p className="mb-2 text-[length:var(--fs-body)]"><strong>{p.opportunity.name}</strong></p>
                  {confirmError && <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]" role="alert">{confirmError}</p>}
                  {currentScore != null ? (
                    <>
                      <p className="mb-2 text-[length:var(--fs-caption)]">
                        {synState?.confirmed ? (
                          <>
                            현재 기록: <span className="status-chip status-green">확정 {synState.synergyScore}점 (사람 확정)</span>
                            {synState.confirmedAt && <span className="text-[color:var(--muted-fg)]"> — {synState.confirmedAt.slice(0, 10)}{synState.confirmedBy ? ` · ${synState.confirmedBy}` : ""}</span>}
                          </>
                        ) : (
                          <>
                            현재 기록: <span className="status-chip status-amber">권고 {currentScore}점 (사람 확정 전)</span>
                            <span className="block mt-1 text-[color:var(--muted-fg)]">확정 전 권고는 S4 진출방식 결정의 트랙 근거에 반영되지 않습니다.</span>
                          </>
                        )}
                        {currentRationale && (
                          <span className="block mt-1 text-[color:var(--muted-fg)]">
                            {synState?.confirmed ? currentRationale : <>AI 산출 근거 (초안 — 계산 과정 그대로): {currentRationale}</>}
                          </span>
                        )}
                      </p>
                      {canCurate && opportunityId && (
                        /* 확정 편집기 — 항상 열려 있다. 접힌 토글 뒤에 두면 확정
                           행위 자체가 인지되지 않는다(2026-09-14 사용자 리포트).
                           근거 입력란은 미확정 상태에서 비워둔다 — AI 계산 로그를
                           그대로 "사람이 확정한 근거"로 자동 제출하지 않도록
                           (2026-09-15 사용자 리포트), 필요하면 아래 버튼으로 AI
                           초안을 명시적으로 불러와 검토·수정한다. */
                        <div className="p-2 border border-[color:var(--border)] rounded">
                          <p className="text-[length:var(--fs-caption)] font-semibold mb-2">시너지 점수 확정 — 점수를 직접 수정하고 기록합니다 (경계 #2)</p>
                          <div className="flex flex-wrap items-end gap-2">
                            <label className="text-[length:var(--fs-caption)]">
                              <span className="text-label block mb-1">점수 (0~100)</span>
                              <input type="number" min={0} max={100} className="sizing-new-input sizing-new-input-sm w-[7rem]" value={confirmForm.score}
                                onChange={(e) => setConfirmForm({ ...confirmForm, score: e.target.value })} />
                            </label>
                            <label className="text-[length:var(--fs-caption)] flex-1 min-w-[16rem]">
                              <span className="text-label block mb-1">확정 근거 — 직접 작성 (사람의 판단)</span>
                              <input type="text" className="sizing-new-input sizing-new-input-sm w-full" value={confirmForm.rationale}
                                placeholder="이 점수를 확정하는 근거를 직접 기록하세요 — AI 초안을 참고하려면 오른쪽 버튼"
                                onChange={(e) => setConfirmForm({ ...confirmForm, rationale: e.target.value })} />
                            </label>
                            {!synState?.confirmed && currentRationale && (
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                onClick={() => setConfirmForm({ ...confirmForm, rationale: currentRationale })}
                              >
                                AI 초안 불러오기
                              </button>
                            )}
                            <button type="button" className="btn-ghost btn-sm" disabled={confirmSaving || confirmForm.score === ""} onClick={confirmSynergyScore}>
                              {confirmSaving ? "저장 중..." : "확정 저장"}
                            </button>
                            {synState?.confirmed && (
                              <button type="button" className="btn-ghost btn-sm" disabled={confirmSaving} onClick={retractSynergyScore}>확정 철회</button>
                            )}
                          </div>
                          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">
                            확정된 점수만 S4 진출방식 결정의 트랙 판단 근거로 반영됩니다. 재분석이 다른 점수를 기록하면 확정은 자동으로 무효화됩니다.
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">연결된 분석에 시너지 점수 권고가 아직 없습니다 — 분석 완료 후 권고가 기록됩니다.</p>
                  )}
                </div>
              )}
            </div>
          )}</>
  );
}

export function SynergyShortlistTab({ ctx, p }: { ctx: SynergyResultState; p: SynergyPayload }) {
  const { tab, canCurate, editingArea, editForm, setEditForm, editSaving, setEditingArea, saveShortlistItem, editError, showShortlistForm, setShowShortlistForm, shortlistForm, setShortlistForm, opportunityId } = ctx;
  return (
    <>{tab === "shortlist" && (
            <div className="text-[0.88rem]">
              <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge sizing-step-badge-deep">4</span> 우선 시너지 영역 — 선별 결과</h3>
              <table className="data-table list-table" aria-label="우선 시너지 영역">
                <caption className="sr-only">우선 시너지 영역</caption>
                <thead><tr><th scope="col" className="w-[3.5rem]">순위</th><th scope="col" className="w-[12rem]">영역</th><th scope="col" className="w-[8rem]">판정</th><th scope="col">사유</th><th scope="col" className="w-[6rem]">출처</th>{canCurate && <th scope="col" className="w-[10rem]"><span className="sr-only">작업</span></th>}</tr></thead>
                <tbody>
                  {p.shortList.map((s) => {
                    const isEditing = editingArea === s.area;
                    return (
                      <tr key={s.area}>
                        <td className="tabular-nums font-semibold">{s.rank}</td>
                        <td className="font-semibold">{s.area}</td>
                        {isEditing ? (
                          <>
                            <td>
                              <select className="sizing-new-input sizing-new-input-sm" value={editForm.verdict} onChange={(e) => setEditForm({ ...editForm, verdict: e.target.value })}>
                                <option value="Short List">선별</option>
                                <option value="보류">보류</option>
                              </select>
                            </td>
                            <td>
                              <input className="sizing-new-input w-full" value={editForm.reason} onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })} />
                            </td>
                          </>
                        ) : (
                          <>
                            <td><span className={`status-chip ${s.verdict.includes("Short") ? "status-green" : "status-not-started"}`}>{s.verdict.includes("Short") ? "선별" : s.verdict}</span></td>
                            <td className="text-[length:var(--fs-body)]">{s.reason}</td>
                          </>
                        )}
                        <td>
                          <span className={`status-chip ${s.origin === "human" ? "status-in-progress" : "status-not-started"}`} title={s.editedBy ? `${s.editedBy}가 수정 (${s.editedAt?.slice(0, 10) ?? ""})` : undefined}>
                            {s.origin === "human" ? "사람 추가" : s.editedBy ? "AI 추천 · 사람 수정" : "AI 추천"}
                          </span>
                        </td>
                        {canCurate && (
                          <td className="sizing-actions-cell">
                            {isEditing ? (
                              <span className="actions-row">
                                <button type="button" className="btn-ghost btn-sm" disabled={editSaving} onClick={() => setEditingArea(null)}>취소</button>
                                <button type="button" className="btn-ghost btn-sm" disabled={editSaving || !editForm.reason.trim()} onClick={() => void saveShortlistItem(s.area, editForm.verdict, editForm.reason)}>
                                  {editSaving ? "저장 중..." : "저장"}
                                </button>
                              </span>
                            ) : (
                              <button type="button" className="btn-ghost btn-sm" onClick={() => { setEditingArea(s.area); setEditForm({ verdict: s.verdict, reason: s.reason }); }}>수정</button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {editError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-1">{editError}</p>}
              {canCurate && (
                <div className="mt-3">
                  {!showShortlistForm ? (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setShowShortlistForm(true)}>＋ 새 영역 추가</button>
                  ) : (
                    <div className="sizing-grade-card">
                      <div className="flex flex-wrap gap-2 mb-2">
                        <input className="sizing-new-input" style={{ flex: "1 1 12rem" }} placeholder="영역명 *" value={shortlistForm.area} onChange={(e) => setShortlistForm({ ...shortlistForm, area: e.target.value })} />
                        <select className="sizing-new-input sizing-new-input-sm" value={shortlistForm.verdict} onChange={(e) => setShortlistForm({ ...shortlistForm, verdict: e.target.value })}>
                          <option value="Short List">선별</option>
                          <option value="보류">보류</option>
                        </select>
                      </div>
                      <input className="sizing-new-input w-full mb-2" placeholder="사유 *" value={shortlistForm.reason} onChange={(e) => setShortlistForm({ ...shortlistForm, reason: e.target.value })} />
                      <div className="flex justify-end gap-2">
                        <button type="button" className="btn-ghost btn-sm" onClick={() => setShowShortlistForm(false)}>취소</button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={editSaving || !shortlistForm.area.trim() || !shortlistForm.reason.trim()}
                          onClick={() => void saveShortlistItem(shortlistForm.area.trim(), shortlistForm.verdict, shortlistForm.reason)}
                        >
                          {editSaving ? "추가 중..." : "추가"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!opportunityId && (
                <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  S4로 진행하려면 이 분석에 연결된 기회(S2)가 필요합니다 — 새 분석 시 "연결 기회"를 선택하세요.
                </p>
              )}
            </div>
          )}</>
  );
}
