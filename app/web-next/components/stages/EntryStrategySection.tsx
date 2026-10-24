"use client";

// S5 "진출전략" (ADR-0171 amendment 2026-10-15 (2)): four selectable entry modes (multi-select, exactly one main),
// ONE rationale textarea and ONE optional textarea for considered-but-rejected alternatives, a muted caution when a
// capability's 해소 방식 is not among the selected modes (decision support, never a gate), and the secondary action
// "진출전략 제안 (AI)" that fills EMPTY parts only as unsaved drafts. GreenfieldStage owns the values and the save;
// this component owns only the AI marks/notes. Read-only for users without canAct (the parent fieldset is disabled).
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import { useTranslations } from "next-intl";
import {
  ENTRY_AI_FIELD_LABEL, ENTRY_ALTERNATIVES_CAP, ENTRY_MODES, ENTRY_MODE_HINT, ENTRY_MODE_LABEL, ENTRY_RATIONALE_CAP,
  cautionText, mergeEntryProposal, normalizeModes, strategyMismatches, toggleMode,
  type CautionRow, type EntryAiField, type EntryFormState, type EntryMode, type EntryStrategyProposal,
} from "../../lib/greenfield-entry-strategy.ts";

interface DraftResponse { proposal: EntryStrategyProposal | null; source: "llm" | "synthesis"; note: string }

export interface EntryStrategySaveUi {
  /** Unsaved changes (human edits or AI drafts) in this section. */
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  /** Short success note, e.g. "저장됨 · 14:05". */
  note: string | null;
  error: string | null;
  onDismissNote: () => void;
}

export function EntryStrategySection({ opportunityId, value, onChange, canAct, rows, resetKey, save }: {
  opportunityId: string;
  value: EntryFormState;
  /** Every change (human edit or AI draft) goes through here so the page can keep unsaved text across refetches. */
  onChange: (next: EntryFormState) => void;
  canAct: boolean;
  /** Judgement 해소 방식 per capability (attainability rows already loaded on the page). */
  rows: CautionRow[];
  /** Changes when the page saved or switched opportunity: AI drafts are no longer "unsaved". */
  resetKey: number;
  /** Own save of ONLY the strategy fields (modes, main, rationale, alternatives). */
  save?: EntryStrategySaveUi;
}) {const t = useTranslations("stages.s5.entryStrategy"); const tc = useTranslations("common");
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marks, setMarks] = useState<EntryAiField[]>([]);
  const [info, setInfo] = useState<{ proposal: EntryStrategyProposal } | null>(null);
  const valueRef = useRef(value); valueRef.current = value;
  const marksRef = useRef(marks); marksRef.current = marks;

  useEffect(() => { setMarks([]); setInfo(null); setNote(null); setError(null); }, [resetKey]);

  const clearMark = (f: EntryAiField) => setMarks((m) => m.filter((x) => x !== f));
  const mismatches = strategyMismatches(value.modes, rows);
  const main = value.modes.main;

  function pickMode(mode: EntryMode) { clearMark("modes"); onChange({ ...value, modes: toggleMode(value.modes, mode) }); }
  function pickMain(mode: EntryMode) { clearMark("modes"); onChange({ ...value, modes: normalizeModes(value.modes.modes, mode) }); }

  async function propose() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const res = await api.post<DraftResponse>(`/api/greenfield/${encodeURIComponent(opportunityId)}/entry-strategy-draft`, {});
      const { proposal, note: n } = res.data;
      setNote(n);
      if (!proposal) return;
      // Merge against the latest committed values (the person may have typed while the request ran).
      const merged = mergeEntryProposal(valueRef.current, proposal);
      if (merged.marks.length > 0) {
        onChange(merged.state);
        setMarks((prev) => [...new Set([...prev, ...merged.marks])]);
        setInfo({ proposal });
      } else {
        setNote(t("p1CellsWereKeptAnd", { p1: n }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("entryStrategyProposalFailed"));
    } finally {
      setBusy(false);
    }
  }

  // Only fields still marked (= not edited since) are reverted; they were empty before the proposal.
  function discard() {
    const next: EntryFormState = { ...valueRef.current };
    for (const f of marksRef.current) {
      if (f === "modes") next.modes = { modes: [], main: null };
      else if (f === "rationale") next.rationale = "";
      else next.alternatives = "";
    }
    onChange(next);
    setMarks([]); setInfo(null);
  }

  const aiChip = (f: EntryAiField) => marks.includes(f)
    ? <span className="status-chip status-not-started" data-testid={`entry-ai-chip-${f}`} title={t("aiDraftUnsavedP1A", { p1: ENTRY_AI_FIELD_LABEL[f] })}><span aria-hidden="true">✦</span> {tc("aiDraft")}</span>
    : null;
  const basisLine = (f: EntryAiField, text: string | undefined) => marks.includes(f) && text
    ? <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1" data-testid={`entry-ai-basis-${f}`}>{t("aiEvidence")} {text}</p>
    : null;
  const modeReasons = info && marks.includes("modes")
    ? info.proposal.modes.map((m) => t("p1P2P3", { p1: ENTRY_MODE_LABEL[m.mode], p2: m.main ? t("wks") : "", p3: m.reason })).join(" / ")
    : undefined;

  return (
    <div className="mb-3" data-testid="entry-strategy-section">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h3 className="text-[length:var(--fs-body)] mb-0">{t("entryStrategy")}</h3>
        {marks.length > 0 && (
          <span className="flex items-center gap-1" data-testid="entry-ai-unsaved">
            <span className="status-chip status-not-started" role="status"><span aria-hidden="true">✦</span> {tc("unsavedAiDraft")} {marks.length}{tc("countUnit")}</span>
            {canAct && <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={discard}>{tc("discardAiDraft")}</button>}
          </span>
        )}
        {canAct && (
          <button type="button" className="btn-ghost btn-sm ml-auto" disabled={busy} onClick={() => void propose()}
            title={t("theAiDraftsTheEmpty")}>
            {busy ? tc("proposing") : t("entryStrategyProposalAi")}
          </button>
        )}
      </div>
      {note && (
        <div className="legacy-model-notice mb-2 flex items-start justify-between gap-2" role="status" data-testid="entry-ai-note">
          <p className="legacy-model-notice-text">{note}</p>
          <button type="button" className="btn-ghost btn-sm" aria-label={t("closeAiProposalResult")} onClick={() => setNote(null)}>{tc("close")}</button>
        </div>
      )}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-1">{error}</p>}

      <div className="flex items-center gap-2 mb-1">
        <span id={`${uid}-modes`} className="text-[length:var(--fs-caption)] font-semibold">{t("entryModeSelectionMultipleAllowed")}</span>
        {aiChip("modes")}
      </div>
      <div role="group" aria-labelledby={`${uid}-modes`} className="flex flex-wrap gap-2 mb-1">
        {ENTRY_MODES.map((m) => {
          const on = value.modes.modes.includes(m);
          return (
            <div key={m} className="sizing-grade-card" style={{ minWidth: 190, flex: "1 1 190px" /* design-token-exempt: layout-tuned card flex-basis (one-off) */ }} data-testid={`entry-mode-${m}`}>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={on} onChange={() => pickMode(m)} aria-describedby={`${uid}-${m}-hint`} />
                <span className="font-semibold">{ENTRY_MODE_LABEL[m]}</span>
                {on && <span className="status-chip status-green" data-testid={`entry-selected-${m}`}><span aria-hidden="true">✓</span> {tc("select")}</span>}
              </label>
              <p id={`${uid}-${m}-hint`} className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{ENTRY_MODE_HINT[m]}</p>
              {on && (
                <label className="flex items-center gap-1 text-[length:var(--fs-caption)]">
                  <input type="radio" name={`${uid}-main`} checked={main === m} disabled={value.modes.modes.length === 1} onChange={() => pickMain(m)} />
                  <span>{t("primaryMode")}{main === m ? t("current") : ""}</span>
                </label>
              )}
            </div>
          );
        })}
      </div>
      {basisLine("modes", modeReasons)}
      {basisLine("modes", info?.proposal.basis.modes)}

      <div className="flex items-center gap-2 mt-2 mb-1">
        <label htmlFor={`${uid}-rationale`} className="text-[length:var(--fs-caption)] font-semibold">{t("selectionEvidence")}</label>
        {aiChip("rationale")}
        <span className="ml-auto text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="entry-rationale-count">{value.rationale.length}/{ENTRY_RATIONALE_CAP}</span>
      </div>
      <textarea
        id={`${uid}-rationale`}
        aria-label={t("selectionEvidence2")}
        value={value.rationale}
        maxLength={ENTRY_RATIONALE_CAP}
        onChange={(e) => { clearMark("rationale"); onChange({ ...value, rationale: e.target.value }); }}
        rows={3}
        placeholder={t("whyThisModeWasChosen")}
        className="sizing-new-input mb-1"
        style={{ width: "100%" }}
      />
      {basisLine("rationale", [info?.proposal.basis.rationale, info?.proposal.basis.assumption ? t("keyAssumptionP1", { p1: info.proposal.basis.assumption }) : ""].filter(Boolean).join(" · "))}

      <div className="flex items-center gap-2 mt-1 mb-1">
        <label htmlFor={`${uid}-alt`} className="text-[length:var(--fs-caption)] font-semibold">{t("alternativesConsideredButNotChosen")}</label>
        {aiChip("alternatives")}
        <span className="ml-auto text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="entry-alternatives-count">{value.alternatives.length}/{ENTRY_ALTERNATIVES_CAP}</span>
      </div>
      <textarea
        id={`${uid}-alt`}
        aria-label={t("alternativesConsideredButNotChosen2")}
        value={value.alternatives}
        maxLength={ENTRY_ALTERNATIVES_CAP}
        onChange={(e) => { clearMark("alternatives"); onChange({ ...value, alternatives: e.target.value }); }}
        rows={2}
        className="sizing-new-input mb-1"
        style={{ width: "100%" }}
      />
      {basisLine("alternatives", info?.proposal.basis.alternatives)}

      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
        {t("theResolutionMethodJudgementsBelow")}
      </p>
      {mismatches.length > 0 && (
        <p className="mb-1" data-testid="entry-mismatch">
          <span className="status-chip status-not-started" role="status"><span aria-hidden="true">⚠</span> {cautionText(mismatches)}</span>
        </p>
      )}
      {save && canAct && (
        <div className="flex flex-wrap items-center gap-2 mt-2" data-testid="entry-save-actions">
          <button type="button" className={save.dirty ? "btn-primary btn-sm" : "btn-ghost btn-sm"} disabled={!save.dirty || save.saving} aria-describedby={`${uid}-save-hint`} onClick={save.onSave}>
            {save.saving ? t("item") : t("saveEntryStrategy")}
          </button>
          {save.dirty && <span className="status-chip status-amber" role="status" data-testid="entry-dirty"><span aria-hidden="true">!</span> {tc("unsavedChanges")}</span>}
          {!save.dirty && <span id={`${uid}-save-hint`} className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noChangesToSave")}</span>}
          {save.note && (
            <span className="flex items-center gap-1" role="status" data-testid="entry-save-note">
              <span className="status-chip status-green"><span aria-hidden="true">✓</span> {save.note}</span>
              <button type="button" className="btn-ghost btn-sm" aria-label={t("closeSaveResult")} onClick={save.onDismissNote}>{tc("close")}</button>
            </span>
          )}
          {save.error && <span role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)]" data-testid="entry-save-error">{save.error}</span>}
        </div>
      )}
      {info && info.proposal.cautions.length > 0 && marks.length > 0 && (
        <ul className="sizing-note-list text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1" data-testid="entry-ai-cautions">
          {info.proposal.cautions.map((c, i) => <li key={i}><span aria-hidden="true">⚠</span> {t("aiCaution")} {c}</li>)}
        </ul>
      )}
    </div>
  );
}
