"use client";

// ADR-0176 slice 4: S8 `투자 불확실성` block. Read-only view of the latest CONFIRMED S5 investment
// simulation run - S5 owns editing, confirming and re-running (link only). Simulation output /
// proposal: no gate block, no grade cap, no adoption trigger; a missing or stale run is informational.
import { TranslatorFn, resolveLabels } from "../../i18n/config.ts";
import Link from "next/link";
import type { InvestUncertaintyView } from "../../lib/investment-uncertainty-s8.ts";
import { useTranslations } from "next-intl";

const CAP = "text-[length:var(--fs-caption)]";
const fmt = (n: number): string => Math.round(n).toLocaleString("ko-KR");
const STALE_REASON = (tr: TranslatorFn): Record<string, string> => resolveLabels(tr, {
  run_confirmed_after_generation: "stages.s8.investUncertainty.theS5InvestmentSimulationWas",
  run_changed: "stages.s8.investUncertainty.theConfirmedS5SimulationRun",
  s5_lines_changed: "stages.s8.investUncertainty.theS5InvestmentPlanOr",
  run_missing: "stages.s8.investUncertainty.theConfirmedS5SimulationRun2",
});

export function S8InvestUncertaintyBlock({ view }: { view: InvestUncertaintyView }) {const tr = useTranslations(); const t = useTranslations("stages.s8.investUncertainty"); const tc = useTranslations("common");
  const s5Link = view.opportunityId ? (
    <Link href={`/deals/${encodeURIComponent(view.opportunityId)}/s5?tab=simulation`} className="text-[color:var(--accent)] font-bold" data-testid="s8-invest-uncertainty-s5-link">{t("reviewAndEditInThe")}</Link>
  ) : null;
  const npv = view.npv;
  const chip = npv.state === "not_applicable" ? null : (
    <span className={`status-chip ${npv.stale ? "status-amber" : npv.includes ? "status-green" : "status-gray"}`} data-testid="s8-invest-uncertainty-npv-chip">
      {npv.stale && <span aria-hidden="true">⏱ </span>}
      {npv.stale ? npv.label : npv.includes ? t("investmentUncertaintyReflectedInThe") : t("investmentUncertaintyNotReflectedIn")}
    </span>
  );
  return (
    <section className="mt-2 grid gap-1" aria-label={t("investmentUncertainty")} data-testid="s8-invest-uncertainty-block">
      <h3 className="sizing-step-title">{t("investmentUncertainty2")} {chip}</h3>
      {!view.hasRun || !view.total || !view.run ? (
        <p className={`${CAP} text-[color:var(--muted-fg)]`} role="status" data-testid="s8-invest-uncertainty-none">
          {t("noConfirmedS5InvestmentSimulation")} {s5Link}
        </p>
      ) : (
        <>
          <p className={CAP} data-testid="s8-invest-uncertainty-total">
            {t("totalInvestmentP50")} <strong>{fmt(view.total.p50)}</strong> / p95 <strong>{fmt(view.total.p95)}</strong> {tc("krwMillionUnit")}
            {view.exceed && <span data-testid="s8-invest-uncertainty-exceed"> {t("budgetCap")} {fmt(view.exceed.envelopeKrwM)} {t("probabilityOfExceeding")} {(view.exceed.probability * 100).toFixed(1)}%</span>}
          </p>
          {view.topSensitivities.length > 0 && (
            <p className={CAP} data-testid="s8-invest-uncertainty-tornado">
              {t("keySensitivities")} {view.topSensitivities.map((t) => `${t.label} ${(t.share * 100).toFixed(0)}%`).join(" · ")}
            </p>
          )}
          {npv.stale && <p className={CAP} role="status" data-testid="s8-invest-uncertainty-stale">{STALE_REASON(tr)[npv.reason ?? ""] ?? ""} {t("resolvedByRegeneratingTheCase")}</p>}
          <p className={`${CAP} text-[color:var(--muted-fg)]`} data-testid="s8-invest-uncertainty-provenance">
            {t("s5ConfirmedRun")} {view.run.hash.slice(0, 12)} {t("confirmed")} {view.run.confirmedBy ?? "-"} @ {(view.run.confirmedAt ?? "").slice(0, 10)} · {view.run.drawCount.toLocaleString("ko-KR")}{t("draws")} {s5Link}
          </p>
        </>
      )}
      <p className={`${CAP} text-[color:var(--muted-fg)]`} data-testid="s8-invest-uncertainty-label">{view.disclaimer}</p>
    </section>
  );
}
