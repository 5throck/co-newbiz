// @version 1.1.0
// 1.1.0 (ADR-0208 slice 4, scheduled collection): optional backfill of missing business days, skip of already stored days,
// atomic per-day store, and the service's latest published day in the result (freshness check of the manual button).
// KOFIA grade-yield collector (ADR-0208 slice 4): fetches the valuation-firm average 3y yields of the AAA..BBB-
// public-offering unsecured corporate-bond grades plus the same-date KTB 3y from the Korea Financial Investment
// Association bond information service and stores them as day-grain observations (fact_market_observation, source
// 'kofia', unit percent). Parsing is db/lib/kofia-grade-yield.ts (pure, fixture-tested).
//
// THE GATE. The service is undocumented and KOFIA has not confirmed that automated collection is allowed, so this
// collector refuses to run unless CO_NEWBIZ_KOFIA_COLLECT is exactly "on" (default off). The check lives HERE, not only in
// the route, so no caller (route, CLI, scheduler, test) can fetch by accident. Reading already-stored observations is
// not gated. Politeness: one run is three POSTs (latest date, column heads, the day), sequential, one attempt each,
// a generic client User-Agent, no cookies, no login, no redirects followed. The scheduled job (collect.kofia) skips a
// day that is already stored (one POST then) and backfills at most KOFIA_BACKFILL_DAYS of missing business days.
//
// NOT in SOURCE_ADAPTERS on purpose: the generic fetch / md:sync / collect.* paths must never reach this collector; its
// only callers are this module's route runner and the dedicated collect.kofia handler.
import type { Database } from "bun:sqlite";
import {
  KOFIA_COLLECT_ENV,
  KOFIA_ENDPOINT,
  KOFIA_GRADES,
  KOFIA_KTB_SERIES_ID,
  KOFIA_PAGE_URL,
  KOFIA_SOURCE_CODE,
  KofiaParseError,
  buildKofiaRequest,
  isKofiaDayStored,
  kofiaCollectEnabledFrom,
  kofiaGradeSeriesId,
  kofiaMissingBusinessDays,
  latestKofiaDate,
  parseKofiaDay,
  parseKofiaMaxDate,
} from "../../../db/lib/kofia-grade-yield.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { KOSIS_UNITS } from "../../../scripts/co-newbiz/kosis-units.ts";
import { sha256Hex, upsertObservation, upsertPeriod } from "../../../scripts/co-newbiz/jobs/collect/fetch-source.ts";
import { loadRootEnvPipelineKeys } from "./root-env.ts";

/** True when automated KOFIA collection is switched on (env CO_NEWBIZ_KOFIA_COLLECT === "on"). Default: off. */
export function kofiaCollectEnabled(): boolean {
  loadRootEnvPipelineKeys();
  return kofiaCollectEnabledFrom(process.env[KOFIA_COLLECT_ENV]);
}

export class KofiaCollectDisabledError extends Error {
  constructor() {
    super(`KOFIA collection is switched off (${KOFIA_COLLECT_ENV} is not "on").`);
    this.name = "KofiaCollectDisabledError";
  }
}

export interface KofiaCollectorDeps {
  /** POST one service request body, answer the response text. Throws on a transport or HTTP failure. */
  post(body: string): Promise<string>;
}

export const DEFAULT_KOFIA_DEPS: KofiaCollectorDeps = {
  async post(body) {
    const res = await fetch(KOFIA_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/xml", "User-Agent": "co-newbiz-reference-collector/1.0" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from www.kofiabond.or.kr`);
    return await res.text();
  },
};

export interface KofiaCollectionResult {
  /** YYYY-MM-DD the latest stored yields were published for (the service's latest day). */
  date: string;
  /** The service's latest published day (getExistMaxDate); the freshness check compares it with the latest stored day. */
  max_published_date: string;
  ktb_pct: number | null;
  /** Grade rows of the latest day (0 when that day was already stored and skipped). */
  grades_written: number;
  /** Observation rows written or checked over all days of this run, and how many of them were revisions. */
  rows_written_total: number;
  rows_changed: number;
  /** Days of this run that were fetched and stored (latest first, then backfilled days newest to oldest). */
  days_stored: string[];
  /** Days skipped because they were already stored (only with skipStoredDays). */
  days_already_stored: string[];
  /** Backfilled days with no data (public holidays) and backfilled days that failed (never fails the run). */
  backfill_no_data: string[];
  backfill_failed: Array<{ date: string; error: string }>;
  warnings: string[];
  source_url: string;
}

export interface KofiaCollectOptions {
  /** Also fetch the business days still missing within this many calendar days before the latest one (default 0 = none). */
  backfillDays?: number;
  /** Do not fetch a day whose yields are already stored (the scheduled job); default false = fetch and upsert again. */
  skipStoredDays?: boolean;
  /** Checked between service calls (the scheduler's timeout). */
  signal?: AbortSignal;
}

function percentUnitId(db: Database): string {
  const mapping = Object.values(KOSIS_UNITS).find((u) => u.unitCode === "percent");
  if (!mapping) throw new Error("unit 'percent' has no md_unit mapping (kosis-units.ts).");
  const row = db.query("SELECT id FROM md_unit WHERE code = ?").get(mapping.unitCode) as { id: string } | undefined;
  if (row) return row.id;
  const id = ulid();
  db.run("INSERT INTO md_unit (id, code, dimension, si_coefficient, created_at) VALUES (?,?,?,?,?)", [
    id,
    mapping.unitCode,
    mapping.dimension,
    mapping.siCoefficient,
    new Date().toISOString(),
  ]);
  return id;
}

function kofiaSourceId(db: Database, now: Date): string {
  const row = db.query("SELECT id FROM md_source WHERE code = ?").get(KOFIA_SOURCE_CODE) as { id: string } | undefined;
  if (row) return row.id;
  const id = ulid();
  // Reliability B: an industry-association publication of valuation-firm derivations, collected from an undocumented service.
  db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [
    id,
    KOFIA_SOURCE_CODE,
    "B",
    now.toISOString(),
  ]);
  return id;
}

interface DayRows {
  seriesId: string;
  value: number;
  label: string;
}

/** Store one parsed day in ONE transaction (KTB and grades are all-or-nothing), after the hashes are computed. */
async function storeDay(
  db: Database,
  snap: ReturnType<typeof parseKofiaDay>,
  unitId: string,
  sourceId: string,
): Promise<{ written: number; changed: number }> {
  const rows: DayRows[] = [{ seriesId: KOFIA_KTB_SERIES_ID, value: snap.ktbPct, label: "KTB 3y" }];
  for (const grade of KOFIA_GRADES) {
    const v = snap.grades[grade];
    if (v !== undefined) rows.push({ seriesId: kofiaGradeSeriesId(grade), value: v, label: grade });
  }
  const hashed = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      contentHash: await sha256Hex(
        JSON.stringify({
          date: snap.date,
          series: r.seriesId,
          label: r.label,
          value_pct: r.value,
          page: KOFIA_PAGE_URL,
        }),
      ),
    })),
  );
  const periodId = upsertPeriod(db, snap.date);
  let changed = 0;
  db.transaction(() => {
    for (const r of hashed) {
      const res = upsertObservation(db, {
        seriesId: r.seriesId,
        periodId,
        unitId,
        sourceId,
        value: r.value,
        contentHash: r.contentHash,
      });
      if (res.status === "revised") changed += 1;
    }
  })();
  return { written: hashed.length, changed };
}

/**
 * Collect the latest published KOFIA day (and, when asked, the business days still missing before it) and store it.
 * Throws KofiaCollectDisabledError when the switch is off (before any network call), KofiaParseError when the response
 * layout is not the one the parser knows, and the transport error otherwise; a day is written only when it parsed whole.
 * The LATEST day is all-or-nothing for the run; backfilled days are best-effort (a holiday answers no rows -> listed in
 * backfill_no_data; any other failure is listed in backfill_failed and a transport failure ends the backfill).
 * Re-running for the same date is a no-op (same values).
 */
export async function collectKofiaGradeYields(
  db: Database,
  now: Date = new Date(),
  deps: KofiaCollectorDeps = DEFAULT_KOFIA_DEPS,
  options: KofiaCollectOptions = {},
): Promise<KofiaCollectionResult> {
  if (!kofiaCollectEnabled()) throw new KofiaCollectDisabledError();
  const aborted = () => {
    if (options.signal?.aborted) throw new Error("KOFIA collection aborted (timeout).");
  };
  const maxDate = parseKofiaMaxDate(await deps.post(buildKofiaRequest("getExistMaxDate")));
  const storedBefore = latestKofiaDate(db);
  const unitId = percentUnitId(db);
  const sourceId = kofiaSourceId(db, now);
  const result: KofiaCollectionResult = {
    date: maxDate,
    max_published_date: maxDate,
    ktb_pct: null,
    grades_written: 0,
    rows_written_total: 0,
    rows_changed: 0,
    days_stored: [],
    days_already_stored: [],
    backfill_no_data: [],
    backfill_failed: [],
    warnings: [],
    source_url: KOFIA_PAGE_URL,
  };

  /** Fetch (head + day), parse and store one day. Throws on any failure. */
  const fetchDay = async (date: string) => {
    aborted();
    const compact = date.replaceAll("-", "");
    const headXml = await deps.post(buildKofiaRequest("getHeadList", compact));
    aborted();
    const dayXml = await deps.post(buildKofiaRequest("selectDay", compact));
    const snap = parseKofiaDay(dayXml, headXml, date);
    const stored = await storeDay(db, snap, unitId, sourceId);
    result.rows_written_total += stored.written;
    result.rows_changed += stored.changed;
    result.days_stored.push(date);
    for (const w of snap.warnings) if (result.warnings.length < 20) result.warnings.push(`${date}: ${w}`);
    return { snap, stored };
  };

  if (options.skipStoredDays && isKofiaDayStored(db, maxDate)) {
    result.days_already_stored.push(maxDate);
  } else {
    const { snap, stored } = await fetchDay(maxDate);
    result.ktb_pct = snap.ktbPct;
    result.grades_written = stored.written - 1;
  }
  if (result.ktb_pct === null) {
    const row = db
      .query(
        `SELECT o.value AS v FROM fact_market_observation o JOIN md_period p ON p.id = o.period_id AND p.period_type = 'date'
         WHERE o.series_id = ? AND p.start_date = ? ORDER BY o.revision_no DESC LIMIT 1`,
      )
      .get(KOFIA_KTB_SERIES_ID, maxDate) as { v: number } | undefined;
    result.ktb_pct = row?.v ?? null;
  }

  const backfillDays = options.backfillDays ?? 0;
  if (backfillDays > 0) {
    // Newest to oldest: a stop (transport failure, timeout) loses the oldest, least useful days first.
    for (const date of kofiaMissingBusinessDays(storedBefore, maxDate, backfillDays).reverse()) {
      if (options.skipStoredDays && isKofiaDayStored(db, date)) {
        result.days_already_stored.push(date);
        continue;
      }
      try {
        await fetchDay(date);
      } catch (err) {
        if (err instanceof KofiaParseError && err.code === "no_data") {
          result.backfill_no_data.push(date);
          continue;
        }
        result.backfill_failed.push({ date, error: err instanceof Error ? err.message : String(err) });
        if (!(err instanceof KofiaParseError)) break; // transport trouble: do not keep hitting the service
      }
    }
  }
  result.warnings = result.warnings.slice(0, 20);
  return result;
}
