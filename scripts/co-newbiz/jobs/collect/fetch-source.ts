// @version 1.0.0
/**
 * fetch-source.ts — the library-level collection entry point (ADR-0189 phase P5,
 * design docs/designs/2026-10-29-scheduled-jobs-design.md section 3.2).
 *
 * Extracted from the `fetch` case of scripts/co-newbiz/newbiz.ts so that BOTH the
 * CLI and the five `collect.*` scheduler handlers call the same function; the
 * handlers get structural counts instead of printed lines (design section 2.2:
 * handlers call library functions, never the CLI through a sub-shell). The
 * `md:sync` case needs no separate library entry: for the catalog-kind adapters
 * (dart/law) md:sync and fetch perform the same registration + listCatalog +
 * natural-key upsert, which is this module's catalog branch.
 *
 * Write semantics per (series_id, period) — the design section 3.1 idempotency row
 * ("upsert on (series_id, period); data_change_log row only when value differs"):
 *   - no existing row      → one transaction: INSERT revision 1 + one
 *                            data_change_log 'new' row (old_value NULL) — the same
 *                            contract as ensure_fresh
 *                            (db/repositories/observation.repository.ts:16,96-107).
 *                            Both consumers need the 'new' row: watch-run.ts:130
 *                            counts change-log rows past the watch watermark
 *                            (a first-ever insert must count as new data), and
 *                            watch-engine.ts staleness reads MAX(detected_at) —
 *                            without the row a project whose only ingest was last
 *                            night's backfill reads as maximally stale ("no data
 *                            change ever recorded"). The backfill flood concern is
 *                            bounded: tens of rows for the ecos/kosis seeds, ~500
 *                            one-time for KRX YTD, and catalog syncs never touch
 *                            the log at all (data-architect review 2026-11-01).
 *   - identical value      → idempotent no-op: no new revision, no log row
 *                            (revision-preserving FR-DATA-05 without revision spam).
 *                            Comparison is by VALUE, not content hash — a
 *                            re-serialized identical payload is not a change.
 *   - genuinely new value  → one transaction: INSERT revision_no+1 (the prior
 *                            revision is never overwritten) + one data_change_log
 *                            'revised' row (old_value → new_value), which
 *                            watch-run.ts and db/lib/watch-engine.ts consume.
 * Transaction grain is PER OBSERVATION, not per run: the invariant the design
 * states is "change-log row inside the same transaction as the upsert", and one
 * whole-run transaction would hold the SQLite write lock for minutes on a KRX
 * night (~500 rows), starving the web server (design section 11 risk table).
 * Deletion detection ('deleted') is intentionally NOT implemented: fetch windows
 * vary run to run (--from/--to, YTD default), so an absent period must not read
 * as mass deletion.
 *
 * Unlike ensure_fresh() (db/repositories/observation.repository.ts — the app's
 * cache-first ON-DEMAND path, left untouched), collection always fetches: change
 * detection is the point of the run, so there is no 24 h TTL short-circuit.
 * Credential gating returns a structured `credential_missing` outcome instead of
 * throwing — the collect.* handlers map it to job_run status `skipped`
 * (design section 3.1: no nightly false alarms for intentionally disabled
 * sources); adapters themselves stay fail-closed.
 *
 * Failures are structured {seriesId, period?, message, retryable} entries — raw
 * exception objects never leave this module (secrets are scrubbed downstream by
 * run-job's scrubber, but URLs with keys are not constructed here at all).
 */
import { ulid } from "../../../../db/lib/ulid.ts";
import { KOSIS_UNITS } from "../../kosis-units.ts";
import { KrxHttpError, SOURCE_ADAPTERS, upsertCatalog, type SourceAdapter } from "../../source-adapters.ts";

// ── Public types ────────────────────────────────────────────────────────────

export interface CollectFailure {
  seriesId: string;
  /** period key (YYYY-MM or YYYY-MM-DD) when the failure is period-scoped */
  period?: string;
  /** single-line reason; already free of URLs/keys (adapters throw scrubbed-safe messages) */
  message: string;
  /** true = network/5xx/429-class (the collect.* handlers may retry the whole run) */
  retryable: boolean;
}

export type FetchSourceEvent =
  | { type: "source_registered"; code: string; grade: string }
  | { type: "warn_unverified"; seriesId: string }
  | { type: "row"; seriesId: string; period: string; status: "new" | "revised" | "unchanged"; revisionNo: number }
  | { type: "failure"; seriesId: string; period?: string; message: string };

export interface FetchSourceOptions {
  /** restrict to one series id (matches SeriesDescriptor.seriesId or tblId) */
  seriesArg?: string;
  /** --from YYYY-MM (observations only; default current-year January) */
  fromArg?: string;
  /** --to YYYY-MM (observations only; default current-year December) */
  toArg?: string;
  /** --all (catalog adapters: drops the law operating whitelist) */
  all?: boolean;
  /** checked between units of work (the scheduler handler's timeout signal) */
  signal?: AbortSignal;
  /** streaming event sink — the CLI prints these lines, handlers ignore them */
  emit?: (e: FetchSourceEvent) => void;
  /** test fixture override of the SOURCE_ADAPTERS registry */
  adapters?: Record<string, SourceAdapter>;
}

export interface FetchSourceOk {
  ok: true;
  source: string;
  kind: "observations" | "catalog";
  /** true when this run inserted the md_source row */
  sourceRegistered: boolean;
  /** target series processed (observations) or 1 for a catalog sync */
  series: number;
  /** observation upserts executed / catalog rows processed (inserted + existing) */
  rowsUpserted: number;
  /** rows whose value actually differed (change-log rows written) */
  rowsChanged: number;
  failures: CollectFailure[];
  /** catalog-kind only */
  catalog: { inserted: number; existing: number } | null;
}

export interface FetchSourceCredentialMissing {
  ok: false;
  reason: "credential_missing";
  source: string;
  credentialEnv: string;
  kSkill: string;
}

export interface FetchSourceNoSeries {
  ok: false;
  reason: "no_series_matched";
  source: string;
  seriesArg: string;
}

export type FetchSourceResult = FetchSourceOk | FetchSourceCredentialMissing | FetchSourceNoSeries;

/** md_source reliability grade per adapter code (was inline in the CLI fetch case). */
const GRADE: Record<string, string> = { dart: "A", ecos: "A", krx: "A", kosis: "A", law: "A", opendata: "B" };

// ── Helpers moved verbatim from newbiz.ts (the fetch case was their only user) ──

/**
 * Upsert md_period for a YYYY-MM (month) or YYYY-MM-DD (day) key — the day
 * grain is new with the KRX beta series (ADR-0115), where start=end=the date.
 */
export function upsertPeriod(db: any, periodKey: string): string {
  const isDay = /^\d{4}-\d{2}-\d{2}$/.test(periodKey);
  const [y, m] = periodKey.split("-").map(Number);
  const startDate = isDay ? periodKey : `${periodKey}-01`;
  const endDate = isDay ? periodKey : new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  // md_period CHECK allows date|month|quarter|year — the day grain is stored as "date".
  const periodType = isDay ? "date" : "month";
  const found = db.query("SELECT id FROM md_period WHERE period_type=? AND start_date=? AND end_date=?").get(periodType, startDate, endDate) as
    | { id: string }
    | undefined;
  if (found) return found.id;
  const id = ulid();
  db.run("INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)", [
    id,
    periodType,
    startDate,
    endDate,
    y,
    new Date().toISOString(),
  ]);
  return id;
}

/** SHA-256 content hash of a raw adapter row — the observation's provenance probe. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Monthly period keys YYYY-MM from --from/--to (pure variant of the CLI's
 * resolver: throws instead of process.exit, same messages minus the "fetch: "
 * prefix, which the CLI re-adds for byte-identical output).
 */
export function resolveMonthlyPeriods(fromArg?: string, toArg?: string): string[] {
  const ym = /^\d{4}-\d{2}$/;
  const year = new Date().getUTCFullYear();
  const from = fromArg ?? `${year}-01`;
  const to = toArg ?? `${year}-12`;
  if (!ym.test(from) || !ym.test(to)) {
    throw new Error("--from/--to must use YYYY-MM.");
  }
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  if (fromMonth < 1 || fromMonth > 12 || toMonth < 1 || toMonth > 12) {
    throw new Error("--from/--to months must be 01-12.");
  }
  const start = fromYear * 12 + fromMonth;
  const end = toYear * 12 + toMonth;
  if (start > end) {
    throw new Error("--from must be earlier than or equal to --to.");
  }
  const periods: string[] = [];
  for (let cursor = start; cursor <= end; cursor++) {
    const y = Math.floor((cursor - 1) / 12);
    const m = ((cursor - 1) % 12) + 1;
    periods.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return periods;
}

/**
 * Retry classification for collect.* handlers (design section 3.1: job-level
 * retries apply ONLY to network/5xx/429-class errors). Auth errors, payload
 * errors and unit quarantines are terminal. KRX throttling surfaces as
 * KrxHttpError 403/429 (verified live 2026-10-12) — retried; a generic HTTP 403
 * from another host is an auth problem — terminal.
 */
export function isRetryableCollectError(err: unknown): boolean {
  if (err instanceof KrxHttpError) return err.status >= 500 || err.status === 403 || err.status === 429;
  const name = (err as Error | undefined)?.name;
  if (name === "TimeoutError" || name === "AbortError") return true; // AbortSignal.timeout / fetch abort
  if (err instanceof TypeError) return true; // fetch network-layer failure
  const msg = err instanceof Error ? err.message : String(err);
  const m = /HTTP (\d{3})\b/.exec(msg);
  if (m) {
    const status = Number(m[1]);
    return status >= 500 || status === 408 || status === 429;
  }
  return false;
}

/** CLI output formatter — byte-identical to the pre-extraction fetch case's prints. */
export function formatFetchEventLine(e: FetchSourceEvent): string {
  switch (e.type) {
    case "source_registered":
      return `md_source: registered '${e.code}' (grade ${e.grade})`;
    case "warn_unverified":
      return `⚠ ${e.seriesId}: seed entry UNVERIFIED — confirm orgId/tblId against KOSIS before trusting outputs.`;
    case "row":
      return `${e.seriesId}@${e.period}: ${e.status} (rev ${e.revisionNo})`;
    case "failure":
      return `  isolated failure ${e.seriesId}${e.period ? `@${e.period}` : ""}: ${e.message}`;
  }
}

// ── Internals ───────────────────────────────────────────────────────────────

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("aborted: collect run exceeded its timeout");
}

function registerSourceIfNeeded(db: any, source: string, emit?: (e: FetchSourceEvent) => void): boolean {
  if (db.query("SELECT id FROM md_source WHERE code = ?").get(source)) return false;
  db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [
    ulid(),
    source,
    GRADE[source] ?? "C",
    new Date().toISOString(),
  ]);
  emit?.({ type: "source_registered", code: source, grade: GRADE[source] ?? "C" });
  return true;
}

/**
 * The upsert core. One transaction per observation; returns the row's status and
 * the revision it now lives at. See the module header for the change-log policy:
 * initial inserts log a 'new' row (old_value NULL), same contract as ensure_fresh.
 */
function upsertObservation(
  db: any,
  o: { seriesId: string; periodId: string; unitId: string; sourceId: string; value: number; contentHash: string },
): { status: "new" | "revised" | "unchanged"; revisionNo: number } {
  const latest = db
    .query("SELECT revision_no, value FROM fact_market_observation WHERE series_id = ? AND period_id = ? ORDER BY revision_no DESC LIMIT 1")
    .get(o.seriesId, o.periodId) as { revision_no: number; value: number } | undefined;

  if (!latest) {
    const now = new Date().toISOString();
    db.transaction(() => {
      db.run(
        `INSERT INTO fact_market_observation
           (series_id, period_id, revision_no, value, unit_id, source_id, content_hash, fetched_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
        [o.seriesId, o.periodId, o.value, o.unitId, o.sourceId, o.contentHash, now],
      );
      // First-ever insert: change_type 'new', old_value NULL — ensure_fresh's
      // documented contract (observation.repository.ts:96-107). Both consumers
      // are watermark/MAX-based and need this row (module header).
      db.run(
        `INSERT INTO data_change_log (id, series_id, detected_at, change_type, old_value, new_value)
         VALUES (?, ?, ?, 'new', NULL, ?)`,
        [ulid(), o.seriesId, now, o.value],
      );
    })();
    return { status: "new", revisionNo: 1 };
  }

  // Same value → idempotent no-op: a rerun writes nothing (no revision, no log).
  if (latest.value === o.value) {
    return { status: "unchanged", revisionNo: latest.revision_no };
  }

  // Genuine revision: new revision row + change-log row, same transaction.
  const now = new Date().toISOString();
  const nextRevision = latest.revision_no + 1;
  db.transaction(() => {
    db.run(
      `INSERT INTO fact_market_observation
         (series_id, period_id, revision_no, value, unit_id, source_id, content_hash, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [o.seriesId, o.periodId, nextRevision, o.value, o.unitId, o.sourceId, o.contentHash, now],
    );
    db.run(
      `INSERT INTO data_change_log (id, series_id, detected_at, change_type, old_value, new_value)
       VALUES (?, ?, ?, 'revised', ?, ?)`,
      [ulid(), o.seriesId, now, latest.value, o.value],
    );
  })();
  return { status: "revised", revisionNo: nextRevision };
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Run one source adapter to completion, returning structural counts.
 * Throws only for programmer errors and whole-run adapter failures (catalog
 * fetches are all-or-nothing); per-series/per-period problems are collected in
 * `failures` and the run continues.
 */
export async function fetchSource(db: any, source: string, opts: FetchSourceOptions = {}): Promise<FetchSourceResult> {
  const registry = opts.adapters ?? SOURCE_ADAPTERS;
  const adapter = registry[source];
  if (!adapter) throw new Error(`fetchSource: no adapter registered for source '${source}'`);

  // Credential gate BEFORE any adapter call (design section 3.1).
  if (!adapter.isEnabled()) {
    return { ok: false, reason: "credential_missing", source, credentialEnv: adapter.credentialEnv, kSkill: adapter.kSkill };
  }

  const { emit, signal, seriesArg, fromArg, toArg } = opts;
  const failures: CollectFailure[] = [];
  const fail = (seriesId: string, err: unknown, period?: string): void => {
    const message = err instanceof Error ? err.message : String(err);
    failures.push({ seriesId, period, message, retryable: isRetryableCollectError(err) });
    emit?.({ type: "failure", seriesId, period, message });
  };

  // ── observations adapters (kosis / ecos / krx) ──
  if (adapter.kind === "observations") {
    const sourceRegistered = registerSourceIfNeeded(db, source, emit);
    const catalog = await adapter.listSeries();
    const targets = seriesArg ? catalog.filter((s) => s.seriesId === seriesArg || s.tblId === seriesArg) : catalog;
    if (targets.length === 0) {
      return { ok: false, reason: "no_series_matched", source, seriesArg: seriesArg ?? "(all)" };
    }
    let rowsUpserted = 0;
    let rowsChanged = 0;
    for (const s of targets) {
      checkAbort(signal);
      if (!s._verified) emit?.({ type: "warn_unverified", seriesId: s.seriesId });
      const mapping = Object.values(KOSIS_UNITS).find((u) => u.unitCode === s.unitCode);
      if (!mapping) {
        fail(s.seriesId, new Error(`unit '${s.unitCode}' has no md_unit mapping (kosis-units.ts).`));
        continue;
      }
      const unitId = (() => {
        const row = db.query("SELECT id FROM md_unit WHERE code = ?").get(mapping.unitCode) as { id: string } | undefined;
        if (row) return row.id;
        const id = ulid();
        db.run("INSERT INTO md_unit (id, code, dimension, si_coefficient, created_at) VALUES (?,?,?,?,?)", [
          id,
          mapping.unitCode,
          mapping.dimension,
          mapping.siCoefficient,
          new Date().toISOString(),
        ]);
        return id;
      })();
      const sourceId = (db.query("SELECT id FROM md_source WHERE code = ?").get(source) as { id: string }).id;
      // Day-grain series (KRX): one API call per (series × month) through
      // the adapter's listDailyRows hook; the upsert runs per trading day.
      if (adapter.listDailyRows && s.periodType === "day") {
        for (const month of resolveMonthlyPeriods(fromArg, toArg)) {
          checkAbort(signal);
          let rows: Awaited<ReturnType<NonNullable<typeof adapter.listDailyRows>>> = [];
          try {
            rows = await adapter.listDailyRows({ seriesId: s.seriesId, sourceId }, month);
          } catch (err) {
            fail(s.seriesId, err, month);
            continue;
          }
          for (const row of rows) {
            checkAbort(signal);
            try {
              const periodId = upsertPeriod(db, row.date);
              const r = upsertObservation(db, {
                seriesId: s.seriesId,
                periodId,
                unitId,
                sourceId,
                value: row.value,
                contentHash: await sha256Hex(row.raw),
              });
              rowsUpserted++;
              rowsChanged += r.status === "revised" ? 1 : 0;
              emit?.({ type: "row", seriesId: s.seriesId, period: row.date, status: r.status, revisionNo: r.revisionNo });
            } catch (err) {
              fail(s.seriesId, err, row.date);
            }
          }
        }
        continue;
      }
      let rawFetcher: (periodKey: string) => Promise<{ value: number; contentHash: string; raw: string }>;
      try {
        rawFetcher = adapter.fetcher({ seriesId: s.seriesId, sourceId });
      } catch (err) {
        fail(s.seriesId, err);
        continue;
      }
      for (const periodKey of resolveMonthlyPeriods(fromArg, toArg)) {
        checkAbort(signal);
        try {
          const periodId = upsertPeriod(db, periodKey);
          const fetched = await rawFetcher(periodKey);
          const r = upsertObservation(db, {
            seriesId: s.seriesId,
            periodId,
            unitId,
            sourceId,
            value: fetched.value,
            contentHash: fetched.contentHash,
          });
          rowsUpserted++;
          rowsChanged += r.status === "revised" ? 1 : 0;
          emit?.({ type: "row", seriesId: s.seriesId, period: periodKey, status: r.status, revisionNo: r.revisionNo });
        } catch (err) {
          fail(s.seriesId, err, periodKey);
        }
      }
    }
    return {
      ok: true,
      source,
      kind: "observations",
      sourceRegistered,
      series: targets.length,
      rowsUpserted,
      rowsChanged,
      failures,
      catalog: null,
    };
  }

  // ── catalog adapters (dart / law) — md:sync semantics ──
  if (!adapter.listCatalog) throw new Error(`fetchSource: adapter '${source}' exposes no listCatalog (catalog-kind contract).`);
  const sourceRegistered = registerSourceIfNeeded(db, source, emit);
  const upserts = await adapter.listCatalog({ all: opts.all ?? false });
  const result = upsertCatalog(db, upserts);
  return {
    ok: true,
    source,
    kind: "catalog",
    sourceRegistered,
    series: 1,
    rowsUpserted: result.inserted + result.existing,
    rowsChanged: 0,
    failures,
    catalog: result,
  };
}
