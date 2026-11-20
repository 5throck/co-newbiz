"use client";

// CommitteeProgress — live view of a convening committee session
// (design 2026-11-20-committee-turn-based-meeting-design §4.8 / §8, ADR-0204).
// Pattern P4 Execution: a four-step stepper (안건 정리 → 토의 → 합의 → 회의록)
// built from the existing .stage-stepper classes, a status line with elapsed
// time, the finished positions grouped by round (current round open, each item collapsed), and — when the
// run stopped — where it stopped, in a role="alert" block.
//
// Turn engine (ADR-0204, design §16.5): the page carries ONE status line and the
// "회의 보기" button (CommitteeTurnProgressView); the transcript, stepper and the
// human statement form live in the meeting window (CommitteeMeetingWindow). While a
// human seat has the floor the status becomes a prominent "your turn" alert.
//
// Accessibility (ADR-0065, WCAG 2.1 AA): every step carries an icon AND a text
// state (never color alone); the current step is aria-current="step"; progress
// text goes to a polite live region throttled to one announcement per 10 s
// (the visible status line updates immediately but is NOT a live region, so
// the per-second elapsed time never reaches a screen reader). New items never
// move focus. No new interactive control: each position is a native <details>.
import { AlertTriangle, BellRing, CheckCircle2, Circle, Clock, MinusCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { LivePosition, MeetingAwaiting, MeetingProgress } from "../lib/committee-progress.ts";
import {
  ANNOUNCE_THROTTLE_MS,
  attemptOf,
  awaitingRemainingMs,
  elapsedSeconds,
  groupPositionsByRound,
  isHumanTurnOpen,
  PROGRESS_STEPS,
  type ProgressStepKey,
  type ProgressStepState,
  splitCountdown,
  splitElapsed,
  stepStates,
  stripPositionMeta,
  throttleDecision,
  type TurnView,
} from "../lib/committee-progress-view.ts";
import { seatName } from "./CommitteeTurnTranscript.tsx";

type Translator = ReturnType<typeof useTranslations>;

const P = "common.committee.progress";
const T = "common.committee.turns";

/** Wall clock that ticks once a second while `enabled`; `override` pins it (tests). */
export function useNow(enabled: boolean, override?: number): number {
  const [now, setNow] = useState(() => override ?? Date.now());
  useEffect(() => {
    if (!enabled || override !== undefined) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled, override]);
  return override ?? now;
}

/**
 * The text a polite live region should carry: follows `text`, but moves at
 * most once per `intervalMs` — a change inside the window is held and the
 * LATEST text is shown when the window ends.
 */
function useThrottledText(text: string, intervalMs: number): string {
  const [shown, setShown] = useState(text);
  const lastEmit = useRef(Date.now());
  const latest = useRef(text);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  latest.current = text;

  useEffect(() => {
    if (text === shown) return;
    const { emitNow, waitMs } = throttleDecision(lastEmit.current, Date.now(), intervalMs);
    if (emitNow) {
      lastEmit.current = Date.now();
      setShown(text);
      return;
    }
    if (timer.current) return; // a flush is already scheduled; it reads `latest`
    timer.current = setTimeout(() => {
      timer.current = null;
      lastEmit.current = Date.now();
      setShown(latest.current);
    }, waitMs);
  }, [text, shown, intervalMs]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return shown;
}

function StepIcon({ state }: { state: ProgressStepState }) {
  if (state === "done")
    return <CheckCircle2 size={14} aria-hidden="true" className="stage-step-icon stage-step-icon-done" />;
  if (state === "current")
    return (
      <Circle size={14} fill="currentColor" aria-hidden="true" className="stage-step-icon stage-step-icon-current" />
    );
  if (state === "failed") return <AlertTriangle size={14} aria-hidden="true" className="stage-step-icon" />;
  if (state === "skipped") return <MinusCircle size={14} aria-hidden="true" className="stage-step-icon" />;
  return <Circle size={14} aria-hidden="true" className="stage-step-icon" />;
}

export function StepperList({ states }: { states: Record<ProgressStepKey, ProgressStepState> }) {
  const tr = useTranslations();
  return (
    <ol className="stage-stepper stage-stepper--status meeting-stepper" aria-label={tr(`${P}.stepsLabel`)}>
      {PROGRESS_STEPS.map((key, i) => {
        const state = states[key];
        return (
          <li
            key={key}
            aria-current={state === "current" ? "step" : undefined}
            data-step={key}
            data-state={state}
            className={`stage-step${state === "current" ? " stage-step-current" : ""}${state === "skipped" ? " stage-step-skipped" : ""}`}
          >
            <span className="stage-step-num">{i + 1}</span>
            <span className="stage-step-name">{tr(`${P}.step.${key}`)}</span>
            <StepIcon state={state} />
            <span className={`stage-step-state${state === "failed" ? " status-chip status-red" : ""}`}>
              {tr(`${P}.state.${state}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The one status sentence for a snapshot (no elapsed time — that is shown separately). */
export function progressStatusText(tr: Translator, p: MeetingProgress): string {
  switch (p.phase) {
    case "agenda":
      return tr(`${P}.status.agenda`);
    case "consensus":
      return tr(`${P}.status.consensus`);
    case "minutes":
      return tr(`${P}.status.minutes`);
    case "done":
      return tr(`${P}.status.done`);
    case "failed":
      return "";
    default: {
      if (!p.speaker_seat && p.turn_count === 0) return tr(`${P}.status.starting`);
      const lead = p.speaker_seat
        ? tr(`${P}.status.discussion`, { seat: seatName(tr, p.speaker_seat) })
        : tr(`${P}.status.discussionAnon`);
      const detail =
        p.round !== undefined && p.round_count !== undefined && p.turn_budget !== undefined
          ? tr(`${P}.detailFull`, {
              round: p.round,
              roundCount: p.round_count,
              count: p.turn_count,
              budget: p.turn_budget,
            })
          : tr(`${P}.detailCount`, { count: p.turn_count });
      return `${lead} ${detail}`;
    }
  }
}

function failurePlace(tr: Translator, p: MeetingProgress): string {
  const f = p.failed_at;
  if (!f) return "";
  const step = (PROGRESS_STEPS as readonly string[]).includes(f.phase)
    ? tr(`${P}.step.${f.phase as ProgressStepKey}`)
    : f.phase;
  const parts = [step];
  if (f.round !== undefined) parts.push(tr(`${P}.failedRound`, { round: f.round }));
  if (f.speaker_seat) parts.push(seatName(tr, f.speaker_seat));
  return parts.join(" · ");
}

export function CommitteeProgressView({
  progress,
  positions,
  failureMessage,
  nowMs,
}: {
  progress: MeetingProgress;
  positions: LivePosition[];
  /** The convening error text, shown with the stop location (role="alert"). */
  failureMessage?: string | null;
  /** Pins the clock (tests); omitted in the app. */
  nowMs?: number;
}) {
  const tr = useTranslations();
  const failed = progress.phase === "failed";
  const now = useNow(!failed, nowMs);
  const states = stepStates(progress);
  const statusText = progressStatusText(tr, progress);
  // The open group follows the round the run is in; a failed run keeps the round it stopped in.
  const rounds = groupPositionsByRound(positions, {
    roundCount: progress.round_count,
    turnBudget: progress.turn_budget,
    currentRound: failed ? progress.failed_at?.round : progress.round,
  });
  const announced = useThrottledText(statusText, ANNOUNCE_THROTTLE_MS);

  const { minutes, seconds } = splitElapsed(elapsedSeconds(progress.started_at, now));
  const elapsedText =
    minutes > 0 ? tr(`${P}.elapsedMinutes`, { minutes, seconds }) : tr(`${P}.elapsedSeconds`, { seconds });

  return (
    <section aria-label={tr(`${P}.liveLabel`)} className="mb-3" data-testid="committee-progress">
      <StepperList states={states} />

      {!failed && (
        <p className="flex items-center gap-1 mb-2 text-[length:var(--fs-caption)]" data-testid="committee-status-line">
          <Clock size={14} aria-hidden="true" />
          <span>{statusText}</span>
          <span className="text-[color:var(--muted-fg)] tabular-nums">· {elapsedText}</span>
        </p>
      )}
      {/* Polite live region: always mounted (it must exist before its text changes),
          carries the throttled status text, and stays empty once the run failed so
          the role="alert" block below is the only announcement. */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="committee-live-region">
        {failed ? "" : announced}
      </p>

      {failed && (
        <div role="alert" className="card mb-2 text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">
          <p className="flex items-center gap-1 font-semibold m-0 mb-1">
            <AlertTriangle size={14} aria-hidden="true" />
            {tr(`${P}.failedTitle`)}
          </p>
          <p className="m-0 mb-1">{tr(`${P}.failedPlace`, { place: failurePlace(tr, progress) })}</p>
          {failureMessage && <p className="m-0 mb-1">{failureMessage}</p>}
          {progress.failed_at?.error_code && (
            <p className="m-0 mb-1 text-[color:var(--muted-fg)]">
              {tr(`${P}.failedCode`, { code: progress.failed_at.error_code })}
            </p>
          )}
          {positions.length > 0 && (
            <p className="m-0 text-[color:var(--muted-fg)]">{tr(`${P}.failedKept`, { count: positions.length })}</p>
          )}
        </div>
      )}

      <div className="mt-2" data-testid="committee-live-positions">
        <p className="text-[length:var(--fs-caption)] font-semibold mb-1">
          {tr(`${P}.positionsTitle`, { count: positions.length })}
        </p>
        {positions.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] m-0">
            {tr(`${P}.positionsEmpty`)}
          </p>
        ) : (
          <ul className="list-none p-0 m-0">
            {rounds.map((g) => (
              <li key={g.round}>
                <details className="mb-2" open={g.open}>
                  <summary className="text-[length:var(--fs-caption)] font-semibold cursor-pointer">
                    {g.total !== null
                      ? tr(`${P}.roundGroup`, { round: g.round, finished: g.finished, total: g.total })
                      : tr(`${P}.roundGroupCount`, { round: g.round, finished: g.finished })}
                  </summary>
                  <ul className="list-none p-0 m-0 pl-2">
                    {g.positions.map((p) => (
                      <li key={p.positionId}>
                        <details className="mb-1">
                          <summary className="text-[length:var(--fs-caption)] cursor-pointer">
                            {p.memberType === "human" ? (p.humanUserId ?? "") : seatName(tr, p.agentKey ?? "")}
                            {p.confidence !== null && (
                              <span className="text-[color:var(--muted-fg)]">
                                {" · "}
                                {tr(`${P}.positionConfidence`, { value: p.confidence })}
                              </span>
                            )}
                          </summary>
                          <pre
                            className="whitespace-pre-wrap text-[length:var(--fs-caption)] m-0 pl-2"
                            style={{ fontFamily: "inherit" }}
                          >
                            {stripPositionMeta(p.positionMd)}
                          </pre>
                        </details>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ── Turn engine (ADR-0204 phase 2) ─────────────────────────────────────────

export function humanSeatName(tr: Translator, seat: string | undefined): string {
  return !seat || seat === "human" ? tr(`${T}.human`) : seatName(tr, seat);
}

/** The one status sentence for a TURN-engine snapshot (no elapsed time). */
export function turnStatusText(tr: Translator, p: MeetingProgress): string {
  switch (p.phase) {
    case "agenda":
      return tr(`${P}.status.agenda`);
    case "consensus":
      return p.issue_index !== undefined
        ? tr(`${T}.status.consensus`, { index: p.issue_index })
        : tr(`${P}.status.consensus`);
    case "minutes":
      return tr(`${P}.status.minutes`);
    case "done":
      return tr(`${P}.status.done`);
    case "awaiting_human":
      return tr(`${T}.status.awaiting`, { seat: humanSeatName(tr, p.awaiting?.seat ?? p.speaker_seat) });
    case "failed":
      return "";
    default: {
      if (!p.speaker_seat && p.turn_count === 0) return tr(`${P}.status.starting`);
      const lead = p.speaker_seat
        ? tr(`${P}.status.discussion`, { seat: seatName(tr, p.speaker_seat) })
        : tr(`${P}.status.discussionAnon`);
      const detail =
        p.issue_index !== undefined && p.issue_count !== undefined && p.turn_budget !== undefined
          ? tr(`${T}.status.detail`, {
              issue: p.issue_index,
              count: p.issue_count,
              turns: p.turn_count,
              budget: p.turn_budget,
            })
          : tr(`${P}.detailCount`, { count: p.turn_count });
      return `${lead} ${detail}`;
    }
  }
}

export function turnFailurePlace(tr: Translator, p: MeetingProgress): string {
  const f = p.failed_at;
  if (!f) return "";
  const step = (PROGRESS_STEPS as readonly string[]).includes(f.phase)
    ? tr(`${P}.step.${f.phase as ProgressStepKey}`)
    : f.phase;
  const parts = [step];
  if (f.issue_index !== undefined && p.issue_count !== undefined) {
    parts.push(
      f.seq !== undefined
        ? tr(`${T}.failed.place`, { issue: f.issue_index, count: p.issue_count, seq: f.seq })
        : tr(`${T}.failed.placeIssue`, { issue: f.issue_index, count: p.issue_count }),
    );
  }
  if (f.speaker_seat) parts.push(seatName(tr, f.speaker_seat));
  return parts.join(" · ");
}

/**
 * The failure sentence for a turn run. A run lost with its process (`runner_lost`,
 * the server-side RUNNER_LOST_CODE) gets the localized explanation; any other
 * failure keeps the server's own message. The error code line is shown separately.
 */
export function turnFailureMessage(tr: Translator, p: MeetingProgress, failureMessage?: string | null): string | null {
  if (p.failed_at?.error_code === "runner_lost") return tr(`${T}.failed.runnerLost`);
  return failureMessage || null;
}

/**
 * The open human floor: a clear "your turn" call with a countdown to the
 * deadline. The countdown text is NOT a live region (it changes every second);
 * the throttled status announcement above carries "waiting for a human member".
 * `children` is the statement form (rendered by the panel, which owns its
 * state); viewers without write access get the read-only line instead.
 */
export function AwaitingFloor({
  awaiting,
  canAct,
  nowMs,
  busy,
  onResume,
  children,
}: {
  awaiting: MeetingAwaiting;
  canAct: boolean;
  nowMs?: number;
  busy?: boolean;
  onResume?: () => void;
  children?: ReactNode;
}) {
  const tr = useTranslations();
  const answered = !!awaiting.answered_at;
  const now = useNow(!answered, nowMs);
  const remaining = awaitingRemainingMs(awaiting, now);
  const expired = !answered && remaining === 0;
  const { minutes, seconds } = splitCountdown(remaining);
  const seat = humanSeatName(tr, awaiting.seat);
  return (
    <div className="card mb-2" data-testid="committee-awaiting" data-expired={expired ? "true" : "false"}>
      <p className="flex items-center gap-1 font-semibold m-0 mb-1 text-[length:var(--fs-body)]">
        <Clock size={14} aria-hidden="true" />
        {canAct ? tr(`${T}.awaiting.title`, { seat }) : tr(`${T}.awaiting.waitingTitle`, { seat })}
      </p>
      <p className="m-0 mb-2 text-[length:var(--fs-caption)] tabular-nums" data-testid="committee-awaiting-countdown">
        {expired ? tr(`${T}.awaiting.expired`) : tr(`${T}.awaiting.remaining`, { minutes, seconds })}
      </p>
      {canAct && !expired && !answered && children}
      {!canAct && (
        <p className="m-0 text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
          {tr(`${T}.awaiting.readOnly`)}
        </p>
      )}
      {canAct && (expired || answered) && onResume && (
        <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={onResume}>
          {tr(`${T}.awaiting.resume`)}
        </button>
      )}
    </div>
  );
}

/**
 * Page-level "your turn" alert for the viewer who may speak: prominent (icon +
 * text + a tinted frame — never color alone), with the countdown and a button
 * that opens the meeting window at the statement form. The countdown is plain
 * text (it changes every second); the throttled live region carries the
 * "waiting for a human member" announcement.
 */
function HumanTurnAlert({
  awaiting,
  nowMs,
  busy,
  onOpenWindow,
  onResume,
}: {
  awaiting: MeetingAwaiting;
  nowMs?: number;
  busy?: boolean;
  onOpenWindow?: () => void;
  onResume?: () => void;
}) {
  const tr = useTranslations();
  const now = useNow(true, nowMs);
  const remaining = awaitingRemainingMs(awaiting, now);
  const expired = remaining === 0;
  const { minutes, seconds } = splitCountdown(remaining);
  const seat = humanSeatName(tr, awaiting.seat);
  return (
    <div className="meeting-turn-alert mb-2" data-testid="committee-awaiting" data-expired={expired ? "true" : "false"}>
      <p className="flex flex-wrap items-center gap-2 font-semibold m-0 mb-1 text-[length:var(--fs-body)]">
        <BellRing size={16} aria-hidden="true" />
        <span className="status-chip status-info">{tr(`${T}.awaiting.badge`)}</span>
        {tr(`${T}.awaiting.title`, { seat })}
      </p>
      <p className="m-0 mb-2 text-[length:var(--fs-caption)] tabular-nums" data-testid="committee-awaiting-countdown">
        {expired ? tr(`${T}.awaiting.expired`) : tr(`${T}.awaiting.remaining`, { minutes, seconds })}
      </p>
      {expired ? (
        onResume && (
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={onResume}>
            {tr(`${T}.awaiting.resume`)}
          </button>
        )
      ) : (
        <button
          type="button"
          className="btn-primary btn-sm"
          aria-haspopup="dialog"
          data-testid="committee-open-window-input"
          onClick={onOpenWindow}
        >
          {tr(`${T}.awaiting.openWindow`)}
        </button>
      )}
    </div>
  );
}

/**
 * The turn meeting on the PAGE (design §16.5): one status line (issue i/n ·
 * speaker · turns used, plus elapsed time) with the "view meeting" button, the
 * "your turn" alert while a human seat has the floor, and — when the run
 * stopped — where it stopped in a role="alert" block with the retry button.
 * The window itself is rendered by the panel (it owns the data and the form);
 * this view never opens it on its own.
 */
export function CommitteeTurnProgressView({
  progress,
  turns,
  failureMessage,
  canAct = false,
  busy,
  onRetry,
  onResume,
  onOpenWindow,
  nowMs,
}: {
  progress: MeetingProgress;
  turns: readonly TurnView[];
  failureMessage?: string | null;
  /** The viewer may write (analyst+): the "your turn" alert, retry and resume are offered. */
  canAct?: boolean;
  busy?: boolean;
  /** Failed run: restart from the stopped issue (advance). */
  onRetry?: () => void;
  /** Paused run: drive the meeting on (advance) once the deadline passed. */
  onResume?: () => void;
  /** Open the meeting window; `focusInput` puts the caret in the human statement form. */
  onOpenWindow?: (opts: { focusInput: boolean }) => void;
  /** Pins the clock (tests); omitted in the app. */
  nowMs?: number;
}) {
  const tr = useTranslations();
  const failed = progress.phase === "failed";
  const humanTurn = isHumanTurnOpen(progress, canAct);
  const now = useNow(!failed, nowMs);
  const statusText = turnStatusText(tr, progress);
  const announced = useThrottledText(statusText, ANNOUNCE_THROTTLE_MS);
  const { minutes, seconds } = splitElapsed(elapsedSeconds(progress.started_at, now));
  const elapsedText =
    minutes > 0 ? tr(`${P}.elapsedMinutes`, { minutes, seconds }) : tr(`${P}.elapsedSeconds`, { seconds });
  const keptCount = turns.filter((t) => !t.abandoned).length;
  const failureText = turnFailureMessage(tr, progress, failureMessage);

  return (
    <section aria-label={tr(`${P}.liveLabel`)} className="card mb-3" data-testid="committee-turn-progress">
      {humanTurn && progress.awaiting && (
        <HumanTurnAlert
          awaiting={progress.awaiting}
          nowMs={nowMs}
          busy={busy}
          onOpenWindow={() => onOpenWindow?.({ focusInput: true })}
          onResume={onResume}
        />
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {!failed && (
          <p
            className="flex flex-1 items-center gap-1 m-0 text-[length:var(--fs-caption)]"
            data-testid="committee-status-line"
          >
            <Clock size={14} aria-hidden="true" />
            <span>{statusText}</span>
            <span className="text-[color:var(--muted-fg)] tabular-nums">· {elapsedText}</span>
          </p>
        )}
        {onOpenWindow && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            aria-haspopup="dialog"
            data-testid="committee-open-window"
            onClick={() => onOpenWindow({ focusInput: false })}
          >
            {tr(`${T}.window.open`)}
          </button>
        )}
      </div>
      {attemptOf(progress) > 1 && progress.resumed_from_issue_index !== undefined && (
        <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          {tr(`${T}.attemptNote`, { attempt: attemptOf(progress), issue: progress.resumed_from_issue_index })}
        </p>
      )}
      {/* Polite live region: always mounted, throttled, empty once failed (the alert is the only announcement). */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="committee-live-region">
        {failed ? "" : announced}
      </p>

      {failed && (
        <>
          <div role="alert" className="mb-2 text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">
            <p className="flex items-center gap-1 font-semibold m-0 mb-1">
              <AlertTriangle size={14} aria-hidden="true" />
              {tr(`${P}.failedTitle`)}
            </p>
            <p className="m-0 mb-1">{tr(`${P}.failedPlace`, { place: turnFailurePlace(tr, progress) })}</p>
            {failureText && <p className="m-0 mb-1">{failureText}</p>}
            {progress.failed_at?.error_code && (
              <p className="m-0 mb-1 text-[color:var(--muted-fg)]">
                {tr(`${P}.failedCode`, { code: progress.failed_at.error_code })}
              </p>
            )}
            {keptCount > 0 && (
              <p className="m-0 text-[color:var(--muted-fg)]">{tr(`${T}.failed.kept`, { count: keptCount })}</p>
            )}
          </div>
          {canAct && onRetry && (
            <div>
              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={onRetry}>
                {busy ? tr(`${T}.failed.retrying`) : tr(`${T}.failed.retry`)}
              </button>
              <p className="m-0 mt-1 text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                {tr(`${T}.failed.retryHint`)}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
