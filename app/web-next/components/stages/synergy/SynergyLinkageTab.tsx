"use client";

// Split from components/stages/SynergyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useState } from "react";
import { SectionToolbar } from "../../layout.tsx";
import { type GapHeldStatus, type GapNecessity, HELD_STATUS_CHIP, HELD_STATUS_LABEL, NECESSITY_LABEL, NECESSITY_UNSET_LABEL, NECESSITY_NOTE_CAP, gapCautions, summarizeGap, gapSourceLabel } from "../../../lib/capability-gap.ts";
import { countDraftFields, countMissingRequirement, missingRequirementCells } from "../../../lib/capability-gap-necessity-draft.ts";
import type { SynergyResultState } from "./useSynergyResult.ts";
import type { SynergyPayload } from "./types.ts";
import { ColGroup } from "../../ui.tsx";
import { ClampedText } from "../ClampedText.tsx";
import { CapabilityHeldDialog, HeldEvidenceButton } from "../CapabilityHeldDialog.tsx";
import { NarrativeInput } from "../CapabilityNarrativeDialog.tsx";
import { SourceLinks } from "./SourceLinks.tsx";

// 시너지 영역 6열 — 근거·기회·위험이 긴 문단 열.
// 필요 역량 수준 8열 — 필요 역량·서술 열이 넓고 선택 열은 좁게.
const GAP_COL_PCT = [20, 11, 21, 11, 21, 12, 4] as const;

/** 누락 표식 — 아이콘+글자. 제안 후에도 값이 없는 칸에 남아 사람이 입력할 곳을 보여 준다. */
function MissingMark() {
  return <span className="status-chip status-amber mt-1" data-testid="missing-mark"><span aria-hidden="true">!</span> 누락</span>;
}

/** AI 초안 표식 — 아이콘+글자(색만으로 구분하지 않음), 근거는 툴팁과 짧은 본문으로. */
function DraftChip({ basis, sources }: { basis?: string; sources?: Array<{ title: string; url: string }> }) {
  return (
    <span className="block mt-1">
      <span className="status-chip status-in-progress" title={basis ? `근거: ${basis}` : undefined}><span aria-hidden="true">✦</span> AI 초안</span>
      {basis && <ClampedText text={`근거: ${basis}`} className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" />}
      <SourceLinks sources={sources} />
    </span>
  );
}

const SYNERGY_AREA_COL_PCT = [14, 10, 30, 20, 16, 10] as const;

export function SynergyLinkageTab({ ctx, p }: { ctx: SynergyResultState; p: SynergyPayload }) {
  const { tab, canCurate, showLinkageForm, setShowLinkageForm, linkageForm, setLinkageForm, linkageError, setLinkageError, linkageSaving, addLinkageItem, opportunityId, gapRows, gapBusy, discardDrafts, dismissGapNote, draftGap, saveGap, gapNote, gapDrafts, gapDirty, holdBusy, checkHolding, includeGroup, setIncludeGroup, holdReasons, gapError, updateGapHeld, updateGapRow, setGapRows, newGapCap, setNewGapCap, addGapRow } = ctx;
  const proposePrimary = !gapDirty && gapRows.length === 0;
  const missing = countMissingRequirement(gapRows);
  const draftCount = countDraftFields(gapDrafts);
  const [heldEditing, setHeldEditing] = useState<string | null>(null);
  return (
    <>{tab === "linkage" && (
            <div className="text-[0.88rem]">
              <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge">3</span> S1·S2 연계 시너지 영역 (후보 탐색 → 본검증)</h3>
              <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                연계 시장: {p.marketLinkage.marketSummaries.map((m) => `${m.industry} (CAGR ${m.cagrPct ?? "?"}%${m.gapPct !== null ? `, 격차 ${m.gapPct > 0 ? "+" : ""}${m.gapPct}%` : ""})`).join(" · ") || "없음"}
              </p>
              <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-64" aria-label="시너지 영역">
                <caption className="sr-only">시너지 영역</caption>
                <ColGroup widths={SYNERGY_AREA_COL_PCT} />
                <thead>
                  <tr><th scope="col" className="col-label">영역</th><th scope="col" className="col-type">유형</th><th scope="col" className="col-text">근거</th><th scope="col" className="col-text">기회</th><th scope="col" className="col-text">위험</th><th scope="col" className="col-type">출처</th></tr>
                </thead>
                <tbody>
                  {p.marketLinkage.synergyAreas.map((a) => (
                    <tr key={a.area}>
                      <td className="font-semibold col-label">{a.area}</td>
                      <td className="text-[length:var(--fs-caption)] col-type">{a.synergyType}</td>
                      <td className="text-[length:var(--fs-body)] col-text">{a.rationale}{a.sources.length > 0 && <span className="text-[color:var(--muted-fg)]"> (출처: {a.sources.join(", ")})</span>}</td>
                      <td className="text-[length:var(--fs-body)] col-text">{a.opportunity}</td>
                      <td className="text-[length:var(--fs-body)] col-text">{a.risk}</td>
                      <td className="col-type">
                        <span className={`status-chip ${a.origin === "human" ? "status-in-progress" : "status-not-started"}`}>
                          {a.origin === "human" ? "사람 추가" : "AI 추천"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              {canCurate && (
                <div className="mt-3">
                  {!showLinkageForm ? (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setShowLinkageForm(true)}>＋ 새 영역 추가</button>
                  ) : (
                    <div className="sizing-grade-card">
                      <div className="flex flex-wrap gap-2 mb-2">
                        <input className="sizing-new-input" style={{ flex: "1 1 12rem" }} placeholder="영역명 *" value={linkageForm.area} onChange={(e) => setLinkageForm({ ...linkageForm, area: e.target.value })} />
                        <input className="sizing-new-input" style={{ flex: "1 1 10rem" }} placeholder="유형 * (예: 매출 시너지)" value={linkageForm.synergyType} onChange={(e) => setLinkageForm({ ...linkageForm, synergyType: e.target.value })} />
                      </div>
                      <textarea className="sizing-new-input w-full mb-2" rows={2} placeholder="근거 *" value={linkageForm.rationale} onChange={(e) => setLinkageForm({ ...linkageForm, rationale: e.target.value })} />
                      <div className="flex flex-wrap gap-2 mb-2">
                        <input className="sizing-new-input" style={{ flex: "1 1 12rem" }} placeholder="기회 (선택)" value={linkageForm.opportunity} onChange={(e) => setLinkageForm({ ...linkageForm, opportunity: e.target.value })} />
                        <input className="sizing-new-input" style={{ flex: "1 1 12rem" }} placeholder="위험 (선택)" value={linkageForm.risk} onChange={(e) => setLinkageForm({ ...linkageForm, risk: e.target.value })} />
                      </div>
                      {linkageError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2">{linkageError}</p>}
                      <div className="flex justify-end gap-2">
                        <button type="button" className="btn-ghost btn-sm" onClick={() => { setShowLinkageForm(false); setLinkageError(null); }}>취소</button>
                        <button type="button" className="btn-ghost btn-sm" disabled={linkageSaving || !linkageForm.area.trim() || !linkageForm.synergyType.trim() || !linkageForm.rationale.trim()} onClick={() => void addLinkageItem()}>
                          {linkageSaving ? "추가 중..." : "추가"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 필요 역량 수준 (S3, flow.spec v2.4.0) — 연결 기회 단위 레지스터.
                  시너지 분석(신규·재분석) 시 파이프라인이 시너지 영역에서 필요
                  역량을 자동 도출해 병합하고(2026-09-15 사용자 설계), 이 탭에서
                  사람이 보유 판정한다. "필요 역량 제안 (AI)" 버튼은 이후에도
                  행이 더 필요할 때 쓴다. */}
              {opportunityId ? (
                <div className="mt-4 pt-3 border-t border-[color:var(--border)]">
                  <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge">2.5</span> 필요 역량 수준 — 시너지 영역을 채울 자사 역량은 있는가</h3>
                  <SectionToolbar
                    title="필요 역량 수준"
                    icon=""
                    count={gapRows.length}
                    summary={(missing.total > 0 || gapDirty || draftCount > 0) ? (
                      <span className="flex items-center gap-1">
                        {missing.total > 0 && <span className="status-chip status-amber" role="status" data-testid="missing-chip"><span aria-hidden="true">!</span> 필요도·필요 수준 누락 {missing.total}건</span>}
                        {draftCount > 0 && <span className="status-chip status-in-progress" role="status" data-testid="unsaved-draft-chip"><span aria-hidden="true">✦</span> 저장하지 않은 AI 초안 {draftCount}건</span>}
                        {gapDirty && <span className="status-chip status-amber" role="status"><span aria-hidden="true">●</span> 저장 전 변경 있음</span>}
                      </span>
                    ) : undefined}
                    actions={canCurate ? (
                      <span className="flex items-center gap-1">
                        <button type="button" className={proposePrimary ? "btn-primary btn-sm" : "btn-ghost btn-sm"} disabled={gapBusy || holdBusy} title="시너지 영역 근거로 추가 필요 역량과 누락된(빈) 필요도·필요 수준을 초안으로 제안합니다 (제안 전용 — 저장은 사람)" onClick={() => void draftGap()}>
                          {gapBusy ? "처리 중..." : "필요 역량 제안 (AI)"}
                        </button>
                        <button type="button" className="btn-ghost btn-sm" disabled={gapBusy || holdBusy || gapRows.length === 0} aria-busy={holdBusy} title="그룹/계열사 회사 정보(프로필)와 외부 웹 검색으로 보유 판정·보유 수준·근거를 초안으로 확인합니다 — 출처 인용 필수, 제안 전용" onClick={() => void checkHolding()}>
                          {holdBusy ? "확인 중..." : "보유 판정 확인 (AI)"}
                        </button>
                        <label className="flex items-center gap-1 text-[length:var(--fs-caption)]" title="판정 대상 회사·그룹과 같은 그룹의 다른 계열사(최대 8곳) 프로필·공시도 근거로 씁니다 — 근거가 된 회사명은 보유 근거에 적히고, 보유 판정은 선택한 범위 기준입니다">
                          <input type="checkbox" checked={includeGroup} disabled={gapBusy || holdBusy} onChange={(e) => setIncludeGroup(e.target.checked)} />
                          그룹 내 다른 계열사 프로필도 참고
                        </label>
                        {draftCount > 0 && <button type="button" className="btn-ghost btn-sm" disabled={gapBusy || holdBusy} onClick={discardDrafts} title="저장하지 않은 AI 초안을 버리고 저장된 값으로 되돌립니다">AI 초안 버리기</button>}
                        <button type="button" className={gapDirty ? "btn-primary btn-sm" : "btn-ghost btn-sm"} disabled={gapBusy || holdBusy || gapRows.length === 0 || !gapDirty} onClick={() => void saveGap()}>
                          {gapBusy ? "처리 중..." : "저장"}
                        </button>
                      </span>
                    ) : undefined}
                  />
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                    &quot;필요 역량 제안 (AI)&quot;은 필요도·필요 수준을, &quot;보유 판정 확인 (AI)&quot;는 보유 판정·보유 수준·근거(프로필+외부 검색, 출처 표기)를 빈 칸에만 초안으로 채웁니다. 검토·수정 후 저장하세요 — 경고 칩은 보조용이며 S8에는 읽기 전용으로 표시됩니다.
                  </p>
                  {holdBusy && <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">그룹/계열사 프로필과 외부 검색으로 보유 판정을 확인하는 중입니다 (최대 약 1분)...</p>}
                  {gapNote && (
                    <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--green-fg)] mb-2" data-testid="gap-note">
                      {gapNote} <button type="button" className="btn-ghost btn-sm ml-1" aria-label="안내 닫기" onClick={dismissGapNote}>닫기</button>
                    </p>
                  )}
                  {gapError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2">{gapError}</p>}
                  {gapRows.length === 0 ? (
                    <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)] mb-0">
                      필요 역량 행이 없습니다 — 재분석하면 시너지 영역에서 자동 도출되고, 아래 입력이나 &quot;필요 역량 제안 (AI)&quot;으로도 추가할 수 있습니다.
                    </p>
                  ) : (
                    <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
                      {/* 쓰기 권한이 없으면 셀렉트를 비활성화한다 — 기록값은 그대로 보이고(표시 유지,
                          편집만 차단), 보유 근거는 `보기` 버튼으로 연다. */}
                      <table className="data-table table-fixed-pct tmin-80" aria-label="필요 역량 수준 레지스터">
                        <caption className="sr-only">필요 역량 수준 레지스터 — 보유 판정은 그룹/계열사 프로필 기준</caption>
                        <ColGroup widths={GAP_COL_PCT} />
                        <thead>
                          <tr>
                            <th scope="col">필요 역량</th><th scope="col">필요도</th><th scope="col">필요 수준</th><th scope="col">보유 판정</th>
                            <th scope="col">보유 수준</th><th scope="col">보유 근거</th><th scope="col"><span className="sr-only">작업</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {gapRows.map((r, idx) => {
                            const mark = gapDrafts[r.id];
                            const cautions = gapCautions(r).filter((c) => c.key !== "unevaluated");
                            const miss = missingRequirementCells(r);
                            return (
                            <tr key={r.id}>
                              <td className="cell-primary">
                                <span className="font-semibold text-[length:var(--fs-caption)]">{r.capability}</span>
                                <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                  {gapSourceLabel(r.source, true)}
                                </span>
                                {r.requiredNote && <ClampedText text={r.requiredNote} className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" />}
                                {(cautions.length > 0 || r.held.reassessHint) && (
                                  <span className="flex flex-wrap gap-1 mt-1">
                                    {r.held.reassessHint && <span className="status-chip status-amber"><span aria-hidden="true">!</span> 재판정 권장</span>}
                                    {cautions.map((c) => (
                                      <span key={c.key} className={`status-chip ${c.tone === "red" ? "status-red" : c.tone === "amber" ? "status-amber" : "status-not-started"}`}>
                                        <span aria-hidden="true">{c.tone === "red" ? "▲" : c.tone === "amber" ? "!" : "·"}</span> {c.label}
                                      </span>
                                    ))}
                                  </span>
                                )}
                              </td>
                              <td>
                                <select aria-label={`${r.capability} 필요도`} value={r.necessity} disabled={!canCurate}
                                  onChange={(e) => updateGapRow(idx, { necessity: e.target.value as GapNecessity, ...(e.target.value === "partial_essential" ? {} : { necessityScopeNote: "" }) })}
                                  className="sizing-new-input sizing-new-input-sm w-full">
                                  <option value="">{NECESSITY_UNSET_LABEL}</option>
                                  {(Object.keys(NECESSITY_LABEL) as Array<Exclude<GapNecessity, "">>).map((k) => (
                                    <option key={k} value={k}>{NECESSITY_LABEL[k]}</option>
                                  ))}
                                </select>
                                {r.necessity === "partial_essential" && (
                                  <input aria-label={`${r.capability} 필수 범위`} placeholder="필수 범위 (선택)" maxLength={NECESSITY_NOTE_CAP} value={r.necessityScopeNote} disabled={!canCurate}
                                    onChange={(e) => updateGapRow(idx, { necessityScopeNote: e.target.value })}
                                    className="sizing-new-input sizing-new-input-sm mt-1 w-full" />
                                )}
                                {miss.necessity && <MissingMark />}
                                {mark?.fields.includes("necessity") && <DraftChip basis={mark.basis.necessity} />}
                              </td>
                              <td className="text-[length:var(--fs-caption)]">
                                <NarrativeInput capability={r.capability} field="필요 수준" value={r.requiredLevel} readOnly={!canCurate} onChange={(v) => updateGapRow(idx, { requiredLevel: v })} />
                                {miss.requiredLevel && <MissingMark />}
                                {mark?.fields.includes("requiredLevel") && <DraftChip basis={mark.basis.requiredLevel} />}
                              </td>
                              <td>
                                <select aria-label={`${r.capability} 보유 판정`} aria-describedby={r.held.status === "unevaluated" && holdReasons[r.id] ? `hold-reason-${r.id}` : undefined} title={r.held.status === "unevaluated" && holdReasons[r.id] ? `미판정 사유: ${holdReasons[r.id]}` : undefined} value={r.held.status} disabled={!canCurate}
                                  onChange={(e) => updateGapHeld(idx, { status: e.target.value as GapHeldStatus, legacyStatus: undefined, reassessHint: undefined })}
                                  className={`sizing-new-input sizing-new-input-sm w-full ${HELD_STATUS_CHIP[r.held.status]}`}>
                                  {(Object.keys(HELD_STATUS_LABEL) as GapHeldStatus[]).map((s) => (
                                    <option key={s} value={s}>{HELD_STATUS_LABEL[s]}</option>
                                  ))}
                                </select>
                                {mark?.fields.includes("heldStatus") && <DraftChip basis={mark.basis.held} sources={mark.sources} />}
                                {r.held.status === "unevaluated" && holdReasons[r.id] && (
                                  <span id={`hold-reason-${r.id}`} className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" title={`미판정 사유: ${holdReasons[r.id]}`}>
                                    <span aria-hidden="true">· </span>미판정 사유: {holdReasons[r.id]}
                                  </span>
                                )}
                              </td>
                              <td className="text-[length:var(--fs-caption)]">
                                <NarrativeInput capability={r.capability} field="보유 수준" value={r.currentLevel} readOnly={!canCurate} onChange={(v) => updateGapRow(idx, { currentLevel: v })} />
                                {mark?.fields.includes("currentLevel") && <DraftChip basis={mark.basis.currentLevel} sources={mark.sources} />}
                              </td>
                              <td className="text-[length:var(--fs-caption)]">
                                <HeldEvidenceButton capability={r.capability} evidence={r.held.evidence} legacyHolders={r.held.holders} readOnly={!canCurate} onOpen={() => setHeldEditing(r.id)} />
                              </td>
                              <td>
                                <button type="button" className="btn-ghost btn-sm" aria-label={`${r.capability} 행 삭제`} title="행 삭제" disabled={!canCurate}
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
                        요약: 필요 역량 {s.total}건 — 업계 리딩 {s.leading}·업계 평균 {s.average}·부분 보유 {s.partial}·미보유 {s.none}·미판정 {s.unevaluated}
                        {s.coveragePct !== null ? ` · 보유율 ${s.coveragePct}%` : ""}
                        {s.essentialCoveragePct !== null ? ` (필수 ${s.essentialCoveragePct}%)` : ""}
                      </p>
                    );
                  })()}
                  {canCurate && (
                  <div className="flex flex-wrap items-center gap-1 mt-2">
                    <input aria-label="필요 역량 추가" placeholder="필요 역량 추가" value={newGapCap}
                      onChange={(e) => setNewGapCap(e.target.value)}
                      className="sizing-new-input sizing-new-input-sm" style={{ flex: "1 1 14rem" }} />
                    <button type="button" className="btn-ghost btn-sm" onClick={addGapRow}>추가</button>
                  </div>
                  )}
                </div>
              ) : (
                <div className="mt-4 pt-3 border-t border-[color:var(--border)]">
                  <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge">2.5</span> 필요 역량 수준</h3>
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">
                    이 분석에 연결된 기회가 없어 필요 역량 수준 레지스터를 사용할 수 없습니다 — 분석 등록 시 기회를 연결하세요.
                  </p>
                </div>
              )}
            </div>
          )}</>
  );
}
