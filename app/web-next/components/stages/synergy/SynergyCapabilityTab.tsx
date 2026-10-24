"use client";

// SynergyCapabilityTab — ADR-0181 (2026-10-18, decider feedback): 필요 역량
// 수준 레지스터가 연계 시너지 탭 안에 묻혀 있던 것을 독립 탭으로 승격.
// 데이터는 이전과 동일 (연결 기회 단위 capability-gap 레지스터, GET/PUT
// /api/opportunities/{id}/capability-gap — 시너지 분석 시 파이프라인 자동
// 도출, 사람이 보유 판정·저장).
import { useState } from "react";
import { SectionToolbar } from "../../layout.tsx";
import { NarrativeInput } from "../CapabilityNarrativeDialog.tsx";
import { CapabilityHeldDialog, HeldEvidenceButton } from "../CapabilityHeldDialog.tsx";
import { KO_NARRATIVE_FIELDS } from "../../../lib/ko-data-values.ts";
import { ColGroup } from "../../ui.tsx";
import { ClampedText } from "../ClampedText.tsx";
import { SourceLinks } from "./SourceLinks.tsx";
import { gapCautions, gapSourceLabel, summarizeGap } from "../../../lib/capability-gap.ts";
import { countDraftFields, countMissingRequirement, missingRequirementCells } from "../../../lib/capability-gap-necessity-draft.ts";
import type { SynergyResultState } from "./useSynergyResult.ts";
import type { GapHeldStatus, GapNecessity } from "../../../lib/capability-gap.ts";
import { HELD_STATUS_CHIP, HELD_STATUS_LABEL, NECESSITY_LABEL, NECESSITY_UNSET_LABEL, NECESSITY_NOTE_CAP } from "../../../lib/capability-gap.ts";
import type { SynergyPayload } from "./types.ts";
import { useTranslations } from "next-intl";

function MissingMark() {const t = useTranslations("stages.s3.synergyCapabilityTab");
  return <span className="status-chip status-amber mt-1" data-testid="missing-mark"><span aria-hidden="true">!</span> {t("missing")}</span>;
}

/** AI 초안 표식 — 아이콘+글자(색만으로 구분하지 않음), 근거는 툴팁과 짧은 본문으로. */
function DraftChip({ basis, sources }: { basis?: string; sources?: Array<{ title: string; url: string }> }) {const t = useTranslations("stages.s3.synergyCapabilityTab"); const tc = useTranslations("common");
  return (
    <span className="block mt-1">
      <span className="status-chip status-in-progress" title={basis ? t("evidenceP1", { p1: basis }) : undefined}><span aria-hidden="true">✦</span> {tc("aiDraft")}</span>
      {basis && <ClampedText text={t("evidenceP12", { p1: basis })} className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" />}
      <SourceLinks sources={sources} />
    </span>
  );
}

export function SynergyCapabilityTab({ ctx, p }: { ctx: SynergyResultState; p: SynergyPayload }) {const t = useTranslations("stages.s3.synergyCapabilityTab"); const tc = useTranslations("common");
  const { tab, canCurate, opportunityId, gapRows, gapBusy, discardDrafts, dismissGapNote, draftGap, saveGap, gapNote, gapDrafts, gapDirty, holdBusy, checkHolding, includeGroup, setIncludeGroup, holdReasons, gapError, updateGapHeld, updateGapRow, setGapRows, newGapCap, setNewGapCap, addGapRow } = ctx;
  const proposePrimary = !gapDirty && gapRows.length === 0;
  const missing = countMissingRequirement(gapRows);
  const draftCount = countDraftFields(gapDrafts);
  const [heldEditing, setHeldEditing] = useState<string | null>(null);
  const GAP_COL_PCT = [23, 8, 24, 9, 23, 9, 4] as const;
  return (
    <>{tab === "capability" && (
                  <>
                  {/* 필요 역량 수준 (S3, flow.spec v2.4.0) — 연결 기회 단위 레지스터.
                  시너지 분석(신규·재분석) 시 파이프라인이 시너지 영역에서 필요
                  역량을 자동 도출해 병합하고(2026-09-15 사용자 설계), 이 탭에서
                  사람이 보유 판정한다. "필요 역량 제안 (AI)" 버튼은 이후에도
                  행이 더 필요할 때 쓴다. */}
              {opportunityId ? (
                <div className="mt-4 pt-3 border-t border-[color:var(--border)]">
                  <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("requiredCapabilityLevelsDoWe")}</h3>
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
                    {t("onlyRequiredCapabilitiesOfItems")}
                  </p>
                  <SectionToolbar
                    title={t("requiredCapabilityLevel")}
                    icon=""
                    count={gapRows.length}
                    summary={(missing.total > 0 || gapDirty || draftCount > 0) ? (
                      <span className="flex items-center gap-1">
                        {missing.total > 0 && <span className="status-chip status-amber" role="status" data-testid="missing-chip"><span aria-hidden="true">!</span> {t("missingNecessityOrRequiredLevel")} {missing.total}{tc("countUnit")}</span>}
                        {draftCount > 0 && <span className="status-chip status-in-progress" role="status" data-testid="unsaved-draft-chip"><span aria-hidden="true">✦</span> {tc("unsavedAiDraft")} {draftCount}{tc("countUnit")}</span>}
                        {gapDirty && <span className="status-chip status-amber" role="status"><span aria-hidden="true">●</span> {t("hasUnsavedChanges")}</span>}
                      </span>
                    ) : undefined}
                    actions={canCurate ? (
                      <span className="flex flex-wrap items-center gap-1">
                        <button type="button" className={proposePrimary ? "btn-primary btn-sm" : "btn-ghost btn-sm"} disabled={gapBusy || holdBusy} title={t("proposesDraftsForAdditionalRequired")} onClick={() => void draftGap()}>
                          {gapBusy ? t("generatingDraft") : <><span aria-hidden="true">🤖</span> {t("requiredCapabilityProposalAi")}</>}
                        </button>
                        <button type="button" className="btn-ghost btn-sm" disabled={gapBusy || holdBusy || gapRows.length === 0} aria-busy={holdBusy} title={t("draftsTheHeldJudgementHeld")} onClick={() => void checkHolding()}>
                          {holdBusy ? t("confirming") : <><span aria-hidden="true">🤖</span> {t("heldJudgementCheckAi")}</>}
                        </button>
                        <label className="flex items-center gap-1 text-[length:var(--fs-caption)]" title={t("profilesAndFilingsOfUp")}>
                          <input type="checkbox" checked={includeGroup} disabled={gapBusy || holdBusy} onChange={(e) => setIncludeGroup(e.target.checked)} />
                          {t("alsoReferencesOtherAffiliateProfiles")}
                        </label>
                        {/* AI 초안·저장 계열은 오른쪽에 모아 AI 제안 버튼과 시각적으로 분리한다 */}
                        <span className="flex items-center gap-1 ml-auto pl-2 border-l border-[color:var(--border)]">
                          {draftCount > 0 && <button type="button" className="btn-ghost btn-sm" disabled={gapBusy || holdBusy} onClick={discardDrafts} title={t("discardsTheUnsavedAiDraft")}>{tc("discardAiDraft")}</button>}
                          <button type="button" className={gapDirty ? "btn-primary btn-sm" : "btn-ghost btn-sm"} disabled={gapBusy || holdBusy || gapRows.length === 0 || !gapDirty} onClick={() => void saveGap()}>
                            {gapBusy ? tc("saving") : gapDirty ? t("saveChanges") : tc("save")}
                          </button>
                        </span>
                      </span>
                    ) : undefined}
                  />
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                    {t("requiredCapabilityProposalAiDrafts")}
                  </p>
                  {holdBusy && <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("checkingTheHeldJudgementVia")}</p>}
                  {gapNote && (
                    <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--green-fg)] mb-2" data-testid="gap-note">
                      {gapNote} <button type="button" className="btn-ghost btn-sm ml-1" aria-label={t("dismissGuidance")} onClick={dismissGapNote}>{tc("close")}</button>
                    </p>
                  )}
                  {gapError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2">{gapError}</p>}
                  {gapRows.length === 0 ? (
                    <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)] mb-0">
                      {t("noRequiredCapabilityRowsDerives")}
                    </p>
                  ) : (
                    <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
                      {/* 쓰기 권한이 없으면 셀렉트를 비활성화한다 — 기록값은 그대로 보이고(표시 유지,
                          편집만 차단), 보유 근거는 `보기` 버튼으로 연다. */}
                      <table className="data-table table-fixed-pct tmin-80" aria-label={t("requiredCapabilityLevelRegister")}>
                        <caption className="sr-only">{t("requiredCapabilityLevelRegisterHeld")}</caption>
                        <ColGroup widths={GAP_COL_PCT} />
                        <thead>
                          <tr>
                            <th scope="col">{tc("requiredCapability")}</th><th scope="col">{tc("necessity")}</th><th scope="col">{tc("requiredLevel")}</th><th scope="col">{tc("heldJudgement")}</th>
                            <th scope="col">{tc("heldLevel")}</th><th scope="col">{tc("heldEvidence")}</th><th scope="col"><span className="sr-only">{tc("actions")}</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {gapRows.map((r, idx) => {
                            const mark = gapDrafts[r.id];
                            const cautions = gapCautions(r).filter((c) => c.key !== "unevaluated");
                            const miss = missingRequirementCells(r);
                            return (
                            <tr key={r.id}>
                              <td className="cell-primary align-top">
                                <span className="font-semibold text-[length:var(--fs-caption)]">{r.capability}</span>
                                <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                  {gapSourceLabel(r.source, true)}
                                </span>
                                {r.requiredNote && <ClampedText text={r.requiredNote} className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" />}
                                {(cautions.length > 0 || r.held.reassessHint) && (
                                  <span className="flex flex-wrap gap-1 mt-1">
                                    {r.held.reassessHint && <span className="status-chip status-amber"><span aria-hidden="true">!</span> {t("recommended")}</span>}
                                    {cautions.map((c) => (
                                      <span key={c.key} className={`status-chip ${c.tone === "red" ? "status-red" : c.tone === "amber" ? "status-amber" : "status-not-started"}`}>
                                        <span aria-hidden="true">{c.tone === "red" ? "▲" : c.tone === "amber" ? "!" : "·"}</span> {c.label}
                                      </span>
                                    ))}
                                  </span>
                                )}
                              </td>
                              <td className="align-top">
                                <select aria-label={t("p1Necessity", { p1: r.capability })} value={r.necessity} disabled={!canCurate}
                                  onChange={(e) => updateGapRow(idx, { necessity: e.target.value as GapNecessity, ...(e.target.value === "partial_essential" ? {} : { necessityScopeNote: "" }) })}
                                  className="sizing-new-input sizing-new-input-sm w-auto max-w-full">
                                  <option value="">{NECESSITY_UNSET_LABEL}</option>
                                  {(Object.keys(NECESSITY_LABEL) as Array<Exclude<GapNecessity, "">>).map((k) => (
                                    <option key={k} value={k}>{NECESSITY_LABEL[k]}</option>
                                  ))}
                                </select>
                                {r.necessity === "partial_essential" && (
                                  <input aria-label={t("p1RequiredScope", { p1: r.capability })} placeholder={t("requiredScopeOptional")} maxLength={NECESSITY_NOTE_CAP} value={r.necessityScopeNote} disabled={!canCurate}
                                    onChange={(e) => updateGapRow(idx, { necessityScopeNote: e.target.value })}
                                    className="sizing-new-input sizing-new-input-sm mt-1 w-full" />
                                )}
                                {miss.necessity && <MissingMark />}
                              </td>
                              <td className="align-top text-[length:var(--fs-caption)]">
                                <NarrativeInput capability={r.capability} field={KO_NARRATIVE_FIELDS.requiredLevel} value={r.requiredLevel} readOnly={!canCurate} onChange={(v) => updateGapRow(idx, { requiredLevel: v })} />
                                {miss.requiredLevel && <MissingMark />}
                                {mark?.fields.includes("requiredLevel") && <DraftChip basis={mark.basis.requiredLevel} />}
                              </td>
                              <td className="align-top">
                                <select aria-label={t("p1HeldJudgement", { p1: r.capability })} aria-describedby={r.held.status === "unevaluated" && holdReasons[r.id] ? `hold-reason-${r.id}` : undefined} title={r.held.status === "unevaluated" && holdReasons[r.id] ? t("reasonNotJudgedP1", { p1: holdReasons[r.id] }) : undefined} value={r.held.status} disabled={!canCurate}
                                  onChange={(e) => updateGapHeld(idx, { status: e.target.value as GapHeldStatus, legacyStatus: undefined, reassessHint: undefined })}
                                  className={`sizing-new-input sizing-new-input-sm w-auto max-w-full ${HELD_STATUS_CHIP[r.held.status]}`}>
                                  {(Object.keys(HELD_STATUS_LABEL) as GapHeldStatus[]).map((s) => (
                                    <option key={s} value={s}>{HELD_STATUS_LABEL[s]}</option>
                                  ))}
                                </select>
                                {mark?.fields.includes("heldStatus") && <DraftChip basis={mark.basis.held} sources={mark.sources} />}
                                {r.held.status === "unevaluated" && holdReasons[r.id] && (
                                  <span id={`hold-reason-${r.id}`} className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" title={t("reasonNotJudgedP12", { p1: holdReasons[r.id] })}>
                                    <span aria-hidden="true">· </span>{t("reasonNotJudged")} {holdReasons[r.id]}
                                  </span>
                                )}
                              </td>
                              <td className="align-top text-[length:var(--fs-caption)]">
                                <NarrativeInput capability={r.capability} field={KO_NARRATIVE_FIELDS.heldLevel} value={r.currentLevel} readOnly={!canCurate} onChange={(v) => updateGapRow(idx, { currentLevel: v })} />
                                {mark?.fields.includes("currentLevel") && <DraftChip basis={mark.basis.currentLevel} sources={mark.sources} />}
                              </td>
                              <td className="align-top text-[length:var(--fs-caption)]">
                                <HeldEvidenceButton capability={r.capability} evidence={r.held.evidence} legacyHolders={r.held.holders} readOnly={!canCurate} onOpen={() => setHeldEditing(r.id)} />
                              </td>
                              <td>
                                <button type="button" className="btn-ghost btn-sm" aria-label={t("deleteP1Row", { p1: r.capability })} title={t("deleteRow")} disabled={!canCurate}
                                  onClick={() => setGapRows((prev) => prev.filter((_, i) => i !== idx))}><span aria-hidden="true">✕</span></button>
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {heldEditing && (() => {
                        const row = gapRows.find((x) => x.id === heldEditing);
                        if (!row) return null;
                        return <CapabilityHeldDialog capability={row.capability} evidence={row.held.evidence} legacyHolders={row.held.holders} readOnly={!canCurate}
                          onSave={(v) => { updateGapHeld(gapRows.findIndex((x) => x.id === row.id), { evidence: v.evidence }); setHeldEditing(null); }}
                          onClose={() => setHeldEditing(null)} />;
                      })()}
                    </div>
                  )}
                  {(() => {
                    const s = summarizeGap(gapRows);
                    if (s.total === 0) return null;
                    return (
                      <p className="text-[length:var(--fs-caption)] mt-2 mb-0">
                        {t("summaryRequiredCapabilities")} {s.total}{t("itemSIndustryLeading")} {s.leading}{t("average")} {s.average}{t("held")} {s.partial}{t("notHeld")} {s.none}{t("judged")} {s.unevaluated}
                        {s.coveragePct !== null ? t("holdingRateP1", { p1: s.coveragePct }) : ""}
                        {s.essentialCoveragePct !== null ? t("requiredP1", { p1: s.essentialCoveragePct }) : ""}
                      </p>
                    );
                  })()}
                  {canCurate && (
                  <div className="flex flex-wrap items-center gap-1 mt-2">
                    <input aria-label={t("addRequiredCapability")} placeholder={t("addRequiredCapability2")} value={newGapCap}
                      onChange={(e) => setNewGapCap(e.target.value)}
                      className="sizing-new-input sizing-new-input-sm" style={{ flex: "1 1 14rem" }} />
                    <button type="button" className="btn-ghost btn-sm" onClick={addGapRow}>{t("addCapabilityRow")}</button>
                  </div>
                  )}
                </div>
              ) : (
                <div className="mt-4 pt-3 border-t border-[color:var(--border)]">
                  <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("requiredCapabilityLevel2")}</h3>
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">
                    {t("noOpportunityLinkedToThis")}
                  </p>
                </div>
              )}
                  </>
    )}</>
  );
}
