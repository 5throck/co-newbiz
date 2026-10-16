// ADR-0178 follow-up (decider feedback 2026-10-16): read side of the S8 `S5 연결` status block.
// Pure reads, informational only - never blocks a gate, changes a grade or recomputes a case.
// It folds the S5 investment-simulation run state (what exists at S5) together with the S8
// consumption status (what the latest S8 case used) into one person-readable state.
import type { Database } from "bun:sqlite";
import { getLatestConfirmedInvestmentSimulationRun, getLatestInvestmentSimulationRun } from "../../../db/repositories/investment-simulation-run.repository.ts";
import { s5SimStatusForProject, type S5SimStaleReason } from "./investment-simulation-s8.ts";
import { getCurrentS5PlanPin, s5SourceReverted } from "./s5-plan-pin-s8.ts";

/** none = no run at S5; unconfirmed = a run exists, nobody confirmed it; confirmed = confirmed, no S8 case reflects it yet. */
export type S5ConnectSimState = "none" | "unconfirmed" | "confirmed" | "in_effect" | "stale";

export interface S5ConnectView {
  sim: {
    state: S5ConnectSimState;
    staleReason: S5SimStaleReason | null;
    label: string;
    /** What a person does next, or null when nothing is pending. */
    nextStep: string | null;
  };
  /** The confirmed S5 run S8 would draw from (the pinned run on the pinned path, else the latest confirmed). */
  run: { id: string; drawCount: number } | null;
}

const LABEL: Record<S5ConnectSimState, string> = {
  none: "실행 없음",
  unconfirmed: "미확정",
  confirmed: "확정됨 (사례에 아직 반영 안 됨)",
  in_effect: "확정됨·반영됨",
  stale: "재평가 필요",
};

const NEXT: Record<S5ConnectSimState, string | null> = {
  none: "S5 탭에서 투자 시뮬레이션을 실행한 뒤 `가정 확정`을 누르고, S8에서 `자동 생성`을 다시 실행하세요.",
  unconfirmed: "S5 탭에서 `가정 확정`을 누른 뒤 S8에서 `자동 생성`을 다시 실행하세요.",
  confirmed: "S8에서 `자동 생성`을 다시 실행하면 확정된 S5 시뮬레이션이 사례에 반영됩니다.",
  in_effect: null,
  stale: "S8에서 `자동 생성`을 다시 실행하면 해소됩니다 (자동 재계산 없음).",
};

export function s5ConnectViewForProject(db: Database, projectId: string): S5ConnectView {
  const proj = db.query("SELECT source_opportunity_id FROM md_project WHERE id = ?").get(projectId) as { source_opportunity_id: string | null } | null;
  const opp = proj?.source_opportunity_id ?? null;
  let latest = null as ReturnType<typeof getLatestInvestmentSimulationRun>;
  let confirmed = null as ReturnType<typeof getLatestConfirmedInvestmentSimulationRun>;
  if (opp) {
    try {
      latest = getLatestInvestmentSimulationRun(opp, db);
      confirmed = getLatestConfirmedInvestmentSimulationRun(opp, db);
    } catch { /* migration 0144/0146 pending: behave as no run */ }
  }
  const status = s5SimStatusForProject(db, projectId);
  let state: S5ConnectSimState;
  if (status.state === "stale") state = "stale";
  else if (!latest && !confirmed) state = "none";
  else if (!confirmed) state = "unconfirmed";
  else if (status.state === "in_effect") state = "in_effect";
  else state = "confirmed";

  // The run S8 draws from: the pinned run on the pinned path (the amended default — any pin not
  // reverted), otherwise the latest confirmed run.
  let run: S5ConnectView["run"] = confirmed ? { id: confirmed.id, drawCount: confirmed.draw_count } : null;
  if (opp && !s5SourceReverted(db, projectId)) {
    const pin = getCurrentS5PlanPin(db, projectId);
    if (pin) {
      const pinnedRun = pin.s5_sim_run_id ? safeRun(db, opp, pin.s5_sim_run_id) : null;
      run = pinnedRun && pinnedRun.confirmed_at ? { id: pinnedRun.id, drawCount: pinnedRun.draw_count } : null;
    }
  }
  return { sim: { state, staleReason: status.reason, label: LABEL[state], nextStep: NEXT[state] }, run };
}

function safeRun(db: Database, opp: string, runId: string) {
  try {
    const row = db.query("SELECT id, draw_count, confirmed_at FROM investment_simulation_run WHERE opportunity_id = ? AND id = ?").get(opp, runId) as { id: string; draw_count: number; confirmed_at: string | null } | null;
    return row;
  } catch {
    return null;
  }
}
