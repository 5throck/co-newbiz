// S8 technical lens (ADR-0169, design 2026-10-14-s8-technical-financial-lens).
// Pure, client-safe: types, tolerant parser, register serializer and the
// status/summary view model. The lens lives in a `technicalLens` key of the S3
// register JSON (opportunity.capability_gap_json, no migration). Every writer of
// that column must go through serializeGapRegister so the key is carried over
// verbatim; a save from S3/S5 can neither drop nor forge it.
// Judgement is human (AI drafts only). The lens is decision support: it never
// caps a grade and never blocks a gate.
import type { CapabilityGapRow } from "./capability-gap.ts";
import { isStale } from "./capability-linkage.ts";
import { ROLLUP_LABEL, type ConstituentRollup } from "./technical-item-constituents.ts"; // round 5c: roll-up only

export const TECH_ITEM_KEYS = ["T1", "T2", "T3", "T4", "T5"] as const;
export type TechItemKey = (typeof TECH_ITEM_KEYS)[number];

/** UI labels of the six displayed items (T6 = S9 link; Brown Field pairs instead). */
export const TECH_ITEM_LABELS: Record<TechItemKey | "T6", string> = {
  T1: "역량 달성 가능성",
  T2: "기술 성숙도(TRL)",
  T3: "핵심 인력·설비·시설",
  T4: "지식재산·라이선스",
  T5: "인허가·인증 확보 가능성",
  T6: "S9 기술 실사 연결",
};
export const TECH_ITEM_LABEL_T6_BROWNFIELD = "S9 기술 실사 짝 검증";

export type LensItemStatus = "met" | "caution" | null;
/** Status shown on the lens chips and the summary strip. */
export type LensStatus = "met" | "caution" | "undetermined";
export const LENS_STATUS_LABEL: Record<LensStatus, string> = { met: "충족", caution: "주의", undetermined: "미판정" };

export type DraftedBy = "human" | "ai" | null;

export interface TechnicalLensItem {
  status: LensItemStatus;
  rationale: string;
  evidence: string[];
  draftedBy: DraftedBy;
  confirmedBy: string | null;
  confirmedAt: string | null;
  /** Item-specific payload (TRL, resources, ...): validated by the slice that owns the form. */
  detail: Record<string, unknown>;
}

export type VerificationResult = "verified" | "different" | "unverifiable" | null;
/** S9 pairing row (Brown Field). Reserved here; written by the S9 route in a later slice. */
export interface TechnicalVerificationRow {
  s8Ref: string;
  s8RevisionAt: string | null;
  result: VerificationResult;
  observed: string;
  evidence: string[];
  checklistRefs: string[];
  verifiedBy: string | null;
  verifiedAt: string | null;
  draftedBy: DraftedBy;
}

export interface TechnicalLensSubject {
  items: Partial<Record<TechItemKey, TechnicalLensItem>>;
  /** Reserved for the S9 pairing; only the S9 route writes it. */
  verification: Partial<Record<TechItemKey, TechnicalVerificationRow>>;
}

export interface TechnicalLens {
  version: 1;
  subjects: Record<string, TechnicalLensSubject>;
  updatedAt: string | null;
}

const SUBJECT_RE = /^(project|target:[A-Za-z0-9_-]{1,64})$/;
export function isValidSubject(s: unknown): s is string {
  return typeof s === "string" && SUBJECT_RE.test(s);
}
export const PROJECT_SUBJECT = "project";
export function targetSubject(targetId: string): string {
  return `target:${targetId}`;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strOrNull = (v: unknown, max: number): string | null => { const s = str(v, max); return s || null; };
const strList = (v: unknown, n: number, max: number): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : [];
const drafted = (v: unknown): DraftedBy => (v === "human" || v === "ai" ? v : null);

function plainDetail(v: unknown): Record<string, unknown> {
  if (!isRec(v)) return {};
  try {
    const s = JSON.stringify(v);
    return s.length <= 20_000 ? (JSON.parse(s) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function normalizeLensItem(raw: unknown): TechnicalLensItem | null {
  if (!isRec(raw)) return null;
  const status: LensItemStatus = raw.status === "met" || raw.status === "caution" ? raw.status : null;
  const confirmedBy = strOrNull(raw.confirmedBy, 120);
  const confirmedAt = strOrNull(raw.confirmedAt, 40);
  const both = confirmedBy && confirmedAt;
  return {
    status,
    rationale: str(raw.rationale, 4000),
    evidence: strList(raw.evidence, 20, 500),
    draftedBy: drafted(raw.draftedBy),
    // A confirmation needs both fields and a status to confirm.
    confirmedBy: both && status ? confirmedBy : null,
    confirmedAt: both && status ? confirmedAt : null,
    detail: plainDetail(raw.detail),
  };
}

export function normalizeVerificationRow(raw: unknown): TechnicalVerificationRow | null {
  if (!isRec(raw)) return null;
  const s8Ref = str(raw.s8Ref, 200);
  if (!s8Ref) return null;
  const result: VerificationResult = raw.result === "verified" || raw.result === "different" || raw.result === "unverifiable" ? raw.result : null;
  return {
    s8Ref,
    s8RevisionAt: strOrNull(raw.s8RevisionAt, 40),
    result,
    observed: str(raw.observed, 4000),
    evidence: strList(raw.evidence, 20, 500),
    checklistRefs: strList(raw.checklistRefs, 20, 200),
    verifiedBy: strOrNull(raw.verifiedBy, 120),
    verifiedAt: strOrNull(raw.verifiedAt, 40),
    draftedBy: drafted(raw.draftedBy),
  };
}

export function emptyTechnicalLens(): TechnicalLens {
  return { version: 1, subjects: {}, updatedAt: null };
}

/** Tolerant parse of a `technicalLens` value (already-parsed JSON). Unknown subjects/keys are dropped. */
export function normalizeTechnicalLens(raw: unknown): TechnicalLens {
  if (!isRec(raw) || !isRec(raw.subjects)) return emptyTechnicalLens();
  const subjects: Record<string, TechnicalLensSubject> = {};
  for (const [subject, sv] of Object.entries(raw.subjects)) {
    if (!isValidSubject(subject) || !isRec(sv)) continue;
    const items: TechnicalLensSubject["items"] = {};
    const verification: TechnicalLensSubject["verification"] = {};
    const rawItems = isRec(sv.items) ? sv.items : {};
    const rawVer = isRec(sv.verification) ? sv.verification : {};
    for (const k of TECH_ITEM_KEYS) {
      const it = normalizeLensItem(rawItems[k]);
      if (it) items[k] = it;
      const vr = normalizeVerificationRow(rawVer[k]);
      if (vr) verification[k] = vr;
    }
    subjects[subject] = { items, verification };
  }
  return { version: 1, subjects, updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null };
}

/** The raw `technicalLens` value of a stored register JSON (verbatim), or undefined. */
export function extractTechnicalLensRaw(storedJson: string | null | undefined): unknown {
  if (!storedJson) return undefined;
  try {
    const raw = JSON.parse(storedJson) as { technicalLens?: unknown };
    return raw && typeof raw === "object" ? raw.technicalLens : undefined;
  } catch {
    return undefined;
  }
}

export function parseTechnicalLens(storedJson: string | null | undefined): TechnicalLens {
  return normalizeTechnicalLens(extractTechnicalLensRaw(storedJson));
}

/**
 * The ONLY way to produce the `capability_gap_json` text. Carries the stored
 * `technicalLens` over verbatim (same idea as carryOverAttainability for rows), so
 * an S3/S5/synergy/backfill rewrite of the rows cannot drop or forge it.
 * Pass `lens` only from the technical-lens routes; every other writer omits it.
 */
export function serializeGapRegister(
  rows: readonly unknown[],
  updatedAt: string,
  storedJson: string | null | undefined,
  lens?: TechnicalLens,
  removedCapabilities?: readonly unknown[],
): string {
  const carried = lens ?? extractTechnicalLensRaw(storedJson);
  // ADR-0170: the archive of judgements whose S3 row was deleted is carried the same
  // way; only the register-write wrapper (capability-register-write.ts) passes a new list.
  const removed = removedCapabilities ?? extractRegisterKeyRaw(storedJson, "removedCapabilities");
  const out: Record<string, unknown> = { rows, updatedAt };
  if (carried !== undefined) out.technicalLens = carried;
  if (removed !== undefined && !(Array.isArray(removed) && removed.length === 0)) out.removedCapabilities = removed;
  return JSON.stringify(out);
}

function extractRegisterKeyRaw(storedJson: string | null | undefined, key: string): unknown {
  if (!storedJson) return undefined;
  try {
    const raw = JSON.parse(storedJson) as Record<string, unknown>;
    return raw && typeof raw === "object" ? raw[key] : undefined;
  } catch {
    return undefined;
  }
}

// ── Summary view model ────────────────────────────────────────────────────

export interface LensItemView {
  key: TechItemKey | "T6";
  label: string;
  status: LensStatus;
  /** T1 is derived from the ADR-0168 rows; T6 has no input in this release. */
  derived: boolean;
  /** Human-confirmed judgement present (T1: all rows confirmed). */
  judged: boolean;
  note: string;
}

export interface TechnicalLensSummary {
  status: LensStatus;
  total: number;
  judged: number;
  cautionCount: number;
  worstItem: string | null;
  items: LensItemView[];
  /** Brown Field S9 mismatch count (verification result `different`). */
  mismatchCount: number;
  /** Required-capability rows whose S3 content changed after the judgement (ADR-0170). */
  staleCount: number;
}

/** T1 from the S3 register rows: 충족 if all rows are human-confirmed and none low; 주의 if any low; else 미판정. */
export function deriveT1(rows: CapabilityGapRow[]): { status: LensStatus; judged: boolean; note: string } {
  if (rows.length === 0) return { status: "undetermined", judged: false, note: "S3 필요 역량 레지스터가 비어 있습니다." };
  // ADR-0170: a row whose S3 content changed after the judgement counts as unjudged.
  const stale = rows.filter((r) => isStale(r)).length;
  const fresh = rows.filter((r) => !isStale(r));
  const staleNote = stale > 0 ? ` (재판정 필요 ${stale}건)` : "";
  const low = fresh.filter((r) => r.attainability?.grade === "low").length;
  if (low > 0) return { status: "caution", judged: stale === 0 && fresh.every((r) => !!r.attainability?.confirmedAt), note: `달성 가능성 '낮음' ${low}건${staleNote}` };
  const confirmed = fresh.filter((r) => r.attainability?.grade && r.attainability.confirmedAt).length;
  if (stale === 0 && confirmed === rows.length) return { status: "met", judged: true, note: `${rows.length}건 모두 사람이 확정` };
  return { status: "undetermined", judged: false, note: `사람이 확정한 판정 ${confirmed}/${rows.length}건${staleNote}` };
}

/** Rows needing re-judgement after an S3 change (ADR-0170). */
export function staleRowCount(rows: CapabilityGapRow[]): number {
  return rows.filter((r) => isStale(r)).length;
}

function storedStatus(it: TechnicalLensItem | undefined): { status: LensStatus; judged: boolean } {
  // Only a human-confirmed status counts as a judgement.
  if (!it || !it.status || !it.confirmedAt) return { status: "undetermined", judged: false };
  return { status: it.status, judged: true };
}

/** 2026-10-20 round 5: brownfield T1 reads the S9 capability-dd verdicts (the recording home). */
export interface S9CapabilityCoverage { total: number; judged: number; resolved: number; partial: number; unresolved: number }

export function summarizeTechnicalLens(
  rows: CapabilityGapRow[],
  lens: TechnicalLens | null | undefined,
  opts: {
    subject?: string;
    brownfield?: boolean;
    s9Capability?: S9CapabilityCoverage | null;
    /** round 5c: constituent S9 checklist roll-ups per item — the ONLY source of T2-T5 (no separate verdict). */
    s9Rollups?: Partial<Record<"T2" | "T3" | "T4" | "T5", ConstituentRollup>>;
  } = {},
): TechnicalLensSummary {
  const subject = lens?.subjects[opts.subject ?? PROJECT_SUBJECT];
  const t1 = deriveT1(rows);
  const cap = opts.s9Capability;
  const t1Item: LensItemView = cap && cap.judged > 0
    ? {
        key: "T1",
        label: TECH_ITEM_LABELS.T1,
        // S9 verdicts cover the register: met when every capability is resolved, caution when
        // any is partial/unresolved; incomplete coverage stays undetermined (warning-only lens).
        status: cap.judged < cap.total ? "undetermined" : cap.partial + cap.unresolved > 0 ? "caution" : "met",
        derived: true,
        judged: cap.judged >= cap.total && cap.total > 0,
        note: `S9 필요 역량 검증 ${cap.judged}/${cap.total} · 해소 ${cap.resolved} · 부분 해소 ${cap.partial} · 미해소 ${cap.unresolved}`,
      }
    : { key: "T1", label: TECH_ITEM_LABELS.T1, status: t1.status, derived: true, judged: t1.judged, note: t1.note };
  const items: LensItemView[] = [t1Item];
  for (const k of ["T2", "T3", "T4", "T5"] as const) {
    // 2026-10-20 decider round 5c: T2-T5 are DERIVED from the S9 DD structure as it is — each
    // item names the checklist items that constitute it (기술·인사·법무 실사 tabs), those are
    // judged on their own tabs by people, and the roll-up is the lens value. No separate
    // per-item verdict exists. Warning-only: 미충족 surfaces as 주의 on the strip.
    const rawRollup = opts.s9Rollups?.[k];
    const rollup = rawRollup && rawRollup.total > 0 ? rawRollup : undefined; // no constituents in this track = no roll-up
    if (rollup && rollup.judged === rollup.total) {
      items.push({
        key: k,
        label: TECH_ITEM_LABELS[k],
        status: rollup.status === "pass" ? "met" : rollup.status === "na" ? "undetermined" : "caution",
        derived: true,
        judged: rollup.status !== "na",
        note: `S9 체크리스트 롤업 (${ROLLUP_LABEL[rollup.status]}) — 구성 항목 ${rollup.total}건${rollup.failed > 0 ? ` · 미충족 ${rollup.failed}건` : ""}`,
      });
      continue;
    }
    if (rollup) {
      items.push({
        key: k,
        label: TECH_ITEM_LABELS[k],
        status: rollup.failed > 0 ? "caution" : "undetermined",
        derived: true,
        judged: false,
        note: `구성 항목 ${rollup.judged}/${rollup.total} 판정${rollup.failed > 0 ? ` · 미충족 ${rollup.failed}건` : ""} — 나머지는 S9 해당 실사 탭에서 판정하세요.`,
      });
      continue;
    }
    const s = storedStatus(subject?.items[k]);
    items.push({ key: k, label: TECH_ITEM_LABELS[k], status: s.status, derived: false, judged: s.judged, note: s.judged ? "" : "S9 실사·검증의 체크리스트 항목으로 판정됩니다 — 이 트랙에는 구성 항목이 없습니다." });
  }
  // T6 — the S8↔S9 pairing itself: complete when every T2-T5 roll-up is complete; until then
  // the note counts the gap.
  const s9Judged = items.filter((i) => (["T2", "T3", "T4", "T5"] as string[]).includes(i.key) && i.judged).length;
  items.push({
    key: "T6",
    label: opts.brownfield ? TECH_ITEM_LABEL_T6_BROWNFIELD : TECH_ITEM_LABELS.T6,
    status: s9Judged === 4 ? "met" : "undetermined",
    derived: true,
    judged: s9Judged === 4,
    note: s9Judged === 4 ? "T2~T5 모두 S9 체크리스트 판정과 짝지어졌습니다." : `S9 짝 검증 ${s9Judged}/4 완료 — 나머지 항목의 구성 체크리스트를 S9에서 판정하세요.`,
  });
  const judged = items.filter((i) => i.judged).length;
  const cautions = items.filter((i) => i.status === "caution");
  const status: LensStatus = items.some((i) => !i.judged) ? "undetermined" : cautions.length > 0 ? "caution" : "met";
  let mismatchCount = 0;
  for (const v of Object.values(subject?.verification ?? {})) if (v?.result === "different") mismatchCount += 1;
  return { status, total: items.length, judged, cautionCount: cautions.length, worstItem: cautions[0]?.label ?? null, items, mismatchCount, staleCount: staleRowCount(rows) };
}
