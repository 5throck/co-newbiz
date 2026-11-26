// Pure helpers behind the WACC panel's reference suggestions (ADR-0116 Phase 4, ADR-0207):
// which suggestions "apply all" may take, which items belong in the missing list, how an
// applied ERP reference is carried onto the confirmed component, and the snake_case request
// shape the WACC route expects. Kept free of React so the data-mapping logic is unit-testable.

import type { WaccComponentInput } from "../../../db/lib/wacc-components.ts";

/** One entry of GET /api/projects/[id]/wacc/suggestions `data.suggestions` (and `erp_alternatives`). */
export interface ReferenceSuggestion {
  key: string;
  value: number | null;
  as_of?: string;
  anchor_ref?: string;
  source_label?: string;
  reason?: string;
  reason_code?: string;
  note?: string | null;
  // ERP-only fields (ADR-0207).
  basis?: string;
  id?: string;
  source_id?: string;
  is_default?: boolean;
  verified_on?: string;
  age_months?: number;
  stale?: boolean;
  stale_reason?: string | null;
  // tax_rate-only fields (ADR-0207 addendum): statutory marginal corporate tax rate.
  bracket?: TaxBracketView;
  bracket_id?: string;
  statute_ref?: string;
  local_statute_ref?: string;
  income_account?: "pretax_income" | "operating_income" | null;
  estimated_income_krw_million?: number | null;
  income_period?: string | null;
  fallback_reason_code?: string | null;
  fallback_reason?: string | null;
  effective_from?: string;
  local_rate_adjustment_pct?: number;
  // credit_spread-only fields (ADR-0208): rating, how it was obtained, and how the spread was mapped from it.
  rating?: string | null;
  rating_source?: CreditRatingSource | null;
  rating_stale?: boolean;
  rating_agencies?: CreditAgencyRating[];
  rating_instrument?: string | null;
  /** Date of the selected disclosed rating (YYYY-MM-DD). */
  rating_rated_on?: string | null;
  source_rcept_no?: string | null;
  /** `dart_credit_rating_snapshot` id the disclosed rating came from; the confirmation must cite it. */
  credit_rating_snapshot_id?: string | null;
  rating_evidence_kind?: CreditEvidenceKind | null;
  /** Bureau basis only: the credit-bureau issuer-rating evidence (bureau, cash-flow grade, rows of the rating date). */
  rating_bureau?: CreditBureauEvidence | null;
  /** The other evidence source's rating when the two differ (the lower one is the one used). */
  rating_alternative?: CreditRatingAlternative | null;
  /** Why the disclosed rung produced no rating (null when it did). */
  disclosed_status?: CreditDisclosedStatus | null;
  /** True when running the credit-rating collection could produce (more) evidence. */
  collect_hint?: boolean;
  agency_links?: CreditAgencyLink[];
  spread_basis?: CreditSpreadBasis | null;
  derived?: boolean;
  flags?: CreditSpreadFlag[];
  series_used?: Array<{ role: string; series_id: string; value_pct: number }>;
  anchors?: CreditAnchorsView | null;
  /** ADR-0208 slice 3: the interest-coverage evaluation (used or not), the cost-of-debt cross-check, recent bond coupons. */
  synthetic?: CreditSyntheticDetail | null;
  rating_superseded?: CreditRatingSuperseded | null;
  crosscheck?: CreditCrosscheck | null;
  issuance_evidence?: CreditIssuanceRow[];
  issuance_status?: CreditIssuanceStatus | null;
  spread_reason_code?: string | null;
  spread_reason?: string | null;
  kd_indicative_pct?: number | null;
}

export type CreditInterestSource = "interest_expense" | "interest_paid" | "finance_costs";

/** `credit_spread.synthetic`: available (coverage mapped to a rating) or not (why, and whether a re-sync could help). */
export type CreditSyntheticDetail =
  | {
      available: true;
      /** True when this estimate is the rating in use. */
      used: boolean;
      rating: string;
      coverage_x: number;
      interest_source: CreditInterestSource;
      interest_is_proxy: boolean;
      fiscal_year: number;
      table_id: string;
      table_as_of: string;
      published_label: string | null;
      band_lower_x: number;
      band_upper_x: number | null;
      operating_income_krw_million: number;
      interest_expense_krw_million: number;
      loss_making: boolean;
      note: string;
    }
  | { available: false; used: false; reason_code: string; reason: string; resync_hint: boolean };

/** A stale disclosed or bureau rating that a fresh synthetic estimate was preferred over. */
export interface CreditRatingSuperseded {
  basis: "disclosed" | "bureau";
  rating: string;
  rated_on: string;
  source_rcept_no: string;
}

/** `credit_spread.crosscheck`: implied actual cost of debt vs the market-built Kd (a warning input, never an override). */
export interface CreditCrosscheck {
  status: "ok" | "warn" | "unreliable" | "unavailable";
  reason_code: string | null;
  reason: string | null;
  implied_cost_pct: number | null;
  market_kd_pct: number | null;
  gap_pp: number | null;
  direction: "market_above_actual" | "market_below_actual" | null;
  interest_source: CreditInterestSource | null;
  fiscal_year: number | null;
  interest_expense_krw_million: number | null;
  avg_debt_krw_million: number | null;
  debt_basis: "two_year_average" | "year_end" | null;
  warn_gap_pp: number;
}

export interface CreditIssuanceRow {
  issued_on: string;
  amount_krw_million: number | null;
  coupon_pct: number | null;
  rating_raw: string;
  maturity_on: string | null;
  outstanding: boolean | null;
  source_rcept_no: string;
}
export type CreditIssuanceStatus =
  | "available"
  | "no_dart_corp_code"
  | "not_collected"
  | "issues_unavailable"
  | "none_in_window";

/** `bureau` = credit-bureau issuer rating, a lower-confidence basis than the corporate-bond `disclosed` one. */
export type CreditRatingSource = "default" | "disclosed" | "bureau" | "synthetic";
export type CreditEvidenceKind = "business_report" | "debt_securities_filing";
export type CreditDisclosedStatus =
  | "no_dart_corp_code"
  | "rating_not_collected"
  | "not_disclosed"
  | "section_present_no_bond_rating"
  | "section_absent"
  | "parse_failed"
  | "not_zip"
  | "no_bond_rating";

export interface CreditAgencyRating {
  /** Registry agency id (`korea-ratings`, `kis`, `nice`). */
  agency: string;
  grade: string;
  rated_on: string;
  outlook?: string | null;
}

export interface CreditBureauEvidence {
  /** Registry bureau id of the picked row; null when the filing names none (or an unregistered bureau). */
  agency: string | null;
  agency_raw: string | null;
  /** True when the agency was inherited from an earlier table row, not stated in the row. */
  agency_carried: boolean;
  /** Cash-flow grade as filed (CR-3, C+, B): a separate scale, never the rating. */
  cashflow_grade: string | null;
  rows: Array<{ agency: string | null; agency_raw: string | null; grade: string; cashflow_grade: string | null }>;
}

export interface CreditRatingAlternative {
  rating: string;
  rated_on: string;
  stale: boolean;
  source_rcept_no: string;
  evidence_kind: CreditEvidenceKind;
}

export interface CreditAgencyLink {
  agency: string;
  home_url: string;
}
export type CreditSpreadBasis = "ecos_interpolated" | "ecos_clamped" | "aa_minus_legacy";
export type CreditSpreadFlag =
  | "interpolated"
  | "above_upper_anchor_clamped"
  | "below_investment_grade_series_understates"
  | "clamped_fallback";

/** `credit_spread.anchors` as returned by the suggestions route (percent points; null = anchor not available). */
export interface CreditAnchorsView {
  as_of: string;
  ktb_pct: number;
  aa_minus_pct: number | null;
  bbb_minus_pct: number | null;
  aa_minus_spread_pp?: number | null;
  bbb_minus_spread_pp?: number | null;
  ratio_per_notch?: number | null;
}

/** Bracket as returned in a tax_rate suggestion (KRW million bounds; `upper` null = no ceiling). */
export interface TaxBracketView {
  lower_krw_million: number;
  upper_krw_million: number | null;
  national_rate_pct?: number;
  local_rate_pct?: number;
  combined_rate_pct: number;
}

/** `data.apply_all_excluded[]` — applicable-looking items that "apply all" must skip. */
export interface ApplyAllExcluded {
  key: string;
  reason_code: string;
  reason: string;
}

/** Suggestions "apply all" may apply: a value is present and the key is not excluded. */
export function applicableSuggestions(
  suggestions: readonly ReferenceSuggestion[],
  excluded: readonly ApplyAllExcluded[] = [],
): ReferenceSuggestion[] {
  const skip = new Set(excluded.map((x) => x.key));
  return suggestions.filter((x) => x.value !== null && !skip.has(x.key));
}

/** An entry for the "not available yet" list: no value at all, or a value apply-all will not take. */
export interface MissingReferenceItem {
  key: string;
  reason_code?: string;
  reason?: string;
}

export function missingReferenceItems(
  suggestions: readonly ReferenceSuggestion[],
  excluded: readonly ApplyAllExcluded[] = [],
): MissingReferenceItem[] {
  const items: MissingReferenceItem[] = suggestions
    .filter((x) => x.value === null)
    .map((x) => ({ key: x.key, reason_code: x.reason_code, reason: x.reason }));
  const listed = new Set(items.map((x) => x.key));
  for (const x of excluded) {
    if (listed.has(x.key)) continue;
    items.push({ key: x.key, reason_code: x.reason_code, reason: x.reason });
    listed.add(x.key);
  }
  return items;
}

/** The ERP reference the human applied to the form; `appliedValue` is the ratio that was filled in. */
export interface AppliedErpRef {
  id: string;
  appliedValue: number;
}

export function appliedErpRefFrom(e: ReferenceSuggestion, appliedValue: number | null): AppliedErpRef | null {
  const id = e.id ?? e.source_id;
  if (!id || appliedValue === null) return null;
  return { id, appliedValue };
}

/**
 * ADR-0207: fields a confirmed `wacc.erp` component carries when the value came from a published
 * reference. Manual entry (no applied reference) carries none — no id is sent. `editedFromReference`
 * flips true once the human changes the number after applying; the citation is kept either way.
 */
export function erpReferenceFields(
  ref: AppliedErpRef | null,
  currentValue: number | null,
): Pick<WaccComponentInput, "erpReferenceId" | "editedFromReference"> {
  if (!ref) return {};
  const edited = currentValue !== null && Math.abs(currentValue - ref.appliedValue) > 1e-9;
  return { erpReferenceId: ref.id, editedFromReference: edited };
}

/** The statutory tax-rate reference the human applied; `appliedValue` is the ratio that was filled in. */
export interface AppliedTaxRef {
  bracketId: string;
  basis: "bracket_estimate" | "top_bracket_fallback";
  appliedValue: number;
}

export function appliedTaxRefFrom(e: ReferenceSuggestion, appliedValue: number | null): AppliedTaxRef | null {
  if (!e.bracket_id || appliedValue === null) return null;
  if (e.basis !== "bracket_estimate" && e.basis !== "top_bracket_fallback") return null;
  return { bracketId: e.bracket_id, basis: e.basis, appliedValue };
}

/**
 * ADR-0207 addendum: fields a confirmed `wacc.tax_rate` component carries when the value came from
 * the statutory bracket table. Manual entry carries none. `editedFromReference` flips true once the
 * human changes the number after applying (the server re-derives it from the bracket regardless).
 */
export function taxReferenceFields(
  ref: AppliedTaxRef | null,
  currentValue: number | null,
): Pick<WaccComponentInput, "taxReferenceBracketId" | "taxReferenceBasis" | "editedFromReference"> {
  if (!ref) return {};
  const edited = currentValue !== null && Math.abs(currentValue - ref.appliedValue) > 1e-9;
  return { taxReferenceBracketId: ref.bracketId, taxReferenceBasis: ref.basis, editedFromReference: edited };
}

/** Observed D/E as it sits in the form (or, failing that, the reference suggestion). */
export interface ObservedDeSource {
  value: number;
  source: string;
  asOf: string;
}

/**
 * Observed D/E offered as the target D/E ("관측값을 목표로 적용"). The form value wins; the
 * reference suggestion is the fallback. Null when neither carries a finite number, which disables the button.
 */
export function observedDeAsTarget(
  form: { value: string; source: string; asOf: string },
  suggestion?: ReferenceSuggestion | null,
): ObservedDeSource | null {
  const raw = form.value.trim();
  const formValue = raw === "" ? null : Number(raw);
  if (formValue !== null && Number.isFinite(formValue)) {
    return { value: formValue, source: form.source.trim(), asOf: form.asOf.trim() };
  }
  if (suggestion && suggestion.value !== null && Number.isFinite(suggestion.value)) {
    return { value: suggestion.value, source: suggestion.source_label ?? "", asOf: suggestion.as_of ?? "" };
  }
  return null;
}

/** "<source> · <as of>" with empty parts dropped — the argument of the localized "observed D/E carried over" text. */
export function observedDeSourceDetail(o: Pick<ObservedDeSource, "source" | "asOf">): string {
  return [o.source, o.asOf].filter((x) => x !== "").join(" · ");
}

const CREDIT_RATING_SOURCES: readonly string[] = ["default", "disclosed", "bureau", "synthetic"];
/** Same tolerance the server uses to derive `edited_from_reference` for the credit spread (ratio units). */
export const CREDIT_EDIT_TOLERANCE = 0.0005;
const ECOS_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The credit-spread reference the human applied; `appliedValue` is the ratio that was filled in. */
export interface AppliedCreditRef {
  basis: CreditRatingSource;
  referenceAsOf: string;
  appliedValue: number;
  /** Snapshot the rating was read from; always set for basis "disclosed" and "bureau", null otherwise. */
  snapshotId: string | null;
}

/**
 * ADR-0208: an applied credit spread is recorded as rated only when the suggestion names where the rating
 * came from AND the ECOS month it was mapped at - the server re-derives from exactly those two. The legacy
 * AA- fallback (no anchors) carries neither, so applying it records no rating basis. A disclosed rating also
 * names its evidence snapshot (the confirmation is a 400 without it), so a disclosed suggestion that lacks the
 * id records no rating basis either.
 */
export function appliedCreditRefFrom(e: ReferenceSuggestion, appliedValue: number | null): AppliedCreditRef | null {
  if (appliedValue === null || e.key !== "credit_spread") return null;
  const basis = e.rating_source;
  const month = e.anchors?.as_of;
  if (!basis || !CREDIT_RATING_SOURCES.includes(basis) || !month || !ECOS_MONTH.test(month)) return null;
  const needsSnapshot = basis === "disclosed" || basis === "bureau";
  const snapshotId = needsSnapshot ? (e.credit_rating_snapshot_id ?? null) : null;
  if (needsSnapshot && !snapshotId) return null;
  return { basis, referenceAsOf: month, appliedValue, snapshotId };
}

/**
 * ADR-0208: fields a confirmed `wacc.debt_spread` component carries when the value came from the rating-mapped
 * reference. Manual entry (nothing applied) carries none. `editedFromReference` flips true once the human moves
 * the number beyond the server's tolerance; the citation is kept either way. A disclosed rating also carries the
 * id of its evidence snapshot.
 */
export function creditReferenceFields(
  ref: AppliedCreditRef | null,
  currentValue: number | null,
): Pick<WaccComponentInput, "creditRatingBasis" | "creditRatingSnapshotId" | "referenceAsOf" | "editedFromReference"> {
  if (!ref) return {};
  const edited = currentValue !== null && Math.abs(currentValue - ref.appliedValue) > CREDIT_EDIT_TOLERANCE;
  return {
    creditRatingBasis: ref.basis,
    ...((ref.basis === "disclosed" || ref.basis === "bureau") && ref.snapshotId
      ? { creditRatingSnapshotId: ref.snapshotId }
      : {}),
    referenceAsOf: ref.referenceAsOf,
    editedFromReference: edited,
  };
}

/**
 * Citation text stored with an applied credit spread: the ECOS source label plus the rating and how the
 * spread was mapped from it (codes, not UI strings - the text is persisted with the component).
 */
export function creditSourceLabel(e: ReferenceSuggestion): string {
  const base = e.source_label ?? "";
  if (!e.rating) return base;
  const detail = `${e.rating} (${[e.rating_source, e.spread_basis].filter(Boolean).join(", ")})`;
  return base ? `${base} · ${detail}` : detail;
}

/** Percent-point yield as shown on the anchors line; "—" for an anchor that is not available. */
export function formatCreditAnchorPct(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : "—";
}

/** Localized text for a backend reason code, falling back to the backend's English reason, then to nothing. */
export function reasonByCode(
  labels: Readonly<Record<string, string>>,
  code: string | null | undefined,
  fallback: string | null | undefined,
): string {
  return (code ? labels[code] : undefined) ?? fallback ?? "";
}

/** Kd at or above Ke (ADR-0208): a warning only, never a block. Values are ratios. */
export interface KdKeWarning {
  kd: number;
  ke: number;
  /** True when Kd is the reference's indicative figure rather than the confirmed derivation's. */
  indicative: boolean;
}

/**
 * Compare the cost of debt with the cost of equity. The panel's own derivation wins; the reference's
 * indicative Kd (percent points, Rf + mapped spread) is only the fallback before a spread has been applied.
 */
export function kdKeWarning(
  derived: { kd: number | null; ke: number | null },
  indicativeKdPct: number | null | undefined,
): KdKeWarning | null {
  const ke = derived.ke;
  if (ke === null || !Number.isFinite(ke)) return null;
  if (derived.kd !== null && Number.isFinite(derived.kd)) {
    return derived.kd >= ke ? { kd: derived.kd, ke, indicative: false } : null;
  }
  if (typeof indicativeKdPct === "number" && Number.isFinite(indicativeKdPct)) {
    const kd = indicativeKdPct / 100;
    return kd >= ke ? { kd, ke, indicative: true } : null;
  }
  return null;
}

/** Request-body shape of one component for POST /api/projects/[id]/wacc (snake_case contract). */
export function toWaccComponentPayload(c: WaccComponentInput): Record<string, unknown> {
  return {
    key: c.key,
    value: c.value,
    kind: c.kind,
    ...(c.sourceLabel !== undefined ? { source_label: c.sourceLabel } : {}),
    ...(c.anchorRef ? { anchor_ref: c.anchorRef } : {}),
    ...(c.asOf !== undefined ? { as_of: c.asOf } : {}),
    ...(c.rationale !== undefined ? { rationale: c.rationale } : {}),
    ...(c.erpReferenceId ? { erp_reference_id: c.erpReferenceId } : {}),
    ...((c.erpReferenceId || c.taxReferenceBracketId || (c.creditRatingBasis && c.referenceAsOf)) &&
    c.editedFromReference !== undefined
      ? { edited_from_reference: c.editedFromReference }
      : {}),
    ...(c.taxReferenceBracketId ? { tax_reference_bracket_id: c.taxReferenceBracketId } : {}),
    ...(c.taxReferenceBracketId && c.taxReferenceBasis ? { tax_reference_basis: c.taxReferenceBasis } : {}),
    ...(c.creditRatingBasis && c.referenceAsOf
      ? {
          credit_rating_basis: c.creditRatingBasis,
          ...(c.creditRatingSnapshotId ? { credit_rating_snapshot_id: c.creditRatingSnapshotId } : {}),
          reference_as_of: c.referenceAsOf,
        }
      : {}),
  };
}

/** Only https links are rendered as anchors (registry URLs are validated https:// at the source). */
export function safeHttpsUrl(url: string | undefined): string | null {
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}

const DART_VIEWER_URL = "https://dart.fss.or.kr/dsaf001/main.do";

/** DART filing viewer link for a receipt number (14 digits); null for anything else. https only. */
export function dartFilingUrl(rceptNo: string | null | undefined): string | null {
  return typeof rceptNo === "string" && /^\d{14}$/.test(rceptNo) ? `${DART_VIEWER_URL}?rcpNo=${rceptNo}` : null;
}

/** Rating-agency home pages of a credit_spread suggestion; only https links survive. */
export function creditAgencyLinks(e: ReferenceSuggestion): Array<{ agency: string; href: string }> {
  const links: Array<{ agency: string; href: string }> = [];
  for (const l of e.agency_links ?? []) {
    const href = safeHttpsUrl(l.home_url);
    if (href) links.push({ agency: l.agency, href });
  }
  return links;
}

/**
 * Whether the "신용등급 수집 실행" button is offered for a credit_spread suggestion: the backend says a
 * collection could add evidence (`collect_hint`), or the disclosed rating in use is out of date. A company
 * without a DART code has neither - the collection would only answer 400.
 */
export function creditCollectVisible(e: ReferenceSuggestion | undefined): boolean {
  if (!e || e.key !== "credit_spread") return false;
  return (
    e.collect_hint === true ||
    ((e.rating_source === "disclosed" || e.rating_source === "bureau") && e.rating_stale === true)
  );
}

/** Collect endpoint of a project; `targetId` scopes it to a shortlisted target (ADR-0156), like the suggestions GET. */
export function creditCollectUrl(projectId: string, targetId?: string | null): string {
  const base = `/api/projects/${encodeURIComponent(projectId)}/wacc/credit-rating/collect`;
  return targetId ? `${base}?target_id=${encodeURIComponent(targetId)}` : base;
}

/** The disclosed-rating evidence block of a credit_spread suggestion; null unless the rating is a disclosed one. */
export interface DisclosedCreditView {
  rating: string;
  stale: boolean;
  ratedOn: string | null;
  instrument: string | null;
  evidenceKind: CreditEvidenceKind | null;
  agencies: CreditAgencyRating[];
  filingUrl: string | null;
  filingNo: string | null;
  alternative: (CreditRatingAlternative & { filingUrl: string | null }) | null;
}

export function disclosedCreditView(e: ReferenceSuggestion): DisclosedCreditView | null {
  if (e.key !== "credit_spread" || e.rating_source !== "disclosed" || !e.rating) return null;
  const alt = e.rating_alternative ?? null;
  return {
    rating: e.rating,
    stale: e.rating_stale === true,
    ratedOn: e.rating_rated_on ?? null,
    instrument: e.rating_instrument ?? null,
    evidenceKind: e.rating_evidence_kind ?? null,
    agencies: e.rating_agencies ?? [],
    filingUrl: dartFilingUrl(e.source_rcept_no),
    filingNo: e.source_rcept_no ?? null,
    alternative: alt ? { ...alt, filingUrl: dartFilingUrl(alt.source_rcept_no) } : null,
  };
}

/** The credit-bureau issuer-rating evidence block of a credit_spread suggestion; null unless the rating is a bureau one. */
export interface BureauCreditView {
  rating: string;
  stale: boolean;
  ratedOn: string | null;
  evidence: CreditBureauEvidence;
  filingUrl: string | null;
  filingNo: string | null;
}

export function bureauCreditView(e: ReferenceSuggestion): BureauCreditView | null {
  if (e.key !== "credit_spread" || e.rating_source !== "bureau" || !e.rating || !e.rating_bureau) return null;
  return {
    rating: e.rating,
    stale: e.rating_stale === true,
    ratedOn: e.rating_rated_on ?? null,
    evidence: e.rating_bureau,
    filingUrl: dartFilingUrl(e.source_rcept_no),
    filingNo: e.source_rcept_no ?? null,
  };
}

/** The synthetic (interest coverage) evidence block of a credit_spread suggestion; null unless that estimate is the rating in use. */
export interface SyntheticCreditView {
  rating: string;
  coverageX: number;
  interestSource: CreditInterestSource;
  interestIsProxy: boolean;
  fiscalYear: number;
  lossMaking: boolean;
  publishedLabel: string | null;
  tableAsOf: string;
  operatingIncomeKrwMillion: number;
  interestExpenseKrwMillion: number;
  superseded: CreditRatingSuperseded | null;
}

export function syntheticCreditView(e: ReferenceSuggestion): SyntheticCreditView | null {
  const s = e.synthetic;
  if (e.key !== "credit_spread" || e.rating_source !== "synthetic" || !e.rating || !s || !s.available) return null;
  return {
    rating: e.rating,
    coverageX: s.coverage_x,
    interestSource: s.interest_source,
    interestIsProxy: s.interest_is_proxy,
    fiscalYear: s.fiscal_year,
    lossMaking: s.loss_making,
    publishedLabel: s.published_label,
    tableAsOf: s.table_as_of,
    operatingIncomeKrwMillion: s.operating_income_krw_million,
    interestExpenseKrwMillion: s.interest_expense_krw_million,
    superseded: e.rating_superseded ?? null,
  };
}

/**
 * True when the interest figures behind the synthetic rung and the cross-check are missing because the company's DART
 * financials predate the extended collector: a financial re-sync would fill them. The backend says so with `resync_hint`.
 */
export function financialResyncNeeded(e: ReferenceSuggestion | undefined): boolean {
  if (!e || e.key !== "credit_spread") return false;
  const s = e.synthetic;
  return !!s && s.available === false && s.resync_hint === true;
}

/** Cross-check line of a credit_spread suggestion; null unless there is something to say (a gap, or an unreliable reading). */
export interface CrosscheckView {
  status: "ok" | "warn" | "unreliable";
  /** `crosscheck_implied_far_below_market` when the actual cost is far below the market Kd (policy or low-rate funding?). */
  reasonCode: string | null;
  impliedPct: number;
  marketKdPct: number;
  gapPp: number;
  direction: "market_above_actual" | "market_below_actual";
  warnGapPp: number;
  fiscalYear: number | null;
  interestSource: CreditInterestSource | null;
  debtBasis: "two_year_average" | "year_end" | null;
}

export function crosscheckView(e: ReferenceSuggestion): CrosscheckView | null {
  const c = e.crosscheck;
  if (e.key !== "credit_spread" || !c) return null;
  if (c.status !== "ok" && c.status !== "warn") return null;
  if (c.implied_cost_pct === null || c.market_kd_pct === null || c.gap_pp === null || c.direction === null) return null;
  return {
    status: c.status,
    reasonCode: c.reason_code,
    impliedPct: c.implied_cost_pct,
    marketKdPct: c.market_kd_pct,
    gapPp: c.gap_pp,
    direction: c.direction,
    warnGapPp: c.warn_gap_pp,
    fiscalYear: c.fiscal_year,
    interestSource: c.interest_source,
    debtBasis: c.debt_basis,
  };
}

/** Cross-check that could be computed but is unreliable (implied cost below Rf): shown as a plain note, never a warning. */
export function crosscheckUnreliable(e: ReferenceSuggestion): CreditCrosscheck | null {
  const c = e.crosscheck;
  return e.key === "credit_spread" && c?.status === "unreliable" ? c : null;
}

/** Recent bond coupons to show next to the market Kd; empty unless the issuance table was read and has recent issues. */
export function issuanceEvidenceRows(e: ReferenceSuggestion): CreditIssuanceRow[] {
  if (e.key !== "credit_spread" || e.issuance_status !== "available") return [];
  return e.issuance_evidence ?? [];
}
