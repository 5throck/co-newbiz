// @version 1.1.0
/**
 * Disclosed credit rating from DART filings (ADR-0208 D2, design 2026-11-26-wacc-credit-rating-spread section 5.1).
 *
 * PURE: text in, rows out; no DB, no network. The fetch and the cache live in
 * app/web-next/lib/credit-rating-collector.ts and db/repositories/dart-credit-rating.repository.ts.
 *
 * Three things are parsed:
 *   1. the business-report section "신용평가에 관한 사항" (three real shapes: narrative sentence + table; table-only
 *      with a multi-year history; "해당사항이 없어 기재를 생략합니다");
 *   2. the debt-securities issuance table ("채무증권 발행실적"): coupon, rating cell "BBB+, BBB+(NICE신용평가, ...)",
 *      maturity, outstanding flag;
 *   3. the OpenDART bdRs.json `cdrt_int` rating text of a debt-securities registration.
 *
 * The filing text is TAG-STRIPPED and whitespace-collapsed (fetchDisclosureText), so table cells cannot be read by
 * column. Rows are therefore extracted by PATTERN: `date + instrument + grade + agency` for the section, and the
 * `<grades>(<agencies>)` rating cell for the issuance table.
 *
 * A parse that finds nothing is a RECORDED STATUS, never "unrated" (design section 12): `parse_failed` means the
 * section is there but no row could be read.
 *
 * A fourth kind of row is read from the same section: the yearly ISSUER rating of a credit-information bureau
 * ("기업신용평가" table: `date grade cash-flow-grade agency`). It is a LOWER-CONFIDENCE rung (ADR-0208 amendment
 * 2026-11-26): instrument "issuer_bureau", never selectable as a corporate-bond rating, picked only by
 * selectBureauRating. Grades such as "BBB0" are normalised to the scale ("BBB"); the cash-flow grade (CR-3, C+, B)
 * is kept in its own field and never read as a rating. The agency of a row is carried forward over rows that state
 * none (merged cells) unless that would give one bureau two different grades on one date.
 *
 * Skipped as NOT an issuer rating (kept in the snapshot with an `excluded_reason`, never selected): guaranteed,
 * secured, structured and subordinated issues; short-term (CP) grades such as A1 (never read as the long-term
 * grade A); preliminary ratings; foreign-scale or unlisted agencies (Moody's, S&P, R&I, ...).
 *
 * Korean literals are limited to this file's structural keywords (headings, instrument and outlook words) - the
 * agency aliases come from the registry (region-profiles/KR.yaml credit_rating_references.data.agencies).
 */
import type { CreditRatingRegistry } from "./credit-spread-map.ts";
import { seoulToday } from "./iso-date.ts";

/** Bump to re-parse every filing once (one fetch each) - the only re-parse path for an existing rcept_no. */
export const CREDIT_RATING_PARSER_VERSION = "cr-2";

export type RatingInstrument = "corporate_bond" | "commercial_paper" | "issuer_bureau" | "other";
export type RatingOutlook = "stable" | "positive" | "negative" | "developing";
export type RatingExcludedReason =
  | "guaranteed"
  | "secured"
  | "structured"
  | "subordinated"
  | "preliminary"
  | "short_term"
  | "not_corporate_bond"
  | "agency_not_domestic"
  | "grade_unmapped"
  | "rated_on_unknown";
export type RatingRowSource = "section" | "issuance" | "bdrs";

export interface CreditRatingRow {
  source: RatingRowSource;
  /** Registry agency id; null for a foreign or unlisted agency. */
  agency: string | null;
  agency_raw: string | null;
  instrument: RatingInstrument;
  /** Grade on the registry (domestic long-term) scale; null when the row is not a long-term domestic grade. */
  grade: string | null;
  grade_raw: string;
  outlook: RatingOutlook | null;
  /** YYYY-MM-DD. For the issuance table this is the issue date ("at issuance"); for bdRs the payment date. */
  rated_on: string | null;
  rated_on_precision: "day" | "month";
  excluded_reason: RatingExcludedReason | null;
  /** Verbatim text the row was read from (capped). */
  raw: string;
  /** Bureau issuer rows only: the cash-flow grade as filed (CR-3, C+, B); never a rating. */
  cashflow_grade_raw?: string | null;
  /** Bureau issuer rows only: true when the agency was inherited from an earlier row (merged cell), not stated in the row. */
  agency_carried?: boolean;
}

export interface CreditIssueRow {
  issued_on: string | null;
  instrument: RatingInstrument;
  /** INTEGER KRW millions (ADR-0061); null when the table's unit was not stated or the amount unreadable. */
  amount_krw_mn: number | null;
  /** Coupon in percent points as filed. */
  coupon_pct: number | null;
  rating_raw: string;
  maturity_on: string | null;
  outstanding: boolean | null;
  excluded_reason: RatingExcludedReason | null;
  raw: string;
}

export interface ParsedBusinessReport {
  status: "parsed" | "section_present_no_bond_rating" | "not_disclosed" | "section_absent" | "parse_failed";
  section_found: boolean;
  ratings: CreditRatingRow[];
  /** Null when the issuance table was not found (never read as "no issues"). */
  issues: CreditIssueRow[] | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Normalisation and small helpers.
// ---------------------------------------------------------------------------------------------------------------

/** NFKC (full-width -> half-width, the company-form glyph -> "(주)"), whitespace collapsed, "(주)" removed. */
function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\(\s*주\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const cap = (s: string, n = 300): string => (s.length > n ? s.slice(0, n) : s);

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

const DATE_RE = /(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\.?(?!\d)/g;

interface FoundDate {
  iso: string | null;
  at: number;
  end: number;
}

function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  const re = new RegExp(DATE_RE.source, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ iso: isoDate(Number(m[1]), Number(m[2]), Number(m[3])), at: m.index, end: m.index + m[0].length });
  }
  return out;
}

function agencyKey(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\(\s*주\s*\)/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

interface AgencyMatch {
  id: string;
  raw: string;
  at: number;
}

/** Agencies of `kind` named in `text` (registry aliases, longest first), in order of appearance, one per id. */
function findAgencies(text: string, registry: CreditRatingRegistry, kind: "bond" | "bureau" = "bond"): AgencyMatch[] {
  // Positions are taken on a whitespace-free copy mapped back to the original index: simpler and robust to spacing.
  const hay = text.normalize("NFKC").toLowerCase();
  const out: AgencyMatch[] = [];
  const seen = new Set<string>();
  const aliases = registry.agencies
    .filter((a) => a.kind === kind)
    .flatMap((a) => a.aliases.map((al) => ({ id: a.id, alias: al, key: agencyKey(al) })))
    .sort((x, y) => y.key.length - x.key.length);
  for (const { id, alias, key } of aliases) {
    if (seen.has(id)) continue;
    // Allow optional spaces between characters of the alias.
    const pattern = [...key].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*");
    const m = new RegExp(pattern).exec(hay);
    if (m) {
      seen.add(id);
      out.push({ id, raw: alias, at: m.index });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Registry agency id for one agency text, or null (foreign, unlisted or unreadable). */
function resolveAgency(text: string, registry: CreditRatingRegistry): string | null {
  const key = agencyKey(text);
  if (!key) return null;
  let best: { id: string; len: number } | null = null;
  for (const a of registry.agencies) {
    if (a.kind !== "bond") continue;
    for (const al of a.aliases) {
      const ak = agencyKey(al);
      if (ak && key.includes(ak) && (!best || ak.length > best.len)) best = { id: a.id, len: ak.length };
    }
  }
  return best?.id ?? null;
}

// Grades. Long-term domestic scale tokens never start with a lowercase letter; Moody's style (Aa2, Baa1) and the
// short-term A1..A3 / B grades are recognised only to be EXCLUDED, never read as the long-term grade.
const LONG_GRADE = "(?:AAA|AA|A|BBB|BB|B|CCC|CC|C|D)";
const LONG_GRADE_TOKEN = new RegExp(`(?<![A-Za-z0-9+\\-])(${LONG_GRADE})([+\\-]?)(?![A-Za-z0-9])`);
const SHORT_GRADE_TOKEN = /(?<![A-Za-z0-9+-])(A[1-3])([+-]?)(?![A-Za-z0-9])/;
const GRADE_CELL_TOKEN =
  /^(?:(?:AAA|AA|A|BBB|BB|B|CCC|CC|C|D)[+-]?|A[1-3][+-]?|(?:Aaa|Aa[1-3]|Baa[1-3]|Ba[1-3]|B[1-3]|Caa[1-3]?|Ca))$/;
const SCALE_RANGE = /\(\s*(?:AAA|AA|A1|A)[+-]?\s*[~∼-]\s*[A-D0-9+-]{1,4}\s*\)/g;

const OUTLOOK_WORDS: Record<string, RatingOutlook> = {
  안정적: "stable",
  긍정적: "positive",
  부정적: "negative",
  유동적: "developing",
  stable: "stable",
  positive: "positive",
  negative: "negative",
  developing: "developing",
};
const OUTLOOK_RE_SRC = "안정적|긍정적|부정적|유동적|stable|positive|negative|developing";

function outlookOf(word: string | undefined): RatingOutlook | null {
  return word ? (OUTLOOK_WORDS[word.toLowerCase()] ?? OUTLOOK_WORDS[word] ?? null) : null;
}

/** The registry scale grade of a raw token (`AA-`), or null when it is not on the scale. */
function scaleGrade(token: string, registry: CreditRatingRegistry): string | null {
  return registry.scale.includes(token) ? token : null;
}

// Excluded issue kinds. "무보증" (unguaranteed) and "무담보" (unsecured) are the NORMAL corporate bond forms and must
// NOT be read as guaranteed / secured: they are blanked out before the keyword test.
const STRUCTURED_RE = /유동화|구조화|ABS|ABCP|자산\s*담보/;
const SUBORDINATED_RE = /후순위|신종\s*자본|조건부\s*자본|하이브리드/;

function excludedKind(text: string): RatingExcludedReason | null {
  const t = text.replace(/무\s*보증/g, " ").replace(/무\s*담보/g, " ");
  if (STRUCTURED_RE.test(t)) return "structured";
  if (SUBORDINATED_RE.test(t)) return "subordinated";
  if (/보증/.test(t)) return "guaranteed";
  if (/담보/.test(t)) return "secured";
  return null;
}

type TextInstrument = "corporate_bond" | "commercial_paper" | "other";

function instrumentOf(text: string): { instrument: TextInstrument; at: number } | null {
  const bond = /회사채/.exec(text);
  const cp = /기업\s*어음|전자\s*단기\s*사채|단기\s*사채|\bCP\b|\bABCP\b/.exec(text);
  const other = /전환\s*사채|신주\s*인수권부\s*사채|교환\s*사채|이익\s*참가부\s*사채|금융채|채권/.exec(text);
  const cands = [
    bond ? { instrument: "corporate_bond" as const, at: bond.index } : null,
    cp ? { instrument: "commercial_paper" as const, at: cp.index } : null,
    other ? { instrument: "other" as const, at: other.index } : null,
  ].filter((x): x is { instrument: TextInstrument; at: number } => x !== null);
  if (cands.length === 0) return null;
  return cands.sort((a, b) => a.at - b.at)[0] ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Section "신용평가에 관한 사항".
// ---------------------------------------------------------------------------------------------------------------

const SECTION_HEADING = /신용\s*평가\s*에\s*관한\s*사항/g;
// A numbered/lettered heading ("차. 「상법」 ..." as well as "카. 기타 ..."): the optional corner bracket stops a heading that
// opens with a quoted statute name from bleeding into the last table row of the previous section.
const NEXT_HEADING = /(?:^|\s)(?:[가나다라마바사아자차카타파하]|\d{1,2}|[IVX]{1,4})\.\s*[「『]?\s*[가-힣]{2}/g;
const NOT_APPLICABLE = /해당\s*사항\s*(?:이|은)?\s*없/;
const SECTION_MAX_CHARS = 4000;

/** Section bodies (heading excluded) for every heading occurrence, in document order. */
function sectionBodies(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(SECTION_HEADING.source, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index + m[0].length;
    const rest = text.slice(start, start + SECTION_MAX_CHARS);
    const next = new RegExp(NEXT_HEADING.source, "g");
    let end = rest.length;
    for (let n = next.exec(rest); n; n = next.exec(rest)) {
      if (n.index > 3) {
        end = n.index;
        break;
      }
    }
    out.push(rest.slice(0, end));
  }
  return out;
}

function firstGrade(
  text: string,
  registry: CreditRatingRegistry,
): { grade: string | null; raw: string; short: boolean; end: number } | null {
  const l = LONG_GRADE_TOKEN.exec(text);
  const s = SHORT_GRADE_TOKEN.exec(text);
  if (!l && !s) return null;
  if (s && (!l || s.index <= l.index))
    return { grade: null, raw: s[1] + s[2], short: true, end: s.index + s[0].length };
  const raw = (l as RegExpExecArray)[1] + (l as RegExpExecArray)[2];
  return {
    grade: scaleGrade(raw, registry),
    raw,
    short: false,
    end: (l as RegExpExecArray).index + (l as RegExpExecArray)[0].length,
  };
}

function rowFromChunk(
  chunk: string,
  rated: { iso: string | null; precision: "day" | "month" },
  registry: CreditRatingRegistry,
): CreditRatingRow | null {
  const inst = instrumentOf(chunk);
  const g = firstGrade(inst ? chunk.slice(inst.at) : chunk, registry);
  const agencies = findAgencies(chunk, registry);
  const agencyRaw = agencies[0]?.raw ?? null;
  if (!inst && !g) return null;
  const instrument: RatingInstrument = inst?.instrument ?? "other";
  const after = g ? (inst ? chunk.slice(inst.at) : chunk).slice(g.end) : "";
  const outlook = outlookOf(new RegExp(`^\\s*\\(\\s*(${OUTLOOK_RE_SRC})\\s*\\)`, "i").exec(after)?.[1]);
  let excluded: RatingExcludedReason | null = null;
  if (instrument !== "corporate_bond")
    excluded = instrument === "commercial_paper" ? "short_term" : "not_corporate_bond";
  else if (/예비/.test(chunk)) excluded = "preliminary";
  else excluded = excludedKind(chunk);
  if (!excluded && !g) excluded = "grade_unmapped";
  if (!excluded && g?.short) excluded = "short_term";
  if (!excluded && g && g.grade === null) excluded = "grade_unmapped";
  if (!excluded && !agencies[0]) excluded = "agency_not_domestic";
  if (!excluded && !rated.iso) excluded = "rated_on_unknown";
  return {
    source: "section",
    agency: agencies[0]?.id ?? null,
    agency_raw: agencyRaw,
    instrument,
    grade: excluded === "short_term" || excluded === "not_corporate_bond" ? null : (g?.grade ?? null),
    grade_raw: g?.raw ?? "",
    outlook,
    rated_on: rated.iso,
    rated_on_precision: rated.precision,
    excluded_reason: excluded,
    raw: cap(chunk.trim()),
  };
}

const ROW_CHUNK_MAX = 160;

// ---------------------------------------------------------------------------------------------------------------
// Credit-bureau issuer ratings ("기업신용평가"): `date grade cash-flow-grade [-] [agency]`.
// ---------------------------------------------------------------------------------------------------------------

const BUREAU_G = "(?:AAA|AA|A|BBB|BB|B|CCC|CC|C|D)";
// Issuer grade (a trailing 0 is the "flat" notch: BBB0 = BBB), then the cash-flow grade (CR-3 or a letter grade).
const BUREAU_ROW_STRICT = new RegExp(
  `(?<![A-Za-z0-9+\\-])(${BUREAU_G})([+\\-]|0)?(?![A-Za-z0-9+\\-])\\s+(CR-\\d{1,2}|${BUREAU_G}[+\\-]?)(?![A-Za-z0-9])`,
  "g",
);
const BUREAU_ROW_LOOSE = new RegExp(
  `(?<![A-Za-z0-9+\\-])(${BUREAU_G})([+\\-]|0)?(?![A-Za-z0-9+\\-])(?:\\s+(CR-\\d{1,2}|${BUREAU_G}[+\\-]?)(?![A-Za-z0-9]))?`,
  "g",
);
const BUREAU_CONTEXT = /기업\s*신용\s*평가|현금\s*흐름\s*등급|신용\s*조사/;
const BOND_WORDS = /사채|채권|어음|\bCP\b|\bABCP\b|유동화/;
const AGENCY_TEXT = /^[-\s]*([가-힣A-Za-z][가-힣A-Za-z0-9().·&\s]{1,29}?)\s*$/;

interface BureauRead {
  grade_raw: string;
  cashflow: string | null;
  agency: string | null;
  agency_raw: string | null;
  raw: string;
}

/** Bureau issuer rows of one date chunk; null when the chunk is not a bureau row (so the bond path runs). */
function bureauReads(chunk: string, registry: CreditRatingRegistry, context: boolean): BureauRead[] | null {
  if (BOND_WORDS.test(chunk)) return null;
  const re = new RegExp((context ? BUREAU_ROW_LOOSE : BUREAU_ROW_STRICT).source, "g");
  const hits: Array<{ at: number; end: number; grade: string; mod: string; cf: string | null }> = [];
  for (let m = re.exec(chunk); m; m = re.exec(chunk)) {
    // The first row must open the chunk (a grade somewhere in prose is not a table row).
    if (hits.length === 0 && chunk.slice(0, m.index).replace(/[\s\-]/g, "") !== "") return null;
    hits.push({ at: m.index, end: m.index + m[0].length, grade: m[1] ?? "", mod: m[2] ?? "", cf: m[3] ?? null });
  }
  if (hits.length === 0) return null;
  return hits.map((h, i) => {
    const rest = chunk.slice(h.end, hits[i + 1]?.at ?? chunk.length);
    const named = findAgencies(rest, registry, "bureau")[0] ?? null;
    const unknown = named ? null : (AGENCY_TEXT.exec(rest)?.[1]?.trim() ?? null);
    return {
      grade_raw: h.grade + h.mod,
      cashflow: h.cf,
      agency: named?.id ?? null,
      agency_raw: named?.raw ?? unknown,
      raw: cap(chunk.slice(h.at, hits[i + 1]?.at ?? chunk.length).trim()),
    };
  });
}

function bureauRow(read: BureauRead, rated: string | null, registry: CreditRatingRegistry): CreditRatingRow {
  const normalised = read.grade_raw.endsWith("0") ? read.grade_raw.slice(0, -1) : read.grade_raw;
  const grade = scaleGrade(normalised, registry);
  const excluded: RatingExcludedReason | null = !grade ? "grade_unmapped" : !rated ? "rated_on_unknown" : null;
  return {
    source: "section",
    agency: read.agency,
    agency_raw: read.agency_raw,
    instrument: "issuer_bureau",
    grade: excluded === "grade_unmapped" ? null : grade,
    grade_raw: read.grade_raw,
    outlook: null,
    rated_on: rated,
    rated_on_precision: "day",
    excluded_reason: excluded,
    raw: read.raw,
    cashflow_grade_raw: read.cashflow,
    agency_carried: false,
  };
}

/**
 * Merged agency cells: the agency written in one row applies to the rows after it that state none, until another
 * agency appears. It is NOT carried when that would give one bureau two different grades on the same date (the filing
 * then has two bureaus and the unnamed row belongs to the other one): such a row stays unnamed. Rows before the first
 * stated agency stay unnamed. A row that names an agency this registry does not know resets the carry.
 */
function carryBureauAgency(rows: CreditRatingRow[]): void {
  let current: { id: string | null; raw: string | null } | null = null;
  const seen = new Map<string, string>(); // `${agency}|${rated_on}` -> grade
  for (const r of rows) {
    if (r.instrument !== "issuer_bureau") continue;
    const stated = r.agency !== null || r.agency_raw !== null;
    if (stated) current = { id: r.agency, raw: r.agency_raw };
    else if (current) {
      const key = `${current.id ?? current.raw}|${r.rated_on}`;
      const prior = seen.get(key);
      if (prior === undefined || prior === (r.grade ?? r.grade_raw)) {
        r.agency = current.id;
        r.agency_raw = current.raw;
        r.agency_carried = true;
      }
    }
    if (r.agency !== null || r.agency_raw !== null)
      seen.set(`${r.agency ?? r.agency_raw}|${r.rated_on}`, r.grade ?? r.grade_raw);
  }
}

/** Table rows: split the body at every date, then at every instrument keyword (merged date cells share the date). */
function tableRows(body: string, registry: CreditRatingRegistry): CreditRatingRow[] {
  const text = body.replace(SCALE_RANGE, " ");
  const dates = findDates(text);
  const rows: CreditRatingRow[] = [];
  const bureauContext = BUREAU_CONTEXT.test(text);
  for (const [i, d] of dates.entries()) {
    const stop = dates[i + 1]?.at ?? text.length;
    const chunk = text.slice(d.end, Math.min(stop, d.end + ROW_CHUNK_MAX));
    const bureau = bureauReads(chunk, registry, bureauContext);
    if (bureau) {
      for (const b of bureau) rows.push(bureauRow(b, d.iso, registry));
      continue;
    }
    // Sub-rows: each instrument keyword starts one.
    const starts: number[] = [];
    const re = /회사채|기업\s*어음|전자\s*단기\s*사채|단기\s*사채/g;
    for (let m = re.exec(chunk); m; m = re.exec(chunk)) starts.push(m.index);
    const pieces = starts.length > 1 ? starts.map((s, k) => chunk.slice(s, starts[k + 1] ?? chunk.length)) : [chunk];
    for (const p of pieces) {
      const r = rowFromChunk(p, { iso: d.iso, precision: "day" }, registry);
      if (r) rows.push(r);
    }
  }
  carryBureauAgency(rows);
  return rows;
}

/** Sentence fallback: "...2025년 5월 A, B, C로부터 각각 회사채등급 AA-를 받았습니다" (used only when no table row parsed). */
function sentenceRows(body: string, registry: CreditRatingRegistry): CreditRatingRow[] {
  const text = body.replace(SCALE_RANGE, " ");
  const rows: CreditRatingRow[] = [];
  const marker = /회사채\s*(?:신용)?\s*등급/g;
  const markers: Array<{ at: number; end: number }> = [];
  for (let m = marker.exec(text); m; m = marker.exec(text)) markers.push({ at: m.index, end: m.index + m[0].length });
  let prevEnd = 0;
  let carriedDate: { iso: string | null; precision: "day" | "month" } | null = null;
  for (const mk of markers) {
    const segment = text.slice(prevEnd, mk.at);
    const dateRe = /(\d{4})\s*년\s*(\d{1,2})\s*월(?:\s*(\d{1,2})\s*일)?/g;
    let last: RegExpExecArray | null = null;
    for (let m = dateRe.exec(segment); m; m = dateRe.exec(segment)) last = m;
    if (last) {
      const day = last[3] ? Number(last[3]) : 1;
      carriedDate = { iso: isoDate(Number(last[1]), Number(last[2]), day), precision: last[3] ? "day" : "month" };
    }
    const tail = text.slice(mk.end, mk.end + 40);
    const g = firstGrade(tail, registry);
    const agencies = findAgencies(segment.slice(Math.max(0, last ? last.index : 0)), registry);
    prevEnd = mk.end;
    if (!g || agencies.length === 0) continue;
    const outlook = outlookOf(
      new RegExp(`^\\s*[가-힣]{0,2}\\s*\\(\\s*(${OUTLOOK_RE_SRC})\\s*\\)`, "i").exec(tail.slice(g.end))?.[1],
    );
    for (const a of agencies) {
      let excluded: RatingExcludedReason | null = null;
      if (g.short) excluded = "short_term";
      else if (g.grade === null) excluded = "grade_unmapped";
      else if (!carriedDate?.iso) excluded = "rated_on_unknown";
      rows.push({
        source: "section",
        agency: a.id,
        agency_raw: a.raw,
        instrument: "corporate_bond",
        grade: excluded ? null : g.grade,
        grade_raw: g.raw,
        outlook,
        rated_on: carriedDate?.iso ?? null,
        rated_on_precision: carriedDate?.precision ?? "day",
        excluded_reason: excluded,
        raw: cap(text.slice(Math.max(0, mk.at - 120), mk.end + 40).trim()),
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------
// Rating cell ("<grades>(<agencies>)") shared by the issuance table and bdRs `cdrt_int`.
// ---------------------------------------------------------------------------------------------------------------

export interface RatingCellEntry {
  grade_raw: string;
  agency: string | null;
  agency_raw: string;
  outlook: RatingOutlook | null;
}

const TRAILING_TOKENS = /((?:[A-Za-z][A-Za-z0-9+-]{0,4}\s*,\s*)*[A-Za-z][A-Za-z0-9+-]{0,4})\s*$/;

/** Lift "(stable)" outlook words out of normalised text, remembering the grade each one follows. */
function liftOutlooks(text: string): { text: string; outlooks: Map<string, RatingOutlook> } {
  const outlooks = new Map<string, RatingOutlook>();
  const lifted = text.replace(
    new RegExp(`([A-Za-z][A-Za-z0-9+\\-]{0,4})\\s*\\(\\s*(${OUTLOOK_RE_SRC})\\s*\\)`, "gi"),
    (_m, g: string, o: string) => {
      const ol = outlookOf(o);
      if (ol && !outlooks.has(g)) outlooks.set(g, ol);
      return g;
    },
  );
  return { text: lifted, outlooks };
}

/** The grade list directly before the parenthesis at `parenAt`, or null when it is not a grade list. */
function gradeListBefore(text: string, parenAt: number): { grades: string[]; start: number } | null {
  const before = text.slice(Math.max(0, parenAt - 48), parenAt);
  const t = TRAILING_TOKENS.exec(before);
  if (!t) return null;
  const grades = (t[1] ?? "").split(/\s*,\s*/).filter(Boolean);
  if (grades.length === 0 || !grades.every((g) => GRADE_CELL_TOKEN.test(g))) return null;
  return { grades, start: parenAt - t[0].length };
}

/** Zip a grade list with an agency list (see parseRatingCells). */
function zipCell(
  grades: string[],
  agencyTexts: string[],
  outlooks: Map<string, RatingOutlook>,
  registry: CreditRatingRegistry,
): RatingCellEntry[] {
  const zip: Array<[string, string]> = [];
  if (grades.length === agencyTexts.length) {
    for (const [i, a] of agencyTexts.entries()) zip.push([grades[i] as string, a]);
  } else if (grades.length === 1) for (const a of agencyTexts) zip.push([grades[0] as string, a]);
  else if (agencyTexts.length === 1) for (const g of grades) zip.push([g, agencyTexts[0] as string]);
  else for (const a of agencyTexts) zip.push(["", a]);
  return zip.map(([g, a]) => ({
    grade_raw: g,
    agency: resolveAgency(a, registry),
    agency_raw: a,
    outlook: g ? (outlooks.get(g) ?? null) : null,
  }));
}

function splitAgencies(inner: string): string[] {
  return inner
    .split(/\s*[/,、]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Parse the rating cells out of `text`: grade list followed by a parenthesised agency list. Grades and agencies are
 * zipped when the counts match; one grade is shared by every agency; one agency takes every grade; any other
 * combination is ambiguous and yields entries with an empty grade (kept as raw, never selectable).
 */
export function parseRatingCells(text: string, registry: CreditRatingRegistry): RatingCellEntry[] {
  const { text: lifted, outlooks } = liftOutlooks(normalize(text));
  return cellEntries(lifted, outlooks, registry);
}

function cellEntries(
  lifted: string,
  outlooks: Map<string, RatingOutlook>,
  registry: CreditRatingRegistry,
): RatingCellEntry[] {
  const out: RatingCellEntry[] = [];
  const parenRe = /\(([^()]+)\)/g;
  for (let m = parenRe.exec(lifted); m; m = parenRe.exec(lifted)) {
    const gl = gradeListBefore(lifted, m.index);
    if (!gl) continue;
    const agencyTexts = splitAgencies(m[1] ?? "");
    if (agencyTexts.length === 0) continue;
    out.push(...zipCell(gl.grades, agencyTexts, outlooks, registry));
  }
  return out;
}

function ratingRowFromCell(
  cell: RatingCellEntry,
  base: {
    source: RatingRowSource;
    instrument: RatingInstrument;
    rated_on: string | null;
    precision: "day" | "month";
    excluded: RatingExcludedReason | null;
    raw: string;
  },
  registry: CreditRatingRegistry,
): CreditRatingRow {
  const isShort = /^A[1-3][+-]?$/.test(cell.grade_raw);
  const grade = cell.grade_raw && !isShort ? scaleGrade(cell.grade_raw, registry) : null;
  let excluded: RatingExcludedReason | null = base.excluded;
  if (!excluded && base.instrument === "commercial_paper") excluded = "short_term";
  else if (!excluded && base.instrument !== "corporate_bond") excluded = "not_corporate_bond";
  if (!excluded && isShort) excluded = "short_term";
  if (!excluded && !cell.agency) excluded = "agency_not_domestic";
  if (!excluded && (!cell.grade_raw || grade === null)) excluded = "grade_unmapped";
  if (!excluded && !base.rated_on) excluded = "rated_on_unknown";
  return {
    source: base.source,
    agency: cell.agency,
    agency_raw: cell.agency_raw,
    instrument: base.instrument,
    grade: excluded ? null : grade,
    grade_raw: cell.grade_raw,
    outlook: cell.outlook,
    rated_on: base.rated_on,
    rated_on_precision: base.precision,
    excluded_reason: excluded,
    raw: cap(base.raw),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Issuance table "채무증권 발행실적".
// ---------------------------------------------------------------------------------------------------------------

const ISSUANCE_HEADING = /채무\s*증권\s*발행\s*실적/g;
const ISSUANCE_MAX_CHARS = 12000;
const STATUS_RE = /미상환|일부\s*상환|상환/;
const UNIT_FACTORS: Array<[RegExp, number]> = [
  [/십억\s*원/, 1000],
  [/백만\s*원/, 1],
  [/억\s*원/, 100],
  [/천\s*원/, 0.001],
  [/만\s*원/, 0.01],
  [/원/, 0.000001],
];

function unitFactor(textAfterHeading: string): number | null {
  const m = /단위\s*[:：]?\s*([가-힣]{1,4})/.exec(textAfterHeading.slice(0, 300));
  if (!m) return null;
  for (const [re, f] of UNIT_FACTORS) if (re.test(m[1] ?? "")) return f;
  return null;
}

function toKrwMillions(raw: string, factor: number | null): number | null {
  if (factor === null) return null;
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * factor);
}

function issuanceBodies(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(ISSUANCE_HEADING.source, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index + m[0].length;
    const rest = text.slice(start, start + ISSUANCE_MAX_CHARS);
    const next = new RegExp(NEXT_HEADING.source, "g");
    let end = rest.length;
    for (let n = next.exec(rest); n; n = next.exec(rest)) {
      if (n.index > 200) {
        end = n.index;
        break;
      }
    }
    out.push(rest.slice(0, end));
  }
  return out;
}

interface CellHit {
  at: number;
  end: number;
  entries: RatingCellEntry[];
  text: string;
}

function parseIssuanceBody(
  body: string,
  registry: CreditRatingRegistry,
): { issues: CreditIssueRow[]; ratings: CreditRatingRow[] } {
  const norm = normalize(body).replace(SCALE_RANGE, " ");
  const factor = unitFactor(norm);
  const { text, outlooks } = liftOutlooks(norm);
  // Locate every rating cell: "<grades>(<agencies>)".
  const hits: CellHit[] = [];
  const parenRe = /\(([^()]+)\)/g;
  for (let m = parenRe.exec(text); m; m = parenRe.exec(text)) {
    const gl = gradeListBefore(text, m.index);
    if (!gl) continue;
    const agencyTexts = splitAgencies(m[1] ?? "");
    if (agencyTexts.length === 0) continue;
    const entries = zipCell(gl.grades, agencyTexts, outlooks, registry);
    hits.push({ at: gl.start, end: m.index + m[0].length, entries, text: text.slice(gl.start, m.index + m[0].length) });
  }
  const issues: CreditIssueRow[] = [];
  const ratings: CreditRatingRow[] = [];
  let rowStart = 0;
  for (const [i, h] of hits.entries()) {
    const nextAt = hits[i + 1]?.at ?? text.length;
    const after = text.slice(h.end, nextAt);
    const before = text.slice(rowStart, h.at);
    // Maturity = first date after the cell; the status token that follows ends this row.
    const afterDates = findDates(after);
    const statusFrom = afterDates[0]?.end ?? 0;
    const status = STATUS_RE.exec(after.slice(statusFrom));
    rowStart = status ? h.end + statusFrom + status.index + status[0].length : h.end + statusFrom;
    // Issue date = the last date before the cell; coupon = the number right before it; amount = the number before that.
    const beforeDates = findDates(before);
    const lastDate = beforeDates[beforeDates.length - 1];
    const issuedOn = lastDate?.iso ?? null;
    let maturity = afterDates[0]?.iso ?? null;
    if (issuedOn && maturity && maturity <= issuedOn) maturity = null; // the first date was the NEXT row's issue date
    const afterIssue = lastDate ? before.slice(lastDate.end) : before;
    const couponM = /(\d{1,2}(?:\.\d+)?)\s*%?\s*$/.exec(afterIssue);
    const amountM = couponM ? /([\d,]+(?:\.\d+)?)\s*$/.exec(afterIssue.slice(0, couponM.index)) : null;
    const typeEnd = lastDate?.at ?? before.length;
    const typeWindow = before.slice(Math.max(0, typeEnd - 80), typeEnd);
    const inst = instrumentOf(typeWindow);
    const instrument: RatingInstrument = inst?.instrument ?? "other";
    let excluded: RatingExcludedReason | null = instrument === "corporate_bond" ? excludedKind(typeWindow) : null;
    if (!excluded && instrument === "commercial_paper") excluded = "short_term";
    else if (!excluded && instrument !== "corporate_bond") excluded = "not_corporate_bond";
    const rawRow = cap(
      `${typeWindow.trim()} ${before.slice(typeEnd).trim()} ${h.text} ${maturity ?? ""} ${status?.[0] ?? ""}`
        .replace(/\s+/g, " ")
        .trim(),
    );
    issues.push({
      issued_on: issuedOn,
      instrument,
      amount_krw_mn: amountM ? toKrwMillions(amountM[1] ?? "", factor) : null,
      coupon_pct: couponM ? Number(couponM[1]) : null,
      rating_raw: cap(h.text.trim(), 120),
      maturity_on: maturity,
      outstanding: status ? status[0] !== "상환" : null,
      excluded_reason: excluded,
      raw: rawRow,
    });
    for (const e of h.entries) {
      ratings.push(
        ratingRowFromCell(
          e,
          { source: "issuance", instrument, rated_on: issuedOn, precision: "day", excluded, raw: rawRow },
          registry,
        ),
      );
    }
  }
  return { issues, ratings };
}

// ---------------------------------------------------------------------------------------------------------------
// Public parsers.
// ---------------------------------------------------------------------------------------------------------------

function isParseQualityReason(r: RatingExcludedReason | null): boolean {
  return r === "grade_unmapped" || r === "rated_on_unknown";
}

/** A credit-bureau issuer rating usable by the lower-confidence bureau rung (the agency may be unnamed). */
export function isSelectableBureauRating(r: CreditRatingRow): boolean {
  return r.instrument === "issuer_bureau" && r.grade !== null && r.excluded_reason === null && r.rated_on !== null;
}

export function isSelectableRating(r: CreditRatingRow): boolean {
  return (
    r.instrument === "corporate_bond" &&
    r.grade !== null &&
    r.agency !== null &&
    r.excluded_reason === null &&
    r.rated_on !== null
  );
}

/**
 * Parse the tag-stripped business-report text. Never throws. `issues` is null when the issuance table is absent
 * (unknown), never an empty array standing in for "none".
 */
export function parseBusinessReportCreditRating(rawText: string, registry: CreditRatingRegistry): ParsedBusinessReport {
  const text = normalize(rawText);
  // Section: the first heading occurrence that is substantive (rows, or an explicit "nothing applies"); a heading
  // inside a table of contents has neither.
  const bodies = sectionBodies(text);
  let sectionRatings: CreditRatingRow[] = [];
  let sectionFound = false;
  let notApplicable = false;
  for (const body of bodies) {
    let rows = tableRows(body, registry);
    if (rows.length === 0) rows = sentenceRows(body, registry);
    const na = NOT_APPLICABLE.test(body);
    if (rows.length > 0 || na) {
      sectionFound = true;
      sectionRatings = rows;
      notApplicable = na && rows.length === 0;
      break;
    }
  }
  if (!sectionFound && bodies.length > 0) sectionFound = true; // heading present, nothing readable -> parse_failed below

  // Issuance table: the first heading occurrence whose body holds a rating cell.
  let issues: CreditIssueRow[] | null = null;
  let issuanceRatings: CreditRatingRow[] = [];
  for (const body of issuanceBodies(text)) {
    const parsed = parseIssuanceBody(body, registry);
    if (parsed.issues.length > 0) {
      issues = parsed.issues;
      issuanceRatings = parsed.ratings;
      break;
    }
  }

  const ratings = [...sectionRatings, ...issuanceRatings];
  let status: ParsedBusinessReport["status"];
  if (ratings.some((r) => isSelectableRating(r) || isSelectableBureauRating(r))) status = "parsed";
  else if (!sectionFound) status = "section_absent";
  else if (sectionRatings.length > 0) {
    status = sectionRatings.some((r) => isParseQualityReason(r.excluded_reason))
      ? "parse_failed"
      : "section_present_no_bond_rating";
  } else if (notApplicable) status = "not_disclosed";
  else status = "parse_failed";
  return { status, section_found: sectionFound, ratings, issues };
}

/**
 * OpenDART bdRs.json `cdrt_int` of one debt-securities registration (public offering). Rating date = the payment
 * date (`pymd`), else the filing receipt date; guaranteed issues (a real `grt_amt`) are not issuer ratings.
 */
export function parseDebtSecuritiesRating(
  input: { cdrt_int: string | null | undefined; pymd?: string | null; rcept_no: string; grt_amt?: string | null },
  registry: CreditRatingRegistry,
): CreditRatingRow[] {
  const text = (input.cdrt_int ?? "").trim();
  if (!text || text === "-") return [];
  const ymd = (input.pymd ?? "").replace(/[^\d]/g, "");
  const filed = input.rcept_no.slice(0, 8);
  const pick = ymd.length === 8 ? ymd : filed;
  const ratedOn = /^\d{8}$/.test(pick)
    ? isoDate(Number(pick.slice(0, 4)), Number(pick.slice(4, 6)), Number(pick.slice(6, 8)))
    : null;
  const grt = (input.grt_amt ?? "").replace(/[,\s]/g, "");
  const guaranteed = grt !== "" && grt !== "-" && Number(grt) > 0;
  const entries = parseRatingCells(text, registry);
  return entries.map((e) =>
    ratingRowFromCell(
      e,
      {
        source: "bdrs",
        instrument: "corporate_bond",
        rated_on: ratedOn,
        precision: "day",
        excluded: guaranteed ? "guaranteed" : null,
        raw: text,
      },
      registry,
    ),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Selection.
// ---------------------------------------------------------------------------------------------------------------

export interface AgencyRating {
  agency: string;
  grade: string;
  rated_on: string;
  outlook: RatingOutlook | null;
  source: RatingRowSource;
}

export interface SelectedRating {
  /** Lowest grade across the agencies (conservative). */
  rating: string;
  /** Newest rated_on among the agencies that carry that grade. */
  rated_on: string;
  stale: boolean;
  /** Latest row per agency (the evidence the lowest was picked from). */
  agencies: AgencyRating[];
  /** The row the rating and date were taken from (identity-comparable with the input rows). */
  picked: CreditRatingRow;
}

/** YYYY-MM-DD + whole months, day clamped to the target month's length. */
export function addMonthsIso(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = total % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${pad2(tm + 1)}-${pad2(Math.min(d, last))}`;
}

/** Older than `staleMonths` (strictly): exactly 18 months ago is still fresh, one day more is stale. */
export function isRatingStale(ratedOn: string, now: Date | string, staleMonths: number): boolean {
  return seoulToday(now) > addMonthsIso(ratedOn, staleMonths);
}

/** Worst grade first, then newest date, then agency id (a total order, so the result is deterministic). */
function byLowestThenNewest(registry: CreditRatingRegistry) {
  return (a: AgencyRating, b: AgencyRating): number =>
    registry.scale.indexOf(b.grade) - registry.scale.indexOf(a.grade) ||
    (a.rated_on === b.rated_on ? 0 : a.rated_on < b.rated_on ? 1 : -1) ||
    (a.agency < b.agency ? -1 : a.agency > b.agency ? 1 : 0);
}

/**
 * ADR-0208 D2: per agency the LATEST selectable row (same date: the lower grade), across agencies the LOWEST grade
 * (ties: the newest date). Null when no row is selectable.
 */
export function selectRating(
  rows: readonly CreditRatingRow[],
  registry: CreditRatingRegistry,
  now: Date | string,
): SelectedRating | null {
  const latest = new Map<string, CreditRatingRow>();
  for (const r of rows) {
    if (!isSelectableRating(r)) continue;
    const key = r.agency as string;
    const cur = latest.get(key);
    const rn = registry.scale.indexOf(r.grade as string);
    if (!cur) latest.set(key, r);
    else if ((r.rated_on as string) > (cur.rated_on as string)) latest.set(key, r);
    else if (r.rated_on === cur.rated_on && rn > registry.scale.indexOf(cur.grade as string)) latest.set(key, r);
  }
  if (latest.size === 0) return null;
  const agencies = [...latest.values()]
    .map((r) => ({
      agency: r.agency as string,
      grade: r.grade as string,
      rated_on: r.rated_on as string,
      outlook: r.outlook,
      source: r.source,
    }))
    .sort(byLowestThenNewest(registry));
  const lowest = agencies[0] as AgencyRating;
  const tied = agencies.filter((a) => a.grade === lowest.grade); // already newest first
  const top = tied[0] as AgencyRating;
  return {
    rating: lowest.grade,
    rated_on: top.rated_on,
    stale: isRatingStale(top.rated_on, now, registry.disclosed.staleMonths),
    agencies,
    picked: latest.get(top.agency) as CreditRatingRow,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Bureau issuer rating selection (lower-confidence rung).
// ---------------------------------------------------------------------------------------------------------------

export interface SelectedBureauRating {
  /** Registry-scale grade of the picked row. */
  rating: string;
  rated_on: string;
  stale: boolean;
  /** Registry bureau id of the picked row; null when the filing names none (or an unregistered bureau). */
  agency: string | null;
  agency_raw: string | null;
  agency_carried: boolean;
  cashflow_grade_raw: string | null;
  /** Every selectable row of the latest rating date (the evidence the lowest was picked from). */
  latest: CreditRatingRow[];
  /** The row the rating was taken from (identity-comparable with the input rows). */
  picked: CreditRatingRow;
}

/**
 * Latest issuer rating of the credit-information bureaus: the newest `rated_on` wins; when several bureaus rated on
 * that date the LOWEST grade is taken (ties: the named agency with the smaller id, an unnamed row last). Stale after
 * the registry window, like the disclosed rung. Null when no bureau row is selectable.
 */
export function selectBureauRating(
  rows: readonly CreditRatingRow[],
  registry: CreditRatingRegistry,
  now: Date | string,
): SelectedBureauRating | null {
  const ok = rows.filter(isSelectableBureauRating);
  if (ok.length === 0) return null;
  const newest = ok.reduce((m, r) => ((r.rated_on as string) > m ? (r.rated_on as string) : m), "");
  const latest = ok.filter((r) => r.rated_on === newest);
  const idx = (r: CreditRatingRow) => registry.scale.indexOf(r.grade as string);
  const picked = [...latest].sort(
    (a, b) =>
      idx(b) - idx(a) ||
      (a.agency === b.agency ? 0 : a.agency === null ? 1 : b.agency === null ? -1 : a.agency < b.agency ? -1 : 1),
  )[0] as CreditRatingRow;
  return {
    rating: picked.grade as string,
    rated_on: newest,
    stale: isRatingStale(newest, now, registry.disclosed.staleMonths),
    agency: picked.agency,
    agency_raw: picked.agency_raw,
    agency_carried: picked.agency_carried === true,
    cashflow_grade_raw: picked.cashflow_grade_raw ?? null,
    latest,
    picked,
  };
}
