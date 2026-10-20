"use client";

// Shared required-capability summary table (ADR-0171 / ADR-0172) for S5 and the S8 read-only summary:
// ONE line per capability (no inputs, no narrative columns): 필요 역량 (+ one chip line) | 필요도 | 보유 판정 |
// 판정 요약 (one sentence from the S5 judgement) | 확정 | 작업. Filter tabs (처리할 것 / 전체) sit above.
// On S5 the 판정 button opens CapabilityJudgementDialog, which writes to the page draft state; S8 has no
// dialog, only an "S5에서 판정" link. AI output is never a decision: confirming is a separate human act.
import { useState } from "react";
import { ColGroup } from "../ui.tsx";
import { ClampedText } from "./ClampedText.tsx";
import { CapabilityJudgementDialog, type DialogNav } from "./CapabilityJudgementDialog.tsx";
import {
  ATTAINABILITY_GRADE_LABEL, HELD_STATUS_CHIP, HELD_STATUS_LABEL, NECESSITY_LABEL, NECESSITY_UNSET_LABEL, gapCautions,
  type RemovedCapability,
} from "../../lib/capability-gap.ts";
import type { AttainabilityRowView, AttainabilitySummary } from "../../lib/capability-attainability.ts";
import { JUDGEMENT_FIELD_LABEL, type AiMarks, type JudgementField, type JudgementProposal } from "../../lib/capability-judgement-ai-merge.ts";
import { staleChipText, buildJudgementDetail, buildJudgementSummary, defaultFilter, filterCounts, filterRows, neighborId, type JudgementFilter } from "../../lib/capability-judgement-view.ts";

export interface AttainabilityViewData {
  opportunity_id: string | null;
  stored: boolean;
  rows: AttainabilityRowView[];
  summary: AttainabilitySummary;
  removed_capabilities?: RemovedCapability[];
  /** Stage that owns the edit surface (read-only summary route). */
  edit_at?: "S5" | "S7";
  track?: string | null;
  /** Brown Field S8 summary: the selected target (null = none selected) and the link to its S7 check. */
  selected_target?: { id: string; company_name: string } | null;
  edit_href?: string | null;
}

/** Response of POST .../capability-attainability/ai-draft (proposal only; nothing is stored). */
export interface AiDraftResponse {
  drafts: Record<string, JudgementProposal>;
  unfilled: Record<string, string>;
  source: "llm" | "synthesis";
  note: string;
  counts: { rows: number; proposed: number; fieldsFilled: number; fieldsUnfilled: number; kept: number; failedRows: number };
}

/** AI proposal wiring from the S5 editor (absent on S8 / viewers: no AI button anywhere). */
export interface AiWiring {
  marks: AiMarks;
  basis: Record<string, JudgementProposal["basis"]>;
  busy: boolean;
  fetchProposals: (rowIds: string[]) => Promise<AiDraftResponse>;
  /** Record which fields of a row came from the AI (and their basis) after the dialog applied them. */
  markFields: (rowId: string, fields: JudgementField[], basis?: JudgementProposal["basis"]) => void;
}

/** Judgement-owned fields only; S3 values are never part of a draft. */
export interface JudgementDraft {
  resolution: string;
  expectedLevel: string;
  cost: string;
  months: string;
  grade: string;
  rationale: string;
  category: string;
  /** 2026-10-18 decider ask — 집행 주기 (금액 = 주기당 금액). "" = 미입력(일시불 취급). */
  period: string;
}

export const toJudgementDraft = (r: AttainabilityRowView): JudgementDraft => ({
  resolution: r.resolution ?? "",
  expectedLevel: r.expected_level,
  cost: r.closing_cost_krw_m === null ? "" : String(r.closing_cost_krw_m),
  months: r.months_to_attain === null ? "" : String(r.months_to_attain),
  grade: r.grade ?? "",
  rationale: r.rationale,
  category: r.category ?? "",
  period: r.period ?? "",
});

/** Server patch body for one dirty row: judgement-owned fields plus the S3 hash the page showed. */
export const judgementPatch = (id: string, d: JudgementDraft, s3Hash: string | undefined) => ({
  id, s3Hash, resolution: d.resolution || null, expectedLevel: d.expectedLevel,
  closingCostKrwM: d.cost.trim() === "" ? null : Number(d.cost), monthsToAttain: d.months.trim() === "" ? null : Number(d.months),
  grade: d.grade || null, rationale: d.rationale,
  category: d.category || null,
  spendPeriod: d.period || null,
});


const levelText = (v: string) => (v.trim() === "" ? "미정" : v);

export function SummaryStrip({ s }: { s: AttainabilitySummary }) {
  const judged = Math.max(0, s.total - s.grades.unjudged);
  const unjudged = Math.max(0, s.grades.unjudged - s.stale);
  return (
    <>
      <p className="m-0 mb-2 text-[length:var(--fs-caption)]" aria-label="필요 역량 요약" data-testid="capability-summary">
        판정 {judged}/{s.total} · 확정 {s.confirmed} · {s.stale > 0 ? <span className="status-chip status-amber"><span aria-hidden="true">!</span> 재판정 필요 {s.stale}</span> : "재판정 필요 0"} · 미판정 {unjudged}
      </p>
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


// Column widths sized from real content (16px rem) at a ~1200px table (1280px viewport):
// 필요 역량 wraps (widest, remainder); 필요도 chip "! 부분 필수"; 보유 판정 chip "! 업계 리딩";
// 판정 요약 one line "인력 영입 · 중간" (ellipsis + tooltip); 확정 chip "! 재판정 필요" + "<name> · MM-DD";
// 작업 link "S5에서 판정" (must not wrap). Index 0 (name) has no minimum. Below ~960px tmin scrolls horizontally.
const COL_PCT = [42, 9, 11, 28, 10] as const;
export const COL_MIN_REM = [0, 6.5, 6.5, 10, 7] as const;
const FILTER_LABEL: Record<JudgementFilter, string> = { todo: "처리할 것", all: "전체" };
/** S9 필요 역량 검증 판정 (capability-dd) — S8 패널은 읽기 전용 반영, 기록은 S9 탭(사람 전용). */
export interface CapabilityDdVerdictView { coverage: string; note: string; by: string; at: string }
const S9_COVERAGE_LABEL: Record<string, { label: string; cls: string }> = {
  resolved: { label: "해소 (대상 보유)", cls: "status-green" },
  partial: { label: "부분 해소", cls: "status-amber" },
  unresolved: { label: "미해소 (자체 투자 필요)", cls: "status-red" },
};
const EMPTY_DIRTY: ReadonlySet<string> = new Set();

export function CapabilityJudgementTable({ rows, drafts, editable, onSet, s3Href, note, dirty = EMPTY_DIRTY, judgeHref, judgeLabel = "S5에서 판정", ai, startYearFor, onStartYearChange, s9, showFilter = true }: {
  rows: AttainabilityRowView[];
  drafts: Record<string, JudgementDraft>;
  /** True only on the S5 edit surface; S8 and viewers get no inputs and no dialog. */
  editable: boolean;
  onSet?: (id: string, patch: Partial<JudgementDraft>) => void;
  s3Href: string;
  /** S5 free-text 비고 (edited inside the dialog; saved through the S3 register route, not the judgement route). */
  note?: { value: (id: string) => string; onChange: (id: string, v: string) => void };
  /** Rows with unsaved draft changes (counted as "처리할 것"). */
  dirty?: ReadonlySet<string>;
  /** S8: where the judgement is made (S5); renders the per-row "S5에서 판정" link. */
  judgeHref?: string | null;
  /** Link text of the per-row read-only link (S5 or S7). */
  judgeLabel?: string;
  /** S5 only: AI judgement proposals (drafts in page state; a person edits, saves and confirms). */
  ai?: AiWiring;
  /** 2026-10-18 decider ask — the dialog's 시작 연차 reads/writes the cost entry's start-year override. */
  startYearFor?: (id: string) => number | null;
  onStartYearChange?: (id: string, v: number | null) => void;
  /** S9 capability-dd verdicts by register row id (2026-10-17 round 3): renders the read-only
   *  "S9 검증" column instead of a separate table — one row per capability, one home per fact. */
  s9?: Record<string, CapabilityDdVerdictView>;
  /** 2026-10-20 round 5: the S8 read-only panel hides the 처리할 것/전체 filter — nothing is
   *  "processed" in S8 (judgement lives in S5/S7/S9), so every row is shown. */
  showFilter?: boolean;
}) {
  const canEdit = editable && !!onSet;
  const counts = filterCounts(rows, dirty);
  const [filter, setFilter] = useState<JudgementFilter>(() => defaultFilter(counts.todo));
  const [editingId, setEditingId] = useState<string | null>(null);
  const shown = showFilter ? filterRows(rows, filter, dirty) : rows;
  const shownIds = shown.map((x) => x.id);
  const editing = canEdit && editingId ? rows.find((x) => x.id === editingId) ?? null : null;
  const draftOf = (r: AttainabilityRowView) => drafts[r.id] ?? toJudgementDraft(r);

  const apply = (r: AttainabilityRowView, d: JudgementDraft, noteVal: string | undefined, nav: DialogNav) => {
    if (JSON.stringify(draftOf(r)) !== JSON.stringify(d)) onSet?.(r.id, d);
    if (note && noteVal !== undefined && noteVal !== note.value(r.id)) note.onChange(r.id, noteVal);
    setEditingId(nav === "close" ? null : neighborId(shownIds, r.id, nav === "next" ? 1 : -1));
  };

  return (
    <>
      {showFilter && (
        <div role="tablist" aria-label="필요 역량 보기 필터" className="flex flex-wrap gap-1 mb-2">
          {(["todo", "all"] as const).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? "btn-primary btn-sm" : "btn-ghost btn-sm"} onClick={() => setFilter(f)}>
              {FILTER_LABEL[f]} ({counts[f]})
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] mb-2" data-testid="filter-empty">
          {showFilter && filter === "todo" ? "처리할 판정이 없습니다 — 전체에서 확인하세요" : "해당하는 필요 역량이 없습니다."}
        </p>
      ) : (
        <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
          <table className="data-table mb-2 table-fixed-pct tmin-48" aria-label="필요 역량 달성 가능성 표">
            <caption className="sr-only">필요 역량 달성 가능성 — 필요도, 보유 판정, 판정 순</caption>
            <ColGroup widths={COL_PCT} />
            <thead>
              <tr>
                <th scope="col">필요 역량</th><th scope="col" style={{ minWidth: "6.5rem" }}>필요도</th><th scope="col" style={{ minWidth: "6.5rem" }}>보유 판정</th><th scope="col" style={{ minWidth: "10rem" }}>판정</th><th scope="col" style={{ minWidth: "7rem" }}>작업</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const cautions = gapCautions({ necessity: r.necessity, requiredLevel: r.required_level, currentLevel: r.current_level, held: { status: r.held_status, holders: r.held_holders, evidence: r.held_evidence } })
                  .filter((c) => c.key !== "unevaluated");
                const sentence = r.stale && !dirty.has(r.id) ? "" : buildJudgementSummary(draftOf(r));
                return (
                  <tr key={r.id}>
                    <td className="text-[length:var(--fs-caption)]">
                      <span className="font-semibold">{r.capability}</span>
                      {(r.stale || cautions.length > 0) && (
                        <div className="flex flex-wrap gap-1 mt-1" data-testid="capability-chips">
                          {r.stale && <span className="status-chip status-amber"><span aria-hidden="true">!</span> {r.stale_reasons?.length ? staleChipText(r) : "S3 변경 — 재판정 필요"}</span>}
                          {cautions.map((c) => (
                            <span key={c.key} className={`status-chip ${c.tone === "red" ? "status-red" : c.tone === "amber" ? "status-amber" : "status-not-started"}`}>
                              <span aria-hidden="true">{c.tone === "red" ? "▲" : c.tone === "amber" ? "!" : "·"}</span> {c.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="text-[length:var(--fs-caption)]">
                      {r.necessity
                        ? <span className="status-chip status-not-started"><span aria-hidden="true">●</span> {NECESSITY_LABEL[r.necessity]}</span>
                        : <span className="text-[color:var(--muted-fg)]">{NECESSITY_UNSET_LABEL}</span>}
                    </td>
                    <td className="text-[length:var(--fs-caption)]">
                      <span className={`status-chip ${HELD_STATUS_CHIP[r.held_status]}`}>{HELD_STATUS_LABEL[r.held_status]}</span>
                    </td>
                    <td className="text-[length:var(--fs-caption)]" data-testid="judgement-summary">
                      {(() => {
                        // 2026-10-17 round 4 (decider): 판정 요약·확정·S9 검증 were three near-duplicate
                        // columns — one 판정 cell now stacks the active bases: the S9 verification chip
                        // (when recorded), the S5/S7 judgement sentence, and the confirmation meta.
                        const v = s9?.[r.id];
                        const cov = v ? S9_COVERAGE_LABEL[v.coverage] : undefined;
                        const s9Tip = v ? `근거: ${v.note || "—"} · ${v.by} · ${v.at.slice(0, 10)} — 판정 기록은 S9 필요 역량 검증 탭(사람 전용)` : "";
                        const s5s7Empty = !sentence && !r.confirmed_at && !r.stale && !r.grade;
                        return (
                          <>
                            {v && cov && (
                              <span className="block mb-1" data-testid={`capability-s9-cell-${r.id}`} title={s9Tip}>
                                <span className={`status-chip ${cov.cls}`}><span aria-hidden="true">{v.coverage === "resolved" ? "✓" : v.coverage === "partial" ? "◐" : "▲"}</span> {cov.label}</span>
                                <span className="block break-words text-[color:var(--muted-fg)]">S9 기록 · {v.by} · {v.at.slice(5, 10)}</span>
                              </span>
                            )}
                            {sentence
                              ? <ClampedText text={sentence} title={buildJudgementDetail(draftOf(r))} lines={1} />
                              : !v && <span className="text-[color:var(--muted-fg)]">미판정</span>}
                            {dirty.has(r.id) && (
                              <span className="block text-[color:var(--muted-fg)]">
                                저장 전{ai?.marks[r.id]?.length ? <> · <span className="status-chip status-not-started" data-testid="ai-draft-chip" title={`AI 초안(저장 전): ${ai.marks[r.id].map((f) => JUDGEMENT_FIELD_LABEL[f]).join(", ")} — 사람이 검토·수정한 뒤 저장하세요.`}><span aria-hidden="true">✦</span> AI 초안</span></> : null}
                              </span>
                            )}
                            {r.confirmed_at && <span className="block mt-1"><span className="status-chip status-green"><span aria-hidden="true">✓</span> 확정</span><span className="block break-words text-[color:var(--muted-fg)]">{r.confirmed_by} · {r.confirmed_at.slice(5, 10)}</span></span>}
                            {!r.confirmed_at && r.stale && <span className="status-chip status-amber"><span aria-hidden="true">!</span> 재판정 필요</span>}
                            {!r.confirmed_at && !r.stale && r.grade && <span className="status-chip status-not-started"><span aria-hidden="true">○</span> 확정 전</span>}
                          </>
                        );
                      })()}
                    </td>
                    <td className="text-[length:var(--fs-caption)]">
                      {canEdit
                        ? <button type="button" className="btn-ghost btn-sm" aria-label={`${r.capability} 판정`} onClick={() => setEditingId(r.id)}>판정</button>
                        : judgeHref ? <a href={judgeHref} className="text-[color:var(--accent)] underline" aria-label={`${r.capability} ${judgeLabel}`}>{judgeLabel}</a> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <CapabilityJudgementDialog key={editing.id} row={editing} draft={draftOf(editing)} note={note ? note.value(editing.id) : undefined} s3Href={s3Href} startYear={startYearFor?.(editing.id) ?? null} onStartYearChange={(v) => onStartYearChange?.(editing.id, v)}
          hasPrev={neighborId(shownIds, editing.id, -1) !== null} hasNext={neighborId(shownIds, editing.id, 1) !== null}
          ai={ai} aiFields={ai?.marks[editing.id] ?? []} onAiFields={(f, b) => ai?.markFields(editing.id, f, b)} onApply={(d, n, nav) => apply(editing, d, n, nav)} onRejudge={() => onSet?.(editing.id, {})} onClose={() => setEditingId(null)} />
      )}
    </>
  );
}
