// ADR-0179 amendment slice B (2026-10-17, design §12.2) — the S2 entry-market
// derivation: a ratio-factor chain over the LINKED S1 market-sizing series.
// `derived(t) = S1_anchor(t) x Πf` — multiplicative ratio factors only, each
// in (0..1], each with a MANDATORY source per step; absolute amounts are
// never accepted (strict key whitelist) and never fabricated. The derived
// value is always COMPUTED at the pinned S1 version's year-1 baseline, never
// stored as an input. Each factor step lowers data confidence
// (non-negotiable #4 — the chain never grades above its weakest step); the
// count is surfaced with the chain. The chain's REACHED scope (the last
// step's region/segment tags when provided) grades exact / partial / none
// against the person-set target scope — advisory per OPEN-1, regions decide,
// never a gate block or grade cap. Validation is strict: an invalid chain is
// a 400 with a reason, never silently dropped.

import type { Database } from "bun:sqlite";
import { parseTargetScopeJson, type TargetScope } from "./target-scope.ts";

/** Sane maximum chain length (design §12.3 slice B). */
export const ENTRY_MARKET_MAX_STEPS = 6;
const SOURCE_MAX = 200;
const NOTE_MAX = 300;
const TAG_MAX = 50;

export interface EntryMarketStep {
  /** Chain base: the first step builds on the S1 anchor, every later step on
   *  the previous step (`step:<i-1>`). Enforced strictly on write. */
  base: "s1_anchor" | `step:${number}`;
  /** Multiplicative ratio in (0..1]. Never an absolute amount. */
  factor: number;
  /** Mandatory non-empty provenance per step — a factor without a source is
   *  never stored (never fabricated). */
  source: string;
  /** Mandatory as-of stamp for the source figure. */
  as_of: string;
  note?: string;
  /** Optional scope tags the step's source REACHES — the last step's tags
   *  are the chain's reached scope for the exact/partial/none grading. */
  region_tags?: string[];
  segment_tags?: string[];
  /** Display-only provenance marker (AI-recommendation addition): the step
   *  came from the draft endpoint. Never affects the math — a person edits,
   *  re-sources and confirms each step; the save stays the audited person
   *  write. */
  origin?: "ai_suggested";
}

export interface EntryMarketDerivation {
  steps: EntryMarketStep[];
  set_by: string;
  set_at: string;
}

export class EntryMarketValidationError extends Error {}

const isNonEmptyStr = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;

const isTagArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((t) => isNonEmptyStr(t, TAG_MAX));

function normalizeStep(raw: unknown, index: number): EntryMarketStep {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new EntryMarketValidationError(`steps[${index}]는 객체여야 합니다.`);
  }
  const s = raw as Record<string, unknown>;
  // Strict key whitelist (design §12.2): absolute amounts have NO accepted
  // field at any step — an unknown key (e.g. amount_krw_m) is a 400, so an
  // absolute figure can never sneak into the chain.
  const ALLOWED = new Set(["base", "factor", "source", "as_of", "note", "region_tags", "segment_tags", "origin"]);
  for (const k of Object.keys(s)) {
    if (!ALLOWED.has(k)) throw new EntryMarketValidationError(`steps[${index}]: 허용되지 않는 필드 "${k}" — 배율 인자는 절대값을 받지 않습니다.`);
  }
  const expectedBase = index === 0 ? "s1_anchor" : `step:${index - 1}`;
  if (s.base !== expectedBase) {
    throw new EntryMarketValidationError(`steps[${index}].base는 "${expectedBase}"여야 합니다 (사슬은 순서대로 이전 단계 위에 쌓입니다).`);
  }
  if (typeof s.factor !== "number" || !Number.isFinite(s.factor) || s.factor <= 0 || s.factor > 1) {
    throw new EntryMarketValidationError(`steps[${index}].factor는 (0, 1] 범위의 배율이어야 합니다.`);
  }
  if (!isNonEmptyStr(s.source, SOURCE_MAX)) {
    throw new EntryMarketValidationError(`steps[${index}].source는 ${SOURCE_MAX}자 이하의 비어있지 않은 문자열이어야 합니다 (출처 필수).`);
  }
  if (!isNonEmptyStr(s.as_of, 32)) {
    throw new EntryMarketValidationError(`steps[${index}].as_of는 비어있지 않은 기준 시점이어야 합니다.`);
  }
  const step: EntryMarketStep = { base: expectedBase as EntryMarketStep["base"], factor: s.factor, source: s.source.trim(), as_of: s.as_of.trim() };
  if (s.origin !== undefined && s.origin !== "ai_suggested") {
    throw new EntryMarketValidationError(`steps[${index}].origin은 "ai_suggested"만 허용됩니다.`);
  }
  if (s.origin === "ai_suggested") step.origin = "ai_suggested";
  if (s.note !== undefined) {
    if (!isNonEmptyStr(s.note, NOTE_MAX)) throw new EntryMarketValidationError(`steps[${index}].note는 ${NOTE_MAX}자 이하여야 합니다.`);
    step.note = s.note.trim();
  }
  if (s.region_tags !== undefined) {
    if (!isTagArray(s.region_tags)) throw new EntryMarketValidationError(`steps[${index}].region_tags는 비어있지 않은 문자열 배열이어야 합니다.`);
    step.region_tags = [...new Set(s.region_tags.map((t) => t.trim()))];
  }
  if (s.segment_tags !== undefined) {
    if (!isTagArray(s.segment_tags)) throw new EntryMarketValidationError(`steps[${index}].segment_tags는 비어있지 않은 문자열 배열이어야 합니다.`);
    step.segment_tags = [...new Set(s.segment_tags.map((t) => t.trim()))];
  }
  return step;
}

/** Validate + normalize a PUT body (before set_by/set_at are stamped).
 *  Throws EntryMarketValidationError with a Korean message on any deviation —
 *  callers must surface it as a 400, never as a silent drop. */
export function normalizeEntryMarketDerivationInput(body: unknown): { steps: EntryMarketStep[] } {
  if (typeof body !== "object" || body === null) throw new EntryMarketValidationError("본문은 객체여야 합니다.");
  const o = body as Record<string, unknown>;
  if (!Array.isArray(o.steps) || o.steps.length === 0) {
    throw new EntryMarketValidationError("steps는 1개 이상의 단계 배열이어야 합니다 (지우려면 steps: null).");
  }
  if (o.steps.length > ENTRY_MARKET_MAX_STEPS) {
    throw new EntryMarketValidationError(`steps는 최대 ${ENTRY_MARKET_MAX_STEPS}단계까지입니다.`);
  }
  return { steps: o.steps.map((s, i) => normalizeStep(s, i)) };
}

/** Parse + validate the raw JSON text of entry_market_derivation_json.
 *  Strict: throws on any deviation (the CHECK constraint should keep invalid
 *  JSON out, but hand-written rows must fail loudly on a strict read). */
export function parseEntryMarketDerivationJson(raw: string | null | undefined): EntryMarketDerivation | null {
  if (raw == null || raw === "") return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new EntryMarketValidationError("entry_market_derivation_json이 유효한 JSON이 아닙니다.");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new EntryMarketValidationError("entry market derivation은 객체여야 합니다.");
  }
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.steps) || o.steps.length === 0 || o.steps.length > ENTRY_MARKET_MAX_STEPS) {
    throw new EntryMarketValidationError(`steps는 1..${ENTRY_MARKET_MAX_STEPS}단계여야 합니다.`);
  }
  if (typeof o.set_by !== "string" || o.set_by.trim() === "" || typeof o.set_at !== "string" || o.set_at.trim() === "") {
    throw new EntryMarketValidationError("set_by와 set_at은 필수 문자열입니다.");
  }
  return { steps: o.steps.map((s, i) => normalizeStep(s, i)), set_by: o.set_by, set_at: o.set_at };
}

/** Tolerant target-scope read (untrusted column): null on any deviation,
 *  never a throw — mirrors the generator's defensive parse. */
export function parseTargetScopeJsonSafe(raw: string | null | undefined): TargetScope | null {
  try {
    return parseTargetScopeJson(raw);
  } catch {
    return null;
  }
}

/** The year-1 S1 anchor value from a market_sizing_version matrix payload
 *  (payload.anchor.total — the same tolerant read the sizing-link GET uses).
 *  Returns null when absent or unparsable, never a throw. */
export function readS1AnchorYear1(payload: string | null | undefined): number | null {
  if (payload == null) return null;
  try {
    const matrix = JSON.parse(payload) as { anchor?: { total?: unknown } };
    return typeof matrix?.anchor?.total === "number" ? matrix.anchor.total : null;
  } catch {
    return null;
  }
}

export interface EntryMarketChainStepResult {
  base: EntryMarketStep["base"];
  factor: number;
  input: number;
  result: number;
}

export interface EntryMarketComputed {
  anchor_value_krw_m: number;
  factor_product: number;
  entry_market_krw_m: number;
  steps: EntryMarketChainStepResult[];
}

/** Compute the derived entry-market value (always COMPUTED, never stored):
 *  the S1 year-1 anchor composed with the ordered factors. */
export function computeEntryMarketChain(anchorValue: number, steps: readonly EntryMarketStep[]): EntryMarketComputed {
  const out: EntryMarketChainStepResult[] = [];
  let cur = anchorValue;
  let product = 1;
  for (const s of steps) {
    const result = cur * s.factor;
    out.push({ base: s.base, factor: s.factor, input: cur, result });
    cur = result;
    product *= s.factor;
  }
  return { anchor_value_krw_m: anchorValue, factor_product: product, entry_market_krw_m: cur, steps: out };
}

/** Stable derivation hash over the canonical ordered chain (FNV-1a, the same
 *  family as the generator's scenarioSeed) — provenance in the run note. */
export function derivationHash(steps: readonly EntryMarketStep[]): string {
  let h = 0x811c9dc5;
  for (const i of canonicalStepKey(steps)) {
    h ^= i.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16);
}

function canonicalStepKey(steps: readonly EntryMarketStep[]): string {
  return JSON.stringify(
    steps.map((s) => ({ b: s.base, f: s.factor, s: s.source, a: s.as_of, n: s.note ?? null, r: s.region_tags ?? null, g: s.segment_tags ?? null, o: s.origin ?? null })),
  );
}

/** The chain's REACHED scope: the LAST step's region/segment tags when
 *  provided, null (→ honest `unknown`) otherwise. */
export function reachedScopeOf(steps: readonly EntryMarketStep[]): { regions: string[]; segments: string[] } | null {
  const last = steps[steps.length - 1];
  if (!last?.region_tags || last.region_tags.length === 0) return null;
  return { regions: last.region_tags, segments: last.segment_tags ?? [] };
}

export type EntryMarketScopeStatus = "exact" | "partial" | "none" | "unknown";

export interface EntryMarketScopeVerdict {
  status: EntryMarketScopeStatus;
  reason: string;
}

/** Advisory grading (OPEN-1) of the chain's REACHED scope against the
 *  person-set target scope. Regions decide: exact = target regions a subset
 *  of the reached regions; partial = overlapping but not covering; none =
 *  disjoint. Never a gate block — confidence-lowering evidence only. */
export function compareReachedScope(
  reached: { regions: readonly string[] } | null,
  targetScope: TargetScope | null,
): EntryMarketScopeVerdict {
  if (!targetScope) return { status: "unknown", reason: "대상 범위 미설정 — 사슬 도달 범위 비교 불가" };
  if (!reached) return { status: "unknown", reason: "마지막 단계에 범위 태그 미기재 — 도달 범위 미확인" };
  const reachedSet = new Set(reached.regions);
  const target = targetScope.regions;
  if (target.every((r) => reachedSet.has(r))) {
    return { status: "exact", reason: `대상 범위(${target.join(", ")})가 사슬 도달 범위(${reached.regions.join(", ")})에 포함됨` };
  }
  if (target.some((r) => reachedSet.has(r))) {
    return { status: "partial", reason: `대상 범위(${target.join(", ")})와 사슬 도달 범위(${reached.regions.join(", ")})가 부분적으로 겹침` };
  }
  return { status: "none", reason: `대상 범위(${target.join(", ")})와 사슬 도달 범위(${reached.regions.join(", ")})가 겹치지 않음` };
}

export const ENTRY_MARKET_CONFIDENCE_NOTE =
  "각 배율 단계는 데이터 신뢰도를 하향합니다 — 사슬은 가장 약한 단계보다 높게 평가될 수 없습니다 (ADR-0179 수정안, 불변 경계 #4). 출처 없는 인자는 저장되지 않으며, 지역 인자의 출처는 2022년 이후 지역 정의 차이(M49 기준 러시아는 동유럽)를 명시해야 합니다.";

/** Region-source-definition caveat (design §12.2): shown with any step whose
 *  source is a region-level figure. */
export const REGION_DEFINITION_CAVEAT =
  "출처기관마다 지역 정의가 다릅니다 (2022년 이후 '유럽'에 러시아 포함 여부 등; UN M49는 러시아를 동유럽으로 분류) — 지역 인자의 출처는 자신의 지역 정의를 명시해야 합니다.";

/** Advisory scope comparison note (OPEN-1): segments are never compared. */
export const ENTRY_MARKET_SCOPE_NOTE =
  "참고 정보이며 승인 조건이 아닙니다 — 세그먼트는 비교하지 않고 지역으로만 판정하며(OPEN-1 자문), 미해결 상태는 데이터 신뢰도 하향 근거로 기록됩니다 (불변 경계 #4).";

export function confidenceLoweringCount(steps: readonly EntryMarketStep[]): number {
  return steps.length;
}

/** Consumption read-model (design §12.2): when the opportunity has BOTH a
 *  pinned S1 link AND a derivation chain, this returns the DERIVED
 *  entry-market value for the year-1 baseline of the pinned version, the
 *  provenance (step count + derivation hash) and the reached-scope verdict
 *  against the opportunity's target scope. Tolerant by contract: no link, a
 *  deleted version row, an unparsable payload or an unparsable derivation
 *  column all yield null → the caller keeps the legacy bare anchor
 *  (bit-identical), never a throw, never a fabricated factor. */
export function resolveDerivedEntryMarket(
  db: Database,
  opportunityId: string,
): { entry_market_krw_m: number; steps: number; hash: string; factor_product: number; scope_status: EntryMarketScopeStatus } | null {
  try {
    const row = db
      .query(
        "SELECT o.entry_market_derivation_json AS der, o.target_scope_json AS scope_json, mv.payload AS payload" +
          " FROM opportunity o LEFT JOIN market_sizing_version mv ON mv.id = o.sizing_version_id WHERE o.id = ?",
      )
      .get(opportunityId) as { der: string | null; scope_json: string | null; payload: string | null } | undefined;
    if (!row?.der || !row.payload) return null;
    const derivation = parseEntryMarketDerivationJson(row.der);
    if (!derivation) return null;
    const anchor = readS1AnchorYear1(row.payload);
    if (anchor == null || !Number.isFinite(anchor) || anchor <= 0) return null;
    const computed = computeEntryMarketChain(anchor, derivation.steps);
    const targetScope = parseTargetScopeJsonSafe(row.scope_json);
    const reached = reachedScopeOf(derivation.steps);
    return {
      entry_market_krw_m: computed.entry_market_krw_m,
      steps: derivation.steps.length,
      hash: derivationHash(derivation.steps),
      factor_product: computed.factor_product,
      scope_status: compareReachedScope(reached, targetScope).status,
    };
  } catch {
    return null; // unparsable stored column degrades to the legacy anchor, never blocks
  }
}

/** Run-note fragment — appended ONLY when a derived entry-market actually
 *  replaced the anchor, so every other note stays byte-identical. */
export function entryMarketNoteFragment(entryMarket: { steps: number; hash: string; scope_status: EntryMarketScopeStatus } | null | undefined): string {
  if (!entryMarket) return "";
  const scope = entryMarket.scope_status === "unknown" ? "" : `; entry_market_scope=${entryMarket.scope_status}`;
  return `; entry_market=derived; entry_market_steps=${entryMarket.steps}; entry_market_hash=${entryMarket.hash}${scope}`;
}
