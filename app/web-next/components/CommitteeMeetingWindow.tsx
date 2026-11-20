"use client";

// CommitteeMeetingWindow — the optional meeting window of a committee meeting
// (design 2026-11-20-committee-turn-based-meeting-design §16.5, ADR-0204).
//
// The page only shows a one-line status and a "view meeting" button; this large
// dialog holds the live transcript. It is never opened by itself, and closing it
// never stops the meeting (the poll and all state live in CommitteePanel).
//
//   header (pinned)  title · close · stepper · issue title · current speaker · turns used
//   body (scrolls)   the issue-grouped transcript; auto-follows the newest turn, pauses
//                    when the reader scrolls up, and offers a "jump to latest" button
//   footer (pinned)  the open human floor with the statement form, or the stop notice
//
// Accessibility (WCAG 2.1 AA): role="dialog" + aria-modal + aria-labelledby; focus moves
// in on open (the statement form when it was opened from the "your turn" alert), is
// trapped, Esc closes, and focus returns to the trigger on close (useModalFocus). The
// scroller is a labelled keyboard-focusable region — NOT a live region, so new turns are
// not announced one by one (the page's throttled status line is the only announcement).
// Rendered through a portal; `MeetingWindowDialog` is the portal-free body (tests render it).
import { AlertTriangle, ArrowDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { MeetingProgress } from "../lib/committee-progress.ts";
import {
  type AgendaParticipant,
  currentSpeakerSeat,
  followReducer,
  showJumpToLatest,
  type TurnView,
  turnStepStates,
  unseenCount,
} from "../lib/committee-progress-view.ts";
import { useModalFocus } from "../lib/use-modal-focus.ts";
import { AwaitingFloor, StepperList, turnFailureMessage, turnFailurePlace } from "./CommitteeProgress.tsx";
import { CommitteeMinutesV2View } from "./CommitteeMinutesV2View.tsx";
import { CommitteeTurnTranscript, seatName } from "./CommitteeTurnTranscript.tsx";
import {
  minutesHasBodyTabs,
  minutesJsonOf,
  parseMinutesDissent,
  type MinutesJsonPayload,
} from "../lib/committee-minutes-view.ts";

const T = "common.committee.turns";
const P = "common.committee.progress";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The scrolling transcript body. `live` turns on auto-follow: pinned to the newest turn
 * while the reader is at the bottom; scrolling up pauses it and shows the jump button.
 */
function FollowScroller({
  live,
  total,
  label,
  children,
}: {
  live: boolean;
  /** Number of items inside (turns): growth while following scrolls to the bottom. */
  total: number;
  label: string;
  children: ReactNode;
}) {
  const tr = useTranslations();
  const ref = useRef<HTMLElement | null>(null);
  const [state, dispatch] = useReducer(followReducer, { following: live, seen: total });
  const stateRef = useRef(state);
  stateRef.current = state;

  const scrollToBottom = useCallback(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // New turns (or first mount): pin to the bottom while following, and record what was seen.
  useIsoLayoutEffect(() => {
    if (!live) return;
    dispatch({ type: "items", total });
    if (stateRef.current.following) scrollToBottom();
  }, [total, live, scrollToBottom]);

  const unseen = unseenCount(state, total);
  const showJump = showJumpToLatest(state, live);
  return (
    <div className="meeting-window-scroll-wrap">
      <section
        ref={ref}
        className="meeting-window-scroll"
        aria-label={label}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-reachable (WCAG 2.1.1)
        tabIndex={0}
        data-testid="committee-window-scroll"
        data-following={state.following ? "true" : "false"}
        onScroll={(e) => {
          if (!live) return;
          const el = e.currentTarget;
          dispatch({
            type: "scroll",
            metrics: { scrollTop: el.scrollTop, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight },
            total,
          });
        }}
      >
        {children}
      </section>
      {showJump && (
        <button
          type="button"
          className="btn-primary btn-sm meeting-window-jump"
          data-testid="committee-jump-latest"
          onClick={() => {
            scrollToBottom();
            dispatch({ type: "jump", total });
            ref.current?.focus();
          }}
        >
          <ArrowDown size={14} aria-hidden="true" />
          {unseen > 0 ? tr(`${T}.window.jumpLatestNew`, { count: unseen }) : tr(`${T}.window.jumpLatest`)}
        </button>
      )}
    </div>
  );
}

export interface MeetingWindowProps {
  /** `live`: a convening / paused / failed meeting; `record`: a finished session's full transcript. */
  mode: "live" | "record";
  turns: readonly TurnView[];
  titles?: ReadonlyArray<string | null | undefined>;
  participants?: ReadonlyArray<AgendaParticipant[]>;
  /** Live: the current snapshot (stepper, issue, speaker, turns used). */
  progress?: MeetingProgress | null;
  failureMessage?: string | null;
  canAct?: boolean;
  /** The human statement form (rendered by the panel, which owns its state). */
  humanForm?: ReactNode;
  busy?: boolean;
  onRetry?: () => void;
  onResume?: () => void;
  /** Focus the statement form on open (opened from the "your turn" alert). */
  focusInput?: boolean;
  /** Record mode, minutes v2: the fetched minutes payload (tabs + body). Null while loading / on v1. */
  minutes?: MinutesJsonPayload | null;
  /** Record mode: the minutes fetch state ("loading" | "error" | "loaded"); null = no fetch attempted. */
  minutesState?: "loading" | "error" | "loaded" | null;
  onClose: () => void;
  /** Pins the clock (tests). */
  nowMs?: number;
}

/** The window without its portal: backdrop + dialog panel. */
export function MeetingWindowDialog({
  mode,
  turns,
  titles,
  participants,
  progress,
  failureMessage,
  canAct = false,
  humanForm,
  busy,
  onRetry,
  onResume,
  focusInput = false,
  minutes = null,
  minutesState = null,
  onClose,
  nowMs,
}: MeetingWindowProps) {
  const tr = useTranslations();
  const titleId = useId();
  const live = mode === "live" && !!progress;
  const { panelRef, onKeyDown } = useModalFocus(onClose);

  // Opened from the "your turn" alert: put the caret in the statement form instead of the close button.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on open; later floors do not steal focus
  useEffect(() => {
    if (!focusInput) return;
    panelRef.current?.querySelector<HTMLElement>("[data-testid='committee-awaiting-form'] textarea")?.focus();
  }, []);

  const failed = live && progress?.phase === "failed";
  const awaiting = live && progress?.phase === "awaiting_human" ? (progress.awaiting ?? null) : null;
  const issueNo = progress ? (failed ? progress.failed_at?.issue_index : progress.issue_index) : undefined;
  const issueCount = progress?.issue_count;
  const issueTitle = progress?.issue_title ?? (issueNo !== undefined ? titles?.[issueNo - 1] : undefined);
  const speaker = progress ? currentSpeakerSeat(progress) : null;
  const states = progress ? turnStepStates(progress) : null;
  const failureText = progress ? turnFailureMessage(tr, progress, failureMessage) : null;
  // Record mode, minutes v2: the 회의록 / 전체 발언 tabs. Default tab is the minutes body.
  const showTabs = mode === "record" && minutesHasBodyTabs(minutes);
  const [tab, setTab] = useState<"minutes" | "transcript">("minutes");
  const minutesJson = minutesJsonOf(minutes);
  const dissents = parseMinutesDissent(minutes?.dissentJson ?? null);

  // The meta line (speaker · turns used · record count), joined by aria-hidden dots.
  const metaItems: { key: string; node: ReactNode }[] = [];
  if (speaker && !failed) {
    metaItems.push({
      key: "speaker",
      node: <span>{tr(`${T}.window.speaking`, { seat: seatName(tr, speaker) })}</span>,
    });
  }
  if (progress) {
    metaItems.push({
      key: "turns",
      node: (
        <span className="tabular-nums">
          {progress.turn_budget !== undefined
            ? tr(`${T}.window.turnsUsed`, { count: progress.turn_count, budget: progress.turn_budget })
            : tr(`${T}.window.turnsUsedNoBudget`, { count: progress.turn_count })}
        </span>
      ),
    });
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal-backdrop pattern shared with ClosureModal (Esc/Tab handled by useModalFocus)
    <div
      className="modal-backdrop meeting-window-backdrop"
      role="presentation"
      onKeyDown={onKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="modal-panel meeting-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="committee-meeting-window"
        data-mode={mode}
      >
        <header className="meeting-window-head" data-testid="committee-window-head">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="m-0 text-[length:var(--fs-body)] font-semibold">
              {mode === "live" ? tr(`${T}.window.title`) : tr(`${T}.window.recordTitle`)}
            </h2>
            <button type="button" className="btn-ghost btn-sm" onClick={onClose} data-testid="committee-window-close">
              <X size={14} aria-hidden="true" /> {tr(`${T}.window.close`)}
            </button>
          </div>
          {states && <StepperList states={states} />}
          <div className="meeting-window-facts" data-testid="committee-window-facts">
            {issueNo !== undefined && issueCount !== undefined && (
              <p className="meeting-window-issue m-0 font-semibold">
                {issueTitle
                  ? tr(`${T}.issueLine`, { index: issueNo, count: issueCount, title: issueTitle })
                  : tr(`${T}.issueLineNoTitle`, { index: issueNo, count: issueCount })}
              </p>
            )}
            {metaItems.length > 0 && (
              <p className="meeting-window-meta m-0" data-testid="committee-window-meta">
                {metaItems.map((item, i) => (
                  <Fragment key={item.key}>
                    {i > 0 && (
                      <span className="meeting-window-sep" aria-hidden="true">
                        ·
                      </span>
                    )}
                    {item.node}
                  </Fragment>
                ))}
              </p>
            )}
          </div>
          {showTabs && (
            <section className="meeting-window-tabs" aria-label={tr(`${T}.window.tabsLabel`)}>
              <button
                type="button"
                className="btn-ghost btn-sm meeting-window-tab"
                aria-pressed={tab === "minutes"}
                data-testid="committee-window-tab-minutes"
                onClick={() => setTab("minutes")}
              >
                {tr(`${T}.window.minutesTab`)}
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm meeting-window-tab"
                aria-pressed={tab === "transcript"}
                data-testid="committee-window-tab-transcript"
                onClick={() => setTab("transcript")}
              >
                {tr(`${T}.window.transcriptTab`)}
              </button>
            </section>
          )}
          {live && <p className="meeting-window-note">{tr(`${T}.window.closeNote`)}</p>}
        </header>

        <div className="meeting-window-body">
          {showTabs && tab === "minutes" ? (
            <div className="meeting-window-scroll-wrap" data-testid="committee-window-minutes">
              <FollowScroller live={false} total={0} label={tr(`${T}.window.minutesTab`)}>
                {minutesState === "loading" && (
                  <p role="status" className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] m-0">
                    {tr(`${T}.window.minutesLoading`)}
                  </p>
                )}
                {minutesState === "error" && (
                  <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] m-0">
                    {tr(`${T}.window.minutesLoadFailed`)}
                  </p>
                )}
                {minutesJson && <CommitteeMinutesV2View minutes={minutesJson} dissents={dissents} />}
              </FollowScroller>
            </div>
          ) : (
            <FollowScroller live={live} total={turns.length} label={tr(`${T}.window.transcriptLabel`)}>
              <CommitteeTurnTranscript
                turns={turns}
                titles={titles}
                participants={participants}
                currentIssue={issueNo}
                currentTitle={progress?.issue_title}
              />
            </FollowScroller>
          )}
        </div>

        {(awaiting || failed) && (
          <footer className="meeting-window-foot" data-testid="committee-window-foot">
            {awaiting && (
              <AwaitingFloor awaiting={awaiting} canAct={canAct} nowMs={nowMs} busy={busy} onResume={onResume}>
                <div data-testid="committee-awaiting-form">{humanForm}</div>
              </AwaitingFloor>
            )}
            {failed && progress && (
              <div className="text-[length:var(--fs-caption)]">
                <p className="flex items-center gap-1 font-semibold m-0 mb-1 text-[color:var(--red-fg)]">
                  <AlertTriangle size={14} aria-hidden="true" />
                  {tr(`${P}.failedTitle`)}
                </p>
                <p className="m-0 mb-1">{tr(`${P}.failedPlace`, { place: turnFailurePlace(tr, progress) })}</p>
                {failureText && <p className="m-0 mb-1">{failureText}</p>}
                {canAct && onRetry && (
                  <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={onRetry}>
                    {busy ? tr(`${T}.failed.retrying`) : tr(`${T}.failed.retry`)}
                  </button>
                )}
              </div>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

/** The meeting window, portalled to <body> (client only: it is mounted after a click). */
export function CommitteeMeetingWindow(props: MeetingWindowProps) {
  if (typeof document === "undefined") return null;
  return createPortal(<MeetingWindowDialog {...props} />, document.body);
}
