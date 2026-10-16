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

export interface TargetScope {
  regions: TargetScopeRegion[];
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
    throw new TargetScopeValidationError("target_scope_json이 유효한 JSON이 아닙니다.");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new TargetScopeValidationError("target scope는 객체여야 합니다.");
  }
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.regions) || o.regions.length === 0 || !o.regions.every(isTargetScopeRegion)) {
    throw new TargetScopeValidationError(`regions는 ${TARGET_SCOPE_REGIONS.join(", ")} 중 하나 이상이어야 합니다.`);
  }
  if (o.regions.includes("worldwide") && o.regions.length > 1) {
    throw new TargetScopeValidationError("worldwide는 다른 지역과 함께 선택할 수 없습니다.");
  }
  if (!Array.isArray(o.segments) || !o.segments.every((s) => typeof s === "string" && s.trim().length > 0 && s.length <= 100)) {
    throw new TargetScopeValidationError("segments는 100자 이하의 비어있지 않은 문자열 배열이어야 합니다.");
  }
  const segments = [...new Set((o.segments as string[]).map((s) => s.trim()))];
  if (!isTargetScopeUnitBasis(o.unit_basis)) {
    throw new TargetScopeValidationError(`unit_basis는 ${TARGET_SCOPE_UNIT_BASES.join(", ")} 중 하나여야 합니다.`);
  }
  if (typeof o.set_by !== "string" || o.set_by.trim() === "" || typeof o.set_at !== "string" || o.set_at.trim() === "") {
    throw new TargetScopeValidationError("set_by와 set_at은 필수 문자열입니다.");
  }
  return { regions: o.regions, segments, unit_basis: o.unit_basis, set_by: o.set_by, set_at: o.set_at };
}

/** Validate + normalize a PUT body (before set_by/set_at are stamped). */
export function normalizeTargetScopeInput(body: unknown): Pick<TargetScope, "regions" | "segments" | "unit_basis"> {
  if (typeof body !== "object" || body === null) throw new TargetScopeValidationError("본문은 객체여야 합니다.");
  const o = body as Record<string, unknown>;
  if (!Array.isArray(o.regions) || o.regions.length === 0 || !o.regions.every(isTargetScopeRegion)) {
    throw new TargetScopeValidationError(`regions는 ${TARGET_SCOPE_REGIONS.join(", ")} 중 하나 이상이어야 합니다.`);
  }
  if (o.regions.includes("worldwide") && o.regions.length > 1) {
    throw new TargetScopeValidationError("worldwide는 다른 지역과 함께 선택할 수 없습니다.");
  }
  if (!Array.isArray(o.segments)) throw new TargetScopeValidationError("segments는 문자열 배열이어야 합니다.");
  const segments = [...new Set((o.segments as unknown[]).map((s) => String(s).trim()).filter((s) => s.length > 0))];
  for (const s of segments) {
    if (s.length > 100) throw new TargetScopeValidationError("segments 항목은 100자 이하여야 합니다.");
  }
  if (!isTargetScopeUnitBasis(o.unit_basis)) {
    throw new TargetScopeValidationError(`unit_basis는 ${TARGET_SCOPE_UNIT_BASES.join(", ")} 중 하나여야 합니다.`);
  }
  return { regions: o.regions as TargetScopeRegion[], segments, unit_basis: o.unit_basis };
}
