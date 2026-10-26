"use client";

// EntryMarketContextStrip — ADR-0180 slice 5 (S3~S12 subject-market linkage).
// One READ-ONLY line that carries the S2-decided entry market (linked S1
// version, person-set target scope, derived value over the ratio-factor
// chain) onto every downstream stage surface, so S3~S7 visibly operate on
// that market; S8 consumes it numerically through the business-case anchor
// replacement (lib/business-case-generator.ts, resolveDerivedEntryMarket)
// and S9~S12 inherit the S8 outputs. Decision support only — nothing here
// feeds a score, a gate or a grade (boundaries #2/#4); unset states render
// honestly instead of being masked.
//
// Two entry points:
//   - <EntryMarketContextStrip opportunityId>: direct (NewSynergyForm's
//     selected opportunity).
//   - <DealEntryMarketStrip routeId>: the deals stage shell — resolves the
//     deal's source opportunity first (a promoted project id resolves through
//     useDealOpportunityId, the same resolver the S3 body uses).
import { TranslatorFn, resolveLabels } from "../i18n/config.ts";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { api } from "../lib/api.ts";
import { formatNumber } from "../lib/format.ts";
import { useDealOpportunityId } from "./stages/use-deal-opportunity-id.ts";

interface StripFlowResponse {
  link: { analysis_id: string; version_id: string } | null;
  derivation: { steps: Array<Record<string, unknown>> } | null;
  computed: { anchor_value_krw_m: number; factor_product: number; entry_market_krw_m: number } | null;
  reference: { version_no: number; anchor_value_krw_m: number | null } | null;
  scope_flag: { status: string; reason: string } | null;
  scope_set: boolean;
  scope_unit_basis: string | null;
  // ADR-0181 additive record inputs:
  currency: string | null;
  growth_rate: number | null;
  fx: Array<{ currency: string; rate: number; volatility: number | null }>;
}

const UNIT_LABEL = (tr: TranslatorFn): Record<string, string> => resolveLabels(tr, {
  krw_m_year: "common.krwMillionPerYear",
  units_year: "components.entryMarketContext.strip.unitsYr",
  usd_m_year: "components.entryMarketContext.strip.usdMillionsYr",
});

/** Unit label for any declared basis, including the multi-currency/scale
 *  patterns (ADR-0181 amendment). Keys resolve through the component's
 *  translators at render. */
function unitLabel(ub: string | null | undefined, t: TranslatorFn, tr: TranslatorFn): string | null {
  if (!ub) return null;
  const mapped = UNIT_LABEL(tr)[ub];
  if (mapped) return mapped;
  const m = ub.match(/^([a-z]{3})_([mb])_year$/);
  if (m) return t("p1P2YrAnnualRevenue", { p1: m[2] === "b" ? t("billions") : t("millions"), p2: m[1].toUpperCase() });
  return ub;
}

/** The anchor currency + scale (to 백만원) from the scope's unit basis
 *  (ADR-0181 amendment); null when no FX is needed (KRW anchor, units basis)
 *  or the unit is undeclared. */
function anchorUnitOf(unitBasis: string | null | undefined): { currency: string; scale: number } | null {
  if (!unitBasis) return null;
  if (unitBasis === "krw_m_year" || unitBasis === "units_year") return null;
  const m = unitBasis.match(/^([a-z]{3})_([mb])_year$/);
  if (!m) return null;
  return { currency: m[1].toUpperCase(), scale: m[2] === "b" ? 1000 : 1 };
}

// ADR-0181: record-level verdict vocabulary (compareAnchorScope) — ok /
// mismatch / unknown. The former exact/partial/none map belonged to the
// superseded per-step grading.
const SCOPE_CHIP = (tr: TranslatorFn): Record<string, { label: string; cls: string }> => ({
  ok: { label: "components.entryMarketContext.strip.scopeMatch", cls: "status-chip status-info" },
  mismatch: { label: "components.entryMarketContext.strip.scopeMismatch", cls: "status-chip status-warn" },
  unknown: { label: "components.entryMarketContext.strip.scopeUnverified", cls: "status-chip status-not-started" },
});

export function EntryMarketContextStrip({ opportunityId }: { opportunityId: string }) {const tr = useTranslations(); const t = useTranslations("components.entryMarketContext.strip"); const tc = useTranslations("common");
  const locale = useLocale();
  const fmt = (n: number): string =>formatNumber(n, locale, { maximumFractionDigits: 2 });
  const [flow, setFlow] = useState<StripFlowResponse | null>(null);
  const [linkedMissing, setLinkedMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    setFlow(null);
    setLinkedMissing(false);
    api
      .get<StripFlowResponse>(`/api/opportunities/${encodeURIComponent(opportunityId)}/entry-market-derivation`)
      .then((r) => {
        if (alive) setFlow(r.data);
      })
      .catch(() => {
        // 409 not_linked — the honest unlinked state, never a blocking failure.
        if (alive) setLinkedMissing(true);
      });
    return () => {
      alive = false;
    };
  }, [opportunityId]);

  if (linkedMissing) {
    return (
      <p
        className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] market-section mb-2"
        data-testid="entry-market-strip"
        aria-label={t("entryMarketS2Estimate")}
      >
        {t("entryMarketS2EstimateNot")}{" "}
        <Link href={`/opportunities/${encodeURIComponent(opportunityId)}?tab=entry`} className="guide-link" data-testid="entry-market-link-s2">
          {t("entryMarketLinkS2")}
        </Link>
      </p>
    );
  }
  if (!flow) return null; // loading

  const unit = unitLabel(flow?.scope_unit_basis ?? null, t, tr);
  const scopeChip = flow?.scope_flag ? (SCOPE_CHIP(tr)[flow.scope_flag.status] ?? SCOPE_CHIP(tr).unknown) : null;
  const derived = flow?.computed?.entry_market_krw_m;
  const anchor = flow?.computed?.anchor_value_krw_m ?? flow?.reference?.anchor_value_krw_m ?? null;
  // ADR-0181 slice 3 + amendment — 개산 (KRW conversion at the reference rate
  // × the declared scale). S3부터는 원화 기준: the strip shows the KRW-converted
  // value when the anchor currency's rate is set; a needed-but-unset rate or
  // an UNDECLARED unit renders an honest warning (never a silent pass-through
  // — the ~1,400× mislabel this prevents).
  const anchorUnit = anchorUnitOf(flow?.scope_unit_basis ?? null);
  const anchorCcy = flow?.currency ?? anchorUnit?.currency ?? null;
  const fxRow = anchorCcy ? (flow?.fx ?? []).find((r) => r.currency === anchorCcy) ?? null : null;
  const needsFx = anchorCcy != null;
  const scale = anchorUnit?.scale ?? 1;
  const krwValue = derived != null && needsFx && fxRow ? derived * fxRow.rate * scale : null;
  const fxMissing = derived != null && needsFx && !fxRow;
  const unitUndeclared = derived != null && flow?.scope_unit_basis == null;
  const growthLabel = flow?.growth_rate != null ? t("p1Yr", { p1: Math.round(flow.growth_rate * 1000) / 10 }) : null;

  return (
    <p
      className="text-[length:var(--fs-caption)] market-section mb-2"
      data-testid="entry-market-strip"
      aria-label={t("entryMarketS2Estimate2")}
    >
      {t("entryMarketS2Estimate3")}
      {flow?.derivation == null ? (
        <span className="text-[color:var(--muted-fg)]">
          {t("derivationChainNotSetDerive")}
          {anchor != null ? t("s1AnchorVP1P2", { p1: flow?.reference?.version_no ?? "-", p2: fmt(anchor), p3: unit ? ` ${unit}` : "" }) : ""}
        </span>
      ) : krwValue != null ? (
        <>
          <strong>
            {fmt(krwValue)} {tc("krwMillionPerYear")}
          </strong>
          {t("estimateP1P2PerCurrency", { p1: anchorCcy ?? "", p2: fmt(fxRow!.rate), p3: scale > 1 ? ` ×${fmt(scale)}` : "", p4: fmt(derived!), p5: unit ? ` ${unit}` : "", p6: fmt(flow?.computed?.factor_product ?? 1), p7: flow?.derivation.steps.length })}
          {growthLabel && t("growthP1", { p1: growthLabel })}
          {scopeChip && <span className={`${scopeChip.cls} ml-1`}>{tr(scopeChip.label)}</span>}
        </>
      ) : derived != null && unitUndeclared ? (
        <>
          <strong>
            {fmt(derived)}
            {unit ? ` ${unit}` : t("anchorUnit")}
          </strong>
          {t("factorP1ChainP2Steps", { p1: fmt(flow?.computed?.factor_product ?? 1), p2: flow?.derivation.steps.length })}
          <span className="status-chip status-warn ml-1">{t("anchorUnitUndeclaredDeclaringThe")}</span>
          {scopeChip && <span className={`${scopeChip.cls} ml-1`}>{tr(scopeChip.label)}</span>}
        </>
      ) : derived != null ? (
        <>
          <strong>
            {fmt(derived)}
            {unit ? ` ${unit}` : ""}
          </strong>
          {t("s1AnchorP1FactorP2", { p1: fmt(flow?.computed?.anchor_value_krw_m ?? 0), p2: fmt(flow?.computed?.factor_product ?? 1), p3: flow?.derivation.steps.length })}
          {growthLabel && t("growthP12", { p1: growthLabel })}
          {fxMissing && <span className="status-chip status-warn ml-1">{t("referenceFxRateNotSet")}{anchorCcy}{t("cannotEstimate")}</span>}
          {scopeChip && <span className={`${scopeChip.cls} ml-1`}>{tr(scopeChip.label)}</span>}
        </>
      ) : (
        <span className="text-[color:var(--muted-fg)]">{t("cannotComputeTheDerivedValue")}</span>
      )}
    </p>
  );
}

export function DealEntryMarketStrip({ routeId }: { routeId: string }) {
  const st = useDealOpportunityId(routeId);
  if (st.status !== "ready" || st.opportunityId === null) return null;
  return <EntryMarketContextStrip opportunityId={st.opportunityId} />;
}
