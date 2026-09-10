// business-targets — group/affiliate business-target standards (md_business_target,
// migration 0082 / ADR-0114) plus the fs-gate evidence read model that compares
// them against the adopted business case. Standards are master data managed in
// the admin console; per the boundary in ADR-0114 they surface at the fs gate as
// reference evidence only — a miss never blocks a gate by itself.
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import type { BusinessCaseView } from "./business-case.ts";
import {
  CUSTOM_METRIC_KEY,
  METRIC_PRESETS,
  formatDirectionLabel,
  formatTargetValue,
  presetFor,
} from "./business-targets-format.ts";
import type { MetricPreset, TargetDirection, TargetUnit } from "./business-targets-format.ts";

export { CUSTOM_METRIC_KEY, METRIC_PRESETS, formatDirectionLabel, formatTargetValue, presetFor };
export type { MetricPreset, TargetDirection, TargetUnit };

export interface BusinessTargetRow {
  id: string;
  group_id: string;
  member_id: string | null;
  metric_key: string;
  label: string | null;
  direction: TargetDirection;
  target_value: number;
  created_at: string;
  updated_at: string | null;
  group_name: string;
  member_name: string | null;
}

export function listBusinessTargets(): BusinessTargetRow[] {
  return getDb()
    .query(
      `SELECT t.id, t.group_id, t.member_id, t.metric_key, t.label, t.direction, t.target_value,
              t.created_at, t.updated_at,
              g.name AS group_name, m.company_name AS member_name
       FROM md_business_target t
       JOIN company_group g ON g.id = t.group_id
       LEFT JOIN company_group_member m ON m.id = t.member_id
       WHERE t.deleted_at IS NULL
       ORDER BY g.name, m.company_name, t.metric_key, t.label`,
    )
    .all() as unknown as BusinessTargetRow[];
}

export interface ResolvedTarget {
  row: BusinessTargetRow;
  source: "affiliate" | "group";
  /** Group-common row shadowed by an affiliate-specific standard (display only). */
  overridden: BusinessTargetRow | null;
}

/** Per-metric resolution: an affiliate-specific row wins over the group-common
 * row for the same metric (custom metrics are distinct rows via label). */
export function resolveBusinessTargets(groupId: string, memberId: string | null): ResolvedTarget[] {
  const rows = getDb()
    .query(
      `SELECT t.id, t.group_id, t.member_id, t.metric_key, t.label, t.direction, t.target_value,
              t.created_at, t.updated_at,
              g.name AS group_name, m.company_name AS member_name
       FROM md_business_target t
       JOIN company_group g ON g.id = t.group_id
       LEFT JOIN company_group_member m ON m.id = t.member_id
       WHERE t.deleted_at IS NULL AND t.group_id = ? AND (t.member_id IS NULL OR t.member_id = ?)
       ORDER BY t.metric_key, t.label`,
    )
    .all(groupId, memberId) as unknown as BusinessTargetRow[];
  const byKey = new Map<string, { affiliate?: BusinessTargetRow; group?: BusinessTargetRow }>();
  for (const r of rows) {
    const key = `${r.metric_key}\u0000${r.label ?? ""}`;
    const slot = byKey.get(key) ?? {};
    if (r.member_id) slot.affiliate = r;
    else slot.group = r;
    byKey.set(key, slot);
  }
  const resolved: ResolvedTarget[] = [];
  for (const [, slot] of byKey) {
    if (slot.affiliate) resolved.push({ row: slot.affiliate, source: "affiliate", overridden: slot.group ?? null });
    else if (slot.group) resolved.push({ row: slot.group, source: "group", overridden: null });
  }
  return resolved;
}

export interface ProjectTargetScope {
  groupId: string;
  groupName: string;
  memberId: string | null;
  memberName: string | null;
}

/** Resolve the standards scope of a project. `md_project.company_id` (0047)
 * references md_company — for brownfield it can be the acquisition target, not
 * an affiliate — so it is matched against the self-registry the way promotion
 * links companies (dart_corp_code first, then name; project.repository
 * precedent). When nothing matches and the deployment has exactly ONE active
 * group, that group's common standards apply (the typical single-group
 * workspace); otherwise the scope is unresolved and every surface says so. */
export function projectTargetScope(projectId: string): ProjectTargetScope | null {
  const db = getDb();
  const linked = db
    .query(
      `SELECT m.id AS member_id, m.company_name AS member_name,
              g.id AS group_id, g.name AS group_name
       FROM md_project p
       JOIN md_company c ON c.id = p.company_id
       JOIN company_group_member m
         ON (m.dart_corp_code IS NOT NULL AND m.dart_corp_code = c.dart_corp_code)
            OR m.company_name = c.name_ko
       JOIN company_group g ON g.id = m.group_id
       WHERE p.id = ? AND m.deleted_at IS NULL
       ORDER BY (m.dart_corp_code IS NOT NULL AND m.dart_corp_code = c.dart_corp_code) DESC
       LIMIT 1`,
    )
    .get(projectId) as
      | { member_id: string; member_name: string; group_id: string; group_name: string }
      | undefined;
  if (linked) {
    return { groupId: linked.group_id, groupName: linked.group_name, memberId: linked.member_id, memberName: linked.member_name };
  }
  // Single-group deployment: group-common standards apply without a company link.
  const groups = db.query("SELECT id, name FROM company_group WHERE deleted_at IS NULL").all() as Array<{ id: string; name: string }>;
  if (groups.length === 1) return { groupId: groups[0].id, groupName: groups[0].name, memberId: null, memberName: null };
  return null;
}

// ── fs evidence: standards vs adopted case ─────────────────────────────────

export type TargetCheckStatus = "met" | "missed" | "indeterminate" | "manual";

export interface TargetCheckEntry {
  metric_key: string;
  label: string;
  direction: TargetDirection;
  target_value: number;
  unit: TargetUnit;
  custom: boolean;
  source: "affiliate" | "group";
  source_name: string;
  /** Present when an affiliate row shadows a group-common row. */
  overridden_note: string | null;
  as_of: string; // standard's updated_at ?? created_at
  actual: number | null;
  actual_basis: string;
  status: TargetCheckStatus;
}

export interface TargetCheckResult {
  scope: ProjectTargetScope;
  entries: TargetCheckEntry[];
}

/** Final-year amount of a business-case line: `annual_amount_krw_m` is the
 * amount AT the line's start year and compounds at `growth_rate`, matching the
 * S8 page rendering ("y{start_year}, 성장 {growth_rate}%"). Lines starting
 * beyond the horizon contribute nothing. */
export function finalYearLineAmount(line: { annual_amount_krw_m: number; start_year: number; growth_rate: number }, horizonYears: number): number {
  if (line.start_year > horizonYears) return 0;
  const exponent = Math.max(0, horizonYears - line.start_year);
  return line.annual_amount_krw_m * Math.pow(1 + line.growth_rate, exponent);
}

/** Operating margin uses labor+opex as operating costs; capex is investment and
 * stays out of the margin numerator (documented in ADR-0114). */
export function finalYearCaseFigures(adopted: BusinessCaseView): { revenueKrwM: number | null; operatingMargin: number | null } {
  let revenue = 0;
  let operatingCost = 0;
  for (const line of adopted.lines) {
    const amount = finalYearLineAmount(line, adopted.horizon_years);
    if (line.category === "revenue") revenue += amount;
    else if (line.category === "labor" || line.category === "opex") operatingCost += amount;
  }
  if (revenue <= 0) return { revenueKrwM: null, operatingMargin: null };
  return { revenueKrwM: revenue, operatingMargin: (revenue - operatingCost) / revenue };
}

function baseCaseSim(adopted: BusinessCaseView, recommendedScenario: string | null): { npv_krw_m: number | null; irr: number | null } {
  const p50 = adopted.simulations.filter((s) => s.percentile === "p50");
  const base = p50.find((s) => recommendedScenario != null && s.scenario === recommendedScenario) ?? p50[0];
  if (!base) return { npv_krw_m: null, irr: null };
  return { npv_krw_m: base.npv_krw_m, irr: base.irr };
}

function directionMet(direction: TargetDirection, actual: number, target: number): boolean {
  return direction === "gte" ? actual >= target : actual <= target;
}

/** Build the fs-gate evidence entries. `adoptedCase === null` (no human adoption
 * yet) yields "indeterminate" for computable metrics — a missing adoption is a
 * fact, not a judgement. Custom metrics are always "manual". */
export function evaluateTargets(
  resolved: ResolvedTarget[],
  scope: ProjectTargetScope,
  adoptedCase: BusinessCaseView | null,
  recommendedScenario: string | null,
): TargetCheckEntry[] {
  const figures = adoptedCase ? finalYearCaseFigures(adoptedCase) : { revenueKrwM: null, operatingMargin: null };
  const sim = adoptedCase ? baseCaseSim(adoptedCase, recommendedScenario) : { npv_krw_m: null, irr: null };

  return resolved.map(({ row, source, overridden }) => {
    const preset = presetFor(row.metric_key);
    const unit: TargetUnit = preset?.unit ?? "none";
    const custom = !preset;
    const label = preset?.label ?? row.label ?? row.metric_key;
    const overridden_note =
      overridden != null
        ? `그룹 공통 기준 ${formatTargetValue(overridden.target_value, unit)}보다 우선`
        : null;
    const as_of = row.updated_at ?? row.created_at;

    let actual: number | null = null;
    let actual_basis = "";
    let status: TargetCheckStatus;
    if (custom || !preset?.computable) {
      status = "manual";
      actual_basis = "수동 확인 — 자동 산출 미지원 지표";
    } else if (!adoptedCase) {
      status = "indeterminate";
      actual_basis = "채택 Business Case 없음";
    } else if (row.metric_key === "revenue") {
      actual = figures.revenueKrwM;
      actual_basis = "채택 Case 최종 연도 매출 (라인 성장 복리)";
      status = actual == null ? "indeterminate" : directionMet(row.direction, actual, row.target_value) ? "met" : "missed";
    } else if (row.metric_key === "operating_margin") {
      actual = figures.operatingMargin;
      actual_basis = "최종 연도 (매출 − 노무·운영비) ÷ 매출";
      status = actual == null ? "indeterminate" : directionMet(row.direction, actual, row.target_value) ? "met" : "missed";
    } else if (row.metric_key === "period") {
      actual = adoptedCase.horizon_years;
      actual_basis = "Business Case 계획 기간";
      status = directionMet(row.direction, actual, row.target_value) ? "met" : "missed";
    } else if (row.metric_key === "npv") {
      actual = sim.npv_krw_m;
      actual_basis = `권장 시나리오 p50 NPV (${adoptedCase.scenario ?? "시나리오 미지정"})`;
      status = actual == null ? "indeterminate" : directionMet(row.direction, actual, row.target_value) ? "met" : "missed";
    } else if (row.metric_key === "irr") {
      actual = sim.irr;
      actual_basis = `권장 시나리오 p50 IRR (${adoptedCase.scenario ?? "시나리오 미지정"})`;
      status = actual == null ? "indeterminate" : directionMet(row.direction, actual, row.target_value) ? "met" : "missed";
    } else {
      status = "manual";
      actual_basis = "수동 확인 — 자동 산출 미지원 지표";
    }

    return {
      metric_key: row.metric_key,
      label,
      direction: row.direction,
      target_value: row.target_value,
      unit,
      custom,
      source,
      source_name: source === "affiliate" ? scope.memberName ?? "" : scope.groupName,
      overridden_note,
      as_of,
      actual,
      actual_basis,
      status,
    };
  });
}

// ── admin CRUD (soft delete per the 0081 tombstone convention) ──────────────

export interface CreateTargetInput {
  groupId: string;
  memberId: string | null;
  metricKey: string;
  label: string | null;
  direction: TargetDirection;
  targetValue: number;
  actor: string;
}

function validateRefs(db: ReturnType<typeof getDb>, input: CreateTargetInput): string | null {
  const group = db.query("SELECT id FROM company_group WHERE id = ? AND deleted_at IS NULL").get(input.groupId);
  if (!group) return "unknown_group";
  if (input.memberId != null) {
    const member = db
      .query("SELECT id FROM company_group_member WHERE id = ? AND group_id = ? AND deleted_at IS NULL")
      .get(input.memberId, input.groupId);
    if (!member) return "unknown_member";
  }
  return null;
}

export function createBusinessTarget(input: CreateTargetInput): { ok: true; id: string } | { ok: false; code: string } {
  const db = getDb();
  const refError = validateRefs(db, input);
  if (refError) return { ok: false, code: refError };
  if (!Number.isFinite(input.targetValue)) return { ok: false, code: "invalid_value" };
  if (input.metricKey === CUSTOM_METRIC_KEY && !(input.label ?? "").trim()) return { ok: false, code: "custom_label_required" };
  const now = new Date().toISOString();
  const id = ulid();
  try {
    db.run(
      `INSERT INTO md_business_target (id, group_id, member_id, metric_key, label, direction, target_value, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, input.groupId, input.memberId, input.metricKey, input.label, input.direction, input.targetValue, input.actor, now],
    );
  } catch (err) {
    // idx_bt_scope_metric_active — duplicate scope+metric for the same scope
    return { ok: false, code: err instanceof Error && err.message.includes("UNIQUE") ? "duplicate_target" : "insert_failed" };
  }
  appendAudit(db, { actor: input.actor, action: "business_target_add", target: `md_business_target:${id}`, now });
  return { ok: true, id };
}

export interface UpdateTargetInput {
  id: string;
  direction?: TargetDirection;
  targetValue?: number;
  actor: string;
}

/** Standards are edited in place (value/direction); scope and metric are
 * immutable after create — change them by delete + re-create. */
export function updateBusinessTarget(input: UpdateTargetInput): { ok: true } | { ok: false; code: string } {
  const db = getDb();
  const row = db.query("SELECT id FROM md_business_target WHERE id = ? AND deleted_at IS NULL").get(input.id);
  if (!row) return { ok: false, code: "not_found" };
  if (input.targetValue !== undefined && !Number.isFinite(input.targetValue)) return { ok: false, code: "invalid_value" };
  const sets: string[] = [];
  const vals: Array<string | number> = [];
  if (input.direction !== undefined) {
    sets.push("direction = ?");
    vals.push(input.direction);
  }
  if (input.targetValue !== undefined) {
    sets.push("target_value = ?");
    vals.push(input.targetValue);
  }
  if (sets.length === 0) return { ok: false, code: "no_fields" };
  sets.push("updated_at = ?");
  vals.push(new Date().toISOString());
  vals.push(input.id);
  db.run(`UPDATE md_business_target SET ${sets.join(", ")} WHERE id = ?`, vals);
  appendAudit(db, { actor: input.actor, action: "business_target_update", target: `md_business_target:${input.id}`, now: new Date().toISOString() });
  return { ok: true };
}

export function deleteBusinessTarget(id: string, actor: string, reason: string): { ok: true } | { ok: false; code: string } {
  const db = getDb();
  const res = db.run(
    `UPDATE md_business_target SET deleted_at = ?, deleted_by = ?, delete_reason = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [new Date().toISOString(), actor, reason || "관리자 삭제", id],
  );
  if (res.changes === 0) return { ok: false, code: "not_found" };
  appendAudit(db, { actor, action: "business_target_delete", target: `md_business_target:${id}`, now: new Date().toISOString() });
  return { ok: true };
}
