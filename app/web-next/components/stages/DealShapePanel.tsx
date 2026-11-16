"use client";

// S7 "진출 형태 평가" (ADR-0194 item A, relocated from S4 by ADR-0195; design 2026-11-08-deal-shape-to-s7-design): a person records, per deal shape,
// whether it is viable and why. The recorded live verdicts are the data source of kill criterion #9
// (deal-shape-chain:no_viable_deal_shape). Human recording only (boundary #2): no AI suggestion, score or recommendation
// is ever pre-filled here - the form starts empty and the only value it can load is the person's own earlier entry.
// The page keeps one primary action (the committee review / gate decision); the record button here is a secondary (ghost) control.
import { useCallback, useEffect, useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, ApiError } from "../../lib/api.ts";
import { ColGroup } from "../ui.tsx";
import { formatDateTime } from "../../lib/format.ts";
import {
  DEAL_SHAPE_PANEL_ID,
  EMPTY_DEAL_SHAPE_FORM,
  EVIDENCE_MAX,
  RATIONALE_MAX,
  buildDealShapeBody,
  dealShapeErrorKind,
  formFromRow,
  shapeVerdictRows,
  validateDealShapeForm,
  viableStatus,
  type DealShapeData,
  type DealShapeForm,
  type DealShapeRow,
  type FormProblem,
} from "../../lib/deal-shape-view.ts";

/** Shape / intent labels. The four shapes the S10 structure screen already names reuse its keys (one wording per shape). */
export function useDealShapeLabels() {
  const t = useTranslations("stages.s67.dealShapePanel");
  const ts = useTranslations("stages.s10.stage");
  const tc = useTranslations("common");
  const td = useTranslations("stages.s4.decisionTab");
  const shape = (s: string): string => {
    switch (s) {
      case "full_acquisition":
        return ts("fullAcquisition");
      case "majority_stake":
        return ts("majorityStake");
      case "minority_stake":
        return ts("minorityStake");
      case "joint_venture":
        return ts("jointVentureJv");
      case "spv":
        return ts("spcSpvSpecialPurposeEntity");
      case "holdco_route":
        return ts("viaHoldingCompanyHoldco");
      case "license_in":
        return t("shape.license_in");
      case "co_development":
        return t("shape.co_development");
      default:
        return s;
    }
  };
  const intent = (i: string): string =>
    i === "integration" ? td("consolidated") : i === "capability_access" ? tc("capabilityApproach") : i;
  return { shape, intent };
}

const COL_PCT = [20, 10, 12, 36, 22] as const;

function Verdict({ state }: { state: "viable" | "not_viable" | "unevaluated" }) {
  const t = useTranslations("stages.s67.dealShapePanel");
  if (state === "viable")
    return (
      <span className="status-chip status-green">
        <span aria-hidden="true">✓</span> {t("verdictViable")}
      </span>
    );
  if (state === "not_viable")
    return (
      <span className="status-chip status-red">
        <span aria-hidden="true">✕</span> {t("verdictNotViable")}
      </span>
    );
  return (
    <span className="status-chip status-not-started">
      <span aria-hidden="true">○</span> {t("verdictUnevaluated")}
    </span>
  );
}

export type ShapeForms = Record<string, DealShapeForm>;

export interface DealShapePanelViewProps {
  data: DealShapeData | null;
  /** Load failure kind, when the GET failed. */
  loadError: "viewer" | "admin" | "notFound" | "other" | null;
  canAct: boolean;
  /** One draft per shape (keyed by shape code); a shape without a verdict (`viable === null`) is undecided and needs no rationale. */
  forms: ShapeForms;
  onForm: (shape: string, next: DealShapeForm) => void;
  onSubmit: () => void;
  busy: boolean;
  /** First problem per shape. */
  problems: Record<string, FormProblem>;
  serverError: string | null;
  notice: string | null;
}

/** A shape whose draft differs from its recorded live row (or is a new decision). */
export function isShapeChanged(form: DealShapeForm, row: DealShapeRow | undefined): boolean {
  if (form.viable === null) return false;
  if (!row) return true;
  return (
    row.viable !== form.viable ||
    row.intent !== form.intent ||
    row.rationale !== form.rationale.trim() ||
    (row.evidence_ref ?? "") !== form.evidenceRef.trim()
  );
}

/** Stateless body, so the markup can be rendered and pinned without effects. */
export function DealShapePanelView(p: DealShapePanelViewProps) {
  const t = useTranslations("stages.s67.dealShapePanel");
  const tc = useTranslations("common");
  const locale = useLocale();
  const labels = useDealShapeLabels();
  const uid = useId().replace(/:/g, "");
  const { data } = p;

  const status = data ? viableStatus(data.viable_count) : null;
  const verdicts = data ? shapeVerdictRows(data) : [];
  const evaluated = data ? data.live.length : 0;
  const history = data ? data.history.filter((r) => r.superseded_by !== null) : [];
  const problemText = (kind: FormProblem): string =>
    (t as (k: string, v?: Record<string, number>) => string)(`problem.${kind}`, {
      max: kind === "evidenceTooLong" ? EVIDENCE_MAX : RATIONALE_MAX,
    });
  const emptyForm = (shape: string): DealShapeForm => ({ ...EMPTY_DEAL_SHAPE_FORM, shape });

  return (
    <section className="card" id={DEAL_SHAPE_PANEL_ID} aria-labelledby={`${uid}-h`} data-testid="deal-shape-panel">
      <h2 id={`${uid}-h`}>{t("title")}</h2>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("lead")}</p>
      <p role="note" className="text-[length:var(--fs-caption)] mb-2" data-testid="deal-shape-no-ai">
        <span aria-hidden="true">ⓘ</span> {t("noAiPrefill")}
      </p>

      {p.loadError && (
        <p
          role="alert"
          className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2"
          data-testid="deal-shape-load-error"
        >
          <span aria-hidden="true">✕</span> {t(`loadError.${p.loadError}` as never)}
        </p>
      )}
      {!data && !p.loadError && (
        <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          {tc("loading")}
        </p>
      )}

      {data && status && (
        <>
          {status.kind === "unassessed" && (
            <p
              role="status"
              className="status-chip status-not-started mb-2"
              style={{ whiteSpace: "normal" }}
              data-testid="deal-shape-status"
              data-status="unassessed"
            >
              <span aria-hidden="true">○</span> {t("statusUnassessed")}
            </p>
          )}
          {status.kind === "triggered" && (
            <p
              role="alert"
              className="status-chip status-amber mb-2"
              style={{ whiteSpace: "normal" }}
              data-testid="deal-shape-status"
              data-status="triggered"
            >
              <span aria-hidden="true">⚠</span> {t("statusTriggered")}
            </p>
          )}
          {status.kind === "viable" && (
            <p
              role="status"
              className="status-chip status-green mb-2"
              style={{ whiteSpace: "normal" }}
              data-testid="deal-shape-status"
              data-status="viable"
            >
              <span aria-hidden="true">✓</span>{" "}
              {t("statusViable", { count: status.count, evaluated, total: verdicts.length })}
            </p>
          )}

          {/* biome-ignore lint/a11y/useSemanticElements lint/a11y/noNoninteractiveTabindex: design-system scroll region (WCAG 2.1.1) — a focusable labelled region so keyboard users can scroll a wide table; <section> is not phrasing-neutral here */}
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table report-table table-fixed-pct tmin-64" aria-label={t("tableLabel")}>
              <caption className="sr-only">{t("tableCaption")}</caption>
              <ColGroup widths={COL_PCT} />
              <thead>
                <tr>
                  <th scope="col">{t("colShape")}</th>
                  <th scope="col">{t("colVerdict")}</th>
                  <th scope="col">{t("colIntent")}</th>
                  <th scope="col">{t("colRationale")}</th>
                  <th scope="col">{t("colRecordedBy")}</th>
                </tr>
              </thead>
              <tbody>
                {verdicts.map((v) => (
                  <tr key={v.shape} data-shape={v.shape} data-state={v.state}>
                    <th scope="row" className="whitespace-nowrap">
                      {labels.shape(v.shape)}
                    </th>
                    <td>
                      <Verdict state={v.state} />
                    </td>
                    {v.state === "unevaluated" ? (
                      <>
                        <td>—</td>
                        <td className="text-[color:var(--muted-fg)]">{t("noRecordYet")}</td>
                        <td>—</td>
                      </>
                    ) : (
                      <>
                        <td>{labels.intent(v.row.intent)}</td>
                        <td>
                          {v.row.rationale}
                          {v.row.evidence_ref && (
                            <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                              {t("evidenceRef", { ref: v.row.evidence_ref })}
                            </span>
                          )}
                        </td>
                        <td className="text-[length:var(--fs-caption)]">
                          {t("recordedBy", {
                            who: v.row.evaluated_by,
                            when: formatDateTime(v.row.evaluated_at, locale),
                          })}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {history.length > 0 && (
            <details className="review-dev mt-2" data-testid="deal-shape-history">
              <summary>{t("historySummary", { count: history.length })}</summary>
              <ul className="list-none p-0 m-0 mt-2 grid gap-1 text-[length:var(--fs-caption)]">
                {history.map((r) => (
                  <li key={r.id}>
                    <strong>{labels.shape(r.shape)}</strong> · <Verdict state={r.viable ? "viable" : "not_viable"} /> ·{" "}
                    {labels.intent(r.intent)} ·{" "}
                    {t("recordedBy", { who: r.evaluated_by, when: formatDateTime(r.evaluated_at, locale) })}
                    <span className="block text-[color:var(--muted-fg)]">
                      {r.rationale} <span>({t("superseded")})</span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {p.canAct ? (
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
                <p role="note" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                  <span aria-hidden="true">ⓘ</span> {t("formHint")}
                </p>
                <ul className="list-none p-0 m-0 grid gap-2">
                  {verdicts.map((v) => {
                    const row = v.state === "unevaluated" ? undefined : v.row;
                    const f = p.forms[v.shape] ?? emptyForm(v.shape);
                    const decided = f.viable !== null;
                    const prob = p.problems[v.shape];
                    const name = `${uid}-${v.shape}`;
                    return (
                      <li
                        key={v.shape}
                        data-shape-form={v.shape}
                        className="border-b border-[color:var(--border)] pb-2 last:border-b-0"
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="font-medium min-w-[10rem]">{labels.shape(v.shape)}</span>
                          <fieldset className="border-0 p-0 m-0">
                            <legend className="sr-only">
                              {t("fieldViableAria", { shape: labels.shape(v.shape) })}
                            </legend>
                            <div className="flex flex-wrap gap-4 text-[length:var(--fs-caption)]">
                              <label className="flex items-center gap-2">
                                <input
                                  type="radio"
                                  name={name}
                                  checked={!decided}
                                  disabled={!!row}
                                  onChange={() => p.onForm(v.shape, { ...f, viable: null })}
                                />
                                <span>{t("verdictUndecided")}</span>
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="radio"
                                  name={name}
                                  checked={f.viable === true}
                                  onChange={() => p.onForm(v.shape, { ...f, viable: true })}
                                />
                                <span>{t("verdictViable")}</span>
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="radio"
                                  name={name}
                                  checked={f.viable === false}
                                  onChange={() => p.onForm(v.shape, { ...f, viable: false })}
                                />
                                <span>{t("verdictNotViable")}</span>
                              </label>
                            </div>
                          </fieldset>
                        </div>
                        {decided && (
                          <div className="mt-2 grid gap-2 sm:pl-[10.75rem]">
                            <label className="text-[length:var(--fs-caption)]" htmlFor={`${name}-intent`}>
                              <span className="block mb-1 font-medium">
                                {t("fieldIntent")}{" "}
                                <span aria-hidden="true" className="text-[color:var(--red-fg)]">
                                  *
                                </span>
                              </span>
                              <select
                                id={`${name}-intent`}
                                className="sizing-new-input"
                                aria-required="true"
                                value={f.intent}
                                onChange={(e) => p.onForm(v.shape, { ...f, intent: e.target.value })}
                              >
                                <option value="">{tc("selectEllipsis")}</option>
                                {data.vocabulary.intents.map((i) => (
                                  <option key={i} value={i}>
                                    {labels.intent(i)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="block text-[length:var(--fs-caption)]" htmlFor={`${name}-rationale`}>
                              <span className="block mb-1 font-medium">
                                {t("fieldRationale", { max: RATIONALE_MAX })}{" "}
                                <span aria-hidden="true" className="text-[color:var(--red-fg)]">
                                  *
                                </span>
                              </span>
                              <textarea
                                id={`${name}-rationale`}
                                className="sizing-new-input w-full"
                                rows={2}
                                aria-required="true"
                                aria-invalid={prob === "rationale" || prob === "rationaleTooLong" ? true : undefined}
                                value={f.rationale}
                                onChange={(e) => p.onForm(v.shape, { ...f, rationale: e.target.value })}
                              />
                            </label>
                            <label className="block text-[length:var(--fs-caption)]" htmlFor={`${name}-evidence`}>
                              <span className="block mb-1 font-medium">{t("fieldEvidence")}</span>
                              <input
                                id={`${name}-evidence`}
                                type="text"
                                className="sizing-new-input w-full"
                                value={f.evidenceRef}
                                aria-invalid={prob === "evidenceTooLong" ? true : undefined}
                                onChange={(e) => p.onForm(v.shape, { ...f, evidenceRef: e.target.value })}
                              />
                            </label>
                            {prob && (
                              <p
                                role="alert"
                                className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] m-0"
                                data-testid="deal-shape-problem"
                              >
                                <span aria-hidden="true">✕</span> {problemText(prob)}
                              </p>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {p.serverError && (
                  <p
                    role="alert"
                    className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-2 mb-0"
                    data-testid="deal-shape-server-error"
                  >
                    <span aria-hidden="true">✕</span> {p.serverError}
                  </p>
                )}
                {p.notice && (
                  <p
                    role="status"
                    className="text-[length:var(--fs-caption)] mt-2 mb-0"
                    data-testid="deal-shape-notice"
                  >
                    <span aria-hidden="true">✓</span> {p.notice}
                  </p>
                )}
                <div className="mt-3">
                  <button type="submit" className="btn-ghost btn-sm" disabled={p.busy}>
                    {p.busy ? t("recording") : t("record")}
                  </button>
                </div>
              </fieldset>
            </form>
          ) : (
            <p
              role="note"
              className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-3 mb-0"
              data-testid="deal-shape-readonly"
            >
              <span aria-hidden="true">ⓘ</span> {t("readOnly")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function DealShapePanel({ opportunityId, canAct }: { opportunityId: string; canAct: boolean }) {
  const t = useTranslations("stages.s67.dealShapePanel");
  const url = `/api/opportunities/${encodeURIComponent(opportunityId)}/deal-shapes`;
  const [data, setData] = useState<DealShapeData | null>(null);
  const [loadError, setLoadError] = useState<DealShapePanelViewProps["loadError"]>(null);
  const [forms, setForms] = useState<ShapeForms>({});
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<Record<string, FormProblem>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<DealShapeData>(url);
      setData(r.data);
      // Drafts start from the person's own recorded entries; undecided shapes stay empty.
      setForms(Object.fromEntries(r.data.live.map((row) => [row.shape, formFromRow(row)])));
      setLoadError(null);
    } catch (e) {
      setData(null);
      if (e instanceof ApiError) {
        const kind = dealShapeErrorKind(e.status, e.code);
        setLoadError(kind === "viewer" || kind === "admin" || kind === "notFound" ? kind : "other");
      } else setLoadError("other");
    }
  }, [url]);
  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!data) return;
    setNotice(null);
    setServerError(null);
    const live = new Map(data.live.map((r) => [r.shape, r]));
    const changed = Object.values(forms).filter((f) => isShapeChanged(f, live.get(f.shape)));
    const found: Record<string, FormProblem> = {};
    for (const f of changed) {
      const prob = validateDealShapeForm(f);
      if (prob) found[f.shape] = prob;
    }
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    if (changed.length === 0) {
      setServerError(t("nothingToRecord"));
      return;
    }
    setBusy(true);
    try {
      for (const f of changed) await api.post(url, buildDealShapeBody(f));
      setNotice(t("recorded"));
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        const kind = dealShapeErrorKind(e.status, e.code);
        setServerError(kind === "invalid" || kind === "conflict" ? e.message : t(`serverError.${kind}` as never));
      } else setServerError(t("serverError.other"));
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <DealShapePanelView
      data={data}
      loadError={loadError}
      canAct={canAct}
      forms={forms}
      busy={busy}
      problems={problems}
      serverError={serverError}
      notice={notice}
      onForm={(shape, next) => {
        setForms((cur) => ({ ...cur, [shape]: next }));
        setProblems((cur) => {
          const { [shape]: _drop, ...rest } = cur;
          return rest;
        });
        setNotice(null);
      }}
      onSubmit={() => {
        void submit();
      }}
    />
  );
}
