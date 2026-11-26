// @version 1.0.0
/**
 * Credit-rating registry reader and rating-to-spread map (ADR-0208, design
 * 2026-11-26-wacc-credit-rating-spread-design sections 6 and 8.1). PURE: no DB access, no writes.
 * The caller (db/lib/wacc-reference.ts) reads the three ECOS observations of one month and passes
 * them in, so spread, KTB and as-of month always come from one source and one month.
 *
 * Basis ladder shipped in slice 1 (first available wins):
 *   ecos_interpolated  AA- and BBB- anchors minus KTB 3y; AAA..AA- clamp to the AA- spread, BB+ and
 *                      below clamp (flagged) to the BBB- spread, the notches between are interpolated
 *                      geometrically: spread(n) = s_AA- x r^(n - n_AA-), r = (s_BBB-/s_AA-)^(1/(n_BBB- - n_AA-)).
 *   ecos_clamped       an anchor is missing: A-range and above use AA-, below uses BBB- (flagged).
 * Not built yet: kofia_grade_direct (slice 4, gated on KOFIA's terms). When no basis can produce a
 * figure the caller keeps today's AA- behaviour (aa_minus_legacy) - never a placeholder.
 *
 * Interpolated values are DERIVED, not published figures: they are labelled `derived` and the note
 * shows both anchors, their as-of month and the formula. A rating is a model input with provenance,
 * never a credit opinion; nothing here touches a gate, RAG grade or data-confidence tier.
 */
import { existsSync, readFileSync } from "node:fs";
import * as yaml from "js-yaml";
import { registryPath } from "./erp-reference.ts";

export type SpreadBasis = "ecos_interpolated" | "ecos_clamped" | "aa_minus_legacy";

export type SpreadFlag =
  | "interpolated"
  | "above_upper_anchor_clamped"
  | "below_investment_grade_series_understates"
  | "clamped_fallback";

export interface CreditRatingRegistry {
  /** Ratings best to worst; notch = index + 1. */
  scale: string[];
  defaultRating: string;
  defaultReason: string;
  disclosed: { instrument: string; staleMonths: number; aggregate: "lowest" };
  spreadMap: { upperAnchor: string; lowerAnchor: string };
  /** Cross-check warning threshold, percentage points (used by a later slice; carried here as registry data). */
  warnGapPp: number;
}

export type CreditRatingRegistryResult =
  | { ok: true; registry: CreditRatingRegistry }
  | { ok: false; reason_code: "credit_rating_no_registry" | "credit_rating_registry_error"; reason: string };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}
function isMap(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse the `credit_rating_references` section of one region profile document. Never throws. */
export function parseCreditRatingRegistry(doc: unknown): CreditRatingRegistryResult {
  const section = (doc as { credit_rating_references?: unknown } | null)?.credit_rating_references;
  if (section === undefined) {
    return {
      ok: false,
      reason_code: "credit_rating_no_registry",
      reason: "No credit_rating_references section is registered for this region.",
    };
  }
  const bad = (reason: string): CreditRatingRegistryResult => ({
    ok: false,
    reason_code: "credit_rating_registry_error",
    reason,
  });
  const data = isMap(section) ? section.data : undefined;
  if (!isMap(data)) return bad("credit_rating_references.data is missing or malformed.");
  const scaleRaw = data.rating_scale;
  if (!Array.isArray(scaleRaw) || scaleRaw.length === 0 || !scaleRaw.every((r) => str(r) !== null)) {
    return bad("credit_rating_references.data.rating_scale is missing or malformed.");
  }
  const scale = scaleRaw as string[];
  if (new Set(scale).size !== scale.length) return bad("credit_rating_references.data.rating_scale has duplicates.");
  const def = isMap(data.default) ? data.default : null;
  const defaultRating = str(def?.rating);
  const defaultReason = str(def?.reason);
  if (!defaultRating || !defaultReason || !scale.includes(defaultRating)) {
    return bad("credit_rating_references.data.default does not name a rating of the scale.");
  }
  const disc = isMap(data.disclosed) ? data.disclosed : null;
  const instrument = str(disc?.instrument);
  const staleMonths = disc?.stale_months;
  if (!instrument || typeof staleMonths !== "number" || !Number.isFinite(staleMonths) || staleMonths <= 0) {
    return bad("credit_rating_references.data.disclosed is malformed.");
  }
  if (disc?.aggregate !== "lowest") return bad("credit_rating_references.data.disclosed.aggregate must be 'lowest'.");
  const sm = isMap(data.spread_map) ? data.spread_map : null;
  const upper = str(sm?.upper_anchor);
  const lower = str(sm?.lower_anchor);
  if (
    !upper ||
    !lower ||
    !scale.includes(upper) ||
    !scale.includes(lower) ||
    scale.indexOf(upper) >= scale.indexOf(lower)
  ) {
    return bad("credit_rating_references.data.spread_map anchors are missing, unresolved or out of order.");
  }
  if (sm?.between !== "geometric" || sm?.above_upper !== "clamp" || sm?.below_lower !== "clamp_flagged") {
    return bad("credit_rating_references.data.spread_map method is not the supported geometric/clamp rule.");
  }
  const kc = isMap(data.kd_crosscheck) ? data.kd_crosscheck : null;
  const warnGap = kc?.warn_gap_pp;
  if (typeof warnGap !== "number" || !Number.isFinite(warnGap) || warnGap <= 0) {
    return bad("credit_rating_references.data.kd_crosscheck.warn_gap_pp is missing or not positive.");
  }
  return {
    ok: true,
    registry: {
      scale,
      defaultRating,
      defaultReason,
      disclosed: { instrument, staleMonths, aggregate: "lowest" },
      spreadMap: { upperAnchor: upper, lowerAnchor: lower },
      warnGapPp: warnGap,
    },
  };
}

/** Load the KR registry from region-profiles/KR.yaml. Never throws; a failure is an explicit result. */
export function loadKrCreditRatingRegistry(path: string = registryPath()): CreditRatingRegistryResult {
  try {
    if (!existsSync(path)) {
      return {
        ok: false,
        reason_code: "credit_rating_no_registry",
        reason: "Region profile KR.yaml was not found.",
      };
    }
    const doc = yaml.load(readFileSync(path, "utf-8"), { schema: yaml.JSON_SCHEMA });
    return parseCreditRatingRegistry(doc);
  } catch (e) {
    return {
      ok: false,
      reason_code: "credit_rating_registry_error",
      reason: `KR.yaml could not be read: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** Notch of a rating on the registry scale (1 = best). Null when the rating is not on the scale. */
export function notchOf(registry: CreditRatingRegistry, rating: string): number | null {
  const i = registry.scale.indexOf(rating);
  return i < 0 ? null : i + 1;
}

/** The ECOS observations of ONE month the map works from (percent points). */
export interface SpreadInputs {
  /** YYYY-MM */
  asOf: string;
  ktbPct: number;
  aaMinusPct: number | null;
  bbbMinusPct: number | null;
}

export interface MappedSpread {
  ok: true;
  rating: string;
  notch: number;
  /** Credit spread in percent points (grade yield - KTB 3y of the same month), rounded to 6 decimals. */
  spreadPct: number;
  basis: Exclude<SpreadBasis, "aa_minus_legacy">;
  /** True only when the value was interpolated between the two anchors (not a published difference). */
  derived: boolean;
  flags: SpreadFlag[];
  /** Anchor spreads (percent points) actually available, and the interpolation ratio when used. */
  anchors: {
    as_of: string;
    ktb_pct: number;
    aa_minus_pct: number | null;
    bbb_minus_pct: number | null;
    aa_minus_spread_pp: number | null;
    bbb_minus_spread_pp: number | null;
    ratio_per_notch: number | null;
    upper_notch: number;
    lower_notch: number;
  };
  /** Human-readable derivation (English; the panel localizes labels, not this text). */
  note: string;
}

export interface SpreadMapFailure {
  ok: false;
  reason_code: "rating_not_in_scale" | "anchor_missing" | "spread_not_positive" | "anchors_inverted";
  reason: string;
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const fmt = (x: number): string => x.toFixed(3);

/**
 * Map one rating to a credit spread from the month's ECOS anchors. Deterministic: same inputs, same output
 * (the confirmation audit re-derives with this function). Returns a failure (never a placeholder) when
 * no basis can produce a figure; the caller then keeps the legacy AA- behaviour.
 */
export function mapRatingToSpread(
  registry: CreditRatingRegistry,
  rating: string,
  inputs: SpreadInputs,
): MappedSpread | SpreadMapFailure {
  const n = notchOf(registry, rating);
  if (n === null) {
    return {
      ok: false,
      reason_code: "rating_not_in_scale",
      reason: `Rating '${rating}' is not on the registry scale.`,
    };
  }
  const nU = notchOf(registry, registry.spreadMap.upperAnchor) as number;
  const nL = notchOf(registry, registry.spreadMap.lowerAnchor) as number;
  const sA = inputs.aaMinusPct === null ? null : inputs.aaMinusPct - inputs.ktbPct;
  const sB = inputs.bbbMinusPct === null ? null : inputs.bbbMinusPct - inputs.ktbPct;
  const anchorsBase = {
    as_of: inputs.asOf,
    ktb_pct: inputs.ktbPct,
    aa_minus_pct: inputs.aaMinusPct,
    bbb_minus_pct: inputs.bbbMinusPct,
    aa_minus_spread_pp: sA === null ? null : round6(sA),
    bbb_minus_spread_pp: sB === null ? null : round6(sB),
    upper_notch: nU,
    lower_notch: nL,
  };
  const upper = registry.spreadMap.upperAnchor;
  const lower = registry.spreadMap.lowerAnchor;
  const where = `ECOS ${inputs.asOf}, KTB 3y ${fmt(inputs.ktbPct)}%`;

  // Basis 1: both anchors present -> interpolated ladder.
  if (sA !== null && sB !== null) {
    if (sA <= 0 || sB <= 0) {
      return {
        ok: false,
        reason_code: "spread_not_positive",
        reason: `An anchor spread is not positive (${upper} ${fmt(sA)} pp, ${lower} ${fmt(sB)} pp at ${inputs.asOf}).`,
      };
    }
    if (sB < sA) {
      return {
        ok: false,
        reason_code: "anchors_inverted",
        reason: `The ${lower} spread (${fmt(sB)} pp) is below the ${upper} spread (${fmt(sA)} pp) at ${inputs.asOf}.`,
      };
    }
    const r = (sB / sA) ** (1 / (nL - nU));
    let spread: number;
    let derived = false;
    const flags: SpreadFlag[] = [];
    let how: string;
    if (n <= nU) {
      spread = sA;
      if (n < nU) {
        flags.push("above_upper_anchor_clamped");
        how = `clamped to the ${upper} spread (no lower-spread anchor exists; errs conservative)`;
      } else {
        how = `${upper} yield ${fmt(inputs.aaMinusPct as number)}% - KTB 3y (published anchor difference)`;
      }
    } else if (n === nL) {
      spread = sB;
      how = `${lower} yield ${fmt(inputs.bbbMinusPct as number)}% - KTB 3y (published anchor difference)`;
    } else if (n > nL) {
      spread = sB;
      flags.push("below_investment_grade_series_understates");
      how = `clamped to the ${lower} spread (below investment grade the ECOS series understates)`;
    } else {
      spread = sA * r ** (n - nU);
      derived = true;
      flags.push("interpolated");
      how =
        `geometric interpolation by notch between ${upper} (${fmt(sA)} pp) and ${lower} (${fmt(sB)} pp): ` +
        `spread = s_${upper} x r^(n - ${nU}), r = (s_${lower}/s_${upper})^(1/${nL - nU}) = ${r.toFixed(4)}; derived value, not a published figure`;
    }
    const spreadPct = round6(spread);
    return {
      ok: true,
      rating,
      notch: n,
      spreadPct,
      basis: "ecos_interpolated",
      derived,
      flags,
      anchors: { ...anchorsBase, ratio_per_notch: round6(r) },
      note: `Rating ${rating}: spread ${fmt(spreadPct)} pp - ${how} (${where}).`,
    };
  }

  // Basis 2: an anchor is missing -> clamp. A-range and above use the upper anchor, below uses the lower.
  const useUpper = n <= (nU + nL) / 2;
  const sel = useUpper ? sA : sB;
  const selName = useUpper ? upper : lower;
  if (sel === null) {
    return {
      ok: false,
      reason_code: "anchor_missing",
      reason: `The ${selName} series has no observation in the same month as KTB 3y (${inputs.asOf}), so rating ${rating} cannot be mapped.`,
    };
  }
  if (sel <= 0) {
    return {
      ok: false,
      reason_code: "spread_not_positive",
      reason: `The ${selName} spread is not positive (${fmt(sel)} pp at ${inputs.asOf}).`,
    };
  }
  const spreadPct = round6(sel);
  return {
    ok: true,
    rating,
    notch: n,
    spreadPct,
    basis: "ecos_clamped",
    derived: false,
    flags: ["clamped_fallback", ...(n > nL ? (["below_investment_grade_series_understates"] as const) : [])],
    anchors: { ...anchorsBase, ratio_per_notch: null },
    note:
      `Rating ${rating}: spread ${fmt(spreadPct)} pp - clamped to the ${selName} spread because the ` +
      `${useUpper ? lower : upper} anchor is missing for ${inputs.asOf} (${where}); collect the ECOS series to enable interpolation.`,
  };
}

/** Absolute tolerance: |confirmed - derived| above this many percentage points counts as edited (ECOS values carry 3 decimals). */
export const SPREAD_EDIT_TOLERANCE_PP = 0.0005;

/** True when the confirmed spread (ratio) differs from the derived spread (percent points) beyond the tolerance. */
export function spreadEditedFromReference(confirmedRatio: number, derivedSpreadPct: number): boolean {
  return Math.abs(confirmedRatio * 100 - derivedSpreadPct) > SPREAD_EDIT_TOLERANCE_PP;
}
