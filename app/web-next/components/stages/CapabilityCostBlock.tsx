import { useTranslations } from "next-intl";
// S5 investment section, capability part (ADR-0173 slice 1, Proposed): the read-only block
// "역량 해소 비용 (S5 판정에서 연동)" with a per-line "투자비에 반영" checkbox, the totals, the
// double-count warnings and the read-only milestone candidate list. Presentational and hook-free:
// GreenfieldStage owns the state. Amounts follow the judgement; the person only decides whether
// a line is reflected and which category it carries. Decision support, never a gate.
import {
  CAPABILITY_BLOCK_TITLE, CATEGORY_LABEL, MILESTONE_BLOCK_TITLE, MILESTONE_START_NOTE, formatKrwM,
  type CapabilityCostLine, type LineSaveState, type CostCategory, type DuplicateWarning, type InvestmentTotals, type MilestoneCandidateView, type OrphanCapabilityEntry,
} from "../../lib/capability-cost-lines.ts";

export interface ReflectionUi {
  states: Record<string, LineSaveState>;
  dirty: boolean;
  saving: boolean;
  onReflect: () => void;
  note: string | null;
  error: string | null;
  onDismissNote: () => void;
  /** Saved (persisted) reflection: count and 백만원 sum, for the downstream line. */
  saved: { count: number; krwM: number };
  /** True when the opportunity is already promoted to a project. */
  promoted: boolean;
}

export function CapabilityCostBlock({ lines, orphans, totals, warnings, candidates, canAct, onToggle, onCategory, onDismiss, reflection }: {
  lines: CapabilityCostLine[];
  orphans: OrphanCapabilityEntry[];
  totals: InvestmentTotals;
  warnings: DuplicateWarning[];
  candidates: MilestoneCandidateView[];
  canAct: boolean;
  onToggle: (capabilityKey: string, reflected: boolean) => void;
  onCategory: (capabilityKey: string, category: CostCategory) => void;
  onDismiss: (w: DuplicateWarning) => void;
  reflection?: ReflectionUi;
}) {const tr = useTranslations(); const t = useTranslations("stages.s5.capabilityCost"); const tc = useTranslations("common");
  const r = reflection;
  const reflectDisabledReason = !canAct ? t("requiresTheAnalystRole") : r?.saving ? tc("savingPolite") : r && !r.dirty ? t("noSelectionsDifferFromThe") : null;
  return (
    <>
      <div className="sizing-grade-card mb-3" role="group" aria-label={CAPABILITY_BLOCK_TITLE}>
        <h4 className="text-[length:var(--fs-caption)] mb-1">{CAPABILITY_BLOCK_TITLE}</h4>
        <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          {t("amountsComeFromTheS5")}
        </p>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("amountUnitKrwMillions")}</p>
        {r && canAct && (
          <div className="flex flex-wrap items-center gap-2 mb-2" data-testid="reflect-actions">
            <button type="button" className={r.dirty ? "btn-primary btn-sm" : "btn-ghost btn-sm"} disabled={reflectDisabledReason !== null} aria-describedby="cap-reflect-hint" onClick={r.onReflect}>
              {r.saving ? t("item") : t("reflectTheSelectedCostsInto")}
            </button>
            {r.dirty && <span className="status-chip status-amber" role="status"><span aria-hidden="true">!</span> {tc("unsavedChanges")}</span>}
            {reflectDisabledReason && <span id="cap-reflect-hint" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{reflectDisabledReason}</span>}
          </div>
        )}
        {r?.note && (
          <div className="legacy-model-notice mb-2 flex items-start justify-between gap-2" role="status" data-testid="reflect-note">
            <p className="legacy-model-notice-text">{r.note}</p>
            <button type="button" className="btn-ghost btn-sm" aria-label={t("closeReflectionResult")} onClick={r.onDismissNote}>{tc("close")}</button>
          </div>
        )}
        {r?.error && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2" data-testid="reflect-error">{r.error}</p>}
        {lines.length === 0 ? (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("noCapabilitiesHaveAResolution")}</p>
        ) : (
          <ul className="sizing-note-list mb-2">
            {lines.map((l) => {
              const hintId = `cap-cost-hint-${l.capabilityKey}`;
              const disabled = !canAct || (!l.reflected && l.disabledReason !== null);
              return (
                <li key={l.capabilityKey} className="flex flex-wrap items-center gap-2 mb-1">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={l.reflected}
                      disabled={disabled}
                      aria-label={t("reflectP1IntoInvestment", { p1: l.name })}
                      aria-describedby={l.disabledReason && !l.reflected ? hintId : undefined}
                      onChange={(e) => onToggle(l.capabilityKey, e.target.checked)}
                    />
                    <span className="text-[length:var(--fs-caption)]">{t("reflectIntoInvestment")}</span>
                  </label>
                  <span className="font-semibold">{l.name}</span>
                  <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("resolutionMethod")} {l.resolutionLabel}</span>
                  <span className="font-semibold">{formatKrwM(l.costKrwM)}</span>
                  <select
                    aria-label={t("p1ClassificationLaborOpexCapex", { p1: l.name })}
                    title={t("planCategoriesReflectedNotJust")}
                    value={l.category}
                    disabled={!canAct}
                    onChange={(e) => onCategory(l.capabilityKey, e.target.value as CostCategory)}
                    className="sizing-new-input sizing-new-input-sm"
                  >
                    {(Object.keys(CATEGORY_LABEL) as CostCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                  </select>
                  <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("timeToAttain")} {l.monthsToAttain !== null ? t("p1Mo", { p1: l.monthsToAttain }) : tc("notEntered")}</span>
                  <span className={`status-chip ${l.state === "reflectable" ? "status-green" : "status-not-started"}`}>{l.stateLabel}</span>
                  {r?.states[l.capabilityKey] === "saved" && <span className="status-chip status-green" data-testid={`reflect-saved-${l.capabilityKey}`}><span aria-hidden="true">✓</span> {t("reflectedSaved")}</span>}
                  {r?.states[l.capabilityKey] === "unsaved" && <span className="status-chip status-amber" data-testid={`reflect-unsaved-${l.capabilityKey}`}><span aria-hidden="true">!</span> {tc("unsaved")}</span>}
                  {l.needsRejudge && <span className="status-chip status-amber">{tc("rejudgeNeeded")}</span>}
                  {l.amountChanged && <span className="status-chip status-amber">{t("amountChangedPrevious")} {l.previousAmountKrwM !== null ? formatKrwM(l.previousAmountKrwM) : "-"})</span>}
                  {l.categoryHint && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{l.categoryHint}</span>}
                  {l.alternativeCategory && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("ifMostOfTheCost")} {CATEGORY_LABEL[l.alternativeCategory]}</span>}
                  {l.disabledReason && !l.reflected && <span id={hintId} className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{l.disabledReason}</span>}
                </li>
              );
            })}
          </ul>
        )}
        {orphans.length > 0 && (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg, var(--accent))] mb-2">
            {t("capabilitiesDeletedOrNoLonger")} {orphans.length}{t("itemSDropOutOf")} {orphans.map((o) => o.line || o.capabilityKey).join(", ")}
          </p>
        )}
        <p className="text-[length:var(--fs-caption)] mb-1" role="status">
          {t("capabilityResolutionCostTotal")} <b>{formatKrwM(totals.capabilityKrwM)}</b>
          {" · "}{t("reflectedTotal")} <b>{formatKrwM(totals.reflectedKrwM)}</b> ({totals.reflectedCount}{tc("countUnit")}{totals.needsRejudgeCount > 0 ? t("includedNeededP1", { p1: totals.needsRejudgeCount }) : ""})
          {r?.dirty && <span className="text-[color:var(--muted-fg)]" data-testid="reflect-totals-note"> {t("unsavedChangesSavedReflection")} {r.saved.count}{t("itemS")} {formatKrwM(r.saved.krwM)})</span>}
        </p>
        <p className="text-[length:var(--fs-caption)] mb-1" role="status">
          {t("manuallyEnteredTotal")} <b>{formatKrwM(totals.manualKrwM)}</b> {t("krwLumpSum")} {formatKrwM(totals.manualLumpsumKrwM)} {t("iterationsReviewPeriod")} {formatKrwM(totals.manualRecurringKrwM)}{t("excludingRevenueAndGovernmentR")}{totals.manualExcludedNonKrw > 0 ? t("excludingP1ItemS", { p1: totals.manualExcludedNonKrw }) : ""}{totals.manualExcludedNeedsConfirm > 0 ? t("excludingP1ItemSNeeding", { p1: totals.manualExcludedNeedsConfirm }) : ""})
          {" · "}{t("investmentReviewTotal")} <b>{formatKrwM(totals.grandKrwM)}</b>
        </p>
        {r && (r.promoted ? (
          <p className="mb-0" data-testid="reflect-promoted"><span className="status-chip status-amber" role="status"><span aria-hidden="true">!</span> {t("projectAlreadyPromotedS5Changes")}</span></p>
        ) : r.saved.count > 0 ? (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0" data-testid="reflect-downstream">{t("s8BusinessCaseInputReflected")} {r.saved.count}{t("itemSTotal")} {formatKrwM(r.saved.krwM)}{t("isCopiedIntoTheInvestment")}</p>
        ) : null)}
      </div>

      {warnings.map((w) => (
        <div key={`${w.capabilityKey}:${w.manualIndex}`} role="alert" className="flex flex-wrap items-center gap-2 mb-2 text-[length:var(--fs-caption)] text-[color:var(--amber-fg, var(--accent))]">
          <span>
            {t("possibleDuplicateManualItem")}{w.manualLine}{t("mapsToTheCapabilityResolution")}{w.capabilityName}{t("and")} {w.reason === "sub_category" ? t("sharesTheSo") : ""}{t("mayBeTheSameItem")}
          </span>
          {canAct && <button type="button" className="btn-ghost btn-sm" onClick={() => onDismiss(w)}>{t("keepManualItems")}</button>}
        </div>
      ))}

      <div className="sizing-grade-card mb-3" role="group" aria-label={MILESTONE_BLOCK_TITLE}>
        <h4 className="text-[length:var(--fs-caption)] mb-1">{MILESTONE_BLOCK_TITLE}</h4>
        {candidates.length === 0 ? (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{t("noCapabilitiesHaveAEntered")}</p>
        ) : (
          <ul className="sizing-note-list mb-1">
            {candidates.map((c) => (
              <li key={c.rowId} className="flex flex-wrap items-center gap-2 mb-1">
                <span className="font-semibold">{c.name}</span>
                <span>{c.months}{t("mo")}</span>
                {c.stale && <span className="status-chip status-amber">{tc("rejudgeNeeded")}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">{t("candidate")} {MILESTONE_START_NOTE}</p>
      </div>
    </>
  );
}
