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
import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
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

const UNIT_LABEL: Record<string, string> = {
  krw_m_year: "백만원/년",
  units_year: "대/년",
  usd_m_year: "백만 USD/년",
};

/** The anchor currency from the scope's unit basis (ADR-0181 §4); null when
 *  no FX is needed (KRW anchor, units basis). */
function anchorCurrencyOf(unitBasis: string | null | undefined): string | null {
  if (!unitBasis) return null;
  if (unitBasis === "krw_m_year" || unitBasis === "units_year") return null;
  const m = unitBasis.match(/^([a-z]{3})_m_year$/);
  return m ? m[1].toUpperCase() : null;
}

const SCOPE_CHIP: Record<string, { label: string; cls: string }> = {
  exact: { label: "범위 일치", cls: "status-chip status-info" },
  partial: { label: "범위 부분일치", cls: "status-chip status-warn" },
  none: { label: "범위 불일치", cls: "status-chip status-warn" },
  unknown: { label: "범위 미확인", cls: "status-chip status-not-started" },
};

function fmt(n: number): string {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

export function EntryMarketContextStrip({ opportunityId }: { opportunityId: string }) {
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
        aria-label="진입시장 (S2 산정)"
      >
        진입시장 (S2 산정): 미연결 — S2 진입시장 산정에서 S1 시장규모 분석을 연결하세요.
      </p>
    );
  }
  if (!flow) return null; // loading

  const unit = flow?.scope_unit_basis ? (UNIT_LABEL[flow.scope_unit_basis] ?? flow.scope_unit_basis) : null;
  const scopeChip = flow?.scope_flag ? (SCOPE_CHIP[flow.scope_flag.status] ?? SCOPE_CHIP.unknown) : null;
  const derived = flow?.computed?.entry_market_krw_m;
  const anchor = flow?.computed?.anchor_value_krw_m ?? flow?.reference?.anchor_value_krw_m ?? null;
  // ADR-0181 slice 3 — 개산 (KRW conversion at the reference rate). S3부터는
  // 원화 기준: the strip always shows the KRW-converted value when the anchor
  // currency's rate is set; a needed-but-unset rate renders an honest warning
  // (never a silent pass-through).
  const anchorCcy = flow?.currency ?? anchorCurrencyOf(flow?.scope_unit_basis ?? null);
  const fxRow = anchorCcy ? (flow?.fx ?? []).find((r) => r.currency === anchorCcy) ?? null : null;
  const needsFx = anchorCcy != null;
  const krwValue = derived != null && needsFx && fxRow ? derived * fxRow.rate : null;
  const fxMissing = derived != null && needsFx && !fxRow;
  const growthLabel = flow?.growth_rate != null ? `${Math.round(flow.growth_rate * 1000) / 10}%/년` : null;

  return (
    <p
      className="text-[length:var(--fs-caption)] market-section mb-2"
      data-testid="entry-market-strip"
      aria-label="진입시장 (S2 산정)"
    >
      {"진입시장 (S2 산정): "}
      {flow?.derivation == null ? (
        <span className="text-[color:var(--muted-fg)]">
          도출 사슬 미설정 — S2 진입시장 산정 3단계에서 배율 사슬로 도출하세요
          {anchor != null ? ` (S1 앵커 v${flow?.reference?.version_no ?? "-"}: ${fmt(anchor)}${unit ? ` ${unit}` : ""})` : ""}
        </span>
      ) : krwValue != null ? (
        <>
          <strong>
            {fmt(krwValue)} 백만원/년
          </strong>
          {` — 개산 (${anchorCcy} ${fmt(fxRow!.rate)} 원/통화 적용; 원시장 ${fmt(derived!)}${unit ? ` ${unit}` : ""}, 배율 ${fmt(flow?.computed?.factor_product ?? 1)}, 사슬 ${flow?.derivation.steps.length}단계`}
          {growthLabel && ` · 성장률 ${growthLabel}`}
          {scopeChip && <span className={`${scopeChip.cls} ml-1`}>{scopeChip.label}</span>}
        </>
      ) : derived != null ? (
        <>
          <strong>
            {fmt(derived)}
            {unit ? ` ${unit}` : ""}
          </strong>
          {` — S1 앵커 ${fmt(flow?.computed?.anchor_value_krw_m ?? 0)} × 배율 ${fmt(flow?.computed?.factor_product ?? 1)}, 사슬 ${flow?.derivation.steps.length}단계`}
          {growthLabel && ` · 성장률 ${growthLabel}`}
          {fxMissing && <span className="status-chip status-warn ml-1">기준 환율 미설정 ({anchorCcy}) — 개산 불가</span>}
          {scopeChip && <span className={`${scopeChip.cls} ml-1`}>{scopeChip.label}</span>}
        </>
      ) : (
        <span className="text-[color:var(--muted-fg)]">도출값 계산 불가 — 연결된 S1 버전의 앵커를 확인하세요.</span>
      )}
    </p>
  );
}

export function DealEntryMarketStrip({ routeId }: { routeId: string }) {
  const st = useDealOpportunityId(routeId);
  if (st.status !== "ready" || st.opportunityId === null) return null;
  return <EntryMarketContextStrip opportunityId={st.opportunityId} />;
}
