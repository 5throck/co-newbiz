"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { SectionToolbar } from "../../layout.tsx";
import { RowEdit } from "../../crud.tsx";
import type { OurCompanyStageState } from "./useOurGroups.ts";

export function MembersPanel({ ctx }: { ctx: OurCompanyStageState }) {
  const { selectedGroup, editGroupName, groupNameDraft, setGroupNameDraft, busy, setEditGroupName, canAct, setShowMemberForm, setShowGroupForm, showMemberForm, memberForm, setMemberForm, setDartResults, dartSearching, dartResults, openMember, editMember, setEditMember, savingMember, savingRole, profiles, uploadingMember, saveGroupName, removeGroup, addMember, searchMemberDart, saveMemberEdit, backToList, openDetail, updateMemberRole, analyzeMember, startMemberEdit, uploadMemberFile, removeMember } = ctx;
  return (
    <>{selectedGroup && (
        <section aria-label="계열사" className="market-section">
          <SectionToolbar
            title={editGroupName ? undefined : `${selectedGroup.group.name} 계열사`}
            icon={editGroupName ? undefined : "🏭"}
            count={selectedGroup.members.length}
            actions={
              editGroupName ? (
                <span className="flex items-center gap-1">
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
                  <button type="button" className="btn-ghost btn-sm" title="그룹명 수정" onClick={() => { setGroupNameDraft(selectedGroup.group.name); setEditGroupName(true); }}>수정</button>
                  <button type="button" className="btn-danger btn-sm" title="이 그룹과 소속 계열사 전체를 삭제합니다" onClick={() => removeGroup(selectedGroup.group.id, selectedGroup.group.name)}>삭제</button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => { setShowMemberForm((v) => !v); setShowGroupForm(false); }}
                    aria-expanded={showMemberForm}
                  >
                    ＋ 계열사 등록
                  </button>
                </>
              )
            }
          />
          {canAct && showMemberForm && (
            <form onSubmit={addMember} aria-label="계열사 등록" className="sizing-new-form mb-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">회사명 *</span>
                  <span className="flex items-center gap-1">
                    <input value={memberForm.company_name} onChange={(e) => { setMemberForm({ ...memberForm, company_name: e.target.value }); setDartResults([]); }} required className="sizing-new-input" autoFocus />
                    <button type="button" className="btn-ghost btn-sm" disabled={dartSearching || !memberForm.company_name.trim()} onClick={() => void searchMemberDart()}>
                      {dartSearching ? "검색 중..." : "🔍 DART 검색"}
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
                <button type="submit" className="btn-ghost btn-sm" disabled={busy || !memberForm.company_name.trim()}>등록</button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setShowMemberForm(false)}>취소</button>
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
                        {memberForm.dart_corp_code === r.corp_code ? "✔ " : ""}{r.corp_name} <code className="dd-item-id">{r.corp_code}</code>
                        {r.source === "web" && (
                          <span className={`status-chip ml-1 ${r.validated ? "status-green" : "status-amber"}`} title={r.validated ? "DART 기업개황으로 이름 일치 확인" : "웹 검색 폴백 — DART 역조회 실패(다중 소스 일치)"}>
                            웹 {r.validated ? "✔교차검증" : "미검증"}
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
            <table className="data-table list-table" aria-label="계열사 목록">
              <caption className="sr-only">계열사 목록</caption>
              <thead>
                <tr>
                  <th scope="col">회사명</th><th scope="col" className="w-[5rem]">역할</th><th scope="col" className="w-[8rem]">DART 고유번호</th>
                  <th scope="col" className="w-[11rem]">분석 상태</th><th scope="col" className="col-date">분석일</th>
                  <th scope="col" className="w-[13rem]"><span className="sr-only">작업</span></th>
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
                          <RowEdit
                            editing
                            value={editMember.name}
                            onChange={(v) => setEditMember((prev) => (prev ? { ...prev, name: v } : prev))}
                            onSave={() => saveMemberEdit()}
                            onCancel={() => setEditMember(null)}
                            saving={savingMember}
                            ariaLabel={`${m.company_name} 회사명 수정`}
                          />
                        ) : (
                          <button
                            type="button"
                            className="font-semibold text-left underline-offset-2 hover:underline"
                            title={analyzed ? "프로파일 리포트 열기" : "프로파일 분석 후 열립니다"}
                            onClick={() => { if (isOpen) backToList(); else openDetail(m.id); }}
                          >
                            {m.company_name}
                          </button>
                        )}
                      </td>
                      <td>
                        {/* 역할 인라인 변경 — 즉시 저장(PATCH members). viewer는
                            서버가 403으로 막는다. */}
                        <select
                          aria-label={`${m.company_name} 역할 변경`}
                          value={m.role}
                          disabled={savingRole === m.id || !canAct}
                          onChange={(e) => void updateMemberRole(m.id, e.target.value as "hq" | "affiliate")}
                          className="sizing-new-input sizing-new-input-sm"
                        >
                          <option value="affiliate">계열사</option>
                          <option value="hq">지주/HQ</option>
                        </select>
                      </td>
                      <td>
                        {isEditing ? (
                          <RowEdit
                            editing
                            value={editMember.dart}
                            onChange={(v) => setEditMember((prev) => (prev ? { ...prev, dart: v } : prev))}
                            onSave={() => saveMemberEdit()}
                            onCancel={() => setEditMember(null)}
                            saving={savingMember}
                            ariaLabel={`${m.company_name} DART 고유번호 수정`}
                            width="6rem"
                            placeholder="8자리 고유번호"
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
                      <td className="col-date tabular-nums">{m.analyzed_at ? m.analyzed_at.slice(0, 10) : "—"}</td>
                      <td className="sizing-actions-cell"><span className="actions-row">
                        {/* 행 액션 표준 순서: 열기 → 재분석 → 수정(저장/취소) → 삭제 */}
                        {analyzed && (
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => { if (isOpen) backToList(); else openDetail(m.id); }}
                          >
                            {isOpen ? "닫기" : "열기"}
                          </button>
                        )}
                        {canAct && (
                        <button type="button" className="btn-ghost btn-sm" disabled={profiles[m.id] === "loading"} onClick={() => analyzeMember(m.id)}>
                          {profiles[m.id] === "loading" ? "분석 중..." : analyzed ? "재분석" : "분석"}
                        </button>
                        )}
                        {!canAct ? null : isEditing ? (
                          <>
                            <button type="button" className="btn-ghost btn-sm" disabled={savingMember} onClick={() => saveMemberEdit()}>
                              {savingMember ? "저장 중..." : "저장"}
                            </button>
                            <button type="button" className="btn-ghost btn-sm" onClick={() => setEditMember(null)}>취소</button>
                          </>
                        ) : (
                          <button type="button" className="btn-ghost btn-sm" title="회사명·DART 고유번호 수정" onClick={() => startMemberEdit(m.id, m.company_name, m.dart_corp_code)}>
                            수정
                          </button>
                        )}
                        {canAct && (
                        <label className="btn-ghost btn-sm cursor-pointer" title="신용평가자료 등 근거 파일 업로드">
                          {uploadingMember === m.id ? "업로드 중..." : "근거파일"}
                          <input
                            type="file"
                            aria-label={`${m.company_name} 근거 파일 업로드`}
                            className="hidden"
                            disabled={uploadingMember === m.id}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadMemberFile(m.id, f); }}
                          />
                        </label>
                        )}
                        {canAct && (
                        <button type="button" className="btn-danger btn-sm" title="이 계열사를 삭제합니다" onClick={() => removeMember(m.id)}>
                          삭제
                        </button>
                        )}
                      </span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}</>
  );
}
