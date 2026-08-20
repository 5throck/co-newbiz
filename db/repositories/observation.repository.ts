// @version 1.0.0
/**
 * ensure_fresh() — cache-first, revision-preserving observation ingest.
 * FR-DATA-05 (docs/srs.md §2), design v1.0 §4-1, ADR-0004.
 *
 * Contract:
 *   1. If a cached observation exists and is within its validity window,
 *      reuse it — no network call.
 *   2. Otherwise call the fetcher (real usage: scripts/lib/ssrf.ts's
 *      safeFetch(), injected here rather than imported directly so this
 *      function is testable without a live network dependency or API key —
 *      see db/repositories/observation.repository.test.ts).
 *   3. On a genuine value change, INSERT a new revision row — the prior
 *      revision is never overwritten (a statistics agency restating
 *      history must not make a 3-month-old analysis unreproducible).
 *   4. Every insert (new or revised) is logged to data_change_log.
 */

import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";

export interface FetchedObservation {
  value: number;
  contentHash: string;
  raw: string;
}

export type Fetcher = (seriesId: string) => Promise<FetchedObservation>;

export interface EnsureFreshOptions {
  seriesId: string;
  periodId: string;
  unitId: string;
  sourceId: string;
  /** Cache validity window in ms. Default 24h. */
  ttlMs?: number;
  fetcher: Fetcher;
}

export interface EnsureFreshResult {
  value: number;
  revisionNo: number;
  fromCache: boolean;
  changeType: "new" | "revised" | "unchanged" | null;
}

function getLatestRevision(
  seriesId: string,
  periodId: string
): { revision_no: number; value: number; content_hash: string; fetched_at: string } | null {
  const db = getDb();
  const row = db
    .query(
      `SELECT revision_no, value, content_hash, fetched_at
       FROM fact_market_observation
       WHERE series_id = ? AND period_id = ?
       ORDER BY revision_no DESC LIMIT 1`
    )
    .get(seriesId, periodId) as
    | { revision_no: number; value: number; content_hash: string; fetched_at: string }
    | undefined;
  return row ?? null;
}

export async function ensureFresh(opts: EnsureFreshOptions): Promise<EnsureFreshResult> {
  const { seriesId, periodId, unitId, sourceId, fetcher, ttlMs = 24 * 60 * 60 * 1000 } = opts;
  const db = getDb();

  const latest = getLatestRevision(seriesId, periodId);

  // Step 1: cache-first — reuse within the validity window, zero network calls.
  if (latest) {
    const age = Date.now() - new Date(latest.fetched_at).getTime();
    if (age < ttlMs) {
      return { value: latest.value, revisionNo: latest.revision_no, fromCache: true, changeType: null };
    }
  }

  // Step 2: fetch (in production: safeFetch()-backed; here, an injected fetcher).
  const fetched = await fetcher(seriesId);
  const now = new Date().toISOString();

  // Content-hash comparison stands in for conditional-request (ETag) logic
  // for sources that don't support one — either way, an unchanged fetch
  // makes no new revision row.
  if (latest && latest.content_hash === fetched.contentHash) {
    return { value: latest.value, revisionNo: latest.revision_no, fromCache: false, changeType: "unchanged" };
  }

  // Step 3: genuine change (or first-ever observation) — insert a NEW
  // revision, never overwrite. Step 4: log it.
  const nextRevision = latest ? latest.revision_no + 1 : 1;
  const changeType: "new" | "revised" = latest ? "revised" : "new";

  db.transaction(() => {
    db.run(
      `INSERT INTO fact_market_observation
         (series_id, period_id, revision_no, value, unit_id, source_id, content_hash, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [seriesId, periodId, nextRevision, fetched.value, unitId, sourceId, fetched.contentHash, now]
    );
    db.run(
      `INSERT INTO data_change_log (id, series_id, detected_at, change_type, old_value, new_value)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ulid(), seriesId, now, changeType, latest?.value ?? null, fetched.value]
    );
  })();

  return { value: fetched.value, revisionNo: nextRevision, fromCache: false, changeType };
}
