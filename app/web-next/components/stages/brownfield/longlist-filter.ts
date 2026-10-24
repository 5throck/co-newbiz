// 품평회 2026-10-22 잔여 #1 (T-20261022-048) — 후보 전체 목록 상태 필터의 순수 헬퍼.
// 화면 컴포넌트에서 분리해 단위 테스트 대상으로 삼는다: "all"이면 원본 순서 그대로,
// 특정 상태면 해당 상태만 남긴다. 정렬은 useBrownfieldTargets 소관 — 여기서 재정렬하지 않는다.
import type { TargetRow } from "./types.ts";

export type TargetStatusFilter = "all" | TargetRow["status"];

export const TARGET_STATUS_FILTERS: readonly TargetStatusFilter[] = ["all", "pending", "shortlisted", "excluded"];

export function filterTargetsByStatus(targets: TargetRow[], filter: TargetStatusFilter): TargetRow[] {
  if (filter === "all") return targets;
  return targets.filter((t) => t.status === filter);
}
