// @version 1.0.0
/**
 * Pure helpers behind the WACC panel's "reference data collection" block: one row per collectable source
 * (ECOS rates, DART credit rating) with a status line, a button emphasis rule and the anchor that the
 * credit-spread reason text links to. The panel maps the returned kinds to localized text.
 */
import { type ReferenceSuggestion, creditCollectVisible } from "./wacc-reference-items.ts";

export type CollectRowKey = "ecos" | "credit";

/** DOM id of a collect row; the credit-spread reason text links to the credit row. */
export const COLLECT_BLOCK_ID = "wacc-collect-block";
export function collectRowId(key: CollectRowKey): string {
  return `wacc-collect-row-${key}`;
}

export type CollectEmphasis = "primary" | "secondary";

/** Primary only when the data is missing/required; otherwise the button is a small "collect again". */
export function collectEmphasis(needed: boolean): CollectEmphasis {
  return needed ? "primary" : "secondary";
}

/** ECOS data is required when the risk-free rate is missing, or the credit spread has no ECOS series to map from. */
export function ecosCollectNeeded(suggestions: readonly ReferenceSuggestion[]): boolean {
  const rf = suggestions.find((x) => x.key === "risk_free");
  const credit = suggestions.find((x) => x.key === "credit_spread");
  if (rf && rf.value === null) return true;
  return !!credit && credit.value === null && credit.reason_code === "no_ecos_observations";
}

/** Credit-rating collection is required when the backend hints it or the rating in use is out of date. */
export function creditCollectNeeded(credit: ReferenceSuggestion | undefined): boolean {
  return creditCollectVisible(credit);
}

/** The credit row has no usable action when the company has no DART code (the collection would answer 400). */
export function creditCollectAvailable(credit: ReferenceSuggestion | undefined): boolean {
  return !!credit && credit.key === "credit_spread" && credit.disclosed_status !== "no_dart_corp_code";
}

/** Should the credit-spread reason text offer the "go to collect area" link? */
export function creditReasonLinksToCollect(credit: ReferenceSuggestion | undefined): boolean {
  if (credit?.key !== "credit_spread") return false;
  if (credit.disclosed_status === "no_dart_corp_code") return false;
  return credit.reason_code === "rating_not_collected" || creditCollectNeeded(credit);
}

export type EcosStatus = { kind: "collected"; asOf: string | null } | { kind: "missing" };

export function ecosRowStatus(suggestions: readonly ReferenceSuggestion[]): EcosStatus {
  const rf = suggestions.find((x) => x.key === "risk_free");
  const credit = suggestions.find((x) => x.key === "credit_spread");
  if (!rf || rf.value === null) return { kind: "missing" };
  return { kind: "collected", asOf: rf.as_of ?? credit?.anchors?.as_of ?? null };
}

export type CreditStatus =
  | { kind: "no_dart_code" }
  | { kind: "not_collected" }
  /** Rating read from the disclosure (or the bureau row when `source` is "bureau"). */
  | {
      kind: "rated";
      source: "disclosed" | "bureau";
      rating: string;
      ratedOn: string | null;
      stale: boolean;
      /** Bureau basis only: the disclosure carried no usable bond rating. */
      bondRatingMissing: boolean;
    }
  /** Collected, but the disclosure has no rating and nothing else filled in. */
  | { kind: "no_rating"; statusCode: string | null }
  | { kind: "default_basis" };

/** Status of the credit-rating source from the credit_spread suggestion (suggestion fields only). */
export function creditRowStatus(credit: ReferenceSuggestion | undefined): CreditStatus {
  if (!credit) return { kind: "not_collected" };
  const status = credit.disclosed_status ?? null;
  if (status === "no_dart_corp_code") return { kind: "no_dart_code" };
  if (credit.rating && (credit.rating_source === "disclosed" || credit.rating_source === "bureau")) {
    return {
      kind: "rated",
      source: credit.rating_source,
      rating: credit.rating,
      ratedOn: credit.rating_rated_on ?? null,
      stale: credit.rating_stale === true,
      bondRatingMissing: credit.rating_source === "bureau" && status !== null,
    };
  }
  if (status === "rating_not_collected") return { kind: "not_collected" };
  if (status !== null) return { kind: "no_rating", statusCode: status };
  return { kind: "default_basis" };
}
