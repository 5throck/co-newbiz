"use client";

// S7 deal-shape record form (ADR-0201 §6.1): overall viability first. "불가능" asks for one rationale only; "가능" asks for the
// shape(s), one intent and one rationale per checked shape. Shape and intent stay disabled until "가능" is chosen. One wrapping
// horizontal row, ghost buttons only (the page keeps its single primary action).
import { useTranslations } from "next-intl";
import {
  EVIDENCE_MAX,
  RATIONALE_MAX,
  draftOf,
  orderedShapes,
  type DealShapeData,
  type DealShapeForm as Form,
  type FormProblem,
} from "../../lib/deal-shape-view.ts";
import { useDealShapeLabels } from "./useDealShapeLabels.ts";

const Req = () => (
  <span aria-hidden="true" className="text-[color:var(--red-fg)]">
    *
  </span>
);

export function DealShapeForm(p: {
  uid: string;
  vocabulary: DealShapeData["vocabulary"];
  form: Form;
  onForm: (next: Form) => void;
  onSubmit: () => void;
  busy: boolean;
  /** design 2026-11-21-s67-completion-visibility — S6 criteria unmet: 기록 pre-disables (server guard stays authoritative). */
  s7Blocked?: boolean;
  /** id of the adjacent blocked-reason line, wired to the button via aria-describedby. */
  blockedReasonId?: string;
  problem: FormProblem | null;
  problemText: string | null;
  serverError: string | null;
  /** Error kind of `serverError` — notOpenStage adds the inline #s6-criteria anchor. */
  serverErrorKind?: string | null;
  notice: string | null;
  loadedFromRow: boolean;
}) {
  const t = useTranslations("stages.s67.dealShapePanel");
  const tc = useTranslations("common");
  const labels = useDealShapeLabels();
  const { uid, form, vocabulary } = p;
  const viable = form.viable === true;
  const hintId = `${uid}-disabled-hint`;
  const describedBy = viable ? undefined : hintId;
  const problemId = p.problemText ? `${uid}-problem` : undefined;
  // Finding #14: when the problem is the intent, the select must point at the problem alert too.
  const intentDescribedBy =
    [describedBy, p.problem === "intent" ? problemId : undefined].filter(Boolean).join(" ") || undefined;
  const invalid = (key: string) => (p.problem === key ? true : undefined);
  const toggleShape = (shape: string, on: boolean) =>
    p.onForm({ ...form, shapes: on ? [...form.shapes, shape] : form.shapes.filter((s) => s !== shape) });
  const setDraft = (shape: string, patch: Partial<{ rationale: string; evidenceRef: string }>) =>
    p.onForm({ ...form, drafts: { ...form.drafts, [shape]: { ...draftOf(form, shape), ...patch } } });
  const checked = orderedShapes(form, vocabulary.shapes);

  return (
    <form
      className="mt-3"
      aria-label={t("formLabel")}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        p.onSubmit();
      }}
      data-testid="deal-shape-form"
    >
      <fieldset className="border border-[color:var(--border)] rounded-lg px-3 py-2 m-0" disabled={p.busy}>
        <legend className="text-[length:var(--fs-body)] px-1">{t("formLegend")}</legend>
        {p.loadedFromRow && (
          <p
            role="note"
            className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2"
            data-testid="deal-shape-loaded-note"
          >
            <span aria-hidden="true">ⓘ</span> {t("editLoadedNote")}
          </p>
        )}
        <div className="flex flex-wrap items-start gap-x-6 gap-y-2" data-testid="deal-shape-controls">
          <fieldset className="border-0 p-0 m-0">
            <legend className="text-[length:var(--fs-caption)] font-medium mb-1">
              {t("fieldViable")} <Req />
            </legend>
            <div className="flex flex-wrap gap-4 text-[length:var(--fs-caption)]">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${uid}-viable`}
                  checked={form.viable === true}
                  onChange={() => p.onForm({ ...form, viable: true })}
                />
                <span>{t("verdictViable")}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${uid}-viable`}
                  checked={form.viable === false}
                  onChange={() => p.onForm({ ...form, viable: false })}
                />
                <span>{t("verdictNotViable")}</span>
              </label>
            </div>
          </fieldset>
          <fieldset
            className="border-0 p-0 m-0"
            disabled={!viable}
            aria-describedby={describedBy}
            data-testid="deal-shape-shapes"
          >
            <legend className="text-[length:var(--fs-caption)] font-medium mb-1">
              {t("fieldShape")} {viable && <Req />}
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[length:var(--fs-caption)]">
              {vocabulary.shapes.map((s) => (
                <label key={s} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.shapes.includes(s)}
                    aria-invalid={invalid("shapes")}
                    aria-describedby={problemId && p.problem === "shapes" ? problemId : undefined}
                    onChange={(e) => toggleShape(s, e.target.checked)}
                  />
                  <span>{labels.shape(s)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="text-[length:var(--fs-caption)]" htmlFor={`${uid}-intent`}>
            <span className="block mb-1 font-medium">
              {t("fieldIntent")} {viable && <Req />}
            </span>
            <select
              id={`${uid}-intent`}
              className="sizing-new-input"
              disabled={!viable}
              aria-required={viable ? "true" : undefined}
              aria-invalid={invalid("intent")}
              aria-describedby={intentDescribedBy}
              value={form.intent}
              onChange={(e) => p.onForm({ ...form, intent: e.target.value })}
            >
              <option value="">{tc("selectEllipsis")}</option>
              {vocabulary.intents.map((i) => (
                <option key={i} value={i}>
                  {labels.intent(i)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!viable && (
          <p
            id={hintId}
            className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2 mb-0"
            data-testid="deal-shape-disabled-hint"
          >
            <span aria-hidden="true">ⓘ</span> {t("disabledHint")}
          </p>
        )}

        {form.viable === false && (
          <div data-testid="deal-shape-overall-fields">
            <label className="block text-[length:var(--fs-caption)] mt-2" htmlFor={`${uid}-rationale`}>
              <span className="block mb-1 font-medium">
                {t("fieldRationale", { max: RATIONALE_MAX })} <Req />
              </span>
              <textarea
                id={`${uid}-rationale`}
                className="sizing-new-input w-full"
                rows={3}
                aria-required="true"
                aria-invalid={p.problem === "rationale" || p.problem === "rationaleTooLong" ? true : undefined}
                aria-describedby={problemId}
                value={form.rationale}
                onChange={(e) => p.onForm({ ...form, rationale: e.target.value })}
              />
            </label>
            <label className="block text-[length:var(--fs-caption)] mt-2" htmlFor={`${uid}-evidence`}>
              <span className="block mb-1 font-medium">{t("fieldEvidence")}</span>
              <input
                id={`${uid}-evidence`}
                type="text"
                className="sizing-new-input w-full"
                value={form.evidenceRef}
                aria-invalid={invalid("evidenceTooLong")}
                aria-describedby={invalid("evidenceTooLong") ? problemId : undefined}
                onChange={(e) => p.onForm({ ...form, evidenceRef: e.target.value })}
              />
            </label>
          </div>
        )}

        {viable &&
          checked.map((s) => {
            const d = draftOf(form, s);
            const bad = p.problem === `shapeRationale:${s}` || p.problem === `shapeRationaleTooLong:${s}`;
            return (
              <div key={s} data-testid="deal-shape-shape-block" data-shape={s}>
                <label className="block text-[length:var(--fs-caption)] mt-2" htmlFor={`${uid}-r-${s}`}>
                  <span className="block mb-1 font-medium">
                    {t("fieldShapeRationale", { shape: labels.shape(s), max: RATIONALE_MAX })} <Req />
                  </span>
                  <textarea
                    id={`${uid}-r-${s}`}
                    className="sizing-new-input w-full"
                    rows={3}
                    aria-required="true"
                    aria-invalid={bad ? true : undefined}
                    aria-describedby={bad ? problemId : undefined}
                    value={d.rationale}
                    onChange={(e) => setDraft(s, { rationale: e.target.value })}
                  />
                </label>
                <label className="block text-[length:var(--fs-caption)] mt-2" htmlFor={`${uid}-e-${s}`}>
                  <span className="block mb-1 font-medium">{t("fieldShapeEvidence", { shape: labels.shape(s) })}</span>
                  <input
                    id={`${uid}-e-${s}`}
                    type="text"
                    className="sizing-new-input w-full"
                    value={d.evidenceRef}
                    aria-invalid={d.evidenceRef.trim().length > EVIDENCE_MAX ? true : undefined}
                    aria-describedby={d.evidenceRef.trim().length > EVIDENCE_MAX ? problemId : undefined}
                    onChange={(e) => setDraft(s, { evidenceRef: e.target.value })}
                  />
                </label>
              </div>
            );
          })}

        {p.problemText && (
          <p
            id={`${uid}-problem`}
            role="alert"
            className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-2 mb-0"
            data-testid="deal-shape-problem"
          >
            <span aria-hidden="true">✕</span> {p.problemText}
          </p>
        )}
        {p.serverError && (
          <p
            role="alert"
            className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-2 mb-0"
            data-testid="deal-shape-server-error"
          >
            <span aria-hidden="true">✕</span> {p.serverError}
            {p.serverErrorKind === "notOpenStage" && (
              // design 2026-11-21-s67-completion-visibility Fix ①-c — the stale-UI 409 for stage_not_reached
              // names the remaining criteria AND links to the strip (tabbable inline anchor).
              <>
                {" "}
                <a href="#s6-criteria">{t("blockedReasonLink")}</a>
              </>
            )}
          </p>
        )}
        {p.notice && (
          <p role="status" className="text-[length:var(--fs-caption)] mt-2 mb-0" data-testid="deal-shape-notice">
            <span aria-hidden="true">✓</span> {p.notice}
          </p>
        )}
        <div className="mt-3">
          <button
            type="submit"
            className="btn-ghost btn-sm"
            disabled={p.busy || p.s7Blocked === true}
            aria-describedby={
              [
                p.s7Blocked === true ? p.blockedReasonId : undefined,
                p.problem === "rationale" || p.problem === "rationaleTooLong" ? problemId : undefined,
              ]
                .filter(Boolean)
                .join(" ") || undefined
            }
          >
            {p.busy ? t("recording") : t("record")}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
