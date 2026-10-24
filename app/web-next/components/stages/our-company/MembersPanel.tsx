"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useRef } from "react";
import { SectionToolbar } from "../../layout.tsx";
import { RowMenu, type RowMenuItem } from "../../crud.tsx";
import type { OurCompanyStageState } from "./useOurGroups.ts";
import { ColGroup } from "../../ui.tsx";
import { OUR_COMPANY_COPY as COPY, MEMBER_COL_PCT, PROFILE_STALE_DAYS } from "./constants.ts";
import { groupAnalysisMeta, isStaleAnalysis } from "./member-stats.ts";
import { ClockIcon } from "./icons.tsx";
import { useTranslations } from "next-intl";

function StaleCue() {
  const tr = useTranslations();
  return (
    <span className="stale-cue" title={tr(COPY.staleHint, { p1: PROFILE_STALE_DAYS })}>
      <ClockIcon />
      <span>{tr(COPY.stale)}</span>
    </span>
  );
}

export function MembersPanel({ ctx }: { ctx: OurCompanyStageState }) {const tr = useTranslations(); const t = useTranslations("components.ourCompany.membersPanel"); const tc = useTranslations("common");
  const { selectedGroup, editGroupName, groupNameDraft, setGroupNameDraft, busy, setEditGroupName, canAct, setShowMemberForm, setShowGroupForm, showMemberForm, memberForm, setMemberForm, setDartResults, dartSearching, dartResults, openMember, editMember, setEditMember, savingMember, savingRole, profiles, loadingGroupId, uploadingMember, saveGroupName, removeGroup, addMember, searchMemberDart, saveMemberEdit, backToList, openDetail, updateMemberRole, analyzeMember, startMemberEdit, uploadMemberFile, removeMember } = ctx;
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const now = new Date();
  const groupLoading = loadingGroupId !== null && loadingGroupId !== selectedGroup?.group.id;
  const meta = selectedGroup ? groupAnalysisMeta(selectedGroup.members, now) : null;
  return (
    <>{groupLoading && (
        <section aria-label={tc("affiliate")} className="market-section" aria-busy="true"><p>{tr(COPY.groupLoading)}</p></section>
      )}{!groupLoading && selectedGroup && meta && (
        <section aria-label={tc("affiliate")} className="market-section">
          <SectionToolbar
            title={editGroupName ? undefined : t("p1Affiliates", { p1: selectedGroup.group.name })}
            count={selectedGroup.members.length}
            actions={
              editGroupName ? (
                <span className="flex items-center gap-2">
                  <input
                    aria-label={t("editGroupName")}
                    value={groupNameDraft}
                    onChange={(e) => setGroupNameDraft(e.target.value)}
                    className="sizing-new-input sizing-new-input-sm"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") void saveGroupName(); }}
                  />
                  <button type="button" className="btn-ghost btn-sm" disabled={busy || !groupNameDraft.trim()} onClick={() => saveGroupName()}>{tc("save")}</button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setEditGroupName(false)}>{tc("cancel")}</button>
                </span>
              ) : !canAct ? undefined : (
                <>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => { setShowMemberForm((v) => !v); setShowGroupForm(false); }}
                    aria-expanded={showMemberForm}
                  >
                    {t("registerAffiliate")}
                  </button>
                  <RowMenu
                    label={tr(COPY.groupMore)}
                    triggerClassName="btn-ghost"
                    items={[
                      { key: "edit", label: tr(COPY.groupEdit), onSelect: () => { setGroupNameDraft(selectedGroup.group.name); setEditGroupName(true); } },
                      { key: "delete", label: tr(COPY.groupDelete), danger: true, separatorBefore: true, onSelect: () => removeGroup(selectedGroup.group.id, selectedGroup.group.name) },
                    ]}
                  />
                </>
              )
            }
          />
          <p className="group-meta">
            {meta.analyzed === 0
              ? tr(COPY.notAnalyzedYet)
              : t("p2OfP1AffiliatesAnalyzed", { p1: meta.total, p2: meta.analyzed, p3: meta.lastDate ?? "—" })}
            {meta.stale && <StaleCue />}
          </p>
          {canAct && showMemberForm && (
            <form onSubmit={addMember} aria-label={t("registerAffiliate2")} className="sizing-new-form mb-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">{t("companyName")}</span>
                  <span className="flex items-center gap-2">
                    <input value={memberForm.company_name} onChange={(e) => { setMemberForm({ ...memberForm, company_name: e.target.value }); setDartResults([]); }} required className="sizing-new-input" autoFocus />
                    <button type="button" className="btn-ghost btn-sm" disabled={dartSearching || !memberForm.company_name.trim()} onClick={() => void searchMemberDart()}>
                      {dartSearching ? tc("searching") : (<><span aria-hidden="true">🔍</span> {t("dartSearch")}</>)}
                    </button>
                  </span>
                </label>
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">{tc("dartId")}</span>
                  <input value={memberForm.dart_corp_code} onChange={(e) => setMemberForm({ ...memberForm, dart_corp_code: e.target.value })} placeholder={t("autoSearchOrDirectEntry")} className="sizing-new-input sizing-new-input-sm" />
                </label>
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">{t("role")}</span>
                  <select value={memberForm.role} onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value as "hq" | "affiliate" })} className="sizing-new-input sizing-new-input-sm">
                    <option value="affiliate">{tc("affiliate")}</option>
                    <option value="hq">{tc("holdingHQ")}</option>
                  </select>
                </label>
                <span className="flex items-center gap-2">
                  <button type="submit" className="btn-ghost btn-sm" disabled={busy || !memberForm.company_name.trim()}>{tc("register")}</button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setShowMemberForm(false)}>{tc("cancel")}</button>
                </span>
              </div>
              {dartResults.length > 0 && (
                <ul className="sizing-note-list mt-2" role="listbox" aria-label={t("dartSearchResults")}>
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
                          <span className={`status-chip ml-1 ${r.validated ? "status-green" : "status-amber"}`} title={r.validated ? t("checkNameMatchViaDart") : t("webSearchFallbackDartReverse")}>
                            {t("web")} {r.validated ? t("item") : t("unverified")}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                {t("theDartIdCanBe")}
              </p>
            </form>
          )}
          {selectedGroup.members.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">{t("noAffiliatesAddOneWith")}</p>
          ) : (
            <div className="table-scroll" tabIndex={0} role="region" aria-label={t("affiliateListArea")}>
            <table className="data-table list-table members-list-table table-fixed-pct tmin-56" aria-label={t("affiliateList")}>
              <caption className="sr-only">{t("affiliateList2")}</caption>
              <ColGroup widths={MEMBER_COL_PCT} />
              <thead>
                <tr>
                  <th scope="col">{t("companyName2")}</th><th scope="col">{t("role2")}</th><th scope="col">{tc("dartId")}</th>
                  <th scope="col">{tc("analysisStatus")}</th><th scope="col">{tc("analysisDate")}</th>
                  <th scope="col"><span className="sr-only">{tc("actions")}</span></th>
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
                            aria-label={t("editP1CompanyName", { p1: m.company_name })}
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
                          <span className="status-chip status-not-started">{m.role === "hq" ? tc("holdingHQ") : tc("affiliate")}</span>
                        ) : (
                          <select
                            aria-label={t("changeP1Role", { p1: m.company_name })}
                            value={m.role}
                            disabled={savingRole === m.id || !canAct}
                            onChange={(e) => void updateMemberRole(m.id, e.target.value as "hq" | "affiliate")}
                            className="sizing-new-input sizing-new-input-sm member-role-select"
                          >
                            <option value="affiliate">{tc("affiliate")}</option>
                            <option value="hq">{tc("holdingHQ")}</option>
                          </select>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            value={editMember.dart}
                            onChange={(e) => setEditMember((prev) => (prev ? { ...prev, dart: e.target.value } : prev))}
                            onKeyDown={(e) => { if (e.key === "Enter") void saveMemberEdit(); if (e.key === "Escape") setEditMember(null); }}
                            aria-label={t("editP1DartId", { p1: m.company_name })}
                            placeholder={t("id")}
                            className="sizing-new-input sizing-new-input-sm member-edit-input"
                          />
                        ) : m.dart_corp_code ? (
                          <code className="dd-item-id">{m.dart_corp_code}</code>
                        ) : (
                          <span className="status-chip status-amber" title={t("dartIdUnverifiedEnterIt")}>{t("idUnverified")}</span>
                        )}
                      </td>
                      <td>
                        {analyzed ? (
                          <span className="status-chip status-green">{tc("analysisCompleteV")}{m.latest_version})</span>
                        ) : (
                          <span className="status-chip status-not-started">{t("analysisPending")}</span>
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
                              {savingMember ? tc("saving") : tc("save")}
                            </button>
                            <button type="button" className="btn-ghost btn-sm" onClick={() => setEditMember(null)}>{tc("cancel")}</button>
                          </>
                        ) : (
                          <>
                            {analyzed ? (
                              <button type="button" className="btn-ghost btn-sm" onClick={() => { if (isOpen) backToList(); else openDetail(m.id); }}>
                                {isOpen ? tc("close") : t("open")}
                              </button>
                            ) : canAct ? (
                              <button type="button" className="btn-ghost btn-sm" disabled={profiles[m.id] === "loading"} onClick={() => analyzeMember(m.id)}>
                                {profiles[m.id] === "loading" ? tc("analyzing") : t("analysis")}
                              </button>
                            ) : null}
                            {canAct && (
                              <RowMenu
                                label={`${m.company_name} ${tr(COPY.rowMore)}`}
                                items={[
                                  ...(analyzed ? [{ key: "reanalyze", label: profiles[m.id] === "loading" ? tc("analyzing") : tc("reanalyze"), disabled: profiles[m.id] === "loading", onSelect: () => analyzeMember(m.id) }] : []),
                                  { key: "edit", label: tc("edit"), onSelect: () => startMemberEdit(m.id, m.company_name, m.dart_corp_code) },
                                  { key: "file", label: uploadingMember === m.id ? t("uploading") : t("evidenceFiles"), disabled: uploadingMember === m.id, onSelect: () => fileInputs.current[m.id]?.click() },
                                  { key: "delete", label: tc("delete"), danger: true, separatorBefore: true, onSelect: () => removeMember(m.id) },
                                ] satisfies RowMenuItem[]}
                              />
                            )}
                          </>
                        )}
                        {canAct && (
                          <input
                            ref={(el) => { fileInputs.current[m.id] = el; }}
                            type="file"
                            aria-label={t("uploadP1EvidenceFiles", { p1: m.company_name })}
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
