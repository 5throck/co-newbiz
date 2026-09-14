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
}

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

export const RESOLUTION_LABEL: Record<GapResolution, string> = {
  build: "구축",
  partner: "파트너",
  hire: "영입",
  invest: "투자",
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
    });
  }
  return rows;
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
