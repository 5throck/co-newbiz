// wacc-reference.ts — subject-parameterized WACC reference (ADR-0116 Phase 4;
// the user-approved structure: market-common parameters are shared, subject
// parameters (D/E) come from the asked company's facts). The reference is a
// PROPOSAL for the WACC input session — the human-confirmed scalar stays
// kind='user' on the project run; nothing here writes assumptions.
//
// Series and account ids are the ones seeded/produced by this workspace:
//   - series `ecos:721Y001:5020000` (국고채 3년)      → risk-free rate
//   - series `ecos:721Y001:7020000` (회사채 3년 AA−)  → credit-spread base
//   - fact_financial 부채총계/자본총계 (latest period) → observed D/E
// Beta is intentionally absent until the KRX price source lands (Phase 8) —
// the caller shows N/A with a reason instead of a placeholder.
import type { Database } from "bun:sqlite";
import {
  loadKrCreditRatingRegistry,
  mapRatingToSpread,
  type CreditRatingRegistry,
  type MappedSpread,
  type SpreadBasis,
  type SpreadFlag,
  type SpreadInputs,
} from "./credit-spread-map.ts";

export const RF_SERIES_ID = "ecos:721Y001:5020000";
export const CORP_BOND_SERIES_ID = "ecos:721Y001:7020000";
/** ADR-0208: corporate bond 3y BBB- (ECOS 721Y001 item 7030000), the lower anchor of the rating-to-spread map. */
export const CORP_BOND_BBBM_SERIES_ID = "ecos:721Y001:7030000";

export interface ReferenceEntry {
  key: string;
  label: string;
  value: number | null;
  as_of: string | null;
  anchor_ref: string | null;
  source_label: string | null;
  /** Why the value is null. Null whenever a value is present. */
  reason: string | null;
  /** Caveat attached to a present value (e.g. approximation). */
  note?: string | null;
  /** ADR-0208: rating, basis and derivation detail; present on the credit_spread entry only. */
  credit?: CreditSpreadDetail;
}

/** Where the rating of a credit-spread suggestion came from. Slice 1 produces `default` only. */
export type CreditRatingSource = "disclosed" | "synthetic" | "default";

/** One ECOS series the spread was built from (percent points). */
export interface SeriesUsed {
  role: "ktb_3y" | "aa_minus" | "bbb_minus";
  series_id: string;
  value_pct: number;
}

/** ADR-0208 additive fields of the credit_spread suggestion (stable shape; later slices fill the empty ones). */
export interface CreditSpreadDetail {
  /** Rating used for the mapping; null when the registry is unavailable (legacy behaviour). */
  rating: string | null;
  rating_source: CreditRatingSource | null;
  rating_stale: boolean;
  rating_agencies: Array<{ agency: string; grade: string; rated_on: string }>;
  rating_instrument: string | null;
  source_rcept_no: string | null;
  /** How the spread was built; null when there is no spread value at all. */
  spread_basis: SpreadBasis | null;
  /** True only for a value interpolated between the two ECOS anchors (not a published difference). */
  derived: boolean;
  flags: SpreadFlag[];
  series_used: SeriesUsed[];
  anchors: MappedSpread["anchors"] | null;
  synthetic: null;
  /** Why the rating is what it is (rung that produced it, or why the ladder fell through). */
  reason_code: string | null;
  reason: string | null;
  /** Why the legacy AA- spread was kept instead of a rating-mapped one (null when mapped). */
  spread_reason_code: string | null;
  spread_reason: string | null;
  crosscheck: null;
  issuance_evidence: [];
  agency_links: [];
  /** Indicative Kd = latest Rf + spread, percent points; null when either is missing. The Ke comparison is the caller's. */
  kd_indicative_pct: number | null;
}

export interface WaccReference {
  subject: { company_id: string; name_ko: string | null };
  entries: ReferenceEntry[];
  spread_pct: number | null;
  missing: string[];
}

/** Latest observation (max revision per period) of one series, as
 *  {as_of: YYYY-MM, value}. Null when the series has no rows. */
function latestObservation(db: Database, seriesId: string): { asOf: string; value: number } | null {
  const row = db
    .query(
      `SELECT substr(p.start_date, 1, 7) AS ym, o.value
       FROM fact_market_observation o
       JOIN md_period p ON p.id = o.period_id
       WHERE o.series_id = ?
         AND o.revision_no = (SELECT MAX(revision_no) FROM fact_market_observation o2
                              WHERE o2.series_id = o.series_id AND o2.period_id = o.period_id)
       ORDER BY p.start_date DESC LIMIT 1`,
    )
    .get(seriesId) as { ym: string; value: number } | undefined;
  return row ? { asOf: row.ym, value: row.value } : null;
}

/** Observation (max revision) of one series for one YYYY-MM month. */
function observationAt(db: Database, seriesId: string, ym: string): { asOf: string; value: number } | null {
  const row = db
    .query(
      `SELECT o.value
       FROM fact_market_observation o
       JOIN md_period p ON p.id = o.period_id
       WHERE o.series_id = ? AND substr(p.start_date, 1, 7) = ?
         AND o.revision_no = (SELECT MAX(revision_no) FROM fact_market_observation o2
                              WHERE o2.series_id = o.series_id AND o2.period_id = o.period_id)
       LIMIT 1`,
    )
    .get(seriesId, ym) as { value: number } | undefined;
  return row ? { asOf: ym, value: row.value } : null;
}

/** Latest month in which BOTH series have an observation. */
function latestCommonMonth(db: Database, a: string, b: string): string | null {
  const row = db
    .query(
      `SELECT substr(p.start_date, 1, 7) AS ym
       FROM fact_market_observation o JOIN md_period p ON p.id = o.period_id
       WHERE o.series_id = ?
         AND substr(p.start_date, 1, 7) IN (
           SELECT substr(p2.start_date, 1, 7) FROM fact_market_observation o2
           JOIN md_period p2 ON p2.id = o2.period_id WHERE o2.series_id = ?)
       ORDER BY p.start_date DESC LIMIT 1`,
    )
    .get(a, b) as { ym: string } | undefined;
  return row?.ym ?? null;
}

/** Distinct YYYY-MM months in which a series has at least one observation, newest first. */
function monthsOf(db: Database, seriesId: string): string[] {
  const rows = db
    .query(
      `SELECT DISTINCT substr(p.start_date, 1, 7) AS ym
       FROM fact_market_observation o JOIN md_period p ON p.id = o.period_id
       WHERE o.series_id = ? ORDER BY ym DESC`,
    )
    .all(seriesId) as Array<{ ym: string }>;
  return rows.map((r) => r.ym);
}

/**
 * Month the rating-to-spread map works from (ADR-0208): the latest month in which KTB 3y, AA- AND BBB-
 * all exist; else the latest month KTB 3y has at least one anchor (AA- preferred on a tie). Null when
 * KTB 3y has no month in common with any anchor.
 */
function selectCreditMonth(db: Database): string | null {
  const ktb = new Set(monthsOf(db, RF_SERIES_ID));
  const aa = monthsOf(db, CORP_BOND_SERIES_ID).filter((m) => ktb.has(m));
  const bbbSet = new Set(monthsOf(db, CORP_BOND_BBBM_SERIES_ID));
  const bbb = [...bbbSet]
    .filter((m) => ktb.has(m))
    .sort()
    .reverse();
  const all = aa.find((m) => bbbSet.has(m));
  if (all) return all;
  const a = aa[0] ?? null;
  const b = bbb[0] ?? null;
  if (a && b) return a >= b ? a : b;
  return a ?? b;
}

/** The three ECOS observations of one month (KTB 3y required), percent points. */
function readSpreadInputs(db: Database, ym: string): SpreadInputs | null {
  const ktb = observationAt(db, RF_SERIES_ID, ym);
  if (!ktb) return null;
  return {
    asOf: ym,
    ktbPct: ktb.value,
    aaMinusPct: observationAt(db, CORP_BOND_SERIES_ID, ym)?.value ?? null,
    bbbMinusPct: observationAt(db, CORP_BOND_BBBM_SERIES_ID, ym)?.value ?? null,
  };
}

function seriesUsed(inputs: SpreadInputs): SeriesUsed[] {
  const out: SeriesUsed[] = [{ role: "ktb_3y", series_id: RF_SERIES_ID, value_pct: inputs.ktbPct }];
  if (inputs.aaMinusPct !== null)
    out.push({ role: "aa_minus", series_id: CORP_BOND_SERIES_ID, value_pct: inputs.aaMinusPct });
  if (inputs.bbbMinusPct !== null)
    out.push({ role: "bbb_minus", series_id: CORP_BOND_BBBM_SERIES_ID, value_pct: inputs.bbbMinusPct });
  return out;
}

/**
 * Rating of the credit-spread suggestion (ADR-0208 D1). Slice 1 has no evidence rungs yet, so the
 * ladder always ends at the registry default with an explicit reason; the disclosed (DART) and
 * synthetic (interest coverage) rungs are inserted ahead of it by later slices.
 */
export function decideCreditRating(registry: CreditRatingRegistry): {
  rating: string;
  source: CreditRatingSource;
  reason_code: string;
  reason: string;
} {
  return {
    rating: registry.defaultRating,
    source: "default",
    reason_code: "no_disclosed_rating_and_synthetic_unavailable",
    reason: `${registry.defaultReason} (The disclosed-rating and synthetic-rating rungs are not available yet.)`,
  };
}

export type DerivedCreditSpread =
  | { ok: true; rating: string; rating_source: CreditRatingSource; mapped: MappedSpread }
  | { ok: false; reason_code: string; reason: string };

/**
 * Re-derive the credit spread for the registry default rating at one ECOS month. Used by the
 * confirmation audit (db/lib/wacc.ts) so that rating, source and basis are recorded from stored
 * evidence, never from the client. Pure read.
 */
export function deriveCreditSpreadAt(
  db: Database,
  asOf: string,
  loaded?: ReturnType<typeof loadKrCreditRatingRegistry>,
): DerivedCreditSpread {
  const reg = loaded ?? loadKrCreditRatingRegistry();
  if (!reg.ok) return { ok: false, reason_code: reg.reason_code, reason: reg.reason };
  const decision = decideCreditRating(reg.registry);
  const inputs = readSpreadInputs(db, asOf);
  if (!inputs) {
    return {
      ok: false,
      reason_code: "no_ecos_observations",
      reason: `No ECOS KTB 3y observation exists for ${asOf}.`,
    };
  }
  const mapped = mapRatingToSpread(reg.registry, decision.rating, inputs);
  if (!mapped.ok) return { ok: false, reason_code: mapped.reason_code, reason: mapped.reason };
  return { ok: true, rating: decision.rating, rating_source: decision.source, mapped };
}

function pctEntry(
  key: string,
  label: string,
  obs: { asOf: string; value: number } | null,
  sourceLabel: string,
): ReferenceEntry {
  return {
    key,
    label,
    value: obs ? obs.value : null,
    as_of: obs ? obs.asOf : null,
    anchor_ref: obs ? `src:${obs ? "ecos" : ""}` : null,
    source_label: obs ? sourceLabel : null,
    reason: obs ? null : "ECOS 시계열 미수집 — fetch --source ecos 먼저 실행",
  };
}

const RATED_CREDIT_LABEL = "Credit-rating spread (rating-mapped corporate bond yield minus KTB 3y)";

const EMPTY_CREDIT_DETAIL: CreditSpreadDetail = {
  rating: null,
  rating_source: null,
  rating_stale: false,
  rating_agencies: [],
  rating_instrument: null,
  source_rcept_no: null,
  spread_basis: null,
  derived: false,
  flags: [],
  series_used: [],
  anchors: null,
  synthetic: null,
  reason_code: null,
  reason: null,
  spread_reason_code: null,
  spread_reason: null,
  crosscheck: null,
  issuance_evidence: [],
  agency_links: [],
  kd_indicative_pct: null,
};

/**
 * ADR-0208: the credit_spread entry. `legacy` is the AA- entry computed before (kept byte for byte when
 * nothing better can be built); `riskFree` supplies the Rf for the indicative Kd and the ECOS source label.
 */
function buildCreditSpreadEntry(
  db: Database,
  input: { legacy: ReferenceEntry; riskFree: ReferenceEntry },
): ReferenceEntry {
  const { legacy, riskFree } = input;
  const rfPct = riskFree.value;
  const keepLegacy = (detail: Partial<CreditSpreadDetail>): ReferenceEntry => ({
    ...legacy,
    credit: {
      ...EMPTY_CREDIT_DETAIL,
      ...detail,
      spread_basis: legacy.value !== null ? "aa_minus_legacy" : null,
      kd_indicative_pct: legacy.value !== null && rfPct !== null ? rfPct + legacy.value : null,
    },
  });

  const loaded = loadKrCreditRatingRegistry();
  if (!loaded.ok) return keepLegacy({ spread_reason_code: loaded.reason_code, spread_reason: loaded.reason });

  const decision = decideCreditRating(loaded.registry);
  const ratingPart = {
    rating: decision.rating,
    rating_source: decision.source,
    reason_code: decision.reason_code,
    reason: decision.reason,
  };
  const month = selectCreditMonth(db);
  const inputs = month ? readSpreadInputs(db, month) : null;
  if (!inputs) {
    return keepLegacy({
      ...ratingPart,
      spread_reason_code: "no_ecos_observations",
      spread_reason: "No common ECOS month for KTB 3y and a corporate-bond anchor - AA- legacy spread kept.",
    });
  }
  const mapped = mapRatingToSpread(loaded.registry, decision.rating, inputs);
  if (!mapped.ok) {
    return keepLegacy({
      ...ratingPart,
      series_used: seriesUsed(inputs),
      spread_reason_code: mapped.reason_code,
      spread_reason: `${mapped.reason} AA- legacy spread kept.`,
    });
  }
  const sourceNote =
    decision.source === "default"
      ? ` Rating basis: default placeholder (${decision.reason_code}) - confirm the company's rating before relying on it.`
      : "";
  return {
    key: "credit_spread",
    label: RATED_CREDIT_LABEL,
    value: mapped.spreadPct,
    as_of: mapped.anchors.as_of,
    anchor_ref: "src:ecos",
    // Same citation as the risk-free entry (both are ECOS 721Y001 monthly market rates).
    source_label: riskFree.source_label ?? legacy.source_label,
    reason: null,
    note: `${mapped.note}${sourceNote}`,
    credit: {
      ...EMPTY_CREDIT_DETAIL,
      ...ratingPart,
      spread_basis: mapped.basis,
      derived: mapped.derived,
      flags: mapped.flags,
      series_used: seriesUsed(inputs),
      anchors: mapped.anchors,
      kd_indicative_pct: rfPct !== null ? rfPct + mapped.spreadPct : null,
    },
  };
}

export function computeWaccReference(db: Database, subjectCompanyId: string): WaccReference {
  const company = db.query("SELECT id, name_ko FROM md_company WHERE id = ?").get(subjectCompanyId) as
    | { id: string; name_ko: string | null }
    | undefined;
  if (!company) throw new Error(`subject company '${subjectCompanyId}' not found`);

  const rf = latestObservation(db, RF_SERIES_ID);
  const corp = latestObservation(db, CORP_BOND_SERIES_ID);

  // Subject D/E from fact_financial (latest revision per account, latest year).
  const fin = db
    .query(
      `SELECT a.name_ko AS account, f.value, per.fiscal_year
       FROM fact_financial f
       JOIN md_account a ON a.id = f.account_id
       JOIN md_period per ON per.id = f.period_id
       WHERE f.company_id = ?
         AND f.revision_no = (SELECT MAX(f2.revision_no) FROM fact_financial f2
                              WHERE f2.company_id = f.company_id AND f2.period_id = f.period_id AND f2.account_id = f.account_id)
       ORDER BY per.fiscal_year DESC`,
    )
    .all(subjectCompanyId) as Array<{ account: string; value: number; fiscal_year: number }>;
  const latestYear = fin.length > 0 ? fin[0].fiscal_year : null;
  const pick = (account: string, year: number | null) =>
    fin.find((r) => r.account === account && (year === null || r.fiscal_year === year))?.value ?? null;
  const debt = pick("부채총계", latestYear);
  const equity = pick("자본총계", latestYear);
  const observedDe = debt !== null && equity !== null && equity !== 0 ? debt / equity : null;

  // Credit spread: 회사채(AA−) − 국고채 computed from the latest month in which
  // BOTH series have an observation (human-decision default, 2026-10-11).
  const commonMonth = rf && corp ? latestCommonMonth(db, RF_SERIES_ID, CORP_BOND_SERIES_ID) : null;
  const rfC = commonMonth ? observationAt(db, RF_SERIES_ID, commonMonth) : null;
  const corpC = commonMonth ? observationAt(db, CORP_BOND_SERIES_ID, commonMonth) : null;
  const spread = rfC && corpC ? corpC.value - rfC.value : null;
  let spreadReason: string | null = null;
  let spreadNote: string | null = null;
  if (spread === null) {
    spreadReason =
      rf && corp
        ? `Rf와 회사채 공통 월 없음 (Rf 최신 ${rf.asOf}, 회사채 최신 ${corp.asOf}) — 가산금리 미산출`
        : "ECOS 시계열 미수집 — fetch --source ecos 먼저 실행";
  } else {
    spreadNote =
      `${commonMonth} 기준 산출 (Rf·회사채 공통 최신 월${rf && rf.asOf !== commonMonth ? `; Rf 최신 월은 ${rf.asOf}` : ""}). ` +
      "개별 회사등급 미반영 근사값 — 필요 시 직접 입력으로 대체";
  }

  const entries: ReferenceEntry[] = [
    {
      key: "risk_free",
      label: "무위험이자율 (Rf) — 국고채 3년",
      value: rf ? rf.value : null,
      as_of: rf ? rf.asOf : null,
      anchor_ref: rf ? "src:ecos" : null,
      source_label: rf ? "한국은행 ECOS 시장금리(월별)" : null,
      reason: rf ? null : "ECOS 시계열 미수집 — fetch --source ecos 먼저 실행",
    },
    {
      key: "credit_spread",
      label: "신용등급 가산금리 (회사채 AA− − 국고채 3년)",
      value: spread,
      as_of: spread !== null ? commonMonth : null,
      anchor_ref: spread !== null ? "src:ecos" : null,
      source_label: spread !== null ? "한국은행 ECOS 시장금리(월별)" : null,
      reason: spreadReason,
      note: spreadNote,
    },
    {
      key: "observed_de",
      label: `관측 D/E${latestYear ? ` (${latestYear}.12)` : ""}`,
      value: observedDe,
      as_of: latestYear ? `${latestYear}-12-31` : null,
      anchor_ref: observedDe !== null ? "src:dart" : null,
      source_label: observedDe !== null ? "DART 연결재무제표" : null,
      reason: observedDe === null ? "DART 재무 fact 없음 — 회사 화면에서 동기화" : null,
      note:
        observedDe !== null
          ? "장부가 D/E (최신 사업연도 재무제표의 부채/자본), 시가 D/E 아님 — 베타 재레버링 전 검토 필요"
          : null,
    },
  ];

  // ADR-0208: rating-aware spread. The legacy AA- entry above is the fail-soft fallback (spread_basis
  // "aa_minus_legacy") whenever the registry, the ECOS months or the anchors cannot produce a figure.
  const legacyCredit = entries[1];
  entries[1] = buildCreditSpreadEntry(db, { legacy: legacyCredit, riskFree: entries[0] });
  const finalSpread = entries[1].value;

  return {
    subject: { company_id: company.id, name_ko: company.name_ko },
    entries,
    spread_pct: finalSpread,
    missing: entries.filter((e) => e.value === null).map((e) => e.key),
  };
}
