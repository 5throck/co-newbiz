// @version 1.2.0
// 1.2.0: registry reconciliation (dba 2026-11-02 adjudication + owner adoption; PM follow-up
// before P7). The allow-list gains llm_call_log (12 mo archive-then-delete/created_at - the volume
// table) and every entry now carries the registry's RetentionHandling (db/lib/retention-registry.ts)
// instead of the old defaultAction: the action_mismatch guard compares the policy row's STORED
// action against handlingToStoredAction(entry.handling) - the SAME mapping the seeder and the admin
// route use - so a registry-created or seeded row always passes (the stored 'delete' of an
// archive_then_delete table is understood as archive-then-delete at runtime). Runtime behavior is
// pinned by handling: archive_then_delete archives then deletes, delete_only plain-deletes,
// archive_only archives and never deletes. The allow-list set is table-for-table identical to the
// registry's RETENTION_ELIGIBLE_TABLES (both sides fail a test if they drift).
// 1.1.0: dba adjudication of the P6 allow-list (2026-11-02): session confirmed IN with 1-month
// delete-on-expires_at (12h TTL table; the proposed 12 months was wrong-sized), policy action now
// pinned to the entry's dba-declared defaultAction (action_mismatch fail-loud guard against the
// registry stored-action vocabulary collision), and archive month files are written via temp-file
// + atomic rename (torn-gzip crash window closed).
// 1.0.0: ADR-0189 phase P6 — retention.cleanup executor (design 2026-10-29-scheduled-jobs-design
// sections 3.1, 3.3, 8-P6, 10-D2/D6, 9). Allow-list in code, audit_log hard refusal, archive
// before delete into db/archive/<table>/<yyyy-mm>.jsonl.gz (D6), deterministic cutoff by the
// declared basis column, batches of <= 1,000 rows (design section 11), dry-run mode, idempotent rerun.
/**
 * retention.cleanup - the retention policy executor (ADR-0189 P6, scheduled-jobs design 3.3).
 *
 * Guardrails (design 3.3 - binding):
 *  - Touches ONLY tables in RETENTION_ALLOW_LIST below (code-level allow-list; the D2-derived
 *    seed list - the dba edits this constant when the final list is confirmed). The policy row's
 *    basis column must equal the entry's declared basis (verified to exist in the actual table
 *    via PRAGMA at run time); any other mismatch is an error condition.
 *  - `audit_log` is NEVER eligible (ADR-0012, FR-SEC-07) regardless of any retention_policy row.
 *    A policy row naming audit_log (or ANY table not in the allow-list) fails the run with a
 *    structural, scrubbed error listing the offending rows - it is never silently skipped.
 *  - Action semantics are pinned to the dba-declared entry's handling (dba review 2026-11-02,
 *    reconciled with the registry 2026-11-02): a policy row whose STORED action differs from
 *    handlingToStoredAction(entry.handling) fails the run (action_mismatch). The stored action and
 *    the runtime behavior are two vocabularies over the same handling - the seeder and the admin
 *    route derive the stored action from the SAME registry function, so a registry-created or
 *    seeded row always passes this guard; runtime behavior (archive-then-delete vs plain delete)
 *    is pinned by entry.handling, never read from the stored action.
 *  - archive_then_delete handling archives qualifying rows FIRST (gzip'd JSONL, one file per row's
 *    basis month), verifies the file reads back with every row present, THEN batch-deletes.
 *    delete_only handling plain-deletes without archiving; archive_only handling archives and
 *    never deletes (raw_payload lineage).
 *  - Deterministic cutoff: now - retention_months (UTC calendar months, db/lib/retention-registry.ts
 *    retentionCutoff) against the entry's declared basis column.
 *  - Batches of RETENTION_BATCH rows per statement (design section 11: <= 1,000); progress per
 *    batch is accumulated into the run's counters; ctx.signal is honoured between batches.
 *  - Rerun is a no-op: the cutoff moves forward, already-deleted rows are gone, and archive
 *    dedupe by primary key means an archived-but-not-yet-deleted row (crash between archive and
 *    delete) is not written twice.
 *  - raw_payload note (data-architect follow-up): no ingest path writes raw_payload today, so its
 *    policy row governs an empty table - zero qualifying rows is a successful no-op, not an error.
 *
 * Archive idempotency choice (documented per design review): dedupe by PRIMARY KEY within the
 * month file - before appending, the existing file (if any) is gunzipped and its PK set loaded
 * (cached per table+month for the run); only rows whose PK is absent are appended and the file is
 * rewritten as existing-lines + new-lines. Chosen over "write only rows not already present" via
 * append because a gzip stream cannot be appended to safely: rewrite-with-dedupe is crash-safe on
 * rerun and keeps one canonical file per month.
 *
 * Each archive line is the FULL row object with an `_archived_at` envelope key added at top level
 * (the row itself is not nested, so PK extraction from a line is direct).
 *
 * Invocation:
 *   Scheduled / CLI:  CO_NEWBIZ_SCHEDULER_ENV=dev bun scripts/co-newbiz/run-job.ts --job retention.cleanup
 *   Dry-run (mandatory before the first destructive prod run, design 8-P6 gate):
 *     RETENTION_DRY_RUN=1 CO_NEWBIZ_SCHEDULER_ENV=prod bun scripts/co-newbiz/run-job.ts --job retention.cleanup
 *     (run-job passes no flags; the handler reads RETENTION_DRY_RUN=1 from the environment.
 *     Dry-run computes everything, writes NOTHING - no archive file, no DELETE, no last_run_at -
 *     and reports per-table planned counts and the archive paths it WOULD write in detail_json.)
 *   Library: runRetention(db, { now, dryRun, batchSize, archiveDir, signal }) - the direct export
 *     for the admin API/tests; RETENTION_BATCH_SIZE and RETENTION_ARCHIVE_DIR override the
 *     handler's batch size and archive destination (tests).
 */

import type { Database } from "bun:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DB_DIR } from "../../../db/client.ts";
import {
  handlingToStoredAction,
  retentionCutoff,
  type RetentionAction,
  type RetentionHandling,
} from "../../../db/lib/retention-registry.ts";
import type { JobHandler } from "./types.ts";

/** Design section 11: batches of at most 1,000 rows per DELETE statement. */
export const RETENTION_BATCH = 1_000;

/**
 * execution_job status CHECK (db/migrations/0117_execution_job.sql): queued|running|succeeded|
 * failed|cancelled. Terminal = succeeded|failed|cancelled (the task brief's "completed" example
 * does not exist in the CHECK set - the actual terminal statuses are encoded here).
 */
export const EXECUTION_JOB_TERMINAL_STATUSES = ["succeeded", "failed", "cancelled"] as const;

export interface RetentionAllowEntry {
  /** table name (SQL identifier comes from this constant only, never from policy data) */
  table: string;
  /** primary key column used for archive dedupe and batch deletes */
  pk: string;
  /** the declared basis column; a policy row's basis must match it (design 3.3 deterministic cutoff) */
  basis: string;
  /** D2 default (owner decision 2026-10-29) or dba ruling 2026-11-02 - recorded so policy rows and defaults agree */
  defaultMonths: number;
  /**
   * The registry handling (db/lib/retention-registry.ts) - the operative per-table contract,
   * mirrored table-for-table from RETENTION_ELIGIBLE_TABLES. Runtime behavior: archive_then_delete
   * archives then deletes; delete_only plain-deletes; archive_only archives and never deletes.
   * The stored action a policy row must carry is handlingToStoredAction(handling) - the SAME
   * function the seeder and the admin route use, which is why a registry-created row can never
   * trip the action_mismatch guard.
   */
  handling: RetentionHandling;
  /** delete only rows whose status is terminal (execution_job) */
  terminalOnly?: boolean;
}

/**
 * The executor's allow-list (design 3.3: "touches only tables present in an allow-list in code -
 * final list from dba"). CONFIRMED by dba review 2026-11-02 and reconciled with the registry
 * (db/lib/retention-registry.ts) table-for-table: job_run/notification/raw_payload/execution_job
 * carry D2's values (owner decision 2026-10-29); `session` is IN per the dba ruling with
 * basis=expires_at and a 1-MONTH default (session TTL is 12 HOURS, db/lib/accounts.ts
 * SESSION_HOURS, so a session expired >= 1 month is dead beyond any operational or forensic need -
 * token_hash is a non-replayable SHA-256; expires_at is the right age semantic: a live session can
 * never match, whatever its created_at); `llm_call_log` is IN per the dba recommendation adopted by
 * the owner (the volume table - 12 months archive-then-delete on created_at).
 */
export const RETENTION_ALLOW_LIST: readonly RetentionAllowEntry[] = [
  { table: "job_run", pk: "id", basis: "started_at", defaultMonths: 12, handling: "delete_only" },
  { table: "notification", pk: "id", basis: "sent_at", defaultMonths: 12, handling: "archive_then_delete" },
  { table: "llm_call_log", pk: "id", basis: "created_at", defaultMonths: 12, handling: "archive_then_delete" },
  { table: "raw_payload", pk: "id", basis: "fetched_at", defaultMonths: 24, handling: "archive_only" },
  {
    table: "execution_job",
    pk: "id",
    basis: "created_at",
    defaultMonths: 6,
    handling: "delete_only",
    terminalOnly: true,
  },
  { table: "session", pk: "id", basis: "expires_at", defaultMonths: 1, handling: "delete_only" },
];

const BY_TABLE = new Map(RETENTION_ALLOW_LIST.map((e) => [e.table, e]));

export interface RetentionPolicyIssue {
  table_key: string;
  basis: string | null;
  action: string | null;
  retention_months: number | null;
  code:
    | "table_not_allowed"
    | "basis_mismatch"
    | "action_mismatch"
    | "column_missing"
    | "table_missing"
    | "invalid_months"
    | "invalid_action";
  message: string;
}

/** Structural error: a policy row violates the allow-list / basis rules. Fails the run (never a silent skip). */
export class RetentionPolicyError extends Error {
  issues: RetentionPolicyIssue[];
  constructor(issues: RetentionPolicyIssue[]) {
    // Message carries only structural fields (table/basis/action/months) - no row data - so the
    // scrubbed, truncated job_run.error stays structural.
    super(`retention policy rows violate the executor allow-list: ${JSON.stringify(issues)}`);
    this.name = "RetentionPolicyError";
    this.issues = issues;
  }
}

export interface RetentionTableReport {
  table: string;
  basis: string;
  /** the stored action of the policy row that drove this table (vocabulary: handlingToStoredAction) */
  action: RetentionAction;
  /** the operative per-table contract (archive_then_delete | archive_only | delete_only) */
  handling: RetentionHandling;
  retention_months: number;
  cutoff: string;
  /** rows under the cutoff (dry-run: planned; real run: actually processed) */
  rows_to_archive: number;
  rows_deleted: number;
  /** archive files written (real run) or that WOULD be written (dry-run) */
  archive_files: string[];
  batches: number;
  /** no qualifying rows (e.g. raw_payload - nothing written by any ingest path today) */
  noop: boolean;
}

export interface RetentionRunResult {
  dry_run: boolean;
  tables: RetentionTableReport[];
  rows_archived: number;
  rows_deleted: number;
}

export interface RunRetentionOptions {
  now: Date;
  dryRun?: boolean;
  /** rows per DELETE/archived batch (default 1,000; tests inject a small value to exercise the loop) */
  batchSize?: number;
  /** archive destination (default <repo>/db/archive per D6) */
  archiveDir?: string;
  /** honoured between batches (handler timeout) */
  signal?: AbortSignal;
}

interface LoadedArchive {
  pks: Set<string>;
  lines: string[];
}

/** The scheduler's DB handle. Typed as bun:sqlite's Database (new code must not use `any`;
 * callers that hold a looser handle from db/client.ts getDb() still pass - it is typed `any`). */
type Db = Database;

function tableColumns(db: Db, table: string): Set<string> {
  // table is a code-constant identifier (allow-list only) - never policy input.
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function monthOf(iso: string): string {
  const m = /^(\d{4}-\d{2})/.exec(String(iso));
  if (!m) throw new Error(`retention: basis value '${String(iso).slice(0, 32)}' is not an ISO timestamp`);
  return m[1];
}

function archivePathFor(archiveDir: string, table: string, month: string): string {
  return join(archiveDir, table, `${month}.jsonl.gz`);
}

function readArchiveFile(path: string, pk: string): LoadedArchive {
  if (!existsSync(path)) return { pks: new Set(), lines: [] };
  const text = gunzipSync(readFileSync(path)).toString("utf8");
  const pks = new Set<string>();
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    lines.push(line);
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj[pk] !== undefined) pks.add(String(obj[pk]));
    } catch {
      // a torn line cannot happen (whole-file rewrite is atomic per batch); treat as unparseable noise
    }
  }
  return { pks, lines };
}

function writeArchiveFile(path: string, loaded: LoadedArchive): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const body = loaded.lines.length ? `${loaded.lines.join("\n")}\n` : "";
  // Atomic replace (dba review 2026-11-02): a direct writeFileSync of the gzip could be torn by a
  // crash mid-write, and the month file holds rows that verifyArchiveFile may already have let be
  // deleted - a corrupt canonical file would then be permanent lineage loss AND would brick every
  // rerun (gunzipSync throws). Write to a sibling temp file, then rename (atomic on POSIX).
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, gzipSync(Buffer.from(body, "utf8")));
  renameSync(tmp, path);
}

/** Verify the file reads back and every new PK is present - BEFORE any rows are deleted. */
function verifyArchiveFile(path: string, pk: string, newPks: string[]): void {
  const re = readArchiveFile(path, pk);
  const missing = newPks.filter((id) => !re.pks.has(id));
  if (missing.length > 0) {
    throw new Error(`retention archive verification failed for ${path}: ${missing.length} row(s) missing after write`);
  }
}

/**
 * Run the retention executor against one policy row. Behavior is pinned by the entry's handling
 * (NOT by the stored action - see the registry vocabulary note): archive_then_delete archives with
 * PK dedupe, verifies the archive, then deletes; delete_only plain-deletes; archive_only archives
 * and never deletes. All under the caller's db.
 */
function processTable(
  db: Db,
  entry: RetentionAllowEntry,
  months: number,
  opts: Required<Pick<RunRetentionOptions, "now" | "batchSize" | "archiveDir">> & {
    dryRun: boolean;
    signal?: AbortSignal;
  },
): RetentionTableReport {
  const cutoff = retentionCutoff(months, opts.now);
  const pk = entry.pk;
  const basis = entry.basis;
  const handling = entry.handling;
  const action = handlingToStoredAction(handling); // report/descriptive only
  const deletes = handling !== "archive_only";
  const archivesFirst = handling !== "delete_only";
  const statusFilter = entry.terminalOnly
    ? ` AND status IN (${EXECUTION_JOB_TERMINAL_STATUSES.map((s) => `'${s}'`).join(",")})`
    : "";
  const where = `${basis} < ?${statusFilter}`;

  const count = (db.query(`SELECT COUNT(*) AS n FROM ${entry.table} WHERE ${where}`).get(cutoff) as { n: number }).n;
  const report: RetentionTableReport = {
    table: entry.table,
    basis,
    action,
    handling,
    retention_months: months,
    cutoff,
    rows_to_archive: 0,
    rows_deleted: 0,
    archive_files: [],
    batches: 0,
    noop: count === 0,
  };
  if (count === 0) return report;

  if (opts.dryRun) {
    // planned counts: in dry-run rows_to_archive/rows_deleted are what WOULD happen (nothing is written)
    report.rows_to_archive = archivesFirst ? count : 0;
    report.rows_deleted = deletes ? count : 0;
    if (archivesFirst) {
      const monthsSeen = db
        .query(`SELECT DISTINCT substr(${basis}, 1, 7) AS m FROM ${entry.table} WHERE ${where} ORDER BY m`)
        .all(cutoff) as Array<{ m: string }>;
      report.archive_files = monthsSeen.map((r) => archivePathFor(opts.archiveDir, entry.table, r.m));
    }
    return report;
  }

  // dedupe state per month file, loaded once per run (archive idempotency: PK dedupe within the file)
  const archiveCache = new Map<string, LoadedArchive>();

  // Loop until under the cutoff - one batch of RETENTION_BATCH rows per statement. For deleting
  // handlings the DELETE itself advances the scan; archive_only never deletes, so it paginates by
  // OFFSET instead (rows stay, the offset advances).
  let offset = 0;
  for (;;) {
    if (opts.signal?.aborted) throw new Error("retention: aborted before batch");
    const sql = deletes
      ? `SELECT * FROM ${entry.table} WHERE ${where} ORDER BY ${basis} LIMIT ${opts.batchSize}`
      : `SELECT * FROM ${entry.table} WHERE ${where} ORDER BY ${basis} LIMIT ${opts.batchSize} OFFSET ${offset}`;
    const batch = db.query(sql).all(cutoff) as Array<Record<string, unknown>>;
    if (batch.length === 0) break;
    if (!deletes) offset += batch.length;
    report.batches += 1;

    if (archivesFirst) {
      const byMonth = new Map<string, Array<Record<string, unknown>>>();
      for (const row of batch) {
        const month = monthOf(row[basis] as string);
        const list = byMonth.get(month) ?? [];
        list.push(row);
        byMonth.set(month, list);
      }
      const archivedIds: string[] = [];
      for (const [month, rows] of byMonth) {
        const path = archivePathFor(opts.archiveDir, entry.table, month);
        let loaded = archiveCache.get(month);
        if (!loaded) {
          loaded = readArchiveFile(path, pk);
          archiveCache.set(month, loaded);
        }
        const newIds: string[] = [];
        for (const row of rows) {
          const id = String(row[pk]);
          if (!loaded.pks.has(id)) {
            loaded.pks.add(id);
            loaded.lines.push(JSON.stringify({ ...row, _archived_at: opts.now.toISOString() }));
            newIds.push(id);
          }
          archivedIds.push(id);
        }
        if (newIds.length > 0) {
          writeArchiveFile(path, loaded);
          verifyArchiveFile(path, pk, newIds);
          if (!report.archive_files.includes(path)) report.archive_files.push(path);
        }
        report.rows_to_archive += rows.length;
      }
      // delete only after the archive verified - and only for archive_then_delete (archive_only
      // rows are never deleted, raw_payload lineage): chunked by the batch's ids
      if (deletes) {
        for (let i = 0; i < archivedIds.length; i += opts.batchSize) {
          const chunk = archivedIds.slice(i, i + opts.batchSize);
          db.run(`DELETE FROM ${entry.table} WHERE ${pk} IN (${chunk.map(() => "?").join(",")})`, chunk);
          report.rows_deleted += chunk.length;
        }
      }
    } else {
      const ids = batch.map((row) => String(row[pk]));
      db.run(`DELETE FROM ${entry.table} WHERE ${pk} IN (${ids.map(() => "?").join(",")})`, ids);
      report.rows_deleted += ids.length;
    }
  }
  return report;
}

/**
 * Library entry point (also the handler's core). Validates EVERY retention_policy row against the
 * allow-list first (all-or-nothing: any offending row fails the run before a single row is touched),
 * then processes each allow-listed policy row. Zero qualifying rows (raw_payload today) is a no-op.
 * `last_run_at` is updated per table after a successful non-dry run - not on dry-run, not on error.
 */
export function runRetention(db: Db, opts: RunRetentionOptions): RetentionRunResult {
  const nowIso = opts.now.toISOString();
  const dryRun = opts.dryRun === true;
  const batchSize = opts.batchSize ?? RETENTION_BATCH;
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("retention: batchSize must be a positive integer");
  const archiveDir = opts.archiveDir ?? join(DB_DIR, "archive");

  const policies = db
    .query("SELECT table_key, basis, retention_months, action, last_run_at FROM retention_policy ORDER BY table_key")
    .all() as Array<{
    table_key: string;
    basis: string;
    retention_months: number;
    action: string;
    last_run_at: string | null;
  }>;

  // 1. validate every policy row against the allow-list BEFORE touching any data
  const issues: RetentionPolicyIssue[] = [];
  const plan: Array<{ entry: RetentionAllowEntry; months: number }> = [];
  for (const p of policies) {
    const entry = BY_TABLE.get(p.table_key);
    if (!entry) {
      // includes audit_log: never eligible regardless of the row (ADR-0012) - reported, never skipped
      issues.push({
        table_key: p.table_key,
        basis: p.basis,
        action: p.action,
        retention_months: p.retention_months,
        code: "table_not_allowed",
        message: `table '${p.table_key}' is not in the retention executor allow-list (audit_log is never eligible per ADR-0012)`,
      });
      continue;
    }
    if (!Number.isInteger(p.retention_months) || p.retention_months < 0) {
      issues.push({
        table_key: p.table_key,
        basis: p.basis,
        action: p.action,
        retention_months: p.retention_months,
        code: "invalid_months",
        message: `retention_months must be a non-negative integer`,
      });
      continue;
    }
    if (p.action !== "archive" && p.action !== "delete") {
      issues.push({
        table_key: p.table_key,
        basis: p.basis,
        action: p.action,
        retention_months: p.retention_months,
        code: "invalid_action",
        message: `action must be 'archive' or 'delete'`,
      });
      continue;
    }
    // Vocabulary-aware guard (registry reconciliation, 2026-11-02): the stored action must equal
    // handlingToStoredAction(entry.handling) - the SAME mapping the seeder and the admin route
    // derive the stored action from, so a registry-created or seeded row always passes. The old
    // collision (stored 'delete' on an archive_then_delete table read as plain delete) is gone:
    // behavior is pinned by entry.handling, the stored action is descriptive.
    const expectedStoredAction = handlingToStoredAction(entry.handling);
    if (p.action !== expectedStoredAction) {
      issues.push({
        table_key: p.table_key,
        basis: p.basis,
        action: p.action,
        retention_months: p.retention_months,
        code: "action_mismatch",
        message: `policy action '${p.action}' does not match the stored action '${expectedStoredAction}' for the dba-declared handling '${entry.handling}' of '${entry.table}' (vocabulary: db/lib/retention-registry.ts handlingToStoredAction)`,
      });
      continue;
    }
    if (p.basis !== entry.basis) {
      issues.push({
        table_key: p.table_key,
        basis: p.basis,
        action: p.action,
        retention_months: p.retention_months,
        code: "basis_mismatch",
        message: `policy basis '${p.basis}' does not match the declared basis column '${entry.basis}' of '${entry.table}'`,
      });
      continue;
    }
    // the declared basis must exist in the actual table (schema drift guard; PRAGMA on a missing
    // table returns no rows -> table_missing)
    const cols = tableColumns(db, entry.table);
    if (cols.size === 0) {
      issues.push({
        table_key: p.table_key,
        basis: p.basis,
        action: p.action,
        retention_months: p.retention_months,
        code: "table_missing",
        message: `table '${entry.table}' does not exist in this database`,
      });
      continue;
    }
    if (!cols.has(entry.basis)) {
      issues.push({
        table_key: p.table_key,
        basis: p.basis,
        action: p.action,
        retention_months: p.retention_months,
        code: "column_missing",
        message: `declared basis column '${entry.basis}' does not exist in table '${entry.table}'`,
      });
      continue;
    }
    plan.push({ entry, months: p.retention_months });
  }
  if (issues.length > 0) throw new RetentionPolicyError(issues);

  // 2. process each allow-listed policy row
  const reports: RetentionTableReport[] = [];
  let rowsArchived = 0;
  let rowsDeleted = 0;
  for (const { entry, months } of plan) {
    const report = processTable(db, entry, months, {
      now: opts.now,
      batchSize,
      archiveDir,
      dryRun,
      signal: opts.signal,
    });
    reports.push(report);
    rowsArchived += report.rows_to_archive;
    rowsDeleted += report.rows_deleted;
    if (!dryRun) {
      db.run("UPDATE retention_policy SET last_run_at = ? WHERE table_key = ?", [nowIso, entry.table]);
    }
  }

  return { dry_run: dryRun, tables: reports, rows_archived: rowsArchived, rows_deleted: rowsDeleted };
}

/** Handler env overrides (tests / ops): batch size and archive destination. */
function handlerBatchSize(): number | undefined {
  const raw = process.env.RETENTION_BATCH_SIZE;
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export const retentionCleanup: JobHandler = {
  key: "retention.cleanup",
  displayName: "Retention policy executor",
  description:
    "Executes retention_policy rows for tables in the code-level allow-list (D2 + dba ruling: job_run, notification, llm_call_log, raw_payload, execution_job terminal rows, session): deterministic cutoff, archive before delete into db/archive/ for archive_then_delete tables, batches of 1,000; audit_log is never eligible (ADR-0012). Set RETENTION_DRY_RUN=1 for the mandatory first-run dry-run.",
  defaultCron: "0 3 * * *",
  timeoutSec: 30 * 60,
  maxRetries: 0,
  // D7: run once if missed
  catchup: { mode: "once", maxAgeHours: 24 },
  run(ctx) {
    const dryRun = process.env.RETENTION_DRY_RUN === "1";
    const result = runRetention(ctx.db, {
      now: ctx.now,
      dryRun,
      batchSize: handlerBatchSize(),
      archiveDir: process.env.RETENTION_ARCHIVE_DIR,
      signal: ctx.signal,
    });
    return {
      rowsRead: result.rows_archived + result.rows_deleted,
      rowsWritten: result.rows_archived,
      rowsChanged: result.rows_deleted,
      detail: result,
    };
  },
};
