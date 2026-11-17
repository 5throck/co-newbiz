"use client";

// S7 deal-shape AI recommendation card (ADR-0201 §6.3 / §7): the same structure as the form, overall verdict first and shapes
// only when viable. A PROPOSAL only (boundary #2, ADR-0118): "양식에 채우기" copies it into the form and saves nothing.
import { useTranslations } from "next-intl";
import type { DealShapeRecommendation } from "../../lib/deal-shape-view.ts";
import { useDealShapeLabels } from "./useDealShapeLabels.ts";

export interface RecoState {
  busy: boolean;
  error: string | null;
  note: string | null;
  item: DealShapeRecommendation | null;
}
export const EMPTY_RECO: RecoState = { busy: false, error: null, note: null, item: null };

export function DealShapeRecommendCard(p: {
  reco: RecoState;
  busy: boolean;
  onRecommend: () => void;
  onApply: (r: DealShapeRecommendation) => void;
}) {
  const t = useTranslations("stages.s67.dealShapePanel");
  const labels = useDealShapeLabels();
  const { reco } = p;
  const item = reco.item;
  return (
    <div className="mb-3" data-testid="deal-shape-ai">
      <button type="button" className="btn-ghost btn-sm" disabled={p.busy || reco.busy} onClick={p.onRecommend}>
        {reco.busy ? t("aiRecommending") : t("aiRecommend")}
      </button>
      {reco.error && (
        <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-2 mb-0">
          <span aria-hidden="true">✕</span> {reco.error}
        </p>
      )}
      {reco.note && (
        <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2 mb-0">
          <span aria-hidden="true">ⓘ</span> {reco.note}
        </p>
      )}
      {item && (
        <section
          className="border border-[color:var(--border)] rounded-lg px-3 py-2 mt-2 text-[length:var(--fs-caption)]"
          aria-label={t("aiCardLabel")}
          data-testid="deal-shape-ai-card"
          data-viable={item.overall_viable === null ? "undecided" : String(item.overall_viable)}
        >
          <div className="flex flex-wrap items-center gap-2">
            <strong>{t("aiOverall")}</strong>
            {item.overall_viable === null && (
              <span className="status-chip status-not-started">
                <span aria-hidden="true">?</span> {t("aiUndecided")}
              </span>
            )}
            {item.overall_viable === true && (
              <span className="status-chip status-green">
                <span aria-hidden="true">✓</span> {t("verdictViable")}
              </span>
            )}
            {item.overall_viable === false && (
              <span className="status-chip status-red">
                <span aria-hidden="true">✕</span> {t("verdictNotViable")}
              </span>
            )}
            {item.overall_viable === true && item.intent && (
              <span className="text-[color:var(--muted-fg)]">{labels.intent(item.intent)}</span>
            )}
            {item.overall_viable !== null && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={p.busy}
                aria-label={t("aiApplyAria")}
                onClick={() => p.onApply(item)}
              >
                {t("aiApply")}
              </button>
            )}
          </div>
          <p className="m-0 mt-1">{item.rationale}</p>
          {item.overall_viable === true && item.shapes.length > 0 && (
            <ul className="list-none p-0 m-0 mt-2 grid gap-1" aria-label={t("aiShapesLabel")}>
              {item.shapes.map((s) => (
                <li key={s.shape}>
                  <strong>{labels.shape(s.shape)}</strong>
                  <span className="block text-[color:var(--muted-fg)]">{s.rationale}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
