// @version 1.0.0
// FSC bond cross-check client (ADR-0208 slice 4): the issuer's outstanding bonds and their latest price-implied yield
// from the data.go.kr FSC bond APIs, as REFERENCE EVIDENCE only (db/lib/fsc-bond-evidence.ts holds the pure parts and the
// terms: 공공누리 type 2 / type 4). Key: DATA_GO_KR_API_KEY (missing -> FscKeyMissingError, the route answers 503).
//
// Failure handling is graceful: a portal error (key not yet propagated after the 활용신청 approval, quota, expired
// approval) becomes an evidence object with status "unavailable" and a reason code, never an exception; only a missing key
// throws. The key is never logged, never part of a thrown message, never returned. Nothing is stored: results live in a short
// in-process cache (15 minutes, keyed by normalised issuer name) so a panel refresh does not spend the portal's daily quota.
import {
  FSC_BASIC_ENDPOINT,
  FSC_BASIC_MAX_PAGES,
  FSC_BASIC_PAGE_SIZE,
  FSC_PRICE_ENDPOINT,
  FSC_PRICE_LOOKUP_MAX,
  FSC_PRICE_WINDOW_MONTHS,
  assembleBondEvidence,
  classifyFscResponse,
  emptyEvidence,
  isFscError,
  latestPrice,
  normalizeIssuerName,
  normalizeServiceKey,
  parseFscPage,
  priceWindowStart,
  type BondEvidence,
  type FscError,
} from "../../../db/lib/fsc-bond-evidence.ts";
import { seoulToday } from "../../../db/lib/iso-date.ts";
import { loadPipelineKeys } from "../../../scripts/lib/env-keys.ts";

export class FscKeyMissingError extends Error {
  constructor() {
    super("DATA_GO_KR_API_KEY is not configured on the server.");
    this.name = "FscKeyMissingError";
  }
}

export interface FscBondDeps {
  /** GET one prepared URL (the key already inside); answer status and text. Throws only on a transport failure. */
  get(url: string): Promise<{ status: number; text: string }>;
}

export const DEFAULT_FSC_DEPS: FscBondDeps = {
  async get(url) {
    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
    return { status: res.status, text: await res.text() };
  },
};

/** True when DATA_GO_KR_API_KEY is available (loads the .env pipeline keys first). Never exposes the value. */
export function dataGoKrKeyAvailable(): boolean {
  loadPipelineKeys();
  return Boolean(process.env.DATA_GO_KR_API_KEY?.trim());
}

function buildUrl(endpoint: string, key: string, params: Record<string, string>): string {
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `https://${endpoint}?serviceKey=${encodeURIComponent(key)}&${query}`;
}

const CACHE_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; value: BondEvidence }>();
/** Test seam: forget the in-process cache. */
export function resetFscBondCacheForTests(): void {
  cache.clear();
}

function unavailable(name: string, now: Date, e: FscError): BondEvidence {
  const reason =
    e.code === "service_key_not_registered"
      ? "The data.go.kr key is not (yet) registered for this dataset - a new approval can take time to propagate."
      : e.message;
  return emptyEvidence(name, now, "unavailable", e.code, reason);
}

/**
 * Outstanding bonds of the issuer `companyName` with the latest price-implied yield of the largest ones. Never throws
 * except FscKeyMissingError; every portal/transport problem is an `unavailable` evidence object (not cached).
 */
export async function fetchBondEvidence(
  companyName: string,
  now: Date = new Date(),
  deps: FscBondDeps = DEFAULT_FSC_DEPS,
): Promise<BondEvidence> {
  loadPipelineKeys();
  const rawKey = process.env.DATA_GO_KR_API_KEY?.trim();
  if (!rawKey) throw new FscKeyMissingError();
  const key = normalizeServiceKey(rawKey);
  const cacheKey = normalizeIssuerName(companyName);
  const hit = cache.get(cacheKey);
  if (hit && now.getTime() - hit.at < CACHE_MS && now.getTime() >= hit.at) return hit.value;

  const today = seoulToday(now);
  const call = async (endpoint: string, params: Record<string, string>) => {
    let res: { status: number; text: string };
    try {
      res = await deps.get(buildUrl(endpoint, key, { ...params, resultType: "json" }));
    } catch {
      return { code: "service_error", reason_code: null, message: "The portal could not be reached." } as FscError;
    }
    const portal = classifyFscResponse(res.status, res.text);
    if (portal) return portal;
    return parseFscPage(res.text);
  };

  const rows: Array<Record<string, unknown>> = [];
  let total = 0;
  for (let page = 1; page <= FSC_BASIC_MAX_PAGES; page++) {
    const r = await call(FSC_BASIC_ENDPOINT, {
      pageNo: String(page),
      numOfRows: String(FSC_BASIC_PAGE_SIZE),
      bondIsurNm: companyName.trim(),
    });
    if (isFscError(r)) return unavailable(companyName, now, r);
    rows.push(...r.items);
    total = r.totalCount;
    if (rows.length >= r.totalCount || r.items.length < FSC_BASIC_PAGE_SIZE) break;
  }
  const evidence = assembleBondEvidence(companyName, rows, total, today, now);
  if (evidence.status === "ok") {
    const begin = priceWindowStart(today, FSC_PRICE_WINDOW_MONTHS);
    for (const bond of evidence.bonds.slice(0, FSC_PRICE_LOOKUP_MAX)) {
      const r = await call(FSC_PRICE_ENDPOINT, {
        pageNo: "1",
        numOfRows: "100",
        isinCd: bond.isin,
        beginBasDt: begin,
      });
      if (isFscError(r)) {
        // Key/quota problems end the price pass; the bonds without a price are shown as not looked up.
        bond.price_status = "lookup_failed";
        if (r.code === "service_key_not_registered" || r.code === "quota_exceeded") break;
        continue;
      }
      const price = latestPrice(r.items);
      bond.last_price = price;
      bond.price_status = price ? "traded" : "not_traded_in_window";
    }
  }
  cache.set(cacheKey, { at: now.getTime(), value: evidence });
  return evidence;
}
