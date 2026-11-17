"use client";

// S7 "진출 형태 평가" (ADR-0194 item A, relocated from S4 by ADR-0195, reshaped to overall-viability-first by ADR-0201):
// a person records the overall viability first; "불가능" is one rationale only, "가능" is the viable shape(s), one intent and one
// rationale per checked shape. Every write replaces the whole live set. The recorded live verdict is the data source of kill
// criterion #9 (deal-shape-chain:no_viable_deal_shape). Human recording only (boundary #2): an AI proposal only fills the form
// when the person applies it; the form otherwise starts empty and can only load the person's own recorded verdict.
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
  formFromLive,
  formFromRecommendation,
  validateDealShapeForm,
  verdictOf,
  type DealShapeData,
  type DealShapeForm as Form,
  type DealShapeRecommendation,
  type DealShapeRow,
  type FormProblem,
} from "../../lib/deal-shape-view.ts";
import { DealShapeForm } from "./DealShapeForm.tsx";
import { DealShapeRecommendCard, EMPTY_RECO, type RecoState } from "./DealShapeRecommendCard.tsx";
import { useDealShapeLabels } from "./useDealShapeLabels.ts";

export { useDealShapeLabels } from "./useDealShapeLabels.ts";
export { EMPTY_RECO, type RecoState } from "./DealShapeRecommendCard.tsx";

type Chip = "viable" | "not_viable";
function Verdict({ state }: { state: Chip }) {
  const t = useTranslations("stages.s67.dealShapePanel");
  return state === "viable" ? (
    <span className="status-chip status-green">
      <span aria-hidden="true">✓</span> {t("verdictViable")}
    </span>
  ) : (
    <span className="status-chip status-red">
      <span aria-hidden="true">✕</span> {t("verdictNotViable")}
    </span>
  );
}

export interface DealShapePanelViewProps {
  data: DealShapeData | null;
  /** Load failure kind, when the GET failed. */
  loadError: "viewer" | "admin" | "notFound" | "other" | null;
  canAct: boolean;
  form: Form;
  onForm: (next: Form) => void;
  onSubmit: () => void;
  /** Loads the whole recorded live verdict into the form. */
  onEdit: () => void;
  /** AI recommendation (proposal only; nothing is saved by it). */
  reco: RecoState;
  onRecommend: () => void;
  /** Copy a proposal into the form; the person still edits and records. */
  onApply: (r: DealShapeRecommendation) => void;
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
  const { data } = p;

  const verdict = data ? verdictOf(data) : null;
  const liveEntries: DealShapeRow[] = data ? [...(data.overall ? [data.overall] : []), ...data.live] : [];
  const viableCount = data ? data.live.filter((r) => r.viable).length : 0;
  const history = data ? data.history.filter((r) => r.superseded_by !== null) : [];
  const who = (r: DealShapeRow) =>
    t("recordedBy", { who: r.evaluated_by, when: formatDateTime(r.evaluated_at, locale) });
  const problemText = (() => {
    if (!p.problem) return null;
    const [key, shape] = p.problem.split(":") as [string, string | undefined];
    return (t as (k: string, v?: Record<string, unknown>) => string)(`problem.${key}`, {
      max: key === "evidenceTooLong" ? EVIDENCE_MAX : RATIONALE_MAX,
      shape: shape ? labels.shape(shape) : "",
    });
  })();

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

      {data && verdict && (
        <>
          {verdict === "unassessed" && (
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
          {verdict === "not_viable" && (
            <p
              role="alert"
              className="status-chip status-amber mb-2"
              style={{ whiteSpace: "normal" }}
              data-testid="deal-shape-status"
              data-status="not_viable"
            >
              <span aria-hidden="true">⚠</span> {t("statusNotViable")}
            </p>
          )}
          {verdict === "viable" && (
            <p
              role="status"
              className="status-chip status-green mb-2"
              style={{ whiteSpace: "normal" }}
              data-testid="deal-shape-status"
              data-status="viable"
            >
              <span aria-hidden="true">✓</span> {t("statusViable", { count: viableCount })}
            </p>
          )}

          {liveEntries.length > 0 && (
            <>
              {p.canAct && (
                <div className="mb-2">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={p.busy}
                    aria-label={t("editAria")}
                    onClick={p.onEdit}
                    data-testid="deal-shape-edit"
                  >
                    {t("edit")}
                  </button>
                </div>
              )}
              <ul
                className="list-none p-0 m-0 mb-3 grid gap-2 text-[length:var(--fs-caption)]"
                aria-label={t("recordedListLabel")}
                data-testid="deal-shape-recorded"
              >
                {liveEntries.map((r) => (
                  <li
                    key={r.id}
                    data-shape={r.shape ?? "overall"}
                    data-state={r.shape === null ? "overall_not_viable" : r.viable ? "viable" : "legacy_not_viable"}
                    className="border-b border-[color:var(--border)] pb-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {r.shape === null ? (
                        <>
                          <strong>{t("overallNotViable")}</strong>
                          <Verdict state="not_viable" />
                        </>
                      ) : (
                        <>
                          <strong>{labels.shape(r.shape)}</strong>
                          {r.viable ? (
                            <Verdict state="viable" />
                          ) : (
                            <span className="status-chip status-red">
                              <span aria-hidden="true">✕</span> {t("legacyNotViable")}
                            </span>
                          )}
                          {r.intent && <span className="text-[color:var(--muted-fg)]">{labels.intent(r.intent)}</span>}
                        </>
                      )}
                    </div>
                    <p className="m-0 mt-1">
                      {r.rationale}
                      {r.evidence_ref && (
                        <span className="block text-[color:var(--muted-fg)]">
                          {t("evidenceRef", { ref: r.evidence_ref })}
                        </span>
                      )}
                    </p>
                    <p className="m-0 mt-1 text-[color:var(--muted-fg)]">{who(r)}</p>
                  </li>
                ))}
              </ul>
            </>
          )}

          {p.canAct && (
            <DealShapeRecommendCard reco={p.reco} busy={p.busy} onRecommend={p.onRecommend} onApply={p.onApply} />
          )}

          {history.length > 0 && (
            <details className="review-dev mt-2" data-testid="deal-shape-history">
              <summary>{t("historySummary", { count: history.length })}</summary>
              <ul className="list-none p-0 m-0 mt-2 grid gap-1 text-[length:var(--fs-caption)]">
                {history.map((r) => (
                  <li key={r.id}>
                    {r.shape === null ? (
                      <strong>{t("overallNotViable")}</strong>
                    ) : (
                      <>
                        <strong>{labels.shape(r.shape)}</strong> ·{" "}
                        <Verdict state={r.viable ? "viable" : "not_viable"} />
                        {r.intent && <> · {labels.intent(r.intent)}</>}
                      </>
                    )}{" "}
                    · {who(r)}
                    <span className="block text-[color:var(--muted-fg)]">
                      {r.rationale} <span>({t("superseded")})</span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {p.canAct ? (
            <DealShapeForm
              uid={uid}
              vocabulary={data.vocabulary}
              form={p.form}
              onForm={p.onForm}
              onSubmit={p.onSubmit}
              busy={p.busy}
              problem={p.problem}
              problemText={problemText}
              serverError={p.serverError}
              notice={p.notice}
              loadedFromRow={p.loadedFromRow}
            />
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
  const [form, setForm] = useState<Form>(EMPTY_DEAL_SHAPE_FORM);
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

  const errorMessage = (e: unknown): string => {
    if (!(e instanceof ApiError)) return t("serverError.other");
    const kind = dealShapeErrorKind(e.status, e.code);
    return kind === "invalid" || kind === "conflict" ? e.message : t(`serverError.${kind}` as never);
  };

  const submit = async () => {
    const order = data?.vocabulary.shapes ?? [];
    const found = validateDealShapeForm(form, order);
    setNotice(null);
    setServerError(null);
    setProblem(found);
    if (found || !data) return;
    setBusy(true);
    try {
      await api.post(url, buildDealShapeBody(form, data.live_token ?? "", order));
      setForm(EMPTY_DEAL_SHAPE_FORM);
      setLoadedFromRow(false);
      setNotice(t("recorded"));
      await load();
    } catch (e) {
      setServerError(errorMessage(e));
      // Someone else recorded first: show the current verdict, keep the person's input (ADR-0201 §6.1).
      if (e instanceof ApiError && dealShapeErrorKind(e.status, e.code) === "stale") await load();
    } finally {
      setBusy(false);
    }
  };

  const recommend = async () => {
    setReco({ ...EMPTY_RECO, busy: true });
    try {
      const r = await api.post<{ recommendation: DealShapeRecommendation | null; note: string | null }>(
        `${url}/recommend`,
        {},
      );
      setReco({
        busy: false,
        error: null,
        note: r.data.note ? t(`aiNote.${r.data.note}` as never) : null,
        item: r.data.recommendation,
      });
    } catch (e) {
      setReco({ ...EMPTY_RECO, error: errorMessage(e) });
    }
  };

  const clearMessages = () => {
    setProblem(null);
    setServerError(null);
  };

  return (
    <DealShapePanelView
      reco={reco}
      onRecommend={() => {
        void recommend();
      }}
      onApply={(r) => {
        // A proposal only fills the form; recording stays a person's action (boundary #2).
        setForm(formFromRecommendation(r));
        setLoadedFromRow(false);
        clearMessages();
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
      onEdit={() => {
        if (!data) return;
        setForm(formFromLive(data));
        setLoadedFromRow(true);
        clearMessages();
        setNotice(null);
      }}
    />
  );
}
