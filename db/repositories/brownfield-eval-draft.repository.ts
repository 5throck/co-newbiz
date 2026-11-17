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
 *
 * Verdict origin (migration 0197, ADR-0200, spec 2026-11-17-s6-direct-ai-verdict §3/§4): `writeEvalVerdict` is the single
 * guarded write path for brownfield_target_eval_state rows that carry an origin (`verdict_source`):
 *   - a non-human write (`auto_rule` | `ai_draft`) never replaces a human, non-pending verdict — the guard is in the SQL
 *     WHERE clause, so a human save that lands between a read and the write wins (`human_verdict_locked`);
 *   - a non-human write may not set `na` / `waived` (`forbidden_status`, Q8): excluding a criterion is a judgement;
 *   - `auto_rule` always carries `source_version_id` (TA3 invariant; ALTER cannot express it as a CHECK);
 *   - `confirmed_from_version_id` (0194) is frozen: nothing here writes it.
 * `commitCategoryDraft` accepts an optional `apply` hook that runs in the SAME transaction as the version insert or the
 * `unchanged` decision and records its result in the run item's `apply_summary`.
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
  "skipped_active",
  "cancelled",
] as const;
export type RunItemState = (typeof RUN_ITEM_STATES)[number];
export const TERMINAL_ITEM_STATES: readonly RunItemState[] = [
  "done",
  "failed",
  "skipped_not_dart",
  "skipped_no_company",
  "skipped_llm_unconfigured",
  "skipped_active",
  "cancelled",
];
/** Item states that mean "an engine step is executing" (mid-item); `pending` is queued, the rest are terminal. */
export const STEP_ITEM_STATES: readonly RunItemState[] = ["financial_sync", "financial_draft", "technical_draft"];
/** Design 2026-11-17 section 10.6: pending items across an opportunity's active runs; a start that would exceed it is refused. */
export const MAX_QUEUED_ITEMS_PER_OPPORTUNITY = 200;

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
/** Fixed unverified-reason codes recorded per technical item (payload schema v1, additive). */
export const REASON_DETAIL_CODES = [
  "llm_omitted",
  "citation_unmatched",
  "citation_too_short",
  "ref_unknown",
  "no_citation",
  "evidence_unavailable",
] as const;
export type ReasonDetailCode = (typeof REASON_DETAIL_CODES)[number];

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
      /** Why an item stayed unverified (additive, optional): a fixed code, never free text. */
      reason_detail: z.enum(REASON_DETAIL_CODES).optional(),
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
    /** Technical drafts only (additive, optional): how many criteria the LLM answered / citations the engine rejected. */
    llm_drafts_returned: z.number().int().nonnegative().optional(),
    citations_rejected: z.number().int().nonnegative().optional(),
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
  /** Migration 0197 (ADR-0200): JSON `{ financial?: CategoryApplySummary, technical?: CategoryApplySummary }`. */
  apply_summary: string | null;
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
    readonly kind: "invalid" | "not_found" | "conflict" | "payload_too_large" | "queue_full",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EvalDraftError";
  }
}

const RUN_COLUMNS =
  "id, opportunity_id, categories, web_evidence, force_refresh, status, total_targets, started_by, started_via, resumed_by, started_at, heartbeat_at, finished_at, pause_reason, error_message";
const ITEM_COLUMNS =
  "id, run_id, brownfield_target_id, seq, state, financial_outcome, technical_outcome, financial_version_id, technical_version_id, dart_calls, error_message, updated_at, apply_summary";
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
  /**
   * Start-time classification of a candidate (design 2026-11-17 section 10.8): `not_dart` / `no_company` candidates get
   * their terminal skipped item at once and are reported in `skipped`. Omitted = every candidate is queued.
   */
  classify?: (targetId: string) => "ok" | "not_dart" | "no_company";
  /**
   * Called INSIDE the start transaction after the writes (not for a reused or empty start), so the decision-bearing write and
   * its audit rows commit or roll back together: a throwing callback rolls the whole start back.
   */
  onWrite?: (result: CreateRunResult & { run: DraftRunRow }) => void;
}

/** `pause_reason` marker of a `running` run whose cancel waits for its in-flight items (design section 10.5). */
export const CANCEL_REQUESTED = "cancel_requested";

export type StartSkipReason = "already_active" | "paused_run" | "taken_over" | "not_dart" | "no_company";
export interface CreateRunResult {
  /** `null` when nothing was enqueued (every candidate skipped): no run row and no audit rows are written. */
  run: DraftRunRow | null;
  reused: boolean;
  /** Items left `pending` (waiting for a worker slot). */
  queued: number;
  /** `run_id` is the paused or interrupted run that holds the candidate (reason `paused_run`) so the UI can offer resume or cancel. */
  skipped: Array<{ target_id: string; reason: StartSkipReason; run_id?: string }>;
  /** Bulk-queue items this (single) start took over; the bulk run's item is now `skipped_active`. */
  taken_over: Array<{ target_id: string; from_run_id: string }>;
}

export function getRun(db: Database, runId: string): DraftRunRow | null {
  return (
    (db.query(`SELECT ${RUN_COLUMNS} FROM brownfield_eval_draft_run WHERE id = ?`).get(runId) as DraftRunRow | null) ??
    null
  );
}

export function getActiveRunsForOpportunity(db: Database, opportunityId: string): DraftRunRow[] {
  return db
    .query(
      `SELECT ${RUN_COLUMNS} FROM brownfield_eval_draft_run WHERE opportunity_id = ? AND status IN (${placeholders(ACTIVE_RUN_STATUSES.length)}) ORDER BY started_at DESC, id DESC`,
    )
    .all(opportunityId, ...ACTIVE_RUN_STATUSES) as DraftRunRow[];
}

/** The newest active run, if any (legacy single-active-run reads). */
export function getActiveRun(db: Database, opportunityId: string): DraftRunRow | null {
  return getActiveRunsForOpportunity(db, opportunityId)[0] ?? null;
}

/**
 * The newest active run whose run items cover EXACTLY the given candidate set (start-reuse, A1): with per-candidate
 * engines in parallel, an active run over different candidates must not swallow a new start.
 */
export function getActiveRunForTargets(
  db: Database,
  opportunityId: string,
  targetIds: readonly string[],
): DraftRunRow | null {
  const want = [...targetIds].sort().join("\n");
  for (const run of getActiveRunsForOpportunity(db, opportunityId)) {
    if (run.pause_reason === CANCEL_REQUESTED) continue; // a run being cancelled is never reused
    const have = listRunItems(db, run.id)
      .map((i) => i.brownfield_target_id)
      .sort()
      .join("\n");
    if (have === want) return run;
  }
  return null;
}

export function getLatestRun(db: Database, opportunityId: string, targetId?: string): DraftRunRow | null {
  if (targetId === undefined) {
    return (
      (db
        .query(
          `SELECT ${RUN_COLUMNS} FROM brownfield_eval_draft_run WHERE opportunity_id = ? ORDER BY started_at DESC, id DESC LIMIT 1`,
        )
        .get(opportunityId) as DraftRunRow | null) ?? null
    );
  }
  // Latest run that has a run item for this candidate (A2 additive `target_id` query).
  return (
    (db
      .query(
        `SELECT ${RUN_COLUMNS} FROM brownfield_eval_draft_run
          WHERE opportunity_id = ? AND id IN (SELECT run_id FROM brownfield_eval_draft_run_item WHERE brownfield_target_id = ?)
          ORDER BY started_at DESC, id DESC LIMIT 1`,
      )
      .get(opportunityId, targetId) as DraftRunRow | null) ?? null
  );
}

/**
 * Pending items across the opportunity's `running` and `paused_budget` runs (the `queue_full` population, section 10.6).
 * An `interrupted` run is crash residue and does not hold the cap.
 */
export function countQueuedItems(db: Database, opportunityId: string): number {
  return (
    db
      .query(
        `SELECT COUNT(*) AS n FROM brownfield_eval_draft_run_item i JOIN brownfield_eval_draft_run r ON r.id = i.run_id
          WHERE r.opportunity_id = ? AND r.status IN ('running', 'paused_budget') AND i.state = 'pending'`,
      )
      .get(opportunityId) as { n: number }
  ).n;
}

interface OtherItem {
  item_id: string;
  run_id: string;
  state: RunItemState;
  total_targets: number;
  run_status: RunStatus;
}

/** Non-terminal items of the given candidates in the ACTIVE runs of the opportunity (the dedupe population, section 10.4). */
function nonTerminalItemsOf(db: Database, opportunityId: string, ids: readonly string[]): Map<string, OtherItem[]> {
  const out = new Map<string, OtherItem[]>();
  if (ids.length === 0) return out;
  const rows = db
    .query(
      `SELECT i.id AS item_id, i.run_id, i.brownfield_target_id AS target_id, i.state, r.total_targets, r.status AS run_status
         FROM brownfield_eval_draft_run_item i JOIN brownfield_eval_draft_run r ON r.id = i.run_id
        WHERE i.brownfield_target_id IN (${placeholders(ids.length)}) AND r.opportunity_id = ?
          AND r.status IN (${placeholders(ACTIVE_RUN_STATUSES.length)})
          AND i.state NOT IN (${placeholders(TERMINAL_ITEM_STATES.length)})`,
    )
    .all(...ids, opportunityId, ...ACTIVE_RUN_STATUSES, ...TERMINAL_ITEM_STATES) as Array<
    OtherItem & { target_id: string }
  >;
  for (const r of rows) out.set(r.target_id, [...(out.get(r.target_id) ?? []), r]);
  return out;
}

/**
 * Start a run, or return the active one (`reused: true`, the S1 alreadyRunning precedent). Inserts the header and one
 * item per candidate in a single transaction. Every target must belong to the opportunity. Queue rules (design
 * 2026-11-17 section 10): a candidate already evaluated in another active run becomes `skipped_active`; a SINGLE start
 * (one id) takes over a candidate that only waits in a BULK run (the bulk item becomes `skipped_active`, `taken_over_by`
 * in its error_message); more than MAX_QUEUED_ITEMS_PER_OPPORTUNITY pending items throw `queue_full`.
 */
export function createRun(db: Database, input: CreateRunInput): CreateRunResult {
  if (!(RUN_CATEGORY_SELECTIONS as readonly string[]).includes(input.categories)) {
    throw new EvalDraftError("invalid", `categories must be one of: ${RUN_CATEGORY_SELECTIONS.join(" | ")}.`);
  }
  if (!input.startedBy || !input.startedVia)
    throw new EvalDraftError("invalid", "startedBy and startedVia are required.");
  const ids = [...input.targetIds];
  if (new Set(ids).size !== ids.length) throw new EvalDraftError("invalid", "targetIds must not repeat.");

  return db.transaction((): CreateRunResult => {
    const active = getActiveRunForTargets(db, input.opportunityId, ids);
    if (active) {
      const queued = listRunItems(db, active.id).filter((i) => i.state === "pending").length;
      return { run: active, reused: true, queued, skipped: [], taken_over: [] };
    }
    if (ids.length > 0) {
      const found = db
        .query(
          `SELECT COUNT(*) AS n FROM brownfield_target WHERE opportunity_id = ? AND id IN (${placeholders(ids.length)})`,
        )
        .get(input.opportunityId, ...ids) as { n: number };
      if (found.n !== ids.length)
        throw new EvalDraftError("not_found", "Every target must be a candidate of this opportunity.");
    }
    const single = ids.length === 1;
    const elsewhere = nonTerminalItemsOf(db, input.opportunityId, ids);
    type Plan = { state: RunItemState; skip?: StartSkipReason; holder?: string; takeOver?: OtherItem[] };
    const plans = new Map<string, Plan>();
    for (const id of ids) {
      const others = elsewhere.get(id) ?? [];
      // Only runs that are actually `running` make a candidate "active"; paused and interrupted runs hold queued work.
      const live = others.filter((o) => o.run_status === "running");
      const running = live.some((o) => (STEP_ITEM_STATES as readonly string[]).includes(o.state));
      const queuedInSingle = live.some((o) => o.state === "pending" && o.total_targets === 1);
      if (single && others.length > 0 && !running && !queuedInSingle) {
        plans.set(id, { state: "pending", takeOver: others }); // single start over bulk-queued or paused/interrupted work
      } else if (live.length > 0) {
        plans.set(id, { state: "skipped_active", skip: "already_active" });
      } else if (others.length > 0) {
        plans.set(id, { state: "skipped_active", skip: "paused_run", holder: others[0].run_id });
      } else {
        const kind = input.classify?.(id) ?? "ok";
        plans.set(
          id,
          kind === "not_dart"
            ? { state: "skipped_not_dart", skip: "not_dart" }
            : kind === "no_company"
              ? { state: "skipped_no_company", skip: "no_company" }
              : { state: "pending" },
        );
      }
    }
    // The cap counts what this start would actually enqueue, not the candidates asked for.
    const pendingNew = [...plans.values()].filter((p) => p.state === "pending").length;
    if (pendingNew === 0) {
      const skipped = ids.flatMap((id) => {
        const p = plans.get(id) as Plan;
        return p.skip ? [{ target_id: id, reason: p.skip, ...(p.holder ? { run_id: p.holder } : {}) }] : [];
      });
      return { run: null, reused: false, queued: 0, skipped, taken_over: [] };
    }
    const already = countQueuedItems(db, input.opportunityId);
    // A take-over moves counted pending items out of the queue, so it nets out against the new pending item.
    const freed = [...plans.values()].reduce(
      (n, p) =>
        n +
        (p.takeOver ?? []).filter(
          (o) => o.state === "pending" && (o.run_status === "running" || o.run_status === "paused_budget"),
        ).length,
      0,
    );
    const queuedAfter = already - freed + pendingNew;
    if (queuedAfter > MAX_QUEUED_ITEMS_PER_OPPORTUNITY)
      throw new EvalDraftError(
        "queue_full",
        `The evaluation queue is full (${already} waiting, limit ${MAX_QUEUED_ITEMS_PER_OPPORTUNITY}).`,
        { queued: already, limit: MAX_QUEUED_ITEMS_PER_OPPORTUNITY },
      );
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
      `INSERT INTO brownfield_eval_draft_run_item (id, run_id, brownfield_target_id, seq, state, financial_outcome, technical_outcome, error_message, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const takeOver = db.prepare(
      `UPDATE brownfield_eval_draft_run_item SET state = 'skipped_active', error_message = ?, updated_at = ?
        WHERE id = ? AND state NOT IN (${placeholders(TERMINAL_ITEM_STATES.length)})`,
    );
    const wants = (cat: EvalDraftCategory) => input.categories === "both" || input.categories === cat;
    const skipped: CreateRunResult["skipped"] = [];
    const taken_over: CreateRunResult["taken_over"] = [];
    for (const [seq, targetId] of ids.entries()) {
      const plan = plans.get(targetId) as Plan;
      const terminalSkip = plan.state !== "pending";
      const outcome = (cat: EvalDraftCategory) =>
        terminalSkip && plan.state !== "skipped_active" && wants(cat) ? "skipped" : null;
      insertItem.run(
        ulid(),
        runId,
        targetId,
        seq,
        plan.state,
        outcome("financial"),
        outcome("technical"),
        plan.holder ? `paused_run:${plan.holder}` : null,
        input.now,
      );
      if (plan.skip)
        skipped.push({ target_id: targetId, reason: plan.skip, ...(plan.holder ? { run_id: plan.holder } : {}) });
      for (const o of plan.takeOver ?? []) {
        takeOver.run(`taken_over_by:${runId}`, input.now, o.item_id, ...TERMINAL_ITEM_STATES);
        taken_over.push({ target_id: targetId, from_run_id: o.run_id });
      }
    }
    const run = getRun(db, runId) as DraftRunRow;
    const result = { run, reused: false, queued: pendingNew, skipped, taken_over };
    input.onWrite?.(result);
    return result;
  })();
}

/** createRun for callers that know something will be enqueued (fixtures, tests): throws instead of returning `run: null`. */
export function createRunOrThrow(db: Database, input: CreateRunInput): CreateRunResult & { run: DraftRunRow } {
  const r = createRun(db, input);
  if (!r.run) throw new EvalDraftError("invalid", "Nothing to enqueue: every candidate was skipped.");
  return r as CreateRunResult & { run: DraftRunRow };
}

/** Run item states grouped for the progress panel (design section 10.8 `counts`). */
export interface RunItemCounts {
  done: number;
  running: number;
  queued: number;
  skipped: number;
  failed: number;
  cancelled: number;
  total: number;
}

export function summarizeRunItems(items: ReadonlyArray<{ state: RunItemState }>): RunItemCounts {
  const counts: RunItemCounts = {
    done: 0,
    running: 0,
    queued: 0,
    skipped: 0,
    failed: 0,
    cancelled: 0,
    total: items.length,
  };
  for (const { state } of items) {
    if (state === "done") counts.done++;
    else if (state === "pending") counts.queued++;
    else if ((STEP_ITEM_STATES as readonly string[]).includes(state)) counts.running++;
    else if (state === "failed") counts.failed++;
    else if (state === "cancelled") counts.cancelled++;
    else counts.skipped++;
  }
  return counts;
}

/** Run cancel (A4): every `pending` item becomes `cancelled`. Returns how many. In-flight items are untouched. */
export function cancelPendingItems(db: Database, runId: string, now: string): number {
  return db.run(
    "UPDATE brownfield_eval_draft_run_item SET state = 'cancelled', updated_at = ? WHERE run_id = ? AND state = 'pending'",
    [now, runId],
  ).changes;
}

/** Mark a `running` run as being cancelled (its in-flight items are still finishing); it is no longer reusable. */
export function markCancelRequested(db: Database, runId: string): void {
  db.run("UPDATE brownfield_eval_draft_run SET pause_reason = ? WHERE id = ? AND status = 'running'", [
    CANCEL_REQUESTED,
    runId,
  ]);
}

/**
 * Per-row cancel (A4b): only a `pending` item can be cancelled. Returns false when it is not pending. `onWrite` runs inside
 * the same transaction (audit): if it throws, the cancel rolls back.
 */
export function cancelQueuedItem(db: Database, itemId: string, now: string, onWrite?: () => void): boolean {
  return db.transaction((): boolean => {
    const changed =
      db.run(
        "UPDATE brownfield_eval_draft_run_item SET state = 'cancelled', updated_at = ? WHERE id = ? AND state = 'pending'",
        [now, itemId],
      ).changes === 1;
    if (changed) onWrite?.();
    return changed;
  })();
}

/** Bump the run heartbeat (after every step). No-op for a run that is not `running`. */
export function touchRunHeartbeat(db: Database, runId: string, now: string): void {
  db.run("UPDATE brownfield_eval_draft_run SET heartbeat_at = ? WHERE id = ? AND status = 'running'", [now, runId]);
}

/**
 * Lazily mark this opportunity's `running` runs `interrupted` (design section 10.5): only when the run is NOT registered
 * with the in-process dispatcher (`isRegistered`) AND its heartbeat is stale. A queued run waiting for a slot is
 * registered, so a long queue is never mistaken for a dead run. Returns the number of runs marked. Paused and terminal
 * runs are untouched.
 */
export function markStaleRunInterrupted(
  db: Database,
  opportunityId: string,
  now: string,
  isRegistered: (runId: string) => boolean,
): number {
  let marked = 0;
  for (const run of getActiveRunsForOpportunity(db, opportunityId)) {
    if (run.status !== "running" || isRegistered(run.id) || !isHeartbeatStale(run.heartbeat_at, now)) continue;
    marked += db.run(
      "UPDATE brownfield_eval_draft_run SET status = 'interrupted', pause_reason = 'heartbeat_stale' WHERE id = ? AND status = 'running' AND heartbeat_at = ?",
      [run.id, run.heartbeat_at],
    ).changes;
  }
  return marked;
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

/**
 * Human verdict rows citing each version (`confirmed_count`, A5). Since 0197 the link lives in `source_version_id`
 * (the 0194 `confirmed_from_version_id` is frozen); restricted to `human` rows so the ADR-0199 meaning is kept.
 * @deprecated ADR-0200: the A5 route moves to `verdictCountsByVersion` (`applied_count` / `reviewed_count`).
 */
export function confirmedCountByVersion(db: Database, versionIds: readonly string[]): Map<string, number> {
  const out = new Map<string, number>(versionIds.map((id) => [id, 0]));
  if (versionIds.length === 0) return out;
  const rows = db
    .query(
      `SELECT source_version_id AS id, COUNT(*) AS n FROM brownfield_target_eval_state
        WHERE source_version_id IN (${placeholders(versionIds.length)}) AND verdict_source = 'human'
        GROUP BY source_version_id`,
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
  /**
   * ADR-0200 direct apply (§4.2/§4.3): applies the version's proposals to brownfield_target_eval_state. Runs inside the
   * SAME transaction as the version insert (`versioned`) or the `unchanged` decision, against the version the item now
   * points at; its summary is stored under `apply_summary[category]` on the run item. A throwing hook rolls back the
   * version insert and the item update too (TA9). Omitted = no apply (the ADR-0199 behaviour).
   */
  apply?: (version: DraftVersionRow, outcome: "versioned" | "unchanged") => CategoryApplySummary;
}

export type CommitCategoryDraftResult =
  | { outcome: "unchanged"; version: DraftVersionRow; applySummary?: CategoryApplySummary }
  | { outcome: "versioned"; version: DraftVersionRow; applySummary?: CategoryApplySummary };

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
    // ADR-0200 §4.3: no version, no producer call — but the apply still runs against the latest version, atomically
    // with the `unchanged` decision (idempotent: rows already holding the proposals are rewritten identically).
    const applySummary = db.transaction(() => {
      updateRunItem(db, item.id, { [outcomeKey]: "unchanged", [versionKey]: latest.id, errorMessage: null }, input.now);
      return input.apply ? applyAndRecord(db, item.id, input, latest, "unchanged") : undefined;
    })();
    return applySummary
      ? { outcome: "unchanged", version: latest, applySummary }
      : { outcome: "unchanged", version: latest };
  }

  const content = await input.produce();
  const committed = db.transaction(() => {
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
    return { v, applySummary: input.apply ? applyAndRecord(db, item.id, input, v, "versioned") : undefined };
  })();
  return committed.applySummary
    ? { outcome: "versioned", version: committed.v, applySummary: committed.applySummary }
    : { outcome: "versioned", version: committed.v };
}

/** Run the apply hook and merge its summary into the run item's `apply_summary[category]` (inside the caller's tx). */
function applyAndRecord(
  db: Database,
  itemId: string,
  input: CommitCategoryDraftInput,
  version: DraftVersionRow,
  outcome: "versioned" | "unchanged",
): CategoryApplySummary {
  const summary = (input.apply as NonNullable<CommitCategoryDraftInput["apply"]>)(version, outcome);
  recordApplySummary(db, itemId, input.category, summary);
  return summary;
}

// ---------------------------------------------------------------------------------------------------------------
// Verdict origin and direct apply (migration 0197, ADR-0200, spec 2026-11-17-s6-direct-ai-verdict §3/§4/§5).
// ---------------------------------------------------------------------------------------------------------------

/** Closed vocabulary — byte-identical to the migration 0197 CHECK on brownfield_target_eval_state.verdict_source. */
export const VERDICT_SOURCES = ["human", "auto_rule", "ai_draft"] as const;
export type VerdictSource = (typeof VERDICT_SOURCES)[number];
export const NON_HUMAN_VERDICT_SOURCES: readonly VerdictSource[] = ["auto_rule", "ai_draft"];

export const VERDICT_STATUSES = ["pending", "pass", "partial", "fail", "na", "waived"] as const;
export type VerdictStatus = (typeof VERDICT_STATUSES)[number];
/** Excluding a criterion changes the score denominator — a judgement, never a finding (Q8). Human only. */
export const HUMAN_ONLY_VERDICT_STATUSES: readonly VerdictStatus[] = ["na", "waived"];

/** The origin a draft version's category writes when applied (§4.1): deterministic rubric vs LLM. */
export function verdictSourceForCategory(category: EvalDraftCategory): Exclude<VerdictSource, "human"> {
  return category === "financial" ? "auto_rule" : "ai_draft";
}

/** Why an apply skipped an item without writing (§4.2). */
export type ApplySkipReason = "criterion_retired" | "criterion_changed";

/** Per-category apply counts (§4.2, stored under `apply_summary[category]`). */
export interface CategoryApplySummary {
  /** Proposals written (new verdict, or a non-human verdict replaced). */
  applied: number;
  /** Items left alone because a person already judged them. */
  kept_human: number;
  /** `확인 안됨` proposals on pending/missing rows: nothing written. */
  unverified: number;
  /** Non-human verdicts reset to pending because the latest evidence could not verify them (Q2). */
  cleared: number;
  skipped: Array<{ criterion_id: string; reason: ApplySkipReason }>;
}

export interface EvalVerdictRow {
  id: string;
  brownfield_target_id: string;
  criterion_id: string;
  status: VerdictStatus;
  note: string | null;
  evidence_ref: string | null;
  assessed_by: string;
  assessed_at: string;
  verdict_source: VerdictSource;
  source_version_id: string | null;
}

const VERDICT_COLUMNS =
  "id, brownfield_target_id, criterion_id, status, note, evidence_ref, assessed_by, assessed_at, verdict_source, source_version_id";

export function getEvalVerdict(db: Database, targetId: string, criterionId: string): EvalVerdictRow | null {
  return (
    (db
      .query(
        `SELECT ${VERDICT_COLUMNS} FROM brownfield_target_eval_state WHERE brownfield_target_id = ? AND criterion_id = ?`,
      )
      .get(targetId, criterionId) as EvalVerdictRow | null) ?? null
  );
}

/** "Human-judged" means `verdict_source = 'human'` on a non-pending row and nothing else (§3.2, G2). */
export function isHumanJudged(state: { status: string; verdict_source?: string | null } | null | undefined): boolean {
  return !!state && state.status !== "pending" && (state.verdict_source ?? "human") === "human";
}

/** An unreviewed verdict: non-pending and not human (§3.2). A missing origin reads as the column default `human`. */
export function isUnreviewedVerdict(
  state: { status: string; verdict_source?: string | null } | null | undefined,
): boolean {
  return !!state && state.status !== "pending" && (state.verdict_source ?? "human") !== "human";
}

/** The engine's eligible set (§4.3): no row, a pending row, or a non-human verdict. Replaces "pending" in the engine. */
export function isEligibleForDraft(
  state: { status: string; verdict_source?: string | null } | null | undefined,
): boolean {
  return !isHumanJudged(state);
}

export interface WriteEvalVerdictInput {
  targetId: string;
  criterionId: string;
  status: VerdictStatus;
  note: string | null;
  evidenceRef: string | null;
  /** The accountable person: the human saver, the run actor, or the delegating user of an MCP/agent call (§3.2). */
  assessedBy: string;
  /** Derived server-side from the caller (human UI session) or the engine category — never from a request body. */
  source: VerdictSource;
  /** The version the verdict rests on; null = no version basis. Required (non-null) for `auto_rule` (TA3). */
  sourceVersionId: string | null;
  now: string;
  /**
   * Optimistic guard: the write lands only while the stored row still has this origin (a row that became `human` in the
   * meantime is refused as `human_verdict_locked`, never overwritten). Used by the human accept-rule bulk action.
   */
  expectSource?: VerdictSource;
}

export type WriteEvalVerdictResult =
  | {
      ok: true;
      row: EvalVerdictRow;
      /** The row before this write (null = no row existed) — feeds the `.ai_verdict.review` audit (`from`, `changed`). */
      previous: EvalVerdictRow | null;
    }
  | { ok: false; reason: "human_verdict_locked"; current: EvalVerdictRow }
  | { ok: false; reason: "forbidden_status"; status: VerdictStatus };

/**
 * The single guarded write of an item verdict with its origin (§4.1/§4.2):
 *   - `human` writes always land (a person may revise a person, and a person's save of an AI verdict makes it `human`
 *     even with the same status — G5);
 *   - non-human writes return `forbidden_status` for `na`/`waived` and `human_verdict_locked` over a human non-pending
 *     verdict. The lock is repeated in the UPDATE's WHERE clause so a refactor that splits the read cannot break it;
 *   - `auto_rule` without a `sourceVersionId` throws (programming error, TA3 invariant).
 * Never writes `confirmed_from_version_id` (frozen 0194 column). Runs inside the caller's transaction when there is one.
 */
export function writeEvalVerdict(db: Database, input: WriteEvalVerdictInput): WriteEvalVerdictResult {
  if (!(VERDICT_SOURCES as readonly string[]).includes(input.source))
    throw new EvalDraftError("invalid", `verdict source must be one of: ${VERDICT_SOURCES.join(" | ")}.`);
  if (!(VERDICT_STATUSES as readonly string[]).includes(input.status))
    throw new EvalDraftError("invalid", `status must be one of: ${VERDICT_STATUSES.join(" | ")}.`);
  if (!input.assessedBy) throw new EvalDraftError("invalid", "assessedBy is required.");
  if (input.source === "auto_rule" && !input.sourceVersionId)
    throw new EvalDraftError("invalid", "an auto_rule verdict must rest on a draft version (source_version_id).");
  const human = input.source === "human";
  if (!human && HUMAN_ONLY_VERDICT_STATUSES.includes(input.status))
    return { ok: false, reason: "forbidden_status", status: input.status };

  return db.transaction((): WriteEvalVerdictResult => {
    const previous = getEvalVerdict(db, input.targetId, input.criterionId);
    const values = [
      input.status,
      input.note,
      input.evidenceRef,
      input.assessedBy,
      input.now,
      input.source,
      input.sourceVersionId,
    ];
    if (previous) {
      const res = db.run(
        `UPDATE brownfield_target_eval_state
            SET status = ?, note = ?, evidence_ref = ?, assessed_by = ?, assessed_at = ?, verdict_source = ?, source_version_id = ?
          WHERE brownfield_target_id = ? AND criterion_id = ?
            AND (? = 'human' OR status = 'pending' OR verdict_source <> 'human')
            AND (? IS NULL OR verdict_source = ?)`,
        [
          ...values,
          input.targetId,
          input.criterionId,
          input.source,
          input.expectSource ?? null,
          input.expectSource ?? null,
        ],
      );
      if (res.changes === 0) return { ok: false, reason: "human_verdict_locked", current: previous };
    } else {
      db.run(
        `INSERT INTO brownfield_target_eval_state
           (id, brownfield_target_id, criterion_id, status, note, evidence_ref, assessed_by, assessed_at, verdict_source, source_version_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ulid(), input.targetId, input.criterionId, ...values],
      );
    }
    return { ok: true, row: getEvalVerdict(db, input.targetId, input.criterionId) as EvalVerdictRow, previous };
  })();
}

/** Merge one category's summary into `apply_summary` on the run item (read-modify-write; caller's transaction). */
export function recordApplySummary(
  db: Database,
  itemId: string,
  category: EvalDraftCategory,
  summary: CategoryApplySummary,
): void {
  const row = db.query("SELECT apply_summary FROM brownfield_eval_draft_run_item WHERE id = ?").get(itemId) as {
    apply_summary: string | null;
  } | null;
  if (!row) throw new EvalDraftError("not_found", `Run item '${itemId}' not found.`);
  const doc = parseApplySummary(row.apply_summary);
  doc[category] = summary;
  db.run("UPDATE brownfield_eval_draft_run_item SET apply_summary = ? WHERE id = ?", [JSON.stringify(doc), itemId]);
}

/** Parse a stored `apply_summary`; anything unreadable reads as empty (it is operational telemetry, not attribution). */
export function parseApplySummary(text: string | null): Partial<Record<EvalDraftCategory, CategoryApplySummary>> {
  if (!text) return {};
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Partial<Record<EvalDraftCategory, CategoryApplySummary>>)
      : {};
  } catch {
    return {};
  }
}

export interface UnreviewedVerdictCounts {
  financial: number;
  technical: number;
  total: number;
  /** Split for the `자동 규칙 {a}건 · AI {b}건` tooltip. */
  auto_rule: number;
  ai_draft: number;
}

/**
 * Unreviewed (non-pending, non-human) verdicts of one candidate on live criteria (§5.2 promote warning, longlist marker,
 * committee brief). Served by the partial index idx_bf_target_eval_state_unreviewed. Deleted/retired criteria are not
 * counted — they are not part of the score either.
 */
export function countUnreviewedVerdicts(db: Database, targetId: string): UnreviewedVerdictCounts {
  const rows = db
    .query(
      `SELECT c.category AS category, s.verdict_source AS source, COUNT(*) AS n
         FROM brownfield_target_eval_state s
         JOIN brownfield_eval_criterion c ON c.id = s.criterion_id
        WHERE s.brownfield_target_id = ? AND s.verdict_source <> 'human' AND s.status <> 'pending'
          AND c.deleted_at IS NULL AND c.retired_at IS NULL
        GROUP BY c.category, s.verdict_source`,
    )
    .all(targetId) as Array<{ category: EvalDraftCategory; source: Exclude<VerdictSource, "human">; n: number }>;
  const out: UnreviewedVerdictCounts = { financial: 0, technical: 0, total: 0, auto_rule: 0, ai_draft: 0 };
  for (const r of rows) {
    out[r.category] += r.n;
    out[r.source] += r.n;
    out.total += r.n;
  }
  return out;
}

/**
 * A5 version history counts from `source_version_id` (§8): `applied` = non-human verdicts resting on the version,
 * `reviewed` = human verdicts resting on it. Pending rows are not counted. Versions with no verdicts map to zeros.
 */
export function verdictCountsByVersion(
  db: Database,
  versionIds: readonly string[],
): Map<string, { applied: number; reviewed: number }> {
  const out = new Map<string, { applied: number; reviewed: number }>(
    versionIds.map((id) => [id, { applied: 0, reviewed: 0 }]),
  );
  if (versionIds.length === 0) return out;
  const rows = db
    .query(
      `SELECT source_version_id AS id, SUM(CASE WHEN verdict_source = 'human' THEN 0 ELSE 1 END) AS applied,
              SUM(CASE WHEN verdict_source = 'human' THEN 1 ELSE 0 END) AS reviewed
         FROM brownfield_target_eval_state
        WHERE source_version_id IN (${placeholders(versionIds.length)}) AND status <> 'pending'
        GROUP BY source_version_id`,
    )
    .all(...versionIds) as Array<{ id: string; applied: number; reviewed: number }>;
  for (const r of rows) out.set(r.id, { applied: r.applied, reviewed: r.reviewed });
  return out;
}
