// brownfield-eval-queue.ts — the S6 evaluation dispatcher (ADR-0200 decision 8, design 2026-11-17 section 10). It replaces the
// per-run engine loop: bulk and single starts both create run items, and ONE process-wide worker pool takes them one at a
// time. Queue state lives in the database ("queued" = run `running` + item `pending`); this module holds only the in-flight
// set, the set of runs registered with it, and the cancel requests — so a restart loses nothing durable.
//
// Selection when a slot frees (section 10.3):
//   1. single-candidate items (runs with total_targets = 1) first, FIFO — except that while any bulk item waits at most
//      EVAL_WORKER_POOL_SIZE - 1 slots may hold single items (starvation guard: one slot always serves bulk);
//   2. bulk items, round-robin across bulk runs: fewest in-flight items first, ties to the oldest run.
// The per-item work (DART steps, drafting, versions, the Part A apply, the DART reserve check) is processItem() in
// brownfield-eval-bulk.ts, unchanged.
import type { Database } from "bun:sqlite";
import { appendAudit } from "../../../db/lib/access-control.ts";
import {
  ACTIVE_RUN_STATUSES,
  EvalDraftError,
  TERMINAL_ITEM_STATES,
  cancelPendingItems,
  finishRun,
  getRun,
  listRunItems,
  markCancelRequested,
  touchRunHeartbeat,
  updateRunItem,
  type DraftRunItemRow,
  type DraftRunRow,
} from "../../../db/repositories/brownfield-eval-draft.repository.ts";
import {
  categoriesOf,
  errorCodeOf,
  processItem,
  redactSecrets,
  resolveDeps,
  type BulkEvalDeps,
  type Ctx,
} from "./brownfield-eval-bulk.ts";

/** Process-wide worker slots (DART daily budget, LLM rate and the single SQLite writer are process-wide). Not a request parameter. */
export const EVAL_WORKER_POOL_SIZE = 3;
/** Registered runs get their heartbeat bumped this often, so a long queue is never mistaken for a dead run (section 10.5). */
export const QUEUE_HEARTBEAT_INTERVAL_MS = 60_000;
/** A worker holds an item at most this long; a hung item ends `failed` (timeout) so it cannot starve the pool. */
export const EVAL_ITEM_TIMEOUT_MS = 10 * 60_000;
let itemTimeoutMs = EVAL_ITEM_TIMEOUT_MS;
/** Test seam: shorten the per-item timeout. Pass 0 to restore the default. */
export function setItemTimeoutForTests(ms: number): void {
  itemTimeoutMs = ms > 0 ? ms : EVAL_ITEM_TIMEOUT_MS;
}

interface Registered {
  db: Database;
  oppId: string;
  deps: BulkEvalDeps;
}

const registered = new Map<string, Registered>(); // runId -> context of every run with queued or in-flight work
const inFlight = new Map<string, { runId: string; single: boolean }>(); // itemId -> run
const cancelRequested = new Set<string>(); // runs whose in-flight items are finishing; the run then ends `cancelled`
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export interface DispatchEvent {
  runId: string;
  itemId: string;
  single: boolean;
  /** In-flight items including this one. */
  inFlight: number;
  singleInFlight: number;
}
let observer: ((e: DispatchEvent) => void) | null = null;
/** Test seam: called on every dispatch (sample the pool bound, priority and the starvation guard). Pass null to clear. */
export function setDispatchObserverForTests(fn: ((e: DispatchEvent) => void) | null): void {
  observer = fn;
}

/** True while the run is registered with the dispatcher (queued or in flight in THIS process). */
export function isEngineActive(runId: string): boolean {
  return registered.has(runId);
}

/** Every run of the opportunity registered with the dispatcher, running or queued. */
export function activeEngineRunsForOpportunity(oppId: string): string[] {
  const out: string[] = [];
  for (const [runId, r] of registered) if (r.oppId === oppId) out.push(runId);
  return out;
}

export function inFlightCount(): number {
  return inFlight.size;
}

const inFlightOfRun = (runId: string): number => {
  let n = 0;
  for (const v of inFlight.values()) if (v.runId === runId) n++;
  return n;
};

interface Candidate {
  run: DraftRunRow;
  item: DraftRunItemRow;
  reg: Registered;
}

/** Next non-terminal item of a run that no worker holds, in seq order (also restarts an item left mid-step, section 10.5). */
function nextQueuedItem(db: Database, runId: string): DraftRunItemRow | null {
  const terminal = TERMINAL_ITEM_STATES as readonly string[];
  return listRunItems(db, runId).find((i) => !terminal.includes(i.state) && !inFlight.has(i.id)) ?? null;
}

function pickNext(): Candidate | null {
  const singles: Candidate[] = [];
  const bulk: Candidate[] = [];
  for (const [runId, reg] of registered) {
    const run = getRun(reg.db, runId);
    if (run?.status !== "running") continue;
    const item = nextQueuedItem(reg.db, runId);
    if (!item) continue;
    (run.total_targets === 1 ? singles : bulk).push({ run, item, reg });
  }
  const oldestFirst = (a: Candidate, b: Candidate) =>
    a.run.started_at === b.run.started_at
      ? a.run.id < b.run.id
        ? -1
        : 1
      : a.run.started_at < b.run.started_at
        ? -1
        : 1;
  let singleInFlight = 0;
  for (const v of inFlight.values()) if (v.single) singleInFlight++;
  const guardBlocksSingles = bulk.length > 0 && singleInFlight >= EVAL_WORKER_POOL_SIZE - 1;
  if (singles.length > 0 && !guardBlocksSingles) return singles.sort(oldestFirst)[0];
  if (bulk.length === 0) return null;
  return bulk.sort((a, b) => inFlightOfRun(a.run.id) - inFlightOfRun(b.run.id) || oldestFirst(a, b))[0];
}

class EvalItemTimeout extends Error {
  constructor() {
    super("item_timeout");
  }
}

async function runItem(cand: Candidate): Promise<void> {
  const { run, item, reg } = cand;
  const c: Ctx = {
    db: reg.db,
    deps: reg.deps,
    runId: run.id,
    oppId: run.opportunity_id,
    actor: run.resumed_by ?? run.started_by,
    via: run.started_via,
    webEvidence: run.web_evidence === 1,
    forceRefresh: run.force_refresh === 1,
    categories: categoriesOf(run.categories),
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abandoned = false;
  c.abandoned = () => abandoned;
  try {
    await Promise.race([
      processItem(c, item),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abandoned = true; // late work of a timed-out item can no longer move it out of `failed`
          reject(new EvalItemTimeout());
        }, itemTimeoutMs);
      }),
    ]);
  } catch (err) {
    // One item failing never takes the run (or another candidate) down.
    console.error(
      "brownfield eval item failed:",
      redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, 500),
    );
    try {
      updateRunItem(
        reg.db,
        item.id,
        { state: "failed", errorMessage: err instanceof EvalItemTimeout ? "item_timeout" : errorCodeOf(err) },
        reg.deps.now(),
      );
    } catch {
      /* the item stays at its step; resume restarts it */
    }
  } finally {
    clearTimeout(timer);
    inFlight.delete(item.id);
    try {
      touchRunHeartbeat(reg.db, run.id, reg.deps.now());
    } catch {
      /* the lazy interrupted check will surface a dead run */
    }
    pump();
  }
}

function startItem(cand: Candidate): void {
  const single = cand.run.total_targets === 1;
  inFlight.set(cand.item.id, { runId: cand.run.id, single });
  if (observer) {
    let singleInFlight = 0;
    for (const v of inFlight.values()) if (v.single) singleInFlight++;
    observer({ runId: cand.run.id, itemId: cand.item.id, single, inFlight: inFlight.size, singleInFlight });
  }
  void runItem(cand);
}

function unregister(runId: string): void {
  registered.delete(runId);
  cancelRequested.delete(runId);
  if (registered.size === 0 && heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/** Finish or release every registered run that has no worker and nothing left to hand out. */
function settleRuns(): void {
  for (const [runId, reg] of [...registered]) {
    if (inFlightOfRun(runId) > 0) continue;
    const run = getRun(reg.db, runId);
    if (!run) {
      unregister(runId);
      continue;
    }
    const active = (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status);
    try {
      if (active && cancelRequested.has(runId)) {
        finishRun(reg.db, runId, "cancelled", reg.deps.now());
      } else if (run.status === "running") {
        if (nextQueuedItem(reg.db, runId)) continue; // still waiting for a slot
        finishRun(reg.db, runId, "completed", reg.deps.now());
        appendAudit(reg.db, {
          actor: run.resumed_by ?? run.started_by,
          action: "target_eval.bulk_run.complete",
          target: `${run.opportunity_id}:run:${runId}`,
          now: reg.deps.now(),
        });
      }
    } catch (err) {
      console.error(
        "brownfield eval run settle failed:",
        redactSecrets(err instanceof Error ? err.message : String(err)),
      );
    }
    unregister(runId);
  }
}

/** Hand queued items to free workers (highest priority first), then settle runs that ran dry. Safe to call any time. */
export function pump(): void {
  while (inFlight.size < EVAL_WORKER_POOL_SIZE) {
    const next = pickNext();
    if (!next) break;
    startItem(next);
  }
  settleRuns();
}

/** Bump the heartbeat of every registered `running` run (also called once a minute while any run is registered). */
export function bumpRegisteredHeartbeats(): void {
  for (const [runId, reg] of registered) {
    try {
      touchRunHeartbeat(reg.db, runId, reg.deps.now());
    } catch {
      /* best effort */
    }
  }
}

/**
 * Register a `running` run with the dispatcher and start handing out its items (fire-and-forget: the request returns
 * 202 while workers process). Called by start and resume; a second call for a registered run only pumps.
 */
export function launchBulkEval(db: Database, runId: string, override: Partial<BulkEvalDeps> = {}): void {
  const run = getRun(db, runId);
  if (run?.status !== "running") return;
  if (!registered.has(runId)) {
    registered.set(runId, { db, oppId: run.opportunity_id, deps: resolveDeps(override) });
    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(bumpRegisteredHeartbeats, QUEUE_HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref?.();
    }
  }
  pump();
}

/**
 * Run cancel (A4, section 10.5): every `pending` item becomes `cancelled`; in-flight items finish their current step, then
 * the run becomes `cancelled`. With nothing in flight the run is cancelled at once. Throws EvalDraftError("conflict") for
 * a run that is not active. Versions and applied verdicts already written stay.
 */
export function cancelRun(
  db: Database,
  runId: string,
  now: string,
  onWrite?: (cancelledItems: number) => void,
): { run: DraftRunRow; cancelledItems: number } {
  const run = getRun(db, runId);
  if (!run) throw new EvalDraftError("not_found", `Run '${runId}' not found.`);
  if (!(ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status))
    throw new EvalDraftError("conflict", `Run '${runId}' is '${run.status}'; cannot cancel it.`);
  const deferred = registered.has(runId) && inFlightOfRun(runId) > 0;
  // The decision-bearing writes and the audit commit together; in-memory state changes only after the commit.
  const out = db.transaction(() => {
    const cancelledItems = cancelPendingItems(db, runId, now);
    let next: DraftRunRow;
    if (deferred) {
      markCancelRequested(db, runId);
      next = getRun(db, runId) as DraftRunRow;
    } else {
      next = finishRun(db, runId, "cancelled", now);
    }
    onWrite?.(cancelledItems);
    return { run: next, cancelledItems };
  })();
  if (deferred) {
    cancelRequested.add(runId);
  } else {
    unregister(runId);
    pump();
  }
  return out;
}

/** Wait until no run is registered and no worker is busy (tests, graceful drain). */
export async function waitForQueueIdle(timeoutMs = 10_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (registered.size > 0 || inFlight.size > 0) {
    if (Date.now() > until) throw new Error("eval queue did not drain");
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Test seam: forget every registration, as after a server restart. Do not call while workers are busy. */
export function resetQueueForTests(): void {
  for (const id of [...registered.keys()]) unregister(id);
  inFlight.clear();
  cancelRequested.clear();
}
