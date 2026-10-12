// @version 1.1.0
// Pure view helpers for the WACC beta panel's collection-status block.
// Mirrors the `collection` object returned by GET /api/projects/[id]/wacc/beta-series.

export type BetaCollectionStatus = "ready" | "insufficient" | "no_index" | "no_stock" | "none";

export interface BetaSeriesStat {
  count: number;
  first_date: string | null;
  last_date: string | null;
}

export type BetaIndexMarket = "KOSPI" | "KOSDAQ";
export type BetaListingMarket = "KOSPI" | "KOSDAQ" | "KONEX" | "unknown";

export interface BetaIndexOption {
  series_id: string;
  label: BetaIndexMarket;
  count: number;
  selected: boolean;
}

export interface BetaCollection {
  subject_company_id: string;
  subject_company_name: string | null;
  stock_series_id: string;
  index_series_id: string;
  /** Selected index (optional for responses predating the index choice). */
  index_market?: BetaIndexMarket;
  listing_market?: BetaListingMarket;
  index_fallback?: boolean;
  price: BetaSeriesStat;
  index: BetaSeriesStat;
  aligned: BetaSeriesStat;
  source_registered: boolean;
  status: BetaCollectionStatus;
  min_rows: number;
  hint_code: "run_collection" | "ticker_unresolved" | "insufficient_overlap" | "ok" | "index_fallback";
  runbook_command: string;
}

/** True when the textarea may be filled from the collected rows. */
export function shouldFillRows(status: BetaCollectionStatus): boolean {
  return status === "ready" || status === "insufficient";
}

/** True when the runbook command should be offered (nothing usable collected). */
export function showsRunbook(status: BetaCollectionStatus): boolean {
  return status === "none" || status === "no_stock" || status === "no_index";
}

/** Tone maps to existing Onyx tokens in the panel: ok / warn / danger. */
export function statusTone(status: BetaCollectionStatus): "ok" | "warn" | "danger" {
  if (status === "ready") return "ok";
  if (status === "insufficient") return "warn";
  return "danger";
}

const INDEX_NAME_KO: Record<BetaIndexMarket, string> = { KOSPI: "코스피", KOSDAQ: "코스닥" }; // INTERIM-WORDING

/** Select-option label; the listing market's index carries "(상장시장 기준)". */
export function indexOptionLabel(market: BetaIndexMarket, listing: BetaListingMarket | undefined): string {
  return `${INDEX_NAME_KO[market]} 지수${listing === market ? "(상장시장 기준)" : ""}`; // INTERIM-WORDING
}

/** Explains which index is paired with the stock and why. */
export function indexPairingNote(
  c: Pick<BetaCollection, "index_market" | "listing_market" | "index_fallback">,
  explicit: boolean,
): string {
  const m = c.index_market ?? "KOSPI";
  const name = `${INDEX_NAME_KO[m]} 지수`;
  const listing = c.listing_market ?? "unknown";
  if (c.index_fallback) {
    return `${name}와 짝지음 — 상장시장 지수에 수집 데이터가 없어 대체했습니다.`; // INTERIM-WORDING
  }
  if (explicit) return `${name}와 짝지음 — 직접 선택`; // INTERIM-WORDING
  if (listing === "unknown") return `${name}와 짝지음 — 상장시장 정보가 없어 기본값(코스피) 사용`; // INTERIM-WORDING
  if (listing === m) return `${name}와 짝지음 — 종목 상장시장(${listing}) 기준`; // INTERIM-WORDING
  return `${name}와 짝지음 — 상장시장(${listing}) 지수가 없어 기본값 사용`; // INTERIM-WORDING
}

/** GET URL for the beta-series route; index=null leaves the default to the API. */
export function betaSeriesUrl(projectId: string, index: BetaIndexMarket | null): string {
  const base = `/api/projects/${encodeURIComponent(projectId)}/wacc/beta-series`;
  return index ? `${base}?index=${index}` : base;
}

// INTERIM-WORDING: Korean status messages pending copy review.
export function statusMessage(c: Pick<BetaCollection, "status" | "aligned" | "min_rows"> & Partial<Pick<BetaCollection, "index_market">>): string {
  switch (c.status) {
    case "none":
      return "수집된 시계열이 없습니다. 수집을 실행해야 합니다."; // INTERIM-WORDING
    case "no_stock":
      return "지수는 수집됐지만 종목 시계열이 없습니다 — 종목 단축코드 확인(--ticker 지정) 필요"; // INTERIM-WORDING
    case "no_index":
      return `종목은 있으나 ${c.index_market ?? "KOSPI"} 지수 시계열이 없습니다.`; // INTERIM-WORDING
    case "insufficient":
      return `정렬된 거래일이 ${c.aligned.count}일로 최소 ${c.min_rows}일에 못 미칩니다 (수집 기간 확장 필요)`; // INTERIM-WORDING
    case "ready":
      return `${c.aligned.count}일 사용 가능`; // INTERIM-WORDING
  }
}

export function formatSeriesStat(label: string, s: BetaSeriesStat): string {
  if (s.count === 0) return `${label}: 0일`; // INTERIM-WORDING
  return `${label}: ${s.count}일 (${s.first_date} ~ ${s.last_date})`; // INTERIM-WORDING
}

/** Data source shown in step 1 of the regression tab. */
export type BetaSourceMode = "collected" | "paste";

/** Collected data is the default only when the collection has usable rows. */
export function defaultSourceMode(status: BetaCollectionStatus | undefined): BetaSourceMode {
  return status !== undefined && shouldFillRows(status) ? "collected" : "paste";
}

/** "N일 (first ~ last)" without the label, for the status definition list. */
export function seriesRange(s: BetaSeriesStat): string {
  if (s.count === 0) return "0일"; // INTERIM-WORDING
  return `${s.count}일 · ${s.first_date} ~ ${s.last_date}`; // INTERIM-WORDING
}

/** Inline reason shown next to the disabled run button. */
export function runDisabledReason(rowCount: number, status: BetaCollectionStatus | undefined): string {
  if (rowCount < 2 && status !== undefined && shouldFillRows(status)) {
    return "먼저 수집 데이터를 불러오세요"; // INTERIM-WORDING
  }
  return "입력 데이터가 없습니다 — 수집 데이터를 불러오거나 붙여넣으세요"; // INTERIM-WORDING
}

export interface BetaSeriesRow {
  date: string;
  price: number;
  index: number;
}

export type BetaSeriesParse =
  | {
      ok: true;
      collection: BetaCollection | null;
      rows: BetaSeriesRow[];
      indexOptions: BetaIndexOption[];
      defaultIndex: BetaIndexMarket | null;
    }
  | { ok: false; message: string };

export const BETA_SERIES_LOAD_ERROR = "수집 데이터를 불러오지 못했습니다."; // INTERIM-WORDING

/**
 * Interprets a GET beta-series response. The API uses the standard envelope
 * {data, meta, error} (lib/envelope.ts) — there is NO `ok` field, so success is
 * HTTP ok + non-null data + null error.
 */
export function parseBetaSeriesResponse(httpOk: boolean, body: unknown): BetaSeriesParse {
  const b = (body && typeof body === "object" ? body : null) as {
    data?: {
      collection?: BetaCollection | null;
      rows?: BetaSeriesRow[];
      index_options?: BetaIndexOption[];
      default_index?: BetaIndexMarket;
    } | null;
    error?: { message?: string } | null;
  } | null;
  if (!httpOk || !b?.data || b.error != null) {
    return { ok: false, message: b?.error?.message || BETA_SERIES_LOAD_ERROR };
  }
  return {
    ok: true,
    collection: b.data.collection ?? null,
    rows: Array.isArray(b.data.rows) ? b.data.rows : [],
    indexOptions: Array.isArray(b.data.index_options) ? b.data.index_options : [],
    defaultIndex: b.data.default_index === "KOSPI" || b.data.default_index === "KOSDAQ" ? b.data.default_index : null,
  };
}
