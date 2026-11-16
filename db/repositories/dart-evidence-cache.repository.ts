// @version 1.0.0
/**
 * dart-evidence-cache.repository.ts - all SQL for the migration 0195 tables (ADR-0199 decision 8, spec
 * 2026-11-16-s6-bulk-ai-eval-versioning §3.5/§6.2/§7) plus the pure freshness rules.
 *
 *   dart_disclosure               verbatim DART list rows, one immutable row per rcept_no (raw layer)
 *   dart_business_report_extract  capped section excerpts per (rcept_no, extractor_version) (raw layer)
 *   dart_corp_sync_state          per-corp "last successful check" timestamps + the disclosure cursor
 *
 * "A failed fetch never poisons the cache" (§7) is enforced by the API shape:
 *   - disclosure rows are inserted per page that succeeded (true, immutable facts), but the cursor and
 *     disclosures_checked_at move only through `markDisclosuresComplete`, which the caller invokes after the LAST page;
 *   - `markFinancialChecked` advances only when every requested year returned `found` or `not_filed`;
 *   - `markCorpCodeChecked` advances only when DART answered (`validated` true or false, never null);
 *   - `insertBusinessReportExtract` accepts only a complete extraction or a deterministic negative
 *     (`not_zip`, `no_sections`); transient failures have no write path at all.
 *
 * The cache is shared public evidence: no opportunity, user, candidate, or verdict column, and no read route (§9).
 * `fact_financial` keeps its own append-only revision writer; this file adds no financial-value write path (ADR-0004).
 */
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { seoulToday } from "../lib/iso-date.ts";

// ---------------------------------------------------------------------------------------------------------------
// Freshness rules (resolved Q8) — code constants, no schema impact.
// ---------------------------------------------------------------------------------------------------------------

/** Reuse window outside the filing season. */
export const DART_FRESHNESS_DAYS = 30;
/** Reuse window from March 1 to May 31 inclusive (annual business reports and their corrections). */
export const DART_FRESHNESS_DAYS_FILING_SEASON = 7;
/** First disclosure-list fetch for a corp covers this many months back. */
export const DART_DISCLOSURE_LOOKBACK_MONTHS = 36;
/** Technical evidence reads at most this many cached disclosure rows (today's cap). */
export const DART_EVIDENCE_DISCLOSURE_CAP = 24;
/** Per-section character cap of a business-report extract; the extractor sets `truncated` when it cuts. */
export const BUSINESS_REPORT_SECTION_MAX_CHARS = 8000;

export const DART_FETCH_KINDS = ["corp_code", "financial", "disclosures"] as const;
export type DartFetchKind = (typeof DART_FETCH_KINDS)[number];

const DAY_MS = 86_400_000;

/** Whole KST calendar days from `from` to `to` (both instants); negative when `from` is later. */
export function kstDayDiff(from: string | Date, to: string | Date): number {
  return Math.round((Date.parse(seoulToday(to)) - Date.parse(seoulToday(from))) / DAY_MS);
}

/** True when the KST calendar date of `now` falls in March 1 .. May 31 inclusive. */
export function isFilingSeason(now: string | Date): boolean {
  const month = Number(seoulToday(now).slice(5, 7));
  return month >= 3 && month <= 5;
}

/** The applicable window, chosen by the KST EVALUATION date (not the date of the cached check). */
export function freshnessWindowDays(now: string | Date): number {
  return isFilingSeason(now) ? DART_FRESHNESS_DAYS_FILING_SEASON : DART_FRESHNESS_DAYS;
}

/**
 * Whether a cached check may be reused at `now` (no DART call for that kind). Fresh iff the check exists, the run
 * does not set force_refresh, and the KST calendar-day age is strictly below the window: a check made on Feb 25 is
 * stale on Mar 4 (7 days in season), 29 days is fresh and 30 days is stale outside the season.
 */
export function isCheckFresh(checkedAt: string | null | undefined, now: string | Date, forceRefresh: boolean): boolean {
  if (forceRefresh || !checkedAt) return false;
  if (Number.isNaN(Date.parse(checkedAt))) return false;
  return kstDayDiff(checkedAt, now) < freshnessWindowDays(now);
}

/** Per-kind fetch decision for one corp at `now`; each kind is evaluated independently (T22). */
export function planDartFetch(
  state: DartCorpSyncStateRow | null,
  now: string | Date,
  forceRefresh: boolean,
): Record<DartFetchKind, boolean> {
  return {
    corp_code: !isCheckFresh(state?.corp_code_checked_at, now, forceRefresh),
    financial: !isCheckFresh(state?.financial_checked_at, now, forceRefresh),
    disclosures: !isCheckFresh(state?.disclosures_checked_at, now, forceRefresh),
  };
}

const YYYYMMDD = /^\d{8}$/;

function toYyyymmdd(isoDate: string): string {
  return isoDate.replaceAll("-", "");
}

/**
 * `bgn_de` (YYYYMMDD) for the next disclosure-list query (§6.2): first fetch = KST today − 36 months; later fetches =
 * disclosures_complete_through − 1 day (the overlap catches same-day late filings; inserts ignore duplicates).
 */
export function disclosureQueryStart(state: DartCorpSyncStateRow | null, now: string | Date): string {
  const through = state?.disclosures_complete_through;
  if (through && YYYYMMDD.test(through)) {
    const d = new Date(Date.UTC(Number(through.slice(0, 4)), Number(through.slice(4, 6)) - 1, Number(through.slice(6, 8))) - DAY_MS);
    return toYyyymmdd(d.toISOString().slice(0, 10));
  }
  const today = seoulToday(now);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const day = Number(today.slice(8, 10));
  const totalMonths = y * 12 + (m - 1) - DART_DISCLOSURE_LOOKBACK_MONTHS;
  const ty = Math.floor(totalMonths / 12);
  const tm = totalMonths % 12; // 0-based
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(ty, tm, Math.min(day, lastDay)));
  return toYyyymmdd(d.toISOString().slice(0, 10));
}

/** `end_de` (YYYYMMDD) for a query run at `now`: the KST calendar date. */
export function disclosureQueryEnd(now: string | Date): string {
  return toYyyymmdd(seoulToday(now));
}

/**
 * Fiscal year of a business-report name, from its `(YYYY.MM)` period, e.g. `[기재정정]사업보고서 (2024.12)` → 2024.
 * Null when the name is not a business report or carries no period.
 */
export function businessReportFiscalYear(reportNm: string): number | null {
  if (!reportNm.includes("사업보고서")) return null;
  const m = reportNm.match(/\((\d{4})\.(\d{2})\)/);
  return m ? Number(m[1]) : null;
}

/** True when a report name marks a correction filing (`정정`, e.g. [기재정정], [첨부정정]). */
export function isCorrectionReport(reportNm: string): boolean {
  return reportNm.includes("정정");
}

// ---------------------------------------------------------------------------------------------------------------
// Row types.
// ---------------------------------------------------------------------------------------------------------------

export interface DartDisclosureInput {
  rcept_no: string;
  corp_code: string;
  corp_name: string;
  report_nm: string;
  rcept_dt: string;
  flr_nm?: string | null;
  rm?: string | null;
  pblntf_ty?: string | null;
}

export interface DartDisclosureRow extends Required<DartDisclosureInput> {
  fetched_at: string;
}

export interface DartCorpSyncStateRow {
  corp_code: string;
  corp_code_checked_at: string | null;
  financial_checked_at: string | null;
  disclosures_checked_at: string | null;
  disclosures_complete_through: string | null;
  updated_at: string;
}

export const BUSINESS_REPORT_SECTION_KEYS = ["main_products", "facilities", "rnd", "ip"] as const;
export type BusinessReportSectionKey = (typeof BUSINESS_REPORT_SECTION_KEYS)[number];

export interface BusinessReportSection {
  heading_raw: string;
  text: string;
  chars: number;
  truncated: boolean;
}

export type BusinessReportSections = Partial<Record<BusinessReportSectionKey, BusinessReportSection>>;

/** Only cacheable outcomes: a complete extraction or a deterministic negative. Transient failures are not representable. */
export type BusinessReportExtractStatus = "extracted" | "no_sections" | "not_zip";

export interface BusinessReportExtractRow {
  rcept_no: string;
  extractor_version: string;
  status: BusinessReportExtractStatus;
  sections_json: string | null;
  source_chars: number;
  content_hash: string | null;
  fetched_at: string;
}

export class DartCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DartCacheError";
  }
}

const SYNC_COLUMNS = "corp_code, corp_code_checked_at, financial_checked_at, disclosures_checked_at, disclosures_complete_through, updated_at";
const DISCLOSURE_COLUMNS = "rcept_no, corp_code, corp_name, report_nm, rcept_dt, flr_nm, rm, pblntf_ty, fetched_at";

// ---------------------------------------------------------------------------------------------------------------
// Disclosures.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Insert one page of list rows. An existing rcept_no is ignored (immutable identity; the 1-day overlap and re-listed
 * rows never duplicate or update). Malformed rows still fail the CHECKs — the conflict clause targets rcept_no only.
 * Returns the number of NEW rows.
 */
export function insertDisclosures(db: Database, rows: readonly DartDisclosureInput[], now: string): number {
  const stmt = db.prepare(
    `INSERT INTO dart_disclosure (${DISCLOSURE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(rcept_no) DO NOTHING`,
  );
  return db.transaction(() => {
    let inserted = 0;
    for (const r of rows) {
      inserted += stmt.run(r.rcept_no, r.corp_code, r.corp_name, r.report_nm, r.rcept_dt, r.flr_nm ?? null, r.rm ?? null, r.pblntf_ty ?? null, now).changes;
    }
    return inserted;
  })();
}

/** Cached rows for a corp with rcept_dt >= `sinceYyyymmdd`, newest first, capped. */
export function listCachedDisclosures(
  db: Database,
  corpCode: string,
  sinceYyyymmdd: string,
  limit: number = DART_EVIDENCE_DISCLOSURE_CAP,
): DartDisclosureRow[] {
  return db
    .query(
      `SELECT ${DISCLOSURE_COLUMNS} FROM dart_disclosure WHERE corp_code = ? AND rcept_dt >= ? ORDER BY rcept_dt DESC, rcept_no DESC LIMIT ?`,
    )
    .all(corpCode, sinceYyyymmdd, limit) as DartDisclosureRow[];
}

/**
 * The closed-year correction set R (§6.2 step 3): fiscal years of `사업보고서` correction filings for the corp first
 * seen after `financialCheckedAt` (all such filings when the financial check never succeeded).
 */
export function correctedBusinessReportYears(db: Database, corpCode: string, financialCheckedAt: string | null): number[] {
  const rows = db
    .query(
      `SELECT report_nm FROM dart_disclosure
        WHERE corp_code = ? AND report_nm LIKE '%사업보고서%' AND report_nm LIKE '%정정%' AND (? IS NULL OR fetched_at > ?)`,
    )
    .all(corpCode, financialCheckedAt, financialCheckedAt) as Array<{ report_nm: string }>;
  const years = new Set<number>();
  for (const r of rows) {
    const y = isCorrectionReport(r.report_nm) ? businessReportFiscalYear(r.report_nm) : null;
    if (y !== null) years.add(y);
  }
  return [...years].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------------------------
// Per-corp sync state.
// ---------------------------------------------------------------------------------------------------------------

export function getCorpSyncState(db: Database, corpCode: string): DartCorpSyncStateRow | null {
  return (db.query(`SELECT ${SYNC_COLUMNS} FROM dart_corp_sync_state WHERE corp_code = ?`).get(corpCode) as DartCorpSyncStateRow | null) ?? null;
}

function advance(db: Database, corpCode: string, set: Partial<Omit<DartCorpSyncStateRow, "corp_code" | "updated_at">>, now: string): void {
  const cols = Object.keys(set) as Array<keyof typeof set>;
  db.run(
    `INSERT INTO dart_corp_sync_state (corp_code, ${cols.join(", ")}, updated_at) VALUES (?, ${cols.map(() => "?").join(", ")}, ?)
     ON CONFLICT(corp_code) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}, updated_at = excluded.updated_at`,
    [corpCode, ...cols.map((c) => set[c] ?? null), now],
  );
}

/** Advance corp_code_checked_at only when DART answered (`true`/`false`). `null` (unreachable) leaves it. */
export function markCorpCodeChecked(db: Database, corpCode: string, validated: boolean | null, now: string): boolean {
  if (validated === null) return false;
  advance(db, corpCode, { corp_code_checked_at: now }, now);
  return true;
}

export type FinancialYearOutcome = { year: number; outcome: "found" | "not_filed" | "error" };

/**
 * Advance financial_checked_at only if every requested year returned `found` or `not_filed` (§6.2 step 8). An empty
 * outcome list (nothing was requested) does not advance it. Rows already written for other years are untouched.
 */
export function markFinancialChecked(db: Database, corpCode: string, yearOutcomes: readonly FinancialYearOutcome[], now: string): boolean {
  if (yearOutcomes.length === 0 || yearOutcomes.some((o) => o.outcome === "error")) return false;
  advance(db, corpCode, { financial_checked_at: now }, now);
  return true;
}

/** Call ONLY after the last page of a list query succeeded: advances disclosures_checked_at and the cursor (= end_de). */
export function markDisclosuresComplete(db: Database, corpCode: string, completeThrough: string, now: string): void {
  if (!YYYYMMDD.test(completeThrough)) throw new DartCacheError("completeThrough must be YYYYMMDD.");
  advance(db, corpCode, { disclosures_checked_at: now, disclosures_complete_through: completeThrough }, now);
}

// ---------------------------------------------------------------------------------------------------------------
// Business-report extracts.
// ---------------------------------------------------------------------------------------------------------------

export function getBusinessReportExtract(db: Database, rceptNo: string, extractorVersion: string): BusinessReportExtractRow | null {
  return (
    (db
      .query(
        "SELECT rcept_no, extractor_version, status, sections_json, source_chars, content_hash, fetched_at FROM dart_business_report_extract WHERE rcept_no = ? AND extractor_version = ?",
      )
      .get(rceptNo, extractorVersion) as BusinessReportExtractRow | null) ?? null
  );
}

/**
 * Whether the body of `rceptNo` must be fetched: only when no extract exists for the current extractor version. An
 * rcept_no names an immutable filing, so force_refresh deliberately does not enter this decision (§6.2).
 */
export function needsBusinessReportFetch(db: Database, rceptNo: string, extractorVersion: string): boolean {
  return getBusinessReportExtract(db, rceptNo, extractorVersion) === null;
}

export interface InsertBusinessReportExtractInput {
  rceptNo: string;
  extractorVersion: string;
  status: BusinessReportExtractStatus;
  /** Required (non-empty) for `extracted`; must be absent for the deterministic negatives. */
  sections?: BusinessReportSections | null;
  sourceChars: number;
  now: string;
}

/**
 * Cache a complete extraction or a deterministic negative. Idempotent per (rcept_no, extractor_version): an existing
 * row is kept. The disclosure row must already be cached (FK). Section texts over the cap are rejected, not truncated.
 */
export function insertBusinessReportExtract(db: Database, input: InsertBusinessReportExtractInput): BusinessReportExtractRow {
  if (!input.extractorVersion) throw new DartCacheError("extractorVersion is required.");
  if (!Number.isInteger(input.sourceChars) || input.sourceChars < 0) throw new DartCacheError("sourceChars must be a non-negative integer.");
  let sectionsJson: string | null = null;
  if (input.status === "extracted") {
    const sections = input.sections ?? {};
    const keys = Object.keys(sections);
    if (keys.length === 0) throw new DartCacheError("An 'extracted' row needs at least one section; use 'no_sections' otherwise.");
    for (const k of keys) {
      if (!(BUSINESS_REPORT_SECTION_KEYS as readonly string[]).includes(k)) throw new DartCacheError(`Unknown section key '${k}'.`);
      const s = sections[k as BusinessReportSectionKey] as BusinessReportSection;
      if (s.text.length > BUSINESS_REPORT_SECTION_MAX_CHARS) {
        throw new DartCacheError(`Section '${k}' exceeds ${BUSINESS_REPORT_SECTION_MAX_CHARS} characters; the extractor must cap it.`);
      }
    }
    const ordered: Record<string, BusinessReportSection> = {};
    for (const k of BUSINESS_REPORT_SECTION_KEYS) if (sections[k]) ordered[k] = sections[k] as BusinessReportSection;
    sectionsJson = JSON.stringify(ordered);
  } else if (input.status === "no_sections" || input.status === "not_zip") {
    if (input.sections && Object.keys(input.sections).length > 0) throw new DartCacheError(`A '${input.status}' row carries no sections.`);
  } else {
    throw new DartCacheError("status must be extracted | no_sections | not_zip (transient failures are never cached).");
  }
  const contentHash = sectionsJson === null ? null : createHash("sha256").update(sectionsJson, "utf8").digest("hex");
  db.run(
    `INSERT INTO dart_business_report_extract (rcept_no, extractor_version, status, sections_json, source_chars, content_hash, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(rcept_no, extractor_version) DO NOTHING`,
    [input.rceptNo, input.extractorVersion, input.status, sectionsJson, input.sourceChars, contentHash, input.now],
  );
  return getBusinessReportExtract(db, input.rceptNo, input.extractorVersion) as BusinessReportExtractRow;
}
