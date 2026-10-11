// Maps db/lib/wacc-reference.ts output to the company financials screen
// payload (design 2026-10-11-company-financials-wacc-reference-fix).
// Pure: no DB access, no writes.
import type { WaccReference, ReferenceEntry } from "../../../db/lib/wacc-reference.ts";

/** ECOS 721Y001 DATA_VALUE is stored as percent points (2.85 = 2.85%);
 *  the adapter parses it with Number() and declares unitCode "percent". */
export const ECOS_PERCENT_DIVISOR = 100;

export const BETA_PENDING_REASON = "KRX data-use approval pending";
export const REFERENCE_UNAVAILABLE_REASON = "reference could not be computed";
export const WACC_DISCLAIMER =
  "제안값일 뿐입니다 — 값의 확정은 WACC 입력 세션에서 사람이 합니다.";

export interface CompanyWaccEntry {
  key: string;
  label: string;
  value: number | null;
  unit: "ratio" | "multiple";
  as_of: string | null;
  anchor_ref: string | null;
  source_label: string | null;
  reason: string | null;
  note: string | null;
}

export interface CompanyWaccReference {
  subject: { id: string; name_ko: string | null };
  entries: CompanyWaccEntry[];
  latest_year: string | null;
  missing: string[];
  disclaimer: string;
}

const RATE_KEYS = new Set(["risk_free", "credit_spread"]);
const KEY_ORDER = ["risk_free", "credit_spread", "observed_de", "beta_levered"];

function mapEntry(e: ReferenceEntry): CompanyWaccEntry {
  const isRate = RATE_KEYS.has(e.key);
  return {
    key: e.key,
    label: e.label,
    value: e.value === null ? null : isRate ? e.value / ECOS_PERCENT_DIVISOR : e.value,
    unit: isRate ? "ratio" : "multiple",
    as_of: e.as_of,
    anchor_ref: e.anchor_ref,
    source_label: e.source_label,
    reason: e.value === null ? e.reason : null,
    note: e.value === null ? null : (e.note ?? null),
  };
}

export function toCompanyWaccReferencePayload(
  ref: WaccReference | null,
  opts: { subject: { id: string; name_ko: string | null }; latestYear: string | null },
): CompanyWaccReference {
  const mapped = new Map<string, CompanyWaccEntry>();
  if (ref) for (const e of ref.entries) mapped.set(e.key, mapEntry(e));
  const fallback = (key: string, label: string, unit: "ratio" | "multiple"): CompanyWaccEntry => ({
    key, label, value: null, unit, as_of: null, anchor_ref: null, source_label: null,
    reason: REFERENCE_UNAVAILABLE_REASON, note: null,
  });
  if (!mapped.has("risk_free")) mapped.set("risk_free", fallback("risk_free", "무위험이자율 (Rf)", "ratio"));
  if (!mapped.has("credit_spread")) mapped.set("credit_spread", fallback("credit_spread", "신용등급 가산금리", "ratio"));
  if (!mapped.has("observed_de")) mapped.set("observed_de", fallback("observed_de", "관측 D/E", "multiple"));
  if (!mapped.has("beta_levered")) {
    mapped.set("beta_levered", {
      key: "beta_levered", label: "베타 (레버드)", value: null, unit: "multiple",
      as_of: null, anchor_ref: null, source_label: null, reason: BETA_PENDING_REASON, note: null,
    });
  }
  const entries = KEY_ORDER.map((k) => mapped.get(k)!);
  return {
    subject: opts.subject,
    entries,
    latest_year: opts.latestYear,
    missing: entries.filter((e) => e.value === null).map((e) => e.key),
    disclaimer: WACC_DISCLAIMER,
  };
}
