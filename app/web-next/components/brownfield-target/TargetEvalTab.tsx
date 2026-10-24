"use client";

// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition).
// 2026-10-20 decider: verdict/weight edits are LOCAL until the person presses the category's
// 저장 button (explicit save instead of save-on-change); the score chip shows judged/total items.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { isFinancialDataRef, parseRubric, rubricFields } from "../../lib/brownfield-financial-rubric.ts";
import { EVAL_CATEGORY_KEY, VERDICT_KEY, EVAL_VERDICTS } from "./constants.ts";
import type { TargetDetailViewState } from "./useTargetActions.ts";
import type { EvalItem, EvalCategoryScore } from "./types.ts";

export function TargetEvalTab({ ctx, evalItems, scores, scoreChip, pendingFinancial, proposedCount, pendingTechnical }: { ctx: TargetDetailViewState; evalItems: EvalItem[]; scores: Record<"financial" | "technical", EvalCategoryScore> & { combined: number | null; }; scoreChip: (score: number | null) => string; pendingFinancial: EvalItem[]; proposedCount: number; pendingTechnical: EvalItem[] }) {
  const t = useTranslations("components.brownfieldTarget.evalTab");
  const tk = useTranslations("components.brownfieldTarget.constants");
  const tc = useTranslations("common");
  const { detail, loadDetail, profileTab, canAct, draftBusy, draftCategory, evalDraft, busy, setEvalDraft, setDraftCategory, setDraftNote, rubricOpen, setRubricOpen, draftNote, evalBusy, rubricBusy, newCriterionLabel, setNewCriterionLabel, generateEvalDraft, saveDraftVerdicts, setEvalWeight, setEvalVerdict, removeEvalCriterion, saveRubric, addEvalCriterion } = ctx;
  void detail; void loadDetail;
  type EvalStatusValue = "pending" | "pass" | "partial" | "fail" | "na" | "waived";
  type PendingEdit = { status?: EvalStatusValue; weight?: number; note?: string };
  const [pending, setPending] = useState<Record<string, PendingEdit>>({});
  const [savingCat, setSavingCat] = useState<"financial" | "technical" | null>(null);
  const editPending = (id: string, patch: PendingEdit) => setPending((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const discardCategory = (ids: string[]) => setPending((prev) => { const next = { ...prev }; for (const id of ids) delete next[id]; return next; });
  async function saveCategory(cat: "financial" | "technical", items: EvalItem[]) {
    const targets = items.filter((it) => pending[it.id]);
    if (targets.length === 0) return;
    setSavingCat(cat);
    try {
      for (const it of targets) {
        const p = pending[it.id];
        if (p.weight !== undefined && p.weight > 0 && p.weight !== it.weight) await setEvalWeight(it.id, p.weight);
        if (p.status !== undefined && p.status !== (it.state?.status ?? "pending")) await setEvalVerdict(it.id, p.status, p.note);
      }
      discardCategory(targets.map((t) => t.id));
      // a saved verdict supersedes any AI draft still shown on the row
      setEvalDraft((prev) => { if (!prev) return prev; const next = { ...prev }; for (const t of targets) delete next[t.id]; return next; });
    } finally {
      setSavingCat(null);
    }
  }
  return (
    <>{profileTab === "eval" && (
          <div className="mt-3">
            {(["financial", "technical"] as const).map((cat) => {
              const items = evalItems.filter((it) => it.category === cat);
              const catScore = scores[cat];
              const judgedCount = items.filter((it) => ["pass", "partial", "fail"].includes(it.state?.status ?? "pending")).length;
              const countedTotal = items.filter((it) => !["na", "waived"].includes(it.state?.status ?? "pending")).length;
              const catPending = items.filter((it) => pending[it.id]);
              return (
                <div key={cat} className="card mb-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h4 className="text-[length:var(--fs-body)] mb-0">{tk(EVAL_CATEGORY_KEY[cat])}</h4>
                    <span className={scoreChip(catScore.score)} title={t("scoreChipTitle")} data-testid={`eval-score-${cat}`}>
                      {catScore.score == null ? t("scorePending") : t("scoreOf100", { p1: catScore.score })}
                      <span className="ml-1 font-normal">{t("judgedCountLabel", { p1: judgedCount, p2: countedTotal })}</span>
                    </span>
                  </div>
                  {catScore.totalWeight > catScore.scoredWeight && (
                    <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                      {t("unscoredWeights", { p1: catScore.totalWeight - catScore.scoredWeight, p2: catScore.totalWeight })}
                    </p>
                  )}
                  {canAct && cat === "financial" && (
                    <div className="flex flex-wrap items-center gap-1 mb-2">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={draftBusy || pendingFinancial.length === 0}
                        title={t("financialDraftTitle")}
                        onClick={() => void generateEvalDraft("financial")}
                      >
                        {draftBusy && draftCategory === "financial" ? t("calculating") : t("financialDraftButton")}
                      </button>
                      {evalDraft && draftCategory === "financial" && (
                        <>
                          <button
                            type="button"
                            className="btn-premium btn-sm"
                            disabled={busy || proposedCount === 0}
                            title={t("saveDraftTitle")}
                            onClick={() => void saveDraftVerdicts()}
                          >
                            {t("saveDraftButton", { p1: proposedCount })}
                          </button>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => { setEvalDraft(null); setDraftCategory(null); setDraftNote(null); }}>{t("discardDraftButton")}</button>
                        </>
                      )}
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        aria-expanded={rubricOpen}
                        title={t("rubricTitle")}
                        onClick={() => setRubricOpen(!rubricOpen)}
                      >
                        {rubricOpen ? t("thresholdClose") : t("thresholdEdit")}
                      </button>
                      {draftCategory !== "technical" && (
                        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] flex-1 min-w-[16rem]">
                          {draftNote ?? t("financialDraftNote")}
                        </span>
                      )}
                    </div>
                  )}
                  {canAct && cat === "technical" && (
                    <div className="flex flex-wrap items-center gap-1 mb-2">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={draftBusy || pendingTechnical.length === 0}
                        title={t("technicalDraftTitle")}
                        onClick={() => void generateEvalDraft("technical")}
                      >
                        {draftBusy && draftCategory === "technical" ? t("collecting") : t("technicalDraftButton")}
                      </button>
                      {evalDraft && draftCategory === "technical" && (
                        <>
                          <button
                            type="button"
                            className="btn-premium btn-sm"
                            disabled={busy || proposedCount === 0}
                            title={t("saveDraftTitle")}
                            onClick={() => void saveDraftVerdicts()}
                          >
                            {t("saveDraftButton", { p1: proposedCount })}
                          </button>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => { setEvalDraft(null); setDraftCategory(null); setDraftNote(null); }}>{t("discardDraftButton")}</button>
                        </>
                      )}
                      {draftCategory === "technical" ? (
                        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] flex-1 min-w-[16rem]">{draftNote}</span>
                      ) : (
                        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] flex-1 min-w-[16rem]">
                          {t("technicalDraftNote")}
                        </span>
                      )}
                    </div>
                  )}
                  {items.length === 0 ? (
                    <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                      {cat === "technical" ? t("emptyTechnical") : t("emptyFinancial")}
                    </p>
                  ) : (
                    <ul className="sizing-note-list mb-2" style={{ fontSize: "0.88rem" }}>
                      {items.map((it) => {
                        const draft = evalDraft?.[it.id];
                        return (
                          <li key={it.id} className="flex flex-wrap items-start gap-2">
                            <span className="flex-1 min-w-[14rem]">
                              {it.label}
                              {it.description && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{it.description}</span>}
                            </span>
                            {it.is_mandatory === 1 && <span className="status-chip status-amber">{it.source === "seeded" ? t("seededMandatory") : t("mandatory")}</span>}
                            {!canAct ? (
                              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" title={t("weightTitle")}>{t("weightLabel", { p1: it.weight })}</span>
                            ) : (
                            <label className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] flex items-center gap-1" title={t("weightTitle")}>
                              {t("weightWord")}
                              <input
                                type="number" min={1} step={1}
                                aria-label={t("weightAria", { p1: it.label })}
                                value={pending[it.id]?.weight ?? it.weight}
                                disabled={evalBusy === it.id || savingCat !== null}
                                onChange={(e) => {
                                  const v = Number(e.target.value);
                                  if (Number.isFinite(v)) editPending(it.id, { weight: v });
                                }}
                                className="sizing-new-input sizing-new-input-sm"
                                style={{ width: "4rem" }}
                              />
                            </label>
                            )}
                            {!canAct ? (
                              <span className="status-chip status-not-started" aria-label={t("verdictAria", { p1: it.label })}>{tk(VERDICT_KEY[it.state?.status ?? "pending"] ?? "verdictPending")}</span>
                            ) : (
                            <select
                              aria-label={t("verdictAria", { p1: it.label })}
                              value={pending[it.id]?.status ?? draft?.status ?? it.state?.status ?? "pending"}
                              disabled={evalBusy === it.id || savingCat !== null}
                              onChange={(e) => {
                                const v = e.target.value as EvalStatusValue;
                                // local until the category 저장 button; a visible AI draft's note rides along at save time
                                editPending(it.id, { status: v, note: draft ? draft.note : undefined });
                              }}
                              className={`sizing-new-input sizing-new-input-sm${pending[it.id]?.status !== undefined ? " ring-1" : ""}`}
                            >
                              <option value="pending">{tk("verdictPending")}</option>
                              {EVAL_VERDICTS.map((v) => (
                                <option key={v} value={v}>{tk(VERDICT_KEY[v])}</option>
                              ))}
                            </select>
                            )}
                            {canAct && it.is_deletable === 1 && (
                              <button type="button" className="btn-ghost btn-sm" disabled={evalBusy === it.id} title={t("deleteItemTitle")} onClick={() => void removeEvalCriterion(it.id)}>✕</button>
                            )}
                            {draft && (
                              <div className="w-full mt-1 flex flex-col gap-1">
                                <div className="flex flex-wrap items-center gap-1">
                                  {draft.status ? (
                                    <span className="status-chip status-amber" title={t("autoDraftTitle")}>{t("autoDraftChip")}</span>
                                  ) : (
                                    <span className="status-chip status-not-started" title={t("unverifiedTitle")}>{t("unverifiedChip")}</span>
                                  )}
                                  {draft.metrics.map((m) => (
                                    <span key={m.label} className="status-chip status-not-started" title={m.label}>{m.label} {m.value}</span>
                                  ))}
                                </div>
                                {!draft.status && draft.reason && (
                                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{draft.reason}</p>
                                )}
                                <input
                                  aria-label={t("draftNoteAria", { p1: it.label })}
                                  value={draft.note}
                                  placeholder={t("draftNotePlaceholder")}
                                  onChange={(e) => setEvalDraft((prev) => (prev ? { ...prev, [it.id]: { ...prev[it.id], note: e.target.value } } : prev))}
                                  className="sizing-new-input sizing-new-input-sm"
                                />
                              </div>
                            )}
                            {rubricOpen && it.category === "financial" && it.source === "builtin" && isFinancialDataRef(it.data_ref) && (() => {
                              const rubric = parseRubric(it.data_ref, it.rubric_json);
                              return (
                                <div key={`${it.id}:${it.rubric_json ?? "default"}`} className="w-full mt-1 flex flex-wrap items-center gap-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                  <span>{t("thresholdPrefix")}</span>
                                  {rubricFields(it.data_ref).map((f) => (
                                    <label key={f.key} className="flex items-center gap-1" title={f.hint}>
                                      {f.label}
                                      <input
                                        type="number" min={f.min} max={f.max} step={f.step}
                                        defaultValue={rubric[f.key]}
                                        disabled={rubricBusy === it.id}
                                        onBlur={(e) => {
                                          const v = Number(e.target.value);
                                          if (Number.isFinite(v) && v >= f.min && v <= f.max && v !== rubric[f.key]) void saveRubric(it.id, { [f.key]: v });
                                        }}
                                        className="sizing-new-input sizing-new-input-sm"
                                        style={{ width: "5rem" }}
                                        aria-label={`${it.label} ${f.label}`}
                                      />
                                      {f.unit}
                                    </label>
                                  ))}
                                </div>
                              );
                            })()}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {/* 2026-10-20 decider: the per-target 필요 역량 점검 (judgement table with 처리할 것/전체)
                      left S7 — at S6/S7 the technical evaluation is the criteria above, scored from the
                      candidates' three-year disclosures, AI profile and web search; whether the chosen
                      target actually closes the S3 gaps is verified in S9 (capability-dd). S7 and S9
                      are not linked. */}
                  {canAct && (<div className="flex items-center gap-1">
                    <input
                      aria-label={t("addItemAria", { p1: tk(EVAL_CATEGORY_KEY[cat]) })}
                      placeholder={t("addItemPlaceholder")}
                      value={newCriterionLabel[cat] ?? ""}
                      onChange={(e) => setNewCriterionLabel((prev) => ({ ...prev, [cat]: e.target.value }))}
                      className="sizing-new-input sizing-new-input-sm"
                      style={{ flex: "1 1 12rem" }}
                    />
                    <button type="button" className="btn-ghost btn-sm" disabled={evalBusy === cat || !(newCriterionLabel[cat] ?? "").trim()} onClick={() => void addEvalCriterion(cat)}>{tc("add")}</button>
                  </div>)}
                  {/* 2026-10-20 decider: explicit save lives at the BOTTOM-RIGHT of the category, after the items. */}
                  {canAct && (
                    <div className="flex flex-wrap items-center justify-end gap-1 mt-2" data-testid={`eval-save-bar-${cat}`}>
                      {catPending.length > 0 && (
                        <>
                          <span className="status-chip status-amber">{t("pendingChanges", { p1: catPending.length })}</span>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => discardCategory(catPending.map((it) => it.id))}>{t("discardChanges")}</button>
                        </>
                      )}
                      <button type="button" className="btn-premium btn-sm" disabled={catPending.length === 0 || savingCat !== null} onClick={() => void saveCategory(cat, items)} data-testid={`eval-save-${cat}`}>
                        {savingCat === cat ? t("savingEllipsis") : t("saveCategoryButton", { p1: tk(EVAL_CATEGORY_KEY[cat]) })}{catPending.length > 0 ? t("saveCategoryCountSuffix", { p1: catPending.length }) : ""}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}</>
  );
}
