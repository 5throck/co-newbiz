// brownfield-eval-run-view.ts — read model for the A2 progress routes (ADR-0199). Lazily interrupts a stale run, then
// returns the run header, its items (with candidate names) and the DART budget snapshot.
import type { Database } from "bun:sqlite";
import {
  getRun,
  markStaleRunInterrupted,
  TERMINAL_ITEM_STATES,
  type DraftRunRow,
} from "../../../db/repositories/brownfield-eval-draft.repository.ts";
import { currentBudget, dartReserve, isEngineActive, runItemsWithNames } from "./brownfield-eval-bulk.ts";

export function runProgressView(db: Database, oppId: string, runId: string | null) {
  if (runId && !isEngineActive(runId)) markStaleRunInterrupted(db, oppId, new Date().toISOString());
  const run: DraftRunRow | null = runId ? getRun(db, runId) : null;
  const b = currentBudget();
  const items = run ? runItemsWithNames(db, run.id) : [];
  const done = items.filter((i) => (TERMINAL_ITEM_STATES as readonly string[]).includes(i.state)).length;
  return {
    run,
    items,
    progress: { done, total: run?.total_targets ?? 0 },
    budget: { calls: b.calls, budget: b.budget, reserve: dartReserve(b.budget) },
  };
}
