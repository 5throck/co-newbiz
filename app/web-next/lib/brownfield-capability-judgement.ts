// Brown Field S7 per-target required-capability judgements (ADR-0171 slice 2).
//
// One judgement per (shortlisted target, S3 register row), stored in
// brownfield_target_capability_judgement with the ADR-0170 judgement JSON shape
// ({ resolution, attainability }). The S3 definition stays the single source
// (opportunity.capability_gap_json); validation, save and confirm reuse the Green Field
// pure functions on "pseudo rows" (S3 row + this target's judgement), so both tracks obey
// the same rules.
//
// Staleness has two halves (ADR-0171 D5): the S3 row hash stamped in attainability.basisHash
// and the hash of the target's evaluation state for the seeded criterion (eval_basis_hash).
// Either changing invalidates ONLY this target's judgement: the old values move to
// attainability.history[] (cap 5), confirmation is cleared, staleSince is set, the prior
// values stay as pre-fill. Derived on read; materialised (history + audit) on every S7 write.
//
// Boundaries: confirmation is a human-only route (never done here for an AI caller); AI output
// is a proposal only; no grade cap and no gate block; nothing is ever deleted by reconcile or
// by invalidation. Audit rows carry the calling user, surface=S7 and target_id.
import type { Database } from "bun:sqlite";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import {
  HISTORY_CAP,
  normalizeAttainability,
  type CapabilityAttainability,
  type CapabilityGapRow,
  type GapResolution,
  type RemovedCapability,
} from "./capability-gap.ts";
import {
  applyAttainabilityPatches,
  attainabilitySummary,
  confirmAttainability,
  readRegister,
  rowView,
  type AttainabilityError,
  type AttainabilityRowView,
  type AttainabilitySummary,
} from "./capability-attainability.ts";
import { basisMatches, capabilityRowHash, s3SnapshotOf, sha256Hex } from "./capability-linkage.ts";
import { detectCriteriaReconcile, type EvalCriterion, type ReconcilePlan } from "./brownfield-eval-criteria.ts";

export const BF_SURFACE = "S7";
/** Marker stamped on the derived pseudo row when only the evaluation half of the basis moved. */
const EVAL_STALE_MARK = "eval-stale";
const RESOLUTIONS: GapResolution[] = ["build", "partner", "hire", "invest"];

// ── Evaluation-state hash (second half of the BF staleness basis) ────────────

export interface EvalStateLike { status: string; note: string | null; evidence_ref: string | null }

/** Versioned hash of what a person recorded for the target x seeded criterion. No row = pending. */
export function evalStateHash(state: EvalStateLike | null | undefined): string {
  const canonical = JSON.stringify({
    status: state?.status ?? "pending",
    note: (state?.note ?? "").trim(),
    evidence: (state?.evidence_ref ?? "").trim(),
  });
  return `e1:${sha256Hex(canonical).slice(0, 16)}`;
}

// ── Stored shape ─────────────────────────────────────────────────────────────

export interface StoredJudgement { resolution: GapResolution | null; attainability: CapabilityAttainability }

interface StoredRow {
  id: string;
  brownfield_target_id: string;
  capability_row_id: string;
  criterion_id: string | null;
  judgement_json: string;
  eval_basis_hash: string | null;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
}

export function parseStored(json: string): StoredJudgement {
  try {
    const raw = JSON.parse(json) as { resolution?: unknown; attainability?: unknown };
    return {
      resolution: RESOLUTIONS.includes(raw.resolution as GapResolution) ? (raw.resolution as GapResolution) : null,
      attainability: normalizeAttainability(raw.attainability) ?? normalizeAttainability({})!,
    };
  } catch {
    return { resolution: null, attainability: normalizeAttainability({})! };
  }
}

const serialize = (j: StoredJudgement) => JSON.stringify({ resolution: j.resolution, attainability: j.attainability });

// ── Scope and context ────────────────────────────────────────────────────────

export interface TargetScope { id: string; opportunity_id: string; status: string; company_name: string }

export type ScopeResult = { ok: true; target: TargetScope } | { ok: false; code: "not_found" | "target_not_in_scope"; message: string };

/** Judgements exist only for shortlisted targets (the selected target is always one of them). */
export function targetScope(db: Database, targetId: string): ScopeResult {
  const t = db.query("SELECT id, opportunity_id, status, company_name FROM brownfield_target WHERE id = ?").get(targetId) as TargetScope | null;
  if (!t) return { ok: false, code: "not_found", message: "후보를 찾을 수 없습니다." };
  if (t.status !== "shortlisted") {
    return { ok: false, code: "target_not_in_scope", message: "필요 역량 점검은 최종 후보(숏리스트)로 선정된 대상에만 합니다 — 숏리스트 후 점검하세요." };
  }
  return { ok: true, target: t };
}

interface Ctx {
  target: TargetScope;
  s3Rows: CapabilityGapRow[];
  /** Non-retired seeded technical criterion by S3 row id. */
  criterionByRow: Map<string, EvalCriterion>;
  evalHashByRow: Map<string, string>;
  evalStatusByRow: Map<string, string>;
  stored: Map<string, StoredRow>;
}

function loadCtx(db: Database, target: TargetScope): Ctx {
  const reg = readRegister(db, target.opportunity_id);
  const s3Rows = reg?.rows ?? [];
  const criteria = db
    .query("SELECT * FROM brownfield_eval_criterion WHERE opportunity_id = ? AND category = 'technical' AND source = 'seeded' AND deleted_at IS NULL AND retired_at IS NULL")
    .all(target.opportunity_id) as unknown as EvalCriterion[];
  const criterionByRow = new Map(criteria.filter((c) => c.seed_ref).map((c) => [c.seed_ref as string, c]));
  const states = db.query("SELECT criterion_id, status, note, evidence_ref FROM brownfield_target_eval_state WHERE brownfield_target_id = ?").all(target.id) as Array<EvalStateLike & { criterion_id: string }>;
  const stateByCrit = new Map(states.map((s) => [s.criterion_id, s]));
  const evalHashByRow = new Map<string, string>();
  const evalStatusByRow = new Map<string, string>();
  for (const r of s3Rows) {
    const c = criterionByRow.get(r.id);
    const st = c ? stateByCrit.get(c.id) : undefined;
    evalHashByRow.set(r.id, evalStateHash(st));
    evalStatusByRow.set(r.id, st?.status ?? "pending");
  }
  const stored = new Map(
    (db.query("SELECT * FROM brownfield_target_capability_judgement WHERE brownfield_target_id = ?").all(target.id) as unknown as StoredRow[]).map((s) => [s.capability_row_id, s]),
  );
  return { target, s3Rows, criterionByRow, evalHashByRow, evalStatusByRow, stored };
}

// ── Pseudo rows (S3 row + this target's judgement) ──────────────────────────

/** Why a stored judgement is stale (empty = current). */
export function staleReasons(s3Row: CapabilityGapRow, stored: StoredJudgement | null, storedEvalHash: string | null, currentEvalHash: string): Array<"s3" | "eval"> {
  const a = stored?.attainability;
  if (!a) return [];
  const out: Array<"s3" | "eval"> = [];
  if (a.basisHash && !basisMatches(a.basisHash, s3Row)) out.push("s3");
  if (storedEvalHash && storedEvalHash !== currentEvalHash) out.push("eval");
  return out;
}

/** The GF-shaped row the shared pure functions work on. GF judgement on the S3 row is ignored. */
function pseudoRow(s3Row: CapabilityGapRow, stored: StoredJudgement | null, evalStale: boolean): CapabilityGapRow {
  const { attainability: _gf, ...base } = s3Row;
  const a = stored?.attainability;
  return {
    ...base,
    resolution: stored?.resolution ?? null,
    ...(a ? { attainability: evalStale ? { ...a, basisHash: EVAL_STALE_MARK } : a } : {}),
  };
}

function pseudoRows(ctx: Ctx): CapabilityGapRow[] {
  return ctx.s3Rows.map((r) => {
    const s = ctx.stored.get(r.id);
    const j = s ? parseStored(s.judgement_json) : null;
    const reasons = j ? staleReasons(r, j, s?.eval_basis_hash ?? null, ctx.evalHashByRow.get(r.id) ?? "") : [];
    return pseudoRow(r, j, reasons.includes("eval"));
  });
}

/** Read-only: the selected target's judgements as GF-shaped rows (stale target/eval state is reflected). Used by S8 lens T1 and gate briefs. */
export function targetJudgementRows(db: Database, target: TargetScope): CapabilityGapRow[] {
  return pseudoRows(loadCtx(db, target));
}

// ── Invalidation (materialise history + audit under the calling user) ───────

function historyEntry(row: CapabilityGapRow, a: CapabilityAttainability, resolution: GapResolution | null, at: string, reason: "s3_changed" | "eval_changed") {
  return {
    grade: a.grade,
    closingCostKrwM: a.closingCostKrwM,
    monthsToAttain: a.monthsToAttain,
    rationale: a.rationale,
    evidence: a.evidence,
    resolution,
    ...(a.expectedLevel ? { expectedLevel: a.expectedLevel } : {}),
    ...(a.category ? { category: a.category } : {}),
    confirmedBy: a.confirmedBy,
    confirmedAt: a.confirmedAt,
    basisHash: a.basisHash ?? "",
    invalidatedAt: at,
    reason,
    s3Snapshot: a.s3Snapshot ?? s3SnapshotOf(row),
  };
}

/**
 * Move stale judgements of this target into history, clear confirmation, set staleSince.
 * Idempotent (an already-materialised row is skipped). Call inside the caller's transaction.
 * Returns the S3 row ids that were invalidated by this call.
 */
export function invalidateTargetJudgements(db: Database, targetId: string, actor: string, at: string): string[] {
  const scope = db.query("SELECT id, opportunity_id, status, company_name FROM brownfield_target WHERE id = ?").get(targetId) as TargetScope | null;
  if (!scope) return [];
  const ctx = loadCtx(db, scope);
  const invalidated: string[] = [];
  for (const [rowId, s] of ctx.stored) {
    const s3Row = ctx.s3Rows.find((r) => r.id === rowId);
    if (!s3Row) continue; // S3 row removed: kept as-is (listed under removed capabilities)
    const j = parseStored(s.judgement_json);
    const reasons = staleReasons(s3Row, j, s.eval_basis_hash, ctx.evalHashByRow.get(rowId) ?? "");
    if (reasons.length === 0 || j.attainability.staleSince) continue;
    const reason = reasons.includes("s3") ? "s3_changed" : "eval_changed";
    let history = [...(j.attainability.history ?? []), historyEntry(s3Row, j.attainability, j.resolution, at, reason)];
    if (history.length > HISTORY_CAP) history = history.slice(-HISTORY_CAP);
    const next: StoredJudgement = { resolution: j.resolution, attainability: { ...j.attainability, confirmedBy: null, confirmedAt: null, staleSince: at, history } };
    db.run("UPDATE brownfield_target_capability_judgement SET judgement_json = ?, updated_at = ?, updated_by = ? WHERE id = ?", [serialize(next), at, actor, s.id]);
    invalidated.push(rowId);
  }
  if (invalidated.length > 0) {
    appendAudit(db, { actor, action: "capability_attainability.invalidate", target: `${scope.opportunity_id}#capability-stale@surface=${BF_SURFACE}:target_id=${targetId}:rows=${invalidated.join(",")}`, now: at });
  }
  return invalidated;
}

/** Invalidate every shortlisted target of an opportunity (used by reconcile and S3-aware callers). */
export function invalidateOpportunityTargets(db: Database, opportunityId: string, actor: string, at: string): string[] {
  const ids = (db.query("SELECT id FROM brownfield_target WHERE opportunity_id = ? AND status = 'shortlisted'").all(opportunityId) as Array<{ id: string }>).map((x) => x.id);
  return ids.flatMap((id) => invalidateTargetJudgements(db, id, actor, at));
}

// ── View ─────────────────────────────────────────────────────────────────────

export interface TargetJudgementRowView extends AttainabilityRowView {
  /** What made the judgement stale: the S3 definition and/or this target's evaluation state. */
  stale_reasons: Array<"s3" | "eval">;
  /** Seeded S7 criterion for this S3 row; null = not reconciled yet (cannot be judged). */
  criterion_id: string | null;
  /** This target's verdict on the seeded criterion (pending when none). */
  criterion_status: string;
  reconciled: boolean;
}

export interface TargetJudgementView {
  opportunity_id: string;
  target_id: string;
  company_name: string;
  stored: boolean;
  updated_at: string | null;
  rows: TargetJudgementRowView[];
  summary: AttainabilitySummary;
  removed_capabilities: RemovedCapability[];
  /** Criteria reconcile detection (S3 rows not yet reconciled into S7 criteria, retired rows, renames). */
  reconcile: ReconcilePlan;
  surface: typeof BF_SURFACE;
}

export function buildTargetView(db: Database, target: TargetScope): TargetJudgementView {
  const ctx = loadCtx(db, target);
  const pseudo = pseudoRows(ctx);
  const rows: TargetJudgementRowView[] = pseudo.map((p) => {
    const s = ctx.stored.get(p.id);
    const j = s ? parseStored(s.judgement_json) : null;
    const s3Row = ctx.s3Rows.find((r) => r.id === p.id)!;
    const reasons = staleReasons(s3Row, j, s?.eval_basis_hash ?? null, ctx.evalHashByRow.get(p.id) ?? "");
    const v = rowView(p);
    const crit = ctx.criterionByRow.get(p.id) ?? null;
    return {
      ...v,
      // The concurrency token carries both halves: "<s3 row hash>|<evaluation-state hash>".
      s3_hash: `${v.s3_hash}|${ctx.evalHashByRow.get(p.id) ?? ""}`,
      stale: reasons.length > 0,
      stale_since: reasons.length > 0 ? j?.attainability.staleSince ?? v.stale_since : null,
      stale_reasons: reasons,
      basis_hash: j?.attainability.basisHash ?? null,
      criterion_id: crit?.id ?? null,
      criterion_status: ctx.evalStatusByRow.get(p.id) ?? "pending",
      reconciled: crit !== null,
    };
  });
  const orphans: RemovedCapability[] = [];
  const known = new Set(ctx.s3Rows.map((r) => r.id));
  for (const [rowId, s] of ctx.stored) {
    if (known.has(rowId)) continue;
    const j = parseStored(s.judgement_json);
    orphans.push({
      rowId,
      capability: j.attainability.s3Snapshot?.capability || rowId,
      requiredLevel: j.attainability.s3Snapshot?.requiredLevel ?? "",
      currentLevel: j.attainability.s3Snapshot?.currentLevel ?? "",
      attainability: j.attainability,
      removedAt: s.updated_at,
      removedBy: s.updated_by,
    });
  }
  const updatedAt = [...ctx.stored.values()].map((s) => s.updated_at).sort().pop() ?? null;
  return {
    opportunity_id: target.opportunity_id,
    target_id: target.id,
    company_name: target.company_name,
    stored: ctx.stored.size > 0,
    updated_at: updatedAt,
    rows,
    summary: attainabilitySummary(pseudo),
    removed_capabilities: orphans,
    reconcile: detectCriteriaReconcile(target.opportunity_id, db),
    surface: BF_SURFACE,
  };
}

// ── Save ─────────────────────────────────────────────────────────────────────

export type TargetJudgementError = AttainabilityError | { code: "criteria_not_reconciled"; message: string };

export interface AuditCtx { action: string; via: string; at: string }

function auditTarget(scope: TargetScope, via: string): string {
  return `${scope.opportunity_id}#capability@${via}:surface=${BF_SURFACE}:target_id=${scope.id}`;
}

/** Split the composite concurrency token "<s3 hash>|<eval hash>" off each patch (client tokens are never trusted as basis). */
function splitTokens(patches: unknown): { patches: unknown; evalTokens: Map<string, string> } {
  const evalTokens = new Map<string, string>();
  if (!Array.isArray(patches)) return { patches, evalTokens };
  const out = (patches as Array<Record<string, unknown>>).map((raw) => {
    if (!raw || typeof raw !== "object" || typeof raw.s3Hash !== "string" || !raw.s3Hash.includes("|")) return raw;
    const [s3Part, evalPart] = raw.s3Hash.split("|");
    if (typeof raw.id === "string" && evalPart) evalTokens.set(raw.id, evalPart.trim().slice(0, 40));
    return { ...raw, s3Hash: s3Part };
  });
  return { patches: out, evalTokens };
}

/**
 * Save drafts for one target: read the live S3 register, merge only judgement-owned fields,
 * stamp the S3 basis and the target's evaluation-state basis server-side, write, audit.
 * Callable by any analyst+ caller; `actor.human` only labels the draft (AI drafts stay unconfirmed).
 */
export function saveTargetJudgements(
  db: Database,
  scope: TargetScope,
  patches: unknown,
  actor: { userId: string; human: boolean },
  audit: AuditCtx,
): { ok: true; changedIds: string[] } | { ok: false; error: TargetJudgementError } {
  return db.transaction(() => {
    invalidateTargetJudgements(db, scope.id, actor.userId, audit.at);
    const ctx = loadCtx(db, scope);
    const split = splitTokens(patches);
    // A row without a seeded S7 criterion cannot be judged until criteria are reconciled.
    if (Array.isArray(split.patches)) {
      for (const raw of split.patches as Array<Record<string, unknown>>) {
        const id = typeof raw?.id === "string" ? raw.id : "";
        if (id && ctx.s3Rows.some((r) => r.id === id) && !ctx.criterionByRow.has(id)) {
          return { ok: false as const, error: { code: "criteria_not_reconciled" as const, message: "S3에 추가된 역량이 아직 S7 평가 기준에 반영되지 않았습니다 — 먼저 기준을 맞춘(reconcile) 뒤 판정하세요." } };
        }
      }
    }
    const res = applyAttainabilityPatches(pseudoRows(ctx), split.patches, actor);
    if (!res.ok) return { ok: false as const, error: res.error };
    for (const id of res.changedIds) {
      const row = res.rows.find((r) => r.id === id)!;
      const crit = ctx.criterionByRow.get(id) ?? null;
      const currentEval = ctx.evalHashByRow.get(id) ?? evalStateHash(null);
      const seenEval = split.evalTokens.get(id);
      const evalBasis = seenEval && seenEval !== currentEval ? seenEval : currentEval;
      const resolution = row.resolution ?? null;
      const attainability = row.attainability;
      const existing = ctx.stored.get(id);
      if (!attainability && !resolution) {
        if (existing) db.run("DELETE FROM brownfield_target_capability_judgement WHERE id = ?", [existing.id]);
        continue;
      }
      const body = serialize({ resolution, attainability: attainability ?? normalizeAttainability({})! });
      if (existing) {
        db.run(
          "UPDATE brownfield_target_capability_judgement SET judgement_json = ?, eval_basis_hash = ?, criterion_id = ?, updated_by = ?, updated_at = ? WHERE id = ?",
          [body, evalBasis, crit?.id ?? null, actor.userId, audit.at, existing.id],
        );
      } else {
        db.run(
          `INSERT INTO brownfield_target_capability_judgement (id, brownfield_target_id, capability_row_id, criterion_id, judgement_json, eval_basis_hash, created_by, created_at, updated_by, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [ulid(), scope.id, id, crit?.id ?? null, body, evalBasis, actor.userId, audit.at, actor.userId, audit.at],
        );
      }
    }
    if (res.changedIds.length > 0) appendAudit(db, { actor: actor.userId, action: audit.action, target: auditTarget(scope, audit.via), now: audit.at });
    return { ok: true as const, changedIds: res.changedIds };
  })();
}

// ── Confirm (human-only route) ───────────────────────────────────────────────

export function confirmTargetJudgements(
  db: Database,
  scope: TargetScope,
  rowIds: string[] | null,
  userId: string,
  audit: AuditCtx,
): { ok: true; confirmedIds: string[] } | { ok: false; error: TargetJudgementError } {
  return db.transaction(() => {
    invalidateTargetJudgements(db, scope.id, userId, audit.at);
    const ctx = loadCtx(db, scope);
    const res = confirmAttainability(pseudoRows(ctx), rowIds, userId, audit.at);
    if (!res.ok) return { ok: false as const, error: res.error };
    for (const id of res.confirmedIds) {
      const row = res.rows.find((r) => r.id === id)!;
      const existing = ctx.stored.get(id);
      if (!existing || !row.attainability) continue;
      const body = serialize({ resolution: row.resolution ?? null, attainability: row.attainability });
      db.run("UPDATE brownfield_target_capability_judgement SET judgement_json = ?, updated_by = ?, updated_at = ? WHERE id = ?", [body, userId, audit.at, existing.id]);
    }
    appendAudit(db, { actor: userId, action: audit.action, target: auditTarget(scope, audit.via), now: audit.at });
    return { ok: true as const, confirmedIds: res.confirmedIds };
  })();
}

// ── One-off legacy copy (ADR-0171 Consequences) ──────────────────────────────

export interface LegacyCopyItem { rowId: string; capability: string; outcome: "copied" | "skip_existing" | "skip_no_criterion" }

/**
 * Copy legacy Brown Field judgements stored on the S3 register rows to ONE target as UNCONFIRMED
 * rows. Never overwrites an existing target judgement; rows without a seeded S7 criterion are
 * skipped (reconcile first). Confirmation is never copied (human-only). `apply=false` writes nothing.
 * Idempotent: a second run finds every row as skip_existing.
 */
export function copyLegacyJudgementsToTarget(db: Database, scope: TargetScope, opts: { apply: boolean; actor: string; at: string }): LegacyCopyItem[] {
  const run = (): LegacyCopyItem[] => {
    const ctx = loadCtx(db, scope);
    const out: LegacyCopyItem[] = [];
    for (const r of ctx.s3Rows) {
      if (!r.attainability && !r.resolution) continue;
      if (ctx.stored.has(r.id)) { out.push({ rowId: r.id, capability: r.capability, outcome: "skip_existing" }); continue; }
      const crit = ctx.criterionByRow.get(r.id);
      if (!crit) { out.push({ rowId: r.id, capability: r.capability, outcome: "skip_no_criterion" }); continue; }
      out.push({ rowId: r.id, capability: r.capability, outcome: "copied" });
      if (!opts.apply) continue;
      const a = normalizeAttainability(r.attainability ?? {})!;
      const body = serialize({ resolution: r.resolution ?? null, attainability: { ...a, confirmedBy: null, confirmedAt: null } });
      db.run(
        `INSERT INTO brownfield_target_capability_judgement (id, brownfield_target_id, capability_row_id, criterion_id, judgement_json, eval_basis_hash, created_by, created_at, updated_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [ulid(), scope.id, r.id, crit.id, body, ctx.evalHashByRow.get(r.id) ?? evalStateHash(null), opts.actor, opts.at, opts.actor, opts.at],
      );
      appendAudit(db, { actor: opts.actor, action: "capability_attainability.legacy_copy", target: `${scope.opportunity_id}#capability@script:surface=${BF_SURFACE}:target_id=${scope.id}:row=${r.id}`, now: opts.at });
    }
    return out;
  };
  return opts.apply ? db.transaction(run)() : run();
}

// ── Readiness (warning-only) ─────────────────────────────────────────────────

export interface TargetCapabilityReadiness {
  target_id: string;
  company_name: string;
  total: number;
  confirmed: number;
  /** Judged but not yet confirmed. */
  unconfirmed: number;
  stale: number;
  unjudged: number;
  unreconciled: number;
}

export interface CapabilityReadiness {
  opportunity_id: string;
  targets: TargetCapabilityReadiness[];
  reconcile: ReconcilePlan;
  /** Warning text for the S7 target_screening readiness area; null when nothing to flag. Never a gate condition. */
  warning: string | null;
}

export function capabilityReadiness(db: Database, opportunityId: string): CapabilityReadiness {
  const shortlisted = db.query("SELECT id, opportunity_id, status, company_name FROM brownfield_target WHERE opportunity_id = ? AND status = 'shortlisted' ORDER BY rank, company_name").all(opportunityId) as unknown as TargetScope[];
  const targets: TargetCapabilityReadiness[] = shortlisted.map((t) => {
    const v = buildTargetView(db, t);
    return {
      target_id: t.id,
      company_name: t.company_name,
      total: v.summary.total,
      confirmed: v.summary.confirmed,
      unconfirmed: v.summary.awaitingConfirmation,
      stale: v.summary.stale,
      unjudged: Math.max(0, v.summary.grades.unjudged - v.summary.stale),
      unreconciled: v.rows.filter((r) => !r.reconciled).length,
    };
  });
  const reconcile = detectCriteriaReconcile(opportunityId, db);
  const open = targets.filter((t) => t.total > 0 && (t.confirmed < t.total || t.stale > 0));
  const parts: string[] = [];
  if (open.length > 0) {
    parts.push(`필요 역량 점검이 끝나지 않은 최종 후보 ${open.length}/${targets.length}건 (확정 전 ${open.reduce((a, t) => a + t.unconfirmed, 0)}, 재판정 필요 ${open.reduce((a, t) => a + t.stale, 0)}, 미판정 ${open.reduce((a, t) => a + t.unjudged, 0)})`);
  }
  if (!reconcile.inSync) parts.push("S3 필요 역량과 S7 평가 기준이 맞지 않음(기준 맞추기 필요)");
  return {
    opportunity_id: opportunityId,
    targets,
    reconcile,
    warning: parts.length === 0 ? null : `${parts.join(" · ")} — 참고용 경고이며 대상 선정 게이트나 등급을 막지 않습니다.`,
  };
}
