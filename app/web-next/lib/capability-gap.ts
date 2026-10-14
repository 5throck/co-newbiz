// S3 역량 갭 분석 공용 로직 — 시장 요구사항(필요 역량)을 그룹/계열사 보유
// 역량과 대조한 갭 레지스터의 타입·정규화·요약. 레지스터 본체는
// opportunity.capability_gap_json(마이그레이션 0098)에 저장된다.
//
// 보유 판정의 근거는 그룹/계열사 프로필(company_profile_version strengths·
// industryExposure)뿐이다 — 내부(자사 단독) 역량 평가는 후속 보강 사항이며,
// 모든 표면에 그 한계를 안내 문구로 명시한다(2026-09-14 사용자 요구).
// 해소 어휘(build/partner/hire/invest)는 S5 capability_gaps_json(0056)과 동일
// 어휘를 써서 S5로의 승계를 가능하게 한다.

// 보유 판정 (ADR-0172): industry-relative category. Legacy stored keys met/unmet are
// read-mapped (see mapLegacyHeldStatus) and rewritten only when a person saves the row.
export type GapHeldStatus = "leading" | "average" | "partial" | "none" | "unevaluated";
export type GapNecessity = "essential" | "partial_essential" | "optional" | "";
export type LegacyHeldStatus = "met" | "unmet";
export type GapResolution = "build" | "partner" | "hire" | "invest";
export type GapSource = "s2_sketch" | "s1_factors" | "synergy_area" | "manual";

export interface CapabilityGapRow {
  id: string;
  capability: string;
  source: GapSource;
  requiredNote: string;
  /** 필요도 (ADR-0172). "" = 미정. */
  necessity: GapNecessity;
  /** 필수 범위 — only meaningful for partial_essential (<=120 chars). */
  necessityScopeNote: string;
  held: {
    status: GapHeldStatus;
    holders: string[];
    evidence: string;
    /** Set while the stored key was legacy met/unmet and no person has re-saved the 보유 판정. */
    legacyStatus?: LegacyHeldStatus;
    /** True while a legacy `met` (read as average) awaits re-assessment (재판정 권장). */
    reassessHint?: boolean;
  };
  resolution: GapResolution | null;
  note: string;
  // 필요 수준 / 보유 수준: S3-owned narrative text (ADR-0172), cap NARRATIVE_CAP.
  requiredLevel: string;
  currentLevel: string;
  // S8 달성 가능성 판정(ADR-0168) — 사람이 판정·확정한다. 없으면 `미판정`.
  attainability?: CapabilityAttainability;
}

export type AttainabilityGrade = "high" | "medium" | "low";
export type AttainabilityDrafter = "human" | "ai";

export interface CapabilityAttainability {
  /** 해소 비용(백만원). null = 미입력. */
  closingCostKrwM: number | null;
  /** 달성 기간(개월). null = 미입력. */
  monthsToAttain: number | null;
  /** null = 미판정. */
  grade: AttainabilityGrade | null;
  rationale: string;
  evidence: string[];
  /**
   * 기대 수준 (ADR-0172 D6, ADR-0171): narrative of the state expected once the 해소 방식 is
   * done (cap NARRATIVE_CAP). Judgement-owned (S5), NOT part of the S3 row hash. Absent = 미입력.
   */
  expectedLevel?: string;
  draftedBy: AttainabilityDrafter | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  // ADR-0170: S3-S8 linkage. All optional; legacy judgements carry none of them.
  /** Versioned hash of the S3-owned fields the judgement was based on (server-stamped). */
  basisHash?: string;
  /** The S3-owned values at judgement time (what changed = diff against the current row). */
  s3Snapshot?: S3Snapshot;
  /** Set when an S3 change invalidated the judgement (confirmation cleared, prior values kept). */
  staleSince?: string;
  /** Superseded judgements (newest last, capped). */
  history?: AttainabilityHistoryEntry[];
}

export interface S3Snapshot {
  capability: string;
  requiredNote: string;
  heldStatus: GapHeldStatus;
  requiredLevel: string;
  currentLevel: string;
  /** Added with hash v2; absent on older snapshots. */
  necessity?: GapNecessity;
}

export interface AttainabilityHistoryEntry {
  grade: AttainabilityGrade | null;
  closingCostKrwM: number | null;
  monthsToAttain: number | null;
  rationale: string;
  evidence: string[];
  resolution: GapResolution | null;
  /** 기대 수준 of the superseded judgement (absent on older entries). */
  expectedLevel?: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  basisHash: string;
  invalidatedAt: string;
  reason: "s3_changed";
  s3Snapshot: S3Snapshot | null;
}

/** A judgement whose S3 row was deleted (register-level `removedCapabilities`, read-only history). */
export interface RemovedCapability {
  rowId: string;
  capability: string;
  requiredLevel: string;
  currentLevel: string;
  attainability: CapabilityAttainability | null;
  removedAt: string;
  removedBy: string;
}

export const HISTORY_CAP = 5;
export const REMOVED_CAP = 30;

export const ATTAINABILITY_GRADE_LABEL: Record<AttainabilityGrade, string> = { high: "높음", medium: "중간", low: "낮음" };
export const ATTAINABILITY_UNJUDGED_LABEL = "미판정";
const GRADES: AttainabilityGrade[] = ["high", "medium", "low"];

export interface CapabilityGapRegister {
  rows: CapabilityGapRow[];
  updatedAt: string | null;
}

export const HELD_STATUS_LABEL: Record<GapHeldStatus, string> = {
  leading: "업계 리딩",
  average: "업계 평균",
  partial: "부분 보유",
  none: "미보유",
  unevaluated: "미판정",
};

export const NECESSITY_LABEL: Record<Exclude<GapNecessity, "">, string> = {
  essential: "필수",
  partial_essential: "부분 필수",
  optional: "선택",
};
export const NECESSITY_UNSET_LABEL = "미정";
export const NARRATIVE_CAP = 400;
export const NECESSITY_NOTE_CAP = 120;
const NECESSITIES: Array<Exclude<GapNecessity, "">> = ["essential", "partial_essential", "optional"];

/** Canonical display order for the S3-owned columns (ADR-0172). */
export const CAPABILITY_COLUMN_ORDER = [
  "capability", "necessity", "requiredLevel", "heldStatus", "currentLevel", "holders",
] as const;

/** Legacy stored key -> current key. Anything unknown reads as unevaluated. */
export function mapLegacyHeldStatus(raw: unknown): { status: GapHeldStatus; legacy: LegacyHeldStatus | null } {
  switch (raw) {
    case "leading": case "average": case "partial": case "none": case "unevaluated":
      return { status: raw, legacy: null };
    case "met": return { status: "average", legacy: "met" };
    case "unmet": return { status: "none", legacy: "unmet" };
    default: return { status: "unevaluated", legacy: null };
  }
}

// S4 브라운필드 sub_track 라벨(labels.ts BF_SUB.partnership: "전략 제휴")과
// 표현을 통일한다(ADR-0136) — build/hire/invest는 S4에 대응 개념이 없어 그대로 둔다.
export const RESOLUTION_LABEL: Record<GapResolution, string> = {
  build: "직접 구축",
  partner: "전략 제휴",
  hire: "영입",
  invest: "지분 투자",
};

export const HELD_STATUS_CHIP: Record<GapHeldStatus, string> = {
  leading: "status-green",
  average: "status-green",
  partial: "status-amber",
  none: "status-red",
  unevaluated: "status-not-started",
};

/** Muted suggestion text for 기대 수준 per 해소 방식 (ADR-0172 OD-10). A hint only: never compared, never enforced. */
export const RESOLUTION_EXPECTED_LEVEL_HINT: Record<GapResolution, string> = {
  build: "직접 구축을 마친 뒤 우리가 스스로 수행할 수 있는 수준 (인력·설비·절차 확보 기준)",
  hire: "영입한 인력이 수행할 수 있는 수준과 정착 조건 (핵심 인력 확보 기준)",
  partner: "제휴사를 통해 접근할 수 있는 수준과 의존 범위 (계약 조건 기준)",
  invest: "투자 대상이 보유한 수준 중 우리가 확보하는 범위 (지분·권리 기준)",
};

const RESOLUTIONS: GapResolution[] = ["build", "partner", "hire", "invest"];
/** Origin line for a register row. Inside the S3 screen the label never names S3 itself. */
export function gapSourceLabel(source: string, inS3: boolean): string {
  switch (source) {
    case "s2_sketch": return "S2 스케치에서 도출";
    case "s1_factors": return "S1 요인에서 도출";
    case "synergy_area": return inS3 ? "시너지 영역에서 도출" : "S3 시너지 영역에서 도출";
    default: return "직접 입력";
  }
}

const SOURCES: GapSource[] = ["s2_sketch", "s1_factors", "synergy_area", "manual"];

const str = (v: unknown, cap: number): string => (typeof v === "string" ? v.trim().slice(0, cap) : "");
const strArr = (v: unknown, max: number, cap: number): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, cap)).filter(Boolean).slice(0, max) : [];

/** LLM·클라이언트 양쪽에서 오는 raw 배열을 정규화한다 — 상한(cap 30행) 강제. */
export function normalizeGapRows(raw: unknown): CapabilityGapRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: CapabilityGapRow[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    if (!item || typeof item !== "object" || rows.length >= 30) continue;
    const capability = str(item.capability, 200);
    if (!capability) continue;
    const source = SOURCES.includes(item.source as GapSource) ? (item.source as GapSource) : "manual";
    const heldRaw = (item.held ?? {}) as Record<string, unknown>;
    const mapped = mapLegacyHeldStatus(heldRaw.status);
    const status = mapped.status;
    // A client may round-trip the legacy marker untouched; keep it only while the key still matches it.
    const carriedLegacy = heldRaw.legacyStatus === "met" && status === "average" ? "met" : heldRaw.legacyStatus === "unmet" && status === "none" ? "unmet" : null;
    const legacy = mapped.legacy ?? carriedLegacy;
    const necessity = NECESSITIES.includes(item.necessity as Exclude<GapNecessity, "">) ? (item.necessity as GapNecessity) : "";
    const scopeNote = necessity === "partial_essential" ? str(item.necessityScopeNote ?? item.necessityNote, NECESSITY_NOTE_CAP) : "";
    const resolution = RESOLUTIONS.includes(item.resolution as GapResolution) ? (item.resolution as GapResolution) : null;
    const attainability = normalizeAttainability(item.attainability);
    rows.push({
      id: str(item.id, 40) || `gap-${rows.length + 1}-${Date.now().toString(36)}`,
      capability,
      source,
      requiredNote: str(item.requiredNote, 300),
      necessity,
      necessityScopeNote: scopeNote,
      held: {
        status,
        holders: status === "unevaluated" ? [] : strArr(heldRaw.holders, 6, 120),
        evidence: str(heldRaw.evidence, 400),
        ...(legacy ? { legacyStatus: legacy } : {}),
        ...(legacy === "met" ? { reassessHint: true } : {}),
      },
      resolution,
      note: str(item.note, 300),
      requiredLevel: str(item.requiredLevel, NARRATIVE_CAP),
      currentLevel: str(item.currentLevel, NARRATIVE_CAP),
      ...(attainability ? { attainability } : {}),
    });
  }
  return rows;
}

const finiteNonNeg = (v: unknown, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : null;

export interface HeldDraft { status: GapHeldStatus; holders: string[]; evidence: string; currentLevel: string }

/**
 * AI draft normalizer (ADR-0172): proposes 보유 판정 on the new scale + 보유 수준 narrative +
 * evidence. Never touches 필요도 or 필요 수준. Legacy keys are mapped; `leading` is only kept
 * when the evidence text exists (comparative evidence), otherwise it is downgraded to `average`.
 * Returns null for an unusable status.
 */
export function normalizeHeldDraft(raw: unknown): HeldDraft | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const h = raw as Record<string, unknown>;
  const known = ["leading", "average", "partial", "none", "unevaluated", "met", "unmet"];
  if (!known.includes(String(h.status ?? "").trim())) return null;
  let status = mapLegacyHeldStatus(String(h.status).trim()).status;
  const evidence = status === "unevaluated" ? "" : str(h.evidence, 400);
  if (status === "leading" && evidence === "") status = "average";
  return {
    status,
    holders: status === "unevaluated" ? [] : strArr(h.holders, 6, 120),
    evidence,
    currentLevel: status === "unevaluated" ? "" : str(h.currentLevel, NARRATIVE_CAP),
  };
}

/** raw → 정규화된 달성 가능성 객체. 없거나 객체가 아니면 undefined(필드 자체를 생략). */
export function normalizeAttainability(raw: unknown): CapabilityAttainability | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const a = raw as Record<string, unknown>;
  const grade = GRADES.includes(a.grade as AttainabilityGrade) ? (a.grade as AttainabilityGrade) : null;
  const drafter = a.draftedBy === "human" || a.draftedBy === "ai" ? a.draftedBy : null;
  const confirmedBy = str(a.confirmedBy, 80) || null;
  const confirmedAt = str(a.confirmedAt, 40) || null;
  const basisHash = str(a.basisHash, 40);
  const staleSince = str(a.staleSince, 40);
  const expectedLevel = str(a.expectedLevel, NARRATIVE_CAP);
  const s3Snapshot = normalizeS3Snapshot(a.s3Snapshot);
  const history = Array.isArray(a.history)
    ? (a.history as unknown[]).map(normalizeHistoryEntry).filter((x): x is AttainabilityHistoryEntry => x !== null).slice(-HISTORY_CAP)
    : [];
  return {
    closingCostKrwM: finiteNonNeg(a.closingCostKrwM, 1e9),
    monthsToAttain: finiteNonNeg(a.monthsToAttain, 1200),
    grade,
    rationale: str(a.rationale, 600),
    evidence: strArr(a.evidence, 8, 300),
    ...(expectedLevel ? { expectedLevel } : {}),
    draftedBy: drafter,
    // 확정자와 확정일은 함께 있을 때만 유효하다.
    confirmedBy: confirmedBy && confirmedAt ? confirmedBy : null,
    confirmedAt: confirmedBy && confirmedAt ? confirmedAt : null,
    ...(basisHash ? { basisHash } : {}),
    ...(s3Snapshot ? { s3Snapshot } : {}),
    ...(staleSince ? { staleSince } : {}),
    ...(history.length > 0 ? { history } : {}),
  };
}

function normalizeS3Snapshot(raw: unknown): S3Snapshot | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const s = raw as Record<string, unknown>;
  return {
    capability: str(s.capability, 200),
    requiredNote: str(s.requiredNote, 300),
    heldStatus: mapLegacyHeldStatus(s.heldStatus).status,
    requiredLevel: str(s.requiredLevel, NARRATIVE_CAP),
    currentLevel: str(s.currentLevel, NARRATIVE_CAP),
    ...(NECESSITIES.includes(s.necessity as Exclude<GapNecessity, "">) ? { necessity: s.necessity as GapNecessity } : {}),
  };
}

function normalizeHistoryEntry(raw: unknown): AttainabilityHistoryEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const h = raw as Record<string, unknown>;
  const invalidatedAt = str(h.invalidatedAt, 40);
  if (!invalidatedAt) return null;
  const confirmedBy = str(h.confirmedBy, 80) || null;
  const confirmedAt = str(h.confirmedAt, 40) || null;
  return {
    grade: GRADES.includes(h.grade as AttainabilityGrade) ? (h.grade as AttainabilityGrade) : null,
    closingCostKrwM: finiteNonNeg(h.closingCostKrwM, 1e9),
    monthsToAttain: finiteNonNeg(h.monthsToAttain, 1200),
    rationale: str(h.rationale, 600),
    evidence: strArr(h.evidence, 8, 300),
    resolution: RESOLUTIONS.includes(h.resolution as GapResolution) ? (h.resolution as GapResolution) : null,
    ...(str(h.expectedLevel, NARRATIVE_CAP) ? { expectedLevel: str(h.expectedLevel, NARRATIVE_CAP) } : {}),
    confirmedBy: confirmedBy && confirmedAt ? confirmedBy : null,
    confirmedAt: confirmedBy && confirmedAt ? confirmedAt : null,
    basisHash: str(h.basisHash, 40),
    invalidatedAt,
    reason: "s3_changed",
    s3Snapshot: normalizeS3Snapshot(h.s3Snapshot) ?? null,
  };
}

/** Register-level `removedCapabilities` of a stored register JSON (normalized, capped), or []. */
export function parseRemovedCapabilities(json: string | null | undefined): RemovedCapability[] {
  if (!json) return [];
  try {
    const raw = (JSON.parse(json) as { removedCapabilities?: unknown }).removedCapabilities;
    return normalizeRemovedCapabilities(raw);
  } catch {
    return [];
  }
}

export function normalizeRemovedCapabilities(raw: unknown): RemovedCapability[] {
  if (!Array.isArray(raw)) return [];
  const out: RemovedCapability[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    if (!item || typeof item !== "object") continue;
    const rowId = str(item.rowId, 40);
    const removedAt = str(item.removedAt, 40);
    if (!rowId || !removedAt) continue;
    out.push({
      rowId,
      capability: str(item.capability, 200),
      requiredLevel: str(item.requiredLevel, NARRATIVE_CAP),
      currentLevel: str(item.currentLevel, NARRATIVE_CAP),
      attainability: normalizeAttainability(item.attainability) ?? null,
      removedAt,
      removedBy: str(item.removedBy, 80),
    });
  }
  return out.slice(-REMOVED_CAP);
}

/**
 * 레지스터를 저장할 때 S8 판정(attainability)은 저장돼 있던 값을 id로 이어 붙인다 —
 * S3·S5 저장 경로가 클라이언트가 보낸 확정자/확정일을 신뢰하지 않게 하는 장치이며
 * (확정은 사람 전용 경로로만), 클라이언트가 필드를 빠뜨려도 판정이 지워지지 않는다.
 */
export function carryOverAttainability(rows: CapabilityGapRow[], storedJson: string | null | undefined): CapabilityGapRow[] {
  const stored = new Map(parseGapRegister(storedJson).rows.map((r) => [r.id, r.attainability]));
  return rows.map((r) => {
    const { attainability: _drop, ...rest } = r;
    const kept = stored.get(r.id);
    return kept ? { ...rest, attainability: kept } : rest;
  });
}

export function parseGapRegister(json: string | null | undefined): CapabilityGapRegister {
  if (!json) return { rows: [], updatedAt: null };
  try {
    const raw = JSON.parse(json) as { rows?: unknown; updatedAt?: unknown };
    return { rows: normalizeGapRows(raw.rows), updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null };
  } catch {
    return { rows: [], updatedAt: null };
  }
}

export interface GapSummary {
  total: number;
  evaluated: number;
  leading: number;
  average: number;
  partial: number;
  none: number;
  unevaluated: number;
  /** 보유율(%) over judged rows — leading 1, average 1, partial 0.5, none 0. null when nothing judged. */
  coveragePct: number | null;
  /** Same weights over 필수 rows only. null when no judged 필수 row. */
  essentialCoveragePct: number | null;
}

const COVERAGE_WEIGHT: Record<GapHeldStatus, number> = { leading: 1, average: 1, partial: 0.5, none: 0, unevaluated: 0 };

function coverageOf(rows: CapabilityGapRow[]): number | null {
  const judged = rows.filter((r) => r.held.status !== "unevaluated");
  if (judged.length === 0) return null;
  return Math.round((judged.reduce((a, r) => a + COVERAGE_WEIGHT[r.held.status], 0) / judged.length) * 100);
}

export function summarizeGap(rows: CapabilityGapRow[]): GapSummary {
  const n = (s: GapHeldStatus) => rows.filter((r) => r.held.status === s).length;
  const unevaluated = n("unevaluated");
  return {
    total: rows.length,
    evaluated: rows.length - unevaluated,
    leading: n("leading"),
    average: n("average"),
    partial: n("partial"),
    none: n("none"),
    unevaluated,
    coveragePct: coverageOf(rows),
    essentialCoveragePct: coverageOf(rows.filter((r) => r.necessity === "essential")),
  };
}

// ── Decision-support cautions (ADR-0172 §6) — never block, never cap a grade ──

export type CautionTone = "red" | "amber" | "neutral";
export interface GapCaution { key: string; label: string; tone: CautionTone }

/** 필요도 x 보유 판정 matrix. Null = no caution. */
export function necessityFlag(necessity: GapNecessity, status: GapHeldStatus): GapCaution | null {
  if (status === "unevaluated") return { key: "unevaluated", label: "미판정", tone: "neutral" };
  switch (necessity) {
    case "essential":
      return status === "partial" || status === "none" ? { key: "large_gap", label: "큰 격차 주의", tone: "red" } : null;
    case "partial_essential":
      if (status === "none") return { key: "gap", label: "격차", tone: "amber" };
      if (status === "partial") return { key: "check", label: "확인 필요", tone: "amber" };
      return null;
    case "optional":
      return { key: "low_impact", label: "영향 낮음", tone: "neutral" };
    default:
      return null;
  }
}

/** All cautions for a row: the matrix flag plus empty-narrative notes on 필수 rows. */
export function gapCautions(row: Pick<CapabilityGapRow, "necessity" | "requiredLevel" | "currentLevel" | "held">): GapCaution[] {
  const out: GapCaution[] = [];
  const flag = necessityFlag(row.necessity, row.held.status);
  if (flag) out.push(flag);
  if (row.necessity === "essential") {
    if (!row.requiredLevel.trim()) out.push({ key: "required_level_missing", label: "필요 수준 미기술", tone: "amber" });
    if (row.held.status !== "unevaluated" && !row.currentLevel.trim()) out.push({ key: "current_level_missing", label: "보유 수준 미기술", tone: "amber" });
  }
  return out;
}

/**
 * S3 completion (Wave F-6): the capability list must be non-empty and every
 * counted row must carry an EXPLICIT provenance source. normalizeGapRows
 * defaults a missing source to "manual", so this reads the RAW rows — a
 * hand-edited register with no `source` does not count.
 */
export function countSourcedCapabilityRows(json: string | null | undefined): number {
  if (!json) return 0;
  try {
    const raw = JSON.parse(json) as { rows?: unknown };
    if (!Array.isArray(raw.rows)) return 0;
    return (raw.rows as Array<Record<string, unknown>>).filter(
      (r) => r && typeof r === "object" && typeof r.capability === "string" && r.capability.trim() !== "" && SOURCES.includes(r.source as GapSource),
    ).length;
  } catch {
    return 0;
  }
}
