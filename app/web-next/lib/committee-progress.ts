// committee-progress — the live-progress contract of a convening committee
// session (design 2026-11-20-committee-turn-based-meeting-design §4.2, ADR-0204).
//
// Pure types and helpers only: no db/server imports, so the UI
// (components/CommitteePanel.tsx) can `import type { MeetingProgress }` from
// here. The engine writes it to process_run.meta_json under `progress` (no
// migration); the list/GET committee-session endpoints return it.

/**
 * Phase of a convening meeting. Phase 1 (engine "rounds") maps the existing
 * round engine onto the four steps the owner sees:
 *   agenda      the chair agenda pass (runs once, after round 1, when the
 *               committee has 2+ rounds)
 *   discussion  the member positions of every round (speaker_seat = who is
 *               writing right now)
 *   consensus   the chair synthesis: recommendation proposal + verbatim
 *               dissent (the gate_evaluation row)
 *   minutes     the chair minutes pass
 * `done` / `failed` are terminal.
 */
export type MeetingPhase = "agenda" | "discussion" | "consensus" | "minutes" | "done" | "failed";

/** Where a convening run stopped. Written next to `convening_error`. */
export interface MeetingFailedAt {
  phase: string;
  /** Round engine: the round whose speaker failed. */
  round?: number;
  /** Turn engine (phase 2): the issue whose turn failed. */
  issue_index?: number;
  /** Turn engine (phase 2): the turn sequence number. */
  seq?: number;
  /** Committee seat key (a role, never a person) that was speaking. */
  speaker_seat?: string;
  /** CommitteeError.code when available, else the error name. Never the message. */
  error_code: string;
}

export interface MeetingProgress {
  /** phase 1 = "rounds", phase 2 = "turns". */
  engine: "rounds" | "turns";
  phase: MeetingPhase;
  /** 1-based. Turn engine (phase 2) only. */
  issue_index?: number;
  issue_count?: number;
  issue_title?: string;
  /** Rounds engine only. 1-based. */
  round?: number;
  round_count?: number;
  /** Committee seat key (role) currently speaking; never a person. */
  speaker_seat?: string;
  /** Positions (or turns) persisted so far. */
  turn_count: number;
  /** Positions the meeting is expected to produce (rounds x seats). */
  turn_budget?: number;
  started_at: string;
  updated_at: string;
  failed_at?: MeetingFailedAt;
}

/** One finished position as the poll/GET paths expose it (live, mid-run). */
export interface LivePosition {
  positionId: string;
  round: number;
  memberType: string;
  agentKey: string | null;
  humanUserId: string | null;
  positionMd: string;
  confidence: number | null;
  createdAt: string;
}

/** Fields of MeetingProgress an engine event can set. */
export interface ProgressEvent {
  phase: Exclude<MeetingPhase, "failed">;
  round?: number;
  speakerSeat?: string;
  turnCount: number;
}

/**
 * Next progress snapshot from an engine event. `startedAt` and the static
 * run shape (round_count / turn_budget) are carried from the previous
 * snapshot; `updated_at` always moves. Stale per-speaker fields are dropped
 * when the event does not name them (e.g. the chair passes have no seat).
 */
export function nextProgress(
  prev: Pick<MeetingProgress, "engine" | "started_at" | "round_count" | "turn_budget">,
  ev: ProgressEvent,
  now: string,
): MeetingProgress {
  return {
    engine: prev.engine,
    phase: ev.phase,
    ...(ev.round !== undefined ? { round: ev.round } : {}),
    ...(prev.round_count !== undefined ? { round_count: prev.round_count } : {}),
    ...(ev.speakerSeat !== undefined ? { speaker_seat: ev.speakerSeat } : {}),
    turn_count: ev.turnCount,
    ...(prev.turn_budget !== undefined ? { turn_budget: prev.turn_budget } : {}),
    started_at: prev.started_at,
    updated_at: now,
  };
}

/**
 * The failed snapshot for a run that stopped: keeps the last known position
 * (phase / round / speaker) in `failed_at` and flips `phase` to "failed".
 */
export function failedProgress(
  last: MeetingProgress,
  errorCode: string,
  turnCount: number,
  now: string,
): MeetingProgress {
  const failedAt: MeetingFailedAt = {
    phase: last.phase === "failed" && last.failed_at ? last.failed_at.phase : last.phase,
    ...(last.round !== undefined ? { round: last.round } : {}),
    ...(last.issue_index !== undefined ? { issue_index: last.issue_index } : {}),
    ...(last.speaker_seat !== undefined ? { speaker_seat: last.speaker_seat } : {}),
    error_code: errorCode,
  };
  return {
    ...last,
    phase: "failed",
    turn_count: turnCount,
    updated_at: now,
    failed_at: failedAt,
  };
}
