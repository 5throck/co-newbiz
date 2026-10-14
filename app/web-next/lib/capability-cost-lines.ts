// ADR-0173 slice 1 (Proposed; decider approved Option A): S5 capability closing cost lines and
// milestone candidates. Pure and client-safe (no db, no node:crypto) so the S5 screen and the
// route share one derivation. Decision support only: reflection is a per-line human choice, the
// server recomputes every capability amount from the live judgement, nothing is a gate or a cap.
import { RESOLUTION_LABEL, type CapabilityGapRow, type GapResolution, type MilestoneCandidate } from "./capability-gap.ts";
import { isStale, sha256Hex } from "./capability-linkage.ts";

export type CostCategory = "labor" | "opex" | "capex";
/** Categories a capability line may carry (cost side of the S8 vocabulary). */
export const CAPABILITY_COST_CATEGORIES: readonly CostCategory[] = ["labor", "opex", "capex"];
export const CAPABILITY_BLOCK_TITLE = "역량 해소 비용 (S5 판정에서 연동)";
export const MILESTONE_BLOCK_TITLE = "마일스톤 후보 (사후관리 연동 예정)";
export const MILESTONE_START_NOTE = "착수일은 S11 기준선을 확정할 때 정해집니다.";

/** The judgement fields this feature reads (a subset of AttainabilityRowView, so server and client share it). */
export interface CostSourceRow {
  id: string;
  capability: string;
  resolution: GapResolution | null;
  closing_cost_krw_m: number | null;
  months_to_attain: number | null;
  grade: string | null;
  /** Null when unconfirmed or stale (rowView clears it for stale rows). */
  confirmed_at: string | null;
  stale: boolean;
}

export const sourceRowOf = (r: CapabilityGapRow): CostSourceRow => {
  const a = r.attainability;
  const stale = isStale(r);
  return {
    id: r.id,
    capability: r.capability,
    resolution: r.resolution,
    closing_cost_krw_m: a?.closingCostKrwM ?? null,
    months_to_attain: a?.monthsToAttain ?? null,
    grade: a?.grade ?? null,
    confirmed_at: stale ? null : a?.confirmedAt ?? null,
    stale,
  };
};

// ── Units ───────────────────────────────────────────────────────────────────

/** 백만원 to 억 for display: 2 decimals. The exact 백만원 value is always kept alongside. */
export const eokOf = (krwM: number): number => Math.round((krwM / 100) * 100) / 100;
/** Stored line amount (억, exact): 1 억 = 100 백만원. */
export const exactEokOf = (krwM: number): number => krwM / 100;
export const formatEok = (krwM: number): string => `${eokOf(krwM).toFixed(2)}억`;

// ADR-0173 amendment 2026-10-15 (decider): the S5 investment section shows and stores 백만원 (KRW million) everywhere.
/** Every line written from now on carries this marker; a line without it is legacy (amount in 억). */
export const AMOUNT_UNIT_KRW_M = "krw_m" as const;
/** 억 to 백만원, value-preserving: integer-safe rounding to 0.01 백만원 (0.35억 -> 35, no float drift). */
export const eokToKrwM = (eok: number): number => (Number.isFinite(eok) ? Math.round(eok * 10000) / 100 : 0);
/** A stored/posted line amount in 백만원: krw_m lines as is, legacy lines (no marker) converted from 억. */
export const lineAmountKrwM = (l: { amount?: unknown; amountUnit?: unknown }): number => {
  const n = typeof l.amount === "number" && Number.isFinite(l.amount) ? l.amount : Number(l.amount) || 0;
  return l.amountUnit === AMOUNT_UNIT_KRW_M ? Math.round(n * 100) / 100 : eokToKrwM(n);
};
/** "1,250백만원" (up to 2 decimals, thousands separators). */
export const formatKrwM = (krwM: number): string => `${(Math.round(krwM * 100) / 100).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}백만원`;

// ── Category mapping (design 4.3, OD-2) ─────────────────────────────────────

export function suggestCategory(resolution: GapResolution | null): { category: CostCategory; alternative: CostCategory | null; hint: string | null } {
  switch (resolution) {
    case "build": return { category: "capex", alternative: "labor", hint: null };
    case "hire": return { category: "labor", alternative: null, hint: null };
    case "partner": return { category: "opex", alternative: null, hint: null };
    case "invest": return { category: "capex", alternative: null, hint: null };
    default: return { category: "capex", alternative: null, hint: "확인 필요: 해소 방식이 정해지지 않아 설비투자로 제안했습니다." };
  }
}

// ── Basis hash (staleness of a reflected amount) ────────────────────────────

/** Hash of what the amount depends on: cost, months, resolution, grade and the effective confirmation. */
export function costBasisHash(r: CostSourceRow): string {
  return `c1:${sha256Hex(JSON.stringify({ cost: r.closing_cost_krw_m, months: r.months_to_attain, resolution: r.resolution, grade: r.grade, confirmed: r.confirmed_at !== null })).slice(0, 16)}`;
}

// ── Stored entries ──────────────────────────────────────────────────────────

export interface StoredCapabilityEntry {
  line: string;
  category: CostCategory;
  /** 백만원 (amountUnit "krw_m"); legacy entries without the marker hold 억. */
  amount: number;
  amountUnit?: typeof AMOUNT_UNIT_KRW_M;
  currency: "KRW";
  period: "lumpsum";
  note: string;
  source: "capability";
  capabilityKey: string;
  reflected: boolean;
  basisHash: string;
  /** Last-seen exact 백만원 (informational; the live judgement is authoritative). */
  costKrwM: number;
  reflectedBy?: string;
  reflectedAt?: string;
}

export const isCapabilityEntry = (x: unknown): x is Partial<StoredCapabilityEntry> & { capabilityKey: string } =>
  !!x && typeof x === "object" && (x as { source?: unknown }).source === "capability" && typeof (x as { capabilityKey?: unknown }).capabilityKey === "string";

// ── Derived lines ───────────────────────────────────────────────────────────

export interface CapabilityCostLine {
  capabilityKey: string;
  name: string;
  line: string;
  resolution: GapResolution | null;
  resolutionLabel: string;
  costKrwM: number;
  amountEok: number;
  suggestedCategory: CostCategory;
  alternativeCategory: CostCategory | null;
  categoryHint: string | null;
  /** The category in effect: the stored one when present, else the suggestion. */
  category: CostCategory;
  monthsToAttain: number | null;
  /** 반영 가능 = confirmed and not stale; 참고(미반영) otherwise. */
  state: "reflectable" | "reference";
  stateLabel: string;
  /** Why the checkbox is disabled (only when it is not reflected yet). */
  disabledReason: string | null;
  /** Effective checkbox state: stored value, else the default rule (OD-1). */
  reflected: boolean;
  /** True when an entry for this capability is already stored. */
  persisted: boolean;
  stale: boolean;
  /** Reflected but the judgement is stale or changed since reflect time (OD-7): stays reflected, flagged. */
  needsRejudge: boolean;
  /** Reflected amount differs from the live one (the amount follows the judgement). */
  amountChanged: boolean;
  previousAmountEok: number | null;
  previousAmountKrwM: number | null;
  basisHash: string;
}

export interface OrphanCapabilityEntry { capabilityKey: string; line: string; reflected: boolean; reason: "deleted" | "no_cost" }

export interface CapabilityCostView {
  lines: CapabilityCostLine[];
  orphans: OrphanCapabilityEntry[];
  totals: {
    capabilityKrwM: number;
    reflectedKrwM: number;
    reflectedCount: number;
    needsRejudgeCount: number;
  };
}

export function deriveCapabilityCostLines(rows: CostSourceRow[], stored: unknown): CapabilityCostView {
  const entries = Array.isArray(stored) ? stored.filter(isCapabilityEntry) : [];
  const byKey = new Map(entries.map((e) => [e.capabilityKey, e]));
  const lines: CapabilityCostLine[] = [];
  for (const r of rows) {
    const cost = r.closing_cost_krw_m;
    if (cost === null || !(cost > 0)) continue;
    const e = byKey.get(r.id);
    const reflectable = r.confirmed_at !== null && !r.stale;
    const sug = suggestCategory(r.resolution);
    const reflected = e ? e.reflected === true : reflectable;
    const hash = costBasisHash(r);
    const storedAmount = typeof e?.amount === "number" ? lineAmountKrwM(e) : null;
    const category = e && CAPABILITY_COST_CATEGORIES.includes(e.category as CostCategory) ? (e.category as CostCategory) : sug.category;
    lines.push({
      capabilityKey: r.id,
      name: r.capability,
      line: `${r.capability} 역량 해소`,
      resolution: r.resolution,
      resolutionLabel: r.resolution ? RESOLUTION_LABEL[r.resolution] : "미정",
      costKrwM: cost,
      amountEok: eokOf(cost),
      suggestedCategory: sug.category,
      alternativeCategory: sug.alternative,
      categoryHint: sug.hint,
      category,
      monthsToAttain: r.months_to_attain,
      state: reflectable ? "reflectable" : "reference",
      stateLabel: reflectable ? "반영 가능" : "참고(미반영)",
      disabledReason: reflectable || (e?.reflected === true) ? null : r.stale ? "S3 내용이 바뀌어 재판정이 필요합니다 — 재판정·확정 후 반영할 수 있습니다." : "사람이 확정한 판정만 반영할 수 있습니다 — 판정을 확정하세요.",
      reflected,
      persisted: !!e,
      stale: r.stale,
      needsRejudge: reflected && (r.stale || (!!e && e.reflected === true && !!e.basisHash && e.basisHash !== hash)),
      amountChanged: !!e && e.reflected === true && storedAmount !== null && Math.abs(storedAmount - cost) > 1e-6,
      previousAmountEok: storedAmount !== null ? eokOf(storedAmount) : null,
      previousAmountKrwM: storedAmount,
      basisHash: hash,
    });
  }
  const live = new Set(lines.map((l) => l.capabilityKey));
  const known = new Set(rows.map((r) => r.id));
  const orphans: OrphanCapabilityEntry[] = entries
    .filter((e) => !live.has(e.capabilityKey))
    .map((e) => ({ capabilityKey: e.capabilityKey, line: String(e.line ?? ""), reflected: e.reflected === true, reason: known.has(e.capabilityKey) ? ("no_cost" as const) : ("deleted" as const) }));
  const reflected = lines.filter((l) => l.reflected);
  return {
    lines,
    orphans,
    totals: {
      capabilityKrwM: lines.reduce((s, l) => s + l.costKrwM, 0),
      reflectedKrwM: reflected.reduce((s, l) => s + l.costKrwM, 0),
      reflectedCount: reflected.length,
      needsRejudgeCount: reflected.filter((l) => l.needsRejudge).length,
    },
  };
}

// ── Double-count guard (design 4.6, OD-6) ───────────────────────────────────

export const normalizeName = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const tokensOf = (s: string): Set<string> => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0));

/** Does the manual line look like the same item as the capability? Containment, >= 60% token overlap, or note mention. */
export function isLikelyDuplicate(capabilityName: string, manual: { line?: string; note?: string }): boolean {
  const cap = normalizeName(capabilityName);
  const man = normalizeName(manual.line ?? "");
  if (cap.length >= 2 && man.length >= 2 && (man.includes(cap) || cap.includes(man))) return true;
  const a = tokensOf(capabilityName);
  const b = tokensOf(manual.line ?? "");
  if (a.size > 0 && b.size > 0) {
    let common = 0;
    for (const t of a) if (b.has(t)) common += 1;
    if (common / Math.min(a.size, b.size) >= 0.6) return true;
  }
  const note = normalizeName(manual.note ?? "");
  return cap.length >= 2 && note.includes(cap);
}

export interface ManualLineLike { line: string; note?: string; dupDismissed?: string[]; source?: unknown }
export interface DuplicateWarning { capabilityKey: string; capabilityName: string; manualIndex: number; manualLine: string }

/** Warning only, never a block. A manual line can dismiss it per capability (`dupDismissed`). */
export function findDuplicateWarnings(reflectedLines: Array<Pick<CapabilityCostLine, "capabilityKey" | "name">>, manual: ManualLineLike[]): DuplicateWarning[] {
  const out: DuplicateWarning[] = [];
  manual.forEach((m, i) => {
    if (m?.source === "capability" || !m?.line?.trim()) return;
    for (const c of reflectedLines) {
      if (m.dupDismissed?.includes(c.capabilityKey)) continue;
      if (isLikelyDuplicate(c.name, m)) out.push({ capabilityKey: c.capabilityKey, capabilityName: c.name, manualIndex: i, manualLine: m.line.trim() });
    }
  });
  return out;
}

// ── Totals over all investment lines ────────────────────────────────────────

const ANNUAL: Record<string, number> = { monthly: 12, quarterly: 4, yearly: 1, lumpsum: 1 };

export interface InvestmentTotals {
  /** 백만원 (the displayed unit). */
  capabilityKrwM: number;
  reflectedKrwM: number;
  manualKrwM: number;
  grandKrwM: number;
  /** 억 equivalents (2 decimals), kept for older callers. */
  capabilityEok: number;
  reflectedEok: number;
  manualEok: number;
  /** Non-KRW manual lines are left out of the totals (no FX in this feature). */
  manualExcludedNonKrw: number;
  grandEok: number;
  reflectedCount: number;
  needsRejudgeCount: number;
}

/** Manual cost lines count lump sums as entered and recurring lines annualised; revenue and 정부 R&D are not 투자비. */
export function investmentTotals(view: CapabilityCostView, reflectedKeys: ReadonlySet<string>, manual: Array<{ category?: string; amount?: number; amountUnit?: string; currency?: string; period?: string }>): InvestmentTotals {
  const reflected = view.lines.filter((l) => reflectedKeys.has(l.capabilityKey));
  const reflectedKrwM = reflected.reduce((s, l) => s + l.costKrwM, 0);
  let manualKrwM = 0;
  let excluded = 0;
  for (const m of manual) {
    if (m.category === "revenue" || m.category === "gov_rnd") continue;
    if (m.currency && m.currency !== "KRW") { excluded += 1; continue; }
    manualKrwM += lineAmountKrwM(m) * (ANNUAL[m.period ?? "yearly"] ?? 1);
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    capabilityKrwM: round2(view.totals.capabilityKrwM),
    reflectedKrwM: round2(reflectedKrwM),
    manualKrwM: round2(manualKrwM),
    grandKrwM: round2(reflectedKrwM + manualKrwM),
    capabilityEok: eokOf(view.totals.capabilityKrwM),
    reflectedEok: eokOf(reflectedKrwM),
    manualEok: round2(manualKrwM / 100),
    manualExcludedNonKrw: excluded,
    grandEok: round2((reflectedKrwM + manualKrwM) / 100),
    reflectedCount: reflected.length,
    needsRejudgeCount: reflected.filter((l) => l.needsRejudge).length,
  };
}

// ── Save-time validation (server) ───────────────────────────────────────────

export type CostLineError = { code: "invalid_request" | "unknown_capability" | "invalid_category" | "amount_mismatch" | "not_reflectable" | "no_cost"; message: string };

const AMOUNT_EPS = 1e-6;

/**
 * Validate and normalise the posted `business_case_lines`. Manual lines pass through untouched.
 * Capability entries are rebuilt from the live judgement: the client amount is never trusted (a
 * different number is rejected), the basis hash is server-computed, and reflecting a judgement
 * that is not confirmed/non-stale is only allowed when it was already reflected (OD-7).
 */
export function normalizeBusinessCaseLines(
  incoming: unknown,
  rows: CostSourceRow[],
  previous: unknown,
  actor: { userId: string; at: string },
): { ok: true; lines: unknown[]; events: Array<{ action: string; target: string }> } | { ok: false; error: CostLineError } {
  if (!Array.isArray(incoming)) return { ok: false, error: { code: "invalid_request", message: "business_case_lines는 배열이어야 합니다." } };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const prev = new Map((Array.isArray(previous) ? previous.filter(isCapabilityEntry) : []).map((e) => [e.capabilityKey, e]));
  const out: unknown[] = [];
  const events: Array<{ action: string; target: string }> = [];
  const seen = new Set<string>();
  for (const raw of incoming) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: { code: "invalid_request", message: "business_case_lines의 각 항목은 객체여야 합니다." } };
    if (!isCapabilityEntry(raw)) {
      // A manual line must not smuggle the capability markers.
      const { source: _s, capabilityKey: _k, reflected: _r, basisHash: _b, reflectedBy: _rb, reflectedAt: _ra, ...manual } = raw as Record<string, unknown>;
      // Unit migration without a schema change: a line without the marker holds 억 and is rewritten value-preserving in 백만원.
      if ("amount" in manual || manual.amountUnit !== undefined) out.push({ ...manual, amount: lineAmountKrwM(manual), amountUnit: AMOUNT_UNIT_KRW_M });
      else out.push(manual);
      continue;
    }
    const key = raw.capabilityKey;
    const row = byId.get(key);
    if (!row || seen.has(key)) return { ok: false, error: { code: "unknown_capability", message: `레지스터에 없는 역량 항목입니다: ${key}` } };
    seen.add(key);
    const cost = row.closing_cost_krw_m;
    if (cost === null || !(cost > 0)) return { ok: false, error: { code: "no_cost", message: `${row.capability}: 해소 비용이 0보다 커야 투자비에 담을 수 있습니다.` } };
    const category = raw.category ?? suggestCategory(row.resolution).category;
    if (!CAPABILITY_COST_CATEGORIES.includes(category as CostCategory)) return { ok: false, error: { code: "invalid_category", message: `${row.capability}: 분류는 인건비·운영비·설비투자 중 하나여야 합니다.` } };
    // The amount is stored and compared in 백만원; a client without the unit marker (legacy) sent 억.
    const live = cost;
    const rawAmount = raw.amount as unknown;
    const rawKrwM = typeof rawAmount === "number" && Number.isFinite(rawAmount) ? ((raw as { amountUnit?: unknown }).amountUnit === AMOUNT_UNIT_KRW_M ? rawAmount : rawAmount * 100) : null;
    if (rawAmount !== undefined && (rawKrwM === null || Math.abs(rawKrwM - live) > AMOUNT_EPS * 100)) {
      return { ok: false, error: { code: "amount_mismatch", message: `${row.capability}: 금액은 판정에서 정해집니다(${formatKrwM(live)}) — 금액을 바꾸려면 판정을 바꾸세요. 화면을 새로 고쳐 최신 판정을 확인하세요.` } };
    }
    const reflected = raw.reflected === true;
    const before = prev.get(key);
    const wasReflected = before?.reflected === true;
    if (reflected && !wasReflected && (row.confirmed_at === null || row.stale)) {
      return { ok: false, error: { code: "not_reflectable", message: `${row.capability}: 확정되지 않았거나 재판정이 필요한 판정은 투자비에 반영할 수 없습니다.` } };
    }
    out.push({
      line: `${row.capability} 역량 해소`,
      category,
      amount: live,
      amountUnit: AMOUNT_UNIT_KRW_M,
      currency: "KRW",
      period: "lumpsum",
      note: `S5 역량 해소 비용 연동 (${row.resolution ? RESOLUTION_LABEL[row.resolution] : "해소 방식 미정"})`,
      source: "capability",
      capabilityKey: key,
      reflected,
      basisHash: costBasisHash(row),
      costKrwM: cost,
      ...(reflected ? (wasReflected && before?.reflectedBy ? { reflectedBy: before.reflectedBy, reflectedAt: before.reflectedAt } : { reflectedBy: actor.userId, reflectedAt: actor.at }) : {}),
    } satisfies Omit<StoredCapabilityEntry, "reflectedBy" | "reflectedAt"> & { reflectedBy?: string; reflectedAt?: string });
    const target = `${key}:${cost}:${category}:${costBasisHash(row)}`;
    if (reflected && !wasReflected) events.push({ action: "capability_cost.reflect", target });
    else if (!reflected && wasReflected) events.push({ action: "capability_cost.unreflect", target });
    else if (reflected && wasReflected && typeof before?.amount === "number" && Math.abs(lineAmountKrwM(before) - live) > 1e-6) events.push({ action: "capability_cost.amount_followed", target: `${key}:${lineAmountKrwM(before)}->${live}` });
  }
  // Newly dismissed duplicate warnings.
  const dismissed = (xs: unknown) => new Set((Array.isArray(xs) ? xs : []).flatMap((x) => (x && typeof x === "object" && Array.isArray((x as { dupDismissed?: unknown }).dupDismissed) ? ((x as { dupDismissed: string[] }).dupDismissed.map((k) => `${(x as { line?: string }).line ?? ""}|${k}`)) : [])));
  const before = dismissed(previous);
  for (const d of dismissed(out)) if (!before.has(d)) events.push({ action: "capability_cost.dup_dismissed", target: d });
  return { ok: true, lines: out, events };
}

// ── Promotion (server) ──────────────────────────────────────────────────────

export interface PromotionCapabilityLine { category: CostCategory; name: string; krwM: number; note: string }

/**
 * Split stored lines for the greenfield promotion copy (ADR-0137/0138): `reflected:false` entries are
 * skipped, reflected capability entries come back as exact 백만원 lump sums recomputed from the live
 * judgement (a deleted/zero-cost capability is skipped and listed), everything else is a manual line.
 */
export function splitForPromotion(lines: unknown[], rows: CostSourceRow[]): { manual: unknown[]; capability: PromotionCapabilityLine[]; skipped: string[] } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const manual: unknown[] = [];
  const capability: PromotionCapabilityLine[] = [];
  const skipped: string[] = [];
  for (const l of lines) {
    if (!isCapabilityEntry(l)) { manual.push(l); continue; }
    if (l.reflected !== true) continue;
    const row = byId.get(l.capabilityKey);
    const cost = row?.closing_cost_krw_m ?? null;
    if (!row || cost === null || !(cost > 0)) { skipped.push(l.capabilityKey); continue; }
    const category = CAPABILITY_COST_CATEGORIES.includes(l.category as CostCategory) ? (l.category as CostCategory) : suggestCategory(row.resolution).category;
    const flags = ["역량 해소 비용", `S5 연동 (판정 ${row.id})`, "일시불 총액"];
    if (row.stale || (!!l.basisHash && l.basisHash !== costBasisHash(row))) flags.push("역량 판정 재판정 필요 — 금액 검증 필요");
    capability.push({ category, name: `${row.capability} 역량 해소`, krwM: cost, note: flags.join(". ") });
  }
  return { manual, capability, skipped };
}

// ── Milestone candidate ─────────────────────────────────────────────────────

export function milestoneDerivedHash(row: Pick<CapabilityGapRow, "id" | "capability" | "resolution">, months: number): string {
  return sha256Hex(JSON.stringify([row.id, row.capability.trim(), row.resolution ?? null, months])).slice(0, 16);
}

/** Candidate for a row, derived from the judgement; undefined when there is no period. Never client-supplied. */
export function milestoneCandidateOf(row: CapabilityGapRow): MilestoneCandidate | undefined {
  const months = row.attainability?.monthsToAttain ?? null;
  if (months === null || !(months > 0)) return undefined;
  return { name: `${row.capability.trim()} 해소`, months, resolution: row.resolution ?? null, rowId: row.id, derivedFromHash: milestoneDerivedHash(row, months) };
}

export interface MilestoneCandidateView extends MilestoneCandidate {
  /** Stale judgement: the candidate is shown with its prior months and flagged. */
  stale: boolean;
  /** The stored candidate no longer matches the judgement it was derived from. */
  outdated: boolean;
  /** False when derived on the fly because none was stored yet (legacy row). */
  stored: boolean;
}

export function milestoneCandidateView(row: CapabilityGapRow): MilestoneCandidateView | null {
  const stored = row.attainability?.milestoneCandidate;
  const live = milestoneCandidateOf(row);
  if (!stored && !live) return null;
  const base = stored ?? live!;
  return { ...base, stale: isStale(row), outdated: !!stored && (!live || stored.derivedFromHash !== live.derivedFromHash), stored: !!stored };
}

// ── Client selection overlay ────────────────────────────────────────────────

export interface CostSelection { reflected?: boolean; category?: CostCategory }

/** Overlay the person's unsaved checkbox/category choices on the derived lines. */
export function applySelection(view: CapabilityCostView, sel: Readonly<Record<string, CostSelection>>): CapabilityCostLine[] {
  return view.lines.map((l) => {
    const s = sel[l.capabilityKey];
    if (!s) return l;
    const reflected = s.reflected ?? l.reflected;
    return { ...l, reflected, category: s.category ?? l.category, needsRejudge: reflected && (l.stale || l.needsRejudge) };
  });
}

/** Payload entries for the saved capability lines: reflected ones, plus explicit un-checks of default/previously stored rows. */
export function selectionPayload(lines: CapabilityCostLine[], sel: Readonly<Record<string, CostSelection>>): Array<{ source: "capability"; capabilityKey: string; reflected: boolean; category: CostCategory; amount: number; amountUnit: typeof AMOUNT_UNIT_KRW_M }> {
  return lines
    .filter((l) => l.reflected || l.persisted || sel[l.capabilityKey]?.reflected === false)
    .map((l) => ({ source: "capability" as const, capabilityKey: l.capabilityKey, reflected: l.reflected, category: l.category, amount: l.costKrwM, amountUnit: AMOUNT_UNIT_KRW_M }));
}

// ── S5 reflection action (explicit save of the capability selections) ────────

export type LineSaveState = "saved" | "unsaved" | null;

/** Per capability line: reflected AND stored the same way = saved; any difference between the page and the stored entry = unsaved. */
export function lineSaveStates(lines: CapabilityCostLine[], stored: unknown, sel: Readonly<Record<string, CostSelection>>): Record<string, LineSaveState> {
  const entries = new Map((Array.isArray(stored) ? stored.filter(isCapabilityEntry) : []).map((e) => [e.capabilityKey, e]));
  const out: Record<string, LineSaveState> = {};
  for (const l of lines) {
    const e = entries.get(l.capabilityKey);
    const savedReflected = e?.reflected === true;
    const savedCategory = e && CAPABILITY_COST_CATEGORIES.includes(e.category as CostCategory) ? (e.category as CostCategory) : l.suggestedCategory;
    const touched = !!sel[l.capabilityKey];
    if (l.reflected && savedReflected && l.category === savedCategory) out[l.capabilityKey] = "saved";
    else if (l.reflected !== savedReflected || (l.reflected && l.category !== savedCategory) || (touched && !e && l.reflected)) out[l.capabilityKey] = "unsaved";
    else out[l.capabilityKey] = null;
  }
  return out;
}
export const hasUnsavedReflection = (states: Record<string, LineSaveState>): boolean => Object.values(states).some((s) => s === "unsaved");

/** The partial-save body: ONLY business_case_lines (manual lines as held + capability selections). */
export function reflectionBody(manual: Array<{ line: string }>, capLines: CapabilityCostLine[], sel: Readonly<Record<string, CostSelection>>): { business_case_lines: unknown[] } {
  return { business_case_lines: [...manual.filter((l) => l.line.trim()), ...selectionPayload(capLines, sel)] };
}

/** "N건 반영, 반영 합계 X백만원 — 투자비 전체 합계 Y백만원" */
export function reflectionSummary(totals: Pick<InvestmentTotals, "reflectedCount" | "reflectedKrwM" | "grandKrwM">): string {
  return `${totals.reflectedCount}건 반영, 반영 합계 ${formatKrwM(totals.reflectedKrwM)} — 투자비 전체 합계 ${formatKrwM(totals.grandKrwM)}`;
}
