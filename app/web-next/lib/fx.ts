// ADR-0181 slice 3 — MULTI-CURRENCY reference rates at the S1→S8 currency
// seam. S1 market sizings are frequently foreign-currency denominated (the
// unit basis declares the currency: usd_m_year, eur_m_year, …), while every
// S3+ surface and the whole S8 business case run in KRW. The reference rates
// are PER-CURRENCY rows on the opportunity's entry_market record
// (entry_market_fx, person-set via the audited PUT); this module owns only
// the sourcing discipline:
//   - a person-set rate for the anchor currency WINS (labelled 사용자 확정);
//   - ONLY USD carries a documented deterministic default (1400, labelled
//     검증 전) — inventing defaults for arbitrary currencies would fabricate
//     market data;
//   - an UNSET rate means NO conversion: callers render an honest
//     `기준 환율 미설정` warning and never pass the raw figure through as
//     KRW (the ~1,400× understatement this seam existed to prevent).
// bc.fx_rate (ADR-0180 slice 7) was removed; stored rows migrated in the
// 0151 backfill and are no longer read.

import type { Database } from "bun:sqlite";
import { readSizingDeclaredScope } from "./sizing-payload.ts";

/** Documented deterministic default for the USD anchor (검증 전 기준 환율).
 *  A display/assumption default, not a market observation — always rendered
 *  with its unsourced label until a person confirms a rate. */
export const DEFAULT_FX_RATE_KRW_PER_USD = 1400;

/** Sane upper bound for ANY person-entered 원/통화 rate (low-unit currencies
 *  like JPY sit near 7, USD near 1400; the cap only rejects typos). */
export const FX_RATE_MAX = 1_000_000;

/** Default FX volatility band (±10%) — precedent-consistent with the S5
 *  investment-vectors FX_RANGE, NOT a validated market band (ADR-0181 §6). */
export const DEFAULT_FX_VOLATILITY = 0.1;

export interface FxRateResolution {
  rate: number;
  /** "person" = a person-set entry_market_fx row; "default" = the documented
   *  USD fallback (근거 없는 기본값 labelling applies). */
  source: "person" | "default";
}

/** Resolve the reference KRW rate for ONE currency: the person-set value
 *  wins; USD alone falls back to the labelled default; any other unset
 *  currency yields null (no conversion — honest unset, never fabricated). */
export function resolveFxRateForCurrency(currency: string, personRate: number | null | undefined): FxRateResolution | null {
  if (typeof personRate === "number" && Number.isFinite(personRate) && personRate > 0 && personRate <= FX_RATE_MAX) {
    return { rate: personRate, source: "person" };
  }
  if (currency === "USD") return { rate: DEFAULT_FX_RATE_KRW_PER_USD, source: "default" };
  return null;
}

/** The anchor currency + SCALE implied by the S1 unit declaration
 *  (ADR-0181 amendment): `usd_m_year` → USD ×1, `usd_b_year` → USD ×1000
 *  (the anchor is quoted in billions — the scale multiplies the FX-converted
 *  value into 백만원), `krw_m_year`/`units_year` → null (no FX needed).
 *  Returns null when no FX applies; the scale is meaningful only with a
 *  currency. */
export function anchorCurrencyOfUnitBasis(
  unitBasis: string | null | undefined,
): { currency: string; /** multiplier from the anchor unit to 백만원 after the FX rate */ scale: number } | null {
  if (!unitBasis) return null;
  if (unitBasis === "krw_m_year" || unitBasis === "units_year") return null;
  const m = unitBasis.match(/^([a-z]{3})_([mb])_year$/);
  if (!m) return null;
  return { currency: m[1].toUpperCase(), scale: m[2] === "b" ? 1000 : 1 };
}

/** The linked S1 sizing version's DECLARED unit basis (the anchor's unit,
 *  as the person declared it on the version payload scope). null when
 *  unlinked or undeclared — the caller then falls back to the saved target
 *  scope's unit_basis (resolveUnitBasis chain). */
export function resolveLinkedDeclaredUnitBasis(db: Database, opportunityId: string): string | null {
  try {
    const row = db
      .query("SELECT mv.payload AS payload FROM opportunity o LEFT JOIN market_sizing_version mv ON mv.id = o.sizing_version_id WHERE o.id = ?")
      .get(opportunityId) as { payload: string | null } | undefined;
    if (!row?.payload) return null;
    return readSizingDeclaredScope(row.payload)?.unit_basis ?? null;
  } catch {
    return null;
  }
}
