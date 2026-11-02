// @version 1.0.0
import { ulid } from "../lib/ulid.ts";

/**
 * stock-series.repository.ts — per-deal KRX stock series registration table
 * (stock_series, migration 0187; owner decision 2026-11-02, option 1). One
 * row per company: the nightly collect.krx job resolves table-backed series
 * descriptors from here (via source-adapters.ts loadStockSeriesDescriptors)
 * instead of depending on a beta-series.ts process having registered them
 * in-memory, and the beta flow upserts its registrations so a run's company
 * becomes a first-class nightly series from then on.
 *
 * Upsert semantics (the table's UNIQUE index idx_stock_series_company): a
 * company's listing market is singular — re-registration UPDATES the existing
 * row (ticker/market/display_name/provenance) and clears disabled_at (an
 * explicit re-registration is an affirmative act), never duplicates. Soft
 * disable: a row with disabled_at set keeps its observation history but is
 * skipped by collection (listEnabledStockSeries) until re-registered or
 * manually re-enabled.
 */

export type StockSeriesMarket = "kospi" | "kosdaq";

export interface StockSeriesRow {
  id: string;
  company_id: string;
  /** KRX 단축코드 (6-char short code, e.g. 108490 for 로보티즈). */
  ticker: string;
  market: StockSeriesMarket;
  display_name: string;
  registered_by: string;
  registered_at: string;
  disabled_at: string | null;
}

// biome-ignore lint/suspicious/noExplicitAny: bun:sqlite Database handle
type Db = any;

export interface UpsertStockSeriesInput {
  company_id: string;
  ticker: string;
  market: StockSeriesMarket;
  display_name: string;
  /** Provenance of the registration — 'beta-series' from the beta flow, 'migration-0187' from the backfill. */
  registered_by: string;
}

/** The row for one company, disabled or not, or undefined when never registered. */
export function getStockSeries(db: Db, companyId: string): StockSeriesRow | undefined {
  // bun:sqlite's .get() yields null for no row — normalize to undefined.
  return (db.query("SELECT * FROM stock_series WHERE company_id = ?").get(companyId) ?? undefined) as
    | StockSeriesRow
    | undefined;
}

/** Rows the nightly collection may collect — disabled rows are excluded here. */
export function listEnabledStockSeries(db: Db): StockSeriesRow[] {
  return db.query("SELECT * FROM stock_series WHERE disabled_at IS NULL ORDER BY company_id").all() as StockSeriesRow[];
}

/**
 * Idempotent registration, one row per company. Returns true when a row was
 * inserted or changed (fields updated, or disabled_at cleared); an identical
 * enabled row is a no-op returning false (same change-detection contract as
 * upsertKrxListing in krx-listing.repository.ts). The row's id is stable
 * across updates.
 */
export function upsertStockSeries(db: Db, rec: UpsertStockSeriesInput): boolean {
  const existing = getStockSeries(db, rec.company_id);
  const unchanged =
    existing != null &&
    existing.ticker === rec.ticker &&
    existing.market === rec.market &&
    existing.display_name === rec.display_name &&
    existing.disabled_at === null;
  if (unchanged) return false;

  const id = existing?.id ?? ulid();
  db.run(
    `INSERT INTO stock_series (id, company_id, ticker, market, display_name, registered_by, registered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(company_id) DO UPDATE SET
       ticker = excluded.ticker,
       market = excluded.market,
       display_name = excluded.display_name,
       registered_by = excluded.registered_by,
       registered_at = excluded.registered_at,
       disabled_at = NULL`,
    [id, rec.company_id, rec.ticker, rec.market, rec.display_name, rec.registered_by, new Date().toISOString()],
  );
  return true;
}
