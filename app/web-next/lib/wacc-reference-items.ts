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
    ...((c.erpReferenceId || c.taxReferenceBracketId) && c.editedFromReference !== undefined
      ? { edited_from_reference: c.editedFromReference }
      : {}),
    ...(c.taxReferenceBracketId ? { tax_reference_bracket_id: c.taxReferenceBracketId } : {}),
    ...(c.taxReferenceBracketId && c.taxReferenceBasis ? { tax_reference_basis: c.taxReferenceBasis } : {}),
  };
}

/** Only https links are rendered as anchors (registry URLs are validated https:// at the source). */
export function safeHttpsUrl(url: string | undefined): string | null {
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}
