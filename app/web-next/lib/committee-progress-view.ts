// committee-progress-view — pure view helpers for the live meeting progress UI
// (design 2026-11-20-committee-turn-based-meeting-design §4.8/§8, ADR-0204).
// Client-safe: type-only imports, no db/server code. The stepper state, the
// elapsed-time split, and the live-region throttle rule live here so they are
// unit-testable without a DOM.
import type { MeetingAwaiting, MeetingProgress } from "./committee-progress.ts";
// Type-only (erased at build): the wire shape of one turn, owned by the turn engine.
import type { TurnView } from "./committee-turns.ts";

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
  progress?: { started_at?: string; updated_at?: string; phase?: string } | null;
  /** Turn engine (ADR-0204): absent on legacy sessions = "rounds". */
  engine?: "rounds" | "turns";
  /** Turn engine, hybrid: the open human floor while the meeting is paused. */
  awaiting?: unknown | null;
  meta?: { synthesized?: boolean } | null;
}

/**
 * Mount-resume decision: which listed session (if any) the panel should watch
 * again after a reload or navigation. Only `convening: true` sessions qualify;
 * with several, the most recently started wins. The poll deadline is measured
 * from the session's own start (`startedAt`, else `progress.started_at`, else
 * `nowMs` when neither parses) — never from mount time. A session already past
 * its deadline is still returned: the poll shows one last snapshot and then
 * the timeout message, which is more honest than showing nothing.
 *
 * Turn engine (ADR-0204 §15.2): a paused hybrid meeting (`awaiting` open) also
 * qualifies although it is not convening, and a turn session's deadline counts
 * from `progress.updated_at` (the latest running stretch), not from the
 * session start — human wait time must not eat the 10-minute budget.
 */
export function pickResumableSession(
  sessions: readonly ResumableCandidate[],
  nowMs: number,
): { sessionId: string; startedAtMs: number } | null {
  let best: { sessionId: string; startedAtMs: number } | null = null;
  let bestRank = Number.NEGATIVE_INFINITY;
  for (const s of sessions) {
    const turnPaused = s.engine === "turns" && !!s.awaiting;
    if (s.convening !== true && !turnPaused) continue;
    const own = Date.parse(s.startedAt);
    const fromProgress = Date.parse(s.progress?.started_at ?? "");
    const rank = !Number.isNaN(own) ? own : !Number.isNaN(fromProgress) ? fromProgress : nowMs;
    const stretch = s.engine === "turns" ? Date.parse(s.progress?.updated_at ?? "") : Number.NaN;
    const startedAtMs = !Number.isNaN(stretch) ? stretch : rank;
    if (!best || rank > bestRank) {
      best = { sessionId: s.sessionId, startedAtMs };
      bestRank = rank;
    }
  }
  return best;
}

/**
 * A turn meeting that stopped on a failure and is the NEWEST session of the
 * list (the list is newest-first): the panel re-attaches to it after a reload
 * so the stop location and the retry button are on screen. An older failed
 * session, or one followed by a newer session, is history only.
 */
export function pickFailedTurnSession(sessions: readonly ResumableCandidate[]): { sessionId: string } | null {
  let newest: ResumableCandidate | null = null;
  let newestMs = Number.NEGATIVE_INFINITY;
  for (const s of sessions) {
    const t = Date.parse(s.startedAt);
    if (!Number.isNaN(t) && t > newestMs) {
      newest = s;
      newestMs = t;
    }
  }
  if (newest?.engine !== "turns" || newest.convening === true || newest.meta?.synthesized) return null;
  return newest.progress?.phase === "failed" ? { sessionId: newest.sessionId } : null;
}

/** One round's worth of finished positions, for the grouped live list. */
export interface PositionRoundGroup<T> {
  round: number;
  /** Positions finished in this round, in their incoming order. */
  positions: T[];
  /** Finished count (= positions.length). */
  finished: number;
  /** Seats expected in this round (turn budget / round count); null when the run shape is unknown. */
  total: number | null;
  /** Open by default: only the current (latest) round. */
  open: boolean;
}

/**
 * Group finished positions by round, ascending. Seats per round is the turn
 * budget split evenly across the rounds (budget = rounds x seats), null when
 * either is missing. The group of the current round — `currentRound` when it
 * has positions, else the latest round that does — is the only one open, so a
 * 22-statement meeting reads as a few round headers, not 22 rows.
 */
export function groupPositionsByRound<T extends { round: number }>(
  positions: readonly T[],
  shape: { roundCount?: number; turnBudget?: number; currentRound?: number } = {},
): PositionRoundGroup<T>[] {
  const byRound = new Map<number, T[]>();
  for (const p of positions) {
    const list = byRound.get(p.round);
    if (list) list.push(p);
    else byRound.set(p.round, [p]);
  }
  const rounds = [...byRound.keys()].sort((a, b) => a - b);
  const latest = rounds[rounds.length - 1];
  const openRound = shape.currentRound !== undefined && byRound.has(shape.currentRound) ? shape.currentRound : latest;
  const perRound =
    shape.roundCount !== undefined && shape.roundCount > 0 && shape.turnBudget !== undefined && shape.turnBudget > 0
      ? Math.round(shape.turnBudget / shape.roundCount)
      : null;
  return rounds.map((round) => {
    const list = byRound.get(round) ?? [];
    return { round, positions: list, finished: list.length, total: perRound, open: round === openRound };
  });
}

// ── Turn engine (ADR-0204 phase 2) ─────────────────────────────────────────

export type { TurnView };

/** Sitting a snapshot belongs to; an absent `attempt` is the first sitting. */
export function attemptOf(p: Pick<MeetingProgress, "attempt"> | null | undefined): number {
  return p?.attempt ?? 1;
}

/** Highest seq held (the `afterSeq` cursor); 0 when nothing is held yet. */
export function lastSeq(turns: readonly Pick<TurnView, "seq">[]): number {
  let max = 0;
  for (const t of turns) if (t.seq > max) max = t.seq;
  return max;
}

/**
 * Merge a poll delta into the held turns: deduplicated by `seq` (the same turn
 * arriving twice — an overlapping page, a re-poll — is stored once, the newer
 * copy wins), returned in ascending seq order. Pure: neither input is mutated.
 */
export function mergeTurns(existing: readonly TurnView[], incoming: readonly TurnView[]): TurnView[] {
  const bySeq = new Map<number, TurnView>();
  for (const t of existing) bySeq.set(t.seq, t);
  for (const t of incoming) bySeq.set(t.seq, t);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * A new sitting re-runs the issue a stopped sitting died on, which flips the
 * `abandoned` flag of turns already held — a delta cannot carry that, so the
 * held turns are dropped and re-read from the start.
 */
export function turnsNeedReset(seenAttempt: number | null, currentAttempt: number): boolean {
  return seenAttempt !== null && seenAttempt !== currentAttempt;
}

/** Cap on pages fetched in one poll tick (50 turns a page): a backstop against a cursor that never advances. */
export const MAX_TURN_PAGES_PER_TICK = 20;

/**
 * Poll URL for a session list. Round sessions (and the very first poll, when
 * the engine is not known yet) use the plain list URL — byte-identical to the
 * phase-1 request. A turn session narrows to its own id and streams only the
 * turns after the cursor.
 */
export function buildTurnPollUrl(base: string, sessionId: string, afterSeq: number | null): string {
  if (afterSeq === null) return base;
  return `${base}?sessionId=${encodeURIComponent(sessionId)}&afterSeq=${afterSeq}`;
}

/** What a transcript row is, for styling and layout: chair mechanics stand apart from member speech. */
export type TurnRowKind = "chair" | "seat" | "human" | "vote" | "close" | "pass";

export function turnRowKind(t: Pick<TurnView, "role" | "move">): TurnRowKind {
  if (t.role === "chair") {
    if (t.move === "close") return "close";
    if (t.move === "pass_on_behalf") return "pass";
    return "chair";
  }
  if (t.role === "human") return "human";
  return t.move === "accept" || t.move === "reserve" ? "vote" : "seat";
}

export interface IssueTurnGroup {
  /** 1-based agenda ordinal (TurnView.issueIndex). */
  issueIndex: number;
  /** Agenda title when known (stored agenda, else the live progress title for the current issue). */
  title: string | null;
  /** The live transcript of this issue: seq order, abandoned turns left out. */
  turns: TurnView[];
  /** Turns of a stopped sitting whose issue was re-run: kept for the record, not part of the flow. */
  interrupted: TurnView[];
}

/**
 * Group turns by agenda issue, ascending. Inside a group the turns are in seq
 * order; abandoned turns are split off into `interrupted` so the main flow
 * reads as one clean meeting. A group whose turns are all abandoned is kept
 * (its heading shows the interrupted note) so the record never silently loses
 * an issue. Titles come from the stored agenda; `currentTitle` fills the
 * current issue while the agenda is not in the poll payload.
 */
export function groupTurnsByIssue(
  turns: readonly TurnView[],
  opts: {
    titles?: ReadonlyArray<string | null | undefined>;
    currentIssue?: number;
    currentTitle?: string;
  } = {},
): IssueTurnGroup[] {
  const sorted = [...turns].sort((a, b) => a.seq - b.seq);
  const byIssue = new Map<number, IssueTurnGroup>();
  for (const t of sorted) {
    let g = byIssue.get(t.issueIndex);
    if (!g) {
      const fromAgenda = opts.titles?.[t.issueIndex - 1];
      const title = fromAgenda || (t.issueIndex === opts.currentIssue ? opts.currentTitle : undefined) || null;
      g = { issueIndex: t.issueIndex, title, turns: [], interrupted: [] };
      byIssue.set(t.issueIndex, g);
    }
    (t.abandoned ? g.interrupted : g.turns).push(t);
  }
  return [...byIssue.values()].sort((a, b) => a.issueIndex - b.issueIndex);
}

/** Visible (non-abandoned) turn count — what the transcript title counts. */
export function visibleTurnCount(turns: readonly Pick<TurnView, "abandoned">[]): number {
  return turns.reduce((n, t) => n + (t.abandoned ? 0 : 1), 0);
}

/** Step states for a TURN-engine snapshot (rounds keep `stepStates`). */
export function turnStepStates(p: MeetingProgress): Record<ProgressStepKey, ProgressStepState> {
  const failed = p.phase === "failed";
  const phase = failed ? (p.failed_at?.phase ?? "") : p.phase;
  const issueIndex = failed ? p.failed_at?.issue_index : p.issue_index;
  // Per-issue consensus (it names an issue) is part of the discussion step;
  // only the closing synthesis (no issue) is the "consensus" step.
  const current: ProgressStepKey | "all" | null =
    phase === "done"
      ? "all"
      : phase === "agenda"
        ? "agenda"
        : phase === "discussion" || phase === "awaiting_human"
          ? "discussion"
          : phase === "consensus"
            ? issueIndex !== undefined
              ? "discussion"
              : "consensus"
            : phase === "minutes"
              ? "minutes"
              : null;
  const here = current === null || current === "all" ? -1 : PROGRESS_STEPS.indexOf(current);
  const out = {} as Record<ProgressStepKey, ProgressStepState>;
  PROGRESS_STEPS.forEach((key, i) => {
    out[key] = current === "all" ? "done" : i < here ? "done" : i === here ? (failed ? "failed" : "current") : "todo";
  });
  return out;
}

/** Whole milliseconds until the human floor closes; never negative. */
export function awaitingRemainingMs(a: Pick<MeetingAwaiting, "deadline_at">, nowMs: number): number {
  const t = Date.parse(a.deadline_at);
  return Number.isNaN(t) ? 0 : Math.max(0, t - nowMs);
}

export function isAwaitingExpired(a: Pick<MeetingAwaiting, "deadline_at">, nowMs: number): boolean {
  return awaitingRemainingMs(a, nowMs) === 0;
}

/** Wait before re-driving an ANSWERED floor the server did not resume on its own. */
export const ANSWERED_RESUME_GRACE_MS = 10_000;

/**
 * Should the panel call advance for the open human floor? Exactly once per
 * floor (`advancedSeq` is the seq already driven): when the deadline passed
 * unanswered (the chair then records a pass_on_behalf), or — a safety net —
 * when the floor was answered but the meeting is still paused well after the
 * answer (the positions route normally resumes it itself).
 */
export function shouldAdvanceAwaiting(
  a: Pick<MeetingAwaiting, "seq" | "deadline_at" | "answered_at">,
  nowMs: number,
  advancedSeq: number | null,
): boolean {
  if (advancedSeq === a.seq) return false;
  if (a.answered_at) {
    const answered = Date.parse(a.answered_at);
    return !Number.isNaN(answered) && nowMs - answered >= ANSWERED_RESUME_GRACE_MS;
  }
  return isAwaitingExpired(a, nowMs);
}

/** Whole minutes and seconds left, for the countdown text. */
export function splitCountdown(ms: number): { minutes: number; seconds: number } {
  return splitElapsed(Math.ceil(Math.max(0, ms) / 1000));
}

/**
 * The panel's 10-minute convening deadline stops while the meeting waits for a
 * human (design §15.2): the paused stretch is accumulated and added back to
 * the deadline.
 */
export interface DeadlinePause {
  /** Total milliseconds spent paused so far. */
  pausedMs: number;
  /** When the current pause began; null while running. */
  since: number | null;
}

export function nextDeadlinePause(prev: DeadlinePause, paused: boolean, nowMs: number): DeadlinePause {
  if (paused) return prev.since === null ? { pausedMs: prev.pausedMs, since: nowMs } : prev;
  if (prev.since === null) return prev;
  return { pausedMs: prev.pausedMs + Math.max(0, nowMs - prev.since), since: null };
}

/** True when the (pause-extended) deadline has passed; never true while paused. */
export function convenDeadlineReached(
  deadlineMs: number,
  pause: DeadlinePause,
  paused: boolean,
  nowMs: number,
): boolean {
  if (paused) return false;
  return nowMs >= deadlineMs + pause.pausedMs;
}

const TURN_ERROR_CODES: ReadonlySet<string> = new Set(["floor_not_open", "floor_expired", "awaiting_human"]);

/** API error codes of the human-turn / resume endpoints that have a plain-language catalog line; null otherwise. */
export function turnErrorKey(code: string): string | null {
  return TURN_ERROR_CODES.has(code) ? `common.committee.turns.errors.${code}` : null;
}
