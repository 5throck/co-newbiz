// dart-financial-facts.ts — company-scoped DART financial fact ingestion
// (Phase 1 of ADR-0116: the first writer for fact_financial, which existed
// schema-only since migration 0011). One call resolves the company's DART
// corp code, pulls 5 business years of 단일회사 전체 재무제표 through the
// shared dartFetch gate (concurrency/backoff/daily budget), and lands values
// in fact_financial with append-only revisions: a value that already matches
// the latest revision is skipped, a changed value becomes revision_no = max+1
// — nothing is ever overwritten (same discipline as observation.repository's
// ensureFresh, which is hard-wired to fact_market_observation and therefore
// not directly importable).
//
// fact_financial.value convention: raw KRW (원) as filed by DART — display
// layers convert to 억원. The 8 WANTED_ACCOUNTS names are pre-seeded in
// md_account by migration 0083; the writer maps by normalized Korean name
// (name_ko) and fails loudly if an account row is missing rather than
// inventing an id.
import { resolveCorpCode, validateCorpCode, fetchFinancials, isDartConfigured } from "./dart-client.ts";
import { canonicalCompanyName } from "./company-name.ts";
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";

export interface FactRow {
  id: string;
  value: number;
  revision_no: number;
  created_at: string;
  account_name: string;
  ifrs_code: string;
  fiscal_year: number;
  source_code: string | null;
}

export interface SyncResult {
  company_id: string;
  corp_code: string;
  years: number[];
  inserted: number;
  unchanged: number;
  integrity: string | null;
  integrity_notes: string[];
  /** design 2026-11-11 §6.1 — corp_code_name_mismatch warnings etc. The
   *  entered/stored code is authoritative; a mismatch is RECORDED here and
   *  surfaced (sync response + detail banner with DART's registered name),
   *  never silently substituted by a name-search downgrade. */
  warnings: string[];
}

export interface CompanyFinancialFacts {
  company: { id: string; name_ko: string; dart_corp_code: string | null };
  rows: FactRow[];
  latest_sync_at: string | null;
}

type FinancialsFetcher = typeof fetchFinancials;

function ensureMdSourceDart(db: ReturnType<typeof getDb>): string {
  const existing = db.query("SELECT id FROM md_source WHERE code = 'dart'").get() as { id: string } | undefined;
  if (existing) return existing.id;
  const id = ulid();
  db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [
    id,
    "dart",
    "A",
    new Date().toISOString(),
  ]);
  return id;
}

function ensureYearPeriod(db: ReturnType<typeof getDb>, year: number): string {
  const existing = db.query("SELECT id FROM md_period WHERE period_type = 'year' AND fiscal_year = ?").get(year) as
    | { id: string }
    | undefined;
  if (existing) return existing.id;
  const id = ulid();
  db.run(
    "INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)",
    [id, "year", `${year}-01-01`, `${year}-12-31`, year, new Date().toISOString()],
  );
  return id;
}

function resolveAccountId(db: ReturnType<typeof getDb>, nameKo: string): string {
  const row = db.query("SELECT id FROM md_account WHERE name_ko = ?").get(nameKo) as { id: string } | undefined;
  if (!row) {
    throw new Error(
      `md_account에 '${nameKo}' 계정이 없습니다 — migration 0083 시드를 확인하세요 (writer는 임의 계정을 생성하지 않습니다).`,
    );
  }
  return row.id;
}

type CorpCodeValidator = typeof validateCorpCode;

/** Sync one company's 5-year financials into fact_financial. Throws on
 *  unresolvable corp code or a failed DART retrieval — callers translate
 *  errors into 503/409 responses. `opts.corpCode` short-circuits the
 *  validate/resolve flow (tests, and callers that already know the code);
 *  `opts.validator` is the test seam mirroring `opts.fetcher` (design §6.1).
 *
 *  design 2026-11-11 §D5 corp-code authority: the expect-name is canonicalized
 *  first (removes the paren-gloss class of containment failures); when
 *  containment still fails (validated === false — DART responded and KNOWS
 *  the code) the entered/stored code PROCEEDS and the mismatch is recorded —
 *  the name-search downgrade that could silently persist another company's
 *  code (the 한전KPS incident) is REMOVED whenever a code exists. The no-code
 *  path resolves only on an exact VERIFIED hit (validated === true). */
export async function syncCompanyFinancialFacts(
  db: ReturnType<typeof getDb>,
  companyId: string,
  opts: { years?: number; fetcher?: FinancialsFetcher; corpCode?: string; validator?: CorpCodeValidator } = {},
): Promise<SyncResult> {
  if (!isDartConfigured()) {
    throw new DartSyncError(
      "DART_API_KEY is not configured — set the key in the root .env and retry.",
      "dart_not_configured",
    );
  }
  const company = db.query("SELECT id, name_ko, dart_corp_code FROM md_company WHERE id = ?").get(companyId) as
    | { id: string; name_ko: string; dart_corp_code: string | null }
    | undefined;
  if (!company) throw new DartSyncError("Company not found.", "company_not_found");

  let corpCode = opts.corpCode ?? company.dart_corp_code ?? null;
  const warnings: string[] = [];
  if (!opts.corpCode && corpCode) {
    const check = await (opts.validator ?? validateCorpCode)(corpCode, canonicalCompanyName(company.name_ko));
    if (check.validated === false) {
      // DART responded and KNOWS this code, but its registered name differs
      // from ours. Code authority: proceed with the entered/stored code,
      // surface the mismatch (validated === null = DART unreachable — keep
      // current behavior, proceed with the code).
      warnings.push(`corp_code_name_mismatch: DART corp_name='${check.corpName ?? "?"}' for code ${corpCode}`);
    }
  }
  if (!corpCode) {
    const resolved = await resolveCorpCode(canonicalCompanyName(company.name_ko));
    if (!resolved.corpCode || resolved.validated !== true) {
      throw new DartSyncError(
        `Cannot resolve the DART corp code — no exact verified match for '${company.name_ko}'. Register the dart corp code on the company screen first.`,
        "corp_code_unresolved",
      );
    }
    corpCode = resolved.corpCode;
  }
  if (corpCode !== company.dart_corp_code) {
    db.run("UPDATE md_company SET dart_corp_code = ? WHERE id = ?", [corpCode, company.id]);
  }

  const fin = await (opts.fetcher ?? fetchFinancials)(corpCode, { years: opts.years ?? 5 });
  if (!fin.found || (fin.yearly?.length ?? 0) === 0) {
    throw new DartSyncError(
      `DART retrieval failed — ${fin.error ?? "Financial statements not found"}`,
      "dart_retrieval_failed",
    );
  }

  const sourceId = ensureMdSourceDart(db);
  const years: number[] = [];
  let inserted = 0;
  let unchanged = 0;
  for (const yearBlock of fin.yearly ?? []) {
    const fiscalYear = Number(yearBlock.year);
    if (!Number.isFinite(fiscalYear)) continue;
    years.push(fiscalYear);
    const periodId = ensureYearPeriod(db, fiscalYear);
    for (const item of yearBlock.items) {
      const accountId = resolveAccountId(db, item.name);
      const latest = db
        .query(
          "SELECT value, revision_no FROM fact_financial WHERE company_id = ? AND period_id = ? AND account_id = ? ORDER BY revision_no DESC LIMIT 1",
        )
        .get(companyId, periodId, accountId) as { value: number; revision_no: number } | undefined;
      if (latest && latest.value === item.value) {
        unchanged++;
        continue;
      }
      db.run(
        "INSERT INTO fact_financial (id, company_id, period_id, account_id, value, revision_no, source_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
        [
          ulid(),
          companyId,
          periodId,
          accountId,
          item.value,
          latest ? latest.revision_no + 1 : 1,
          sourceId,
          new Date().toISOString(),
        ],
      );
      inserted++;
    }
  }
  return {
    company_id: companyId,
    corp_code: corpCode,
    years: years.sort((a, b) => a - b),
    inserted,
    unchanged,
    integrity: fin.integrity ?? null,
    integrity_notes: fin.integrityNotes ?? [],
    warnings,
  };
}

export class DartSyncError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/** Latest-revision-deduped fact rows for one company — the display shape. */
export function getCompanyFinancialFacts(db: ReturnType<typeof getDb>, companyId: string): CompanyFinancialFacts {
  const company = db.query("SELECT id, name_ko, dart_corp_code FROM md_company WHERE id = ?").get(companyId) as
    | { id: string; name_ko: string; dart_corp_code: string | null }
    | undefined;
  if (!company) throw new DartSyncError("Company not found.", "company_not_found");
  // Dedup: keep only the max revision per (period, account) — the unique
  // latest index orders revisions DESC, so a grouped max(revision_no) join
  // picks one row per account-year.
  const rows = db
    .query(
      `SELECT f.id, f.value, f.revision_no, f.created_at,
              a.name_ko AS account_name, a.ifrs_code,
              per.fiscal_year, s.code AS source_code
       FROM fact_financial f
       JOIN md_account a ON a.id = f.account_id
       JOIN md_period per ON per.id = f.period_id
       LEFT JOIN md_source s ON s.id = f.source_id
       WHERE f.company_id = ?
         AND f.revision_no = (SELECT MAX(f2.revision_no) FROM fact_financial f2
                              WHERE f2.company_id = f.company_id
                                AND f2.period_id = f.period_id
                                AND f2.account_id = f.account_id)
       ORDER BY per.fiscal_year ASC, a.ifrs_code`,
    )
    .all(companyId) as FactRow[];
  const latestSync = db
    .query("SELECT MAX(created_at) AS at FROM fact_financial WHERE company_id = ?")
    .get(companyId) as { at: string | null };
  return { company, rows, latest_sync_at: latestSync.at ?? null };
}

/** Convert stored fact rows into the DartFinancials item shape so the
 *  existing deterministic deriveFinancialAnalysis (ADR-0093) can be reused
 *  for the dashboard without a second analysis implementation. */
export function factRowsToDartItems(
  rows: FactRow[],
): Array<{ name: string; value: number; unit: string; year: string }> {
  return rows.map((r) => ({ name: r.account_name, value: r.value, unit: "KRW", year: String(r.fiscal_year) }));
}
