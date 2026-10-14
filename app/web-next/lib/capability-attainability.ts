// S8 필요 역량 달성 가능성 (ADR-0168, 설계 2026-10-14) — S3 레지스터
// (opportunity.capability_gap_json)에 행별 판정을 얹는 순수 로직과 저장 헬퍼.
// 판정자는 사람이다(AI는 초안만, 슬라이스 3). 수치는 사업성 모델에 자동 반영하지 않는다.
import type { Database } from "bun:sqlite";
import { appendAudit } from "../../../db/lib/access-control.ts";
import {
  ATTAINABILITY_GRADE_LABEL,
  LEVEL_LABELS,
  carryOverAttainability,
  levelGap,
  levelStep,
  normalizeAttainability,
  parseGapRegister,
  parseRemovedCapabilities,
  summarizeGap,
  type AttainabilityGrade,
  type AttainabilityHistoryEntry,
  type CapabilityAttainability,
  type CapabilityGapRow,
  type GapResolution,
  type RemovedCapability,
} from "./capability-gap.ts";
import { capabilityRowHash, isStale, s3Changes, s3SnapshotOf, type S3Change } from "./capability-linkage.ts";
import { persistGapRegister } from "./capability-register-write.ts";

export const ATTAINABILITY_BANNER_TEXT =
  "필요 역량 달성 가능성이 확인되지 않은 항목이 있습니다 — 이 분석은 필요 역량을 확보할 수 있다는 전제를 둡니다.";
export const ATTAINABILITY_EMPTY_BANNER_TEXT =
  "S3 필요 역량 레지스터가 비어 있거나 아직 평가되지 않았습니다 — 이 분석은 필요 역량을 확보할 수 있다는 전제를 둡니다.";

export function gradeOfRow(row: CapabilityGapRow): AttainabilityGrade | null {
  return row.attainability?.grade ?? null;
}

export interface AttainabilitySummary {
  total: number;
  /** 보유 판정(S3) 건수: 충족/부분/미보유/미판정. */
  held: { met: number; partial: number; unmet: number; unevaluated: number };
  /** 달성 가능성 판정 건수. */
  grades: { high: number; medium: number; low: number; unjudged: number };
  /** 사람이 확정한 판정 수 / 판정은 있으나 확정 전인 수. */
  confirmed: number;
  awaitingConfirmation: number;
  /** Rows whose S3 content changed after the judgement (ADR-0170); counted as unjudged. */
  stale: number;
  banner: boolean;
  bannerReasons: Array<"empty" | "unevaluated" | "unjudged" | "low" | "stale">;
  bannerText: string | null;
}

export function attainabilitySummary(rows: CapabilityGapRow[]): AttainabilitySummary {
  const gap = summarizeGap(rows);
  const grades = { high: 0, medium: 0, low: 0, unjudged: 0 };
  let confirmed = 0;
  let awaiting = 0;
  let stale = 0;
  for (const r of rows) {
    if (isStale(r)) {
      // ADR-0170: an S3 change after the judgement makes it unjudged until a person re-judges.
      stale += 1;
      grades.unjudged += 1;
      continue;
    }
    const g = gradeOfRow(r);
    if (g) grades[g] += 1;
    else grades.unjudged += 1;
    if (g) {
      if (r.attainability?.confirmedAt) confirmed += 1;
      else awaiting += 1;
    }
  }
  const reasons: AttainabilitySummary["bannerReasons"] = [];
  if (rows.length === 0) reasons.push("empty");
  else {
    if (gap.evaluated === 0) reasons.push("unevaluated");
    if (grades.unjudged - stale > 0) reasons.push("unjudged");
    if (stale > 0) reasons.push("stale");
    if (grades.low > 0) reasons.push("low");
  }
  return {
    total: rows.length,
    held: { met: gap.met, partial: gap.partial, unmet: gap.unmet, unevaluated: gap.unevaluated },
    grades,
    confirmed,
    awaitingConfirmation: awaiting,
    stale,
    banner: reasons.length > 0,
    bannerReasons: reasons,
    bannerText: reasons.length === 0 ? null : rows.length === 0 || reasons.includes("empty") || reasons.includes("unevaluated") ? ATTAINABILITY_EMPTY_BANNER_TEXT : ATTAINABILITY_BANNER_TEXT,
  };
}

export interface AttainabilityRowView {
  id: string;
  capability: string;
  held_status: CapabilityGapRow["held"]["status"];
  required_level: string;
  current_level: string;
  required_step: number | null;
  current_step: number | null;
  level_gap: number | null;
  resolution: GapResolution | null;
  closing_cost_krw_m: number | null;
  months_to_attain: number | null;
  grade: AttainabilityGrade | null;
  grade_label: string;
  rationale: string;
  evidence: string[];
  drafted_by: "human" | "ai" | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  // S3-owned held judgement, read-only here (ADR-0170 / decider 2026-10-14)
  required_note: string;
  held_holders: string[];
  held_evidence: string;
  // ADR-0170 linkage (read-only)
  stale: boolean;
  stale_since: string | null;
  basis_hash: string | null;
  /** Current S3 row hash (send back as `s3Hash` when saving, so a concurrent S3 edit is detected). */
  s3_hash: string;
  /** What changed in S3 since the judgement (old to new). */
  s3_changes: S3Change[];
  /** Latest superseded judgement, or null. */
  prior: AttainabilityHistoryEntry | null;
  history_count: number;
}

export function rowView(r: CapabilityGapRow): AttainabilityRowView {
  const a = r.attainability;
  const stale = isStale(r);
  // A stale judgement keeps its prior values visible (pre-filled) but is neither confirmed nor counted as a grade.
  const g = a?.grade ?? null;
  return {
    id: r.id,
    capability: r.capability,
    held_status: r.held.status,
    required_level: r.requiredLevel,
    current_level: r.currentLevel,
    required_step: levelStep(r.requiredLevel),
    current_step: levelStep(r.currentLevel),
    level_gap: levelGap(r.requiredLevel, r.currentLevel),
    resolution: r.resolution,
    closing_cost_krw_m: a?.closingCostKrwM ?? null,
    months_to_attain: a?.monthsToAttain ?? null,
    grade: g,
    grade_label: g ? ATTAINABILITY_GRADE_LABEL[g] : "미판정",
    rationale: a?.rationale ?? "",
    evidence: a?.evidence ?? [],
    drafted_by: a?.draftedBy ?? null,
    confirmed_by: stale ? null : a?.confirmedBy ?? null,
    confirmed_at: stale ? null : a?.confirmedAt ?? null,
    required_note: r.requiredNote ?? "",
    held_holders: r.held.holders,
    held_evidence: r.held.evidence,
    stale,
    stale_since: stale ? a?.staleSince ?? null : null,
    basis_hash: a?.basisHash ?? null,
    s3_hash: capabilityRowHash(r),
    s3_changes: stale ? s3Changes(r) : [],
    prior: a?.history?.[a.history.length - 1] ?? null,
    history_count: a?.history?.length ?? 0,
  };
}

export function buildAttainabilityView(opportunityId: string | null, rows: CapabilityGapRow[], updatedAt: string | null, removed: RemovedCapability[] = []) {
  return {
    opportunity_id: opportunityId,
    stored: updatedAt !== null,
    updated_at: updatedAt,
    scale: LEVEL_LABELS,
    rows: rows.map(rowView),
    summary: attainabilitySummary(rows),
    removed_capabilities: removed,
  };
}

// ── Save / confirm ─────────────────────────────────────────────────────────

export interface AttainabilityPatch {
  id: string;
  /**
   * Concurrency token, NOT an S3 value: the S3 row hash the client's page was showing
   * (AttainabilityRowView.s3_hash). If S3 changed since, the judgement is stamped on the
   * hash the person actually saw, so the row stays stale and must be re-judged.
   */
  s3Hash?: unknown;
  resolution?: unknown;
  closingCostKrwM?: unknown;
  monthsToAttain?: unknown;
  grade?: unknown;
  rationale?: unknown;
  evidence?: unknown;
}

export type AttainabilityError =
  | { code: "invalid_request"; message: string }
  | { code: "unknown_row"; message: string }
  | { code: "invalid_level"; message: string }
  | { code: "invalid_cost"; message: string }
  | { code: "rationale_required"; message: string }
  | { code: "nothing_to_confirm"; message: string }
  | { code: "s3_owned_field"; message: string }
  | { code: "stale_requires_rejudge"; message: string };

/** S3-owned fields (ADR-0170 D2): S8 may not write them; edit in S3 (levels also in S5). */
export const S3_OWNED_PATCH_FIELDS = ["capability", "requiredNote", "held", "requiredLevel", "currentLevel", "source", "note"] as const;

const RESOLUTIONS = ["build", "partner", "hire", "invest"];
const GRADE_KEYS = ["high", "medium", "low"];

const numOrNull = (v: unknown): number | null | "bad" => {
  if (v === null || v === "") return null;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : "bad";
};

/** 행 패치를 검증해 적용한다. 판정 내용이 바뀐 행은 확정이 풀린다. */
export function applyAttainabilityPatches(
  rows: CapabilityGapRow[],
  patches: unknown,
  actor: { userId: string; human: boolean },
): { ok: true; rows: CapabilityGapRow[]; changedIds: string[] } | { ok: false; error: AttainabilityError } {
  if (!Array.isArray(patches) || patches.length === 0) return { ok: false, error: { code: "invalid_request", message: "rows(행별 판정 배열)는 필수입니다." } };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, CapabilityGapRow>();
  for (const raw of patches as Array<Record<string, unknown>>) {
    const id = typeof raw?.id === "string" ? raw.id : "";
    const base = out.get(id) ?? byId.get(id);
    if (!id || !base) return { ok: false, error: { code: "unknown_row", message: `레지스터에 없는 행입니다: ${id || "(id 없음)"}` } };
    const owned = S3_OWNED_PATCH_FIELDS.find((f) => f in raw);
    if (owned) {
      return { ok: false, error: { code: "s3_owned_field", message: `${owned}은(는) S3가 소유한 항목이라 S8에서 바꿀 수 없습니다 — S3(필요 수준·보유 수준은 S5)에서 수정하세요.` } };
    }
    if ("s3Hash" in raw && raw.s3Hash !== null && typeof raw.s3Hash !== "string") {
      return { ok: false, error: { code: "invalid_request", message: "s3Hash는 문자열입니다." } };
    }
    let next: CapabilityGapRow = { ...base };
    if ("resolution" in raw) {
      if (raw.resolution !== null && raw.resolution !== "" && !RESOLUTIONS.includes(raw.resolution as string)) {
        return { ok: false, error: { code: "invalid_request", message: "resolution은 build | partner | hire | invest 또는 null입니다." } };
      }
      next.resolution = raw.resolution ? (raw.resolution as GapResolution) : null;
    }
    const prevA: CapabilityAttainability = base.attainability ?? normalizeAttainability({})!;
    const a: CapabilityAttainability = { ...prevA };
    if ("closingCostKrwM" in raw) {
      const n = numOrNull(raw.closingCostKrwM);
      if (n === "bad") return { ok: false, error: { code: "invalid_cost", message: "해소 비용(백만원)은 0 이상의 숫자여야 합니다." } };
      a.closingCostKrwM = n;
    }
    if ("monthsToAttain" in raw) {
      const n = numOrNull(raw.monthsToAttain);
      if (n === "bad") return { ok: false, error: { code: "invalid_cost", message: "달성 기간(개월)은 0 이상의 숫자여야 합니다." } };
      a.monthsToAttain = n;
    }
    if ("grade" in raw) {
      if (raw.grade !== null && raw.grade !== "" && !GRADE_KEYS.includes(raw.grade as string)) {
        return { ok: false, error: { code: "invalid_request", message: "grade는 high | medium | low 또는 null(미판정)입니다." } };
      }
      a.grade = raw.grade ? (raw.grade as AttainabilityGrade) : null;
    }
    if ("rationale" in raw) {
      if (typeof raw.rationale !== "string") return { ok: false, error: { code: "invalid_request", message: "rationale은 문자열입니다." } };
      a.rationale = raw.rationale.trim().slice(0, 600);
    }
    if ("evidence" in raw) {
      if (!Array.isArray(raw.evidence)) return { ok: false, error: { code: "invalid_request", message: "evidence는 문자열 배열입니다." } };
      a.evidence = raw.evidence.map((x) => String(x ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, 8);
    }
    if ((a.grade === "high" || a.grade === "low") && !a.rationale) {
      return { ok: false, error: { code: "rationale_required", message: `${base.capability}: 달성 가능성 '높음'·'낮음'은 판정 근거가 필요합니다.` } };
    }
    // A fresh save on a stale row IS the re-judgement, even if the values stay the same.
    const changed =
      JSON.stringify({ ...prevA, confirmedBy: null, confirmedAt: null, draftedBy: null }) !== JSON.stringify({ ...a, confirmedBy: null, confirmedAt: null, draftedBy: null }) ||
      next.resolution !== base.resolution || isStale(base);
    if (changed) {
      a.draftedBy = actor.human ? "human" : "ai";
      a.confirmedBy = null;
      a.confirmedAt = null;
      // Server-side stamp of the S3 basis this judgement is made on (a client-sent basisHash is never read).
      const current = capabilityRowHash(next);
      const seen = typeof raw.s3Hash === "string" && raw.s3Hash.trim() !== "" ? raw.s3Hash.trim().slice(0, 40) : current;
      a.basisHash = seen;
      // The snapshot describes the basis; when the page was outdated we do not know those
      // values, so the previously stored snapshot (if any) is kept rather than the new S3 values.
      if (seen === current) a.s3Snapshot = s3SnapshotOf(next);
      delete a.staleSince;
    }
    const hasContent = a.grade !== null || a.closingCostKrwM !== null || a.monthsToAttain !== null || a.rationale !== "" || a.evidence.length > 0 || (a.history?.length ?? 0) > 0;
    if (hasContent) next = { ...next, attainability: a };
    else {
      const { attainability: _x, ...rest } = next;
      next = rest;
    }
    if (changed) out.set(id, next);
  }
  const merged = rows.map((r) => out.get(r.id) ?? r);
  return { ok: true, rows: merged, changedIds: [...out.keys()] };
}

/** 사람 확정: 판정이 있고 아직 확정 전인(또는 지정한) 행을 확정한다. */
export function confirmAttainability(
  rows: CapabilityGapRow[],
  rowIds: string[] | null,
  userId: string,
  at: string,
): { ok: true; rows: CapabilityGapRow[]; confirmedIds: string[] } | { ok: false; error: AttainabilityError } {
  const known = new Set(rows.map((r) => r.id));
  if (rowIds) {
    const bad = rowIds.find((x) => !known.has(x));
    if (bad !== undefined) return { ok: false, error: { code: "unknown_row", message: `레지스터에 없는 행입니다: ${bad}` } };
  }
  // ADR-0170: a judgement made on an outdated S3 basis cannot be confirmed; it needs a fresh save first.
  const staleTargets = rows.filter((r) => isStale(r) && (!rowIds || rowIds.includes(r.id)));
  const explicitStale = rowIds ? staleTargets : [];
  if (explicitStale.length > 0) {
    return { ok: false, error: { code: "stale_requires_rejudge", message: `S3 내용이 바뀐 행은 재판정(저장) 후에 확정할 수 있습니다: ${explicitStale.map((r) => r.capability).join(", ")}` } };
  }
  const confirmed: string[] = [];
  const next = rows.map((r) => {
    const a = r.attainability;
    if (!a || a.grade === null || a.confirmedAt) return r;
    if (rowIds && !rowIds.includes(r.id)) return r;
    if (isStale(r)) return r;
    confirmed.push(r.id);
    // Legacy judgements get their basis stamped on confirmation.
    return { ...r, attainability: { ...a, confirmedBy: userId, confirmedAt: at, basisHash: a.basisHash ?? capabilityRowHash(r), s3Snapshot: a.s3Snapshot ?? s3SnapshotOf(r) } };
  });
  if (confirmed.length === 0 && staleTargets.length > 0) {
    return { ok: false, error: { code: "stale_requires_rejudge", message: "S3 내용이 바뀐 행은 재판정(저장) 후에 확정할 수 있습니다." } };
  }
  if (confirmed.length === 0) return { ok: false, error: { code: "nothing_to_confirm", message: "확정할 판정이 없습니다 — 달성 가능성을 판정한 행만 확정할 수 있습니다." } };
  return { ok: true, rows: next, confirmedIds: confirmed };
}

export function sourceOpportunityOf(db: Database, projectId: string): string | null {
  return (db.query("SELECT source_opportunity_id AS id FROM md_project WHERE id = ?").get(projectId) as { id: string | null } | null)?.id ?? null;
}

export function readRegister(db: Database, opportunityId: string) {
  const row = db.query("SELECT capability_gap_json AS j FROM opportunity WHERE id = ?").get(opportunityId) as { j: string | null } | null;
  if (!row) return null;
  return { json: row.j, ...parseGapRegister(row.j), removed: parseRemovedCapabilities(row.j) };
}

export function writeRegister(
  db: Database,
  opportunityId: string,
  rows: CapabilityGapRow[],
  audit: { actor: string; action: string; target: string; at: string },
): { rows: CapabilityGapRow[]; removed: RemovedCapability[] } {
  return db.transaction(() => {
    // ADR-0170: the shared wrapper also materialises any pending S3-change invalidation.
    const w = persistGapRegister(db, opportunityId, rows, audit.at, audit.actor);
    appendAudit(db, { actor: audit.actor, action: audit.action, target: audit.target, now: audit.at });
    return { rows: w.rows, removed: w.removed };
  })();
}

/**
 * Save drafts: read the CURRENT register, merge ONLY S8-owned fields (resolution and
 * attainability.*) onto it and write, all in one transaction. S3-owned values always come
 * from the stored register, never from the client, so an S3 edit made after the S8 page
 * loaded survives (no lost update).
 */
export function saveAttainability(
  db: Database,
  opportunityId: string,
  patches: unknown,
  actor: { userId: string; human: boolean },
  audit: { action: string; target: string; at: string },
): { ok: true; rows: CapabilityGapRow[]; removed: RemovedCapability[]; changedIds: string[]; updatedAt: string | null } | { ok: false; error: AttainabilityError } {
  return db.transaction(() => {
    const reg = readRegister(db, opportunityId);
    if (!reg) return { ok: false as const, error: { code: "invalid_request" as const, message: "원 기회를 찾을 수 없습니다." } };
    const res = applyAttainabilityPatches(reg.rows, patches, actor);
    if (!res.ok) return res;
    if (res.changedIds.length === 0) return { ok: true as const, rows: reg.rows, removed: reg.removed, changedIds: [], updatedAt: reg.updatedAt };
    const w = writeRegister(db, opportunityId, res.rows, { actor: actor.userId, ...audit });
    return { ok: true as const, rows: w.rows, removed: w.removed, changedIds: res.changedIds, updatedAt: audit.at };
  })();
}

/** Confirm (human-only route): same read-merge-write discipline as saveAttainability. */
export function confirmAndWrite(
  db: Database,
  opportunityId: string,
  rowIds: string[] | null,
  userId: string,
  audit: { action: string; target: string; at: string },
): { ok: true; rows: CapabilityGapRow[]; removed: RemovedCapability[]; confirmedIds: string[] } | { ok: false; error: AttainabilityError } {
  return db.transaction(() => {
    const reg = readRegister(db, opportunityId);
    if (!reg) return { ok: false as const, error: { code: "invalid_request" as const, message: "원 기회를 찾을 수 없습니다." } };
    const res = confirmAttainability(reg.rows, rowIds, userId, audit.at);
    if (!res.ok) return res;
    const w = writeRegister(db, opportunityId, res.rows, { actor: userId, ...audit });
    return { ok: true as const, rows: w.rows, removed: w.removed, confirmedIds: res.confirmedIds };
  })();
}

export { carryOverAttainability };
