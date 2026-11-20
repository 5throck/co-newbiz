"use client";

// CommitteeProgress — live view of a convening committee session
// (design 2026-11-20-committee-turn-based-meeting-design §4.8 / §8, ADR-0204).
// Pattern P4 Execution: a four-step stepper (안건 정리 → 토의 → 합의 → 회의록)
// built from the existing .stage-stepper classes, a status line with elapsed
// time, the list of finished positions (collapsed per item), and — when the
// run stopped — where it stopped, in a role="alert" block.
//
// Accessibility (ADR-0065, WCAG 2.1 AA): every step carries an icon AND a text
// state (never color alone); the current step is aria-current="step"; progress
// text goes to a polite live region throttled to one announcement per 10 s
// (the visible status line updates immediately but is NOT a live region, so
// the per-second elapsed time never reaches a screen reader). New items never
// move focus. No new interactive control: each position is a native <details>.
import { AlertTriangle, CheckCircle2, Circle, Clock, MinusCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { LivePosition, MeetingProgress } from "../lib/committee-progress.ts";
import {
  ANNOUNCE_THROTTLE_MS,
  elapsedSeconds,
  PROGRESS_STEPS,
  type ProgressStepKey,
  type ProgressStepState,
  splitElapsed,
  stepStates,
  stripPositionMeta,
  throttleDecision,
} from "../lib/committee-progress-view.ts";
import { COMMITTEE_SEAT_LABEL_KEY } from "../lib/label-keys.ts";

type Translator = ReturnType<typeof useTranslations>;

const P = "common.committee.progress";

function seatName(tr: Translator, key: string): string {
  const labelKey = COMMITTEE_SEAT_LABEL_KEY[key];
  return labelKey ? tr(labelKey) : key;
}

/** Wall clock that ticks once a second while `enabled`; `override` pins it (tests). */
function useNow(enabled: boolean, override?: number): number {
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
  const announced = useThrottledText(statusText, ANNOUNCE_THROTTLE_MS);

  const { minutes, seconds } = splitElapsed(elapsedSeconds(progress.started_at, now));
  const elapsedText =
    minutes > 0 ? tr(`${P}.elapsedMinutes`, { minutes, seconds }) : tr(`${P}.elapsedSeconds`, { seconds });

  return (
    <section aria-label={tr(`${P}.liveLabel`)} className="mb-3" data-testid="committee-progress">
      <ol className="stage-stepper stage-stepper--status" aria-label={tr(`${P}.stepsLabel`)}>
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
            {positions.map((p) => (
              <li key={p.positionId}>
                <details className="mb-1">
                  <summary className="text-[length:var(--fs-caption)] cursor-pointer">
                    {tr(`${P}.positionSummary`, {
                      seat: p.memberType === "human" ? (p.humanUserId ?? "") : seatName(tr, p.agentKey ?? ""),
                      round: p.round,
                    })}
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
        )}
      </div>
    </section>
  );
}
