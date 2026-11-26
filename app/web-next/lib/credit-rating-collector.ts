// @version 1.0.0
/**
 * Disclosed-credit-rating collection for one DART company (ADR-0208 slice 2, design 2026-11-26-wacc-credit-rating-
 * spread section 5.1). Fetch + cache; the parsing is the pure db/lib/credit-rating-disclosure.ts.
 *
 * Steps (explicit, user-triggered by POST .../wacc/credit-rating/collect; never in a GET path):
 *   1. Find the latest business report: the ADR-0199 cached `dart_disclosure` rows first
 *      (selectEvidenceBusinessReport, newest including corrections); when the cache has none, or only one older than
 *      ~13 months, ask list.json with pblntf_detail_ty=A001 (the typed query; the client-side "business" filter missed
 *      the report of a high-volume filer) and cache the list rows (true, immutable DART facts).
 *   2. Fetch the report text ONCE per rcept_no (fetchDisclosureText), parse, persist one immutable snapshot per
 *      (rcept_no, parser_version). Only complete parses and deterministic negatives are cached; a transient fetch
 *      failure writes nothing.
 *   3. Supplement from OpenDART bdRs.json (debt-securities registrations, public offerings) of the last
 *      `disclosed.stale_months`: `cdrt_int` ratings, one snapshot per filing.
 *
 * No Korean literals live here (they stay in the parser): this file is under the i18n-lint scan roots.
 */
import type { Database } from "bun:sqlite";
import {
  CREDIT_RATING_PARSER_VERSION,
  addMonthsIso,
  isSelectableRating,
  parseBusinessReportCreditRating,
  parseDebtSecuritiesRating,
  type CreditRatingRow,
} from "../../../db/lib/credit-rating-disclosure.ts";
import { loadKrCreditRatingRegistry } from "../../../db/lib/credit-spread-map.ts";
import { seoulToday } from "../../../db/lib/iso-date.ts";
import {
  getCreditRatingSnapshotBySource,
  insertCreditRatingSnapshot,
  type CreditSnapshotStatus,
} from "../../../db/repositories/dart-credit-rating.repository.ts";
import { insertDisclosures, listCachedDisclosures } from "../../../db/repositories/dart-evidence-cache.repository.ts";
import {
  fetchDebtSecuritiesFilings,
  fetchDisclosureText,
  listBusinessReports,
  selectEvidenceBusinessReport,
} from "./dart-client.ts";

export interface CreditRatingCollectorDeps {
  fetchDisclosureText: typeof fetchDisclosureText;
  listBusinessReports: typeof listBusinessReports;
  fetchDebtSecuritiesFilings: typeof fetchDebtSecuritiesFilings;
}

export const DEFAULT_CREDIT_RATING_DEPS: CreditRatingCollectorDeps = {
  fetchDisclosureText,
  listBusinessReports,
  fetchDebtSecuritiesFilings,
};

export type CreditRatingReportOutcome = CreditSnapshotStatus | "not_found" | "transient_error";

export interface CreditRatingCollectionResult {
  corp_code: string;
  report_rcept_no: string | null;
  report_status: CreditRatingReportOutcome;
  /** True when the report text was fetched in this run; false when the snapshot already existed (no fetch). */
  report_fetched: boolean;
  bdrs_filings: number;
  bdrs_snapshots_written: number;
  warnings: string[];
}

/** A cached report older than this is not trusted to be the newest: ask DART for the typed list as well. */
const CACHED_REPORT_MAX_AGE_DAYS = 400;
const REPORT_LIST_MONTHS = 36;

function yyyymmdd(iso: string): string {
  return iso.replaceAll("-", "");
}

function daysBetween(fromYmd: string, toIso: string): number {
  const f = Date.UTC(Number(fromYmd.slice(0, 4)), Number(fromYmd.slice(4, 6)) - 1, Number(fromYmd.slice(6, 8)));
  const t = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((t - f) / 86_400_000);
}

/**
 * Collect and cache the disclosed credit rating evidence of `corpCode`. Throws only when NOTHING could be read
 * (every DART step failed); partial failures come back as `warnings` on a successful result.
 */
export async function collectCreditRating(
  db: Database,
  corpCode: string,
  now: Date,
  deps: CreditRatingCollectorDeps = DEFAULT_CREDIT_RATING_DEPS,
): Promise<CreditRatingCollectionResult> {
  const loaded = loadKrCreditRatingRegistry();
  if (!loaded.ok) throw new Error(`credit rating registry unavailable: ${loaded.reason}`);
  const registry = loaded.registry;
  const warnings: string[] = [];
  const nowIso = now.toISOString();
  const today = seoulToday(now);
  const result: CreditRatingCollectionResult = {
    corp_code: corpCode,
    report_rcept_no: null,
    report_status: "not_found",
    report_fetched: false,
    bdrs_filings: 0,
    bdrs_snapshots_written: 0,
    warnings,
  };
  let reportStepFailed = false;

  // 1. Locate the latest business report.
  const since = yyyymmdd(addMonthsIso(today, -REPORT_LIST_MONTHS));
  let report = selectEvidenceBusinessReport(listCachedDisclosures(db, corpCode, since, 500));
  if (!report || daysBetween(report.rcept_dt, today) > CACHED_REPORT_MAX_AGE_DAYS) {
    const listed = await deps.listBusinessReports(corpCode, REPORT_LIST_MONTHS, now);
    if (listed.rows.length > 0) {
      insertDisclosures(db, listed.rows, nowIso);
      report = selectEvidenceBusinessReport(listCachedDisclosures(db, corpCode, since, 500));
    }
    if (!listed.ok) {
      warnings.push(`business report list failed: ${listed.error ?? "unknown"}`.slice(0, 300));
      if (!report) reportStepFailed = true;
    }
  }

  // 2. Parse the report once per rcept_no and parser version.
  if (report) {
    result.report_rcept_no = report.rcept_no;
    const existing = getCreditRatingSnapshotBySource(db, report.rcept_no, CREDIT_RATING_PARSER_VERSION);
    if (existing) {
      result.report_status = existing.status;
    } else {
      const text = await deps.fetchDisclosureText(report.rcept_no);
      if (!text.available) {
        if (/\bZIP\b/.test(text.error ?? "")) {
          // HWP binary and the like: a deterministic negative, cached so the document is not re-downloaded.
          const row = insertCreditRatingSnapshot(db, {
            corpCode,
            sourceKind: "business_report",
            sourceRceptNo: report.rcept_no,
            parserVersion: CREDIT_RATING_PARSER_VERSION,
            status: "not_zip",
            ratings: [],
            issues: null,
            now: nowIso,
          });
          result.report_status = row.status;
          result.report_fetched = true;
        } else {
          result.report_status = "transient_error";
          reportStepFailed = true;
          warnings.push(`business report text unavailable: ${text.error ?? "empty document"}`.slice(0, 300));
        }
      } else {
        const parsed = parseBusinessReportCreditRating(text.text ?? "", registry);
        const row = insertCreditRatingSnapshot(db, {
          corpCode,
          sourceKind: "business_report",
          sourceRceptNo: report.rcept_no,
          parserVersion: CREDIT_RATING_PARSER_VERSION,
          status: parsed.status,
          ratings: parsed.ratings,
          issues: parsed.issues,
          truncated: text.truncated === true,
          now: nowIso,
        });
        result.report_status = row.status;
        result.report_fetched = true;
      }
    }
  }

  // 3. Supplement: debt-securities registrations of the last stale_months (public offerings only).
  let bdrsFailed = false;
  const bgn = yyyymmdd(addMonthsIso(today, -registry.disclosed.staleMonths));
  const filings = await deps.fetchDebtSecuritiesFilings(corpCode, bgn, yyyymmdd(today));
  if (!filings.ok) {
    bdrsFailed = true;
    warnings.push(`debt securities lookup failed: ${filings.error ?? "unknown"}`.slice(0, 300));
  } else {
    result.bdrs_filings = filings.filings.length;
    for (const f of filings.filings) {
      if (getCreditRatingSnapshotBySource(db, f.rcept_no, CREDIT_RATING_PARSER_VERSION)) continue;
      const rows: CreditRatingRow[] = parseDebtSecuritiesRating(
        { cdrt_int: f.cdrt_int, pymd: f.pymd, rcept_no: f.rcept_no, grt_amt: f.grt_amt },
        registry,
      );
      let status: CreditSnapshotStatus;
      if (rows.some(isSelectableRating)) status = "parsed";
      else if (rows.length > 0) status = "section_present_no_bond_rating";
      else status = f.cdrt_int ? "parse_failed" : "not_disclosed";
      insertCreditRatingSnapshot(db, {
        corpCode,
        sourceKind: "debt_securities_filing",
        sourceRceptNo: f.rcept_no,
        parserVersion: CREDIT_RATING_PARSER_VERSION,
        status,
        ratings: rows,
        issues: null,
        now: nowIso,
      });
      result.bdrs_snapshots_written++;
    }
  }

  if (reportStepFailed && bdrsFailed) {
    throw new Error(`DART could not be read for ${corpCode}: ${warnings.join("; ")}`);
  }
  return result;
}
