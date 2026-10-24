"use client";

// S9 brownfield scope summary (ADR-0162; design 2026-10-12-brownfield-dd-workspace-scope-by-subtrack, task row 4).
// Compact: sub-track, the single "Judged X / Y" line (with the excluded and extra-checklist counts shown
// beside it, never mixed in), and the workspace-scope opt-in as a SECONDARY action. Judging happens only in
// the tabs. The panel renders nothing for m_and_a, a null sub-track and grandfathered projects that are not
// eligible to opt in. The server owns the selection (dd GET `brownfield_scope`) and the preview
// (GET .../brownfield-scope/workspace-opt-in); this component only displays them and forwards the human act.
// There is no greenfield-style step-to-tab panel in v1 (design Q6).

import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import { REPLACED_JUDGED_HELP, optInPreviewLines, validateMigrationNote, type WsDomainLike } from "../../lib/greenfield-dd-view.ts";
import { useTranslations } from "next-intl";
import { resolveLabelTokens } from "../../lib/label-keys.ts";
import {
  bfCanOfferOptIn, bfOptInExtrasLines, type BfOptInPreview, bfCountAnnouncement, bfJudgedLine, bfScopeBlock, bfScopeErrorText, bfSubTrackName, type BfScopeBlock,
} from "../../lib/brownfield-dd-view.ts";

export function BrownfieldScopePanel({ projectId, block, domains, canAct, previewEnabled, onChanged }: {
  projectId: string;
  /** `brownfield_scope` of the dd payload; absent for m_and_a, null sub-track and grandfathered projects. */
  block: BfScopeBlock | null | undefined;
  domains: WsDomainLike[];
  canAct: boolean;
  /** Only the gate scope of a brownfield-or-unknown route asks the server whether an opt-in is possible. */
  previewEnabled: boolean;
  onChanged: () => void;
}) {
  const tr = useTranslations();const t = useTranslations("stages.s9.brownfieldScope"); const tc = useTranslations("common");
  const active = bfScopeBlock(block);
  const [preview, setPreview] = useState<BfOptInPreview | null>(null);
  const [optOpen, setOptOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const optBase = `/api/projects/${encodeURIComponent(projectId)}/brownfield-scope/workspace-opt-in`;

  // Read-only preview (nothing is written). Not requested once the scoped view is active.
  useEffect(() => {
    if (active || !previewEnabled) { setPreview(null); return; }
    let live = true;
    api.get<{ preview: BfOptInPreview }>(optBase)
      .then((r) => { if (live) setPreview(r.data.preview); })
      .catch(() => { if (live) setPreview(null); });
    return () => { live = false; };
  }, [active, previewEnabled, optBase]);

  const offer = bfCanOfferOptIn(block, preview);
  if (!active && !offer && !notice) return null; // exactly today's screen

  const line = bfJudgedLine(active, domains);

  return (
    <section className="market-section sizing-step mb-3" aria-label={t("brownfieldScopeSummary")} data-testid="bf-scope-panel">
      <h3 className="sizing-step-title text-[length:var(--fs-body)]">
        {t("scopeSummary")}{active ? ` — ${resolveLabelTokens(bfSubTrackName(active.sub_track), tr)}` : ""} {/* INTERIM-WORDING */}
      </h3>

      {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-2">✓ {notice}</p>}

      {line && (
        <p className="mt-1 text-[length:var(--fs-body)]" data-testid="bf-judged-line">
          <span role="status" aria-live="polite" aria-atomic="true">
            <strong className="tabular-nums">{line.text}</strong>
            <span className="ml-3">{t("requiredCriteriaNotMet")} <span className="tabular-nums">{line.mandatoryUnmet}</span>{tc("countUnit")}</span> {/* INTERIM-WORDING */}
            <span className="ml-3">{t("excludedByTrackRule")} <span className="tabular-nums" data-testid="bf-excluded-count">{line.excluded}</span>{tc("countUnit")}</span> {/* INTERIM-WORDING */}
            <span className="sr-only">{bfCountAnnouncement(line)}</span>
          </span>
          {line.replacedCount > 0 && (
            <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="bf-replaced-help">{REPLACED_JUDGED_HELP}</span>
          )}
          {(line.extra || line.extrasExcluded > 0) && (
            <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="bf-extra-line">
              {line.extra ? t("additionalChecklistJudgedP1P2", { p1: line.extra.judged, p2: line.extra.judgeable }) : t("additionalChecklist")}
              {line.extrasExcluded > 0 ? t("excludedByTrackRulesP1", { p1: line.extrasExcluded }) : ""} {t("countedSeparatelyFromTheRow")} {/* INTERIM-WORDING */}
            </span>
          )}
        </p>
      )}

      {!active && offer && preview && (
        <div data-testid="bf-optin">
          <p className="text-[length:var(--fs-caption)] mb-1">
            {t("thisProjectStartedBeforeThe")} {/* INTERIM-WORDING */}
          </p>
          {canAct ? (
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOptOpen(true)}>{t("preview")}</button>
          ) : (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("onlyAPersonWithThe")}</p>
          )}
        </div>
      )}

      {optOpen && preview && (
        <BrownfieldOptInDialog
          preview={preview}
          optBase={optBase}
          onClose={() => setOptOpen(false)}
          onDone={() => { setOptOpen(false); setNotice(t("switchedToTheNewWork")); onChanged(); }}
        />
      )}
    </section>
  );
}

/** Opt-in dialog: server preview (before / after, moved judgements, fails that stay unmet), then a required migration_note. Nothing is written before the person confirms. */
function BrownfieldOptInDialog({ preview, optBase, onClose, onDone }: {
  preview: BfOptInPreview;
  optBase: string;
  onClose: () => void;
  onDone: () => void;
}) {const t = useTranslations("stages.s9.brownfieldScope"); const tc = useTranslations("common");
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = validateMigrationNote(note);
  async function submit() {
    setTouched(true);
    if (problem || saving) return;
    setSaving(true); setError(null);
    try {
      await api.post(optBase, { migration_note: note.trim() });
      onDone();
    } catch (e) {
      setError(bfScopeErrorText((e as { code?: string } | null)?.code, (e as { status?: number } | null)?.status, e instanceof Error ? e.message : ""));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={onKeyDown} onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="bf-optin-title" style={{ maxWidth: "40rem", width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3 id="bf-optin-title" className="text-[1rem] font-semibold mb-1">{t("switchToTheNewWork")}</h3> {/* INTERIM-WORDING */}
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("theFollowingIsAPreview")}</p>
        <ul className="sizing-note-list mb-3" data-testid="bf-optin-preview">
          {[...optInPreviewLines(preview), ...bfOptInExtrasLines(preview)].map((l) => <li key={l}>{l}</li>)}
        </ul>
        <label className="text-[length:var(--fs-caption)] block" htmlFor="bf-optin-note">{t("transitionReasonRequired")}</label>
        <textarea
          id="bf-optin-note"
          className="sizing-new-input mt-1 w-full"
          rows={3}
          value={note}
          maxLength={2000}
          required
          aria-required="true"
          aria-invalid={touched && !!problem}
          aria-describedby="bf-optin-error"
          onChange={(e) => setNote(e.target.value)}
        />
        <p id="bf-optin-error" role="alert" aria-live="assertive" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1 min-h-[1.25rem]">
          {error ? `✕ ${error}` : touched && problem ? `✕ ${problem}` : ""}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2 mt-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{tc("cancel")}</button>
          <button type="button" className="btn-premium btn-sm" disabled={saving} onClick={() => void submit()}>{saving ? tc("recording") : t("transitionRecord")}</button>
        </div>
      </div>
    </div>
  );
}
