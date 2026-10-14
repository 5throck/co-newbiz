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
  summarizeGap,
  type AttainabilityGrade,
  type CapabilityAttainability,
  type CapabilityGapRow,
  type GapResolution,
} from "./capability-gap.ts";
import { serializeGapRegister } from "./technical-lens.ts";

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
  banner: boolean;
  bannerReasons: Array<"empty" | "unevaluated" | "unjudged" | "low">;
  bannerText: string | null;
}

export function attainabilitySummary(rows: CapabilityGapRow[]): AttainabilitySummary {
  const gap = summarizeGap(rows);
  const grades = { high: 0, medium: 0, low: 0, unjudged: 0 };
  let confirmed = 0;
  let awaiting = 0;
  for (const r of rows) {
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
    if (grades.unjudged > 0) reasons.push("unjudged");
    if (grades.low > 0) reasons.push("low");
  }
  return {
    total: rows.length,
    held: { met: gap.met, partial: gap.partial, unmet: gap.unmet, unevaluated: gap.unevaluated },
    grades,
    confirmed,
    awaitingConfirmation: awaiting,
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
}

export function rowView(r: CapabilityGapRow): AttainabilityRowView {
  const a = r.attainability;
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
    confirmed_by: a?.confirmedBy ?? null,
    confirmed_at: a?.confirmedAt ?? null,
  };
}

export function buildAttainabilityView(opportunityId: string | null, rows: CapabilityGapRow[], updatedAt: string | null) {
  return {
    opportunity_id: opportunityId,
    stored: updatedAt !== null,
    updated_at: updatedAt,
    scale: LEVEL_LABELS,
    rows: rows.map(rowView),
    summary: attainabilitySummary(rows),
  };
}

// ── Save / confirm ─────────────────────────────────────────────────────────

export interface AttainabilityPatch {
  id: string;
  requiredLevel?: unknown;
  currentLevel?: unknown;
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
  | { code: "nothing_to_confirm"; message: string };

const RESOLUTIONS = ["build", "partner", "hire", "invest"];
const GRADE_KEYS = ["high", "medium", "low"];

function levelValue(next: unknown, prev: string, label: string): { ok: true; value: string } | { ok: false; error: AttainabilityError } {
  if (typeof next !== "string") return { ok: false, error: { code: "invalid_level", message: `${label}은 ${LEVEL_LABELS.join("/")} 중 하나(또는 빈 값)여야 합니다.` } };
  const t = next.trim();
  // 척도 밖 레거시 텍스트는 그대로 두는 경우에만 허용한다(삭제·덮어쓰기는 척도 값으로만).
  if (t === "" || LEVEL_LABELS.includes(t) || t === prev) return { ok: true, value: t };
  return { ok: false, error: { code: "invalid_level", message: `${label}은 ${LEVEL_LABELS.join("/")} 중 하나(또는 빈 값)여야 합니다.` } };
}

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
    let next: CapabilityGapRow = { ...base };
    if ("requiredLevel" in raw) {
      const v = levelValue(raw.requiredLevel, base.requiredLevel, "필요 수준");
      if (!v.ok) return v;
      next.requiredLevel = v.value;
    }
    if ("currentLevel" in raw) {
      const v = levelValue(raw.currentLevel, base.currentLevel, "보유 수준");
      if (!v.ok) return v;
      next.currentLevel = v.value;
    }
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
    const changed =
      JSON.stringify({ ...prevA, confirmedBy: null, confirmedAt: null, draftedBy: null }) !== JSON.stringify({ ...a, confirmedBy: null, confirmedAt: null, draftedBy: null }) ||
      next.requiredLevel !== base.requiredLevel || next.currentLevel !== base.currentLevel || next.resolution !== base.resolution;
    if (changed) {
      a.draftedBy = actor.human ? "human" : "ai";
      a.confirmedBy = null;
      a.confirmedAt = null;
    }
    const hasContent = a.grade !== null || a.closingCostKrwM !== null || a.monthsToAttain !== null || a.rationale !== "" || a.evidence.length > 0;
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
  const confirmed: string[] = [];
  const next = rows.map((r) => {
    const a = r.attainability;
    if (!a || a.grade === null || a.confirmedAt) return r;
    if (rowIds && !rowIds.includes(r.id)) return r;
    confirmed.push(r.id);
    return { ...r, attainability: { ...a, confirmedBy: userId, confirmedAt: at } };
  });
  if (confirmed.length === 0) return { ok: false, error: { code: "nothing_to_confirm", message: "확정할 판정이 없습니다 — 달성 가능성을 판정한 행만 확정할 수 있습니다." } };
  return { ok: true, rows: next, confirmedIds: confirmed };
}

export function sourceOpportunityOf(db: Database, projectId: string): string | null {
  return (db.query("SELECT source_opportunity_id AS id FROM md_project WHERE id = ?").get(projectId) as { id: string | null } | null)?.id ?? null;
}

export function readRegister(db: Database, opportunityId: string) {
  const row = db.query("SELECT capability_gap_json AS j FROM opportunity WHERE id = ?").get(opportunityId) as { j: string | null } | null;
  if (!row) return null;
  return { json: row.j, ...parseGapRegister(row.j) };
}

export function writeRegister(
  db: Database,
  opportunityId: string,
  rows: CapabilityGapRow[],
  audit: { actor: string; action: string; target: string; at: string },
): void {
  db.transaction(() => {
    const storedJson = (db.query("SELECT capability_gap_json AS j FROM opportunity WHERE id = ?").get(opportunityId) as { j: string | null } | null)?.j ?? null;
    db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [serializeGapRegister(rows, audit.at, storedJson), opportunityId]);
    appendAudit(db, { actor: audit.actor, action: audit.action, target: audit.target, now: audit.at });
  })();
}

export { carryOverAttainability };
