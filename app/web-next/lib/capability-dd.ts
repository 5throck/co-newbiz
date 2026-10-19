// @version 1.0.0
/**
 * capability-dd — S9 실사·검증의 필요 역량 판정 (브라운필드, 2026-10-19 decider
 * direction + design 2026-10-19-brownfield-capability-dd-design.md). Greenfield는
 * S5 capability-assessment가 같은 질문에 답한다; 브라운필드는 S5가 스킵되므로 S9에서
 * "이 인수가 S3 필요 역량 격차를 실제로 메우는가"를 사람이 판정한다.
 *
 * 저장은 opportunity.capability_dd_verdicts_json 사이드카(마이그레이션 0154) —
 * 레지스터 row_id로 키잉되고 레지스터 자체는 건드리지 않는다. S3 재저장이 판정을
 * 유실할 수 없고, persistGapRegister의 무효화 연쇄도 발생하지 않는다(판정은
 * S8 판정의 근거가 아니라 실사의 발견이므로).
 */
import { appendAudit } from "../../../db/lib/access-control.ts";

export const CAPABILITY_DD_COVERAGES = ["resolved", "partial", "unresolved"] as const;
export type CapabilityDdCoverage = (typeof CAPABILITY_DD_COVERAGES)[number];

export const CAPABILITY_DD_COVERAGE_KO: Record<CapabilityDdCoverage, string> = {
  resolved: "해소 (대상 보유)",
  partial: "부분 해소",
  unresolved: "미해소 (자체 투자 필요)",
};

export interface CapabilityDdVerdict {
  /** capability_gap_json register row id this verdict answers. */
  rowId: string;
  /** Denormalized register capability text — display survives register re-saves. */
  capability: string;
  coverage: CapabilityDdCoverage;
  /** Free-text evidence note (dd_finding 참조 권장). */
  note: string;
  by: string;
  at: string;
}

export interface CapabilityDdVerdicts {
  rows: CapabilityDdVerdict[];
}

export function parseCapabilityDdVerdicts(raw: string | null | undefined): CapabilityDdVerdict[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { rows?: unknown };
    if (!Array.isArray(parsed?.rows)) return [];
    return parsed.rows.filter(
      (r): r is CapabilityDdVerdict =>
        !!r && typeof r === "object" && typeof (r as CapabilityDdVerdict).rowId === "string" &&
        typeof (r as CapabilityDdVerdict).capability === "string" &&
        CAPABILITY_DD_COVERAGES.includes((r as CapabilityDdVerdict).coverage) &&
        typeof (r as CapabilityDdVerdict).at === "string",
    );
  } catch {
    return [];
  }
}

export function serializeCapabilityDdVerdicts(verdicts: CapabilityDdVerdict[]): string {
  return JSON.stringify({ rows: verdicts });
}

export class CapabilityDdValidationError extends Error {}

export interface CapabilityDdPutInput {
  rowId: unknown;
  capability: unknown;
  coverage: unknown;
  note?: unknown;
}

/** Validate one person-submitted verdict. Strict — unknown row ids/coverage are
 *  rejected upstream (the caller checks rowId against the register). */
export function validateCapabilityDdInput(
  input: CapabilityDdPutInput,
  knownRowIds: ReadonlySet<string>,
): CapabilityDdVerdict {
  const bad = (m: string) => new CapabilityDdValidationError(m);
  const rowId = typeof input.rowId === "string" ? input.rowId.trim() : "";
  if (!rowId) throw bad("rowId는 필수입니다.");
  if (!knownRowIds.has(rowId)) throw bad("알 수 없는 필요 역량 항목입니다 — 등록부를 새로고침하세요.");
  const capability = typeof input.capability === "string" ? input.capability.trim() : "";
  if (!capability) throw bad("capability 문구가 비어 있습니다.");
  const coverage = input.coverage;
  if (typeof coverage !== "string" || !CAPABILITY_DD_COVERAGES.includes(coverage as CapabilityDdCoverage)) {
    throw bad("coverage는 해소/부분 해소/미해소 중 하나여야 합니다.");
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 2000) throw bad("근거 노트는 2000자 이하여야 합니다.");
  return { rowId, capability, coverage: coverage as CapabilityDdCoverage, note, by: "", at: "" };
}

/** Merge person verdicts into the sidecar: one verdict per row id (latest wins),
 *  ordered by register row order. Pure — returns the new sidecar array. */
export function mergeCapabilityDdVerdicts(
  existing: CapabilityDdVerdict[],
  incoming: CapabilityDdVerdict,
  registerOrder: readonly string[],
): CapabilityDdVerdict[] {
  const merged = existing.filter((v) => v.rowId !== incoming.rowId);
  merged.push(incoming);
  return merged.sort((a, b) => {
    const ia = registerOrder.indexOf(a.rowId);
    const ib = registerOrder.indexOf(b.rowId);
    return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
  });
}
