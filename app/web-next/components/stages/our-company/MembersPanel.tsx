"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useRef } from "react";
import { SectionToolbar } from "../../layout.tsx";
import { RowMenu, type RowMenuItem } from "../../crud.tsx";
import type { OurCompanyStageState } from "./useOurGroups.ts";
import { ColGroup } from "../../ui.tsx";
import { OUR_COMPANY_COPY as COPY, MEMBER_COL_PCT } from "./constants.ts";
import { groupAnalysisMeta, isStaleAnalysis } from "./member-stats.ts";
import { ClockIcon } from "./icons.tsx";

function StaleCue() {
  return (
    <span className="stale-cue" title={COPY.staleHint}>
      <ClockIcon />
      <span>{COPY.stale}</span>
    </span>
  );
}

export function MembersPanel({ ctx }: { ctx: OurCompanyStageState }) {
  const { selectedGroup, editGroupName, groupNameDraft, setGroupNameDraft, busy, setEditGroupName, canAct, setShowMemberForm, setShowGroupForm, showMemberForm, memberForm, setMemberForm, setDartResults, dartSearching, dartResults, openMember, editMember, setEditMember, savingMember, savingRole, profiles, loadingGroupId, uploadingMember, saveGroupName, removeGroup, addMember, searchMemberDart, saveMemberEdit, backToList, openDetail, updateMemberRole, analyzeMember, startMemberEdit, uploadMemberFile, removeMember } = ctx;
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const now = new Date();
  const groupLoading = loadingGroupId !== null && loadingGroupId !== selectedGroup?.group.id;
  const meta = selectedGroup ? groupAnalysisMeta(selectedGroup.members, now) : null;
  return (
    <>{groupLoading && (
        <section aria-label="계열사" className="market-section" aria-busy="true"><p>{COPY.groupLoading}</p></section>
      )}{!groupLoading && selectedGroup && meta && (
        <section aria-label="계열사" className="market-section">
          <SectionToolbar
            title={editGroupName ? undefined : `${selectedGroup.group.name} 계열사`}
            count={selectedGroup.members.length}
            actions={
              editGroupName ? (
                <span className="flex items-center gap-2">
                  <input
                    aria-label="그룹명 수정"
                    value={groupNameDraft}
                    onChange={(e) => setGroupNameDraft(e.target.value)}
                    className="sizing-new-input sizing-new-input-sm"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") void saveGroupName(); }}
                  />
                  <button type="button" className="btn-ghost btn-sm" disabled={busy || !groupNameDraft.trim()} onClick={() => saveGroupName()}>저장</button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setEditGroupName(false)}>취소</button>
                </span>
              ) : !canAct ? undefined : (
                <>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => { setShowMemberForm((v) => !v); setShowGroupForm(false); }}
                    aria-expanded={showMemberForm}
                  >
                    ＋ 계열사 등록
                  </button>
                  <RowMenu
                    label={COPY.groupMore}
                    triggerClassName="btn-ghost"
                    items={[
                      { key: "edit", label: COPY.groupEdit, onSelect: () => { setGroupNameDraft(selectedGroup.group.name); setEditGroupName(true); } },
                      { key: "delete", label: COPY.groupDelete, danger: true, separatorBefore: true, onSelect: () => removeGroup(selectedGroup.group.id, selectedGroup.group.name) },
                    ]}
                  />
                </>
              )
            }
          />
          <p className="group-meta">
            {meta.analyzed === 0
              ? COPY.notAnalyzedYet
              : `계열사 ${meta.total}개 중 ${meta.analyzed}개 분석 · 최근 분석 ${meta.lastDate}`}
            {meta.stale && <StaleCue />}
          </p>
          {canAct && showMemberForm && (
            <form onSubmit={addMember} aria-label="계열사 등록" className="sizing-new-form mb-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">회사명 *</span>
                  <span className="flex items-center gap-2">
                    <input value={memberForm.company_name} onChange={(e) => { setMemberForm({ ...memberForm, company_name: e.target.value }); setDartResults([]); }} required className="sizing-new-input" autoFocus />
                    <button type="button" className="btn-ghost btn-sm" disabled={dartSearching || !memberForm.company_name.trim()} onClick={() => void searchMemberDart()}>
                      {dartSearching ? "검색 중..." : (<><span aria-hidden="true">🔍</span> DART 검색</>)}
                    </button>
                  </span>
                </label>
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">DART 고유번호</span>
                  <input value={memberForm.dart_corp_code} onChange={(e) => setMemberForm({ ...memberForm, dart_corp_code: e.target.value })} placeholder="자동 검색 또는 8자리 직접 입력" className="sizing-new-input sizing-new-input-sm" />
                </label>
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">역할</span>
                  <select value={memberForm.role} onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value as "hq" | "affiliate" })} className="sizing-new-input sizing-new-input-sm">
                    <option value="affiliate">계열사</option>
                    <option value="hq">지주/HQ</option>
                  </select>
                </label>
                <span className="flex items-center gap-2">
                  <button type="submit" className="btn-ghost btn-sm" disabled={busy || !memberForm.company_name.trim()}>등록</button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setShowMemberForm(false)}>취소</button>
                </span>
              </div>
              {dartResults.length > 0 && (
                <ul className="sizing-note-list mt-2" role="listbox" aria-label="DART 검색 결과">
                  {dartResults.map((r) => (
                    <li key={r.corp_code}>
                      <button
                        type="button"
                        aria-pressed={memberForm.dart_corp_code === r.corp_code}
                        className={`btn-ghost btn-sm w-full text-left ${memberForm.dart_corp_code === r.corp_code ? "font-semibold" : ""}`}
                        onClick={() => setMemberForm((prev) => ({ ...prev, dart_corp_code: r.corp_code, company_name: r.corp_name }))}
                      >
                        {memberForm.dart_corp_code === r.corp_code ? "✓ " : ""}{r.corp_name} <code className="dd-item-id">{r.corp_code}</code>
                        {r.source === "web" && (
                          <span className={`status-chip ml-1 ${r.validated ? "status-green" : "status-amber"}`} title={r.validated ? "DART 기업개황으로 이름 일치 확인" : "웹 검색 폴백 — DART 역조회 실패(다중 소스 일치)"}>
                            웹 {r.validated ? "✓교차검증" : "미검증"}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                DART 고유번호는 시너지 정합성 화면의 DART 검색으로 확인하거나 비워둘 수 있습니다(비상장 — 리서치 기반 분석).
              </p>
            </form>
          )}
          {selectedGroup.members.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">계열사가 없습니다. "＋ 계열사 등록"으로 추가하세요.</p>
          ) : (
            <div className="table-scroll" tabIndex={0} role="region" aria-label="계열사 목록 영역">
            <table className="data-table list-table members-list-table table-fixed-pct tmin-56" aria-label="계열사 목록">
              <caption className="sr-only">계열사 목록</caption>
              <ColGroup widths={MEMBER_COL_PCT} />
              <thead>
                <tr>
                  <th scope="col">회사명</th><th scope="col">역할</th><th scope="col">DART 고유번호</th>
                  <th scope="col">분석 상태</th><th scope="col">분석일</th>
                  <th scope="col"><span className="sr-only">작업</span></th>
                </tr>
              </thead>
              <tbody>
                {selectedGroup.members.map((m) => {
                  const analyzed = m.latest_version !== null;
                  const isOpen = openMember === m.id;
                  const isEditing = editMember?.id === m.id;
                  return (
                    <tr key={m.id} className={isOpen ? "row-selected" : undefined}>
                      <td className="cell-primary">
                        {isEditing ? (
                          <input
                            value={editMember.name}
                            onChange={(e) => setEditMember((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                            onKeyDown={(e) => { if (e.key === "Enter") void saveMemberEdit(); if (e.key === "Escape") setEditMember(null); }}
                            aria-label={`${m.company_name} 회사명 수정`}
                            className="sizing-new-input sizing-new-input-sm member-edit-input"
                            autoFocus
                          />
                        ) : (
                          <button
                            type="button"
                            className="member-name-btn"
                            title={m.company_name}
                            onClick={() => { if (isOpen) backToList(); else openDetail(m.id); }}
                          >
                            {m.company_name}
                          </button>
                        )}
                      </td>
                      <td>
                        {/* 역할 인라인 변경 — 즉시 저장(PATCH members). viewer는
                            서버가 403으로 막는다. */}
                        {!canAct ? (
                          <span className="status-chip status-not-started">{m.role === "hq" ? "지주/HQ" : "계열사"}</span>
                        ) : (
                          <select
                            aria-label={`${m.company_name} 역할 변경`}
                            value={m.role}
                            disabled={savingRole === m.id || !canAct}
                            onChange={(e) => void updateMemberRole(m.id, e.target.value as "hq" | "affiliate")}
                            className="sizing-new-input sizing-new-input-sm member-role-select"
                          >
                            <option value="affiliate">계열사</option>
                            <option value="hq">지주/HQ</option>
                          </select>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            value={editMember.dart}
                            onChange={(e) => setEditMember((prev) => (prev ? { ...prev, dart: e.target.value } : prev))}
                            onKeyDown={(e) => { if (e.key === "Enter") void saveMemberEdit(); if (e.key === "Escape") setEditMember(null); }}
                            aria-label={`${m.company_name} DART 고유번호 수정`}
                            placeholder="8자리 고유번호"
                            className="sizing-new-input sizing-new-input-sm member-edit-input"
                          />
                        ) : m.dart_corp_code ? (
                          <code className="dd-item-id">{m.dart_corp_code}</code>
                        ) : (
                          <span className="status-chip status-amber" title="DART 고유번호 미확인 — 행 액션의 수정으로 입력하세요">고유번호 미확인</span>
                        )}
                      </td>
                      <td>
                        {analyzed ? (
                          <span className="status-chip status-green">분석 완료 (v{m.latest_version})</span>
                        ) : (
                          <span className="status-chip status-not-started">분석 대기</span>
                        )}
                      </td>
                      <td className="member-date-cell tabular-nums">
                        {m.analyzed_at ? m.analyzed_at.slice(0, 10) : "—"}
                        {isStaleAnalysis(m.analyzed_at, now) && <StaleCue />}
                      </td>
                      <td className="sizing-actions-cell"><span className="actions-row">
                        {/* One main action per row; everything else lives in the overflow menu. */}
                        {isEditing ? (
                          <>
                            <button type="button" className="btn-ghost btn-sm" disabled={savingMember} onClick={() => saveMemberEdit()}>
                              {savingMember ? "저장 중..." : "저장"}
                            </button>
                            <button type="button" className="btn-ghost btn-sm" onClick={() => setEditMember(null)}>취소</button>
                          </>
                        ) : (
                          <>
                            {analyzed ? (
                              <button type="button" className="btn-ghost btn-sm" onClick={() => { if (isOpen) backToList(); else openDetail(m.id); }}>
                                {isOpen ? "닫기" : "열기"}
                              </button>
                            ) : canAct ? (
                              <button type="button" className="btn-ghost btn-sm" disabled={profiles[m.id] === "loading"} onClick={() => analyzeMember(m.id)}>
                                {profiles[m.id] === "loading" ? "분석 중..." : "분석"}
                              </button>
                            ) : null}
                            {canAct && (
                              <RowMenu
                                label={`${m.company_name} ${COPY.rowMore}`}
                                items={[
                                  ...(analyzed ? [{ key: "reanalyze", label: profiles[m.id] === "loading" ? "분석 중..." : "재분석", disabled: profiles[m.id] === "loading", onSelect: () => analyzeMember(m.id) }] : []),
                                  { key: "edit", label: "수정", onSelect: () => startMemberEdit(m.id, m.company_name, m.dart_corp_code) },
                                  { key: "file", label: uploadingMember === m.id ? "업로드 중..." : "근거파일", disabled: uploadingMember === m.id, onSelect: () => fileInputs.current[m.id]?.click() },
                                  { key: "delete", label: "삭제", danger: true, separatorBefore: true, onSelect: () => removeMember(m.id) },
                                ] satisfies RowMenuItem[]}
                              />
                            )}
                          </>
                        )}
                        {canAct && (
                          <input
                            ref={(el) => { fileInputs.current[m.id] = el; }}
                            type="file"
                            aria-label={`${m.company_name} 근거 파일 업로드`}
                            className="hidden"
                            disabled={uploadingMember === m.id}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadMemberFile(m.id, f); e.target.value = ""; }}
                          />
                        )}
                      </span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </section>
      )}</>
  );
}
