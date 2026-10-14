"use client";

// Split from components/stages/SynergyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useState } from "react";
import { SectionToolbar } from "../../layout.tsx";
import { type GapHeldStatus, HELD_STATUS_CHIP, HELD_STATUS_LABEL, type GapResolution, RESOLUTION_LABEL, summarizeGap, gapSourceLabel } from "../../../lib/capability-gap.ts";
import type { SynergyResultState } from "./useSynergyResult.ts";
import type { SynergyPayload } from "./types.ts";
import { ColGroup } from "../../ui.tsx";
import { ClampedText } from "../ClampedText.tsx";
import { CapabilityHeldDialog, evidencePreview, holdersPreview } from "../CapabilityHeldDialog.tsx";

// 시너지 영역 6열 — 근거·기회·위험이 긴 문단 열.
const SYNERGY_AREA_COL_PCT = [14, 10, 30, 20, 16, 10] as const;

export function SynergyLinkageTab({ ctx, p }: { ctx: SynergyResultState; p: SynergyPayload }) {
  const { tab, canCurate, showLinkageForm, setShowLinkageForm, linkageForm, setLinkageForm, linkageError, setLinkageError, linkageSaving, addLinkageItem, opportunityId, gapRows, gapBusy, draftGap, saveGap, gap, gapNote, gapError, updateGapHeld, updateGapRow, setGapRows, newGapCap, setNewGapCap, addGapRow } = ctx;
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
                  사람이 보유 판정한다. "필요 역량 추가 제안" 버튼은 이후에도
                  행이 더 필요할 때 쓴다. */}
              {opportunityId ? (
                <div className="mt-4 pt-3 border-t border-[color:var(--border)]">
                  <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge">2.5</span> 필요 역량 수준 — 시너지 영역을 채울 자사 역량은 있는가</h3>
                  <SectionToolbar
                    title="필요 역량 수준"
                    icon=""
                    count={gapRows.length}
                    actions={
                      <span className="flex items-center gap-1">
                        {canCurate && (
                          <button type="button" className="btn-ghost btn-sm" disabled={gapBusy || gapRows.length === 0} title="시너지 영역 근거로 필요 역량을 추가로 제안하고 프로필 근거로 보유 판정 초안을 생성 (제안 전용 — 저장은 사람)" onClick={() => void draftGap()}>
                            {gapBusy ? "제안 생성 중..." : "필요 역량 추가 제안"}
                          </button>
                        )}
                        {canCurate && (
                          <button type="button" className="btn-ghost btn-sm" disabled={gapBusy || gapRows.length === 0} onClick={() => void saveGap()}>
                            {gapBusy ? "저장 중..." : "저장"}
                          </button>
                        )}
                      </span>
                    }
                  />
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                    시너지 분석(신규·재분석) 시 위 시너지 영역에서 필요 역량이 자동 도출·병합됩니다.{" "}
                    {gap?.internalAssessmentNote ?? "내부(자사 단독) 역량 평가는 추후 보강 예정 — 현재 보유 판정 근거는 그룹/계열사 프로필 기준입니다."}
                    {gap && !gap.stored && gapRows.length > 0 ? " — 아직 저장되지 않은 시드 초안입니다." : ""}
                    {" "}필요 내용·보유 판정·보유 주체/근거는 여기(S3)에서 정의하며, S8 필요 역량 달성 가능성 화면에는 읽기 전용으로 표시됩니다.
                  </p>
                  {gapNote && <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--green-fg)] mb-2">{gapNote}</p>}
                  {gapError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2">{gapError}</p>}
                  {gapRows.length === 0 ? (
                    <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)] mb-0">
                      필요 역량 행이 없습니다 — 분석(재분석)을 실행하면 시너지 영역에서 자동 도출되고, 아래 입력이나 &quot;필요 역량 추가 제안&quot;으로도 추가할 수 있습니다. 비즈니스 모델 검토에 필요 역량(requiredCapabilities)이 있으면 이 섹션에서 시드됩니다.
                    </p>
                  ) : (
                    <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
                      {/* 쓰기 권한이 없으면 레지스터의 셀렉트를 비활성화한다 — 기록값은 그대로
                          보이고(표시 유지, 편집만 차단), 보유 주체·근거는 `보기` 버튼으로 연다. */}
                      <table className="data-table" aria-label="필요 역량 수준 레지스터">
                        <caption className="sr-only">필요 역량 수준 레지스터 — 보유 판정은 그룹/계열사 프로필 기준</caption>
                        <thead>
                          <tr>
                            <th scope="col">필요 역량</th><th scope="col">보유 판정</th>
                            <th scope="col">보유 주체·근거</th><th scope="col">해소 힌트</th><th scope="col"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {gapRows.map((r, idx) => (
                            <tr key={r.id}>
                              <td className="cell-primary max-w-[22rem] break-words">
                                <span className="font-semibold text-[length:var(--fs-caption)]">{r.capability}</span>
                                <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                  {gapSourceLabel(r.source, true)}
                                </span>
                                {r.requiredNote && <ClampedText text={r.requiredNote} className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" />}
                              </td>
                              <td>
                                <select aria-label={`${r.capability} 보유 판정`} value={r.held.status} disabled={!canCurate}
                                  onChange={(e) => updateGapHeld(idx, { status: e.target.value as GapHeldStatus })}
                                  className={`sizing-new-input sizing-new-input-sm ${HELD_STATUS_CHIP[r.held.status]}`}>
                                  {(Object.keys(HELD_STATUS_LABEL) as GapHeldStatus[]).map((s) => (
                                    <option key={s} value={s}>{HELD_STATUS_LABEL[s]}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="text-[length:var(--fs-caption)]">
                                <span className="block"><span className="text-[color:var(--muted-fg)]">주체</span> {holdersPreview(r.held.holders)}</span>
                                <span className="block"><span className="text-[color:var(--muted-fg)]">근거</span> {evidencePreview(r.held.evidence)}</span>
                                <button type="button" className="btn-ghost btn-sm mt-1" aria-label={`${r.capability} 보유 주체·근거 ${canCurate ? "입력" : "보기"}`} onClick={() => setHeldEditing(r.id)}>
                                  {canCurate ? (r.held.holders.length > 0 || r.held.evidence.trim() ? "수정" : "입력") : "보기"}
                                </button>
                              </td>
                              <td>
                                <select aria-label={`${r.capability} 해소 힌트`} value={r.resolution ?? ""} disabled={!canCurate}
                                  onChange={(e) => updateGapRow(idx, { resolution: (e.target.value || null) as GapResolution | null })}
                                  className="sizing-new-input sizing-new-input-sm">
                                  <option value="">—</option>
                                  {(Object.keys(RESOLUTION_LABEL) as GapResolution[]).map((k) => (
                                    <option key={k} value={k}>{RESOLUTION_LABEL[k]}</option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <button type="button" className="btn-danger btn-sm" aria-label={`${r.capability} 행 삭제`} disabled={!canCurate}
                                  onClick={() => setGapRows((prev) => prev.filter((_, i) => i !== idx))}>삭제</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {heldEditing && (() => {
                        const row = gapRows.find((x) => x.id === heldEditing);
                        if (!row) return null;
                        return <CapabilityHeldDialog capability={row.capability} holders={row.held.holders} evidence={row.held.evidence} readOnly={!canCurate} unevaluated={row.held.status === "unevaluated"}
                          onSave={(v) => { updateGapHeld(gapRows.findIndex((x) => x.id === row.id), { holders: v.holders, evidence: v.evidence }); setHeldEditing(null); }}
                          onClose={() => setHeldEditing(null)} />;
                      })()}
                    </div>
                  )}
                  {(() => {
                    const s = summarizeGap(gapRows);
                    if (s.total === 0) return null;
                    return (
                      <p className="text-[length:var(--fs-caption)] mt-2 mb-0">
                        요약: 필요 역량 {s.total}건 — 충족 {s.met}·부분 {s.partial}·미보유 {s.unmet}·미판정 {s.unevaluated}
                        {s.coveragePct !== null ? ` · 충족률 ${s.coveragePct}%` : ""}
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
