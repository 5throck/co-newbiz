"use client";

// Shared required-capability summary table (ADR-0171 / ADR-0172) for S5 and the S8 read-only summary:
// ONE line per capability (no inputs, no narrative columns): 필요 역량 (+ one chip line) | 필요도 | 보유 판정 |
// 판정 요약 (one sentence from the S5 judgement) | 확정 | 작업. Filter tabs (처리할 것 / 확정 / 전체) sit above.
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
import { buildJudgementDetail, buildJudgementSummary, defaultFilter, filterCounts, filterRows, neighborId, type JudgementFilter } from "../../lib/capability-judgement-view.ts";

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


const COL_PCT = [34, 9, 10, 24, 12, 11] as const;
const FILTER_LABEL: Record<JudgementFilter, string> = { todo: "처리할 것", confirmed: "확정", all: "전체" };
const EMPTY_DIRTY: ReadonlySet<string> = new Set();

export function CapabilityJudgementTable({ rows, drafts, editable, onSet, s3Href, note, dirty = EMPTY_DIRTY, judgeHref }: {
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
}) {
  const canEdit = editable && !!onSet;
  const counts = filterCounts(rows, dirty);
  const [filter, setFilter] = useState<JudgementFilter>(() => defaultFilter(counts.todo));
  const [editingId, setEditingId] = useState<string | null>(null);
  const shown = filterRows(rows, filter, dirty);
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
      <div role="tablist" aria-label="필요 역량 보기 필터" className="flex flex-wrap gap-1 mb-2">
        {(["todo", "confirmed", "all"] as const).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? "btn-primary btn-sm" : "btn-ghost btn-sm"} onClick={() => setFilter(f)}>
            {FILTER_LABEL[f]} ({counts[f]})
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] mb-2" data-testid="filter-empty">
          {filter === "todo" ? "처리할 항목이 없습니다 — 모든 필요 역량이 판정·확정되었습니다." : "해당하는 필요 역량이 없습니다."}
        </p>
      ) : (
        <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
          <table className="data-table mb-2 table-fixed-pct tmin-48" aria-label="필요 역량 달성 가능성 표">
            <caption className="sr-only">필요 역량 달성 가능성 — 필요도, 보유 판정, 판정 요약, 확정 순</caption>
            <ColGroup widths={COL_PCT} />
            <thead>
              <tr>
                <th scope="col">필요 역량</th><th scope="col">필요도</th><th scope="col">보유 판정</th><th scope="col">판정 요약</th><th scope="col">확정</th><th scope="col">작업</th>
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
                          {r.stale && <span className="status-chip status-amber"><span aria-hidden="true">!</span> S3 변경 — 재판정 필요</span>}
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
                      {sentence ? <ClampedText text={sentence} title={buildJudgementDetail(draftOf(r))} lines={1} /> : <span className="text-[color:var(--muted-fg)]">미판정</span>}
                      {dirty.has(r.id) && <span className="block text-[color:var(--muted-fg)]">저장 전</span>}
                    </td>
                    <td className="text-[length:var(--fs-caption)]">
                      {r.confirmed_at ? <>확정<span className="block text-[color:var(--muted-fg)]">{r.confirmed_by} · {r.confirmed_at.slice(0, 10)}</span></>
                        : r.stale ? "재판정 필요" : r.grade ? "확정 전" : "—"}
                    </td>
                    <td className="text-[length:var(--fs-caption)]">
                      {canEdit
                        ? <button type="button" className="btn-ghost btn-sm" aria-label={`${r.capability} 판정`} onClick={() => setEditingId(r.id)}>판정</button>
                        : judgeHref ? <a href={judgeHref} className="text-[color:var(--accent)] underline" aria-label={`${r.capability} S5에서 판정`}>S5에서 판정</a> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <CapabilityJudgementDialog key={editing.id} row={editing} draft={draftOf(editing)} note={note ? note.value(editing.id) : undefined} s3Href={s3Href}
          hasPrev={neighborId(shownIds, editing.id, -1) !== null} hasNext={neighborId(shownIds, editing.id, 1) !== null}
          onApply={(d, n, nav) => apply(editing, d, n, nav)} onRejudge={() => onSet?.(editing.id, {})} onClose={() => setEditingId(null)} />
      )}
    </>
  );
}
