// pre-ic-capture — ADR-0187 D4 / finding H11 (migration 0182).
//
// Greenfield permit and incentive candidates are captured BEFORE the IC: at S8
// (feasibility, the normal point) or optionally at S5. They are ordinary rows
// in the same `permit` / `incentive` tables the S11 execution baseline reads,
// tagged `stage_captured` + `captured_by` / `captured_at`. The S11 baseline
// adopts them BY REFERENCE (permit_milestones[].permit_id,
// incentive_obligations[].incentive_id) instead of re-entering them.
//
// Permits and certifications stay separate (non-negotiable boundary 5): this
// module never reads or writes `certification`. An incentive candidate must
// carry its clawback terms. Writes are person-only (agents have no accounts,
// boundary 1) and audited; the route enforces need-to-know (visibleProject).
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { isValidEvidenceRef } from "../../../db/lib/evidence-ref.ts";
import { AGENT_KEYS } from "./agent-registry.generated.ts";
import { badRequest, fail, forbidden, notFound } from "./envelope.ts";
import {
  EMPTY_ENTRIES,
  executionBaselineScope,
  latestExecutionBaseline,
  recordBaselineEntries,
  type BaselineEntries,
  type BaselineErrorCode,
  type BaselineRecord,
} from "./greenfield-execution.ts";

export const PRE_IC_STAGES = ["S5", "S8"] as const;
export type PreIcStage = (typeof PRE_IC_STAGES)[number];

export type CaptureErrorCode = BaselineErrorCode | "permit_step_not_applicable" | "not_found";
export type CaptureResult<T> = ({ ok: true } & T) | { ok: false; code: CaptureErrorCode; message: string };
const cfail = (code: CaptureErrorCode, message: string) => ({ ok: false as const, code, message });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: string) => DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const MAX_SHORT = 200;
const MAX_TEXT = 2000;

function guard(projectId: string, actor: string, db: Database, kind: "permit" | "incentive"): { ok: false; code: CaptureErrorCode; message: string } | null {
  if (AGENT_KEYS.has(actor)) return cfail("agent_forbidden", "Pre-IC capture is recorded by a person only (boundary 1).");
  const scope = executionBaselineScope(projectId, db);
  if (scope.state === "needs_classification") return cfail("needs_classification", scope.reason);
  if (scope.state === "not_applicable") return cfail("not_applicable_track", scope.reason);
  if (kind === "permit" && !scope.permit_step_applies) {
    return cfail("permit_step_not_applicable", "The permit step does not apply to this sub-track (intra_venture); record incentives only.");
  }
  return null;
}

function stageOf(v: unknown): PreIcStage | null {
  return (PRE_IC_STAGES as readonly string[]).includes(str(v)) ? (str(v) as PreIcStage) : null;
}

export interface PermitCaptureInput {
  projectId: string;
  stage: unknown;
  name: unknown;
  agency?: unknown;
  statutory_days?: unknown;
  actor: string;
  now?: string;
}

export function capturePermitCandidate(input: PermitCaptureInput, db: Database = getDb()): CaptureResult<{ id: string }> {
  const stage = stageOf(input.stage);
  if (!stage) return cfail("invalid_request", `stage must be one of ${PRE_IC_STAGES.join(" | ")}.`);
  const g = guard(input.projectId, input.actor, db, "permit");
  if (g) return g;
  const name = str(input.name);
  if (!name || name.length > MAX_SHORT) return cfail("invalid_request", `name is required (1-${MAX_SHORT} characters).`);
  const agency = str(input.agency) || null;
  if (agency && agency.length > MAX_SHORT) return cfail("invalid_request", `agency must be at most ${MAX_SHORT} characters.`);
  const days = input.statutory_days;
  if (days !== undefined && days !== null && (typeof days !== "number" || !Number.isInteger(days) || days < 0 || days > 3650)) {
    return cfail("invalid_request", "statutory_days must be an integer 0-3650 or null.");
  }
  const now = input.now ?? new Date().toISOString();
  const id = ulid();
  db.transaction(() => {
    db.run(
      "INSERT INTO permit (id, project_id, name, agency, statutory_days, status, stage_captured, captured_by, captured_at) VALUES (?,?,?,?,?,'not_started',?,?,?)",
      [id, input.projectId, name, agency, (days as number | null | undefined) ?? null, stage, input.actor, now],
    );
    appendAudit(db, { actor: input.actor, action: "permit.pre_ic_captured", target: `${input.projectId}:${id}|stage=${stage}`, now });
  }).immediate();
  return { ok: true, id };
}

export interface IncentiveCaptureInput {
  projectId: string;
  stage: unknown;
  program_name: unknown;
  type: unknown;
  grantor?: unknown;
  npv_value?: unknown;
  clawback_rule: unknown;
  application_deadline?: unknown;
  construction_deadline?: unknown;
  evidence_ref?: unknown;
  actor: string;
  now?: string;
}

export function captureIncentiveCandidate(input: IncentiveCaptureInput, db: Database = getDb()): CaptureResult<{ id: string }> {
  const stage = stageOf(input.stage);
  if (!stage) return cfail("invalid_request", `stage must be one of ${PRE_IC_STAGES.join(" | ")}.`);
  const g = guard(input.projectId, input.actor, db, "incentive");
  if (g) return g;
  const program = str(input.program_name);
  if (!program || program.length > MAX_SHORT) return cfail("invalid_request", `program_name is required (1-${MAX_SHORT} characters).`);
  const clawback = str(input.clawback_rule);
  if (!clawback || clawback.length > MAX_TEXT) {
    return cfail("invalid_request", `clawback_rule is required for a pre-IC incentive candidate (1-${MAX_TEXT} characters; state "none" with its basis when the program has no clawback).`);
  }
  const type = str(input.type);
  if (!type) return cfail("invalid_request", "type is required for a pre-IC incentive candidate (no default).");
  const grantor = str(input.grantor) || null;
  if (type.length > MAX_SHORT || (grantor && grantor.length > MAX_SHORT)) return cfail("invalid_request", `type and grantor must be at most ${MAX_SHORT} characters.`);
  const npv = input.npv_value;
  if (npv !== undefined && npv !== null && (typeof npv !== "number" || !Number.isInteger(npv))) {
    return cfail("invalid_request", "npv_value must be an INTEGER in KRW millions (ADR-0061) or null.");
  }
  const dates: Record<string, string | null> = {};
  for (const k of ["application_deadline", "construction_deadline"] as const) {
    const v = str(input[k]);
    if (v && !isDate(v)) return cfail("invalid_request", `${k} must be a YYYY-MM-DD date.`);
    dates[k] = v || null;
  }
  const evidence = str(input.evidence_ref) || null;
  if (evidence && !isValidEvidenceRef(evidence)) return cfail("invalid_request", "evidence_ref is not a valid evidence reference.");
  const now = input.now ?? new Date().toISOString();
  const id = ulid();
  db.transaction(() => {
    db.run(
      `INSERT INTO incentive (id, project_id, direction, type, grantor, program_name, npv_value, clawback_rule, application_deadline, construction_deadline,
                              evidence_ref, status, stage_captured, captured_by, captured_at)
       VALUES (?,?,'prospective',?,?,?,?,?,?,?,?,'prospective',?,?,?)`,
      [id, input.projectId, type, grantor, program, (npv as number | null | undefined) ?? null, clawback,
       dates.application_deadline, dates.construction_deadline, evidence, stage, input.actor, now],
    );
    appendAudit(db, { actor: input.actor, action: "incentive.pre_ic_captured", target: `${input.projectId}:${id}|stage=${stage}`, now });
  }).immediate();
  return { ok: true, id };
}

export interface PreIcPermit {
  id: string; name: string; agency: string | null; statutory_days: number | null; status: string;
  stage_captured: PreIcStage; captured_by: string; captured_at: string;
}
export interface PreIcIncentive {
  id: string; program_name: string; type: string; grantor: string | null; npv_value: number | null; clawback_rule: string | null;
  application_deadline: string | null; construction_deadline: string | null; evidence_ref: string | null; direction: string;
  stage_captured: PreIcStage; captured_by: string; captured_at: string;
}

export function listPreIcCaptures(projectId: string, db: Database = getDb()): { permits: PreIcPermit[]; incentives: PreIcIncentive[] } {
  const permits = db
    .query(
      `SELECT id, name, agency, statutory_days, status, stage_captured, captured_by, captured_at FROM permit
       WHERE project_id = ? AND stage_captured IN ('S5','S8') ORDER BY captured_at, id`,
    )
    .all(projectId) as PreIcPermit[];
  const incentives = db
    .query(
      `SELECT id, program_name, type, grantor, npv_value, clawback_rule, application_deadline, construction_deadline, evidence_ref, direction,
              stage_captured, captured_by, captured_at FROM incentive
       WHERE project_id = ? AND stage_captured IN ('S5','S8') ORDER BY captured_at, id`,
    )
    .all(projectId) as PreIcIncentive[];
  return { permits, incentives };
}

export interface PreIcLinkStatus {
  permits: Array<{ id: string; name: string; stage_captured: PreIcStage; linked: boolean }>;
  incentives: Array<{ id: string; program_name: string; stage_captured: PreIcStage; linked: boolean }>;
  unlinked: number;
}

/** Which pre-IC captures the given baseline entries already reference (adoption is by id, never by re-entry). */
export function preIcLinkStatus(projectId: string, entries: BaselineEntries, db: Database = getDb()): PreIcLinkStatus {
  const caps = listPreIcCaptures(projectId, db);
  const permitIds = new Set(entries.permit_milestones.map((m) => m.source_id).filter(Boolean));
  const incentiveIds = new Set(entries.incentive_obligations.map((o) => o.incentive_id).filter(Boolean));
  const permits = caps.permits.map((p) => ({ id: p.id, name: p.name, stage_captured: p.stage_captured, linked: permitIds.has(p.id) }));
  const incentives = caps.incentives.map((i) => ({ id: i.id, program_name: i.program_name, stage_captured: i.stage_captured, linked: incentiveIds.has(i.id) }));
  return { permits, incentives, unlinked: [...permits, ...incentives].filter((x) => !x.linked).length };
}

/**
 * S11 adoption: append a baseline entry for every pre-IC capture the latest
 * baseline does not yet reference, linked by id, and record it as a new
 * (unconfirmed) baseline entries record through recordBaselineEntries (same
 * guard, same audit, re-confirmation required). A permit milestone needs a
 * target date the capture does not hold, so the caller supplies one per
 * permit id; a permit without one is reported in `skipped`, never dated by
 * default. An incentive obligation carries the clawback terms and the
 * earlier of the recorded deadlines.
 */
export function adoptPreIcCaptures(
  input: { projectId: string; permitTargetDates?: unknown; actor: string; now?: string },
  db: Database = getDb(),
): CaptureResult<{ record: BaselineRecord; adopted: { permits: string[]; incentives: string[] }; skipped: Array<{ id: string; reason: string }> }> {
  if (AGENT_KEYS.has(input.actor)) return cfail("agent_forbidden", "Baseline adoption is recorded by a person only (boundary 1).");
  const targetDates: Record<string, string> = {};
  if (input.permitTargetDates !== undefined && input.permitTargetDates !== null) {
    if (typeof input.permitTargetDates !== "object" || Array.isArray(input.permitTargetDates)) {
      return cfail("invalid_request", "permit_target_dates must be an object of permit id -> YYYY-MM-DD.");
    }
    for (const [k, v] of Object.entries(input.permitTargetDates as Record<string, unknown>)) {
      if (typeof v !== "string" || !isDate(v.trim())) return cfail("invalid_request", `permit_target_dates.${k} must be a YYYY-MM-DD date.`);
      targetDates[k] = v.trim();
    }
  }
  type Out = CaptureResult<{ record: BaselineRecord; adopted: { permits: string[]; incentives: string[] }; skipped: Array<{ id: string; reason: string }> }>;
  // One immediate transaction: the latest-baseline read, the new entries record and both audit rows (no lost update
  // against a concurrent baseline write). recordBaselineEntries' own transaction nests as a savepoint.
  return db.transaction((): Out => {
    const scope = executionBaselineScope(input.projectId, db);
    const current = latestExecutionBaseline(input.projectId, db)?.entries ?? EMPTY_ENTRIES;
    const status = preIcLinkStatus(input.projectId, current, db);
    const caps = listPreIcCaptures(input.projectId, db);
    const unknownDate = Object.keys(targetDates).filter((id) => !caps.permits.some((p) => p.id === id));
    if (unknownDate.length) return cfail("not_found", `permit_target_dates names permits that are not pre-IC captures of this project: ${unknownDate.join(", ")}`);
    const next: BaselineEntries = {
      ...current,
      permit_milestones: [...current.permit_milestones],
      incentive_obligations: [...current.incentive_obligations],
    };
    const adopted = { permits: [] as string[], incentives: [] as string[] };
    const skipped: Array<{ id: string; reason: string }> = [];
    for (const p of caps.permits) {
      if (status.permits.find((x) => x.id === p.id)?.linked) continue;
      if (!scope.permit_step_applies) { skipped.push({ id: p.id, reason: "permit_step_not_applicable" }); continue; }
      const date = targetDates[p.id];
      if (!date) { skipped.push({ id: p.id, reason: "target_date_required" }); continue; }
      next.permit_milestones.push({ name: p.name, issuer: p.agency ?? "(issuer not recorded)", target_date: date, gates_ref: null, source_id: p.id });
      adopted.permits.push(p.id);
    }
    for (const i of caps.incentives) {
      if (status.incentives.find((x) => x.id === i.id)?.linked) continue;
      const deadlines = [i.application_deadline, i.construction_deadline].filter((d): d is string => !!d).sort();
      const obligation = `${i.program_name}: clawback ${i.clawback_rule ?? "(not recorded)"}`.slice(0, MAX_TEXT);
      next.incentive_obligations.push({ obligation, deadline: deadlines[0] ?? null, depends_on: null, incentive_id: i.id });
      adopted.incentives.push(i.id);
    }
    if (!adopted.permits.length && !adopted.incentives.length) {
      return cfail("invalid_request", skipped.length ? "No capture could be adopted; see the skipped reasons (a permit needs a target date)." : "Every pre-IC capture is already linked in the baseline.");
    }
    const res = recordBaselineEntries({ projectId: input.projectId, entries: next, actor: input.actor, now: input.now }, db);
    if (!res.ok) return cfail(res.code, res.message);
    appendAudit(db, {
      actor: input.actor,
      action: "execution_baseline.pre_ic_adopted",
      target: `${input.projectId}:${res.record.id}|permits=${adopted.permits.join(",")};incentives=${adopted.incentives.join(",")}`,
      now: input.now ?? new Date().toISOString(),
    });
    return { ok: true, record: res.record, adopted, skipped };
  }).immediate();
}

/** HTTP mapping for a capture/adoption failure (shared by the two pre-IC routes). */
export function captureFailure(r: Extract<CaptureResult<object>, { ok: false }>) {
  if (r.code === "invalid_request") return badRequest(r.code, r.message);
  if (r.code === "not_found") return notFound(r.message);
  if (r.code === "agent_forbidden" || r.code === "insider_required" || r.code === "lead_required") return forbidden(r.code, r.message);
  return fail(409, r.code, r.message);
}

