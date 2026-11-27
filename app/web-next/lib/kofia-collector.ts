// @version 1.0.0
// KOFIA grade-yield collector (ADR-0208 slice 4): fetches the valuation-firm average 3y yields of the AAA..BBB-
// public-offering unsecured corporate-bond grades plus the same-date KTB 3y from the Korea Financial Investment
// Association bond information service and stores them as day-grain observations (fact_market_observation, source
// 'kofia', unit percent). Parsing is db/lib/kofia-grade-yield.ts (pure, fixture-tested).
//
// THE GATE. The service is undocumented and KOFIA has not confirmed that automated collection is allowed, so this
// collector refuses to run unless CO_NEWBIZ_KOFIA_COLLECT is exactly "on" (default off). The check lives HERE, not only in
// the route, so no caller (route, CLI, scheduler, test) can fetch by accident. Reading already-stored observations is
// not gated. Politeness: one run is three POSTs (latest date, column heads, the day), sequential, one attempt each,
// a generic client User-Agent, no cookies, no login, no redirects followed.
import type { Database } from "bun:sqlite";
import {
  KOFIA_COLLECT_ENV,
  KOFIA_ENDPOINT,
  KOFIA_GRADES,
  KOFIA_KTB_SERIES_ID,
  KOFIA_PAGE_URL,
  KOFIA_SOURCE_CODE,
  buildKofiaRequest,
  kofiaCollectEnabledFrom,
  kofiaGradeSeriesId,
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
  /** YYYY-MM-DD the stored yields were published for. */
  date: string;
  ktb_pct: number;
  grades_written: number;
  rows_changed: number;
  warnings: string[];
  source_url: string;
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

/**
 * Collect the latest published KOFIA day and store it. Throws KofiaCollectDisabledError when the switch is off (before
 * any network call), KofiaParseError when the response layout is not the one the parser knows, and the transport error
 * otherwise; nothing is written unless the whole day parsed. Re-running for the same date is a no-op (same values).
 */
export async function collectKofiaGradeYields(
  db: Database,
  now: Date = new Date(),
  deps: KofiaCollectorDeps = DEFAULT_KOFIA_DEPS,
): Promise<KofiaCollectionResult> {
  if (!kofiaCollectEnabled()) throw new KofiaCollectDisabledError();
  const maxDate = parseKofiaMaxDate(await deps.post(buildKofiaRequest("getExistMaxDate")));
  const ymd = maxDate.replaceAll("-", "");
  const headXml = await deps.post(buildKofiaRequest("getHeadList", ymd));
  const dayXml = await deps.post(buildKofiaRequest("selectDay", ymd));
  const snap = parseKofiaDay(dayXml, headXml, maxDate);

  const unitId = percentUnitId(db);
  const sourceId = kofiaSourceId(db, now);
  const periodId = upsertPeriod(db, snap.date);
  let written = 0;
  let changed = 0;
  const store = async (seriesId: string, value: number, label: string) => {
    const raw = JSON.stringify({ date: snap.date, series: seriesId, label, value_pct: value, page: KOFIA_PAGE_URL });
    const r = upsertObservation(db, { seriesId, periodId, unitId, sourceId, value, contentHash: await sha256Hex(raw) });
    written += 1;
    if (r.status === "revised") changed += 1;
  };
  await store(KOFIA_KTB_SERIES_ID, snap.ktbPct, "KTB 3y");
  for (const grade of KOFIA_GRADES) {
    const v = snap.grades[grade];
    if (v !== undefined) await store(kofiaGradeSeriesId(grade), v, grade);
  }
  return {
    date: snap.date,
    ktb_pct: snap.ktbPct,
    grades_written: written - 1,
    rows_changed: changed,
    warnings: snap.warnings.slice(0, 20),
    source_url: KOFIA_PAGE_URL,
  };
}
