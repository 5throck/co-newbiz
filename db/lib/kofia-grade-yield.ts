// @version 1.1.0
// 1.1.0 (ADR-0208 slice 4, scheduled collection): collect.kofia job key, the business-day helpers (expected latest
// published day, backfill window) and kofiaFreshness (what the manual collect button reads to answer "already up to date").
/**
 * KOFIA grade-by-rating corporate bond yields (ADR-0208 slice 4, design 2026-11-26-wacc-credit-rating-spread-design
 * sections 4.1 and 17.5). PURE parser plus read helpers over the existing market-observation storage
 * (fact_market_observation, day-grain periods, as KRX does): no new table.
 *
 * Source: the Korea Financial Investment Association bond information service (kofiabond.or.kr), page
 * "시가평가 > 채권시가평가수익률 > 일자별" (divisionId MBIS01070010000000). The site is a WebSquare app; the data of that
 * page comes from one XML service of the site itself (POST /proframeWeb/XMLSERVICES/, app BIS-KOFIABOND, service
 * BISBndSrtPrcSrchSO). The three calls below were read from the page's own client file (/xml/startest/BISBndSrtPrcDay.xml)
 * and probed once on 2026-11-27 (no login, no cookie): getExistMaxDate, getHeadList, selectDay. The service is
 * UNDOCUMENTED: KOFIA publishes no API contract, so a layout change breaks the parser (a failed parse is a recorded
 * failure, never a zero), and automated collection stays behind the CO_NEWBIZ_KOFIA_COLLECT switch (OFF by default)
 * until KOFIA confirms in writing that it is allowed (ADR-0208, runbook beta-series-collection).
 *
 * Which rows: 회사채 I (공모사채) 무보증 (public-offering, unsecured corporate bonds), the AAA..BBB- rows, valuation-firm
 * average (평가사 평균, reportCompCd A20000, all five firms selected), 3-year remaining-maturity column. KOFIA writes the
 * flat notches as AA0, A0 and BBB0; they map to AA, A and BBB of the registry scale. The KTB 3y of the SAME response (the
 * 국고채권 row) is stored with them, so spread = grade yield - KTB 3y always comes from one source and one date.
 * Each grade yield is a valuation firm's own derivation, not an average of actual issuers (KOFIA Q&A 2022-08-05).
 */
import type { Database } from "bun:sqlite";

export const KOFIA_SOURCE_CODE = "kofia";
export const KOFIA_ENDPOINT = "https://www.kofiabond.or.kr/proframeWeb/XMLSERVICES/";
/** Human-facing page of the data (menu 시가평가 > 채권시가평가수익률). Shown as the source URL; never scraped as HTML. */
export const KOFIA_PAGE_URL =
  "https://www.kofiabond.or.kr/websquare/websquare.html?w2xPath=/xml/Com/Common_TabMnuDsp.xml&divisionId=MBIS01070010000000";
export const KOFIA_SOURCE_LABEL = "금융투자협회 채권정보센터 채권시가평가수익률 (평가사 평균, 3년)";
export const KOFIA_PARSER_VERSION = "kofia-1";
/** Env switch: automated collection runs only when this is exactly "on" (default off, ADR-0208 slice 4). */
export const KOFIA_COLLECT_ENV = "CO_NEWBIZ_KOFIA_COLLECT";
/** Scheduler job key of the scheduled collection (scripts/co-newbiz/jobs/collect/kofia.ts). */
export const KOFIA_JOB_KEY = "collect.kofia";
/** Run key of the manual (button) collection in job_run; the freshness check reads both. */
export const KOFIA_MANUAL_JOB_KEY = "wacc-kofia.collect";
/** How many calendar days back a scheduled run looks for business days that are still missing (not stored). */
export const KOFIA_BACKFILL_DAYS = 10;
/**
 * The day D's yields are assumed to be published from D 18:30 KST (the scheduled run is 18:45 KST; KOFIA states no
 * time, so this is an assumption). A later publication is picked up by the next run, whose backfill covers the gap.
 */
export const KOFIA_PUBLISH_MINUTE_KST = 18 * 60 + 30;
/** The tenor of the stored series (column attrCd 0300). */
export const KOFIA_TENOR = "3y";
const TENOR_ATTR_CODE = "0300";

/** KOFIA valuation-firm codes selected for the average (the page's own default for 평가사 평균, 23.1.9~). */
export const KOFIA_EVALUATOR_CODES = ["A10002", "A10003", "A10004", "A10005", "A10006"] as const;
export const KOFIA_REPORT_COMP_AVERAGE = "A20000";

/** sigaBrnCd of the 회사채 I (공모사채) 무보증 rows -> grade of the registry scale. The label of the row is checked too. */
const PUBLIC_UNSECURED_GRADE_BY_CODE: Readonly<Record<string, string>> = {
  "7010110": "AAA",
  "7010121": "AA+",
  "7010122": "AA",
  "7010123": "AA-",
  "7010131": "A+",
  "7010132": "A",
  "7010133": "A-",
  "7010211": "BBB+",
  "7010212": "BBB",
  "7010213": "BBB-",
};
const KTB_CODE = "1010000";

export const KOFIA_GRADES: readonly string[] = Object.values(PUBLIC_UNSECURED_GRADE_BY_CODE);

export function kofiaGradeSeriesId(grade: string): string {
  return `kofia:corp-public-unsecured:${grade}:${KOFIA_TENOR}`;
}
export const KOFIA_KTB_SERIES_ID = `kofia:ktb:${KOFIA_TENOR}`;

/** True only for the exact value "on" (case-insensitive, trimmed): anything else, including unset, keeps collection off. */
export function kofiaCollectEnabledFrom(value: string | undefined | null): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "on";
}

// ── XML helpers (the service answers flat, well-formed XML) ─────────────────

function decodeEntities(s: string): string {
  return s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
function encodeXml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Flat `<tag>text</tag>` pairs of one block (empty elements `<tag />` are skipped). First occurrence wins. */
function flat(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/<(\w+)>([^<]*)<\/\1>/g)) {
    if (!(m[1] in out)) out[m[1]] = decodeEntities(m[2]).trim();
  }
  return out;
}
function blocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);
}

// ── Requests ────────────────────────────────────────────────────────────────

export type KofiaFunction = "getExistMaxDate" | "getHeadList" | "selectDay";

/** Request body of one service call. `date` is YYYYMMDD. Pure: the collector posts it, nothing here touches the network. */
export function buildKofiaRequest(fn: KofiaFunction, date?: string): string {
  const header =
    "<proframeHeader><pfmAppName>BIS-KOFIABOND</pfmAppName><pfmSvcName>BISBndSrtPrcSrchSO</pfmSvcName>" +
    `<pfmFnName>${fn}</pfmFnName></proframeHeader><systemHeader></systemHeader>`;
  let dto: string;
  if (fn === "getExistMaxDate") {
    dto = "<BISComDspDatDTO></BISComDspDatDTO>";
  } else if (fn === "getHeadList") {
    dto = `<BISBndSrtPrcDayDTO><standardDt>${encodeXml(date ?? "")}</standardDt><applyGbCd>C00</applyGbCd></BISBndSrtPrcDayDTO>`;
  } else {
    const evaluators = KOFIA_EVALUATOR_CODES.map((c, i) => `<val${i + 1}>${c}</val${i + 1}>`).join("");
    dto =
      `<BISBndSrtPrcDayDTO><standardDt>${encodeXml(date ?? "")}</standardDt>` +
      `<reportCompCd>${KOFIA_REPORT_COMP_AVERAGE}</reportCompCd><applyGbCd>C00</applyGbCd>${evaluators}</BISBndSrtPrcDayDTO>`;
  }
  return `<?xml version="1.0" encoding="utf-8"?><message>${header}${dto}</message>`;
}

// ── Responses ───────────────────────────────────────────────────────────────

export class KofiaParseError extends Error {
  constructor(
    readonly code: "unexpected_response" | "no_tenor_column" | "no_data" | "no_ktb_row" | "no_grade_rows",
    message: string,
  ) {
    super(message);
    this.name = "KofiaParseError";
  }
}

const isRealResponse = (xml: string) => /<proframeHeader>/.test(xml) && !/<html[\s>]/i.test(xml);

/** `getExistMaxDate` -> the latest published date (YYYY-MM-DD). Throws KofiaParseError for any other shape. */
export function parseKofiaMaxDate(xml: string): string {
  if (!isRealResponse(xml))
    throw new KofiaParseError("unexpected_response", "getExistMaxDate: not a service response.");
  const m = xml.match(/<BISComDspDatDTO>[\s\S]*?<val1>(\d{8})<\/val1>/);
  if (!m) throw new KofiaParseError("unexpected_response", "getExistMaxDate: no date in the response.");
  return `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`;
}

export interface KofiaHeadColumn {
  attrCd: string;
  label: string;
}

/** `getHeadList` -> the maturity columns in order (val1 = first). */
export function parseKofiaHeadList(xml: string): KofiaHeadColumn[] {
  if (!isRealResponse(xml)) throw new KofiaParseError("unexpected_response", "getHeadList: not a service response.");
  const cols = blocks(xml, "BISBndSrtPrcDayDTO").map((b) => {
    const f = flat(b);
    return { attrCd: f.attrCd ?? "", label: f.remainTrmCtgy ?? "" };
  });
  return cols.filter((c) => c.attrCd !== "");
}

export interface KofiaDaySnapshot {
  /** YYYY-MM-DD, the date the request asked for (the rows carry no date of their own). */
  date: string;
  /** Percent points. */
  ktbPct: number;
  /** Grade of the registry scale -> 3y yield, percent points. */
  grades: Record<string, number>;
  /** Rows that were skipped and why (label mismatch, non-numeric value): never silent. */
  warnings: string[];
}

/** Normalise KOFIA's flat-notch spelling (AA0 -> AA, A0 -> A, BBB0 -> BBB). */
export function normalizeKofiaGrade(label: string): string {
  const t = label.normalize("NFKC").replace(/\s+/g, "");
  return /^(AA|A|BBB|BB|B)0$/.test(t) ? t.slice(0, -1) : t;
}

/**
 * `selectDay` (valuation-firm average, all firms) -> the KTB 3y and the public-offering unsecured grade yields at the
 * 3y column named by the head list. Throws KofiaParseError when the response is not a service response, carries no
 * rows (a holiday: `no_data`), has no 3y column, no KTB row or no grade row. A row whose label contradicts its code is
 * skipped with a warning, never trusted.
 */
export function parseKofiaDay(xml: string, headXml: string, date: string): KofiaDaySnapshot {
  if (!isRealResponse(xml)) throw new KofiaParseError("unexpected_response", "selectDay: not a service response.");
  const head = parseKofiaHeadList(headXml);
  const idx = head.findIndex((c) => c.attrCd === TENOR_ATTR_CODE);
  if (idx < 0) throw new KofiaParseError("no_tenor_column", "getHeadList has no 3-year column (attrCd 0300).");
  const valueKey = `val${idx + 1}`;
  const rows = blocks(xml, "BISBndSrtPrcDayDTO").map(flat);
  if (rows.length === 0) throw new KofiaParseError("no_data", `selectDay returned no rows for ${date}.`);
  const warnings: string[] = [];
  const num = (raw: string | undefined, what: string): number | null => {
    if (raw === undefined || raw === "") return null;
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) {
      warnings.push(`${what}: non-positive or non-numeric value '${raw}'`);
      return null;
    }
    return v;
  };
  let ktb: number | null = null;
  const grades: Record<string, number> = {};
  for (const r of rows) {
    const code = r.sigaBrnCd ?? "";
    if (code === KTB_CODE) {
      ktb = num(r[valueKey], "KTB 3y");
      continue;
    }
    const grade = PUBLIC_UNSECURED_GRADE_BY_CODE[code];
    if (!grade) continue;
    const labelOk =
      (r.largeCategoryMrk ?? "").startsWith("회사채 I") &&
      (r.typeNmMrk ?? "") === "무보증" &&
      normalizeKofiaGrade(r.creditRnkMrk ?? "") === grade;
    if (!labelOk) {
      warnings.push(
        `row ${code}: label '${r.largeCategoryMrk ?? ""}/${r.typeNmMrk ?? ""}/${r.creditRnkMrk ?? ""}' does not match grade ${grade}`,
      );
      continue;
    }
    const v = num(r[valueKey], `${grade} 3y`);
    if (v !== null) grades[grade] = v;
  }
  if (ktb === null) throw new KofiaParseError("no_ktb_row", "selectDay has no usable KTB 3y row.");
  if (Object.keys(grades).length === 0)
    throw new KofiaParseError("no_grade_rows", "selectDay has no usable grade row.");
  return { date, ktbPct: ktb, grades, warnings };
}

// ── Read helpers over fact_market_observation ───────────────────────────────

export interface KofiaGradeReading {
  /** YYYY-MM-DD */
  date: string;
  /** YYYY-MM, the month the suggestion's as-of carries. */
  month: string;
  gradeYieldPct: number;
  ktbPct: number;
  seriesId: string;
  ktbSeriesId: string;
  /** Grade yields of the same date (for the AA- and BBB- anchors line); null when not stored. */
  aaMinusPct: number | null;
  bbbMinusPct: number | null;
}

/**
 * Latest date at which BOTH the grade's 3y yield and the KTB 3y of the same date are stored (max revision of each),
 * optionally restricted to one YYYY-MM month. Null when KOFIA data was never collected (switch off) or has no such date.
 */
export function readKofiaGradeReading(db: Database, grade: string, month?: string | null): KofiaGradeReading | null {
  if (!KOFIA_GRADES.includes(grade)) return null;
  const seriesId = kofiaGradeSeriesId(grade);
  const row = db
    .query(
      `SELECT p.start_date AS d, g.value AS grade_pct, k.value AS ktb_pct
       FROM fact_market_observation g
       JOIN md_period p ON p.id = g.period_id AND p.period_type = 'date'
       JOIN fact_market_observation k ON k.series_id = ? AND k.period_id = g.period_id
        AND k.revision_no = (SELECT MAX(k2.revision_no) FROM fact_market_observation k2
                             WHERE k2.series_id = k.series_id AND k2.period_id = k.period_id)
       WHERE g.series_id = ?
         AND g.revision_no = (SELECT MAX(g2.revision_no) FROM fact_market_observation g2
                              WHERE g2.series_id = g.series_id AND g2.period_id = g.period_id)
         AND (? IS NULL OR substr(p.start_date, 1, 7) = ?)
       ORDER BY p.start_date DESC LIMIT 1`,
    )
    .get(KOFIA_KTB_SERIES_ID, seriesId, month ?? null, month ?? null) as
    | { d: string; grade_pct: number; ktb_pct: number }
    | undefined;
  if (!row) return null;
  const at = (g: string): number | null => {
    const r = db
      .query(
        `SELECT o.value FROM fact_market_observation o
         JOIN md_period p ON p.id = o.period_id AND p.period_type = 'date'
         WHERE o.series_id = ? AND p.start_date = ?
           AND o.revision_no = (SELECT MAX(o2.revision_no) FROM fact_market_observation o2
                                WHERE o2.series_id = o.series_id AND o2.period_id = o.period_id)
         LIMIT 1`,
      )
      .get(kofiaGradeSeriesId(g), row.d) as { value: number } | undefined;
    return r?.value ?? null;
  };
  return {
    date: row.d,
    month: row.d.slice(0, 7),
    gradeYieldPct: row.grade_pct,
    ktbPct: row.ktb_pct,
    seriesId,
    ktbSeriesId: KOFIA_KTB_SERIES_ID,
    aaMinusPct: at("AA-"),
    bbbMinusPct: at("BBB-"),
  };
}

/** Latest date with a stored KTB 3y of this source (the collect row's status line); null when nothing was collected. */
export function latestKofiaDate(db: Database): string | null {
  const row = db
    .query(
      `SELECT MAX(p.start_date) AS d FROM fact_market_observation o
       JOIN md_period p ON p.id = o.period_id AND p.period_type = 'date'
       WHERE o.series_id = ?`,
    )
    .get(KOFIA_KTB_SERIES_ID) as { d: string | null } | undefined;
  return row?.d ?? null;
}

// ── Business days and freshness (what is "already up to date") ──────────────

const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const isWeekend = (ms: number) => [0, 6].includes(new Date(ms).getUTCDay());

/** The instant (UTC) from which the yields of `date` (YYYY-MM-DD, a KST calendar day) are assumed to be published. */
export function kofiaPublishMoment(date: string): Date {
  return new Date(dayMs(date) + KOFIA_PUBLISH_MINUTE_KST * 60_000 - KST_OFFSET_MS);
}

/**
 * The most recent weekday whose publication moment has passed at `now`: what a complete store would hold. Public
 * holidays are not modelled (a holiday never gets data); kofiaFreshness covers that through the last successful check.
 */
export function kofiaExpectedLatestDate(now: Date): string {
  const kst = now.getTime() + KST_OFFSET_MS;
  let day = Math.floor(kst / DAY_MS) * DAY_MS;
  if (kst - day < KOFIA_PUBLISH_MINUTE_KST * 60_000) day -= DAY_MS;
  while (isWeekend(day)) day -= DAY_MS;
  return ymd(day);
}

/**
 * Weekdays (YYYY-MM-DD, ascending) strictly after `storedThrough` (null: none stored) and strictly before `latest`, no more
 * than `maxBackDays` calendar days before `latest` (inclusive): the days a scheduled run still has to fetch besides the latest one.
 * Gaps older than the latest stored day are not chased (they would include holidays that never get data).
 */
export function kofiaMissingBusinessDays(storedThrough: string | null, latest: string, maxBackDays: number): string[] {
  const from = Math.max(
    dayMs(latest) - maxBackDays * DAY_MS,
    storedThrough ? dayMs(storedThrough) + DAY_MS : -Infinity,
  );
  const out: string[] = [];
  for (let t = dayMs(latest) - DAY_MS; t >= from; t -= DAY_MS) if (!isWeekend(t)) out.push(ymd(t));
  return out.reverse();
}

/** True when the KTB 3y of `date` is stored (a day is stored atomically: KTB and grades are written in one transaction). */
export function isKofiaDayStored(db: Database, date: string): boolean {
  const row = db
    .query(
      `SELECT 1 AS x FROM fact_market_observation o JOIN md_period p ON p.id = o.period_id AND p.period_type = 'date'
       WHERE o.series_id = ? AND p.start_date = ? LIMIT 1`,
    )
    .get(KOFIA_KTB_SERIES_ID, date);
  return !!row;
}

export interface KofiaFreshness {
  /** Latest stored KOFIA day (YYYY-MM-DD) or null when nothing was collected. */
  latestStoredDate: string | null;
  /** The weekday a complete store would hold at `now`. */
  expectedDate: string;
  /** No fetch is needed: the expected day is stored, or a check after its publication found nothing newer. */
  upToDate: boolean;
}

/**
 * Whether the store is current, from stored data only (no network). Up to date when the latest stored day reaches the
 * expected day, or when a SUCCESSFUL run (scheduled or manual) finished after the expected day's publication moment
 * and saw the service's latest day equal to the latest stored one (a public holiday: nothing newer exists).
 */
export function kofiaFreshness(db: Database, now: Date): KofiaFreshness {
  const latestStoredDate = latestKofiaDate(db);
  const expectedDate = kofiaExpectedLatestDate(now);
  if (!latestStoredDate) return { latestStoredDate, expectedDate, upToDate: false };
  if (latestStoredDate >= expectedDate) return { latestStoredDate, expectedDate, upToDate: true };
  const since = kofiaPublishMoment(expectedDate).toISOString();
  const rows = db
    .query(
      `SELECT detail_json FROM job_run
       WHERE job_key IN (?, ?) AND status = 'success' AND finished_at >= ? ORDER BY finished_at DESC LIMIT 5`,
    )
    .all(KOFIA_JOB_KEY, KOFIA_MANUAL_JOB_KEY, since) as Array<{ detail_json: string | null }>;
  const confirmed = rows.some((r) => {
    try {
      return (
        (JSON.parse(r.detail_json ?? "null") as { max_published_date?: string } | null)?.max_published_date ===
        latestStoredDate
      );
    } catch {
      return false;
    }
  });
  return { latestStoredDate, expectedDate, upToDate: confirmed };
}
