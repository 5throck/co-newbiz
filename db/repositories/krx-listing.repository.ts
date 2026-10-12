// @version 1.0.0
/**
 * KRX listing-market metadata per company (KOSPI | KOSDAQ | KONEX), stored in
 * the existing raw layer table `raw_payload` — no migration. One row per
 * company with a deterministic primary key `krx:stock-master:<md_company.id>`;
 * the payload is the resolved stock-master record (short code + market) as
 * written by scripts/co-newbiz/beta-series.ts. Read by the WACC beta-series
 * route to pick the default index (listing market) for the beta regression.
 */

export type KrxListingMarket = "KOSPI" | "KOSDAQ" | "KONEX";

export interface KrxListingRecord {
  kind: "krx_stock_master";
  company_id: string;
  short_code: string;
  market: KrxListingMarket;
  name_ko: string;
  resolved_at: string;
}

// biome-ignore lint/suspicious/noExplicitAny: bun:sqlite Database handle
type Db = any;

export function krxListingPayloadId(companyId: string): string {
  return `krx:stock-master:${companyId}`;
}

export function normalizeKrxMarket(raw: unknown): KrxListingMarket | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "KOSPI" || s === "KOSDAQ" || s === "KONEX") return s;
  // KRX MKT_NM spellings ("유가증권", "코스닥", "코넥스").
  if (s.includes("코스닥")) return "KOSDAQ";
  if (s.includes("유가") || s.includes("코스피")) return "KOSPI";
  if (s.includes("코넥스")) return "KONEX";
  return null;
}

/** Idempotent upsert; returns true when a row was inserted or changed. */
export async function upsertKrxListing(
  db: Db,
  sourceId: string,
  rec: Omit<KrxListingRecord, "kind">,
): Promise<boolean> {
  const id = krxListingPayloadId(rec.company_id);
  const record: KrxListingRecord = { kind: "krx_stock_master", ...rec };
  const identity = JSON.stringify({ c: record.company_id, s: record.short_code, m: record.market });
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const hash = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const existing = db.query("SELECT content_hash FROM raw_payload WHERE id = ?").get(id) as { content_hash: string } | undefined;
  if (existing?.content_hash === hash) return false;
  const now = new Date().toISOString();
  if (existing) {
    db.run("UPDATE raw_payload SET source_id = ?, fetched_at = ?, content_hash = ?, payload = ? WHERE id = ?",
      [sourceId, now, hash, JSON.stringify(record), id]);
  } else {
    db.run("INSERT INTO raw_payload (id, source_id, fetched_at, content_hash, payload) VALUES (?,?,?,?,?)",
      [id, sourceId, now, hash, JSON.stringify(record)]);
  }
  return true;
}

/** Listing market for a company, or null when never recorded / unreadable. */
export function readKrxListingMarket(db: Db, companyId: string): KrxListingMarket | null {
  const row = db.query("SELECT payload FROM raw_payload WHERE id = ?").get(krxListingPayloadId(companyId)) as
    | { payload: string }
    | undefined;
  if (!row) return null;
  try {
    return normalizeKrxMarket((JSON.parse(row.payload) as { market?: unknown }).market);
  } catch {
    return null;
  }
}
