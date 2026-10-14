// greenfield-execution — ADR-0161 Row 2 (backend). Owns:
//   - track resolution by track + case_type (Q5; never origin) with the
//     fail-closed "needs human classification" state (design §5.1.5);
//   - the S11 greenfield execution baseline (procedure greenfield-execution-
//     baseline): tranche reconciliation against the S8 adopted case (O2: exact
//     match, any difference is a finding, never an auto-pass), the baseline
//     entries (permit / certification milestones, hiring plan, KPI targets,
//     incentive obligations) and the human-only confirmation, stored as
//     append-only process_run rows (stage s11_execution_baseline, the same
//     ledger pattern as s11_pmi_kickoff). capex_tranche is READ ONLY here —
//     tranche status is written only by the two-person capex-tranches route;
//   - the retroactive rule (Q2, design §8.2): the baseline is recommended,
//     not blocking, when S11 was already completed; blocking otherwise;
//   - S12 applicability (portfolio-venture-monitoring widened to case_type
//     greenfield, integration-monitoring, partnership-monitoring), the
//     default venture_class (Q7) with an audited override, and the read-only
//     monitoring views over the existing pmi_* / jv_term / venture_scorecard
//     ledgers (no new tables);
//   - the one-time, human-initiated policy_migration audit entry per project
//     and the read-only in-flight counts (design §8.1 / §8.3).
// No DB schema change: every read/write uses tables that already exist.
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { isValidEvidenceRef } from "../../../db/lib/evidence-ref.ts";
import {
  recordVentureScorecardCycle,
  type RecordVentureScorecardInput,
  type ScorecardVentureClass,
} from "../../../db/repositories/venture-scorecard.repository.ts";
import { AGENT_KEYS } from "./agent-registry.generated.ts";
import { SPEC_VERSION } from "./spec-activities.generated.ts";
import { listCapexTranches, type CapexTrancheRow } from "./capex-tranches.ts";
import { NON_PMI_SUB_TRACKS } from "./pmi-kickoff.ts";

export const EXECUTION_BASELINE_STAGE = "s11_execution_baseline";
/** ADR-0161 date: S11 completions evidenced before it are "already completed" (recommended, not blocking). */
export const GX_EXECUTION_BASELINE_DATE = "2026-10-12";
export const POLICY_MIGRATION_ACTION = "policy_migration";
export const POLICY_MIGRATION_ADR = "ADR-0161";
export const POLICY_MIGRATION_FROM_SPEC = "2.7.0";
export const POLICY_MIGRATION_TO_SPEC = "2.8.0";
export const MAX_RATIONALE_LEN = 2000;
export const MAX_MIGRATION_NOTE_LEN = 2000;
export const RECOMMENDED_LABEL = "권장 (ADR-0161 — 이 단계 종료 후 추가됨, 차단하지 않음)";

// ── Track resolution (Q5, fail-closed) ───────────────────────────────────

export { resolveTrack, type ResolvedTrack, type TrackBasis } from "./project-track.ts";
import { resolveTrack, type ResolvedTrack } from "./project-track.ts";

export type BaselineApplicability = "applies" | "not_applicable" | "needs_classification";
export interface ExecutionBaselineScope {
  state: BaselineApplicability;
  route: ResolvedTrack;
  /** Step 2 (permits/certifications) does not apply to intra_venture. */
  permit_step_applies: boolean;
  reason: string;
}

export function executionBaselineScope(projectId: string, db: Database = getDb()): ExecutionBaselineScope {
  const route = resolveTrack(projectId, db);
  if (route.track === null) {
    return {
      state: "needs_classification",
      route,
      permit_step_applies: false,
      reason:
        route.basis === "conflict"
          ? `트랙 분류가 서로 다릅니다 (case_type=${route.case_type}, route=${route.route_track}) — 사람이 분류를 정리해야 합니다.`
          : "트랙(case_type/track)이 확인되지 않았습니다 — 사람의 분류가 필요합니다 (어느 트랙으로도 기본 적용하지 않음).",
    };
  }
  if (route.track !== "greenfield") {
    return { state: "not_applicable", route, permit_step_applies: false, reason: "실행 기준선은 greenfield 프로젝트에만 적용됩니다." };
  }
  return { state: "applies", route, permit_step_applies: route.sub_track !== "intra_venture", reason: "greenfield (case_type/track)" };
}

// ── Step 1: tranche reconciliation (O2 — exact match) ────────────────────

export interface Finding {
  code: string;
  message: string;
}

export interface TrancheReconciliation {
  tranches: Array<Pick<CapexTrancheRow, "id" | "tranche_no" | "amount" | "currency" | "release_condition" | "status" | "source_stage"> & { pending_release: boolean }>;
  tranche_total: number;
  tranche_currencies: string[];
  case: { model_id: string | null; capex_total_krw_m: number | null; capex_lines: number; unit_issue: boolean };
  s10_structure_recorded: boolean;
  difference: number | null;
  matches: boolean;
  findings: Finding[];
}

/** Round to 1e-6 of a million (one won): representation only, never a tolerance. */
const exact = (n: number) => Math.round(n * 1e6) / 1e6;

function adoptedModelId(projectId: string, db: Database): string | null {
  const row = db
    .query(
      `SELECT meta_json FROM process_run WHERE entity_type = 'project' AND entity_id = ? AND stage = 's8_case_adopt' AND status = 'done'
       ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .get(projectId) as { meta_json: string | null } | null;
  try {
    return (row?.meta_json ? (JSON.parse(row.meta_json) as { model_id?: string }).model_id : null) ?? null;
  } catch {
    return null;
  }
}

export function trancheReconciliation(projectId: string, db: Database = getDb()): TrancheReconciliation {
  const findings: Finding[] = [];
  const rows = listCapexTranches(projectId, {}, db);
  const tranches = rows.map((t) => ({
    id: t.id, tranche_no: t.tranche_no, amount: t.amount, currency: t.currency, release_condition: t.release_condition,
    status: t.status, source_stage: t.source_stage, pending_release: t.pending_release !== null,
  }));
  // R5: the sum counts planned + released only; withheld rows are listed but excluded (retired rows are never listed).
  const counted = rows.filter((t) => t.status === "planned" || t.status === "released");
  const currencies = [...new Set(counted.map((t) => t.currency))].sort();
  const trancheTotal = exact(counted.reduce((s, t) => s + t.amount, 0));
  const s10 = !!db.query("SELECT id FROM deal_structure_hypothesis WHERE project_id = ? LIMIT 1").get(projectId);
  if (!s10) findings.push({ code: "s10_structure_missing", message: "S10 투자구조 기록이 없습니다 — 트랜치 집행 조건의 근거를 확인할 수 없습니다." });
  if (counted.length === 0) findings.push({ code: "no_tranches", message: "합계에 들어가는 capex 트랜치(planned·released)가 없습니다 (S10 투자구조 단계에서 기록)." });
  for (const t of rows) {
    if (!t.release_condition.trim()) findings.push({ code: "tranche_condition_missing", message: `트랜치 ${t.tranche_no}번에 집행 조건이 없습니다.` });
    if (t.source_stage !== "S10") findings.push({ code: "tranche_not_from_s10", message: `트랜치 ${t.tranche_no}번은 S10 조건이 아닌 ${t.source_stage}에서 기록되었습니다 — 확인이 필요합니다.` });
  }
  const modelId = adoptedModelId(projectId, db);
  let caseTotal: number | null = null;
  let lines = 0;
  let unitIssue = false;
  if (!modelId) {
    findings.push({ code: "no_adopted_case", message: "S8 채택 Business Case가 없습니다 — capex 대조를 할 수 없습니다." });
  } else {
    const model = db.query("SELECT horizon_years FROM business_case_model WHERE id = ?").get(modelId) as { horizon_years: number } | null;
    const capex = db
      .query("SELECT annual_amount_krw_m, start_year, end_year, growth_rate, unit FROM business_case_line WHERE model_id = ? AND category = 'capex'")
      .all(modelId) as Array<{ annual_amount_krw_m: number; start_year: number; end_year: number | null; growth_rate: number; unit: string | null }>;
    lines = capex.length;
    const horizon = model?.horizon_years ?? 0;
    let total = 0;
    for (const l of capex) {
      // R5: a null unit is NOT assumed to be KRW_M — it is a finding like any other unit.
      if (l.unit !== "KRW_M") unitIssue = true;
      // end_year (ADR-0174 slice 2) clamps the spending window: NULL = run through the horizon.
      const lastYear = Math.min(l.end_year ?? horizon, horizon);
      for (let y = Math.max(1, l.start_year); y <= lastYear; y++) total += l.annual_amount_krw_m * Math.pow(1 + l.growth_rate, y - l.start_year);
    }
    if (lines === 0) findings.push({ code: "case_capex_missing", message: "S8 채택 케이스에 capex 행이 없습니다 — 트랜치 합계와 대조할 수 없습니다." });
    else if (unitIssue) findings.push({ code: "case_unit_not_comparable", message: "S8 채택 케이스 capex 행 단위가 KRW_M(백만 원)으로 명시되어 있지 않습니다 (미기재 포함) — 단위 변환·추정 없이 대조하지 않습니다." });
    else caseTotal = exact(total);
  }
  if (currencies.length > 1 || (currencies.length === 1 && currencies[0] !== "KRW")) {
    findings.push({ code: "tranche_currency_not_comparable", message: `트랜치 통화(${currencies.join(", ")})가 S8 케이스 통화(KRW)와 다릅니다 — 환산하지 않습니다.` });
  }
  let difference: number | null = null;
  let matches = false;
  if (caseTotal !== null && counted.length > 0 && currencies.length === 1 && currencies[0] === "KRW") {
    difference = exact(trancheTotal - caseTotal);
    matches = difference === 0;
    if (!matches) {
      findings.push({
        code: "tranche_total_differs",
        message: `트랜치 합계 ${trancheTotal} 백만 KRW가 S8 채택 케이스 capex ${caseTotal} 백만 KRW와 다릅니다 (차이 ${difference}) — 허용 오차 없이 사람이 판단합니다.`,
      });
    }
  }
  return {
    tranches, tranche_total: trancheTotal, tranche_currencies: currencies,
    case: { model_id: modelId, capex_total_krw_m: caseTotal, capex_lines: lines, unit_issue: unitIssue },
    s10_structure_recorded: s10, difference, matches, findings,
  };
}

/** Stable hash of the live tranche ids + amounts + statuses (confirmation snapshot). */
export function trancheSnapshotHash(rec: Pick<TrancheReconciliation, "tranches">): string {
  const canon = rec.tranches.map((t) => `${t.id}:${t.tranche_no}:${t.amount}:${t.currency}:${t.status}`).sort().join("|");
  return createHash("sha256").update(canon).digest("hex");
}

// ── Baseline entries (steps 2-5): checkable shapes ───────────────────────

export interface Milestone { name: string; issuer: string; target_date: string; gates_ref: string | null; source_id: string | null }
export interface HiringRow { role_family: string; quarter: string; headcount: number }
export interface KpiTarget { metric_key: string; target_value: number; unit: string | null; due: string }
export interface IncentiveObligation { obligation: string; deadline: string | null; depends_on: string | null; incentive_id: string | null }
export interface BaselineEntries {
  permit_milestones: Milestone[];
  certification_milestones: Milestone[];
  hiring_plan: HiringRow[];
  kpi_targets: KpiTarget[];
  incentive_obligations: IncentiveObligation[];
}

export const ENTRY_LIMITS = { list: 100, short: 200, text: 1000 } as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const QUARTER_RE = /^\d{4}-Q[1-4]$/;
const METRIC_RE = /^(goal:)?[a-z0-9_.-]{1,80}$/;

type Parse<T> = { ok: true; value: T } | { ok: false; message: string };
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const opt = (v: unknown, max: number, field: string): Parse<string | null> => {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, message: `${field}는 문자열이어야 합니다.` };
  const t = v.trim();
  return t.length > max ? { ok: false, message: `${field}는 ${max}자 이하여야 합니다.` } : { ok: true, value: t || null };
};
const req = (v: unknown, max: number, field: string): Parse<string> => {
  const t = s(v);
  if (!t) return { ok: false, message: `${field}가 필요합니다.` };
  return t.length > max ? { ok: false, message: `${field}는 ${max}자 이하여야 합니다.` } : { ok: true, value: t };
};
const isDate = (v: string) => DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

function list(raw: unknown, field: string): Parse<Record<string, unknown>[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, message: `${field}는 배열이어야 합니다.` };
  if (raw.length > ENTRY_LIMITS.list) return { ok: false, message: `${field}는 ${ENTRY_LIMITS.list}개 이하여야 합니다.` };
  if (!raw.every((r) => r && typeof r === "object" && !Array.isArray(r))) return { ok: false, message: `${field}의 각 항목은 객체여야 합니다.` };
  return { ok: true, value: raw as Record<string, unknown>[] };
}

function milestones(raw: unknown, field: string, idKey: string): Parse<Milestone[]> {
  const l = list(raw, field);
  if (!l.ok) return l;
  const out: Milestone[] = [];
  for (const [i, r] of l.value.entries()) {
    const at = `${field}[${i}]`;
    const name = req(r.name, ENTRY_LIMITS.short, `${at}.name`); if (!name.ok) return name;
    const issuer = req(r.issuer, ENTRY_LIMITS.short, `${at}.issuer`); if (!issuer.ok) return issuer;
    const date = s(r.target_date);
    if (!isDate(date)) return { ok: false, message: `${at}.target_date는 YYYY-MM-DD 날짜여야 합니다.` };
    const gates = opt(r.gates_ref, ENTRY_LIMITS.short, `${at}.gates_ref`); if (!gates.ok) return gates;
    const src = opt(r[idKey], 64, `${at}.${idKey}`); if (!src.ok) return src;
    out.push({ name: name.value, issuer: issuer.value, target_date: date, gates_ref: gates.value, source_id: src.value });
  }
  return { ok: true, value: out };
}

/** Validate the baseline entries; unknown top-level keys are rejected (aggregate-only hiring plan, no personal rows). */
export function parseBaselineEntries(raw: unknown): Parse<BaselineEntries> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "entries는 객체여야 합니다." };
  const o = raw as Record<string, unknown>;
  const allowed = ["permit_milestones", "certification_milestones", "hiring_plan", "kpi_targets", "incentive_obligations"];
  const unknown = Object.keys(o).filter((k) => !allowed.includes(k));
  if (unknown.length) return { ok: false, message: `알 수 없는 entries 키: ${unknown.join(", ")}` };
  const permits = milestones(o.permit_milestones, "permit_milestones", "permit_id"); if (!permits.ok) return permits;
  const certs = milestones(o.certification_milestones, "certification_milestones", "certification_id"); if (!certs.ok) return certs;
  const h = list(o.hiring_plan, "hiring_plan"); if (!h.ok) return h;
  const hiring: HiringRow[] = [];
  for (const [i, r] of h.value.entries()) {
    const at = `hiring_plan[${i}]`;
    const extra = Object.keys(r).filter((k) => !["role_family", "quarter", "headcount"].includes(k));
    if (extra.length) return { ok: false, message: `${at}는 role_family·quarter·headcount만 허용합니다 (개인 단위 행 금지): ${extra.join(", ")}` };
    const rf = req(r.role_family, 100, `${at}.role_family`); if (!rf.ok) return rf;
    const q = s(r.quarter);
    if (!QUARTER_RE.test(q)) return { ok: false, message: `${at}.quarter는 YYYY-Qn 형식이어야 합니다.` };
    const n = Number(r.headcount);
    if (typeof r.headcount === "boolean" || !Number.isInteger(n) || n < 0 || n > 100000) return { ok: false, message: `${at}.headcount는 0~100000 정수여야 합니다.` };
    hiring.push({ role_family: rf.value, quarter: q, headcount: n });
  }
  const k = list(o.kpi_targets, "kpi_targets"); if (!k.ok) return k;
  const kpis: KpiTarget[] = [];
  for (const [i, r] of k.value.entries()) {
    const at = `kpi_targets[${i}]`;
    const key = s(r.metric_key);
    if (!METRIC_RE.test(key)) return { ok: false, message: `${at}.metric_key는 소문자·숫자·_.- (선택 접두 goal:) 1~80자여야 합니다.` };
    if (typeof r.target_value !== "number" || !Number.isFinite(r.target_value)) return { ok: false, message: `${at}.target_value는 유한한 숫자여야 합니다.` };
    const unit = opt(r.unit, 20, `${at}.unit`); if (!unit.ok) return unit;
    const due = s(r.due);
    if (!QUARTER_RE.test(due) && !isDate(due)) return { ok: false, message: `${at}.due는 YYYY-Qn 또는 YYYY-MM-DD여야 합니다.` };
    kpis.push({ metric_key: key, target_value: r.target_value, unit: unit.value, due });
  }
  const inc = list(o.incentive_obligations, "incentive_obligations"); if (!inc.ok) return inc;
  const obligations: IncentiveObligation[] = [];
  for (const [i, r] of inc.value.entries()) {
    const at = `incentive_obligations[${i}]`;
    const ob = req(r.obligation, ENTRY_LIMITS.text, `${at}.obligation`); if (!ob.ok) return ob;
    const dl = s(r.deadline);
    if (dl && !isDate(dl)) return { ok: false, message: `${at}.deadline은 YYYY-MM-DD 날짜여야 합니다.` };
    const dep = opt(r.depends_on, ENTRY_LIMITS.short, `${at}.depends_on`); if (!dep.ok) return dep;
    const iid = opt(r.incentive_id, 64, `${at}.incentive_id`); if (!iid.ok) return iid;
    obligations.push({ obligation: ob.value, deadline: dl || null, depends_on: dep.value, incentive_id: iid.value });
  }
  return {
    ok: true,
    value: { permit_milestones: permits.value, certification_milestones: certs.value, hiring_plan: hiring, kpi_targets: kpis, incentive_obligations: obligations },
  };
}

export const EMPTY_ENTRIES: BaselineEntries = { permit_milestones: [], certification_milestones: [], hiring_plan: [], kpi_targets: [], incentive_obligations: [] };

// ── Ledger: append-only process_run rows (stage s11_execution_baseline) ──

export interface AcknowledgedFinding {
  code: string;
  rationale: string;
}
export interface BaselineConfirmation {
  confirmed_by: string;
  confirmed_at: string;
  rationale: string;
  /** Who recorded the confirmed entries (may differ from the confirmer). */
  entries_recorded_by: string | null;
  entries_record_id: string | null;
  entries_hash: string;
  tranche_ids: string[];
  tranche_hash: string;
  open_findings: string[];
  acknowledged_findings: AcknowledgedFinding[];
}
export interface BaselineRecord {
  id: string;
  recorded_by: string;
  recorded_at: string;
  entries: BaselineEntries;
  confirmation: BaselineConfirmation | null;
}

const BASELINE_COLS = "id, started_by, finished_at, meta_json";
type BaselineRow = { id: string; started_by: string; finished_at: string | null; meta_json: string | null };

function toRecord(row: BaselineRow | null): BaselineRecord | null {
  if (!row?.meta_json) return null;
  try {
    const meta = JSON.parse(row.meta_json) as { entries?: BaselineEntries; confirmation?: BaselineConfirmation | null };
    const parsed = parseBaselineEntries(meta.entries ?? {});
    const c = meta.confirmation && meta.confirmation.rationale?.trim() ? meta.confirmation : null;
    return {
      id: row.id, recorded_by: row.started_by, recorded_at: row.finished_at ?? "",
      entries: parsed.ok ? parsed.value : EMPTY_ENTRIES,
      confirmation: c ? { ...c, acknowledged_findings: c.acknowledged_findings ?? [], entries_recorded_by: c.entries_recorded_by ?? null, entries_record_id: c.entries_record_id ?? null, entries_hash: c.entries_hash ?? "" } : null,
    };
  } catch {
    return null;
  }
}

export function latestExecutionBaseline(projectId: string, db: Database = getDb()): BaselineRecord | null {
  const row = db
    .query(
      `SELECT ${BASELINE_COLS} FROM process_run
       WHERE entity_type = 'project' AND entity_id = ? AND stage = ? AND status = 'done'
       ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .get(projectId, EXECUTION_BASELINE_STAGE) as BaselineRow | null;
  return toRecord(row);
}

/** The most recent CONFIRMED baseline record (may be older than the latest entries). */
export function latestConfirmedBaseline(projectId: string, db: Database = getDb()): BaselineRecord | null {
  const rows = db
    .query(
      `SELECT ${BASELINE_COLS} FROM process_run
       WHERE entity_type = 'project' AND entity_id = ? AND stage = ? AND status = 'done'
       ORDER BY started_at DESC, id DESC`,
    )
    .all(projectId, EXECUTION_BASELINE_STAGE) as BaselineRow[];
  for (const r of rows) {
    const rec = toRecord(r);
    if (rec?.confirmation) return rec;
  }
  return null;
}

export type BaselineErrorCode =
  | "invalid_request" | "agent_forbidden" | "not_applicable_track" | "needs_classification" | "insider_required"
  | "lead_required" | "baseline_empty" | "findings_open";
export type BaselineResult<T> = ({ ok: true } & T) | { ok: false; code: BaselineErrorCode; message: string; open_findings?: Finding[]; missing_sections?: string[] };
const bfail = (code: BaselineErrorCode, message: string, extra: { open_findings?: Finding[]; missing_sections?: string[] } = {}) => ({ ok: false as const, code, message, ...extra });

function writeGuard(projectId: string, actor: string, db: Database): { ok: false; code: BaselineErrorCode; message: string } | null {
  if (AGENT_KEYS.has(actor)) return bfail("agent_forbidden", "실행 기준선 기록·확인은 사람만 할 수 있습니다 (boundary #2).");
  const scope = executionBaselineScope(projectId, db);
  if (scope.state === "needs_classification") return bfail("needs_classification", scope.reason);
  if (scope.state === "not_applicable") return bfail("not_applicable_track", scope.reason);
  return null;
}

function appendRow(db: Database, projectId: string, actor: string, now: string, meta: object): string {
  const id = ulid();
  db.run(
    `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, "project", projectId, projectId, SPEC_VERSION, EXECUTION_BASELINE_STAGE, "done", "web", actor, now, now, JSON.stringify(meta)],
  );
  return id;
}

export const sha16 = (v: string) => createHash("sha256").update(v).digest("hex").slice(0, 16);
const entriesHash = (e: BaselineEntries) => sha16(JSON.stringify(e));
/** R10: audit targets carry a short summary only (full text lives in the process_run record). */
export const AUDIT_SUMMARY_LEN = 120;
export const auditSummary = (t: string) => (t.length > AUDIT_SUMMARY_LEN ? `${t.slice(0, AUDIT_SUMMARY_LEN - 1)}…` : t);

/** Record (replace) the baseline entries. A new entries record supersedes any confirmation — re-confirmation required. */
export function recordBaselineEntries(
  input: { projectId: string; entries: unknown; actor: string; now?: string },
  db: Database = getDb(),
): BaselineResult<{ record: BaselineRecord }> {
  const g = writeGuard(input.projectId, input.actor, db);
  if (g) return g;
  const parsed = parseBaselineEntries(input.entries);
  if (!parsed.ok) return bfail("invalid_request", parsed.message);
  const now = input.now ?? new Date().toISOString();
  db.transaction(() => {
    const before = latestExecutionBaseline(input.projectId, db);
    const id = appendRow(db, input.projectId, input.actor, now, { kind: "entries", entries: parsed.value, confirmation: null });
    const detail = JSON.stringify({
      before: before ? { record_id: before.id, entries_hash: entriesHash(before.entries), confirmed: !!before.confirmation } : null,
      after: { record_id: id, entries_hash: entriesHash(parsed.value), confirmed: false },
      recorded_by: input.actor,
    });
    appendAudit(db, { actor: input.actor, action: "execution_baseline.entries_recorded", target: `${input.projectId}:${id}|${detail}`, now });
  }).immediate();
  return { ok: true, record: latestExecutionBaseline(input.projectId, db)! };
}

/** Required sections for a confirmation (R3): KPI targets and hiring plan always; permit or certification milestones unless step 2 does not apply (intra_venture). */
export function missingBaselineSections(entries: BaselineEntries, permitStepApplies: boolean): string[] {
  const missing: string[] = [];
  if (entries.kpi_targets.length === 0) missing.push("kpi_targets");
  if (entries.hiring_plan.length === 0) missing.push("hiring_plan");
  if (permitStepApplies && entries.permit_milestones.length === 0 && entries.certification_milestones.length === 0) missing.push("permit_or_certification_milestones");
  return missing;
}

export const MAX_ACK_RATIONALE_LEN = 500;

/**
 * Human confirmation (R3): the PROJECT LEAD only, with a mandatory rationale,
 * non-empty required sections, and every open reconciliation finding
 * explicitly acknowledged (`acknowledged_findings: [{code, rationale}]`).
 * Reads and write happen in ONE immediate transaction. Never writes capex_tranche.
 */
export function confirmExecutionBaseline(
  input: { projectId: string; rationale: unknown; acknowledgedFindings?: unknown; actor: string; now?: string },
  db: Database = getDb(),
): BaselineResult<{ record: BaselineRecord; open_findings: Finding[] }> {
  const g = writeGuard(input.projectId, input.actor, db);
  if (g) return g;
  if (!isProjectLead(input.projectId, input.actor, db)) {
    return bfail("lead_required", "실행 기준선 확인은 프로젝트 lead(법인 투자심의위원회 책임자)만 할 수 있습니다.");
  }
  const rationale = s(input.rationale);
  if (!rationale) return bfail("invalid_request", "실행 기준선 확인에는 rationale(근거)이 필요합니다.");
  if (rationale.length > MAX_RATIONALE_LEN) return bfail("invalid_request", `rationale은 ${MAX_RATIONALE_LEN}자 이하여야 합니다.`);
  let acks: AcknowledgedFinding[] = [];
  if (input.acknowledgedFindings !== undefined && input.acknowledgedFindings !== null) {
    if (!Array.isArray(input.acknowledgedFindings) || input.acknowledgedFindings.length > 50) {
      return bfail("invalid_request", "acknowledged_findings는 {code, rationale} 배열(최대 50개)이어야 합니다.");
    }
    for (const [i, a] of input.acknowledgedFindings.entries()) {
      const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
      const code = s(o.code);
      const r = s(o.rationale);
      if (!/^[a-z0-9_]{1,64}$/.test(code)) return bfail("invalid_request", `acknowledged_findings[${i}].code가 올바르지 않습니다.`);
      if (!r || r.length > MAX_ACK_RATIONALE_LEN) return bfail("invalid_request", `acknowledged_findings[${i}].rationale은 1~${MAX_ACK_RATIONALE_LEN}자여야 합니다.`);
      if (acks.some((x) => x.code === code)) return bfail("invalid_request", `acknowledged_findings[${i}].code '${code}'가 중복되었습니다.`);
      acks.push({ code, rationale: r });
    }
  }
  const now = input.now ?? new Date().toISOString();
  const scope = executionBaselineScope(input.projectId, db);
  type Out = BaselineResult<{ record: BaselineRecord; open_findings: Finding[] }>;
  const out = db.transaction((): Out => {
    // S4: every read the decision depends on happens inside the write transaction.
    const rec = trancheReconciliation(input.projectId, db);
    const before = latestExecutionBaseline(input.projectId, db);
    const entries = before?.entries ?? EMPTY_ENTRIES;
    const missing = missingBaselineSections(entries, scope.permit_step_applies);
    if (missing.length) return bfail("baseline_empty", `필수 기준선 항목이 비어 있습니다: ${missing.join(", ")}`, { missing_sections: missing });
    const openCodes = [...new Set(rec.findings.map((f) => f.code))];
    const uncovered = openCodes.filter((c) => !acks.some((a) => a.code === c));
    if (uncovered.length) {
      return bfail("findings_open", `열린 대조 결과(finding)를 모두 acknowledged_findings로 확인해야 합니다: ${uncovered.join(", ")}`, { open_findings: rec.findings });
    }
    acks = acks.filter((a) => openCodes.includes(a.code));
    const confirmation: BaselineConfirmation = {
      confirmed_by: input.actor,
      confirmed_at: now,
      rationale,
      entries_recorded_by: before?.recorded_by ?? null,
      entries_record_id: before?.id ?? null,
      entries_hash: entriesHash(entries),
      tranche_ids: rec.tranches.map((t) => t.id),
      tranche_hash: trancheSnapshotHash(rec),
      open_findings: openCodes,
      acknowledged_findings: acks,
    };
    const id = appendRow(db, input.projectId, input.actor, now, { kind: "confirmation", entries, confirmation });
    const detail = JSON.stringify({
      before: before ? { record_id: before.id, confirmed: !!before.confirmation } : null,
      after: { record_id: id, confirmed: true, entries_hash: confirmation.entries_hash, tranche_hash: confirmation.tranche_hash.slice(0, 16) },
      recorded_by: confirmation.entries_recorded_by,
      confirmed_by: input.actor,
      rationale_hash: sha16(rationale),
      rationale: auditSummary(rationale),
      acknowledged: acks.map((a) => ({ code: a.code, rationale_hash: sha16(a.rationale) })),
    });
    appendAudit(db, { actor: input.actor, action: "execution_baseline.confirmed", target: `${input.projectId}:${id}|${detail}`, now });
    return { ok: true, record: toRecord({ id, started_by: input.actor, finished_at: now, meta_json: JSON.stringify({ entries, confirmation }) })!, open_findings: rec.findings };
  }).immediate();
  return out;
}

// ── Retroactive rule (Q2, design §8.2; review R1/R2/R4) ──────────────────

export type BaselineRequirement =
  | "satisfied" | "blocking" | "recommended" | "reconfirm_required"
  | "not_applicable" | "needs_classification" | "classification_conflict";

/** Latest policy_migration entry snapshot for the project (null when none). */
export function policyMigrationEntry(projectId: string, db: Database = getDb()): { actor: string; at: string; completed_stages: string[]; migration_note: string; migration_note_hash: string | null } | null {
  const row = db
    .query(`SELECT actor_user_id, created_at, target FROM audit_log WHERE action = ? AND substr(target, 1, ?) = ? ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get(POLICY_MIGRATION_ACTION, projectId.length + 1, `${projectId}|`) as { actor_user_id: string; created_at: string; target: string } | null;
  if (!row) return null;
  try {
    const d = JSON.parse(row.target.slice(projectId.length + 1)) as { completed_stages?: string[]; migration_note?: string; migration_note_hash?: string };
    return { actor: row.actor_user_id, at: row.created_at, completed_stages: d.completed_stages ?? [], migration_note: d.migration_note ?? "", migration_note_hash: d.migration_note_hash ?? null };
  } catch {
    return { actor: row.actor_user_id, at: row.created_at, completed_stages: [], migration_note: "", migration_note_hash: null };
  }
}

/**
 * R1: S11 counts as already completed before the rule ONLY when the project's
 * policy_migration entry (server-computed completed_stages) lists S11. IC GO
 * dates are not evidence.
 */
export function s11CompletedBeforeRule(projectId: string, db: Database = getDb()): boolean {
  return policyMigrationEntry(projectId, db)?.completed_stages.includes("S11") ?? false;
}

export interface BaselineS11Check {
  requirement: BaselineRequirement;
  /** True when the S11 predicate must block on this item. */
  blocks: boolean;
  blocker: string | null;
  warning: string | null;
}

/**
 * How the S11 completion predicate treats the baseline. `otherCriteriaMet` =
 * every pre-ADR-0161 S11 criterion holds.
 *  - classification_conflict: blocks (unless the migration snapshot lists S11).
 *  - needs_classification (no signal at all): never blocks, warning only.
 *  - satisfied: the latest record is confirmed and the tranche set is unchanged.
 *  - recommended: S11 was completed before the rule (migration snapshot) and
 *    nothing was ever confirmed — never reopened.
 *  - reconfirm_required: a confirmation exists but newer entries or a tranche
 *    change followed it — blocks only while S11 is not complete.
 *  - blocking: otherwise.
 */
export function executionBaselineS11Check(projectId: string, opts: { otherCriteriaMet: boolean }, db: Database = getDb()): BaselineS11Check {
  const scope = executionBaselineScope(projectId, db);
  const migrated = s11CompletedBeforeRule(projectId, db);
  if (scope.state === "not_applicable") return { requirement: "not_applicable", blocks: false, blocker: null, warning: null };
  if (scope.state === "needs_classification") {
    if (scope.route.basis === "conflict") {
      return {
        requirement: "classification_conflict",
        blocks: !migrated,
        blocker: migrated ? null : `트랙 분류 충돌을 사람이 정리해야 합니다 (case_type=${scope.route.case_type}, route=${scope.route.route_track}) — 실행 기준선 적용 여부를 정할 수 없습니다`,
        warning: null,
      };
    }
    return { requirement: "needs_classification", blocks: false, blocker: null, warning: scope.reason };
  }
  const latest = latestExecutionBaseline(projectId, db);
  const confirmed = latestConfirmedBaseline(projectId, db);
  if (confirmed) {
    const tranchesSame = confirmed.confirmation!.tranche_hash === trancheSnapshotHash(trancheReconciliation(projectId, db));
    if (latest?.id === confirmed.id && tranchesSame) return { requirement: "satisfied", blocks: false, blocker: null, warning: null };
    // R4: once S11 is complete with a confirmed baseline, newer entries / tranche drift never re-block it.
    const blocks = !opts.otherCriteriaMet;
    const msg = "확인 이후 실행 기준선 항목 또는 capex 트랜치가 바뀌었습니다 — 재확인이 필요합니다";
    return { requirement: "reconfirm_required", blocks, blocker: blocks ? msg : null, warning: blocks ? null : msg };
  }
  if (migrated && opts.otherCriteriaMet) return { requirement: "recommended", blocks: false, blocker: null, warning: RECOMMENDED_LABEL };
  return {
    requirement: "blocking",
    blocks: true,
    blocker: "Greenfield 실행 기준선 사람 확인이 필요합니다 (트랜치·인허가/인증·채용·KPI·인센티브 의무 — S11 IC 승인 후 프로젝트 lead가 확인)",
    warning: null,
  };
}

/** Back-compat wrapper: the requirement state only. */
export function executionBaselineRequirement(projectId: string, opts: { otherCriteriaMet: boolean }, db: Database = getDb()): BaselineRequirement {
  return executionBaselineS11Check(projectId, opts, db).requirement;
}

// ── Status (GET) ─────────────────────────────────────────────────────────

export function executionBaselineStatus(projectId: string, db: Database = getDb()) {
  const scope = executionBaselineScope(projectId, db);
  if (scope.state !== "applies") {
    const chk = executionBaselineS11Check(projectId, { otherCriteriaMet: true }, db);
    return { applicability: scope, requirement: chk.requirement, blocks: chk.blocks, warning: chk.warning ?? chk.blocker, reconciliation: null, sources: null, record: null, confirmed_record: null, findings: [] as Finding[], missing_sections: [] as string[] };
  }
  const rec = trancheReconciliation(projectId, db);
  const record = latestExecutionBaseline(projectId, db);
  const confirmed = latestConfirmedBaseline(projectId, db);
  const findings = [...rec.findings];
  if (confirmed?.confirmation && confirmed.confirmation.tranche_hash !== trancheSnapshotHash(rec)) {
    findings.push({ code: "tranches_changed_since_confirmation", message: "확인 이후 capex 트랜치가 바뀌었습니다 — 기준선 재확인이 필요합니다." });
  }
  const entries = record?.entries ?? EMPTY_ENTRIES;
  if (!scope.permit_step_applies && (entries.permit_milestones.length || entries.certification_milestones.length)) {
    findings.push({ code: "permit_step_not_applicable", message: "사내벤처(intra_venture)에는 인허가·인증 단계(2)가 기본 적용되지 않습니다 — 기록된 항목은 참고로만 표시합니다." });
  }
  const permits = db.query("SELECT id, name, agency, status FROM permit WHERE project_id = ? ORDER BY name, id").all(projectId);
  const certifications = db.query("SELECT id, name, agency, status FROM certification WHERE project_id = ? ORDER BY name, id").all(projectId);
  const incentives = db
    .query("SELECT id, type, program_name, direction, status, application_deadline, construction_deadline, clawback_rule, obligation_json FROM incentive WHERE project_id = ? ORDER BY id")
    .all(projectId);
  const goals = db
    .query("SELECT id, metric_key, label, direction, target_value FROM project_business_goal WHERE project_id = ? AND superseded_at IS NULL AND retired_at IS NULL ORDER BY metric_key, id")
    .all(projectId);
  // The GET reports the rule as it applies once the other S11 criteria hold.
  const chk = executionBaselineS11Check(projectId, { otherCriteriaMet: true }, db);
  return {
    applicability: scope,
    requirement: chk.requirement,
    blocks: chk.blocks,
    warning: chk.warning,
    requirement_label: chk.requirement === "recommended" ? RECOMMENDED_LABEL : null,
    reconciliation: rec,
    sources: { permits, certifications, incentives, goals_reference_only: goals },
    record,
    confirmed_record: confirmed,
    /** Open finding codes the confirmer must acknowledge (acknowledged_findings). */
    findings,
    missing_sections: missingBaselineSections(entries, scope.permit_step_applies),
  };
}

// ── S12: applicability, default venture_class (Q7), read views ───────────

export interface PostManagementApplicability {
  route: ResolvedTrack;
  portfolio_venture_monitoring: boolean;
  integration_monitoring: boolean;
  partnership_monitoring: boolean;
  pmi_applies: boolean;
  /** S12 has no gate: every ADR-0161 S12 item is recommended, never blocking. */
  blocking: false;
}

export function postManagementApplicability(projectId: string, db: Database = getDb()): PostManagementApplicability {
  const route = resolveTrack(projectId, db);
  const origin = route.origin;
  const sub = route.sub_track;
  const bf = route.track === "brownfield";
  return {
    route,
    portfolio_venture_monitoring: route.track === "greenfield" || (origin !== null && ["internal", "hybrid", "joint"].includes(origin)),
    integration_monitoring: bf && !(sub && (sub === "jv" || NON_PMI_SUB_TRACKS.has(sub))),
    partnership_monitoring: origin === "joint" || (bf && sub === "partnership"),
    pmi_applies: bf && !(sub && NON_PMI_SUB_TRACKS.has(sub)),
    blocking: false,
  };
}

/** Q7 default: driving (new site / no sub-track), enabling (existing_business_rbd), emergent (intra_venture); null for non-greenfield. */
export function defaultVentureClass(track: string | null, subTrack: string | null): ScorecardVentureClass | null {
  if (track !== "greenfield") return null;
  if (subTrack === "existing_business_rbd") return "enabling";
  if (subTrack === "intra_venture") return "emergent";
  return "driving";
}

/**
 * Record a portfolio-venture-monitoring cycle for a greenfield project with
 * the default venture_class prefilled on rows that omit it. A row whose class
 * differs from the default is an override by the recording person and gets an
 * audit entry (before = default, after = chosen). Writes only through the
 * existing repository (no schema change).
 */
export function recordGreenfieldScorecardCycle(
  input: Omit<RecordVentureScorecardInput, "rows" | "sourceProcedure"> & {
    rows: Array<Omit<RecordVentureScorecardInput["rows"][number], "venture_class"> & { venture_class?: ScorecardVentureClass }>;
    /** Reason for an override (stored in the override audit entry). */
    note?: string | null;
  },
  db: Database = getDb(),
) {
  const route = resolveTrack(input.projectId, db);
  const def = defaultVentureClass(route.track, route.sub_track);
  if (!def) throw new Error("greenfield_only: 기본 venture_class는 greenfield 프로젝트에만 적용됩니다.");
  const rows = input.rows.map((r) => ({ ...r, venture_class: r.venture_class ?? def }));
  const overrides = [...new Set(rows.filter((r) => r.venture_class !== def).map((r) => r.venture_class))];
  const { note, ...repoInput } = input;
  const now = input.now ?? new Date().toISOString();
  const result = db.transaction(() => {
    const r = recordVentureScorecardCycle({ ...repoInput, now, sourceProcedure: "portfolio-venture-monitoring", rows } as RecordVentureScorecardInput, db);
    if (overrides.length) {
      appendAudit(db, {
        actor: input.actor,
        action: VENTURE_CLASS_OVERRIDE_ACTION,
        target: `${input.projectId}:${input.reviewCycle}|${JSON.stringify({ before: def, after: overrides, note: note ? auditSummary(note) : null, note_hash: note ? sha16(note) : null })}`,
        now,
      });
    }
    return r;
  })();
  return { result, default_venture_class: def, overrides };
}

export const VENTURE_CLASS_OVERRIDE_ACTION = "venture_scorecard.venture_class_override";
export const GREENFIELD_CYCLE_ACTION = "venture_scorecard.greenfield_cycle_recorded";

export const GREENFIELD_MEASURE_KEYS = {
  financial: ["capex_deployed_vs_tranche", "revenue_vs_case", "ebitda_vs_case", "bep_month_vs_plan"],
  strategic: ["first_revenue_reached", "utilisation_pct", "headcount_vs_plan", "permit_milestones_met", "certification_milestones_met"],
} as const;

/** Greenfield ramp-up view: latest-cycle scorecard rows + goal:<metric_key> resolved to ADR-0159 goals (reference only). */
export function greenfieldRampUpView(projectId: string, db: Database = getDb()) {
  const route = resolveTrack(projectId, db);
  if (route.track !== "greenfield") return null;
  const latest = db.query("SELECT MAX(review_cycle) AS c FROM venture_scorecard WHERE project_id = ?").get(projectId) as { c: string | null };
  const rows = latest.c
    ? (db
        .query("SELECT section, measure_key, venture_class, target_value, actual_value, status, evidence_ref, observed_at FROM venture_scorecard WHERE project_id = ? AND review_cycle = ? ORDER BY section, measure_key")
        .all(projectId, latest.c) as Array<{ section: string; measure_key: string; venture_class: string; target_value: string | null; actual_value: string | null; status: string; evidence_ref: string; observed_at: string }>)
    : [];
  const goals = db
    .query("SELECT id, metric_key, label, direction, target_value FROM project_business_goal WHERE project_id = ? AND superseded_at IS NULL AND retired_at IS NULL ORDER BY metric_key, id")
    .all(projectId) as Array<{ id: string; metric_key: string; label: string | null; direction: string; target_value: number }>;
  const goalRefs = goals.map((g) => {
    const row = rows.find((r) => r.measure_key === `goal:${g.metric_key}`);
    return {
      goal_id: g.id, metric_key: g.metric_key, label: g.label, direction: g.direction, target_value: g.target_value,
      judgement: row && row.status !== "insufficient_evidence" ? row.status : "not_judged",
      reference_only: true as const,
    };
  });
  return {
    review_cycle: latest.c,
    default_venture_class: defaultVentureClass(route.track, route.sub_track),
    venture_class: effectiveVentureClass(projectId, db),
    measure_keys: GREENFIELD_MEASURE_KEYS,
    measures: rows,
    goals: goalRefs,
    gate_blocking: false as const,
  };
}

export interface VentureClassOverride { review_cycle: string; before: string; after: string; note: string | null; by: string; at: string }
export interface EffectiveVentureClass {
  default: ScorecardVentureClass | null;
  /** The class on the latest greenfield cycle (the default when nothing is recorded yet). */
  effective: string | null;
  overridden: boolean;
  /** The override audit entry for the latest cycle (null when the latest cycle uses the default). */
  override: VentureClassOverride | null;
}

/** Effective venture_class for a greenfield project: default (Q7) vs the latest cycle's recorded class, with who/when/note of the override. */
export function effectiveVentureClass(projectId: string, db: Database = getDb()): EffectiveVentureClass {
  const route = resolveTrack(projectId, db);
  const def = defaultVentureClass(route.track, route.sub_track);
  const latest = db
    .query("SELECT review_cycle, venture_class FROM venture_scorecard WHERE project_id = ? AND source_procedure = 'portfolio-venture-monitoring' ORDER BY review_cycle DESC, created_at DESC LIMIT 1")
    .get(projectId) as { review_cycle: string; venture_class: string } | null;
  if (!latest) return { default: def, effective: def, overridden: false, override: null };
  const overridden = def !== null && latest.venture_class !== def;
  let override: VentureClassOverride | null = null;
  if (overridden) {
    const a = db
      .query("SELECT actor_user_id, target, created_at FROM audit_log WHERE action = ? AND target LIKE ? ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(VENTURE_CLASS_OVERRIDE_ACTION, `${projectId}:${latest.review_cycle}|%`) as { actor_user_id: string; target: string; created_at: string } | null;
    if (a) {
      let detail: { before?: string; after?: string[] | string; note?: string | null } = {};
      try { detail = JSON.parse(a.target.slice(a.target.indexOf("|") + 1)); } catch { /* malformed — keep defaults */ }
      override = {
        review_cycle: latest.review_cycle,
        before: detail.before ?? def!,
        after: Array.isArray(detail.after) ? (detail.after[0] ?? latest.venture_class) : (detail.after ?? latest.venture_class),
        note: detail.note ?? null,
        by: a.actor_user_id,
        at: a.created_at,
      };
    }
  }
  return { default: def, effective: latest.venture_class, overridden, override };
}

// ── S12: human-only greenfield scorecard cycle (POST post-management/scorecard) ──

export const MAX_OVERRIDE_NOTE_LEN = 2000;
export const SCORECARD_LIMITS = { measures: 20, measure_key: 120, evidence_ref: 500 } as const;
const GREENFIELD_VENTURE_CLASSES = ["driving", "enabling", "emergent"] as const;
const SCORECARD_STATUSES = ["on_target", "deviation", "insufficient_evidence"] as const;
const REVIEW_CYCLE = /^\d{4}-Q[1-4]$/;
const GOAL_KEY = /^goal:[a-z0-9_]{1,100}$/;

/** Section for a documented greenfield measure key (portfolio-venture-monitoring v1.2.0); null when the key is not documented. */
export function greenfieldMeasureSection(key: string): "financial" | "strategic" | null {
  if ((GREENFIELD_MEASURE_KEYS.financial as readonly string[]).includes(key) || GOAL_KEY.test(key)) return "financial";
  if ((GREENFIELD_MEASURE_KEYS.strategic as readonly string[]).includes(key)) return "strategic";
  return null;
}

/** R6: YYYY-Qn (n 1..4), not later than the current quarter + 1. Null when valid. */
export function reviewCycleIssue(cycle: string, nowIso: string): string | null {
  if (!REVIEW_CYCLE.test(cycle)) return "review_cycle은 YYYY-Q[1-4] 형식이어야 합니다 (예: 2026-Q4).";
  const now = new Date(nowIso);
  const curIdx = now.getUTCFullYear() * 4 + Math.floor(now.getUTCMonth() / 3);
  const [y, q] = cycle.split("-Q").map(Number);
  if (y * 4 + (q - 1) > curIdx + 1) return "review_cycle은 현재 분기 + 1분기보다 미래일 수 없습니다.";
  return null;
}

/** R6: strict YYYY-MM-DD or full ISO datetime, parseable, not more than one day in the future. Null when valid. */
export function observedAtIssue(v: unknown, nowIso: string): string | null {
  if (typeof v !== "string" || v.length > 40) return "은 YYYY-MM-DD 또는 ISO 8601 일시여야 합니다.";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
  const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v);
  if (!dateOnly && !dateTime) return "은 YYYY-MM-DD 또는 ISO 8601 일시여야 합니다.";
  const t = Date.parse(dateOnly ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(t)) return "을 날짜로 해석할 수 없습니다.";
  if (dateOnly && new Date(t).toISOString().slice(0, 10) !== v) return "은 실제 존재하는 날짜여야 합니다.";
  if (t > Date.parse(nowIso) + 24 * 3600 * 1000) return "은 미래(하루 초과)일 수 없습니다.";
  return null;
}

export type ScorecardErrorCode = "invalid_request" | "not_applicable_track" | "needs_classification" | "run_required" | "cycle_exists" | "agent_forbidden";
export type ScorecardResult = { ok: true; review_cycle: string; venture_class: EffectiveVentureClass; row_ids: string[]; measures: number } | { ok: false; code: ScorecardErrorCode; message: string };
const sfail = (code: ScorecardErrorCode, message: string) => ({ ok: false as const, code, message });

function finiteOrNull(v: unknown, field: string): { ok: true; value: number | null } | { ok: false; message: string } {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, message: `${field}은 유한한 숫자(또는 null)여야 합니다.` };
  return { ok: true, value: v };
}

/**
 * Record one greenfield S12 review cycle (portfolio-venture-monitoring v1.2.0)
 * from a human request. Greenfield only (track resolver; fail-closed
 * needs_classification). One venture_class for the whole cycle: omitted =
 * the Q7 default; a different class is an override that needs a note
 * (<= 2000 chars) and is audited with before/after/note. Every cycle gets a
 * GREENFIELD_CYCLE_ACTION audit entry on top of the repository's own entry.
 * S8 goals (goal:<metric_key>) are reference evidence only — never blocking.
 * Cycles are per review_cycle on the project's latest active run (migration
 * 0139 put review_cycle in the unique key, ADR-0164) — run_required remains
 * only when the project has no analysis run at all.
 */
export function recordGreenfieldScorecardFromRequest(
  input: { projectId: string; body: unknown; actor: string; now?: string },
  db: Database = getDb(),
): ScorecardResult {
  if (AGENT_KEYS.has(input.actor)) return sfail("agent_forbidden", "S12 스코어카드 기록은 사람만 할 수 있습니다 (boundary #2).");
  const route = resolveTrack(input.projectId, db);
  if (route.track === null) return sfail("needs_classification", "트랙(case_type/track)이 확인되지 않았습니다 — 사람의 분류가 필요합니다.");
  if (route.track !== "greenfield") return sfail("not_applicable_track", "이 기록은 greenfield 프로젝트에만 적용됩니다 (brownfield는 integration-monitoring / partnership-monitoring).");
  const def = defaultVentureClass(route.track, route.sub_track)!;
  const b = (input.body && typeof input.body === "object" ? input.body : {}) as Record<string, unknown>;
  const cycle = typeof b.review_cycle === "string" ? b.review_cycle.trim() : "";
  const now = input.now ?? new Date().toISOString();
  const cycleIssue = reviewCycleIssue(cycle, now);
  if (cycleIssue) return sfail("invalid_request", cycleIssue);
  let vc: ScorecardVentureClass = def;
  if (b.venture_class !== undefined && b.venture_class !== null) {
    if (!(GREENFIELD_VENTURE_CLASSES as readonly unknown[]).includes(b.venture_class)) return sfail("invalid_request", "venture_class는 driving | enabling | emergent 중 하나입니다.");
    vc = b.venture_class as ScorecardVentureClass;
  }
  if (b.note !== undefined && b.note !== null && typeof b.note !== "string") return sfail("invalid_request", "note는 문자열이어야 합니다.");
  const note = typeof b.note === "string" ? b.note.trim() : "";
  if (note.length > MAX_OVERRIDE_NOTE_LEN) return sfail("invalid_request", `note는 ${MAX_OVERRIDE_NOTE_LEN}자 이하여야 합니다.`);
  if (vc !== def && !note) return sfail("invalid_request", `venture_class를 기본값(${def})과 다르게 기록하려면 note(사유)가 필요합니다.`);
  if (!Array.isArray(b.measures) || b.measures.length === 0) return sfail("invalid_request", "measures는 비어 있지 않은 배열이어야 합니다.");
  if (b.measures.length > SCORECARD_LIMITS.measures * 2) return sfail("invalid_request", `measures는 최대 ${SCORECARD_LIMITS.measures * 2}개입니다.`);
  const rows: Array<Omit<RecordVentureScorecardInput["rows"][number], "venture_class"> & { venture_class: ScorecardVentureClass }> = [];
  for (let i = 0; i < b.measures.length; i++) {
    const m = (b.measures[i] && typeof b.measures[i] === "object" ? b.measures[i] : {}) as Record<string, unknown>;
    const at = `measures[${i}]`;
    const key = typeof m.measure_key === "string" ? m.measure_key.trim() : "";
    if (!key || key.length > SCORECARD_LIMITS.measure_key) return sfail("invalid_request", `${at}.measure_key가 필요합니다 (최대 ${SCORECARD_LIMITS.measure_key}자).`);
    const section = greenfieldMeasureSection(key);
    if (!section) return sfail("invalid_request", `${at}.measure_key '${key}'는 문서화된 greenfield 측정 키가 아닙니다 (portfolio-venture-monitoring v1.2.0).`);
    const value = finiteOrNull(m.value, `${at}.value`);
    if (!value.ok) return sfail("invalid_request", value.message);
    const target = finiteOrNull(m.target_value, `${at}.target_value`);
    if (!target.ok) return sfail("invalid_request", target.message);
    if (!(SCORECARD_STATUSES as readonly unknown[]).includes(m.status)) return sfail("invalid_request", `${at}.status는 on_target | deviation | insufficient_evidence 중 하나입니다.`);
    const status = m.status as (typeof SCORECARD_STATUSES)[number];
    if (status !== "insufficient_evidence" && (value.value === null || target.value === null)) {
      return sfail("invalid_request", `${at}: value와 target_value가 없으면 status는 insufficient_evidence여야 합니다.`);
    }
    const ev = typeof m.evidence_ref === "string" ? m.evidence_ref.trim() : "";
    if (!ev || ev.length > SCORECARD_LIMITS.evidence_ref || !isValidEvidenceRef(ev)) {
      return sfail("invalid_request", `${at}.evidence_ref는 doc:<id> / src:<code> / https://<url> 형식이어야 합니다 (최대 ${SCORECARD_LIMITS.evidence_ref}자).`);
    }
    let observed = now;
    if (m.observed_at !== undefined && m.observed_at !== null) {
      const oi = observedAtIssue(m.observed_at, now);
      if (oi) return sfail("invalid_request", `${at}.observed_at ${oi}`);
      observed = m.observed_at as string;
    }
    if (rows.some((r) => r.measure_key === key)) return sfail("invalid_request", `${at}.measure_key '${key}'가 중복되었습니다.`);
    rows.push({
      venture_class: vc, section, measure_key: key,
      target_value: target.value === null ? null : String(target.value),
      actual_value: value.value === null ? null : String(value.value),
      status, evidence_ref: ev, observed_at: observed,
    });
  }
  for (const sec of ["financial", "strategic"] as const) {
    if (rows.filter((r) => r.section === sec).length > SCORECARD_LIMITS.measures) return sfail("invalid_request", `${sec} 측정은 최대 ${SCORECARD_LIMITS.measures}개입니다.`);
  }
  const prior = db
    .query("SELECT COUNT(*) AS n FROM venture_scorecard WHERE project_id = ? AND source_procedure = 'portfolio-venture-monitoring' AND review_cycle = ?")
    .get(input.projectId, cycle) as { n: number };
  if (prior.n > 0) return sfail("cycle_exists", `${cycle} 주기는 이미 기록되었습니다 — 주기는 변경할 수 없는 단위입니다 (ADR-0005).`);
  // venture_scorecard is UNIQUE (run_id, source_procedure, review_cycle,
  // section, measure_key) since migration 0139 (ADR-0164) — review_cycle is
  // part of the key, so consecutive quarters all land on the SAME latest run
  // (a run is a lineage snapshot, ADR-0005, not a one-cycle bucket). The
  // cycle_exists guard above keeps one record per project+procedure+cycle;
  // run_required survives only for the genuinely impossible case: no run at
  // all (rows are run-scoped, migration 0024 FK).
  const runs = db
    .query("SELECT id FROM run WHERE project_id = ? AND superseded_by IS NULL ORDER BY created_at DESC, id DESC")
    .all(input.projectId) as Array<{ id: string }>;
  const run = runs[0];
  if (!run) {
    return sfail(
      "run_required",
      "이 프로젝트에 분석 실행(run)이 없습니다 — 스코어카드 행은 run 단위로 저장됩니다 (migration 0024).",
    );
  }
  const out = db.transaction(() => {
    const r = recordGreenfieldScorecardCycle({ projectId: input.projectId, runId: run.id, reviewCycle: cycle, actor: input.actor, now, rows, note: note || null }, db);
    const out0 = r;
    appendAudit(db, {
      actor: input.actor,
      action: GREENFIELD_CYCLE_ACTION,
      // R10: hashes + short summary only; the values live in venture_scorecard.
      target: `${input.projectId}:${cycle}|${JSON.stringify({
        venture_class: vc, default_venture_class: def, measures: rows.length,
        statuses: rows.reduce<Record<string, number>>((acc, x) => ((acc[x.status] = (acc[x.status] ?? 0) + 1), acc), {}),
        measures_hash: sha16(JSON.stringify(rows.map((x) => [x.measure_key, x.actual_value, x.target_value, x.status]))),
        row_ids: out0.result.rowIds,
      })}`,
      now,
    });
    return r;
  })();
  return { ok: true, review_cycle: cycle, venture_class: effectiveVentureClass(input.projectId, db), row_ids: out.result.rowIds, measures: rows.length };
}

/** integration-monitoring read surface (pmi step 6): existing pmi_* ledgers only. */
export function integrationMonitoringView(projectId: string, db: Database = getDb()) {
  const certs = db
    .query("SELECT id, run_rate_bp, sustained_quarters, signed_at FROM pmi_synergy_certification WHERE project_id = ? ORDER BY signed_at DESC")
    .all(projectId) as Array<{ id: string; run_rate_bp: number; sustained_quarters: number; signed_at: string }>;
  const talent = db.query("SELECT status, COUNT(*) AS n FROM pmi_key_talent WHERE project_id = ? GROUP BY status").all(projectId) as Array<{ status: string; n: number }>;
  const count = (st: string) => talent.find((t) => t.status === st)?.n ?? 0;
  const total = talent.reduce((a, t) => a + t.n, 0);
  return {
    synergy: { certifications: certs.length, latest: certs[0] ?? null },
    // pmi_key_talent.status CHECK: active | departed_regretted | departed_planned.
    key_talent: {
      total, active: count("active"), departed_regretted: count("departed_regretted"), departed_planned: count("departed_planned"),
      retention_pct: total ? Math.round(((total - count("departed_regretted") - count("departed_planned")) / total) * 1000) / 10 : null,
    },
    recommended: true as const,
  };
}

/** partnership-monitoring read surface (jv-lifecycle-governance step 2): jv_term + jv scorecard rows. */
export function partnershipMonitoringView(projectId: string, db: Database = getDb()) {
  const terms = (db.query("SELECT COUNT(*) AS n FROM jv_term WHERE project_id = ?").get(projectId) as { n: number }).n;
  const latest = db
    .query("SELECT MAX(review_cycle) AS c FROM venture_scorecard WHERE project_id = ? AND source_procedure = 'jv-lifecycle-governance'")
    .get(projectId) as { c: string | null };
  const rows = latest.c
    ? (db
        .query("SELECT section, measure_key, status FROM venture_scorecard WHERE project_id = ? AND source_procedure = 'jv-lifecycle-governance' AND review_cycle = ? ORDER BY section, measure_key")
        .all(projectId, latest.c) as Array<{ section: string; measure_key: string; status: string }>)
    : [];
  return { jv_terms: terms, review_cycle: latest.c, measures: rows, recommended: true as const };
}

// ── Retroactive policy migration entry (design §8.1) ─────────────────────

export type MigrationErrorCode = "invalid_request" | "agent_forbidden" | "already_migrated" | "lead_required";
export type MigrationResult<T> = ({ ok: true } & T) | { ok: false; code: MigrationErrorCode; message: string };

/** What ADR-0161 applies to one project (no amounts, no names). */
export function adr0161Applicability(projectId: string, db: Database = getDb()) {
  const pm = postManagementApplicability(projectId, db);
  const gx = executionBaselineScope(projectId, db);
  return {
    track: pm.route.track,
    sub_track: pm.route.sub_track,
    greenfield_execution_baseline: gx.state,
    portfolio_venture_monitoring: pm.portfolio_venture_monitoring,
    integration_monitoring: pm.integration_monitoring,
    partnership_monitoring: pm.partnership_monitoring,
    pmi_tab: pm.pmi_applies,
  };
}

/** Process owner = the project's lead (project_member.project_role = 'lead'). */
export function isProjectLead(projectId: string, userId: string, db: Database = getDb()): boolean {
  const r = db
    .query("SELECT project_role FROM project_member WHERE project_id = ? AND user_id = ? AND revoked_at IS NULL")
    .get(projectId, userId) as { project_role: string } | null;
  return r?.project_role === "lead";
}

/**
 * One human-initiated policy_migration audit entry per project. Records the
 * stages already completed at migration time (so the retroactive rule keeps
 * them recommended) and the applicability snapshot. Never touches
 * project_policy_pin or any ledger row.
 */
export function recordPolicyMigration(
  input: { projectId: string; migrationNote: unknown; completedStages: string[]; actor: string; now?: string },
  db: Database = getDb(),
): MigrationResult<{ audit_id: string; applies: ReturnType<typeof adr0161Applicability> }> {
  if (AGENT_KEYS.has(input.actor)) return { ok: false, code: "agent_forbidden", message: "정책 이행 기록은 사람만 남길 수 있습니다." };
  if (!isProjectLead(input.projectId, input.actor, db)) {
    return { ok: false, code: "lead_required", message: "정책 이행 기록은 프로세스 책임자(프로젝트 lead)만 남길 수 있습니다." };
  }
  const note = s(input.migrationNote);
  if (!note) return { ok: false, code: "invalid_request", message: "migration_note가 필요합니다." };
  if (note.length > MAX_MIGRATION_NOTE_LEN) return { ok: false, code: "invalid_request", message: `migration_note는 ${MAX_MIGRATION_NOTE_LEN}자 이하여야 합니다.` };
  if (policyMigrationEntry(input.projectId, db)) return { ok: false, code: "already_migrated", message: "이 프로젝트의 ADR-0161 정책 이행 기록이 이미 있습니다." };
  const applies = adr0161Applicability(input.projectId, db);
  const now = input.now ?? new Date().toISOString();
  const detail = {
    adr: POLICY_MIGRATION_ADR, from_spec: POLICY_MIGRATION_FROM_SPEC, to_spec: POLICY_MIGRATION_TO_SPEC,
    // R10: short summary + hash only in the audit target.
    migration_note: auditSummary(note), migration_note_hash: sha16(note), completed_stages: input.completedStages, applies,
  };
  let auditId = "";
  db.transaction(() => {
    if (policyMigrationEntry(input.projectId, db)) return;
    auditId = appendAudit(db, { actor: input.actor, action: POLICY_MIGRATION_ACTION, target: `${input.projectId}|${JSON.stringify(detail)}`, now });
  }).immediate();
  if (!auditId) return { ok: false, code: "already_migrated", message: "이 프로젝트의 ADR-0161 정책 이행 기록이 이미 있습니다." };
  return { ok: true, audit_id: auditId, applies };
}

export interface InFlightAdr0161Counts {
  total: number;
  by_track: Record<string, number>;
  greenfield_execution_baseline: number;
  needs_classification: number;
  portfolio_venture_monitoring: number;
  integration_monitoring: number;
  partnership_monitoring: number;
  migrated: number;
  projects: Array<{ project_no: string; track: string; sub_track: string; applies: string[]; migrated: boolean }>;
}

/** Read-only policy-impact query: open, non-deleted projects and what ADR-0161 applies (counts only). */
export function inFlightAdr0161Counts(db: Database = getDb()): InFlightAdr0161Counts {
  const rows = db
    .query("SELECT id, project_no FROM md_project WHERE status = 'open' AND deleted_at IS NULL ORDER BY created_at, id")
    .all() as Array<{ id: string; project_no: string }>;
  const out: InFlightAdr0161Counts = {
    total: rows.length, by_track: {}, greenfield_execution_baseline: 0, needs_classification: 0,
    portfolio_venture_monitoring: 0, integration_monitoring: 0, partnership_monitoring: 0, migrated: 0, projects: [],
  };
  for (const r of rows) {
    const a = adr0161Applicability(r.id, db);
    const track = a.track ?? "needs_classification";
    out.by_track[track] = (out.by_track[track] ?? 0) + 1;
    const applies: string[] = [];
    if (a.greenfield_execution_baseline === "applies") { out.greenfield_execution_baseline += 1; applies.push("greenfield-execution-baseline"); }
    if (a.greenfield_execution_baseline === "needs_classification") out.needs_classification += 1;
    if (a.portfolio_venture_monitoring) { out.portfolio_venture_monitoring += 1; applies.push("portfolio-venture-monitoring"); }
    if (a.integration_monitoring) { out.integration_monitoring += 1; applies.push("integration-monitoring"); }
    if (a.partnership_monitoring) { out.partnership_monitoring += 1; applies.push("partnership-monitoring"); }
    const migrated = !!policyMigrationEntry(r.id, db);
    if (migrated) out.migrated += 1;
    out.projects.push({ project_no: r.project_no, track, sub_track: a.sub_track ?? "none", applies, migrated });
  }
  return out;
}
