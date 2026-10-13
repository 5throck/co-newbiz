// S3 역량 갭 분석 공용 로직 — 시장 요구사항(필요 역량)을 그룹/계열사 보유
// 역량과 대조한 갭 레지스터의 타입·정규화·요약. 레지스터 본체는
// opportunity.capability_gap_json(마이그레이션 0098)에 저장된다.
//
// 보유 판정의 근거는 그룹/계열사 프로필(company_profile_version strengths·
// industryExposure)뿐이다 — 내부(자사 단독) 역량 평가는 후속 보강 사항이며,
// 모든 표면에 그 한계를 안내 문구로 명시한다(2026-09-14 사용자 요구).
// 해소 어휘(build/partner/hire/invest)는 S5 capability_gaps_json(0056)과 동일
// 어휘를 써서 S5로의 승계를 가능하게 한다.

export type GapHeldStatus = "met" | "partial" | "unmet" | "unevaluated";
export type GapResolution = "build" | "partner" | "hire" | "invest";
export type GapSource = "s2_sketch" | "s1_factors" | "synergy_area" | "manual";

export interface CapabilityGapRow {
  id: string;
  capability: string;
  source: GapSource;
  requiredNote: string;
  held: { status: GapHeldStatus; holders: string[]; evidence: string };
  resolution: GapResolution | null;
  note: string;
  // S5(그린필드 자체 진출, ADR-0136)가 채우는 필드 — S3은 이 값을
  // 모른 채로 두어도(읽지 않고 그대로 왕복시켜도) 무방하다.
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
  draftedBy: AttainabilityDrafter | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

// 공용 5단계 수준 척도(ADR-0168) — 필요 수준·보유 수준이 같은 척도를 쓴다.
// 저장값은 한글 라벨 그대로(requiredLevel/currentLevel 문자열 컬럼 유지, 마이그레이션 없음).
export const LEVEL_SCALE = [
  { step: 1, label: "없음", meaning: "보유 역량 없음" },
  { step: 2, label: "기초", meaning: "외부 도움이 있어야 수행 가능" },
  { step: 3, label: "실무", meaning: "혼자서 보통 품질로 수행 가능" },
  { step: 4, label: "숙련", meaning: "규모에서도 안정적인 품질" },
  { step: 5, label: "선도", meaning: "업계 선도, 경쟁 우위의 원천" },
] as const;
export const LEVEL_LABELS: string[] = LEVEL_SCALE.map((l) => l.label);

/** 척도 라벨이면 단계(1~5), 아니면 null(미판정 또는 레거시 자유 텍스트). */
export function levelStep(text: string | null | undefined): number | null {
  const t = (text ?? "").trim();
  return LEVEL_SCALE.find((l) => l.label === t)?.step ?? null;
}

/** 비어 있지 않지만 척도에 없는 값 — 삭제하지 않고 레거시 메모로 보여 준다. */
export function isLegacyLevelText(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  return t !== "" && levelStep(t) === null;
}

/** 갭 = 필요 - 보유(0~4). 둘 중 하나라도 척도 밖이면 null. */
export function levelGap(required: string | null | undefined, current: string | null | undefined): number | null {
  const r = levelStep(required);
  const c = levelStep(current);
  return r === null || c === null ? null : Math.max(0, r - c);
}

export const ATTAINABILITY_GRADE_LABEL: Record<AttainabilityGrade, string> = { high: "높음", medium: "중간", low: "낮음" };
export const ATTAINABILITY_UNJUDGED_LABEL = "미판정";
const GRADES: AttainabilityGrade[] = ["high", "medium", "low"];

export interface CapabilityGapRegister {
  rows: CapabilityGapRow[];
  updatedAt: string | null;
}

export const HELD_STATUS_LABEL: Record<GapHeldStatus, string> = {
  met: "충족",
  partial: "부분 충족",
  unmet: "미보유",
  unevaluated: "미판정",
};

// S4 브라운필드 sub_track 라벨(labels.ts BF_SUB.partnership: "전략 제휴")과
// 표현을 통일한다(ADR-0136) — build/hire/invest는 S4에 대응 개념이 없어 그대로 둔다.
export const RESOLUTION_LABEL: Record<GapResolution, string> = {
  build: "직접 구축",
  partner: "전략 제휴",
  hire: "영입",
  invest: "지분 투자",
};

export const HELD_STATUS_CHIP: Record<GapHeldStatus, string> = {
  met: "status-green",
  partial: "status-amber",
  unmet: "status-red",
  unevaluated: "status-not-started",
};

const HELD_STATUSES: GapHeldStatus[] = ["met", "partial", "unmet", "unevaluated"];
const RESOLUTIONS: GapResolution[] = ["build", "partner", "hire", "invest"];
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
    const status = HELD_STATUSES.includes(heldRaw.status as GapHeldStatus) ? (heldRaw.status as GapHeldStatus) : "unevaluated";
    const resolution = RESOLUTIONS.includes(item.resolution as GapResolution) ? (item.resolution as GapResolution) : null;
    const attainability = normalizeAttainability(item.attainability);
    rows.push({
      id: str(item.id, 40) || `gap-${rows.length + 1}-${Date.now().toString(36)}`,
      capability,
      source,
      requiredNote: str(item.requiredNote, 300),
      held: {
        status,
        holders: status === "unevaluated" ? [] : strArr(heldRaw.holders, 6, 120),
        evidence: str(heldRaw.evidence, 400),
      },
      resolution,
      note: str(item.note, 300),
      requiredLevel: str(item.requiredLevel, 120),
      currentLevel: str(item.currentLevel, 120),
      ...(attainability ? { attainability } : {}),
    });
  }
  return rows;
}

const finiteNonNeg = (v: unknown, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : null;

/** raw → 정규화된 달성 가능성 객체. 없거나 객체가 아니면 undefined(필드 자체를 생략). */
export function normalizeAttainability(raw: unknown): CapabilityAttainability | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const a = raw as Record<string, unknown>;
  const grade = GRADES.includes(a.grade as AttainabilityGrade) ? (a.grade as AttainabilityGrade) : null;
  const drafter = a.draftedBy === "human" || a.draftedBy === "ai" ? a.draftedBy : null;
  const confirmedBy = str(a.confirmedBy, 80) || null;
  const confirmedAt = str(a.confirmedAt, 40) || null;
  return {
    closingCostKrwM: finiteNonNeg(a.closingCostKrwM, 1e9),
    monthsToAttain: finiteNonNeg(a.monthsToAttain, 1200),
    grade,
    rationale: str(a.rationale, 600),
    evidence: strArr(a.evidence, 8, 300),
    draftedBy: drafter,
    // 확정자와 확정일은 함께 있을 때만 유효하다.
    confirmedBy: confirmedBy && confirmedAt ? confirmedBy : null,
    confirmedAt: confirmedBy && confirmedAt ? confirmedAt : null,
  };
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
  met: number;
  partial: number;
  unmet: number;
  unevaluated: number;
  /** 평정된 행 기준 충족률(%) — met 1, partial 0.5. 평정 0건이면 null. */
  coveragePct: number | null;
}

export function summarizeGap(rows: CapabilityGapRow[]): GapSummary {
  const met = rows.filter((r) => r.held.status === "met").length;
  const partial = rows.filter((r) => r.held.status === "partial").length;
  const unmet = rows.filter((r) => r.held.status === "unmet").length;
  const unevaluated = rows.filter((r) => r.held.status === "unevaluated").length;
  const evaluated = met + partial + unmet;
  return {
    total: rows.length,
    evaluated,
    met,
    partial,
    unmet,
    unevaluated,
    coveragePct: evaluated > 0 ? Math.round(((met + 0.5 * partial) / evaluated) * 100) : null,
  };
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
