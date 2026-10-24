// ADR-0179 slice 1 — structured target scope (target_scope_json) on the
// promoting opportunity. A person (analyst+) records WHICH scope the deal
// addresses: a fixed region enum (the region-profiles taxonomy plus
// worldwide, design §4.1/OPEN-1), free segment tags, and the anchor's unit
// basis. Slice 1 only stores and displays it — comparison against the market
// anchor is slice 2. Invalid JSON is a 400, never silently dropped.

// Region enum revised by the decider (chat 2026-10-16): eu->we (서유럽) and
// us->na (북미) renames, sa/af/me/ru/ee added. The feature shipped hours
// earlier and the dev DB held ZERO stored target_scope_json rows (checked
// read-only 2026-10-16), so this is a clean enum swap — no us/eu
// normalization path exists. worldwide stays mutually exclusive.
export const TARGET_SCOPE_REGIONS = ["kr", "we", "ee", "ru", "na", "cn", "sea", "sa", "af", "me", "worldwide"] as const;
export type TargetScopeRegion = (typeof TARGET_SCOPE_REGIONS)[number];

export const TARGET_SCOPE_UNIT_BASES = ["krw_m_year", "units_year", "usd_m_year"] as const;
export type TargetScopeUnitBasis = (typeof TARGET_SCOPE_UNIT_BASES)[number];

export const TARGET_SCOPE_UNIT_BASIS_LABEL: Record<TargetScopeUnitBasis, string> = {
  krw_m_year: "연매출 (백만원/년)",
  units_year: "판매대수 (대/년)",
  usd_m_year: "연매출 (백만 USD/년)",
};

/** ADR-0181 amendment (2026-10-18, decider feedback): the anchor unit may
 *  carry a SCALE — third-party market reports quote sizes in USD billions,
 *  so `usd_b_year` (십억 달러/년) and friends are valid declarations. The
 *  known-enum list stays for the common picker options; any
 *  `<ccy>_[mb]_year` pattern is accepted. */
export const UNIT_BASIS_PATTERN = /^(krw_m_year|units_year|[a-z]{3}_[mb]_year)$/;

export function isKnownUnitBasis(v: string): boolean {
  return (TARGET_SCOPE_UNIT_BASES as readonly string[]).includes(v) || /^[a-z]{3}_[mb]_year$/.test(v);
}

/** Label for any declared unit basis, including the multi-currency/scale
 *  patterns (fallback = the raw declaration). */
export function unitBasisLabel(v: string | null | undefined): string {
  if (!v) return "미선언";
  const known = (TARGET_SCOPE_UNIT_BASIS_LABEL as Record<string, string>)[v];
  if (known) return known;
  const m = v.match(/^([a-z]{3})_([mb])_year$/);
  if (m) {
    const ccy = m[1].toUpperCase();
    const scale = m[2] === "b" ? "십억" : "백만";
    return `연매출 (${scale} ${ccy}/년)`;
  }
  return v;
}

/** Slice 4 (design §5.2, OD-3): caption shown next to unit_basis once it
 *  renders as DATA inside the linked-S1 reference strip. The strip shows the
 *  value the PUT body carries — it must never read as an absolute input. */
export const SCOPE_UNIT_BASIS_CAPTION = "앵커의 단위 구분 — 절대값 입력이 아닙니다";

/** ADR-0181 amendment (2026-10-18): resolve the anchor's DECLARED unit — the
 *  person-saved scope wins, then the LINKED version's declared unit_basis.
 *  UNDECLARED yields NULL (not a krw default): an unknown unit can never be
 *  labelled as 백만원/년 or converted — the surfaces show an honest
 *  `앵커 단위 미선언` warning and the 원화 개산 stays disabled until a person
 *  declares the unit. */
export function resolveUnitBasis(
  saved: string | null | undefined,
  linked: string | null | undefined,
): string | null {
  for (const v of [saved, linked]) {
    if (typeof v === "string" && UNIT_BASIS_PATTERN.test(v)) return v;
  }
  return null;
}

export interface TargetScope {
  /** ADR-0181 §4 — the region vocabulary is OPEN: the linked S1 matrix's
   *  codes plus the fixed enum (`worldwide` stays exclusive). The enum check
   *  lives at the WRITE path; storage/read accept any non-empty code. */
  regions: string[];
  segments: string[];
  unit_basis: TargetScopeUnitBasis;
  set_by: string;
  set_at: string;
}

export class TargetScopeValidationError extends Error {}

const isTargetScopeRegion = (v: unknown): v is TargetScopeRegion =>
  typeof v === "string" && (TARGET_SCOPE_REGIONS as readonly string[]).includes(v);

const isTargetScopeUnitBasis = (v: unknown): v is TargetScopeUnitBasis =>
  typeof v === "string" && (TARGET_SCOPE_UNIT_BASES as readonly string[]).includes(v);

/** Parse + validate the raw JSON text of target_scope_json. Throws
 *  TargetScopeValidationError with a Korean message on any deviation —
 *  callers must surface it as a 400, never as a silent null. */
export function parseTargetScopeJson(raw: string | null | undefined): TargetScope | null {
  if (raw == null || raw === "") return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new TargetScopeValidationError("target_scope_json is not valid JSON.");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new TargetScopeValidationError("The target scope must be an object.");
  }
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.regions) || o.regions.length === 0 || !o.regions.every(isTargetScopeRegion)) {
    throw new TargetScopeValidationError(`regions must include at least one of: ${TARGET_SCOPE_REGIONS.join(", ")}.`);
  }
  if (o.regions.includes("worldwide") && o.regions.length > 1) {
    throw new TargetScopeValidationError("worldwide cannot be combined with other regions.");
  }
  if (!Array.isArray(o.segments) || !o.segments.every((s) => typeof s === "string" && s.trim().length > 0 && s.length <= 100)) {
    throw new TargetScopeValidationError("segments must be an array of non-empty strings of at most 100 characters.");
  }
  const segments = [...new Set((o.segments as string[]).map((s) => s.trim()))];
  if (!isTargetScopeUnitBasis(o.unit_basis)) {
    throw new TargetScopeValidationError(`unit_basis must be one of: ${TARGET_SCOPE_UNIT_BASES.join(", ")}.`);
  }
  if (typeof o.set_by !== "string" || o.set_by.trim() === "" || typeof o.set_at !== "string" || o.set_at.trim() === "") {
    throw new TargetScopeValidationError("Both set_by and set_at are required strings.");
  }
  return { regions: o.regions, segments, unit_basis: o.unit_basis, set_by: o.set_by, set_at: o.set_at };
}

/** Validate + normalize a PUT body (before set_by/set_at are stamped). */
export function normalizeTargetScopeInput(body: unknown): Pick<TargetScope, "regions" | "segments" | "unit_basis"> {
  if (typeof body !== "object" || body === null) throw new TargetScopeValidationError("The body must be an object.");
  const o = body as Record<string, unknown>;
  if (!Array.isArray(o.regions) || o.regions.length === 0 || !o.regions.every(isTargetScopeRegion)) {
    throw new TargetScopeValidationError(`regions must include at least one of: ${TARGET_SCOPE_REGIONS.join(", ")}.`);
  }
  if (o.regions.includes("worldwide") && o.regions.length > 1) {
    throw new TargetScopeValidationError("worldwide cannot be combined with other regions.");
  }
  if (!Array.isArray(o.segments)) throw new TargetScopeValidationError("segments must be an array of strings.");
  const segments = [...new Set((o.segments as unknown[]).map((s) => String(s).trim()).filter((s) => s.length > 0))];
  for (const s of segments) {
    if (s.length > 100) throw new TargetScopeValidationError("Each segment must be at most 100 characters.");
  }
  if (!isTargetScopeUnitBasis(o.unit_basis)) {
    throw new TargetScopeValidationError(`unit_basis must be one of: ${TARGET_SCOPE_UNIT_BASES.join(", ")}.`);
  }
  return { regions: o.regions as TargetScopeRegion[], segments, unit_basis: o.unit_basis };
}
