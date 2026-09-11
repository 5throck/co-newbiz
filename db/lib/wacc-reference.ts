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

export const RF_SERIES_ID = "ecos:721Y001:5020000";
export const CORP_BOND_SERIES_ID = "ecos:721Y001:7020000";

export interface ReferenceEntry {
  key: string;
  label: string;
  value: number | null;
  as_of: string | null;
  anchor_ref: string | null;
  source_label: string | null;
  reason: string | null;
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

function pctEntry(key: string, label: string, obs: { asOf: string; value: number } | null, sourceLabel: string): ReferenceEntry {
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

  // Credit spread: 회사채(AA−) − 국고채, same period required.
  const spread = rf && corp && rf.asOf === corp.asOf ? corp.value - rf.value : null;

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
      as_of: corp ? corp.asOf : null,
      anchor_ref: spread !== null ? "src:ecos" : null,
      source_label: spread !== null ? "한국은행 ECOS 시장금리(월별)" : null,
      reason: spread === null ? "ECOS 시계열 미수집 — fetch --source ecos 먼저 실행" : "개별 회사등급 미반영 근사값 — 필요 시 직접 입력으로 대체",
    },
    {
      key: "observed_de",
      label: `관측 D/E${latestYear ? ` (${latestYear}.12)` : ""}`,
      value: observedDe,
      as_of: latestYear ? `${latestYear}-12-31` : null,
      anchor_ref: observedDe !== null ? "src:dart" : null,
      source_label: observedDe !== null ? "DART 연결재무제표" : null,
      reason: observedDe === null ? "DART 재무 fact 없음 — 회사 화면에서 동기화" : null,
    },
  ];

  return { subject: { company_id: company.id, name_ko: company.name_ko }, entries, missing: entries.filter((e) => e.value === null).map((e) => e.key) };
}
