"use client";

// S7 "진출 형태 평가" (ADR-0194 item A, relocated from S4 by ADR-0195; design 2026-11-08-deal-shape-to-s7-design): a person records, per deal shape,
// whether it is viable and why. The recorded live verdicts are the data source of kill criterion #9
// (deal-shape-chain:no_viable_deal_shape). Human recording only (boundary #2): no AI suggestion, score or recommendation
// is ever pre-filled here - the form starts empty and the only value it can load is the person's own earlier entry.
// The page keeps one primary action (the committee review / gate decision); the record button here is a secondary (ghost) control.
import { useCallback, useEffect, useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, ApiError } from "../../lib/api.ts";
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

export interface ShapeRecommendation {
  shape: string;
  viable: boolean | null;
  intent: string;
  rationale: string;
}
export interface RecoState {
  busy: boolean;
  error: string | null;
  note: string | null;
  items: ShapeRecommendation[];
}
export const EMPTY_RECO: RecoState = { busy: false, error: null, note: null, items: [] };

export interface DealShapePanelViewProps {
  data: DealShapeData | null;
  /** Load failure kind, when the GET failed. */
  loadError: "viewer" | "admin" | "notFound" | "other" | null;
  canAct: boolean;
  form: DealShapeForm;
  onForm: (next: DealShapeForm) => void;
  onSubmit: () => void;
  onEdit: (row: DealShapeRow) => void;
  /** AI recommendation (proposal only; nothing is saved by it). */
  reco: RecoState;
  onRecommend: () => void;
  /** Copy a proposal into the form; the person still edits and records. */
  onApply: (r: ShapeRecommendation) => void;
  busy: boolean;
  problem: FormProblem | null;
  serverError: string | null;
  notice: string | null;
  loadedFromRow: boolean;
}

/** Stateless body, so the markup can be rendered and pinned without effects. */
export function DealShapePanelView(p: DealShapePanelViewProps) {
  const t = useTranslations("stages.s67.dealShapePanel");
  const tc = useTranslations("common");
  const locale = useLocale();
  const labels = useDealShapeLabels();
  const uid = useId().replace(/:/g, "");
  const { data, form } = p;

  const status = data ? viableStatus(data.viable_count) : null;
  const verdicts = data ? shapeVerdictRows(data) : [];
  const recordedRows = verdicts.flatMap((v) => (v.state === "unevaluated" ? [] : [v]));
  const evaluated = data ? data.live.length : 0;
  const history = data ? data.history.filter((r) => r.superseded_by !== null) : [];
  const problemText = p.problem
    ? (t as (k: string, v?: Record<string, number>) => string)(`problem.${p.problem}`, {
        max: p.problem === "evidenceTooLong" ? EVIDENCE_MAX : RATIONALE_MAX,
      })
    : null;

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

          {recordedRows.length > 0 && (
            <ul
              className="list-none p-0 m-0 mb-3 grid gap-2 text-[length:var(--fs-caption)]"
              aria-label={t("recordedListLabel")}
              data-testid="deal-shape-recorded"
            >
              {recordedRows.map((v) => (
                <li
                  key={v.shape}
                  data-shape={v.shape}
                  data-state={v.state}
                  className="border-b border-[color:var(--border)] pb-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{labels.shape(v.shape)}</strong>
                    <Verdict state={v.state} />
                    <span className="text-[color:var(--muted-fg)]">{labels.intent(v.row.intent)}</span>
                    {p.canAct && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={p.busy}
                        aria-label={t("editAria", { shape: labels.shape(v.shape) })}
                        onClick={() => p.onEdit(v.row)}
                      >
                        {t("edit")}
                      </button>
                    )}
                  </div>
                  <p className="m-0 mt-1">
                    {v.row.rationale}
                    {v.row.evidence_ref && (
                      <span className="block text-[color:var(--muted-fg)]">
                        {t("evidenceRef", { ref: v.row.evidence_ref })}
                      </span>
                    )}
                  </p>
                  <p className="m-0 mt-1 text-[color:var(--muted-fg)]">
                    {t("recordedBy", { who: v.row.evaluated_by, when: formatDateTime(v.row.evaluated_at, locale) })}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {p.canAct && (
            <div className="mb-3" data-testid="deal-shape-ai">
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={p.busy || p.reco.busy}
                onClick={p.onRecommend}
              >
                {p.reco.busy ? t("aiRecommending") : t("aiRecommend")}
              </button>
              {p.reco.error && (
                <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-2 mb-0">
                  <span aria-hidden="true">✕</span> {p.reco.error}
                </p>
              )}
              {p.reco.note && (
                <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2 mb-0">
                  <span aria-hidden="true">ⓘ</span> {p.reco.note}
                </p>
              )}
              {p.reco.items.length > 0 && (
                <ul
                  className="list-none p-0 m-0 mt-2 grid gap-2 text-[length:var(--fs-caption)]"
                  aria-label={t("aiListLabel")}
                  data-testid="deal-shape-ai-list"
                >
                  {p.reco.items.map((r) => (
                    <li key={r.shape} className="border border-[color:var(--border)] rounded-lg px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{labels.shape(r.shape)}</strong>
                        {r.viable === null ? (
                          <span className="status-chip status-not-started">
                            <span aria-hidden="true">?</span> {t("aiUndecided")}
                          </span>
                        ) : (
                          <Verdict state={r.viable ? "viable" : "not_viable"} />
                        )}
                        {r.intent && <span className="text-[color:var(--muted-fg)]">{labels.intent(r.intent)}</span>}
                        {r.viable !== null && (
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            disabled={p.busy}
                            aria-label={t("aiApplyAria", { shape: labels.shape(r.shape) })}
                            onClick={() => p.onApply(r)}
                          >
                            {t("aiApply")}
                          </button>
                        )}
                      </div>
                      <p className="m-0 mt-1">{r.rationale}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

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
                {p.loadedFromRow && (
                  <p
                    role="note"
                    className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2"
                    data-testid="deal-shape-loaded-note"
                  >
                    <span aria-hidden="true">ⓘ</span> {t("editLoadedNote")}
                  </p>
                )}
                <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
                  <label className="text-[length:var(--fs-caption)]" htmlFor={`${uid}-shape`}>
                    <span className="block mb-1 font-medium">
                      {t("fieldShape")}{" "}
                      <span aria-hidden="true" className="text-[color:var(--red-fg)]">
                        *
                      </span>
                    </span>
                    <select
                      id={`${uid}-shape`}
                      className="sizing-new-input"
                      aria-required="true"
                      value={form.shape}
                      onChange={(e) => p.onForm({ ...form, shape: e.target.value })}
                    >
                      <option value="">{tc("selectEllipsis")}</option>
                      {data.vocabulary.shapes.map((s) => (
                        <option key={s} value={s}>
                          {labels.shape(s)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="border-0 p-0 m-0">
                    <legend className="text-[length:var(--fs-caption)] font-medium mb-1">
                      {t("fieldViable")}{" "}
                      <span aria-hidden="true" className="text-[color:var(--red-fg)]">
                        *
                      </span>
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
                  <label className="text-[length:var(--fs-caption)]" htmlFor={`${uid}-intent`}>
                    <span className="block mb-1 font-medium">
                      {t("fieldIntent")}{" "}
                      <span aria-hidden="true" className="text-[color:var(--red-fg)]">
                        *
                      </span>
                    </span>
                    <select
                      id={`${uid}-intent`}
                      className="sizing-new-input"
                      aria-required="true"
                      value={form.intent}
                      onChange={(e) => p.onForm({ ...form, intent: e.target.value })}
                    >
                      <option value="">{tc("selectEllipsis")}</option>
                      {data.vocabulary.intents.map((i) => (
                        <option key={i} value={i}>
                          {labels.intent(i)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block text-[length:var(--fs-caption)] mt-2" htmlFor={`${uid}-rationale`}>
                  <span className="block mb-1 font-medium">
                    {t("fieldRationale", { max: RATIONALE_MAX })}{" "}
                    <span aria-hidden="true" className="text-[color:var(--red-fg)]">
                      *
                    </span>
                  </span>
                  <textarea
                    id={`${uid}-rationale`}
                    className="sizing-new-input w-full"
                    rows={3}
                    aria-required="true"
                    aria-invalid={p.problem === "rationale" || p.problem === "rationaleTooLong" ? true : undefined}
                    aria-describedby={problemText ? `${uid}-problem` : undefined}
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
                    aria-invalid={p.problem === "evidenceTooLong" ? true : undefined}
                    onChange={(e) => p.onForm({ ...form, evidenceRef: e.target.value })}
                  />
                </label>
                {problemText && (
                  <p
                    id={`${uid}-problem`}
                    role="alert"
                    className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-2 mb-0"
                    data-testid="deal-shape-problem"
                  >
                    <span aria-hidden="true">✕</span> {problemText}
                  </p>
                )}
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
  const [form, setForm] = useState<DealShapeForm>(EMPTY_DEAL_SHAPE_FORM);
  const [loadedFromRow, setLoadedFromRow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reco, setReco] = useState<RecoState>(EMPTY_RECO);

  const load = useCallback(async () => {
    try {
      const r = await api.get<DealShapeData>(url);
      setData(r.data);
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
    const found = validateDealShapeForm(form);
    setNotice(null);
    setServerError(null);
    setProblem(found);
    if (found) return;
    setBusy(true);
    try {
      await api.post(url, buildDealShapeBody(form));
      setForm(EMPTY_DEAL_SHAPE_FORM);
      setLoadedFromRow(false);
      setNotice(t("recorded"));
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        const kind = dealShapeErrorKind(e.status, e.code);
        setServerError(kind === "invalid" || kind === "conflict" ? e.message : t(`serverError.${kind}` as never));
      } else setServerError(t("serverError.other"));
    } finally {
      setBusy(false);
    }
  };

  const recommend = async () => {
    setReco({ ...EMPTY_RECO, busy: true });
    try {
      const r = await api.post<{ recommendations: ShapeRecommendation[]; note: string | null }>(`${url}/recommend`, {});
      setReco({
        busy: false,
        error: null,
        note: r.data.note ? t(`aiNote.${r.data.note}` as never) : null,
        items: r.data.recommendations,
      });
    } catch (e) {
      const kind = e instanceof ApiError ? dealShapeErrorKind(e.status, e.code) : "other";
      setReco({
        ...EMPTY_RECO,
        error: kind === "invalid" || kind === "conflict" ? (e as Error).message : t(`serverError.${kind}` as never),
      });
    }
  };

  return (
    <DealShapePanelView
      reco={reco}
      onRecommend={() => {
        void recommend();
      }}
      onApply={(r) => {
        // A proposal only fills the form; recording stays a person's action (boundary #2).
        setForm({ shape: r.shape, intent: r.intent, viable: r.viable, rationale: r.rationale, evidenceRef: "" });
        setLoadedFromRow(false);
        setProblem(null);
        setServerError(null);
        setNotice(t("aiApplied"));
      }}
      data={data}
      loadError={loadError}
      canAct={canAct}
      form={form}
      busy={busy}
      problem={problem}
      serverError={serverError}
      notice={notice}
      loadedFromRow={loadedFromRow}
      onForm={(next) => {
        setForm(next);
        setProblem(null);
        setNotice(null);
      }}
      onSubmit={() => {
        void submit();
      }}
      onEdit={(row) => {
        setForm(formFromRow(row));
        setLoadedFromRow(true);
        setProblem(null);
        setServerError(null);
        setNotice(null);
      }}
    />
  );
}
