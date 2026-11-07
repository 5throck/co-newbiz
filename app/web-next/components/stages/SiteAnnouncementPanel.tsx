"use client";

// S5 "부지 발표 · 인프라 계획 확정" (ADR-0194 item B, design 2026-11-07-kill-data-sources §4.6): a person records when the
// site was first announced (per announcement kind) and whether, and as of which document date, the infrastructure plan was
// finalized. Kill criterion #5 (infrastructure_plan_not_finalized_at_site_announcement) compares the plan's date with the
// EARLIEST live announcement. Human recording only (boundary #2): no AI suggestion, date or answer is ever pre-filled here -
// the forms start empty, no date defaults to today, and the only value they can load is the person's own earlier entry.
// The effective date is "the date of the finalized plan document", never the recording time. The review of the plan
// assertion is a separate human act by a DIFFERENT person. The screen keeps one primary action (the evaluation record on the
// review tab); every record/review button here is secondary (ghost).
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, ApiError } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { ColGroup } from "../ui.tsx";
import { formatDateTime } from "../../lib/format.ts";
import {
  EMPTY_ANNOUNCEMENT_FORM, EMPTY_PLAN_FORM, EVIDENCE_MAX, RATIONALE_MAX, SITE_ANNOUNCEMENT_PANEL_ID, PLAN_VAR_KEY,
  announcementFormFromRow, announcementKindRows, buildAnnouncementBody, buildPlanBody, evidenceHref, killDataErrorKind, killFiveStatus,
  livePlanRow, planAnswerOf, planEvidenceRequired, planHistoryRows, planReviewState, reviewAvailability, seoulToday, showsEffectiveOn,
  validateAnnouncementForm, validatePlanForm,
  type AnnouncementForm, type AnnouncementProblem, type DimensionInputData, type DimensionInputRow, type KillDataErrorKind,
  type MissingPart, type PlanForm, type PlanProblem, type SiteAnnouncementData, type SiteAnnouncementRow,
} from "../../lib/site-announcement-view.ts";

const T = "stages.s5.siteAnnouncementPanel";
const COL_PCT_EDIT = [22, 14, 24, 28, 12] as const;
const COL_PCT_READ = [24, 14, 28, 34] as const;

export type LoadErrorKind = "viewer" | "admin" | "notFound" | "other";

/** Announcement kind labels. */
export function useAnnouncementKindLabel() {
  const t = useTranslations(T);
  return (kind: string): string => {
    switch (kind) {
      case "board_resolution": return t("kind.board_resolution");
      case "public_announcement": return t("kind.public_announcement");
      case "mou_signing": return t("kind.mou_signing");
      case "regulatory_filing": return t("kind.regulatory_filing");
      default: return kind;
    }
  };
}

/** Evidence citation: an https reference becomes a link, any other citation stays plain text. */
function Evidence({ value }: { value: string }) {
  const t = useTranslations(T);
  const href = evidenceHref(value);
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline break-all">{value}<span className="sr-only"> {t("opensNewTab")}</span></a>
    : <span className="break-all">{value}</span>;
}

function ReviewChip({ state }: { state: "pending" | "reviewed" }) {
  const t = useTranslations(T);
  return state === "reviewed"
    ? <span className="status-chip status-green"><span aria-hidden="true">✓</span> {t("reviewed")}</span>
    : <span className="status-chip status-amber"><span aria-hidden="true">○</span> {t("reviewPending")}</span>;
}

export interface AnnounceBlock {
  form: AnnouncementForm;
  onForm: (next: AnnouncementForm) => void;
  onSubmit: () => void;
  onEdit: (row: SiteAnnouncementRow) => void;
  busy: boolean;
  problem: AnnouncementProblem | null;
  serverError: string | null;
  notice: string | null;
  loadedFromRow: boolean;
}

export interface PlanBlock {
  form: PlanForm;
  onForm: (next: PlanForm) => void;
  onSubmit: () => void;
  busy: boolean;
  problem: PlanProblem | null;
  serverError: string | null;
  notice: string | null;
  onReview: (row: DimensionInputRow) => void;
  reviewBusy: boolean;
  reviewError: string | null;
  reviewNotice: string | null;
}

export interface SiteAnnouncementPanelViewProps {
  announcements: SiteAnnouncementData | null;
  announcementsError: LoadErrorKind | null;
  plan: DimensionInputData | null;
  planError: LoadErrorKind | null;
  canAct: boolean;
  /** Signed-in user id: the review button is offered only to someone other than the asserter. */
  meId: string | null;
  /** Latest selectable date (Asia/Seoul today). */
  today: string;
  announce: AnnounceBlock;
  planBlock: PlanBlock;
}

function StatusLine({ earliest, plan }: { earliest: string | null; plan: DimensionInputRow | null }) {
  const t = useTranslations(T);
  const status = killFiveStatus(earliest, plan);
  if (status.kind === "unassessed") {
    const missing = status.missing.map((m: MissingPart) => t(`missing.${m}` as never)).join(", ");
    return (
      <p role="status" className="status-chip status-not-started mb-2" style={{ whiteSpace: "normal" }} data-testid="site-announcement-status" data-status="unassessed">
        <span aria-hidden="true">○</span> {t("statusUnassessed", { missing })}
      </p>
    );
  }
  if (status.kind === "clean") {
    return (
      <p role="status" className="status-chip status-green mb-2" style={{ whiteSpace: "normal" }} data-testid="site-announcement-status" data-status="clean">
        <span aria-hidden="true">✓</span> {t("statusClean", { plan: status.planOn, announced: status.announcedOn })}
      </p>
    );
  }
  return (
    <p role="alert" className="status-chip status-amber mb-2" style={{ whiteSpace: "normal" }} data-testid="site-announcement-status" data-status="triggered" data-reason={status.reason}>
      <span aria-hidden="true">⚠</span>{" "}
      {status.reason === "plan_after_announcement"
        ? t("statusTriggeredAfter", { plan: status.planOn, announced: status.announcedOn })
        : t("statusTriggeredNotFinalized", { announced: status.announcedOn })}
    </p>
  );
}

function LoadError({ kind, testid }: { kind: LoadErrorKind; testid: string }) {
  const t = useTranslations(T);
  return (
    <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2" data-testid={testid}>
      <span aria-hidden="true">✕</span> {t(`loadError.${kind}` as never)}
    </p>
  );
}

function AnnouncementSection(p: { data: SiteAnnouncementData; canAct: boolean; today: string; announce: AnnounceBlock }) {
  const t = useTranslations(T);
  const tc = useTranslations("common");
  const locale = useLocale();
  const label = useAnnouncementKindLabel();
  const uid = useId().replace(/:/g, "");
  const { data, announce: a } = p;
  const rows = announcementKindRows(data);
  const history = data.history;
  const problemText = a.problem ? (t as (k: string, v?: Record<string, number>) => string)(`announceProblem.${a.problem}`, { max: EVIDENCE_MAX }) : null;

  return (
    <section aria-labelledby={`${uid}-h`} className="mt-3" data-testid="site-announcement-card">
      <h3 id={`${uid}-h`} className="text-[length:var(--fs-body)] mb-1">{t("announceTitle")}</h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("announceLead")}</p>
      <p role="status" className="text-[length:var(--fs-caption)] mb-2" data-testid="site-announcement-earliest-line">
        {data.earliest_announced_on
          ? <><span aria-hidden="true">★</span> {t("earliestLine", { date: data.earliest_announced_on })}</>
          : <><span aria-hidden="true">○</span> {t("noAnnouncementYet")}</>}
      </p>

      <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
        <table className="data-table report-table table-fixed-pct tmin-64" aria-label={t("announceTableLabel")}>
          <caption className="sr-only">{t("announceTableCaption")}</caption>
          <ColGroup widths={p.canAct ? COL_PCT_EDIT : COL_PCT_READ} />
          <thead>
            <tr>
              <th scope="col">{t("colKind")}</th>
              <th scope="col">{t("colDate")}</th>
              <th scope="col">{t("colEvidence")}</th>
              <th scope="col">{t("colRecordedBy")}</th>
              {p.canAct && <th scope="col"><span className="sr-only">{t("colActions")}</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.kind} data-kind={r.kind} data-state={r.state} data-earliest={r.state === "recorded" && r.earliest ? "true" : undefined}>
                <th scope="row">{label(r.kind)}</th>
                {r.state === "unrecorded" ? (
                  <>
                    <td><span className="status-chip status-not-started"><span aria-hidden="true">○</span> {t("unrecorded")}</span></td>
                    <td>—</td>
                    <td>—</td>
                  </>
                ) : (
                  <>
                    <td>
                      <span className="mono-num">{r.row.announced_on}</span>
                      {r.earliest && <span className="status-chip status-green block mt-1" style={{ whiteSpace: "normal" }} data-testid="site-announcement-earliest-chip"><span aria-hidden="true">★</span> {t("earliestChip")}</span>}
                    </td>
                    <td><Evidence value={r.row.evidence_ref} /></td>
                    <td className="text-[length:var(--fs-caption)]">{t("recordedBy", { who: r.row.recorded_by, when: formatDateTime(r.row.recorded_at, locale) })}</td>
                  </>
                )}
                {p.canAct && (
                  <td>
                    {r.state === "recorded" && (
                      <button type="button" className="btn-ghost btn-sm" disabled={a.busy} aria-label={t("correctAria", { kind: label(r.kind) })} onClick={() => a.onEdit(r.row)}>{t("correct")}</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {history.length > 0 && (
        <details className="review-dev mt-2" data-testid="site-announcement-history">
          <summary>{t("announceHistorySummary", { count: history.length })}</summary>
          <ul className="list-none p-0 m-0 mt-2 grid gap-1 text-[length:var(--fs-caption)]">
            {history.map((r) => (
              <li key={r.id}>
                <strong>{label(r.announcement_kind)}</strong> · <span className="mono-num">{r.announced_on}</span> · {t("recordedBy", { who: r.recorded_by, when: formatDateTime(r.recorded_at, locale) })}
                <span className="block text-[color:var(--muted-fg)]"><Evidence value={r.evidence_ref} /> <span>({t("superseded")})</span></span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {p.canAct && (
        <form className="mt-3" aria-label={t("announceFormLabel")} noValidate onSubmit={(e) => { e.preventDefault(); a.onSubmit(); }} data-testid="site-announcement-form">
          <fieldset className="border border-[color:var(--border)] rounded-lg px-3 py-2 m-0" disabled={a.busy}>
            <legend className="text-[length:var(--fs-body)] px-1">{t("announceFormLegend")}</legend>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("announceFormHelp")}</p>
            {a.loadedFromRow && <p role="note" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="site-announcement-loaded-note"><span aria-hidden="true">ⓘ</span> {t("announceEditLoadedNote")}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[length:var(--fs-caption)]" htmlFor={`${uid}-kind`}>
                <span className="block mb-1 font-medium">{t("fieldKind")} <span aria-hidden="true" className="text-[color:var(--red-fg)]">*</span></span>
                <select id={`${uid}-kind`} className="sizing-new-input" aria-required="true" aria-invalid={a.problem === "kind" ? true : undefined} value={a.form.kind} onChange={(e) => a.onForm({ ...a.form, kind: e.target.value })}>
                  <option value="">{tc("selectEllipsis")}</option>
                  {data.vocabulary.announcement_kinds.map((k) => <option key={k} value={k}>{label(k)}</option>)}
                </select>
              </label>
              <label className="text-[length:var(--fs-caption)]" htmlFor={`${uid}-date`}>
                <span className="block mb-1 font-medium">{t("fieldAnnouncedOn")} <span aria-hidden="true" className="text-[color:var(--red-fg)]">*</span></span>
                <input id={`${uid}-date`} type="date" className="sizing-new-input" aria-required="true" max={p.today} value={a.form.announcedOn}
                  aria-invalid={a.problem === "announcedOn" || a.problem === "announcedOnFuture" ? true : undefined}
                  aria-describedby={problemText ? `${uid}-problem` : undefined}
                  onChange={(e) => a.onForm({ ...a.form, announcedOn: e.target.value })} />
              </label>
            </div>
            <label className="block text-[length:var(--fs-caption)] mt-2" htmlFor={`${uid}-evidence`}>
              <span className="block mb-1 font-medium">{t("fieldAnnounceEvidence")} <span aria-hidden="true" className="text-[color:var(--red-fg)]">*</span></span>
              <input id={`${uid}-evidence`} type="text" className="sizing-new-input w-full" aria-required="true" placeholder={t("evidencePlaceholder")} value={a.form.evidenceRef}
                aria-invalid={a.problem === "evidence" || a.problem === "evidenceFormat" || a.problem === "evidenceTooLong" ? true : undefined}
                aria-describedby={problemText ? `${uid}-problem` : undefined}
                onChange={(e) => a.onForm({ ...a.form, evidenceRef: e.target.value })} />
            </label>
            {problemText && <p id={`${uid}-problem`} role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-2 mb-0" data-testid="site-announcement-problem"><span aria-hidden="true">✕</span> {problemText}</p>}
            {a.serverError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-2 mb-0" data-testid="site-announcement-server-error"><span aria-hidden="true">✕</span> {a.serverError}</p>}
            {a.notice && <p role="status" className="text-[length:var(--fs-caption)] mt-2 mb-0" data-testid="site-announcement-notice"><span aria-hidden="true">✓</span> {a.notice}</p>}
            <div className="mt-3">
              <button type="submit" className="btn-ghost btn-sm" disabled={a.busy}>{a.busy ? t("recording") : t("recordAnnouncement")}</button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}

function PlanSection(p: { data: DimensionInputData; canAct: boolean; meId: string | null; today: string; planBlock: PlanBlock }) {
  const t = useTranslations(T);
  const locale = useLocale();
  const uid = useId().replace(/:/g, "");
  const { data, planBlock: b } = p;
  const live = livePlanRow(data);
  const history = planHistoryRows(data);
  const evidenceRequired = planEvidenceRequired(data);
  const availability = live ? reviewAvailability(live, p.meId, p.canAct) : null;
  const answer = live ? planAnswerOf(live) : null;
  const problemText = b.problem ? (t as (k: string, v?: Record<string, number>) => string)(`planProblem.${b.problem}`, { max: b.problem === "rationaleTooLong" ? RATIONALE_MAX : EVIDENCE_MAX }) : null;
  const answerText = (v: DimensionInputRow): string => {
    const x = planAnswerOf(v);
    return x === "yes" ? t("answerYes") : x === "no" ? t("answerNo") : (v.value_text ?? "");
  };

  return (
    <section aria-labelledby={`${uid}-h`} className="mt-4" data-testid="infra-plan-block">
      <h3 id={`${uid}-h`} className="text-[length:var(--fs-body)] mb-1">{t("planTitle")}</h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("planLead")}</p>

      {live ? (
        <div className="sizing-grade-card mb-2" data-testid="infra-plan-current" data-review={planReviewState(live)} data-answer={answer ?? undefined}>
          <p className="flex flex-wrap items-center gap-2 mb-1">
            <strong>{t("currentAssertion")}</strong>
            <span className="status-chip status-not-started"><span aria-hidden="true">{answer === "yes" ? "✓" : answer === "no" ? "✕" : "○"}</span> {answerText(live)}</span>
            <ReviewChip state={planReviewState(live)} />
          </p>
          <dl className="grid gap-1 m-0 text-[length:var(--fs-caption)]">
            {answer === "yes" && (
              <div>
                <dt className="inline text-[color:var(--muted-fg)]">{t("effectiveOnLabel")}: </dt>
                <dd className="inline m-0 mono-num" data-testid="infra-plan-effective-on">{live.effective_on ?? t("effectiveOnMissing")}</dd>
              </div>
            )}
            <div><dt className="inline text-[color:var(--muted-fg)]">{t("colEvidence")}: </dt><dd className="inline m-0">{live.evidence_ref ? <Evidence value={live.evidence_ref} /> : "—"}</dd></div>
            <div><dt className="inline text-[color:var(--muted-fg)]">{t("rationaleLabel")}: </dt><dd className="inline m-0">{live.rationale}</dd></div>
            <div><dt className="inline text-[color:var(--muted-fg)]">{t("assertedByLabel")}: </dt><dd className="inline m-0">{t("recordedBy", { who: live.asserted_by, when: formatDateTime(live.observed_at, locale) })}</dd></div>
            {live.reviewed_by && <div><dt className="inline text-[color:var(--muted-fg)]">{t("reviewedByLabel")}: </dt><dd className="inline m-0">{live.reviewed_by}</dd></div>}
          </dl>
          {planReviewState(live) === "pending" && (
            <div className="mt-2" data-testid="infra-plan-review-area">
              <p role="note" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2"><span aria-hidden="true">ⓘ</span> {t("pendingNote")}</p>
              {availability === "available" && (
                <button type="button" className="btn-ghost btn-sm" disabled={b.reviewBusy} onClick={() => b.onReview(live)} data-testid="infra-plan-review-button">
                  {b.reviewBusy ? t("reviewing") : t("reviewAction")}
                </button>
              )}
              {availability === "own_assertion" && (
                <p role="note" className="text-[length:var(--fs-caption)] mb-0" data-testid="infra-plan-own-note"><span aria-hidden="true">ⓘ</span> {t("ownAssertionNote")}</p>
              )}
            </div>
          )}
          {b.reviewError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-2 mb-0" data-testid="infra-plan-review-error"><span aria-hidden="true">✕</span> {b.reviewError}</p>}
          {b.reviewNotice && <p role="status" className="text-[length:var(--fs-caption)] mt-2 mb-0" data-testid="infra-plan-review-notice"><span aria-hidden="true">✓</span> {b.reviewNotice}</p>}
        </div>
      ) : (
        <p role="status" className="status-chip status-not-started mb-2" style={{ whiteSpace: "normal" }} data-testid="infra-plan-none"><span aria-hidden="true">○</span> {t("noAssertionYet")}</p>
      )}

      {history.length > 0 && (
        <details className="review-dev mt-2" data-testid="infra-plan-history">
          <summary>{t("planHistorySummary", { count: history.length })}</summary>
          <ul className="list-none p-0 m-0 mt-2 grid gap-1 text-[length:var(--fs-caption)]">
            {history.map((r) => (
              <li key={r.id}>
                <strong>{answerText(r)}</strong>{r.effective_on ? <> · <span className="mono-num">{r.effective_on}</span></> : null} · {t("recordedBy", { who: r.asserted_by, when: formatDateTime(r.observed_at, locale) })}
                <span className="block text-[color:var(--muted-fg)]">{r.rationale} <span>({t("superseded")})</span></span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {p.canAct && (
        <form className="mt-3" aria-label={t("planFormLabel")} noValidate onSubmit={(e) => { e.preventDefault(); b.onSubmit(); }} data-testid="infra-plan-form">
          <fieldset className="border border-[color:var(--border)] rounded-lg px-3 py-2 m-0" disabled={b.busy}>
            <legend className="text-[length:var(--fs-body)] px-1">{t("planFormLegend")}</legend>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("planFormHelp")}</p>
            <fieldset className="border-0 p-0 m-0">
              <legend className="text-[length:var(--fs-caption)] font-medium mb-1">{t("fieldPlanValue")} <span aria-hidden="true" className="text-[color:var(--red-fg)]">*</span></legend>
              <div className="flex flex-wrap gap-4 text-[length:var(--fs-caption)]">
                <label className="flex items-center gap-2">
                  <input type="radio" name={`${uid}-value`} checked={b.form.value === "yes"} onChange={() => b.onForm({ ...b.form, value: "yes" })} />
                  <span>{t("answerYes")}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name={`${uid}-value`} checked={b.form.value === "no"} onChange={() => b.onForm({ ...b.form, value: "no", effectiveOn: "" })} />
                  <span>{t("answerNo")}</span>
                </label>
              </div>
            </fieldset>
            {showsEffectiveOn(b.form) && (
              <label className="block text-[length:var(--fs-caption)] mt-2" htmlFor={`${uid}-effective`}>
                <span className="block mb-1 font-medium">{t("fieldEffectiveOn")} <span aria-hidden="true" className="text-[color:var(--red-fg)]">*</span></span>
                <input id={`${uid}-effective`} type="date" className="sizing-new-input" aria-required="true" max={p.today} value={b.form.effectiveOn}
                  aria-invalid={b.problem === "effectiveOn" || b.problem === "effectiveOnFuture" ? true : undefined}
                  aria-describedby={`${uid}-effective-hint`}
                  onChange={(e) => b.onForm({ ...b.form, effectiveOn: e.target.value })} />
                <span id={`${uid}-effective-hint`} className="block mt-1 text-[color:var(--muted-fg)]">{t("effectiveOnHint")}</span>
              </label>
            )}
            <label className="block text-[length:var(--fs-caption)] mt-2" htmlFor={`${uid}-evidence`}>
              <span className="block mb-1 font-medium">
                {evidenceRequired || b.form.value === "yes" ? t("fieldPlanEvidenceRequired") : t("fieldPlanEvidenceOptional")}
                {(evidenceRequired || b.form.value === "yes") && <> <span aria-hidden="true" className="text-[color:var(--red-fg)]">*</span></>}
              </span>
              <input id={`${uid}-evidence`} type="text" className="sizing-new-input w-full" placeholder={t("evidencePlaceholder")} value={b.form.evidenceRef}
                aria-required={evidenceRequired || b.form.value === "yes" ? true : undefined}
                aria-invalid={b.problem === "evidence" || b.problem === "evidenceFormat" || b.problem === "evidenceTooLong" ? true : undefined}
                aria-describedby={problemText ? `${uid}-problem` : undefined}
                onChange={(e) => b.onForm({ ...b.form, evidenceRef: e.target.value })} />
            </label>
            <label className="block text-[length:var(--fs-caption)] mt-2" htmlFor={`${uid}-rationale`}>
              <span className="block mb-1 font-medium">{t("fieldRationale", { max: RATIONALE_MAX })} <span aria-hidden="true" className="text-[color:var(--red-fg)]">*</span></span>
              <textarea id={`${uid}-rationale`} className="sizing-new-input w-full" rows={3} aria-required="true" value={b.form.rationale}
                aria-invalid={b.problem === "rationale" || b.problem === "rationaleTooLong" ? true : undefined}
                aria-describedby={problemText ? `${uid}-problem` : undefined}
                onChange={(e) => b.onForm({ ...b.form, rationale: e.target.value })} />
            </label>
            {problemText && <p id={`${uid}-problem`} role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-2 mb-0" data-testid="infra-plan-problem"><span aria-hidden="true">✕</span> {problemText}</p>}
            {b.serverError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-2 mb-0" data-testid="infra-plan-server-error"><span aria-hidden="true">✕</span> {b.serverError}</p>}
            {b.notice && <p role="status" className="text-[length:var(--fs-caption)] mt-2 mb-0" data-testid="infra-plan-notice"><span aria-hidden="true">✓</span> {b.notice}</p>}
            <div className="mt-3">
              <button type="submit" className="btn-ghost btn-sm" disabled={b.busy}>{b.busy ? t("recording") : t("recordPlan")}</button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}

/** Stateless body, so the markup can be rendered and pinned without effects. */
export function SiteAnnouncementPanelView(p: SiteAnnouncementPanelViewProps) {
  const t = useTranslations(T);
  const tc = useTranslations("common");
  const uid = useId().replace(/:/g, "");
  const ready = p.announcements !== null && p.plan !== null;
  const loading = !ready && !p.announcementsError && !p.planError;

  return (
    <section className="card" id={SITE_ANNOUNCEMENT_PANEL_ID} aria-labelledby={`${uid}-h`} data-testid="site-announcement-panel">
      <h2 id={`${uid}-h`}>{t("title")}</h2>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("lead")}</p>
      <p role="note" className="text-[length:var(--fs-caption)] mb-2" data-testid="site-announcement-no-ai">
        <span aria-hidden="true">ⓘ</span> {t("noAiPrefill")}
      </p>

      {p.announcementsError && <LoadError kind={p.announcementsError} testid="site-announcement-load-error" />}
      {p.planError && p.planError !== p.announcementsError && <LoadError kind={p.planError} testid="infra-plan-load-error" />}
      {loading && <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("loading")}</p>}

      {ready && p.announcements && p.plan && <StatusLine earliest={p.announcements.earliest_announced_on} plan={livePlanRow(p.plan)} />}
      {p.announcements && <AnnouncementSection data={p.announcements} canAct={p.canAct} today={p.today} announce={p.announce} />}
      {p.plan && <PlanSection data={p.plan} canAct={p.canAct} meId={p.meId} today={p.today} planBlock={p.planBlock} />}
      {(p.announcements || p.plan) && !p.canAct && (
        <p role="note" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-3 mb-0" data-testid="site-announcement-readonly"><span aria-hidden="true">ⓘ</span> {t("readOnly")}</p>
      )}
    </section>
  );
}

function loadErrorOf(e: unknown): LoadErrorKind {
  if (!(e instanceof ApiError)) return "other";
  const kind: KillDataErrorKind = killDataErrorKind(e.status, e.code);
  return kind === "viewer" || kind === "admin" || kind === "notFound" ? kind : "other";
}

export function SiteAnnouncementPanel({ projectId, canAct }: { projectId: string; canAct: boolean }) {
  const t = useTranslations(T);
  const { me } = useAuth();
  const base = `/api/projects/${encodeURIComponent(projectId)}`;
  const announceUrl = `${base}/site-announcement`;
  const inputsUrl = `${base}/dimension-inputs`;
  const today = useMemo(() => seoulToday(new Date()), []);

  const [announcements, setAnnouncements] = useState<SiteAnnouncementData | null>(null);
  const [announcementsError, setAnnouncementsError] = useState<LoadErrorKind | null>(null);
  const [plan, setPlan] = useState<DimensionInputData | null>(null);
  const [planError, setPlanError] = useState<LoadErrorKind | null>(null);

  const [aForm, setAForm] = useState<AnnouncementForm>(EMPTY_ANNOUNCEMENT_FORM);
  const [aLoadedFromRow, setALoadedFromRow] = useState(false);
  const [aBusy, setABusy] = useState(false);
  const [aProblem, setAProblem] = useState<AnnouncementProblem | null>(null);
  const [aServerError, setAServerError] = useState<string | null>(null);
  const [aNotice, setANotice] = useState<string | null>(null);

  const [pForm, setPForm] = useState<PlanForm>(EMPTY_PLAN_FORM);
  const [pBusy, setPBusy] = useState(false);
  const [pProblem, setPProblem] = useState<PlanProblem | null>(null);
  const [pServerError, setPServerError] = useState<string | null>(null);
  const [pNotice, setPNotice] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);

  const loadAnnouncements = useCallback(async () => {
    try {
      const r = await api.get<SiteAnnouncementData>(announceUrl);
      setAnnouncements(r.data);
      setAnnouncementsError(null);
    } catch (e) {
      setAnnouncements(null);
      setAnnouncementsError(loadErrorOf(e));
    }
  }, [announceUrl]);
  const loadPlan = useCallback(async () => {
    try {
      const r = await api.get<DimensionInputData>(`${inputsUrl}?var_key=${encodeURIComponent(PLAN_VAR_KEY)}`);
      setPlan(r.data);
      setPlanError(null);
    } catch (e) {
      setPlan(null);
      setPlanError(loadErrorOf(e));
    }
  }, [inputsUrl]);
  useEffect(() => { void loadAnnouncements(); void loadPlan(); }, [loadAnnouncements, loadPlan]);

  const messageOf = (e: unknown): string => {
    if (!(e instanceof ApiError)) return t("serverError.other");
    const kind = killDataErrorKind(e.status, e.code);
    return kind === "invalid" ? e.message : t(`serverError.${kind}` as never);
  };

  const submitAnnouncement = async () => {
    const found = validateAnnouncementForm(aForm, today);
    setANotice(null);
    setAServerError(null);
    setAProblem(found);
    if (found) return;
    setABusy(true);
    try {
      await api.post(announceUrl, buildAnnouncementBody(aForm));
      setAForm(EMPTY_ANNOUNCEMENT_FORM);
      setALoadedFromRow(false);
      setANotice(t("announceRecorded"));
      await loadAnnouncements();
    } catch (e) {
      setAServerError(messageOf(e));
    } finally {
      setABusy(false);
    }
  };

  const submitPlan = async () => {
    const found = validatePlanForm(pForm, today, planEvidenceRequired(plan));
    setPNotice(null);
    setPServerError(null);
    setReviewNotice(null);
    setReviewError(null);
    setPProblem(found);
    if (found) return;
    setPBusy(true);
    try {
      await api.post(inputsUrl, buildPlanBody(pForm));
      setPForm(EMPTY_PLAN_FORM);
      setPNotice(t("planRecorded"));
      await loadPlan();
    } catch (e) {
      setPServerError(messageOf(e));
    } finally {
      setPBusy(false);
    }
  };

  const review = async (row: DimensionInputRow) => {
    setReviewBusy(true);
    setReviewError(null);
    setReviewNotice(null);
    try {
      await api.post(`${inputsUrl}/${encodeURIComponent(row.id)}/review`);
      setReviewNotice(t("reviewedNotice"));
      await loadPlan();
    } catch (e) {
      setReviewError(messageOf(e));
      if (e instanceof ApiError && e.status === 409) await loadPlan();
    } finally {
      setReviewBusy(false);
    }
  };

  return (
    <SiteAnnouncementPanelView
      announcements={announcements} announcementsError={announcementsError} plan={plan} planError={planError}
      canAct={canAct} meId={me?.userId ?? null} today={today}
      announce={{
        form: aForm, busy: aBusy, problem: aProblem, serverError: aServerError, notice: aNotice, loadedFromRow: aLoadedFromRow,
        onForm: (next) => { setAForm(next); setAProblem(null); setANotice(null); },
        onSubmit: () => { void submitAnnouncement(); },
        onEdit: (row) => { setAForm(announcementFormFromRow(row)); setALoadedFromRow(true); setAProblem(null); setAServerError(null); setANotice(null); },
      }}
      planBlock={{
        form: pForm, busy: pBusy, problem: pProblem, serverError: pServerError, notice: pNotice,
        reviewBusy, reviewError, reviewNotice,
        onForm: (next) => { setPForm(next); setPProblem(null); setPNotice(null); },
        onSubmit: () => { void submitPlan(); },
        onReview: (row) => { void review(row); },
      }}
    />
  );
}
