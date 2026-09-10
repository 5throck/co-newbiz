// @version 1.0.0
/**
 * Beta estimation from a pasted price series — OLS on daily returns
 * (ADR-0115).
 *
 * The workspace has no stock-price pipeline (the DART adapter is
 * catalog + financial statements only), so the session takes the series the
 * user pastes from their terminal/data provider: `date, price, index` rows,
 * CSV or TSV. Everything here is pure TS with no bun:sqlite import — the
 * web-next WACC page runs the same regression client-side that the tests
 * verify, and the resulting stats (β, R², annualized vols) are persisted as
 * `wacc.beta_*` component rows so the "volatility vs the market" answer
 * stays reproducible from the assumption registry.
 */

import { hamadaUnlever } from "./wacc-components.ts";

export interface BetaRegressionRow {
  date: string;
  price: number;
  indexPrice: number;
}

export interface BetaRegressionResult {
  /** OLS slope — the levered beta of the regressed security vs the market series. */
  beta: number;
  /** OLS intercept per daily period (report as annual by ×252 in the UI). */
  alpha: number;
  r2: number;
  /** Number of daily-return observations (rows − 1). */
  n: number;
  windowStart: string;
  windowEnd: string;
  /** Annualized standard deviation of daily returns, ×√252. */
  annualVolAsset: number;
  annualVolMarket: number;
  annualAlpha: number;
  /** annualVolAsset / annualVolMarket — the "how much more volatile than the market" answer. */
  volRatio: number;
}

export class BetaRegressionError extends Error {}

/**
 * Parse pasted CSV/TSV: comma, tab, or semicolon separated; the first line
 * may be a header (skipped when its 2nd/3rd cells are not numbers). Dates
 * are kept as strings (ISO expected) — only used for window labels and sort.
 */
export function parseSeriesInput(text: string): BetaRegressionRow[] {
  const rows: BetaRegressionRow[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    const cells = line.split(/[,;\t]/).map((s) => s.trim());
    if (cells.length < 3) {
      throw new BetaRegressionError(`each row needs 3 columns (date, price, index) — got ${cells.length}: "${line.slice(0, 60)}"`);
    }
    const price = Number(cells[1]);
    const indexPrice = Number(cells[2]);
    if (!Number.isFinite(price) || !Number.isFinite(indexPrice)) {
      // Header row (or a note line) — skip silently only when BOTH numeric cells fail
      // and the line looks like the first header; anything later is a hard error.
      if (rows.length === 0 && Number.isNaN(price) && Number.isNaN(indexPrice)) continue;
      throw new BetaRegressionError(`non-numeric price/index in row: "${line.slice(0, 60)}"`);
    }
    if (price <= 0 || indexPrice <= 0) {
      throw new BetaRegressionError(`prices must be positive in row: "${line.slice(0, 60)}"`);
    }
    rows.push({ date: cells[0], price, indexPrice });
  }
  if (rows.length < 3) {
    throw new BetaRegressionError(`at least 3 data rows are required for a regression (got ${rows.length}).`);
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

function dailyReturns(values: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < values.length; i++) r.push(values[i] / values[i - 1] - 1);
  return r;
}

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function variance(xs: number[], m: number): number {
  return xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1);
}

function covariance(xs: number[], ys: number[], mx: number, my: number): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i] - mx) * (ys[i] - my);
  return s / (xs.length - 1);
}

function stdev(xs: number[], m: number): number {
  return Math.sqrt(variance(xs, m));
}

const TRADING_DAYS = 252;

/** OLS beta of asset on market, plus the R² and annualized volatilities the session displays. */
export function olsBeta(rows: BetaRegressionRow[]): BetaRegressionResult {
  if (rows.length < 3) throw new BetaRegressionError("at least 3 data rows are required.");
  const ra = dailyReturns(rows.map((r) => r.price));
  const rm = dailyReturns(rows.map((r) => r.indexPrice));
  const ma = mean(ra);
  const mm = mean(rm);
  const varM = variance(rm, mm);
  if (varM === 0) throw new BetaRegressionError("market series has zero variance — beta is undefined.");
  const cov = covariance(ra, rm, ma, mm);
  const beta = cov / varM;
  const alpha = ma - beta * mm;
  const varA = variance(ra, ma);
  const r2 = varA === 0 ? 1 : (cov * cov) / (varA * varM);
  const volA = stdev(ra, ma) * Math.sqrt(TRADING_DAYS);
  const volM = stdev(rm, mm) * Math.sqrt(TRADING_DAYS);
  return {
    beta,
    alpha,
    r2,
    n: ra.length,
    windowStart: rows[0].date,
    windowEnd: rows[rows.length - 1].date,
    annualVolAsset: volA,
    annualVolMarket: volM,
    annualAlpha: alpha * TRADING_DAYS,
    volRatio: volM === 0 ? NaN : volA / volM,
  };
}

/** Convenience: paste text → parsed → regressed, in one call. */
export function regressionFromText(text: string): BetaRegressionResult {
  return olsBeta(parseSeriesInput(text));
}

/** Daily (market, asset) return pairs for the UI's regression scatter plot. */
export function scatterPoints(rows: BetaRegressionRow[]): { x: number; y: number }[] {
  const ra = dailyReturns(rows.map((r) => r.price));
  const rm = dailyReturns(rows.map((r) => r.indexPrice));
  return rm.map((x, i) => ({ x, y: ra[i] }));
}

export interface PeerBetaInput {
  label: string;
  /** Publicly cited (levered) beta, e.g. from AlphaSpread. */
  betaLevered: number;
  deRatio: number;
  taxRate: number;
}

/**
 * Peer-group path: unlever each cited beta (Hamada) and take the median βU.
 * Individual peer values travel in the rationale text; only the median is
 * persisted as `wacc.beta_unlevered`.
 */
export function medianBetaUnlevered(peers: PeerBetaInput[]): { median: number; details: number[] } {
  if (peers.length === 0) throw new BetaRegressionError("at least one peer is required.");
  const details = peers.map((p) => {
    if (p.deRatio < 0 || p.taxRate < 0 || p.taxRate >= 1) {
      throw new BetaRegressionError(`peer '${p.label}' has an out-of-range D/E or tax rate.`);
    }
    return hamadaUnlever(p.betaLevered, p.deRatio, p.taxRate);
  });
  const sorted = [...details].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { median, details };
}
