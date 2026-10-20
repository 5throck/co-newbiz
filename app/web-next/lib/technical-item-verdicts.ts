// @version 1.0.0
/**
 * technical-item-verdicts — S9 실사·검증에서 기술 렌즈 항목(T2~T5)을 사람이 판정한다
 * (2026-10-20 decider round 4: 판정 주전장은 S9, S8은 파생 반영). T1은 역량 판정에서
 * 자동 도출되고 T6 짝 검증은 이 판정들과 S8 렌즈의 연결을 보여준다.
 *
 * 저장은 opportunity.technical_item_verdicts_json 사이드카(마이그레이션 0157) —
 * 렌즈 JSON(capability_gap_json)을 건드리지 않으므로 S3 재저장·무효화 연쇄와
 * 무관하다. 항목 키당 판정 한 건(최신이 이긴다). 경계 #2: 기록은 사람만.
 *
 * Pure and client-safe (the S9 recording block imports the labels) — the sidecar
 * upsert and audit live in the technical-items route.
 */

/** T1/T6는 파생 항목이라 여기서 다루지 않는다 — T2~T5만 사람 판정 대상. */
export const TECHNICAL_ITEM_KEYS = ["T2", "T3", "T4", "T5"] as const;
export type TechnicalItemKey = (typeof TECHNICAL_ITEM_KEYS)[number];

export const TECHNICAL_ITEM_VERDICTS = ["met", "caution", "unmet"] as const;
export type TechnicalItemVerdictValue = (typeof TECHNICAL_ITEM_VERDICTS)[number];

export const TECHNICAL_ITEM_VERDICT_KO: Record<TechnicalItemVerdictValue, string> = {
  met: "충족",
  caution: "주의",
  unmet: "미충족",
};

export const TECHNICAL_ITEM_LABELS: Record<TechnicalItemKey, string> = {
  T2: "기술 성숙도(TRL)",
  T3: "핵심 인력·설비·시설",
  T4: "지식재산·라이선스",
  T5: "인허가·인증 확보 가능성",
};

export interface TechnicalItemVerdict {
  itemKey: TechnicalItemKey;
  verdict: TechnicalItemVerdictValue;
  /** Free-text evidence note (S9 조사내역 dd_finding 참조 권장). */
  note: string;
  by: string;
  at: string;
}

export function parseTechnicalItemVerdicts(raw: string | null | undefined): TechnicalItemVerdict[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { rows?: unknown };
    if (!Array.isArray(parsed?.rows)) return [];
    return parsed.rows.filter(
      (r): r is TechnicalItemVerdict =>
        !!r && typeof r === "object" &&
        TECHNICAL_ITEM_KEYS.includes((r as TechnicalItemVerdict).itemKey) &&
        TECHNICAL_ITEM_VERDICTS.includes((r as TechnicalItemVerdict).verdict) &&
        typeof (r as TechnicalItemVerdict).by === "string" &&
        typeof (r as TechnicalItemVerdict).at === "string",
    );
  } catch {
    return [];
  }
}

export function serializeTechnicalItemVerdicts(verdicts: TechnicalItemVerdict[]): string {
  return JSON.stringify({ rows: verdicts });
}

export class TechnicalItemValidationError extends Error {}

export interface TechnicalItemPutInput {
  itemKey: unknown;
  verdict: unknown;
  note?: unknown;
}

/** Validate one person-submitted item verdict. Strict — unknown keys/verdicts reject. */
export function validateTechnicalItemVerdictInput(input: TechnicalItemPutInput): TechnicalItemVerdict {
  const bad = (m: string) => new TechnicalItemValidationError(m);
  const itemKey = input.itemKey;
  if (typeof itemKey !== "string" || !TECHNICAL_ITEM_KEYS.includes(itemKey as TechnicalItemKey)) {
    throw bad("itemKey는 T2/T3/T4/T5 중 하나여야 합니다.");
  }
  const verdict = input.verdict;
  if (typeof verdict !== "string" || !TECHNICAL_ITEM_VERDICTS.includes(verdict as TechnicalItemVerdictValue)) {
    throw bad("verdict는 충족/주의/미충족 중 하나여야 합니다.");
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 2000) throw bad("근거 노트는 2000자 이하여야 합니다.");
  return { itemKey: itemKey as TechnicalItemKey, verdict: verdict as TechnicalItemVerdictValue, note, by: "", at: "" };
}

/** Merge into the sidecar: one verdict per item key (latest wins), T2→T5 order. Pure. */
export function mergeTechnicalItemVerdicts(
  existing: TechnicalItemVerdict[],
  incoming: TechnicalItemVerdict,
): TechnicalItemVerdict[] {
  const merged = existing.filter((v) => v.itemKey !== incoming.itemKey);
  merged.push(incoming);
  return merged.sort(
    (a, b) => TECHNICAL_ITEM_KEYS.indexOf(a.itemKey) - TECHNICAL_ITEM_KEYS.indexOf(b.itemKey),
  );
}
