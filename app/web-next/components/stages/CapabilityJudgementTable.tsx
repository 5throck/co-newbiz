"use client";

// Shared required-capability judgement table (ADR-0171 / ADR-0172). One component renders the
// canonical column order for both surfaces:
//   필요 역량 → 필요도 → 필요 수준 → 보유 판정 → 보유 수준 → 보유 주체·근거
//   → 해소 방식 → 기대 수준 → 비용 → 기간 → 달성 가능성 → 근거·증빙 → 확정
// The S3-owned columns are always read-only here. The judgement columns (해소 방식 .. 근거·증빙)
// are inputs only when `editable` (S5); the S8 summary renders the same table read-only.
// Stale marker, re-judge shortcut, history line and the removed-capabilities list live here so
// both surfaces share them. AI output is never a decision: confirming is a separate human act.
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import { ColGroup } from "../ui.tsx";
import { ClampedText } from "./ClampedText.tsx";
import { CapabilityHeldDialog, HeldSummary } from "./CapabilityHeldDialog.tsx";
import { CapabilityNarrativeDialog, NarrativeCell, type NarrativeField } from "./CapabilityNarrativeDialog.tsx";
import {
  ATTAINABILITY_GRADE_LABEL, HELD_STATUS_CHIP, HELD_STATUS_LABEL, NARRATIVE_CAP, NECESSITY_LABEL, NECESSITY_UNSET_LABEL,
  RESOLUTION_EXPECTED_LEVEL_HINT, RESOLUTION_LABEL, gapCautions,
  type GapResolution, type RemovedCapability,
} from "../../lib/capability-gap.ts";
import type { AttainabilityRowView, AttainabilitySummary } from "../../lib/capability-attainability.ts";

export interface AttainabilityViewData {
  opportunity_id: string | null;
  stored: boolean;
  rows: AttainabilityRowView[];
  summary: AttainabilitySummary;
  removed_capabilities?: RemovedCapability[];
  /** Stage that owns the edit surface (read-only summary route). */
  edit_at?: "S5" | "S7";
  track?: string | null;
}

/** Judgement-owned fields only; S3 values are never part of a draft. */
export interface JudgementDraft {
  resolution: string;
  expectedLevel: string;
  cost: string;
  months: string;
  grade: string;
  rationale: string;
}

export const toJudgementDraft = (r: AttainabilityRowView): JudgementDraft => ({
  resolution: r.resolution ?? "",
  expectedLevel: r.expected_level,
  cost: r.closing_cost_krw_m === null ? "" : String(r.closing_cost_krw_m),
  months: r.months_to_attain === null ? "" : String(r.months_to_attain),
  grade: r.grade ?? "",
  rationale: r.rationale,
});

/** Server patch body for one dirty row: judgement-owned fields plus the S3 hash the page showed. */
export const judgementPatch = (id: string, d: JudgementDraft, s3Hash: string | undefined) => ({
  id, s3Hash, resolution: d.resolution || null, expectedLevel: d.expectedLevel,
  closingCostKrwM: d.cost.trim() === "" ? null : Number(d.cost), monthsToAttain: d.months.trim() === "" ? null : Number(d.months),
  grade: d.grade || null, rationale: d.rationale,
});

const RESOLUTIONS: GapResolution[] = ["build", "partner", "hire", "invest"];
const GRADE_OPTIONS = [
  { value: "", text: "미판정" }, { value: "high", text: "높음" },
  { value: "medium", text: "중간" }, { value: "low", text: "낮음" },
] as const;
const RATIONALE_MAX = 600; // mirrors the server cap in lib/capability-attainability.ts
const PREVIEW_LEN = 60;

// 13 columns, +1 with the S5 비고 column. Percentages sum to 100.
const COL_PCT = [12, 5, 9, 7, 9, 9, 7, 10, 5, 5, 7, 10, 5] as const;
const COL_PCT_NOTE = [11, 5, 8, 7, 8, 8, 7, 9, 5, 5, 7, 9, 5, 6] as const;

const levelText = (v: string) => (v.trim() === "" ? "미정" : v);

function RationaleDialog({ capability, initial, readOnly, onSave, onClose }: {
  capability: string; initial: string; readOnly: boolean; onSave: (text: string) => void; onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [text, setText] = useState(initial);
  const fieldId = useId();
  useEffect(() => setMounted(true), []);
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  if (!mounted) return null;
  const title = `${capability} 근거·증빙`;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation" onKeyDown={onKeyDown}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: "36rem", width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2 style={{ fontSize: "0.95rem" }}>{title}</h2></div>
        <label className="sr-only" htmlFor={fieldId}>{title}</label>
        <textarea id={fieldId} className="sizing-new-input w-full mt-2" rows={10} maxLength={RATIONALE_MAX} autoFocus readOnly={readOnly}
          placeholder="근거·증빙 (높음·낮음은 근거 필수)" value={text} onChange={(e) => setText(e.target.value)} />
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" aria-live="polite">{text.length} / {RATIONALE_MAX}자</p>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{readOnly ? "닫기" : "취소"}</button>
          {!readOnly && <button type="button" className="btn-ghost btn-sm" onClick={() => onSave(text)}>저장</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function SummaryStrip({ s }: { s: AttainabilitySummary }) {
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-2" aria-label="필요 역량 요약">
        <span className="status-chip status-green">{HELD_STATUS_LABEL.leading} {s.held.leading}</span>
        <span className="status-chip status-green">{HELD_STATUS_LABEL.average} {s.held.average}</span>
        <span className="status-chip status-amber">{HELD_STATUS_LABEL.partial} {s.held.partial}</span>
        <span className="status-chip status-red">{HELD_STATUS_LABEL.none} {s.held.none}</span>
        <span className="status-chip status-not-started">{HELD_STATUS_LABEL.unevaluated} {s.held.unevaluated}</span>
        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          달성 가능성 — 높음 {s.grades.high} · 중간 {s.grades.medium} · 낮음 {s.grades.low} · 미판정 {s.grades.unjudged} (사람 확정 {s.confirmed}건)
        </span>
        {s.stale > 0 && <span className="status-chip status-amber"><span aria-hidden="true">!</span> 재판정 필요 {s.stale}</span>}
      </div>
      {s.banner && s.bannerText && <div className="legacy-model-notice mb-2" role="alert"><p className="legacy-model-notice-text">{s.bannerText}</p></div>}
    </>
  );
}

export function RemovedCapabilities({ removed }: { removed: RemovedCapability[] }) {
  if (removed.length === 0) return null;
  return (
    <details className="mb-2">
      <summary className="cursor-pointer text-[length:var(--fs-caption)]">삭제된 역량 (판정 이력) {removed.length}건</summary>
      <ul className="m-0 pl-4 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
        {removed.map((x, i) => (
          <li key={`${x.rowId}-${i}`}>
            {x.capability} — 필요 {levelText(x.requiredLevel)} / 보유 {levelText(x.currentLevel)}, 마지막 판정 {x.attainability?.grade ? ATTAINABILITY_GRADE_LABEL[x.attainability.grade] : "미판정"}{x.attainability?.confirmedBy ? ` (확정 ${x.attainability.confirmedBy})` : ""} · {x.removedAt.slice(0, 10)} S3에서 삭제({x.removedBy})
          </li>
        ))}
      </ul>
    </details>
  );
}

type NarrativeTarget = { id: string; field: NarrativeField };

export function CapabilityJudgementTable({ rows, drafts, editable, onSet, s3Href, note }: {
  rows: AttainabilityRowView[];
  drafts: Record<string, JudgementDraft>;
  /** True only on the S5 edit surface; S8 and viewers render the judgement columns read-only. */
  editable: boolean;
  onSet?: (id: string, patch: Partial<JudgementDraft>) => void;
  s3Href: string;
  /** S5 free-text 비고 column (saved through the S3 register route, not the judgement route). */
  note?: { value: (id: string) => string; onChange: (id: string, v: string) => void };
}) {
  const [editingRationale, setEditingRationale] = useState<string | null>(null);
  const [narrative, setNarrative] = useState<NarrativeTarget | null>(null);
  const [heldViewing, setHeldViewing] = useState<string | null>(null);
  const canEdit = editable && !!onSet;
  const set = (id: string, patch: Partial<JudgementDraft>) => onSet?.(id, patch);

  return (
    <>
      <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
        <table className="data-table mb-2 table-fixed-pct tmin-80" aria-label="필요 역량 달성 가능성 표">
          <caption className="sr-only">필요 역량 달성 가능성 — 필요도, 필요 수준, 보유 판정, 보유 수준, 해소 방식, 기대 수준 순</caption>
          <ColGroup widths={note ? COL_PCT_NOTE : COL_PCT} />
          <thead>
            <tr>
              <th scope="col">필요 역량</th><th scope="col">필요도</th><th scope="col">필요 수준</th><th scope="col">보유 판정</th>
              <th scope="col">보유 수준</th><th scope="col">보유 주체·근거</th>
              <th scope="col">해소 방식</th><th scope="col">기대 수준</th><th scope="col">비용(백만원)</th><th scope="col">기간(개월)</th>
              <th scope="col">달성 가능성</th><th scope="col">근거·증빙</th><th scope="col">확정</th>
              {note && <th scope="col">비고</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = drafts[r.id] ?? toJudgementDraft(r);
              const cautions = gapCautions({ necessity: r.necessity, requiredLevel: r.required_level, currentLevel: r.current_level, held: { status: r.held_status, holders: r.held_holders, evidence: r.held_evidence } })
                .filter((c) => c.key !== "unevaluated");
              const resolution = (d.resolution || null) as GapResolution | null;
              const txt = d.rationale.trim();
              const missingRationale = !txt && (d.grade === "high" || d.grade === "low");
              return (
                <tr key={r.id}>
                  <td className="text-[length:var(--fs-caption)]">
                    <span className="font-semibold">{r.capability}</span>
                    {r.required_note.trim() && <ClampedText text={r.required_note} className="text-[color:var(--muted-fg)]" />}
                    <a href={s3Href} className="block text-[color:var(--accent)] underline" aria-label={`${r.capability} 정의는 S3에서 수정`}>S3에서 수정</a>
                    {r.stale && (
                      <div className="mt-1" role="status">
                        <span className="status-chip status-amber"><span aria-hidden="true">!</span> S3 변경 — 재판정 필요</span>
                        {r.s3_changes.length > 0 ? (
                          <ul className="m-0 pl-4 text-[color:var(--muted-fg)]">
                            {r.s3_changes.map((c) => <li key={c.field}>{c.label}: {c.before} → {c.after}</li>)}
                          </ul>
                        ) : <span className="block text-[color:var(--muted-fg)]">변경 내용: S3 항목이 바뀌었습니다(상세 비교 없음).</span>}
                        <span className="block text-[color:var(--muted-fg)]">
                          이전 판정 {r.grade_label}{r.rationale ? ` — ${r.rationale.length > PREVIEW_LEN ? `${r.rationale.slice(0, PREVIEW_LEN)}…` : r.rationale}` : ""}{canEdit ? " (아래 값에 그대로 채워 두었습니다)" : ""}
                        </span>
                        {canEdit && <button type="button" className="btn-ghost btn-sm mt-1" aria-label={`${r.capability} 이전 판정으로 재판정`} onClick={() => set(r.id, {})}>이전 판정 그대로 재판정</button>}
                      </div>
                    )}
                    {!r.stale && r.prior && (
                      <span className="block text-[color:var(--muted-fg)]">
                        이전 판정: {r.prior.grade ? ATTAINABILITY_GRADE_LABEL[r.prior.grade] : "미판정"}{r.prior.confirmedBy ? ` (확정 ${r.prior.confirmedBy}, ${(r.prior.confirmedAt ?? "").slice(0, 10)})` : ""} · {r.prior.invalidatedAt.slice(0, 10)} S3 변경으로 무효화
                      </span>
                    )}
                  </td>
                  <td className="text-[length:var(--fs-caption)]">
                    {r.necessity ? NECESSITY_LABEL[r.necessity] : <span className="text-[color:var(--muted-fg)]">{NECESSITY_UNSET_LABEL}</span>}
                    {r.necessity === "partial_essential" && r.necessity_scope_note.trim() && <span className="block text-[color:var(--muted-fg)]">{r.necessity_scope_note}</span>}
                  </td>
                  <td className="text-[length:var(--fs-caption)]">
                    <NarrativeCell capability={r.capability} field="필요 수준" value={r.required_level} readOnly onOpen={() => setNarrative({ id: r.id, field: "필요 수준" })} />
                  </td>
                  <td className="text-[length:var(--fs-caption)]">
                    <span className={`status-chip ${HELD_STATUS_CHIP[r.held_status]}`}>{HELD_STATUS_LABEL[r.held_status]}</span>
                    {cautions.map((c) => (
                      <span key={c.key} className={`status-chip mt-1 ${c.tone === "red" ? "status-red" : c.tone === "amber" ? "status-amber" : "status-not-started"}`}>
                        <span aria-hidden="true">{c.tone === "red" ? "▲" : c.tone === "amber" ? "!" : "·"}</span> {c.label}
                      </span>
                    ))}
                  </td>
                  <td className="text-[length:var(--fs-caption)]">
                    <NarrativeCell capability={r.capability} field="보유 수준" value={r.current_level} readOnly onOpen={() => setNarrative({ id: r.id, field: "보유 수준" })} />
                  </td>
                  <td className="text-[length:var(--fs-caption)]">
                    <HeldSummary holders={r.held_holders} evidence={r.held_evidence} />
                    <button type="button" className="btn-ghost btn-sm mt-1" aria-label={`${r.capability} 보유 주체·근거 보기`} onClick={() => setHeldViewing(r.id)}>보기</button>
                  </td>
                  <td className="text-[length:var(--fs-caption)]">
                    {canEdit ? (
                      <select aria-label={`${r.capability} 해소 방식`} value={d.resolution} onChange={(e) => set(r.id, { resolution: e.target.value })} className="sizing-new-input sizing-new-input-sm">
                        <option value="">미정</option>
                        {RESOLUTIONS.map((x) => <option key={x} value={x}>{RESOLUTION_LABEL[x]}</option>)}
                      </select>
                    ) : resolution ? RESOLUTION_LABEL[resolution] : <span className="text-[color:var(--muted-fg)]">미정</span>}
                  </td>
                  <td className="text-[length:var(--fs-caption)]">
                    <NarrativeCell capability={r.capability} field="기대 수준" value={d.expectedLevel} readOnly={!canEdit} onOpen={() => setNarrative({ id: r.id, field: "기대 수준" })} />
                    {canEdit && resolution && (
                      <span className="block text-[color:var(--muted-fg)]" data-testid="expected-level-hint">작성 안내: {RESOLUTION_EXPECTED_LEVEL_HINT[resolution]}</span>
                    )}
                    {canEdit && resolution && d.expectedLevel.trim() === "" && (
                      <span className="block text-[color:var(--muted-fg)]">확정하려면 기대 수준이 필요합니다.</span>
                    )}
                  </td>
                  <td>
                    {canEdit
                      ? <input type="number" min={0} aria-label={`${r.capability} 해소 비용(백만원)`} value={d.cost} onChange={(e) => set(r.id, { cost: e.target.value })} className="sizing-new-input sizing-new-input-sm" />
                      : <span className="tabular-nums text-[length:var(--fs-caption)]">{d.cost === "" ? "—" : d.cost}</span>}
                  </td>
                  <td>
                    {canEdit
                      ? <input type="number" min={0} aria-label={`${r.capability} 달성 기간(개월)`} value={d.months} onChange={(e) => set(r.id, { months: e.target.value })} className="sizing-new-input sizing-new-input-sm" />
                      : <span className="tabular-nums text-[length:var(--fs-caption)]">{d.months === "" ? "—" : d.months}</span>}
                  </td>
                  <td className="text-[length:var(--fs-caption)]">
                    {canEdit ? (
                      <select aria-label={`${r.capability} 달성 가능성`} value={d.grade} onChange={(e) => set(r.id, { grade: e.target.value })} className="sizing-new-input sizing-new-input-sm mb-1">
                        {GRADE_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.text}</option>)}
                      </select>
                    ) : <span className="block">{r.stale ? "미판정" : r.grade_label}</span>}
                    {r.drafted_by === "ai" && <div className="text-[color:var(--muted-fg)]">AI 초안</div>}
                  </td>
                  <td>
                    <div className="text-[length:var(--fs-caption)] mb-1">
                      {txt ? <span>{txt.length > PREVIEW_LEN ? `${txt.slice(0, PREVIEW_LEN)}…` : txt}</span> : <span className="text-[color:var(--muted-fg)]">미입력</span>}
                      {canEdit && missingRationale && <span className="status-chip status-red block mt-1">✕ 근거 필수</span>}
                    </div>
                    <button type="button" className="btn-ghost btn-sm" aria-label={`${r.capability} 근거·증빙 ${canEdit ? "입력" : "보기"}`} onClick={() => setEditingRationale(r.id)}>
                      {canEdit ? (txt ? "수정" : "입력") : "보기"}
                    </button>
                    {r.evidence.length > 0 && (
                      <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
                        기존 증빙
                        <ul className="m-0 pl-4">{r.evidence.map((x, i) => <li key={i}>{x}</li>)}</ul>
                      </div>
                    )}
                  </td>
                  <td className="text-[length:var(--fs-caption)]">
                    {r.confirmed_at ? <>확정<span className="block text-[color:var(--muted-fg)]">{r.confirmed_by} · {r.confirmed_at.slice(0, 10)}</span></>
                      : r.stale ? "재판정 필요" : r.grade ? "확정 전" : "—"}
                  </td>
                  {note && (
                    <td>
                      <input aria-label={`${r.capability} 비고`} placeholder="비고" value={note.value(r.id)} disabled={!canEdit} onChange={(e) => note.onChange(r.id, e.target.value)} className="sizing-new-input sizing-new-input-sm w-full" />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editingRationale && (() => {
        const row = rows.find((x) => x.id === editingRationale);
        if (!row) return null;
        return <RationaleDialog capability={row.capability} initial={(drafts[row.id] ?? toJudgementDraft(row)).rationale} readOnly={!canEdit}
          onSave={(t) => { set(row.id, { rationale: t }); setEditingRationale(null); }} onClose={() => setEditingRationale(null)} />;
      })()}
      {narrative && (() => {
        const row = rows.find((x) => x.id === narrative.id);
        if (!row) return null;
        const d = drafts[row.id] ?? toJudgementDraft(row);
        const value = narrative.field === "필요 수준" ? row.required_level : narrative.field === "보유 수준" ? row.current_level : d.expectedLevel;
        const writable = canEdit && narrative.field === "기대 수준";
        return <CapabilityNarrativeDialog capability={row.capability} field={narrative.field} value={value} readOnly={!writable}
          onSave={writable ? (v) => { set(row.id, { expectedLevel: v.slice(0, NARRATIVE_CAP) }); setNarrative(null); } : undefined}
          onClose={() => setNarrative(null)} />;
      })()}
      {heldViewing && (() => {
        const row = rows.find((x) => x.id === heldViewing);
        if (!row) return null;
        return <CapabilityHeldDialog capability={row.capability} holders={row.held_holders} evidence={row.held_evidence} readOnly unevaluated={row.held_status === "unevaluated"} onClose={() => setHeldViewing(null)} />;
      })()}
    </>
  );
}
