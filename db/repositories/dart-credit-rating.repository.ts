// @version 1.0.0
/**
 * dart-credit-rating.repository.ts - all SQL for migration 0200 `dart_credit_rating_snapshot` (ADR-0208, design
 * 2026-11-26-wacc-credit-rating-spread section 8.2).
 *
 * One immutable row per (source_rcept_no, parser_version). The write API accepts only complete parses and
 * deterministic negatives (the six status values); a transient fetch failure has NO write path, so a failed fetch
 * never poisons the cache (the ADR-0199 discipline). Shared public DART evidence: no user / project / verdict column.
 * Money in `issues_json` is INTEGER KRW millions (ADR-0061).
 */
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { ulid } from "../lib/ulid.ts";

export const CREDIT_SNAPSHOT_SOURCE_KINDS = ["business_report", "debt_securities_filing"] as const;
export type CreditSnapshotSourceKind = (typeof CREDIT_SNAPSHOT_SOURCE_KINDS)[number];

export const CREDIT_SNAPSHOT_STATUSES = [
  "parsed",
  "section_present_no_bond_rating",
  "not_disclosed",
  "section_absent",
  "parse_failed",
  "not_zip",
] as const;
export type CreditSnapshotStatus = (typeof CREDIT_SNAPSHOT_STATUSES)[number];

export interface CreditRatingSnapshotRow {
  id: string;
  corp_code: string;
  source_kind: CreditSnapshotSourceKind;
  source_rcept_no: string;
  parser_version: string;
  status: CreditSnapshotStatus;
  ratings_json: string;
  issues_json: string | null;
  truncated: 0 | 1;
  content_hash: string;
  fetched_at: string;
}

export class CreditRatingSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditRatingSnapshotError";
  }
}

const COLUMNS =
  "id, corp_code, source_kind, source_rcept_no, parser_version, status, ratings_json, issues_json, truncated, content_hash, fetched_at";

export interface InsertCreditRatingSnapshotInput {
  corpCode: string;
  sourceKind: CreditSnapshotSourceKind;
  sourceRceptNo: string;
  parserVersion: string;
  status: CreditSnapshotStatus;
  /** Rating rows (any JSON-serializable array); empty for the negatives. */
  ratings: readonly unknown[];
  /** Issue rows, or null when the issuance table was not available. */
  issues: readonly unknown[] | null;
  truncated?: boolean;
  now: string;
}

/**
 * Cache one parse. Idempotent per (source_rcept_no, parser_version): an existing row is kept and returned (an rcept_no
 * names an immutable filing). Returns the stored row.
 */
export function insertCreditRatingSnapshot(
  db: Database,
  input: InsertCreditRatingSnapshotInput,
): CreditRatingSnapshotRow {
  if (!(CREDIT_SNAPSHOT_SOURCE_KINDS as readonly string[]).includes(input.sourceKind))
    throw new CreditRatingSnapshotError(`Unknown source_kind '${input.sourceKind}'.`);
  if (!(CREDIT_SNAPSHOT_STATUSES as readonly string[]).includes(input.status))
    throw new CreditRatingSnapshotError(
      "status must be one of the recorded parse outcomes (transient failures are never cached).",
    );
  if (!input.parserVersion) throw new CreditRatingSnapshotError("parserVersion is required.");
  if (input.status === "parsed" && input.ratings.length === 0 && (input.issues?.length ?? 0) === 0)
    throw new CreditRatingSnapshotError("A 'parsed' snapshot needs at least one rating or issue row.");
  const ratingsJson = JSON.stringify(input.ratings);
  const issuesJson = input.issues === null ? null : JSON.stringify(input.issues);
  const hash = createHash("sha256")
    .update(ratingsJson, "utf8")
    .update("\n", "utf8")
    .update(issuesJson ?? "null", "utf8")
    .digest("hex");
  db.run(
    `INSERT INTO dart_credit_rating_snapshot (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_rcept_no, parser_version) DO NOTHING`,
    [
      ulid(),
      input.corpCode,
      input.sourceKind,
      input.sourceRceptNo,
      input.parserVersion,
      input.status,
      ratingsJson,
      issuesJson,
      input.truncated ? 1 : 0,
      hash,
      input.now,
    ],
  );
  return getCreditRatingSnapshotBySource(db, input.sourceRceptNo, input.parserVersion) as CreditRatingSnapshotRow;
}

export function getCreditRatingSnapshot(db: Database, id: string): CreditRatingSnapshotRow | null {
  return (
    (db
      .query(`SELECT ${COLUMNS} FROM dart_credit_rating_snapshot WHERE id = ?`)
      .get(id) as CreditRatingSnapshotRow | null) ?? null
  );
}

export function getCreditRatingSnapshotBySource(
  db: Database,
  sourceRceptNo: string,
  parserVersion: string,
): CreditRatingSnapshotRow | null {
  return (
    (db
      .query(`SELECT ${COLUMNS} FROM dart_credit_rating_snapshot WHERE source_rcept_no = ? AND parser_version = ?`)
      .get(sourceRceptNo, parserVersion) as CreditRatingSnapshotRow | null) ?? null
  );
}

/** Snapshots of one company for the CURRENT parser version, newest filing first. */
export function listCreditRatingSnapshots(
  db: Database,
  corpCode: string,
  parserVersion: string,
): CreditRatingSnapshotRow[] {
  return db
    .query(
      `SELECT ${COLUMNS} FROM dart_credit_rating_snapshot WHERE corp_code = ? AND parser_version = ?
       ORDER BY source_rcept_no DESC, id DESC`,
    )
    .all(corpCode, parserVersion) as CreditRatingSnapshotRow[];
}

/** Whether any snapshot exists for the company under the current parser version (collected at all?). */
export function hasCreditRatingSnapshots(db: Database, corpCode: string, parserVersion: string): boolean {
  return (
    db
      .query("SELECT 1 FROM dart_credit_rating_snapshot WHERE corp_code = ? AND parser_version = ? LIMIT 1")
      .get(corpCode, parserVersion) !== null
  );
}
