"use client";

// S5 judgement dialog for one required capability (ADR-0171). Top block = the S3 definition, read-only;
// bottom block = the S5 judgement inputs. 적용 writes to the page draft state (the page-level 초안 저장
// persists); nothing is saved or confirmed here. expected_level_required is only a hint at 적용.
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import {
  ATTAINABILITY_GRADE_LABEL, HELD_STATUS_CHIP, HELD_STATUS_LABEL, NARRATIVE_CAP, NECESSITY_LABEL, NECESSITY_UNSET_LABEL,
  RESOLUTION_EXPECTED_LEVEL_HINT, RESOLUTION_LABEL, type GapResolution,
} from "../../lib/capability-gap.ts";
import type { AttainabilityRowView } from "../../lib/capability-attainability.ts";
import { legacyHoldersCaption } from "./CapabilityHeldDialog.tsx";
import type { JudgementDraft } from "./CapabilityJudgementTable.tsx";

export type DialogNav = "close" | "next" | "prev";

const RESOLUTIONS: GapResolution[] = ["build", "partner", "hire", "invest"];
const GRADE_OPTIONS = [
  { value: "", text: "미판정" }, { value: "high", text: "높음" },
  { value: "medium", text: "중간" }, { value: "low", text: "낮음" },
] as const;
export const RATIONALE_MAX = 600; // mirrors the server cap in lib/capability-attainability.ts
const PREVIEW_LEN = 60;
const levelText = (v: string) => (v.trim() === "" ? <span className="text-[color:var(--muted-fg)]">—</span> : v);

export function CapabilityJudgementDialog({ row, draft, note, s3Href, hasPrev, hasNext, onApply, onRejudge, onClose }: {
  row: AttainabilityRowView;
  draft: JudgementDraft;
  /** Current S5 비고 (saved through the S3 register route); omitted when the page does not show it. */
  note?: string;
  s3Href: string;
  hasPrev: boolean;
  hasNext: boolean;
  onApply: (d: JudgementDraft, note: string | undefined, nav: DialogNav) => void;
  onRejudge: () => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [d, setD] = useState<JudgementDraft>(draft);
  const [noteVal, setNoteVal] = useState(note ?? "");
  const uid = useId();
  useEffect(() => setMounted(true), []);
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  if (!mounted) return null;
  const patch = (p: Partial<JudgementDraft>) => setD((x) => ({ ...x, ...p }));
  const resolution = (d.resolution || null) as GapResolution | null;
  const title = `${row.capability} 판정`;
  const needsExpected = !!resolution && d.expectedLevel.trim() === "";
  const needsRationale = (d.grade === "high" || d.grade === "low") && d.rationale.trim() === "";
  const apply = (nav: DialogNav) => onApply(d, note === undefined ? undefined : noteVal, nav);
  const holders = legacyHoldersCaption(row.held_holders);
  const s3Rows: Array<[string, React.ReactNode]> = [
    ["필요도", row.necessity ? NECESSITY_LABEL[row.necessity] : <span className="text-[color:var(--muted-fg)]">{NECESSITY_UNSET_LABEL}</span>],
    ["필요 수준", levelText(row.required_level)],
    ["보유 판정", <span key="h" className={`status-chip ${HELD_STATUS_CHIP[row.held_status]}`}>{HELD_STATUS_LABEL[row.held_status]}</span>],
    ["보유 수준", levelText(row.current_level)],
    ["보유 근거", levelText(row.held_evidence)],
  ];
  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation" onKeyDown={onKeyDown}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: "44rem", width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2 style={{ fontSize: "0.95rem" }}>{title}</h2></div>

        <section aria-label="S3 정의 (읽기 전용)" className="cap-s3 mt-2 p-2" style={{ background: "var(--muted-bg)", borderRadius: "var(--radius-sm)" }}>
          <h3 className="text-[length:var(--fs-caption)] font-semibold m-0 mb-1"><span aria-hidden="true">🔒</span> S3 정의 (읽기 전용) · <a href={s3Href} className="text-[color:var(--accent)] underline font-normal">S3에서 수정</a></h3>
          <dl className="m-0 grid gap-1 text-[length:var(--fs-caption)]">
            {s3Rows.map(([k, v]) => (
              <div key={k}><dt className="font-semibold inline">{k}: </dt><dd className="inline m-0 whitespace-pre-wrap break-words">{v}</dd></div>
            ))}
          </dl>
          {holders && <p className="m-0 mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="legacy-holders-caption">{holders}</p>}
          {row.stale && (
            <div className="mt-2 text-[length:var(--fs-caption)]" role="status" data-testid="stale-history">
              <span className="status-chip status-amber"><span aria-hidden="true">!</span> S3 변경 — 재판정 필요</span>
              {row.s3_changes.length > 0 ? (
                <ul className="m-0 pl-4 text-[color:var(--muted-fg)]">{row.s3_changes.map((c) => <li key={c.field}>{c.label}: {c.before} → {c.after}</li>)}</ul>
              ) : <span className="block text-[color:var(--muted-fg)]">변경 내용: S3 항목이 바뀌었습니다(상세 비교 없음).</span>}
              <span className="block text-[color:var(--muted-fg)]">
                이전 판정 {row.grade_label}{row.rationale ? ` — ${row.rationale.length > PREVIEW_LEN ? `${row.rationale.slice(0, PREVIEW_LEN)}…` : row.rationale}` : ""} (아래 값에 그대로 채워 두었습니다)
              </span>
              <button type="button" className="btn-ghost btn-sm mt-1" aria-label={`${row.capability} 이전 판정으로 재판정`} onClick={onRejudge}>이전 판정 그대로 재판정</button>
            </div>
          )}
          {!row.stale && row.prior && (
            <p className="m-0 mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="stale-history">
              이전 판정: {row.prior.grade ? ATTAINABILITY_GRADE_LABEL[row.prior.grade] : "미판정"}{row.prior.confirmedBy ? ` (확정 ${row.prior.confirmedBy}, ${(row.prior.confirmedAt ?? "").slice(0, 10)})` : ""} · {row.prior.invalidatedAt.slice(0, 10)} S3 변경으로 무효화
            </p>
          )}
        </section>

        <section aria-label="S5 판정 (입력)" className="mt-3 grid gap-2" style={{ borderLeft: "2px solid var(--accent)", paddingLeft: "0.6rem" }}>
          <h3 className="text-[length:var(--fs-caption)] font-semibold m-0">S5 판정 (입력)</h3>
          <div>
            <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={`${uid}-res`}>해소 방식</label>
            <select id={`${uid}-res`} value={d.resolution} onChange={(e) => patch({ resolution: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "auto" }}>
              <option value="">미정</option>
              {RESOLUTIONS.map((x) => <option key={x} value={x}>{RESOLUTION_LABEL[x]}</option>)}
            </select>
            {resolution && <p className="m-0 mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="expected-level-hint">작성 안내: {RESOLUTION_EXPECTED_LEVEL_HINT[resolution]}</p>}
          </div>
          <div>
            <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={`${uid}-exp`}>기대 수준</label>
            <textarea id={`${uid}-exp`} className="sizing-new-input w-full" rows={4} maxLength={NARRATIVE_CAP} value={d.expectedLevel} onChange={(e) => patch({ expectedLevel: e.target.value })} />
            <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" aria-live="polite">{d.expectedLevel.length} / {NARRATIVE_CAP}자{needsExpected ? " — 확정하려면 기대 수준이 필요합니다." : ""}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={`${uid}-cost`}>비용(백만원)</label>
              <input id={`${uid}-cost`} type="number" min={0} value={d.cost} onChange={(e) => patch({ cost: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "8rem" }} />
            </div>
            <div>
              <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={`${uid}-mon`}>기간(개월)</label>
              <input id={`${uid}-mon`} type="number" min={0} value={d.months} onChange={(e) => patch({ months: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "8rem" }} />
            </div>
          </div>
          <div>
            <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={`${uid}-grade`}>달성 가능성</label>
            <select id={`${uid}-grade`} value={d.grade} onChange={(e) => patch({ grade: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "auto" }}>
              {GRADE_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.text}</option>)}
            </select>
            {row.drafted_by === "ai" && <span className="ml-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">AI 초안</span>}
          </div>
          <div>
            <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={`${uid}-rat`}>
              근거·증빙{(d.grade === "high" || d.grade === "low") && <span className="text-[color:var(--red-fg)]"> (필수 ✕ 높음·낮음은 근거 필요)</span>}
            </label>
            <textarea id={`${uid}-rat`} className="sizing-new-input w-full" rows={6} maxLength={RATIONALE_MAX} value={d.rationale} onChange={(e) => patch({ rationale: e.target.value })} />
            <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" aria-live="polite">{d.rationale.length} / {RATIONALE_MAX}자{needsRationale ? " — 근거를 입력하세요." : ""}</p>
            {row.evidence.length > 0 && (
              <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">기존 증빙<ul className="m-0 pl-4">{row.evidence.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            )}
          </div>
          {note !== undefined && (
            <div>
              <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={`${uid}-note`}>비고</label>
              <input id={`${uid}-note`} className="sizing-new-input w-full" value={noteVal} onChange={(e) => setNoteVal(e.target.value)} />
            </div>
          )}
        </section>

        <div className="flex flex-wrap justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-ghost btn-sm" disabled={!hasPrev} onClick={() => apply("prev")}>이전</button>
          <button type="button" className="btn-ghost btn-sm" disabled={!hasNext} onClick={() => apply("next")}>적용 후 다음</button>
          <button type="button" className="btn-primary btn-sm" onClick={() => apply("close")}>적용</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
