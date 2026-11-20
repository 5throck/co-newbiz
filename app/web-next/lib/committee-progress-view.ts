// committee-progress-view — pure view helpers for the live meeting progress UI
// (design 2026-11-20-committee-turn-based-meeting-design §4.8/§8, ADR-0204).
// Client-safe: type-only imports, no db/server code. The stepper state, the
// elapsed-time split, and the live-region throttle rule live here so they are
// unit-testable without a DOM.
import type { MeetingProgress } from "./committee-progress.ts";

/** The four steps the owner sees, in order. */
export const PROGRESS_STEPS = ["agenda", "discussion", "consensus", "minutes"] as const;
export type ProgressStepKey = (typeof PROGRESS_STEPS)[number];
export type ProgressStepState = "done" | "current" | "todo" | "skipped" | "failed";

/** Poll interval while a session convenes (design §4.7: 5 s -> 3 s). */
export const CONVENING_POLL_MS = 3000;
/** A convening run is given up on this long after it STARTED (not after the page mounted). */
export const CONVENING_DEADLINE_MS = 10 * 60 * 1000;
/** At most one screen-reader announcement per this long (design §8). */
export const ANNOUNCE_THROTTLE_MS = 10_000;

/**
 * Step states for a progress snapshot. The round engine runs the agenda pass
 * once, after round 1 (when the committee has 2+ rounds), so "agenda" is
 * `todo` during round 1, `current` during the pass, and `done` once round 2+
 * (or any later phase) is reached; a 1-round committee has no agenda pass and
 * the step reads `skipped`. For a failed run the step the run stopped in is
 * `failed` and the steps before it are `done`.
 */
export function stepStates(p: MeetingProgress): Record<ProgressStepKey, ProgressStepState> {
  const failed = p.phase === "failed";
  const phase = failed ? (p.failed_at?.phase ?? "") : p.phase;
  const round = failed ? (p.failed_at?.round ?? p.round) : p.round;
  const here = (step: ProgressStepKey): ProgressStepState | null =>
    phase === step ? (failed ? "failed" : "current") : null;
  const finished = phase === "done";

  const agendaSkipped = p.round_count !== undefined && p.round_count < 2;
  const agendaDone =
    phase === "consensus" || phase === "minutes" || finished || (phase === "discussion" && (round ?? 1) >= 2);
  const discussionDone = phase === "consensus" || phase === "minutes" || finished;
  const consensusDone = phase === "minutes" || finished;

  return {
    agenda: agendaSkipped ? "skipped" : (here("agenda") ?? (agendaDone ? "done" : "todo")),
    discussion: here("discussion") ?? (discussionDone ? "done" : "todo"),
    consensus: here("consensus") ?? (consensusDone ? "done" : "todo"),
    minutes: here("minutes") ?? (finished ? "done" : "todo"),
  };
}

/** The step a snapshot is on (for `aria-current="step"`); null when none (done / unknown). */
export function currentStep(p: MeetingProgress): ProgressStepKey | null {
  const s = stepStates(p);
  return PROGRESS_STEPS.find((k) => s[k] === "current") ?? null;
}

/** Elapsed whole seconds from an ISO start to `nowMs`; never negative (clock skew), 0 on a bad date. */
export function elapsedSeconds(startedAt: string, nowMs: number): number {
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / 1000));
}

export function splitElapsed(totalSeconds: number): { minutes: number; seconds: number } {
  const s = Math.max(0, Math.floor(totalSeconds));
  return { minutes: Math.floor(s / 60), seconds: s % 60 };
}

/**
 * Live-region throttle rule: announce now when the last announcement is at
 * least `intervalMs` old, else wait the remaining time (the latest text wins).
 */
export function throttleDecision(
  lastEmitMs: number,
  nowMs: number,
  intervalMs: number = ANNOUNCE_THROTTLE_MS,
): { emitNow: boolean; waitMs: number } {
  const wait = intervalMs - (nowMs - lastEmitMs);
  return wait <= 0 ? { emitNow: true, waitMs: 0 } : { emitNow: false, waitMs: wait };
}

// position-meta marker — the verbatim footnote appended to every stored
// position. Stripped for display: it is a storage format, not reading matter.
export const POSITION_META_RE = /<!--position-meta:(\{[\s\S]*?\})-->/;
export function stripPositionMeta(positionMd: string): string {
  return positionMd.replace(POSITION_META_RE, "").trim();
}

export interface ResumableCandidate {
  sessionId: string;
  /** process_run start (ISO). */
  startedAt: string;
  convening?: boolean;
  progress?: { started_at?: string } | null;
}

/**
 * Mount-resume decision: which listed session (if any) the panel should watch
 * again after a reload or navigation. Only `convening: true` sessions qualify;
 * with several, the most recently started wins. The poll deadline is measured
 * from the session's own start (`startedAt`, else `progress.started_at`, else
 * `nowMs` when neither parses) — never from mount time. A session already past
 * its deadline is still returned: the poll shows one last snapshot and then
 * the timeout message, which is more honest than showing nothing.
 */
export function pickResumableSession(
  sessions: readonly ResumableCandidate[],
  nowMs: number,
): { sessionId: string; startedAtMs: number } | null {
  let best: { sessionId: string; startedAtMs: number } | null = null;
  for (const s of sessions) {
    if (s.convening !== true) continue;
    const own = Date.parse(s.startedAt);
    const fromProgress = Date.parse(s.progress?.started_at ?? "");
    const startedAtMs = !Number.isNaN(own) ? own : !Number.isNaN(fromProgress) ? fromProgress : nowMs;
    if (!best || startedAtMs > best.startedAtMs) best = { sessionId: s.sessionId, startedAtMs };
  }
  return best;
}
