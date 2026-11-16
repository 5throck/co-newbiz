// @version 1.0.0
/**
 * brownfield-eval-draft.repository.ts - all SQL for the migration 0194 tables (ADR-0199, spec
 * 2026-11-16-s6-bulk-ai-eval-versioning §3.2/§3.3/§5/§7).
 *
 *   brownfield_eval_draft_run       one bulk run = one attribution unit; mutable status only
 *   brownfield_eval_draft_run_item  per-candidate checkpoint that makes resume possible; mutable
 *   brownfield_eval_draft_version   immutable per-candidate, per-category snapshot v{n}
 *
 * Invariants owned here:
 *   - At most one active run (running | paused_budget | interrupted) per opportunity. Starting while one is
 *     active returns it with `reused: true` (the partial unique index ux_bedr_active is the DB backstop).
 *   - Replace-on-success: a version row is inserted only when a category step finished. `commitCategoryDraft`
 *     calls the producer and inserts the version + advances the run item in ONE transaction; a throwing
 *     producer writes nothing (no version, no item change), so the previous version stays the latest.
 *   - Unchanged inputs: when the computed input_hash equals the latest version's hash for that candidate and
 *     category, no version is written and the producer (LLM / rubric) is never called. The run item records
 *     outcome `unchanged` and points at the existing version; its updated_at becomes the `checked_at`.
 *   - version_no = MAX(version_no) + 1 per (candidate, category), allocated inside the insert transaction
 *     (SQLite's single writer serializes it; the UNIQUE index rejects any duplicate).
 *   - Versions are never UPDATEd or deleted here (DB triggers trg_bedv_no_update / trg_bedv_no_orphan_delete).
 *
 * Audit events (`target_eval.bulk_run.*`, `target_eval.draft_version.*`) are appended by the engine/route
 * layer that owns the caller context (phase 2c), not by this repository. Identity fields (`startedBy`,
 * `createdBy`, `resumedBy`) are the calling user's id from the session, never from a request body (boundary #1).
 * Drafts are proposals: nothing in this file writes brownfield_target_eval_state verdicts or eval_summary.
 */
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ulid } from "../lib/ulid.ts";

// ---------------------------------------------------------------------------------------------------------------
// Closed vocabularies — byte-identical to the migration 0194 CHECK constraints.
// ---------------------------------------------------------------------------------------------------------------

export const EVAL_DRAFT_CATEGORIES = ["financial", "technical"] as const;
export type EvalDraftCategory = (typeof EVAL_DRAFT_CATEGORIES)[number];

export const RUN_CATEGORY_SELECTIONS = ["financial", "technical", "both"] as const;
export type RunCategorySelection = (typeof RUN_CATEGORY_SELECTIONS)[number];

export const RUN_STATUSES = ["running", "paused_budget", "interrupted", "completed", "cancelled", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ["running", "paused_budget", "interrupted"];
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ["completed", "cancelled", "failed"];

export const RUN_ITEM_STATES = [
  "pending",
  "financial_sync",
  "financial_draft",
  "technical_draft",
  "done",
  "failed",
  "skipped_not_dart",
  "skipped_no_company",
  "skipped_llm_unconfigured",
] as const;
export type RunItemState = (typeof RUN_ITEM_STATES)[number];
export const TERMINAL_ITEM_STATES: readonly RunItemState[] = [
  "done",
  "failed",
  "skipped_not_dart",
  "skipped_no_company",
  "skipped_llm_unconfigured",
];

export const CATEGORY_OUTCOMES = ["versioned", "unchanged", "failed", "skipped", "nothing_pending"] as const;
export type CategoryOutcome = (typeof CATEGORY_OUTCOMES)[number];

export const EVIDENCE_GRADES = ["A", "B", "C", "U"] as const; // ADR-0187 D1
export type EvidenceGrade = (typeof EVIDENCE_GRADES)[number];

/** A `running` run whose heartbeat is older than this is lazily marked `interrupted` (design §4 A2, §7). */
export const HEARTBEAT_STALE_MS = 10 * 60 * 1000;
/** Payload size cap (§3.3). Over the cap the item fails; a payload is never silently truncated. */
export const DRAFT_PAYLOAD_MAX_BYTES = 64 * 1024;
/** Per-citation quote cap and per-item citation cap (§3.3). The payload builder truncates; the schema enforces. */
export const CITATION_QUOTE_MAX_CHARS = 300;
export const CITATIONS_PER_ITEM_MAX = 3;

// ---------------------------------------------------------------------------------------------------------------
// Payload document, schema version 1 (§3.3).
// ---------------------------------------------------------------------------------------------------------------

const proposedStatus = z.enum(["pass", "partial", "fail"]).nullable(); // null = 확인 안됨

const citationSchema = z.object({
  kind: z.enum(["business_report", "disclosure", "profile", "web"]),
  ref: z.string().min(1),
  quote: z.string().max(CITATION_QUOTE_MAX_CHARS),
});

export const evalDraftPayloadSchema = z.object({
  schema: z.literal(1),
  category: z.enum(EVAL_DRAFT_CATEGORIES),
  criteria_snapshot: z.array(
    z.object({
      criterion_id: z.string().min(1),
      label: z.string(),
      data_ref: z.string().nullable().optional(),
      weight: z.number().int().nonnegative(),
      source: z.enum(["builtin", "seeded", "custom"]),
      rubric: z.record(z.string(), z.unknown()).nullable(),
    }),
  ),
  items: z.array(
    z.object({
      criterion_id: z.string().min(1),
      proposed_status: proposedStatus,
      reason: z.string().nullable(),
      metrics: z.array(z.object({ label: z.string(), value: z.string() })),
      note: z.string().nullable(),
      citations: z.array(citationSchema).max(CITATIONS_PER_ITEM_MAX),
    }),
  ),
  human_items: z.array(
    z.object({
      criterion_id: z.string().min(1),
      status: z.enum(["pending", "pass", "partial", "fail", "na", "waived"]),
      assessed_by: z.string(),
      assessed_at: z.string(),
    }),
  ),
  provisional_score: z.object({
    score: z.number().int().min(0).max(100).nullable(),
    scored_weight: z.number().nonnegative(),
    total_weight: z.number().nonnegative(),
  }),
  dart: z
    .object({
      corp_code: z.string().length(8),
      base_years: z.array(z.number().int()),
      latest_sync_at: z.string().nullable(),
      sync_warnings: z.array(z.string()),
    })
    .nullable(),
  evidence: z.object({
    disclosures: z.array(
      z.object({ rcept_no: z.string().length(14), rcept_dt: z.string().length(8), report_nm: z.string() }),
    ),
    business_report: z
      .object({
        rcept_no: z.string().length(14).nullable(),
        rcept_dt: z.string().nullable(),
        available: z.boolean(),
        sections_found: z.array(z.string()),
        truncated: z.boolean(),
        error: z.string().nullable(),
      })
      .nullable(),
    profile: z.object({ present: z.boolean(), version_no: z.number().int().nullable() }),
    web: z.array(z.object({ criterion_id: z.string(), url: z.string(), host: z.string() })),
  }),
  llm: z.object({ source: z.string(), provider: z.string(), prompt_key: z.string() }).nullable(),
  runner: z.object({ user_id: z.string().min(1), via: z.string().min(1) }),
  generated_at: z.string(),
});
export type EvalDraftPayload = z.infer<typeof evalDraftPayloadSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------------------------------------------

/** Deterministic JSON: object keys sorted recursively, arrays kept in order, undefined members dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/**
 * sha256 over the canonical serialization of the draft inputs (ADR-0005). The caller assembles the documented input
 * set (§3.3: fact rows or evidence ids + quote hashes, criteria snapshot incl. rubric JSON, human-judged set,
 * web_evidence flag, prompt key) BEFORE the rubric or the LLM runs; equal hash ⇒ equal inputs.
 */
export function computeDraftInputHash(inputs: unknown): string {
  return createHash("sha256").update(canonicalJson(inputs), "utf8").digest("hex");
}

/** True when a `running` run's heartbeat is older than HEARTBEAT_STALE_MS at `now`. */
export function isHeartbeatStale(heartbeatAt: string, now: string): boolean {
  return new Date(now).getTime() - new Date(heartbeatAt).getTime() > HEARTBEAT_STALE_MS;
}

// ---------------------------------------------------------------------------------------------------------------
// Row types.
// ---------------------------------------------------------------------------------------------------------------

export interface DraftRunRow {
  id: string;
  opportunity_id: string;
  categories: RunCategorySelection;
  web_evidence: 0 | 1;
  force_refresh: 0 | 1;
  status: RunStatus;
  total_targets: number;
  started_by: string;
  started_via: string;
  resumed_by: string | null;
  started_at: string;
  heartbeat_at: string;
  finished_at: string | null;
  pause_reason: string | null;
  error_message: string | null;
}

export interface DraftRunItemRow {
  id: string;
  run_id: string;
  brownfield_target_id: string;
  seq: number;
  state: RunItemState;
  financial_outcome: CategoryOutcome | null;
  technical_outcome: CategoryOutcome | null;
  financial_version_id: string | null;
  technical_version_id: string | null;
  dart_calls: number;
  error_message: string | null;
  updated_at: string;
}

export interface DraftVersionSummaryRow {
  id: string;
  brownfield_target_id: string;
  category: EvalDraftCategory;
  version_no: number;
  run_id: string | null;
  provisional_score: number | null;
  proposed_count: number;
  unverified_count: number;
  evidence_grade: EvidenceGrade;
  input_hash: string;
  created_by: string;
  created_at: string;
}

export interface DraftVersionRow extends DraftVersionSummaryRow {
  payload: string;
}

/** `invalid` = input shape/vocabulary problem; `not_found` = unknown run/item/opportunity; `conflict` = illegal transition. */
export class EvalDraftError extends Error {
  constructor(
    readonly kind: "invalid" | "not_found" | "conflict" | "payload_too_large",
    message: string,
  ) {
    super(message);
    this.name = "EvalDraftError";
  }
}

const RUN_COLUMNS =
  "id, opportunity_id, categories, web_evidence, force_refresh, status, total_targets, started_by, started_via, resumed_by, started_at, heartbeat_at, finished_at, pause_reason, error_message";
const ITEM_COLUMNS =
  "id, run_id, brownfield_target_id, seq, state, financial_outcome, technical_outcome, financial_version_id, technical_version_id, dart_calls, error_message, updated_at";
const VERSION_SUMMARY_COLUMNS =
  "id, brownfield_target_id, category, version_no, run_id, provisional_score, proposed_count, unverified_count, evidence_grade, input_hash, created_by, created_at";

const isCategory = (c: unknown): c is EvalDraftCategory => (EVAL_DRAFT_CATEGORIES as readonly unknown[]).includes(c);
const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");

// ---------------------------------------------------------------------------------------------------------------
// Runs.
// ---------------------------------------------------------------------------------------------------------------

export interface CreateRunInput {
  opportunityId: string;
  categories: RunCategorySelection;
  /** Candidate ids in processing (longlist) order; `seq` follows this order and stays stable across resume. */
  targetIds: readonly string[];
  webEvidence: boolean;
  forceRefresh: boolean;
  startedBy: string;
  startedVia: string;
  now: string;
}

export function getRun(db: Database, runId: string): DraftRunRow | null {
  return (
    (db.query(`SELECT ${RUN_COLUMNS} FROM brownfield_eval_draft_run WHERE id = ?`).get(runId) as DraftRunRow | null) ??
    null
  );
}

export function getActiveRun(db: Database, opportunityId: string): DraftRunRow | null {
  return (
    (db
      .query(
        `SELECT ${RUN_COLUMNS} FROM brownfield_eval_draft_run WHERE opportunity_id = ? AND status IN (${placeholders(ACTIVE_RUN_STATUSES.length)})`,
      )
      .get(opportunityId, ...ACTIVE_RUN_STATUSES) as DraftRunRow | null) ?? null
  );
}

export function getLatestRun(db: Database, opportunityId: string): DraftRunRow | null {
  return (
    (db
      .query(
        `SELECT ${RUN_COLUMNS} FROM brownfield_eval_draft_run WHERE opportunity_id = ? ORDER BY started_at DESC, id DESC LIMIT 1`,
      )
      .get(opportunityId) as DraftRunRow | null) ?? null
  );
}

/**
 * Start a run, or return the active one (`reused: true`, the S1 alreadyRunning precedent). Inserts the header and one
 * `pending` item per candidate in a single transaction. Every target must belong to the opportunity.
 */
export function createRun(db: Database, input: CreateRunInput): { run: DraftRunRow; reused: boolean } {
  if (!(RUN_CATEGORY_SELECTIONS as readonly string[]).includes(input.categories)) {
    throw new EvalDraftError("invalid", `categories must be one of: ${RUN_CATEGORY_SELECTIONS.join(" | ")}.`);
  }
  if (!input.startedBy || !input.startedVia)
    throw new EvalDraftError("invalid", "startedBy and startedVia are required.");
  const ids = [...input.targetIds];
  if (new Set(ids).size !== ids.length) throw new EvalDraftError("invalid", "targetIds must not repeat.");

  return db.transaction(() => {
    const active = getActiveRun(db, input.opportunityId);
    if (active) return { run: active, reused: true };
    if (ids.length > 0) {
      const found = db
        .query(
          `SELECT COUNT(*) AS n FROM brownfield_target WHERE opportunity_id = ? AND id IN (${placeholders(ids.length)})`,
        )
        .get(input.opportunityId, ...ids) as { n: number };
      if (found.n !== ids.length)
        throw new EvalDraftError("not_found", "Every target must be a candidate of this opportunity.");
    }
    const runId = ulid();
    db.run(
      `INSERT INTO brownfield_eval_draft_run (id, opportunity_id, categories, web_evidence, force_refresh, status, total_targets,
         started_by, started_via, started_at, heartbeat_at) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
      [
        runId,
        input.opportunityId,
        input.categories,
        input.webEvidence ? 1 : 0,
        input.forceRefresh ? 1 : 0,
        ids.length,
        input.startedBy,
        input.startedVia,
        input.now,
        input.now,
      ],
    );
    const insertItem = db.prepare(
      `INSERT INTO brownfield_eval_draft_run_item (id, run_id, brownfield_target_id, seq, state, updated_at) VALUES (?, ?, ?, ?, 'pending', ?)`,
    );
    for (const [seq, targetId] of ids.entries()) insertItem.run(ulid(), runId, targetId, seq, input.now);
    return { run: getRun(db, runId) as DraftRunRow, reused: false };
  })();
}

/** Bump the run heartbeat (after every step). No-op for a run that is not `running`. */
export function touchRunHeartbeat(db: Database, runId: string, now: string): void {
  db.run("UPDATE brownfield_eval_draft_run SET heartbeat_at = ? WHERE id = ? AND status = 'running'", [now, runId]);
}

/**
 * Lazily mark this opportunity's `running` run `interrupted` when its heartbeat is stale (design §4 A2). Returns the
 * number of runs marked (0 or 1). Paused and terminal runs are untouched.
 */
export function markStaleRunInterrupted(db: Database, opportunityId: string, now: string): number {
  const run = getActiveRun(db, opportunityId);
  if (run?.status !== "running" || !isHeartbeatStale(run.heartbeat_at, now)) return 0;
  const res = db.run(
    "UPDATE brownfield_eval_draft_run SET status = 'interrupted', pause_reason = 'heartbeat_stale' WHERE id = ? AND status = 'running' AND heartbeat_at = ?",
    [run.id, run.heartbeat_at],
  );
  return res.changes;
}

/** `running` → `paused_budget` (budget reserve / DART 020). The in-flight item stays at its step. */
export function pauseRun(db: Database, runId: string, pauseReason: string, now: string): DraftRunRow {
  return transition(db, runId, ["running"], "paused_budget", { pause_reason: pauseReason, heartbeat_at: now });
}

/** `paused_budget` | `interrupted` → `running`, recording who resumed (A3). Options (web_evidence/force_refresh) are kept. */
export function resumeRun(db: Database, runId: string, resumedBy: string, now: string): DraftRunRow {
  if (!resumedBy) throw new EvalDraftError("invalid", "resumedBy is required.");
  return transition(db, runId, ["paused_budget", "interrupted"], "running", {
    resumed_by: resumedBy,
    pause_reason: null,
    heartbeat_at: now,
  });
}

/** Any active status → a terminal status. Already-written versions stay (§7). */
export function finishRun(
  db: Database,
  runId: string,
  status: "completed" | "cancelled" | "failed",
  now: string,
  errorMessage: string | null = null,
): DraftRunRow {
  return transition(db, runId, ACTIVE_RUN_STATUSES, status, {
    finished_at: now,
    heartbeat_at: now,
    error_message: errorMessage,
  });
}

function transition(
  db: Database,
  runId: string,
  from: readonly RunStatus[],
  to: RunStatus,
  set: Partial<Pick<DraftRunRow, "pause_reason" | "resumed_by" | "heartbeat_at" | "finished_at" | "error_message">>,
): DraftRunRow {
  const run = getRun(db, runId);
  if (!run) throw new EvalDraftError("not_found", `Run '${runId}' not found.`);
  if (!from.includes(run.status))
    throw new EvalDraftError("conflict", `Run '${runId}' is '${run.status}'; cannot move to '${to}'.`);
  const cols = Object.keys(set) as Array<keyof typeof set>;
  db.run(
    `UPDATE brownfield_eval_draft_run SET status = ?${cols.map((c) => `, ${c} = ?`).join("")} WHERE id = ? AND status = ?`,
    [to, ...cols.map((c) => set[c] ?? null), runId, run.status],
  );
  return getRun(db, runId) as DraftRunRow;
}

// ---------------------------------------------------------------------------------------------------------------
// Run items.
// ---------------------------------------------------------------------------------------------------------------

export function listRunItems(db: Database, runId: string): DraftRunItemRow[] {
  return db
    .query(`SELECT ${ITEM_COLUMNS} FROM brownfield_eval_draft_run_item WHERE run_id = ? ORDER BY seq`)
    .all(runId) as DraftRunItemRow[];
}

export function getRunItem(db: Database, itemId: string): DraftRunItemRow | null {
  return (
    (db
      .query(`SELECT ${ITEM_COLUMNS} FROM brownfield_eval_draft_run_item WHERE id = ?`)
      .get(itemId) as DraftRunItemRow | null) ?? null
  );
}

/** The most recent run item of a candidate across all runs (A8 `run_item`: `진행 중` / failed reason chip). */
export function getLatestRunItemForTarget(db: Database, targetId: string): DraftRunItemRow | null {
  return (
    (db
      .query(
        `SELECT ${ITEM_COLUMNS} FROM brownfield_eval_draft_run_item WHERE brownfield_target_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1`,
      )
      .get(targetId) as DraftRunItemRow | null) ?? null
  );
}

/** The resume point: the first item of the run whose state is not terminal, in `seq` order (§6.4). */
export function nextResumableItem(db: Database, runId: string): DraftRunItemRow | null {
  return (
    (db
      .query(
        `SELECT ${ITEM_COLUMNS} FROM brownfield_eval_draft_run_item
          WHERE run_id = ? AND state NOT IN (${placeholders(TERMINAL_ITEM_STATES.length)}) ORDER BY seq LIMIT 1`,
      )
      .get(runId, ...TERMINAL_ITEM_STATES) as DraftRunItemRow | null) ?? null
  );
}

export interface RunItemPatch {
  state?: RunItemState;
  financialOutcome?: CategoryOutcome | null;
  technicalOutcome?: CategoryOutcome | null;
  financialVersionId?: string | null;
  technicalVersionId?: string | null;
  /** Added to the item's dart_calls counter (budget telemetry, §6.1). */
  addDartCalls?: number;
  errorMessage?: string | null;
}

/** Advance a run item in place (checkpoint). `updated_at` always moves to `now`. */
export function updateRunItem(db: Database, itemId: string, patch: RunItemPatch, now: string): DraftRunItemRow {
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  const put = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(v);
  };
  if (patch.state !== undefined) put("state", patch.state);
  if (patch.financialOutcome !== undefined) put("financial_outcome", patch.financialOutcome);
  if (patch.technicalOutcome !== undefined) put("technical_outcome", patch.technicalOutcome);
  if (patch.financialVersionId !== undefined) put("financial_version_id", patch.financialVersionId);
  if (patch.technicalVersionId !== undefined) put("technical_version_id", patch.technicalVersionId);
  if (patch.errorMessage !== undefined) put("error_message", patch.errorMessage);
  if (patch.addDartCalls !== undefined) {
    if (!Number.isInteger(patch.addDartCalls) || patch.addDartCalls < 0)
      throw new EvalDraftError("invalid", "addDartCalls must be a non-negative integer.");
    sets.push("dart_calls = dart_calls + ?");
    args.push(patch.addDartCalls);
  }
  put("updated_at", now);
  const res = db.run(`UPDATE brownfield_eval_draft_run_item SET ${sets.join(", ")} WHERE id = ?`, [...args, itemId]);
  if (res.changes === 0) throw new EvalDraftError("not_found", `Run item '${itemId}' not found.`);
  return getRunItem(db, itemId) as DraftRunItemRow;
}

// ---------------------------------------------------------------------------------------------------------------
// Versions.
// ---------------------------------------------------------------------------------------------------------------

export function getVersion(db: Database, versionId: string): DraftVersionRow | null {
  return (
    (db
      .query(`SELECT ${VERSION_SUMMARY_COLUMNS}, payload FROM brownfield_eval_draft_version WHERE id = ?`)
      .get(versionId) as DraftVersionRow | null) ?? null
  );
}

export function getLatestVersion(db: Database, targetId: string, category: EvalDraftCategory): DraftVersionRow | null {
  return (
    (db
      .query(
        `SELECT ${VERSION_SUMMARY_COLUMNS}, payload FROM brownfield_eval_draft_version
          WHERE brownfield_target_id = ? AND category = ? ORDER BY version_no DESC LIMIT 1`,
      )
      .get(targetId, category) as DraftVersionRow | null) ?? null
  );
}

/** Versions newest first (`[0]` = latest, the S1 shape). Payload only when asked (comparison table). */
export function listVersions(
  db: Database,
  targetId: string,
  opts: { category?: EvalDraftCategory; limit?: number; includePayload?: boolean } = {},
): Array<DraftVersionSummaryRow | DraftVersionRow> {
  const cols = opts.includePayload ? `${VERSION_SUMMARY_COLUMNS}, payload` : VERSION_SUMMARY_COLUMNS;
  const where = opts.category ? "brownfield_target_id = ? AND category = ?" : "brownfield_target_id = ?";
  const args: Array<string | number> = opts.category ? [targetId, opts.category] : [targetId];
  const limit =
    opts.limit !== undefined && Number.isInteger(opts.limit) && opts.limit > 0 ? ` LIMIT ${opts.limit}` : "";
  return db
    .query(
      `SELECT ${cols} FROM brownfield_eval_draft_version WHERE ${where} ORDER BY category, version_no DESC${limit}`,
    )
    .all(...args) as Array<DraftVersionSummaryRow | DraftVersionRow>;
}

/** Verdict rows citing each version (`confirmed_count`, A5). Versions with no citing verdict map to 0. */
export function confirmedCountByVersion(db: Database, versionIds: readonly string[]): Map<string, number> {
  const out = new Map<string, number>(versionIds.map((id) => [id, 0]));
  if (versionIds.length === 0) return out;
  const rows = db
    .query(
      `SELECT confirmed_from_version_id AS id, COUNT(*) AS n FROM brownfield_target_eval_state
        WHERE confirmed_from_version_id IN (${placeholders(versionIds.length)}) GROUP BY confirmed_from_version_id`,
    )
    .all(...versionIds) as Array<{ id: string; n: number }>;
  for (const r of rows) out.set(r.id, r.n);
  return out;
}

/**
 * The latest version plus its `checked_at` (§3.3): the updated_at of the latest run item whose outcome for this
 * category is `versioned` or `unchanged` and that points at this version, falling back to the version's created_at.
 */
export function getLatestVersionWithCheckedAt(
  db: Database,
  targetId: string,
  category: EvalDraftCategory,
): (DraftVersionRow & { checked_at: string }) | null {
  const latest = getLatestVersion(db, targetId, category);
  if (!latest) return null;
  const outcomeCol = category === "financial" ? "financial_outcome" : "technical_outcome";
  const versionCol = category === "financial" ? "financial_version_id" : "technical_version_id";
  const row = db
    .query(
      `SELECT MAX(updated_at) AS at FROM brownfield_eval_draft_run_item
        WHERE brownfield_target_id = ? AND ${versionCol} = ? AND ${outcomeCol} IN ('versioned', 'unchanged')`,
    )
    .get(targetId, latest.id) as { at: string | null };
  return { ...latest, checked_at: row.at && row.at > latest.created_at ? row.at : latest.created_at };
}

/** What a finished category step produced. Counts and grade are the version's summary columns (§3.2/§3.4). */
export interface DraftVersionContent {
  payload: EvalDraftPayload;
  provisionalScore: number | null;
  proposedCount: number;
  unverifiedCount: number;
  evidenceGrade: EvidenceGrade;
}

export interface InsertDraftVersionInput extends DraftVersionContent {
  targetId: string;
  category: EvalDraftCategory;
  runId: string | null;
  inputHash: string;
  createdBy: string;
  now: string;
}

/** Validate a payload against schema v1 and the 64 KiB cap; returns the serialized text that will be stored. */
export function serializeDraftPayload(payload: unknown, category: EvalDraftCategory): string {
  const parsed = evalDraftPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new EvalDraftError(
      "invalid",
      `Draft payload does not match schema v1: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  }
  if (parsed.data.category !== category)
    throw new EvalDraftError("invalid", "Payload category does not match the version category.");
  const text = JSON.stringify(parsed.data);
  if (Buffer.byteLength(text, "utf8") > DRAFT_PAYLOAD_MAX_BYTES) {
    throw new EvalDraftError(
      "payload_too_large",
      `Draft payload exceeds ${DRAFT_PAYLOAD_MAX_BYTES} bytes; the item fails (never truncated).`,
    );
  }
  return text;
}

/**
 * Insert one immutable version with version_no = MAX + 1 for (candidate, category). Runs inside the caller's
 * transaction when there is one (bun:sqlite nests via savepoints). Throws before writing anything on invalid input.
 */
export function insertDraftVersion(db: Database, input: InsertDraftVersionInput): DraftVersionRow {
  if (!isCategory(input.category))
    throw new EvalDraftError("invalid", `category must be one of: ${EVAL_DRAFT_CATEGORIES.join(" | ")}.`);
  if (!(EVIDENCE_GRADES as readonly string[]).includes(input.evidenceGrade))
    throw new EvalDraftError("invalid", "Unknown evidence grade.");
  if (!input.inputHash) throw new EvalDraftError("invalid", "inputHash is required.");
  if (!input.createdBy) throw new EvalDraftError("invalid", "createdBy is required.");
  const payloadText = serializeDraftPayload(input.payload, input.category);
  return db.transaction(() => {
    const next = db
      .query(
        "SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM brownfield_eval_draft_version WHERE brownfield_target_id = ? AND category = ?",
      )
      .get(input.targetId, input.category) as { n: number };
    const id = ulid();
    db.run(
      `INSERT INTO brownfield_eval_draft_version (id, brownfield_target_id, category, version_no, run_id, provisional_score,
         proposed_count, unverified_count, evidence_grade, input_hash, payload, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.targetId,
        input.category,
        next.n,
        input.runId,
        input.provisionalScore,
        input.proposedCount,
        input.unverifiedCount,
        input.evidenceGrade,
        input.inputHash,
        payloadText,
        input.createdBy,
        input.now,
      ],
    );
    return getVersion(db, id) as DraftVersionRow;
  })();
}

export interface CommitCategoryDraftInput {
  itemId: string;
  category: EvalDraftCategory;
  inputHash: string;
  createdBy: string;
  now: string;
  /**
   * Runs the rubric / LLM and returns the version content. Called only when the inputs changed. If it throws, nothing
   * is written and the error propagates: the caller classifies it (failed vs paused, §6.3/§7) and records the item.
   */
  produce: () => DraftVersionContent | Promise<DraftVersionContent>;
}

export type CommitCategoryDraftResult =
  | { outcome: "unchanged"; version: DraftVersionRow }
  | { outcome: "versioned"; version: DraftVersionRow };

/**
 * One category step's success moment (§5 checkpointing, §3.3 unchanged rule, ADR-0199 decision 2):
 *   - input hash equal to the latest version's → outcome `unchanged`, item points at the existing version, no producer
 *     call, no new version;
 *   - otherwise the producer runs; on success the version insert and the item update commit together;
 *   - a throwing producer leaves the version table and the run item untouched (replace-on-success).
 */
export async function commitCategoryDraft(
  db: Database,
  input: CommitCategoryDraftInput,
): Promise<CommitCategoryDraftResult> {
  const item = getRunItem(db, input.itemId);
  if (!item) throw new EvalDraftError("not_found", `Run item '${input.itemId}' not found.`);
  if (!isCategory(input.category))
    throw new EvalDraftError("invalid", `category must be one of: ${EVAL_DRAFT_CATEGORIES.join(" | ")}.`);
  const outcomeKey = input.category === "financial" ? "financialOutcome" : "technicalOutcome";
  const versionKey = input.category === "financial" ? "financialVersionId" : "technicalVersionId";

  const latest = getLatestVersion(db, item.brownfield_target_id, input.category);
  if (latest && latest.input_hash === input.inputHash) {
    updateRunItem(db, item.id, { [outcomeKey]: "unchanged", [versionKey]: latest.id, errorMessage: null }, input.now);
    return { outcome: "unchanged", version: latest };
  }

  const content = await input.produce();
  const version = db.transaction(() => {
    const v = insertDraftVersion(db, {
      ...content,
      targetId: item.brownfield_target_id,
      category: input.category,
      runId: item.run_id,
      inputHash: input.inputHash,
      createdBy: input.createdBy,
      now: input.now,
    });
    updateRunItem(db, item.id, { [outcomeKey]: "versioned", [versionKey]: v.id, errorMessage: null }, input.now);
    return v;
  })();
  return { outcome: "versioned", version };
}
