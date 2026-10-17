// ADR-0179 slice 2 — anchor scope-compatibility check (design §5). The market
// anchor's declared scope lives on the market_sizing_version PAYLOAD (OPEN-2,
// extracted on read — no migration); the opportunity's structured
// target_scope_json (slice 1) is the TARGET side. compareAnchorScope yields
// ok / mismatch (`시장 범위 불일치`) / unknown (`시장 범위 미확인`), where a
// legacy unscoped anchor, an unset target scope or an unparsable payload is
// honestly `unknown`, never a silent OK. A worldwide anchor against a regional
// target is `mismatch` — coverage is not compatibility. The flag is DISPLAY /
// EVIDENCE only: never a gate block, never a grade cap by itself; per project
// non-negotiable #4 an unresolved mismatch/unknown is recorded as
// confidence-lowering evidence for the human RAG judgement (the note says so).

import type { TargetScope } from "./target-scope.ts";
import { readSizingDeclaredScope, readSizingEffectiveScope } from "./sizing-payload.ts";
import { readTargetScope } from "../../../db/repositories/entry-market.repository.ts";
import type { Database } from "bun:sqlite";

export type AnchorScopeStatus = "ok" | "mismatch" | "unknown";

export const ANCHOR_SCOPE_FLAG_LABEL: Record<Exclude<AnchorScopeStatus, "ok">, string> = {
  mismatch: "시장 범위 불일치",
  unknown: "시장 범위 미확인",
};

export const ANCHOR_SCOPE_CONFIDENCE_NOTE =
  "참고 정보이며 승인 조건이 아닙니다 — 미해결 상태는 데이터 신뢰도 하향 근거로 기록되어 사람의 RAG 판단에 반영됩니다 (ADR-0179, 불변 경계 #4).";

export interface AnchorScopeVerdict {
  status: AnchorScopeStatus;
  reason: string;
}

/** Minimal structural scope input — only regions decide the comparison, so
 *  the check accepts anything region-shaped (a full TargetScope from the
 *  opportunity, a payload-extracted scope, a test fixture). */
export interface ScopeLike {
  regions: readonly string[];
}

/** Pure comparison (design §5.2). Segments are advisory text and NOT compared
 *  (OPEN-1); only regions decide. `ok` requires the target regions to be a
 *  subset of the anchor's declared regions. A `worldwide` anchor against a
 *  regional target is `mismatch` — a documented derivation factor would make
 *  it `ok`, and none can exist until a scoped sizing is linked (OPEN-3). */
export function compareAnchorScope(anchorScope: ScopeLike | null, targetScope: ScopeLike | null): AnchorScopeVerdict {
  if (!targetScope) {
    return { status: "unknown", reason: "기회의 대상 범위 미설정 — 앵커 범위 비교 불가 (레거시, 범위 지정 필요)" };
  }
  if (!anchorScope) {
    return { status: "unknown", reason: "앵커 근거 범위 미기재 — 범위 지정 시장규모 미연결 (근거 범위 미기재)" };
  }
  const anchorRegions = new Set(anchorScope.regions);
  const targetRegions = targetScope.regions;
  if (anchorRegions.has("worldwide") && !targetRegions.includes("worldwide")) {
    return { status: "mismatch", reason: "앵커는 전체(worldwide) 범위, 대상은 지역 범위 — 지역 파생 근거 없이는 포괄이 적합을 의미하지 않음" };
  }
  const subset = targetRegions.every((r) => anchorRegions.has(r));
  if (subset) {
    return { status: "ok", reason: "대상 범위가 앵커 선언 범위에 포함됨" };
  }
  return { status: "mismatch", reason: `앵커 범위(${anchorScope.regions.join(", ")})와 대상 범위(${targetRegions.join(", ")}) 불일치` };
}

/** The anchor's declared scope from a market_sizing_version payload (OPEN-2:
 *  payload-only, extracted on read). Delegates to the shared shape-compatible
 *  reader (ADR-0180 slice 1 — top-level or matrix.scope). Tolerant by
 *  contract: invalid JSON, a missing/malformed `scope` object or wrong-shaped
 *  regions yield null (→ `unknown`), NEVER a throw — a legacy or hand-written
 *  payload can never break a read. set_by/set_at are not required on the
 *  sizing side. */
export function extractSizingVersionScope(payload: string | null | undefined): { regions: string[]; segments: string[]; unit_basis: string | null } | null {
  return readSizingDeclaredScope(payload);
}

/** The anchor side resolved from the opportunity's LINKED sizing version
 *  (ADR-0179 amendment slice A): extractSizingVersionScope on the pinned
 *  version's payload. Tolerant — no link, a missing version row or an
 *  unparsable payload all yield null (→ `unknown`), never a throw. */
export function resolveLinkedAnchorScope(db: Database, opportunityId: string): ScopeLike | null {
  const row = db
    .query("SELECT mv.payload AS payload FROM opportunity o LEFT JOIN market_sizing_version mv ON mv.id = o.sizing_version_id WHERE o.id = ?")
    .get(opportunityId) as { payload: string | null } | undefined;
  if (!row?.payload) return null;
  try {
    // ADR-0181 amendment: an undeclared systematic-market-sizing payload's
    // EFFECTIVE coverage is its own matrix (regions with weight > 0) — the
    // anchor-scope verdict compares against that instead of always-unknown.
    return extractSizingVersionScope(row.payload) ?? readSizingEffectiveScope(row.payload);
  } catch {
    return null;
  }
}

/** Run-note fragment (design §5.2a) — appended ONLY when a person-set target
 *  scope exists, so notes with no scope stay byte-identical (bit-identity).
 *  The anchor side defaults to null: with no sizing version linked to the
 *  opportunity (amendment slice A unlinked / legacy) a set target scope
 *  yields an honest `unknown`, never a fabricated ok. Never throws. */
export function anchorScopeNoteFragment(targetScope: TargetScope | null | undefined, anchorScope: ScopeLike | null = null): string {
  if (!targetScope) return "";
  const v = compareAnchorScope(anchorScope, targetScope);
  return `; anchor_scope=${v.status}; anchor_scope_reason=${v.reason}`;
}

export interface AnchorScopeFlag {
  status: AnchorScopeStatus;
  /** Korean chip label; null for `ok` (no flag rendered). */
  label: string | null;
  reason: string;
  has_target_scope: boolean;
  confidence_note: string;
}

/** Live read-model truth (design §5.2b): recomputed from stored data on every
 *  read so the flag updates when a person sets the scope or the link, without
 *  regenerating. The anchor side is the opportunity's LINKED sizing version
 *  (amendment slice A); unlinked it stays null and the flag is `unknown`
 *  until a person sets the target scope AND a scoped anchor lands; it stays
 *  visible as confidence-lowering evidence, never a block. Returns null when
 *  the project has no source opportunity at all. */
export function resolveAnchorScopeFlag(db: Database, projectId: string): AnchorScopeFlag | null {
  const row = db
    .query(
      "SELECT o.id AS opp_id FROM md_project p LEFT JOIN opportunity o ON o.id = p.source_opportunity_id WHERE p.id = ?",
    )
    .get(projectId) as { opp_id: string | null } | undefined;
  if (!row?.opp_id) return null;
  // ADR-0181 slice 1: the scope reads through the entry-market repository
  // (0151 tables first, frozen JSON fallback) — a hand-written wrong-shape
  // column or a corrupt table row yields unknown, never a read failure.
  const targetScope: TargetScope | null = readTargetScope(db, row.opp_id);
  // Anchor scope: the opportunity's LINKED sizing version (amendment slice A).
  // Unlinked (or a deleted version row / unparsable payload) → null → honest
  // `unknown`; linked, the pinned version's declared scope decides
  // ok / mismatch. Bit-identical when unlinked.
  const anchorScope = resolveLinkedAnchorScope(db, row.opp_id);
  const v = compareAnchorScope(anchorScope, targetScope);
  return {
    status: v.status,
    label: v.status === "ok" ? null : ANCHOR_SCOPE_FLAG_LABEL[v.status],
    reason: v.reason,
    has_target_scope: targetScope != null,
    confidence_note: ANCHOR_SCOPE_CONFIDENCE_NOTE,
  };
}
