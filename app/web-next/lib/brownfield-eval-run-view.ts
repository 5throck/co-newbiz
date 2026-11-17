// brownfield-eval-run-view.ts — read model for the A2 progress routes (ADR-0199, queue model ADR-0200 decision 8). Lazily
// interrupts a stale run, then returns the run header, its items (with candidate names), the per-state `counts` block and
// the DART budget snapshot.
import type { Database } from "bun:sqlite";
import {
  getRun,
  markStaleRunInterrupted,
  summarizeRunItems,
  TERMINAL_ITEM_STATES,
  type DraftRunRow,
} from "../../../db/repositories/brownfield-eval-draft.repository.ts";
import { currentBudget, dartReserve, runItemsWithNames } from "./brownfield-eval-bulk.ts";
import { isEngineActive } from "./brownfield-eval-queue.ts";

export function runProgressView(db: Database, oppId: string, runId: string | null) {
  // Interrupted only when running, NOT registered with the dispatcher and the heartbeat is stale (design §10.5).
  if (runId) markStaleRunInterrupted(db, oppId, new Date().toISOString(), isEngineActive);
  const run: DraftRunRow | null = runId ? getRun(db, runId) : null;
  const b = currentBudget();
  const items = run ? runItemsWithNames(db, run.id) : [];
  const done = items.filter((i) => (TERMINAL_ITEM_STATES as readonly string[]).includes(i.state)).length;
  return {
    run,
    items,
    progress: { done, total: run?.total_targets ?? 0 },
    counts: summarizeRunItems(items),
    budget: { calls: b.calls, budget: b.budget, reserve: dartReserve(b.budget) },
  };
}
