"use client";

// Split from components/stages/SynergyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useState } from "react";
import { SectionToolbar } from "../../layout.tsx";
import { api } from "../../../lib/api.ts";
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
const GAP_COL_PCT = [23, 8, 24, 9, 23, 9, 4] as const;

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
  const { tab, canCurate, showLinkageForm, setShowLinkageForm, linkageForm, setLinkageForm, linkageError, setLinkageError, linkageSaving, addLinkageItem, opportunityId, gapRows, gapBusy, discardDrafts, dismissGapNote, draftGap, saveGap, gapNote, gapDrafts, gapDirty, holdBusy, checkHolding, includeGroup, setIncludeGroup, holdReasons, gapError, updateGapHeld, updateGapRow, setGapRows, newGapCap, setNewGapCap, addGapRow, inProgress, onRerun } = ctx;
  const proposePrimary = !gapDirty && gapRows.length === 0;
  const missing = countMissingRequirement(gapRows);
  const draftCount = countDraftFields(gapDrafts);
  const [heldEditing, setHeldEditing] = useState<string | null>(null);
  // ADR-0182 Phase 4 — AI 영역 제안(초안). 서버가 무엇도 쓰지 않고 제안만
  // 돌려주며, 추가 폼 프리필과 저장은 전부 사람의 행위다(경계 #2).
  const [aiAreasBusy, setAiAreasBusy] = useState(false);
  const [aiAreas, setAiAreas] = useState<Array<{ area: string; synergyType: string; rationale: string; opportunity: string; risk: string }> | null>(null);
  const [aiAreasNote, setAiAreasNote] = useState<string | null>(null);
  const [aiAreasError, setAiAreasError] = useState<string | null>(null);
  async function proposeAreas() {
    if (!opportunityId || aiAreasBusy) return;
    setAiAreasBusy(true); setAiAreasError(null); setAiAreasNote(null);
    try {
      const r = await api.post<{ suggestedAreas: Array<{ area: string; synergyType: string; rationale: string; opportunity: string; risk: string }> | null; note: string | null }>(
        "/api/synergy/ai-areas",
        { opportunityId, exclude: p.marketLinkage.synergyAreas.map((a) => a.area) },
      );
      setAiAreas(r.data.suggestedAreas);
      setAiAreasNote(r.data.note);
    } catch (err) {
      setAiAreasError(err instanceof Error ? err.message : "AI 영역 제안 실패");
    } finally {
      setAiAreasBusy(false);
    }
  }
  return (
    <>{tab === "linkage" && (
            <div className="text-[length:var(--fs-body)]">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <h3 className="sizing-step-title text-[length:var(--fs-body)] mb-0">S1·S2 연계 시너지 영역 (후보 탐색 → 본검증)</h3>
                {/* ADR-0182 — 재분석은 이 흐름의 시작(연계 탭)에서만 노출한다.
                    AI 재도출임을 라벨에 드러내고, 범위 문구는 아래 줄에 분리해
                    읽게 한다(2026-10-18 사용자 리포트). */}
                {canCurate && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={inProgress}
                    title="AI가 DART 재무 입수부터 시너지 점수까지 5단계를 다시 실행합니다"
                    onClick={onRerun}
                  >
                    {inProgress ? "재분석 진행 중..." : <><span aria-hidden="true">🤖</span> 재분석 (AI)</>}
                  </button>
                )}
              </div>
              {canCurate && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                  재분석하면 연계 시너지 영역·주요 검토 영역·시너지 점수가 AI로 재도출됩니다 — 사람이 추가·수정한 영역과 확정 점수는 재도출 결과로 대체될 수 있습니다.
                </p>
              )}
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
              {canCurate && opportunityId && (
                <div className="mt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="btn-ghost btn-sm" disabled={aiAreasBusy} onClick={() => void proposeAreas()}>
                      {aiAreasBusy ? "제안 생성 중..." : aiAreas ? "🤖 AI 영역 다시 제안" : "🤖 AI 영역 제안"}
                    </button>
                    <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                      기존 영역을 제외한 신규 시너지 영역 초안 — 추가는 사람의 행위입니다 (경계 #2)
                    </span>
                  </div>
                  {aiAreasError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-1 mb-0">{aiAreasError}</p>}
                  {aiAreasNote && <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">{aiAreasNote}</p>}
                  {aiAreas && aiAreas.length > 0 && (
                    <ul className="sizing-note-list mt-2" aria-label="AI 영역 제안 초안">
                      {aiAreas.map((a) => (
                        <li key={a.area}>
                          <span className="status-chip status-in-progress"><span aria-hidden="true">✦</span> AI 초안</span>{" "}
                          <strong>{a.area}</strong> <span className="text-[color:var(--muted-fg)]">({a.synergyType})</span>
                          <span className="block text-[color:var(--muted-fg)]">{a.rationale}</span>
                          {a.opportunity && <span className="block text-[color:var(--muted-fg)]">기회: {a.opportunity}</span>}
                          {a.risk && <span className="block text-[color:var(--muted-fg)]">위험: {a.risk}</span>}
                          <span className="block mt-1">
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              onClick={() => { setShowLinkageForm(true); setLinkageForm({ area: a.area, synergyType: a.synergyType, rationale: a.rationale, opportunity: a.opportunity, risk: a.risk }); }}
                            >
                              추가 폼에 불러오기
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

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

              {/* 필요 역량 수준 레지스터는 ADR-0181(2026-10-18)에서 독립 탭(capability)으로 승격 — SynergyCapabilityTab */}
            </div>
          )}</>
  );
}
