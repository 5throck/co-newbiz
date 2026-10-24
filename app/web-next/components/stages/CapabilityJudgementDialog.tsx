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
import { CATEGORY_LABEL, capabilityDefaultStartYear, capabilityEndYearOf, suggestCategory } from "../../lib/capability-cost-lines.ts";
import { staleChipText } from "../../lib/capability-judgement-view.ts";
import { legacyHoldersCaption } from "./CapabilityHeldDialog.tsx";
import type { AiWiring, JudgementDraft } from "./CapabilityJudgementTable.tsx";
import { JUDGEMENT_FIELD_LABEL, mergeJudgementProposals, type JudgementField, type JudgementProposal } from "../../lib/capability-judgement-ai-merge.ts";
import { useTranslations } from "next-intl";

export type DialogNav = "close" | "next" | "prev";

const RESOLUTIONS: GapResolution[] = ["build", "partner", "hire", "invest"];
// 라벨은 카탈로그 키 — 렌더 시 TranslatorFn으로 푼다.
const GRADE_OPTIONS = [
  { value: "", text: "common.unjudged" }, { value: "high", text: "common.high" },
  { value: "medium", text: "common.medium" }, { value: "low", text: "common.low" },
] as const;
export const RATIONALE_MAX = 600; // mirrors the server cap in lib/capability-attainability.ts
const PREVIEW_LEN = 60;
const levelText = (v: string) => (v.trim() === "" ? <span className="text-[color:var(--muted-fg)]">—</span> : v);

const AI_CHIP_TEXT_KEY = "common.aiDraft";
function AiChip({ field, fields }: { field: JudgementField; fields: JudgementField[] }) {const tc = useTranslations("common");
  if (!fields.includes(field)) return null;
  return <span className="status-chip status-not-started ml-2 font-normal" data-testid={`ai-chip-${field}`}><span aria-hidden="true">✦</span> {tc("aiDraft")}</span>;
}
function BasisLine({ field, fields, text }: { field: JudgementField; fields: JudgementField[]; text: string | undefined }) {const t = useTranslations("components.capabilityJudgement.dialog");
  if (!fields.includes(field) || !text) return null;
  return <p className="m-0 mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid={`ai-basis-${field}`}>{t("aiEvidence")} {text}</p>;
}

export function CapabilityJudgementDialog({ row, draft, note, s3Href, hasPrev, hasNext, onApply, onAiFields, onRejudge, onClose, ai, aiFields: initialAiFields = [], startYear = null, onStartYearChange }: {
  row: AttainabilityRowView;
  draft: JudgementDraft;
  /** Current S5 비고 (saved through the S3 register route); omitted when the page does not show it. */
  note?: string;
  s3Href: string;
  hasPrev: boolean;
  hasNext: boolean;
  onApply: (d: JudgementDraft, note: string | undefined, nav: DialogNav) => void;
  /** Called AFTER onApply with the fields that are still AI drafts, so the page can re-mark them. */
  onAiFields?: (fields: JudgementField[], basis?: JudgementProposal["basis"]) => void;
  /** S5 only: AI proposal wiring and the fields already marked as AI drafts on this row. */
  ai?: AiWiring;
  aiFields?: JudgementField[];
  onRejudge: () => void;
  onClose: () => void;
  /** 2026-10-18 decider ask — the linked spend's start year is editable HERE too.
   *  null = the judgement-months default; the value lands in the cost entry's
   *  startYear override through the parent (saved with the 투자비 저장). */
  startYear?: number | null;
  onStartYearChange?: (v: number | null) => void;
}) {const tr = useTranslations(); const t = useTranslations("components.capabilityJudgement.dialog"); const tc = useTranslations("common");
  const [mounted, setMounted] = useState(false);
  const [d, setD] = useState<JudgementDraft>(draft);
  const [noteVal, setNoteVal] = useState(note ?? "");
  const [aiFields, setAiFields] = useState<JudgementField[]>(initialAiFields);
  const [aiBasis, setAiBasis] = useState<JudgementProposal["basis"] | undefined>(ai?.basis[row.id]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  // Hooks Rules — this must sit ABOVE the `if (!mounted) return null` early return,
  // or the first render skips it and React sees a hook-order change (2026-10-18 live error).
  const [startOverride, setStartOverride] = useState<number | null>(startYear);
  const uid = useId();
  useEffect(() => setMounted(true), []);
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  if (!mounted) return null;
  // A human edit of a field clears its AI draft marker (the value is now the person's).
  const patch = (p: Partial<JudgementDraft>) => {
    setD((x) => ({ ...x, ...p }));
    setAiFields((f) => f.filter((k) => !(k in p)));
  };
  async function proposeThis() {
    if (!ai || aiBusy) return;
    setAiBusy(true); setAiMsg(null);
    try {
      const res = await ai.fetchProposals([row.id]);
      const p = res.drafts[row.id];
      if (!p) { setAiMsg(t("couldNotProposeP1P2", { p1: res.unfilled[row.id] ? ` — ${res.unfilled[row.id]}` : "", p2: res.note })); return; }
      const m = mergeJudgementProposals({ [row.id]: d }, { [row.id]: p });
      const filled = m.marks[row.id] ?? [];
      setD(m.drafts[row.id]);
      setAiFields((f) => [...new Set([...f, ...filled])]);
      setAiBasis((b) => ({ ...(b ?? { resolution: "", expectedLevel: "", cost: "", months: "", grade: "", category: "" }), ...Object.fromEntries(Object.entries(p.basis).filter(([k, v]) => v && (k === "estimate" || (filled as string[]).includes(k)))) }));
      const empties = res.unfilled[row.id];
      setAiMsg(filled.length === 0 ? t("noEmptyCellsToFill", { p1: empties ? ` — ${empties}` : "" }) : t("aiDraftedTheP1CellsP2ReviewEditThenApply", { p1: filled.map((f) => JUDGEMENT_FIELD_LABEL[f]).join(", "), p2: empties ? t("emptyCellsP1", { p1: empties }) : "" }));
    } catch (e) {
      setAiMsg(e instanceof Error ? e.message : t("failedToLoadTheAi"));
    } finally { setAiBusy(false); }
  }
  const resolution = (d.resolution || null) as GapResolution | null;
  const title = t("p1Judgement", { p1: row.capability });
  const needsExpected = !!resolution && d.expectedLevel.trim() === "";
  const needsRationale = (d.grade === "high" || d.grade === "low") && d.rationale.trim() === "";
  const spendMonths = d.months.trim() === "" ? null : Number(d.months);
  const derivedStart = capabilityDefaultStartYear(spendMonths);
  const spendStart = startOverride ?? derivedStart;
  const needsCategory = Number(d.cost) > 0 && !d.category;
  const apply = (nav: DialogNav) => {
    onApply(d, note === undefined ? undefined : noteVal, nav);
    if (aiFields.length > 0) onAiFields?.(aiFields, aiBasis);
  };
  const holders = legacyHoldersCaption(row.held_holders, tr);
  const s3Rows: Array<[string, React.ReactNode]> = [
    [tc("necessity"), row.necessity ? NECESSITY_LABEL[row.necessity] : <span className="text-[color:var(--muted-fg)]">{NECESSITY_UNSET_LABEL}</span>],
    [tc("requiredLevel"), levelText(row.required_level)],
    [tc("heldJudgement"), <span key="h" className={`status-chip ${HELD_STATUS_CHIP[row.held_status]}`}>{HELD_STATUS_LABEL[row.held_status]}</span>],
    [tc("heldLevel"), levelText(row.current_level)],
    [tc("heldEvidence"), levelText(row.held_evidence)],
  ];
  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation" onKeyDown={onKeyDown}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: "44rem", width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2 style={{ fontSize: "0.95rem" }}>{title}</h2></div>

        <section aria-label={t("s3Definition")} className="cap-s3 mt-2 p-2" style={{ background: "var(--muted-bg)", borderRadius: "var(--radius-sm)" }}>
          <h3 className="text-[length:var(--fs-caption)] font-semibold m-0 mb-1"><span aria-hidden="true">🔒</span> {t("s3Definition2")} <a href={s3Href} className="text-[color:var(--accent)] underline font-normal">{t("editInS3")}</a></h3>
          <dl className="m-0 grid gap-1 text-[length:var(--fs-caption)]">
            {s3Rows.map(([k, v]) => (
              <div key={k}><dt className="font-semibold inline">{k}: </dt><dd className="inline m-0 whitespace-pre-wrap break-words">{v}</dd></div>
            ))}
          </dl>
          {holders && <p className="m-0 mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="legacy-holders-caption">{holders}</p>}
          {row.stale && (
            <div className="mt-2 text-[length:var(--fs-caption)]" role="status" data-testid="stale-history">
              <span className="status-chip status-amber"><span aria-hidden="true">!</span> {row.stale_reasons?.length ? staleChipText(row) : t("s3ChangeNeeded")}</span>
              {row.s3_changes.length > 0 ? (
                <ul className="m-0 pl-4 text-[color:var(--muted-fg)]">{row.s3_changes.map((c) => <li key={c.field}>{c.label}: {c.before} → {c.after}</li>)}</ul>
              ) : <span className="block text-[color:var(--muted-fg)]">{(row.stale_reasons ?? []).length > 0 && !(row.stale_reasons ?? []).includes("s3") ? t("whatChangedThisTargetS") : t("whatChangedAnS3Item")}</span>}
              <span className="block text-[color:var(--muted-fg)]">
                {t("previousJudgement")} {row.grade_label}{row.rationale ? ` — ${row.rationale.length > PREVIEW_LEN ? `${row.rationale.slice(0, PREVIEW_LEN)}…` : row.rationale}` : ""} {t("withTheValuesBelow")}
              </span>
              <button type="button" className="btn-ghost btn-sm mt-1" aria-label={t("p1WithThePreviousJudgement", { p1: row.capability })} onClick={onRejudge}>{t("withThePreviousJudgement")}</button>
            </div>
          )}
          {!row.stale && row.prior && (
            <p className="m-0 mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="stale-history">
              {t("previousJudgement2")} {row.prior.grade ? ATTAINABILITY_GRADE_LABEL[row.prior.grade] : tc("unjudged")}{row.prior.confirmedBy ? t("confirmedP1P2", { p1: row.prior.confirmedBy, p2: (row.prior.confirmedAt ?? "").slice(0, 10) }) : ""} · {row.prior.invalidatedAt.slice(0, 10)} {t("invalidatedByS3Change")}
            </p>
          )}
        </section>

        <section aria-label={t("s5JudgementInput")} className="mt-3 grid gap-2" style={{ borderLeft: "var(--border-width-strong) solid var(--accent)", paddingLeft: "0.6rem" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[length:var(--fs-caption)] font-semibold m-0">{t("s5JudgementInput2")}</h3>
            {ai && (
              <button type="button" className="btn-ghost btn-sm" disabled={aiBusy || ai.busy} onClick={() => void proposeThis()} title={t("theAiDraftsOnlyThe")}>
                {aiBusy ? tc("proposing") : t("aiProposalForThisCapability")}
              </button>
            )}
          </div>
          {aiMsg && <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" role="status" data-testid="ai-dialog-msg">{aiMsg}</p>}
          <div>
            <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={`${uid}-res`}>{t("resolutionMethod")}<AiChip field="resolution" fields={aiFields} /></label>
            <select id={`${uid}-res`} value={d.resolution} onChange={(e) => patch({ resolution: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "auto" }}>
              <option value="">{tc("undetermined")}</option>
              {RESOLUTIONS.map((x) => <option key={x} value={x}>{RESOLUTION_LABEL[x]}</option>)}
            </select>
            <BasisLine field="resolution" fields={aiFields} text={aiBasis?.resolution} />
            {resolution && <p className="m-0 mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="expected-level-hint">{t("writingGuide")} {RESOLUTION_EXPECTED_LEVEL_HINT[resolution]}</p>}
          </div>
          <div>
            <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={`${uid}-exp`}>{t("expectedLevel")}<AiChip field="expectedLevel" fields={aiFields} /></label>
            <textarea id={`${uid}-exp`} className="sizing-new-input w-full" rows={4} maxLength={NARRATIVE_CAP} value={d.expectedLevel} onChange={(e) => patch({ expectedLevel: e.target.value })} />
            <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" aria-live="polite">{d.expectedLevel.length} / {NARRATIVE_CAP}{tc("charSuffix")}{needsExpected ? t("expectedLevelIsRequiredTo") : ""}</p>
            <BasisLine field="expectedLevel" fields={aiFields} text={aiBasis?.expectedLevel} />
          </div>
          <fieldset className="m-0 p-2 grid gap-2" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
            <legend className="text-[length:var(--fs-caption)] font-semibold px-1">{t("linkedInvestmentItems")}</legend>
            <div className="flex flex-wrap gap-3">
              <div>
                <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={`${uid}-cat`}>{tc("classification")}<AiChip field="category" fields={aiFields} /></label>
                <select id={`${uid}-cat`} value={d.category} onChange={(e) => patch({ category: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "auto" }} data-testid="judge-category">
                  <option value="">{tc("undetermined")}</option>
                  {(["labor", "opex", "capex"] as const).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                </select>
                {needsCategory && <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]" aria-live="polite" data-testid="judge-category-required">{t("classificationIsRequiredToConfirm")}</p>}
                <BasisLine field="category" fields={aiFields} text={aiBasis?.category} />
              </div>
              <div>
                <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={`${uid}-cost`}>{t("amountPerCycleKrwMillions")}<AiChip field="cost" fields={aiFields} /></label>
                <input id={`${uid}-cost`} type="number" min={0} value={d.cost} onChange={(e) => patch({ cost: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "8rem" }} />
              </div>
              <div>
                <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={`${uid}-period`}>{tc("cycle")}</label>
                <select
                  id={`${uid}-period`}
                  value={d.period || "yearly"}
                  data-testid="judge-period"
                  onChange={(e) => patch({ period: e.target.value })}
                  className="sizing-new-input sizing-new-input-sm"
                  style={{ width: "auto" }}
                >
                  <option value="yearly">{t("annual")}</option>
                  <option value="monthly">{t("monthly")}</option>
                  <option value="quarterly">{tc("quarter")}</option>
                  <option value="lumpsum">{t("lumpSumTotal")}</option>
                </select>
                <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("theAmountIsPerThe")}</p>
              </div>
              <div>
                <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={`${uid}-start`}>{t("startYear")}</label>
                <input
                  id={`${uid}-start`}
                  type="number"
                  min={1}
                  value={spendStart}
                  data-testid="judge-start-year"
                  disabled={onStartYearChange === undefined}
                  /* 포커스 순간 표시값을 override로 고정한다 — 기간(개월)을 나중에
                     바꿔도 사람이 입력한 시작 연차가 기본값으로 덮이지 않는다
                     (2026-10-18 decider report: "1연차 입력 후 36개월 입력 시 3으로 변경"). */
                  onFocus={() => { if (startOverride === null) setStartOverride(spendStart); }}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const v = raw === "" || !Number.isFinite(Number(raw)) ? null : Math.max(1, Math.floor(Number(raw)));
                    setStartOverride(v);
                    onStartYearChange?.(v);
                  }}
                  className="sizing-new-input sizing-new-input-sm"
                  style={{ width: "6rem" }}
                />
                <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("theDefaultDerivesFromThe")}</p>
              </div>
              <div>
                <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={`${uid}-mon`}>{t("durationMonths")}<AiChip field="months" fields={aiFields} /></label>
                <input id={`${uid}-mon`} type="number" min={0} value={d.months} onChange={(e) => patch({ months: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "8rem" }} />
                <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" aria-live="polite">{t("endYear")} {capabilityEndYearOf(spendStart, spendMonths)}{tc("tenure")}</p>
              </div>
              {(() => {
                // 2026-10-18 decider ask — 주기당 금액 모델의 총액 가시화 (2026-10-19 decider UI 개선).
                const mult = d.period === "monthly" ? 12 : d.period === "quarterly" ? 4 : d.period === "lumpsum" ? 1 : 1;
                const windowYears = Math.max(1, capabilityEndYearOf(spendStart, spendMonths) - spendStart + 1);
                const total = Number(d.cost) > 0 && spendMonths !== null && spendMonths > 0
                  ? (d.period === "lumpsum" ? Number(d.cost) : Number(d.cost) * mult * windowYears)
                  : null;
                if (total === null) return null;
                return (
                  <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" aria-live="polite" data-testid="judge-total-krw">
                    {t("totalOverTheExecutionPeriod")} {total.toLocaleString("ko-KR")}{t("krwMillions")}{d.period === "lumpsum" ? t("lumpSum") : t("p1PerCycleWindowP2", { p1: Number(d.cost), p2: windowYears })})
                  </p>
                );
              })()}
            </div>
          </fieldset>
          {(aiFields.includes("cost") || aiFields.includes("months")) && (
            <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="ai-basis-estimate">
              {t("aiEstimate")}{aiBasis?.estimate ? t("assumptionP1", { p1: aiBasis.estimate }) : ""}{aiFields.includes("cost") && aiBasis?.cost ? t("costEvidenceP1", { p1: aiBasis.cost }) : ""}{aiFields.includes("months") && aiBasis?.months ? t("durationEvidenceP1", { p1: aiBasis.months }) : ""}
            </p>
          )}
          <div>
            <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={`${uid}-grade`}>{t("attainability")}<AiChip field="grade" fields={aiFields} /></label>
            <select id={`${uid}-grade`} value={d.grade} onChange={(e) => patch({ grade: e.target.value })} className="sizing-new-input sizing-new-input-sm" style={{ width: "auto" }}>
              {GRADE_OPTIONS.map((g) => <option key={g.value} value={g.value}>{tc(g.text)}</option>)}
            </select>
            {row.drafted_by === "ai" && <span className="ml-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("aiDraft")}</span>}
            <BasisLine field="grade" fields={aiFields} text={aiBasis?.grade} />
          </div>
          <div>
            <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={`${uid}-rat`}>
              {t("evidenceAndDocumentation")}{(d.grade === "high" || d.grade === "low") && <span className="text-[color:var(--red-fg)]"> {t("requiredHighAndLowNeed")}</span>}<AiChip field="rationale" fields={aiFields} />
            </label>
            <textarea id={`${uid}-rat`} className="sizing-new-input w-full" rows={6} maxLength={RATIONALE_MAX} value={d.rationale} onChange={(e) => patch({ rationale: e.target.value })} />
            <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" aria-live="polite">{d.rationale.length} / {RATIONALE_MAX}{tc("charSuffix")}{needsRationale ? t("enterEvidence") : ""}</p>
            {row.evidence.length > 0 && (
              <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">{t("existingDocumentation")}<ul className="m-0 pl-4">{row.evidence.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            )}
          </div>
          {note !== undefined && (
            <div>
              <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={`${uid}-note`}>{tc("notes")}</label>
              <input id={`${uid}-note`} className="sizing-new-input w-full" value={noteVal} onChange={(e) => setNoteVal(e.target.value)} />
            </div>
          )}
        </section>

        <div className="flex flex-wrap justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{tc("cancel")}</button>
          <button type="button" className="btn-ghost btn-sm" disabled={!hasPrev} onClick={() => apply("prev")}>{t("previous")}</button>
          <button type="button" className="btn-ghost btn-sm" disabled={!hasNext} onClick={() => apply("next")}>{t("nextAfterApplying")}</button>
          <button type="button" className="btn-primary btn-sm" onClick={() => apply("close")}>{tc("apply")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
