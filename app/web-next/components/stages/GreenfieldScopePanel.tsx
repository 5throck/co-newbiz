"use client";

// S9 greenfield scope summary (ADR-0160 + addenda; design 2026-10-12 section 6A). Judging happens only in
// the tabs below; this panel is a compact summary: sub-track, the people/organization plan readiness (what
// matters most for greenfield; the link to its tab is the main navigation), the human-only site_required
// confirmation as a compact secondary row (no primary button here), the workspace-scope opt-in with its
// before/after preview, warnings, and the single "judged X / Y" line for RBD / IV. The server owns the selection
// (GET /api/projects/:id/greenfield-scope); this component only displays it and forwards human acts.

import { useEffect, useId, useState } from "react";
import { api } from "../../lib/api.ts";
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import { useTranslations } from "next-intl";
import { resolveLabelTokens } from "../../lib/label-keys.ts";
import {
  canOfferWorkspaceOptIn,
  countAnnouncement,
  countLocation,
  judgedLine,
  optInPreviewLines,
  outOfScopeSteps,
  peoplePlanView,
  showSubTrackPanel,
  siteDisclosureLabel,
  splitScopeWarnings,
  siteControlState,
  subTrackName,
  validateMigrationNote,
  validateSiteForm,
  workspaceView,
  type GfScope,
  type OptInPreviewLike,
  type WsDomainLike,
  scopeErrorText,
  siteFormMissing,
  REPLACED_JUDGED_HELP,
} from "../../lib/greenfield-dd-view.ts";

export function GreenfieldScopePanel({ projectId, scope, domains, meUserId, canAct, onChanged, onSelectTab }: {
  projectId: string;
  scope: GfScope;
  /** Domain tabs of the S9 payload; the judged line counts from them so numerator and denominator agree. */
  domains: WsDomainLike[];
  meUserId: string | null;
  canAct: boolean;
  onChanged: () => void;
  /** Selects a domain tab of the S9 payload by index (the people/organization link). */
  onSelectTab?: (index: number) => void;
}) {const tr = useTranslations(); const t = useTranslations("stages.s9.greenfieldScope"); const tc = useTranslations("common");
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [value, setValue] = useState<boolean | null>(null);
  const [rationale, setRationale] = useState("");
  const [touched, setTouched] = useState(false);
  const [preview, setPreview] = useState<OptInPreviewLike | null>(null);
  const [optOpen, setOptOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);

  const base = `/api/projects/${encodeURIComponent(projectId)}/greenfield-scope`;
  const optBase = `${base}/workspace-opt-in`;
  const named = scope.sub_track_class === "existing_business_rbd" || scope.sub_track_class === "intra_venture";
  const wsActive = !!workspaceView(scope);

  // Read-only preview of the opt-in (nothing is written); only while the new workspace scope is not active.
  useEffect(() => {
    if (!named || wsActive) { setPreview(null); return; }
    let live = true;
    api.get<{ preview: OptInPreviewLike }>(optBase)
      .then((r) => { if (live) setPreview(r.data.preview); })
      .catch(() => { if (live) setPreview(null); });
    return () => { live = false; };
  }, [named, wsActive, optBase, scope.opted_in]);

  // The null sub-track keeps the legacy view; only an unknown-value warning would still need to show.
  if (!showSubTrackPanel(scope)) return null;

  const site = siteControlState(scope, meUserId);
  const siteProblem = validateSiteForm({ value, rationale });
  const siteMissing = siteFormMissing({ value, rationale });
  const line = countLocation(scope) === "panel" ? judgedLine(scope, domains) : null;
  const outSteps = outOfScopeSteps(scope);
  const people = named ? peoplePlanView(scope, domains) : null;
  const { notes, warnings } = splitScopeWarnings(scope.warnings);
  // One primary action per view: this panel has none (the tabs own it); the site confirmation is secondary.

  async function act(body: Record<string, unknown>, success: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.post(base, body);
      setNotice(success);
      setTouched(false);
      setSiteOpen(false);
      onChanged();
      return true;
    } catch (e) {
      setError(scopeErrorText((e as { code?: string } | null)?.code, (e as { status?: number } | null)?.status, e instanceof Error ? e.message : ""));
    } finally {
      setBusy(false);
    }
    return false;
  }

  return (
    <section className="market-section sizing-step mb-3" aria-label={t("greenfieldScopeSummary")} data-testid="gf-scope-panel">
      <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("scopeSummary")} {resolveLabelTokens(subTrackName(scope), tr)}</h3> {/* INTERIM-WORDING */}

      {people && (
        <div role="group" aria-labelledby={`${uid}-people`} className="mb-2" data-testid="gf-people-plan">
          <p id={`${uid}-people`} className="mb-1"><strong>{people.heading}</strong></p> {/* INTERIM-WORDING */}
          <p className="text-[length:var(--fs-body)]">
            {people.tabIndex !== null && onSelectTab ? (
              <a href="#dd-tab-hr" data-testid="gf-people-link" onClick={(e) => { e.preventDefault(); onSelectTab(people.tabIndex!); }}>{resolveLabelTokens(people.tabLabel, tr)} {t("judgeInTheTab")}</a>
            ) : (
              <strong>{resolveLabelTokens(people.tabLabel, tr)}</strong>
            )}
            {" "}<span className="tabular-nums" data-testid="gf-people-judged">{tc("judgement")} {people.judged} / {people.judgeable}</span>
            {people.reference && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]"> {t("referenceValueExcludedFromCompletion")}</span>} {/* INTERIM-WORDING */}
          </p>
          {people.steps.length > 0 && (
            <ul className="text-[length:var(--fs-caption)] mt-1" data-testid="gf-people-steps">
              {people.steps.map((st) => (
                <li key={st.step}>
                  {st.step}{tc("stage")} {resolveLabelTokens(st.label, tr)}: <span className="status-chip status-not-started"><span aria-hidden="true">{st.icon} </span>{st.text}</span>
                  {st.detail && <span className="text-[color:var(--muted-fg)]"> — {st.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <ul role="status" className="mb-2" data-testid="gf-scope-warnings">
          {warnings.map((w) => (
            <li key={w} className="status-chip status-amber block mb-1"><span aria-hidden="true">⚠ </span>{w}</li>
          ))}
        </ul>
      )}

      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
      {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-2">✓ {notice}</p>}

      {named && (
        <div role="group" aria-labelledby={`${uid}-site`} className="text-[length:var(--fs-caption)] mt-1" data-testid="gf-site-required">
          <p id={`${uid}-site`} className="mb-1">
            <span className={`status-chip ${site.kind === "confirmed" ? "status-green" : site.kind === "unconfirmed" ? "status-info" : "status-not-started"}`}>
              <span aria-hidden="true">{site.icon} </span>
              {site.kind === "confirmed" || site.kind === "default" ? t("siteP1", { p1: site.text }) : site.text}
            </span>
          </p>
          {site.kind === "unconfirmed" && notes.length > 0 && (
            <ul role="note" className="mb-1 text-[color:var(--muted-fg)]" data-testid="gf-scope-notes">
              {notes.map((n) => <li key={n}><span aria-hidden="true">ⓘ </span>{n}</li>)}
            </ul>
          )}

          {canAct ? (
            <details open={siteOpen} onToggle={(e) => setSiteOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid="gf-site-disclosure">
              <summary className="cursor-pointer" style={{ minHeight: "2.75rem" }}>{siteDisclosureLabel(site.kind)}</summary>
              <form
                aria-label={t("checkSiteRequirement")} /* INTERIM-WORDING: success notice says the confirmation applies immediately */
                onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!siteProblem) void act({ action: "confirm_site_required", site_required: value, rationale: rationale.trim() }, t("siteRequirementCheckRecordedApplied")).then((ok) => { if (ok) { setValue(null); setRationale(""); } }); }}
              >
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="text-[length:var(--fs-caption)] font-semibold mb-1">{t("doesThisPlanNeedA")}</legend>
                  <div role="radiogroup" className="flex flex-wrap gap-3 text-[length:var(--fs-caption)]">
                    <label className="flex items-center gap-1" style={{ minHeight: "2.75rem" }}>
                      <input type="radio" name={`${uid}-site-value`} checked={value === true} onChange={() => setValue(true)} /> {t("neededSiteStageApplies")}
                    </label>
                    <label className="flex items-center gap-1" style={{ minHeight: "2.75rem" }}>
                      <input type="radio" name={`${uid}-site-value`} checked={value === false} onChange={() => setValue(false)} /> {t("notNeededSiteStageExcluded")}
                    </label>
                  </div>
                </fieldset>
                <div className="flex flex-wrap items-end gap-2 mt-1 text-[length:var(--fs-caption)]">
                  <label htmlFor={`${uid}-why`}>{t("confirmationEvidenceRequired")}
                    <input id={`${uid}-why`} className="sizing-new-input ml-1" style={{ minWidth: "16rem" }} value={rationale} aria-invalid={touched && !rationale.trim()} onChange={(e) => setRationale(e.target.value)} />
                  </label>
                  <button type="submit" className="btn-ghost btn-sm" disabled={busy || siteMissing.length > 0} aria-describedby={`${uid}-missing`}>{t("checkSiteRequirement2")}</button>
                </div>
                <p id={`${uid}-missing`} role="note" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
                  {t("onlyAPersonCanConfirm")} {/* INTERIM-WORDING */}
                  {siteMissing.length > 0 ? t("enterTheseBeforeUsingThe", { p1: siteMissing.join(", ") }) : t("inputCompletePressTheConfirm")} {/* INTERIM-WORDING */}
                </p>
                {touched && siteProblem && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1">✕ {siteProblem}</p>}
              </form>
            </details>
          ) : (
            <p className="text-[color:var(--muted-fg)]">{t("onlyAPersonWithThe")}</p>
          )}
        </div>
      )}

      {outSteps.length > 0 && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2" data-testid="gf-out-of-scope">
          <strong>{t("steps")}</strong>{" "} {/* INTERIM-WORDING */}
          {outSteps.map((s) => t("stepP1P2", { p1: s.step, p2: resolveLabelTokens(s.label, tr) })).join(", ")} {t("theReasonIsVisibleIn")}
        </p>
      )}

      {line && (
        <p className="mt-2 text-[length:var(--fs-body)]" data-testid="gf-judged-line">
          <span role="status" aria-live="polite" aria-atomic="true">
            <strong className="tabular-nums">{line.text}</strong>
            <span className="ml-3">{t("requiredCriteriaNotMet")} <span className="tabular-nums">{line.mandatoryUnmet}</span>{tc("countUnit")}</span> {/* INTERIM-WORDING */}
            <span className="ml-3">{t("excludedByTrackRule")} <span className="tabular-nums">{line.excluded}</span>{tc("countUnit")}</span> {/* INTERIM-WORDING */}
            <span className="sr-only">{countAnnouncement(line)}</span>
          </span>
          {line.replacedCount > 0 && (
            <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="gf-replaced-help">{REPLACED_JUDGED_HELP}</span>
          )}
          {line.extra && (
            <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("additionalChecklistJudgementRBd")} {line.extra.judged} / {line.extra.judgeable} {t("countedSeparatelyFromTheRow")} {/* INTERIM-WORDING */}
            </span>
          )}
        </p>
      )}

      {named && !wsActive && canOfferWorkspaceOptIn(preview) && (
        <div className="mt-3" data-testid="gf-optin">
          <p className="text-[length:var(--fs-caption)] mb-1">
            {t("thisProjectStartedBeforeThe")} {/* INTERIM-WORDING */}
          </p>
          {canAct ? (
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setOptOpen(true)}>{t("preview")}</button>
          ) : (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("onlyAPersonWithThe2")}</p>
          )}
        </div>
      )}

      {optOpen && preview && (
        <WorkspaceOptInDialog
          preview={preview}
          optBase={optBase}
          onClose={() => setOptOpen(false)}
          onDone={() => { setOptOpen(false); setNotice(t("switchedToTheNewWork")); onChanged(); }}
        />
      )}
    </section>
  );
}

/** Opt-in dialog: shows the server preview (before / after), then a required migration_note. A person confirms; nothing is written before. */
function WorkspaceOptInDialog({ preview, optBase, onClose, onDone }: {
  preview: OptInPreviewLike;
  optBase: string;
  onClose: () => void;
  onDone: () => void;
}) {const t = useTranslations("stages.s9.greenfieldScope"); const tc = useTranslations("common");
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
      setError(scopeErrorText((e as { code?: string } | null)?.code, (e as { status?: number } | null)?.status, e instanceof Error ? e.message : ""));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={onKeyDown} onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="gf-optin-title" style={{ maxWidth: "40rem", width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3 id="gf-optin-title" className="text-[1rem] font-semibold mb-1">{t("switchToTheNewWork")}</h3> {/* INTERIM-WORDING */}
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("theFollowingIsAPreview")}</p>
        <ul className="sizing-note-list mb-3" data-testid="gf-optin-preview">
          {optInPreviewLines(preview).map((l) => <li key={l}>{l}</li>)}
        </ul>
        <label className="text-[length:var(--fs-caption)] block" htmlFor="gf-optin-note">{t("transitionReasonRequired")}</label>
        <textarea
          id="gf-optin-note"
          className="sizing-new-input mt-1 w-full"
          rows={3}
          value={note}
          maxLength={2000}
          required
          aria-required="true"
          aria-invalid={touched && !!problem}
          aria-describedby="gf-optin-error"
          onChange={(e) => setNote(e.target.value)}
        />
        <p id="gf-optin-error" role="alert" aria-live="assertive" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1 min-h-[1.25rem]">
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
