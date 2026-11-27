// @version 1.0.0
/**
 * FSC bond APIs on data.go.kr as CROSS-CHECK EVIDENCE for the WACC credit spread (ADR-0208 slice 4, design
 * 2026-11-26-wacc-credit-rating-spread-design sections 4.2 and 17.5). PURE: request helpers, error classification, response
 * parsing and the evidence assembly; the network lives in app/web-next/lib/fsc-bond-client.ts.
 *
 * What it is: the issuer's OUTSTANDING bonds (coupon, maturity, balance) from 금융위원회_채권기본정보
 * (GetBondIssuInfoService_V2 / getBondBasiInfo_V2, dataset 15059592) and, per bond, the latest price-implied yield from
 * 금융위원회_채권시세정보 (GetBondSecuritiesInfoService_V2 / getBondPriceInfo_V2, dataset 15094784, KRX data), shown NEXT TO
 * the credit spread as reference evidence. It is NEVER an applied value, never part of apply-all, never written to an
 * assumption or audit row, and never changes a spread, a rating or a gate. Nothing here is stored.
 *
 * Terms (공공누리, KOGL): basic info is type 2 (source attribution, no commercial use; commercial users contract with
 * 한국예탁결제원), price info is type 4 (source attribution, no commercial use, NO MODIFICATION). The price yield is therefore
 * shown exactly as published (clprBnfRt) with its date, and only for display; the panel carries the attribution notice.
 * Whether internal valuation work counts as "commercial use" is a legal-counsel reading (design section 4.2), not decided here.
 *
 * Verified live 2026-11-27 with the repo key (Encoding form of the key, passed unchanged): both operations answer
 * HTTP 200 / resultCode 00 with the field names below (basDt, crno, isinCd, isinCdNm, bondIsurNm, bondIssuDt, bondExprDt,
 * bondSrfcInrt, bondBal, bondIssuAmt, grnDcdNm, bondRnknDcdNm, bondOffrMcdNm, irtChngDcdNm; price: basDt, isinCd, itmsNm,
 * clprPrc, clprBnfRt, trqu). Amounts are full KRW strings. Single-item and empty results are not arrays (handled).
 */

export const FSC_BASIC_ENDPOINT = "apis.data.go.kr/1160100/GetBondIssuInfoService_V2/getBondBasiInfo_V2";
export const FSC_PRICE_ENDPOINT = "apis.data.go.kr/1160100/GetBondSecuritiesInfoService_V2/getBondPriceInfo_V2";

/** Source attribution and licence notice the panel and the docs carry (공공누리 type 2 and type 4). */
export const FSC_ATTRIBUTION = {
  basic: {
    dataset: "금융위원회_채권기본정보",
    dataset_id: "15059592",
    provider: "금융위원회 (한국예탁결제원)",
    license: "공공누리 제2유형",
    terms: "attribution_required_no_commercial_use",
    url: "https://www.data.go.kr/data/15059592/openapi.do",
  },
  price: {
    dataset: "금융위원회_채권시세정보",
    dataset_id: "15094784",
    provider: "금융위원회 (한국거래소)",
    license: "공공누리 제4유형",
    terms: "attribution_required_no_commercial_use_no_modification",
    url: "https://www.data.go.kr/data/15094784/openapi.do",
  },
} as const;

/** How many of the issuer's outstanding bonds get a price lookup (largest balance first) and how long a price may be old. */
export const FSC_PRICE_LOOKUP_MAX = 5;
export const FSC_PRICE_WINDOW_MONTHS = 12;
const BASIC_PAGE_SIZE = 100;
export const FSC_BASIC_MAX_PAGES = 3;

/**
 * The data.go.kr key is issued in an Encoding form (percent-escaped) and a Decoding form. The repo's .env carries the
 * Encoding form; URLSearchParams / encodeURIComponent would escape it a second time and the portal answers
 * SERVICE_KEY_IS_NOT_REGISTERED. A value containing a %XX escape is decoded once; any other value is used as is. The
 * caller escapes the result exactly once.
 */
export function normalizeServiceKey(raw: string): string {
  const t = raw.trim();
  if (/%[0-9A-Fa-f]{2}/.test(t)) {
    try {
      return decodeURIComponent(t);
    } catch {
      return t;
    }
  }
  return t;
}

/** Issuer name as md_company.name_ko and the bond register write it: company-form words and spaces removed. */
export function normalizeIssuerName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/\(주\)|\(유\)|주식회사|유한회사|㈜/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export type FscErrorCode =
  | "service_key_not_registered"
  | "quota_exceeded"
  | "service_expired"
  | "no_service"
  | "service_error"
  | "invalid_response";

export interface FscError {
  code: FscErrorCode;
  /** data.go.kr returnReasonCode / resultCode when present. */
  reason_code: string | null;
  message: string;
}

/** Portal-level error (HTTP 4xx with an OpenAPI_ServiceResponse body, JSON or XML) or service-level resultCode != 00. */
export function classifyFscResponse(status: number, text: string): FscError | null {
  const portal =
    text.match(/"errMsg"\s*:\s*"([^"]+)"/)?.[1] ??
    text.match(/<errMsg>([^<]+)<\/errMsg>/)?.[1] ??
    text.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>/)?.[1] ??
    null;
  const reason =
    text.match(/"returnReasonCode"\s*:\s*"?(\d+)"?/)?.[1] ??
    text.match(/<returnReasonCode>(\d+)<\/returnReasonCode>/)?.[1] ??
    null;
  if (portal) {
    const code: FscErrorCode =
      portal.includes("SERVICE_KEY_IS_NOT_REGISTERED") || reason === "30"
        ? "service_key_not_registered"
        : portal.includes("LIMITED_NUMBER") || reason === "22"
          ? "quota_exceeded"
          : portal.includes("DEADLINE_HAS_EXPIRED") || reason === "31"
            ? "service_expired"
            : portal.includes("NO_OPENAPI_SERVICE") || reason === "12"
              ? "no_service"
              : "service_error";
    return { code, reason_code: reason, message: portal };
  }
  if (status < 200 || status >= 300) {
    return { code: "service_error", reason_code: null, message: `HTTP ${status}` };
  }
  return null;
}

type Raw = Record<string, unknown>;
const isMap = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

export interface FscPage<T> {
  totalCount: number;
  items: T[];
}

/** `response.body` of a data.go.kr JSON answer -> its items (array, single object or empty string all handled). */
export function parseFscPage(text: string): FscPage<Raw> | FscError {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { code: "invalid_response", reason_code: null, message: "The answer is not JSON." };
  }
  const response = isMap(doc) && isMap(doc.response) ? doc.response : null;
  const header = response && isMap(response.header) ? response.header : null;
  const body = response && isMap(response.body) ? response.body : null;
  if (!header || !body) return { code: "invalid_response", reason_code: null, message: "No response header or body." };
  const resultCode = String(header.resultCode ?? "");
  if (resultCode !== "00") {
    return {
      code:
        resultCode === "30" ? "service_key_not_registered" : resultCode === "22" ? "quota_exceeded" : "service_error",
      reason_code: resultCode || null,
      message: String(header.resultMsg ?? "service error"),
    };
  }
  const itemsNode = body.items;
  const itemRaw = isMap(itemsNode) ? itemsNode.item : undefined;
  const items = Array.isArray(itemRaw) ? itemRaw.filter(isMap) : isMap(itemRaw) ? [itemRaw] : [];
  const total = Number(body.totalCount);
  return { totalCount: Number.isFinite(total) ? total : items.length, items };
}

export const isFscError = (v: FscPage<Raw> | FscError): v is FscError => "code" in v;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/** YYYYMMDD -> YYYY-MM-DD; null for anything else (including blank). */
function ymd(v: unknown): string | null {
  const s = str(v);
  return s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}
/** Full KRW (string) -> INTEGER KRW millions (ADR-0061); null when absent. */
function krwMillion(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n / 1_000_000);
}

export interface BondBasic {
  isin: string;
  name: string;
  issuer_name: string;
  crno: string | null;
  issued_on: string | null;
  matures_on: string | null;
  /** Coupon in percent points as published. */
  coupon_pct: number | null;
  balance_krw_million: number | null;
  issue_amount_krw_million: number | null;
  seniority: string | null;
  guarantee: string | null;
  offering: string | null;
  rate_type: string | null;
  basis_date: string | null;
}

export function parseBondBasic(r: Raw): BondBasic | null {
  const isin = str(r.isinCd);
  const issuer = str(r.bondIsurNm);
  if (!isin || !issuer) return null;
  return {
    isin,
    name: str(r.isinCdNm) ?? isin,
    issuer_name: issuer,
    crno: str(r.crno),
    issued_on: ymd(r.bondIssuDt),
    matures_on: ymd(r.bondExprDt),
    coupon_pct: num(r.bondSrfcInrt),
    balance_krw_million: krwMillion(r.bondBal),
    issue_amount_krw_million: krwMillion(r.bondIssuAmt),
    seniority: str(r.bondRnknDcdNm),
    guarantee: str(r.grnDcdNm),
    offering: str(r.bondOffrMcdNm),
    rate_type: str(r.irtChngDcdNm),
    basis_date: ymd(r.basDt),
  };
}

export interface BondPrice {
  /** YYYY-MM-DD of the trading day. */
  as_of: string;
  /** Closing yield in percent points exactly as published (KOGL 4: no modification). */
  yield_pct: number;
  close_price: number | null;
}

/** Latest trading day of a price answer (the API does not promise an order): the row with the greatest basDt. */
export function latestPrice(items: Raw[]): BondPrice | null {
  let best: BondPrice | null = null;
  for (const r of items) {
    const asOf = ymd(r.basDt);
    const y = num(r.clprBnfRt);
    if (!asOf || y === null) continue;
    if (!best || asOf > best.as_of) best = { as_of: asOf, yield_pct: y, close_price: num(r.clprPrc) };
  }
  return best;
}

export type BondPriceStatus = "traded" | "not_traded_in_window" | "not_looked_up" | "lookup_failed";

export interface EvidenceBond extends BondBasic {
  last_price: BondPrice | null;
  price_status: BondPriceStatus;
}

export type BondEvidenceStatus = "ok" | "no_bonds" | "ambiguous_issuer" | "unavailable";

export interface BondEvidence {
  /** Reference evidence only: never applied, never part of apply-all, never stored (design 17.5). */
  cross_check_only: true;
  status: BondEvidenceStatus;
  reason_code: string | null;
  reason: string | null;
  issuer: { query_name: string; matched_name: string | null; crno: string | null; match_basis: "name" };
  /** Outstanding bonds, largest balance first. */
  bonds: EvidenceBond[];
  basis_date: string | null;
  /** True when the register held more rows than the pages read. */
  truncated: boolean;
  /** Price lookups attempted for at most FSC_PRICE_LOOKUP_MAX bonds; older trading than the window is not shown. */
  price_window_months: number;
  fetched_at: string;
  attribution: typeof FSC_ATTRIBUTION;
}

export function emptyEvidence(
  queryName: string,
  now: Date,
  status: BondEvidenceStatus,
  reasonCode: string | null,
  reason: string | null,
): BondEvidence {
  return {
    cross_check_only: true,
    status,
    reason_code: reasonCode,
    reason,
    issuer: { query_name: queryName, matched_name: null, crno: null, match_basis: "name" },
    bonds: [],
    basis_date: null,
    truncated: false,
    price_window_months: FSC_PRICE_WINDOW_MONTHS,
    fetched_at: now.toISOString(),
    attribution: FSC_ATTRIBUTION,
  };
}

/**
 * Basic-info rows of one name search -> the issuer's outstanding bonds. Matching is by NAME (md_company stores no
 * corporate registration number, only the 10-digit business registration number, a different identifier): rows whose
 * normalised issuer name differs are dropped (the search is not guaranteed exact); when the kept rows name more than one
 * crno the issuer is `ambiguous_issuer` and nothing is shown. A bond is outstanding when its balance is positive and it
 * has not matured (maturity on or after `todayIso`; an unknown maturity is kept).
 */
export function assembleBondEvidence(
  queryName: string,
  rows: Raw[],
  totalCount: number,
  todayIso: string,
  now: Date,
): BondEvidence {
  const wanted = normalizeIssuerName(queryName);
  const parsed = rows.map(parseBondBasic).filter((b): b is BondBasic => b !== null);
  const matched = parsed.filter((b) => normalizeIssuerName(b.issuer_name) === wanted);
  if (matched.length === 0) {
    return emptyEvidence(queryName, now, "no_bonds", "no_issuer_match", null);
  }
  const crnos = new Set(matched.map((b) => b.crno).filter((c): c is string => c !== null));
  if (crnos.size > 1) {
    return emptyEvidence(
      queryName,
      now,
      "ambiguous_issuer",
      "ambiguous_issuer",
      `The name matches ${crnos.size} different corporate registration numbers; nothing is shown.`,
    );
  }
  const outstanding = matched
    .filter((b) => (b.balance_krw_million ?? 1) > 0 && (b.matures_on === null || b.matures_on >= todayIso))
    .sort((a, b) => (b.balance_krw_million ?? 0) - (a.balance_krw_million ?? 0));
  const base = emptyEvidence(queryName, now, outstanding.length > 0 ? "ok" : "no_bonds", null, null);
  return {
    ...base,
    reason_code: outstanding.length > 0 ? null : "no_outstanding_bonds",
    issuer: {
      query_name: queryName,
      matched_name: matched[0].issuer_name,
      crno: crnos.size === 1 ? [...crnos][0] : null,
      match_basis: "name",
    },
    bonds: outstanding.map((b) => ({ ...b, last_price: null, price_status: "not_looked_up" as BondPriceStatus })),
    basis_date:
      matched
        .map((b) => b.basis_date)
        .filter((d): d is string => d !== null)
        .sort()
        .pop() ?? null,
    truncated: totalCount > rows.length,
  };
}

/** The date `months` before `todayIso`, as YYYYMMDD (the price API's beginBasDt). */
export function priceWindowStart(todayIso: string, months: number): string {
  const [y, m, d] = todayIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 - months, d));
  return dt.toISOString().slice(0, 10).replaceAll("-", "");
}

/** Page size the client uses for the basic-info call. */
export const FSC_BASIC_PAGE_SIZE = BASIC_PAGE_SIZE;
