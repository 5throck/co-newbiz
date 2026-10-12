// @version 1.0.0
// Pure view helpers for the WACC beta panel's collection-status block.
// Mirrors the `collection` object returned by GET /api/projects/[id]/wacc/beta-series.

export type BetaCollectionStatus = "ready" | "insufficient" | "no_index" | "no_stock" | "none";

export interface BetaSeriesStat {
  count: number;
  first_date: string | null;
  last_date: string | null;
}

export interface BetaCollection {
  subject_company_id: string;
  subject_company_name: string | null;
  stock_series_id: string;
  index_series_id: string;
  price: BetaSeriesStat;
  index: BetaSeriesStat;
  aligned: BetaSeriesStat;
  source_registered: boolean;
  status: BetaCollectionStatus;
  min_rows: number;
  hint_code: "run_collection" | "ticker_unresolved" | "insufficient_overlap" | "ok";
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

// INTERIM-WORDING: Korean status messages pending copy review.
export function statusMessage(c: Pick<BetaCollection, "status" | "aligned" | "min_rows">): string {
  switch (c.status) {
    case "none":
      return "수집된 시계열이 없습니다. 수집을 실행해야 합니다."; // INTERIM-WORDING
    case "no_stock":
      return "지수는 수집됐지만 종목 시계열이 없습니다 — 종목 단축코드 확인(--ticker 지정) 필요"; // INTERIM-WORDING
    case "no_index":
      return "종목은 있으나 KOSPI 지수 시계열이 없습니다."; // INTERIM-WORDING
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

export interface BetaSeriesRow {
  date: string;
  price: number;
  index: number;
}

export type BetaSeriesParse =
  | { ok: true; collection: BetaCollection | null; rows: BetaSeriesRow[] }
  | { ok: false; message: string };

export const BETA_SERIES_LOAD_ERROR = "수집 데이터를 불러오지 못했습니다."; // INTERIM-WORDING

/**
 * Interprets a GET beta-series response. The API uses the standard envelope
 * {data, meta, error} (lib/envelope.ts) — there is NO `ok` field, so success is
 * HTTP ok + non-null data + null error.
 */
export function parseBetaSeriesResponse(httpOk: boolean, body: unknown): BetaSeriesParse {
  const b = (body && typeof body === "object" ? body : null) as {
    data?: { collection?: BetaCollection | null; rows?: BetaSeriesRow[] } | null;
    error?: { message?: string } | null;
  } | null;
  if (!httpOk || !b?.data || b.error != null) {
    return { ok: false, message: b?.error?.message || BETA_SERIES_LOAD_ERROR };
  }
  return { ok: true, collection: b.data.collection ?? null, rows: Array.isArray(b.data.rows) ? b.data.rows : [] };
}
