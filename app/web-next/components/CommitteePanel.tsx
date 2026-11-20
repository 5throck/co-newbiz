"use client";

// CommitteePanel — steering-committee deliberation UI (ADR-0097 §6).
// Convene a registered committee session, watch the per-round position
// timeline (member_type badge human/agent), and read the chair's PROPOSED
// synthesis with the risk officer's dissent VERBATIM. The confirm form is
// the SAME human action GateDecisionPanel performs (POST gate-decisions with
// the proposal pre-filled, override allowed) plus the 0066
// gate_evaluation_id provenance link — in agent_team mode the panel stops at
// PROPOSED: the confirming click is always human (design boundary #2).
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api.ts";
import { useAuth } from "../lib/auth-client.tsx";
import { canWriteBusiness } from "../lib/project-write-access.ts";
import { PrimaryAction } from "./ui.tsx";
import { useLocale, useTranslations } from "next-intl";
import { DECISION_MODE_LABEL_KEY, GATE_LABEL_KEY } from "../lib/label-keys.ts";
import { formatDateTime } from "../lib/format.ts";
import { MinutesDialog } from "./CommitteeMinutesView.tsx";
import type { MinutesJsonPayload } from "../lib/committee-minutes-view.ts";
import { CommitteeMeetingWindow, type MeetingWindowProps } from "./CommitteeMeetingWindow.tsx";
import { CommitteeProgressView, CommitteeTurnProgressView } from "./CommitteeProgress.tsx";
import type { LivePosition, MeetingAwaiting, MeetingProgress } from "../lib/committee-progress.ts";
import {
  type AgendaParticipant,
  attemptOf,
  buildTurnPollUrl,
  committeeKeyLabel,
  sessionDurationSeconds,
  CONVENING_DEADLINE_MS,
  CONVENING_POLL_MS,
  convenDeadlineReached,
  type DeadlinePause,
  lastSeq,
  MAX_TURN_PAGES_PER_TICK,
  mergeTurns,
  nextDeadlinePause,
  participantsByIssue,
  pickFailedTurnSession,
  pickResumableSession,
  POSITION_META_RE,
  shouldAdvanceAwaiting,
  stripPositionMeta,
  type TurnView,
  turnErrorKey,
  turnsNeedReset,
  visibleTurnCount,
} from "../lib/committee-progress-view.ts";

interface SessionPosition {
  positionId: string;
  memberType: "human" | "agent";
  agentKey: string | null;
  humanUserId: string | null;
  positionMd: string;
  confidence: number | null;
  createdAt: string;
}
interface SessionTranscript {
  sessionId: string;
  status: string;
  meta: { committee_key: string; decision_mode: string; gate: string; target_ref?: string; synthesized?: boolean };
  /** Turn engine (ADR-0204): absent on sessions created before it = "rounds". */
  engine?: "rounds" | "turns";
  /** Turn engine: every turn in seq order (GET without afterSeq). */
  turns?: TurnView[];
  /** Turn engine: the stored chair agenda (titles label the issue groups). */
  agenda?: Array<{ title: string; participants?: unknown }> | null;
  rounds: Array<{ round: number; positions: SessionPosition[] }>;
  evaluation: {
    gateEvaluationId: string;
    gate: string;
    recommendation: string;
    dissentJson: string | null;
    evaluatedBy: string;
    createdAt: string;
  } | null;
}
/** One session of the list payload as the convening poll reads it. */
interface PollSession {
  sessionId: string;
  convening?: boolean;
  conveningError?: string | null;
  progress?: MeetingProgress | null;
  positions?: LivePosition[];
  engine?: "rounds" | "turns";
  awaiting?: MeetingAwaiting | null;
  turns?: TurnView[];
  hasMoreTurns?: boolean;
  meta?: { agenda?: Array<{ title: string; participants?: unknown }> | null; synthesized?: boolean };
}
/** Live view of a TURN-engine session: kept after a failure so the stop location and the turns stay on screen. */
interface TurnLive {
  sessionId: string;
  progress: MeetingProgress;
  turns: TurnView[];
  titles: string[];
  /** Chair-selected participants by issue (empty lists while the engine does not report them). */
  participants: AgendaParticipant[][];
  failureMessage?: string;
}

const TURN_I18N = "common.committee.turns";

interface DissentEntry {
  member_key: string;
  position_md: string;
}

const REC_LABEL: Record<string, string> = { go: "GO", hold: "HOLD", kill: "KILL" };

// position-meta marker — the verbatim footnote appended to every position
// (agent and human alike). Parsed here for the per-seat scorecard table
// (ADR-0104): recommendation / veto / confidence / 5-criteria scores.
interface PositionMeta {
  recommendation?: string;
  veto_dissent?: boolean;
  confidence?: number;
  seat?: string;
  criteria_scores?: Record<string, number>;
}
function parsePositionMeta(positionMd: string): PositionMeta {
  const m = positionMd.match(POSITION_META_RE);
  if (!m) return {};
  try {
    return JSON.parse(m[1]) as PositionMeta;
  } catch {
    return {};
  }
}
// 입장 원문 표시용 — <!--position-meta:{...}-->는 저장 형식일 뿐, 검토자가
// 읽을 이유가 없는 raw JSON이다. 항상 걷어내고 본문만 보여준다.
const stripMeta = stripPositionMeta;

// 좌석 점수 집계 — 의장 종합 카드의 "근거" 문구용. 5criteria 점수가 있는
// 좌석들의 평균을 다시 평균해 하나의 요약 숫자로 낸다 (없으면 "표 없음").
function seatScoreAverage(transcript: SessionTranscript): number | null {
  const seatAverages = transcript.rounds
    .flatMap((r) => r.positions)
    .map((p) => Object.values(parsePositionMeta(p.positionMd).criteria_scores ?? {}))
    .filter((v) => v.length > 0)
    .map((v) => v.reduce((sum, n) => sum + n, 0) / v.length);
  if (!seatAverages.length) return null;
  return Math.round((seatAverages.reduce((sum, n) => sum + n, 0) / seatAverages.length) * 10) / 10;
}
function seatScoreSummary(transcript: SessionTranscript): string {
  const avg = seatScoreAverage(transcript);
  return avg !== null ? `좌석 점수 집계 ${avg}/3.0` : "좌석 점수 표 없음";
}

export function CommitteePanel({
  opportunityId,
  committeeKey,
  committeeLabel,
  gates,
  targetRef,
  briefMd,
  beforeConvene,
  conveneLabel,
  headerPrimary,
}: {
  opportunityId: string;
  committeeKey: string;
  committeeLabel: string;
  gates: Array<"screening" | "pre_fs" | "target_screening" | "fs" | "dd" | "entity_ic" | "group_ic">;
  targetRef?: string;
  /** Extra judgement-basis text appended to the convene topic (e.g. S6/S7's
   * t-01~t-09 verdict brief) — every committee member's prompt includes it. */
  briefMd?: string;
  /** 소집 직전에 실행하는 선행 작업(예: S6/S7 사전 검토 제안 생성). 심의 근거를
   * 새로 만든 뒤 소집하기 위한 훅 — 반환값이 문자열이면 그 내용으로 brief를
   * 교체한다(상태 반영 지연 없이 최신 근거를 심의에 넣기 위함). 실패 시
   * 소집하지 않는다. */
  beforeConvene?: () => Promise<string | undefined>;
  conveneLabel?: string;
  /** Wave U: render the convene action as the screen's Primary Action in the page header. */
  headerPrimary?: boolean;
}) {
  const tr = useTranslations();
  const locale = useLocale();
  const { me } = useAuth();
  const canAct = canWriteBusiness(me?.role);
  const [sessions, setSessions] = useState<
    Array<{
      sessionId: string;
      meta: SessionTranscript["meta"];
      status: string;
      startedAt: string;
      convening?: boolean;
      engine?: "rounds" | "turns";
      progress?: MeetingProgress | null;
    }>
  >([]);
  const [minutesOpen, setMinutesOpen] = useState(false);
  // Turn-meeting minutes v2 record: fetched once per "회의록 보기" open of the meeting window
  // (the window then shows the 회의록 / 전체 발언 tabs). v1 / fetch failure fall back — v1 opens
  // the MinutesDialog as before; a fetch failure closes the window and surfaces the error.
  const [minutesRecord, setMinutesRecord] = useState<{
    payload: MinutesJsonPayload | null;
    state: "loading" | "error" | "loaded";
  }>({ payload: null, state: "loading" });
  // Live progress of the session being convened (poll payload: progress +
  // the positions finished so far). Kept after a failure so the stop location
  // and the kept statements stay on screen; cleared on a new convene / success.
  const [live, setLive] = useState<{
    progress: MeetingProgress;
    positions: LivePosition[];
    failureMessage?: string;
  } | null>(null);
  // Turn-engine live view (ADR-0204 phase 2): progress + the turns streamed so far.
  const [turnLive, setTurnLive] = useState<TurnLive | null>(null);
  // Busy flag of the turn-meeting actions (submit the human turn, retry, resume). Separate from `busy`:
  // `busy` stays true for the whole watch, and the open human floor must stay usable while it does.
  const [turnBusy, setTurnBusy] = useState(false);
  // The optional meeting window (design §16.5): never opened by itself; closing it does not touch the
  // meeting (the poll and every piece of state live here). `focusInput` = opened from the "your turn" alert.
  const [meetingWindow, setMeetingWindow] = useState<{ focusInput: boolean } | null>(null);
  const meetingWindowRef = useRef<{ focusInput: boolean } | null>(null);
  meetingWindowRef.current = meetingWindow;
  // The last live snapshot the window showed: when the meeting finishes while the window is open, it keeps
  // showing this until the finished transcript is loaded, then continues as the full record (no flicker).
  const lastLiveRef = useRef<TurnLive | null>(null);
  if (turnLive) lastLiveRef.current = turnLive;
  else if (!meetingWindow) lastLiveRef.current = null;
  const [transcript, setTranscript] = useState<SessionTranscript | null>(null);
  // 아코디언 — 펼친 세션(소집 이력 행)의 id. 새로 소집한 세션은 자동 펼침.
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  // 소집 이력 공개 여부 — 이력은 상시 노출 대상이 아니라 조회 대상(사용자
  // 요청, 2026-09-17)이라 기본은 접고, 새 소집 시에만 자동으로 펼친다.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [decisionMode, setDecisionMode] = useState<"human_only" | "agent_team" | "hybrid">("agent_team");
  const [gate, setGate] = useState(gates[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The inline human-position form — an explicit form, never a prompt dialog.
  const [position, setPosition] = useState<{ text: string; recommendation: "go" | "hold" | "kill" }>({
    text: "",
    recommendation: "go",
  });
  // The embedded confirm form — same shape as GateDecisionPanel's.
  const [form, setForm] = useState<{ decision: "go" | "hold" | "kill"; rationale: string; missing: string }>({
    decision: "go",
    rationale: "",
    missing: "",
  });

  // The ONE convening poll: at most one watch runs; unmount (or switching
  // deal) cancels it and clears its timer.
  const watchRef = useRef<{ cancelled: boolean; timer: ReturnType<typeof setTimeout> | null; wake: () => void } | null>(
    null,
  );
  const conveningRef = useRef(false); // a convene click is in flight (POST or watch)

  const loadSessions = useCallback((): Promise<
    Array<{
      sessionId: string;
      startedAt: string;
      convening?: boolean;
      progress?: MeetingProgress | null;
      engine?: "rounds" | "turns";
      awaiting?: MeetingAwaiting | null;
      meta?: { synthesized?: boolean };
    }>
  > => {
    return api
      .get<{
        sessions: Array<{
          sessionId: string;
          meta: SessionTranscript["meta"];
          status: string;
          startedAt: string;
          convening?: boolean;
          conveningError?: string | null;
          progress?: MeetingProgress | null;
          engine?: "rounds" | "turns";
          awaiting?: MeetingAwaiting | null;
        }>;
      }>(
        `/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions?committeeKey=${encodeURIComponent(committeeKey)}`,
      )
      .then((r) => {
        setSessions(r.data.sessions);
        return r.data.sessions;
      })
      .catch(() => {
        setSessions([]);
        return [];
      });
  }, [opportunityId, committeeKey]);

  const loadTranscript = useCallback(
    (sessionId: string) => {
      api
        .get<SessionTranscript>(
          `/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(sessionId)}`,
        )
        .then((r) => setTranscript(r.data))
        .catch((e) => setError(e instanceof Error ? e.message : "세션 불러오기 실패"));
    },
    [opportunityId],
  );

  // Load the history; if a session is still convening (reload / navigation
  // mid-meeting), bring its live view back with the same poll the convene
  // click uses. The deadline counts from the session's start, not from mount.
  // Cleanup (unmount / deal switch) cancels the poll and clears its timer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: watchConvening only touches refs and stable setters; the resume runs once per deal
  useEffect(() => {
    let alive = true;
    void loadSessions().then(async (list) => {
      if (!alive || watchRef.current || conveningRef.current) return;
      const target = pickResumableSession(list, Date.now());
      if (!target) {
        // A newest turn meeting that stopped on a failure: bring back its stop location and retry button.
        const failed = pickFailedTurnSession(list);
        if (!failed) return;
        setBusy(true);
        try {
          await watchConvening(failed.sessionId, Date.now(), true);
        } finally {
          setBusy(false);
        }
        return;
      }
      setBusy(true);
      try {
        await watchConvening(target.sessionId, target.startedAtMs, true);
      } finally {
        setBusy(false);
      }
    });
    return () => {
      alive = false;
      const w = watchRef.current;
      if (w) {
        w.cancelled = true;
        if (w.timer) clearTimeout(w.timer);
        w.wake();
      }
    };
  }, [loadSessions]);

  // GET .../minutes?format=json (envelope-unwrapped).
  async function fetchMinutesPayload(sessionId: string): Promise<MinutesJsonPayload> {
    const res = await fetch(
      `/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(sessionId)}/minutes?format=json`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: MinutesJsonPayload } | MinutesJsonPayload;
    return "data" in body && body.data !== undefined ? body.data : (body as MinutesJsonPayload);
  }

  // The ONE record entry (2026-11-20 UI revision): a finished turn meeting opens the meeting
  // window, which fetches the minutes and offers the 회의록 / 전체 발언 tabs (v2) or — for a
  // pre-v2 draft — falls back to the v1 MinutesDialog. Round sessions go straight to the dialog.
  async function openMinutesRecord(sessionIdArg?: string) {
    const sessionId = sessionIdArg ?? transcript?.sessionId;
    if (!sessionId) return;
    const engine = sessionIdArg ? undefined : transcript?.engine;
    if (engine !== undefined && engine !== "turns") {
      setMinutesOpen(true);
      return;
    }
    setMinutesRecord({ payload: null, state: "loading" });
    setMeetingWindow({ focusInput: false });
    try {
      const payload = await fetchMinutesPayload(sessionId);
      if (payload.minutesVersion === 2) {
        setMinutesRecord({ payload, state: "loaded" });
      } else {
        setMeetingWindow(null);
        setMinutesOpen(true);
        setMinutesRecord({ payload: null, state: "loading" });
      }
    } catch {
      setMinutesRecord({ payload: null, state: "loading" });
      setMeetingWindow(null);
      setError("회의록을 불러오지 못했습니다.");
    }
  }

  // Post-convene refresh — the same follow-up the synchronous path always did
  // (history row refresh + auto-expand + transcript load).
  function finalizeConvene(sessionId: string) {
    setLive(null); // the finished transcript takes over from the live view
    setTurnLive(null);
    setNotice(`위원회 세션이 소집되었습니다 (${sessionId.slice(-6)}).`);
    loadSessions();
    loadTranscript(sessionId);
    if (meetingWindowRef.current) void openMinutesRecord(sessionId);
    setExpandedSessionId(sessionId); // 새 세션은 자동으로 펼친다
    setHistoryOpen(true); // 방금 소집한 행을 바로 보여준다
  }

  // Poll the session list until the session leaves the convening state (done or
  // failed), feeding the live progress view each time (stepper, status line,
  // finished positions), then apply the outcome. The deadline (~10 minutes) is
  // measured from `startedAtMs`, so a resumed watch keeps the original budget.
  // `immediate` polls once right away (resume) instead of waiting one interval.
  async function watchConvening(sessionId: string, startedAtMs: number, immediate: boolean): Promise<void> {
    if (watchRef.current) return; // one poll timer at a time
    const token = { cancelled: false, timer: null as ReturnType<typeof setTimeout> | null, wake: () => {} };
    watchRef.current = token;
    const progressNotice = tr("common.committee.conveningProgress");
    setNotice(progressNotice);
    const deadline = startedAtMs + CONVENING_DEADLINE_MS;
    let settled: { ok: boolean; error?: string } | null = null;
    let stopLocated = false; // the failed run reported where it stopped
    // Turn engine: the deadline is paused while the meeting waits for a human (design §15.2), and the
    // turns are streamed with an `afterSeq` cursor (null = engine not known yet → the plain list URL).
    let pause: DeadlinePause = { pausedMs: 0, since: null };
    let pausedNow = false;
    let turnCursor: number | null = null;
    let heldTurns: TurnView[] = [];
    let seenAttempt: number | null = null;
    let advancedSeq: number | null = null; // the human floor already driven past its deadline
    const listUrl = `/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions`;
    const fetchSession = async (afterSeq: number | null): Promise<PollSession | undefined> => {
      const list = await api.get<{ sessions: PollSession[] }>(buildTurnPollUrl(listUrl, sessionId, afterSeq));
      return list.data.sessions.find((x) => x.sessionId === sessionId);
    };
    try {
      let waitFirst = !immediate;
      for (;;) {
        if (waitFirst) {
          await new Promise<void>((resolve) => {
            token.wake = resolve;
            token.timer = setTimeout(resolve, CONVENING_POLL_MS);
          });
          token.timer = null;
        }
        waitFirst = true;
        if (token.cancelled) return;
        try {
          let s = await fetchSession(turnCursor);
          if (token.cancelled) return;
          if (s?.engine === "turns") {
            // A new sitting flips the `abandoned` flag of turns already held: re-read from the start.
            if (turnsNeedReset(seenAttempt, attemptOf(s.progress))) {
              heldTurns = [];
              s = await fetchSession(0);
              if (token.cancelled) return;
            }
            for (let page = 0; s && page < MAX_TURN_PAGES_PER_TICK; page++) {
              heldTurns = mergeTurns(heldTurns, s.turns ?? []);
              if (!s.hasMoreTurns) break;
              s = await fetchSession(lastSeq(heldTurns));
              if (token.cancelled) return;
            }
          }
          if (s?.engine === "turns") {
            seenAttempt = attemptOf(s.progress);
            turnCursor = lastSeq(heldTurns);
            pausedNow = !!s.awaiting;
            if (s.progress) {
              const progress = s.progress;
              stopLocated = progress.phase === "failed" && !!progress.failed_at;
              setTurnLive({
                sessionId,
                progress,
                turns: heldTurns,
                titles: (s.meta?.agenda ?? []).map((a) => a.title),
                participants: participantsByIssue(s.meta?.agenda),
                failureMessage: s.conveningError ?? undefined,
              });
              setNotice((prev) => (prev === progressNotice ? null : prev));
            }
            // The floor's deadline passed unanswered: drive the meeting on ONCE (the chair records a pass).
            if (s.awaiting && shouldAdvanceAwaiting(s.awaiting, Date.now(), advancedSeq)) {
              advancedSeq = s.awaiting.seq;
              try {
                await api.post(
                  `/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(sessionId)}/advance`,
                  {},
                );
              } catch (err) {
                // The clock ran ahead of the server's: try again on the next tick.
                if (err instanceof ApiError && err.code === "awaiting_human") advancedSeq = null;
                else setError(turnErrorText(err, `${TURN_I18N}.awaiting.submitFailed`));
              }
              if (token.cancelled) return;
            }
          } else if (s?.progress) {
            const progress = s.progress;
            stopLocated = progress.phase === "failed" && !!progress.failed_at;
            setLive({ progress, positions: s.positions ?? [] });
            // the live view replaces the generic "in progress" line
            setNotice((prev) => (prev === progressNotice ? null : prev));
          }
          // A paused turn meeting (open human floor) is not convening but is not finished either.
          if (s && !s.convening && !s.awaiting) {
            settled = s.conveningError ? { ok: false, error: s.conveningError } : { ok: true };
            break;
          }
        } catch {
          // transient poll failure — keep polling until the deadline
        }
        pause = nextDeadlinePause(pause, pausedNow, Date.now());
        if (convenDeadlineReached(deadline, pause, pausedNow, Date.now())) break;
      }
    } finally {
      if (watchRef.current === token) watchRef.current = null;
    }
    if (token.cancelled) return;
    if (settled?.ok) {
      finalizeConvene(sessionId);
    } else if (settled && !settled.ok) {
      const message = settled.error ?? tr("common.committee.conveneFailed");
      // With a stop location the live view shows it next to the message in
      // ONE role="alert"; otherwise (older session, no progress) the plain error.
      if (stopLocated) setLive((prev) => (prev ? { ...prev, failureMessage: message } : prev));
      else setError(message);
    } else {
      setError(tr("common.committee.conveningTimeout"));
    }
  }

  async function convene() {
    if (busy) return;
    conveningRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    setLive(null);
    setTurnLive(null);
    try {
      let effectiveBrief = briefMd;
      if (beforeConvene) {
        setNotice("심의 근거(사전 검토 제안)를 준비하는 중...");
        const fresh = await beforeConvene();
        if (fresh) effectiveBrief = fresh;
      }
      const r = await api.post<{ sessionId: string; status: string }>(
        `/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions`,
        {
          committeeKey,
          decisionMode,
          gate,
          ...(targetRef ? { targetRef } : {}),
          ...(effectiveBrief ? { briefMd: effectiveBrief } : {}),
        },
      );
      if (r.data.status === "convening") {
        // Async convene contract (202): the deliberation runs server-side in
        // the background — watch it (poll + live view) until it leaves the
        // convening state, then run the same refresh the synchronous path did.
        await watchConvening(r.data.sessionId, Date.now(), false);
      } else {
        finalizeConvene(r.data.sessionId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "위원회 소집 실패");
    } finally {
      conveningRef.current = false;
      setBusy(false);
    }
  }

  async function advance() {
    if (!transcript || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.post<{ status: string; round?: number }>(
        `/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(transcript.sessionId)}/advance`,
        {},
      );
      setNotice(
        r.data.status === "synthesized"
          ? "의장 종합이 완료되었습니다 — 제안을 확인하세요."
          : `라운드 ${r.data.round ?? ""}가 시작되었습니다.`,
      );
      loadTranscript(transcript.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "세션 진행 실패");
    } finally {
      setBusy(false);
    }
  }

  // Plain-language line for the human-turn / resume API errors; anything else keeps the server message.
  function turnErrorText(err: unknown, fallbackKey: string): string {
    const key = err instanceof ApiError ? turnErrorKey(err.code) : null;
    if (key) return tr(key);
    return err instanceof Error ? err.message : tr(fallbackKey);
  }

  // Turn engine: the ONE resume point is POST .../advance — a failed meeting restarts from the issue where it
  // stopped, a paused one whose human deadline passed records the chair's pass. Afterwards the poll is
  // (re)attached so the live view follows the continuing meeting.
  async function driveTurnMeeting() {
    const sessionId = turnLive?.sessionId;
    if (!sessionId || turnBusy) return;
    setTurnBusy(true);
    setError(null);
    try {
      await api.post(
        `/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(sessionId)}/advance`,
        {},
      );
    } catch (err) {
      setError(turnErrorText(err, `${TURN_I18N}.awaiting.submitFailed`));
      setTurnBusy(false);
      return;
    }
    setTurnBusy(false);
    await attachTurnMeeting(sessionId);
  }

  // Watch a turn meeting again (after a restart, or to open an unfinished one from the history).
  async function attachTurnMeeting(sessionId: string) {
    if (watchRef.current) return;
    setBusy(true);
    try {
      await watchConvening(sessionId, Date.now(), true);
    } finally {
      setBusy(false);
    }
  }

  // The human takes the floor the chair opened. The server resumes the meeting itself after the stored turn.
  async function submitTurnPosition() {
    const sessionId = turnLive?.sessionId;
    if (!sessionId || turnBusy || !position.text.trim()) return;
    setTurnBusy(true);
    setError(null);
    setNotice(null);
    let recorded = false;
    try {
      await api.post(
        `/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(sessionId)}/positions`,
        { positionMd: position.text, recommendation: position.recommendation },
      );
      recorded = true;
      setPosition({ text: "", recommendation: "go" });
      setNotice(tr(`${TURN_I18N}.awaiting.submitted`));
    } catch (err) {
      setError(turnErrorText(err, `${TURN_I18N}.awaiting.submitFailed`));
    } finally {
      setTurnBusy(false);
    }
    if (recorded) await attachTurnMeeting(sessionId); // no-op while the watch is still running
  }

  async function submitPosition() {
    if (!transcript || busy || !position.text.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.post(
        `/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(transcript.sessionId)}/positions`,
        {
          positionMd: position.text,
          recommendation: position.recommendation,
        },
      );
      setPosition({ text: "", recommendation: "go" });
      setNotice("입장이 기록되었습니다.");
      loadTranscript(transcript.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "입장 제출 실패");
    } finally {
      setBusy(false);
    }
  }

  // The human confirm — the identical click path GateDecisionPanel performs,
  // with the committee PROPOSAL pre-filled (override stays free).
  async function confirm() {
    if (!transcript?.evaluation || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.post(`/api/opportunities/${encodeURIComponent(opportunityId)}/gate-decisions`, {
        gate: transcript.evaluation.gate,
        decision: form.decision,
        rationale:
          form.rationale.trim() || `위원회 심의(${committeeKey}) 제안 ${transcript.evaluation.recommendation} 인용`,
        gate_evaluation_id: transcript.evaluation.gateEvaluationId,
        ...(form.decision === "hold"
          ? {
              missing_artifacts: form.missing
                .split(/[\n,]/)
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : {}),
      });
      setForm({ decision: "go", rationale: "", missing: "" });
      setNotice(`결정이 기록되었습니다 (${transcript.evaluation.gate} · ${form.decision.toUpperCase()}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "결정 기록 실패");
    } finally {
      setBusy(false);
    }
  }

  // 회의록 확정 — analyst+ 인간 행위. 세션 목록이 확정 상태를 노출하지 않는
  // 경우가 있어 항상 허용하고, 이미 확정된 경우 서버 409 메시지를 그대로
  // 표면화한다 (정직성 제약 — 성공을 가장하지 않는다).
  const [minutesConfirmed, setMinutesConfirmed] = useState(false);

  async function confirmMinutes() {
    if (!transcript || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.post(
        `/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(transcript.sessionId)}/minutes`,
        { confirm: true },
      );
      setMinutesConfirmed(true);
      setNotice("회의록이 확정되었습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "회의록 확정 실패");
    } finally {
      setBusy(false);
    }
  }

  const dissents: DissentEntry[] = transcript?.evaluation?.dissentJson
    ? (JSON.parse(transcript.evaluation.dissentJson) as DissentEntry[])
    : [];
  const humanText = transcript && transcript.meta.decision_mode !== "agent_team" && !transcript.meta.synthesized;

  // The human statement form of the open floor. It lives inside the meeting window (and keeps its state here,
  // so closing and reopening the window never loses a half-written statement).
  const humanForm = (
    <form
      className="sizing-new-form"
      aria-label={tr(`${TURN_I18N}.awaiting.formLabel`)}
      onSubmit={(e) => {
        e.preventDefault();
        void submitTurnPosition();
      }}
    >
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        {tr(`${TURN_I18N}.awaiting.formHint`)}
      </p>
      <label className="block text-[length:var(--fs-caption)]">
        <span className="block mb-1">{tr(`${TURN_I18N}.awaiting.positionLabel`)}</span>
        <textarea
          value={position.text}
          onChange={(e) => setPosition({ ...position, text: e.target.value })}
          className="sizing-new-input w-full"
          rows={3}
          required
        />
      </label>
      <div className="flex flex-wrap items-end gap-2 mt-2">
        <label className="text-[length:var(--fs-caption)]">
          <span className="block mb-1">{tr(`${TURN_I18N}.awaiting.recommendationLabel`)}</span>
          <select
            value={position.recommendation}
            onChange={(e) =>
              setPosition({ ...position, recommendation: e.target.value as typeof position.recommendation })
            }
            className="sizing-new-input sizing-new-input-sm"
          >
            <option value="go">GO</option>
            <option value="hold">HOLD</option>
            <option value="kill">KILL</option>
          </select>
        </label>
        <button type="submit" className="btn-ghost btn-sm" disabled={turnBusy || !position.text.trim()}>
          {tr(`${TURN_I18N}.awaiting.submit`)}
        </button>
      </div>
    </form>
  );

  // The window shows the live meeting while there is one (or until its finished record arrives), else the
  // finished session's full record. `null` = nothing to show (the window then stays shut).
  const windowLive =
    turnLive ??
    (lastLiveRef.current && transcript?.sessionId !== lastLiveRef.current.sessionId ? lastLiveRef.current : null);
  const windowRecord =
    !windowLive && transcript?.engine === "turns"
      ? {
          turns: transcript.turns ?? [],
          titles: (transcript.agenda ?? []).map((a) => a.title),
          participants: participantsByIssue(transcript.agenda),
        }
      : null;
  const windowProps: Omit<MeetingWindowProps, "focusInput" | "onClose"> | null = windowLive
    ? {
        mode: "live",
        progress: windowLive.progress,
        turns: windowLive.turns,
        titles: windowLive.titles,
        participants: windowLive.participants,
        failureMessage: windowLive.failureMessage,
        canAct,
        humanForm,
        busy: turnBusy,
        onRetry: () => void driveTurnMeeting(),
        onResume: () => void driveTurnMeeting(),
        minutes: null,
        minutesState: null,
      }
    : windowRecord
      ? {
          mode: "record" as const,
          ...windowRecord,
          minutes: minutesRecord.payload,
          minutesState: minutesRecord.state,
        }
      : null;
  const closeMeetingWindow = () => setMeetingWindow(null);

  return (
    <section aria-label="위원회 심의" className="market-section sizing-step">
      <h3 className="sizing-step-title text-[length:var(--fs-body)]">
        <span className="sizing-step-badge">⚖️</span> {committeeLabel} — 위원회 심의
      </h3>
      <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
        에이전트 위원회는 심의하여 <strong>제안</strong>만 남깁니다. 진행·보류·중단 기록은 검토자의 클릭으로만
        이루어집니다 (경계 #2).
      </p>

      {canAct && (
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <label className="text-[length:var(--fs-caption)]">
            <span className="block mb-1">의사결정 모드</span>
            <select
              value={decisionMode}
              onChange={(e) => setDecisionMode(e.target.value as typeof decisionMode)}
              className="sizing-new-input sizing-new-input-sm"
            >
              <option value="agent_team">{tr(DECISION_MODE_LABEL_KEY.agent_team)}</option>
              <option value="hybrid">{tr(DECISION_MODE_LABEL_KEY.hybrid)}</option>
              <option value="human_only">{tr(DECISION_MODE_LABEL_KEY.human_only)}</option>
            </select>
          </label>
          <label className="text-[length:var(--fs-caption)]">
            <span className="block mb-1">진행</span>
            <select
              value={gate}
              onChange={(e) => setGate(e.target.value as typeof gate)}
              className="sizing-new-input sizing-new-input-sm"
            >
              {gates.map((g) => (
                <option key={g} value={g}>
                  {tr(GATE_LABEL_KEY[g] ?? g)}
                </option>
              ))}
            </select>
          </label>
          {headerPrimary ? (
            <PrimaryAction
              label={busy ? "처리 중..." : (conveneLabel ?? "위원회 소집")}
              disabled={busy}
              disabledReason="처리 중입니다 — 완료될 때까지 기다려 주세요."
              onClick={() => void convene()}
            />
          ) : (
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void convene()}>
              {busy ? "처리 중..." : (conveneLabel ?? "위원회 소집")}
            </button>
          )}
        </div>
      )}

      {/* 소집 중 실시간 진행(단계 표시·현재 발언자·끝난 발언) 또는 멈춘 곳 */}
      {live && (
        <CommitteeProgressView
          progress={live.progress}
          positions={live.positions}
          failureMessage={live.failureMessage}
        />
      )}

      {/* Turn engine (ADR-0204, design §16.5): ONE status line + "회의 보기"; the "your turn" alert while a human
          seat has the floor. The transcript, stepper and statement form live in the meeting window below. */}
      {turnLive && (
        <CommitteeTurnProgressView
          progress={turnLive.progress}
          turns={turnLive.turns}
          failureMessage={turnLive.failureMessage}
          canAct={canAct}
          busy={turnBusy}
          onRetry={() => void driveTurnMeeting()}
          onResume={() => void driveTurnMeeting()}
          onOpenWindow={setMeetingWindow}
        />
      )}

      {/* 위원회 소집 이력 — 기본 접힘(사용자 요청, 2026-09-17: 이력은 필요할 때만
          조회). 요약 줄에 건수를 남겨 접힌 상태에서도 이력 존재는 알 수 있다.
          행별 아코디언(2026-09-16)은 유지 — 새로 소집된 세션은 이력이 자동으로
          펼쳐져 행이 곧바로 열린다. */}
      {sessions.length > 0 && (
        <details
          className="mb-3"
          open={historyOpen}
          onToggle={(e) => setHistoryOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="text-[length:var(--fs-caption)] font-semibold cursor-pointer">
            위원회 소집 이력{" "}
            <span className="text-[length:var(--fs-caption)] font-normal text-[color:var(--muted-fg)]">
              {sessions.length}건 — 펼치면 소집 기록과 심의 결과를 볼 수 있습니다
            </span>
          </summary>
          <div className="mt-1">
            {sessions.map((s) => {
              const expanded = expandedSessionId === s.sessionId;
              const rec =
                expanded && transcript?.sessionId === s.sessionId
                  ? (transcript.evaluation?.recommendation ?? null)
                  : null;
              const duration = sessionDurationSeconds(s);
              const durationText =
                duration !== null
                  ? Math.floor(duration / 60) > 0
                    ? tr(`${TURN_I18N}.history.durationMinutesSeconds`, {
                        minutes: Math.floor(duration / 60),
                        seconds: duration % 60,
                      })
                    : tr(`${TURN_I18N}.history.durationSeconds`, { seconds: duration })
                  : null;
              return (
                <button
                  key={s.sessionId}
                  type="button"
                  className="card w-full flex flex-wrap items-center justify-between gap-2 px-3 py-2 mb-1 text-left"
                  aria-expanded={expanded}
                  onClick={() => {
                    if (expanded) {
                      setExpandedSessionId(null);
                      return;
                    }
                    setExpandedSessionId(s.sessionId);
                    loadTranscript(s.sessionId);
                  }}
                >
                  <span className="flex flex-wrap items-center gap-2 text-[length:var(--fs-caption)]">
                    <span className="tabular-nums">{formatDateTime(s.startedAt, locale)}</span>
                    {/* Committee + gate in plain words — never the raw "agent_team · pre_fs" pair. */}
                    <span className="font-semibold">{committeeLabel || committeeKeyLabel(committeeKey)}</span>
                    <span className="text-[color:var(--muted-fg)]">
                      {tr(GATE_LABEL_KEY[s.meta.gate] ?? s.meta.gate)}
                    </span>
                    {durationText && (
                      <span className="text-[color:var(--muted-fg)] tabular-nums">· {durationText}</span>
                    )}
                    {s.engine === "turns" && (
                      <span className="status-chip status-info">{tr(`${TURN_I18N}.history.engineTurns`)}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    {rec && (
                      <span
                        className={`status-chip ${rec === "go" ? "status-green" : rec === "hold" ? "status-amber" : "status-red"}`}
                      >
                        {tr(`${TURN_I18N}.history.proposal`)} {REC_LABEL[rec] ?? rec.toUpperCase()}
                      </span>
                    )}
                    <span className={`status-chip ${s.meta.synthesized ? "status-green" : "status-in-progress"}`}>
                      {s.meta.synthesized ? tr(`${TURN_I18N}.history.proposed`) : tr(`${TURN_I18N}.history.inProgress`)}
                    </span>
                    <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                      {expanded ? "▲" : "▼"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </details>
      )}

      {/* 좌석별 포지션 표는 제거했다(사용자 리포트, 2026-09-16 — 큰 의미 없음).
          심의 결과의 본질은 의장 종합(제안)과 소수 의견 원문이고,
          좌석별 입장은 "입장 원문(라운드별)"에 감사 기록으로 보존된다. */}
      {/* 심의 결과 — 펼친(또는 새로 소집된) 세션만 표시한다. */}
      {transcript && expandedSessionId === transcript.sessionId && (
        <div>
          <p className="text-[length:var(--fs-caption)] font-semibold mb-2">
            심의 결과 — {(() => {
              const s = sessions.find((x) => x.sessionId === transcript.sessionId);
              return s ? `${formatDateTime(s.startedAt)} 소집분` : "세션";
            })()}
          </p>
          {/* 의장 종합(PROPOSAL) + 소수 의견 — 목업 grid2e 두 카드 */}
          {transcript.evaluation && (
            <div className="grid gap-3 md:grid-cols-2 mb-3">
              <div className="card">
                <h4 className="text-[length:var(--fs-body)] font-semibold mb-1">
                  의장 종합 (제안){" "}
                  <span
                    className={`status-chip ${transcript.evaluation.recommendation === "go" ? "status-green" : transcript.evaluation.recommendation === "hold" ? "status-amber" : "status-red"}`}
                  >
                    {REC_LABEL[transcript.evaluation.recommendation] ?? transcript.evaluation.recommendation}
                  </span>
                  {dissents.length > 0 && <span className="status-chip status-red ml-1">거부권 이견 반영</span>}
                </h4>
                <p className="text-[length:var(--fs-caption)] mb-1">
                  {committeeLabel} —{" "}
                  {REC_LABEL[transcript.evaluation.recommendation] ?? transcript.evaluation.recommendation} 제안 (진행{" "}
                  {transcript.evaluation.gate}, {transcript.evaluation.evaluatedBy})
                </p>
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] m-0">
                  근거: {seatScoreSummary(transcript)} · {dissents.length}건 이견{" "}
                  {dissents.length > 0 ? "반영" : "없음"} — 확정은 사람의 진행 기록
                </p>
              </div>
              <div className="card">
                <h4 className="text-[length:var(--fs-body)] font-semibold mb-1">소수 의견 (원문 보존)</h4>
                {dissents.length === 0 ? (
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] m-0">이견 없음</p>
                ) : (
                  dissents.map((d) => (
                    <pre
                      key={d.member_key}
                      className="whitespace-pre-wrap text-[length:var(--fs-caption)] m-0"
                      style={{ fontFamily: "inherit" }}
                    >
                      &quot;{stripMeta(d.position_md)}&quot; — {d.member_key}
                    </pre>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Turn engine: the finished meeting's full record opens in the same meeting window as the live view. */}
          {transcript.engine === "turns" && turnLive?.sessionId !== transcript.sessionId && (
            <div className="flex flex-wrap items-center gap-2 mb-3" data-testid="committee-turn-record">
              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                {tr(`${TURN_I18N}.transcriptTitle`, { count: visibleTurnCount(transcript.turns ?? []) })}
              </span>
              {/* The ONE record entry: opens the meeting window, which shows the minutes v2 body
                  (회의록 / 전체 발언 tabs). The old separate "회의 기록 보기" entry is gone. */}
              <button
                type="button"
                className="btn-ghost btn-sm"
                aria-haspopup="dialog"
                data-testid="committee-open-record"
                onClick={() => void openMinutesRecord()}
              >
                {tr(`${TURN_I18N}.window.openMinutes`)}
              </button>
            </div>
          )}

          {/* 입장 원문 — 라운드별 상세 (감사용 원문 보존, 저장 형식 메타는 걷어냄) */}
          {transcript.engine !== "turns" && (
            <details className="mb-3">
              <summary className="text-[length:var(--fs-caption)] font-semibold cursor-pointer">
                입장 원문 (라운드별)
              </summary>
              {transcript.rounds.map((r) => (
                <div key={r.round} className="mt-2 mb-3">
                  <p className="text-[length:var(--fs-caption)] font-semibold mb-1">라운드 {r.round}</p>
                  {r.positions.map((p) => (
                    <div key={p.positionId} className="mb-2 pl-2 border-l-2" style={{ borderColor: "var(--muted-fg)" }}>
                      <p className="text-[length:var(--fs-caption)] mb-1">
                        <span
                          className={`status-chip ${p.memberType === "human" ? "status-green" : "status-not-started"}`}
                        >
                          {p.memberType === "human" ? "human" : "agent"}
                        </span>{" "}
                        <span className="tabular-nums">{p.memberType === "human" ? p.humanUserId : p.agentKey}</span>
                        {p.confidence !== null && (
                          <span className="text-[color:var(--muted-fg)]"> · 신뢰도 {p.confidence}</span>
                        )}
                      </p>
                      <pre
                        className="whitespace-pre-wrap text-[length:var(--fs-caption)] m-0"
                        style={{ fontFamily: "inherit" }}
                      >
                        {stripMeta(p.positionMd)}
                      </pre>
                    </div>
                  ))}
                </div>
              ))}
            </details>
          )}

          {/* 회의록 — 모달로 보기(포맷된 요약) + 다운로드(원문 markdown) + 확정 */}
          <section className="mt-2 mb-3" aria-label="회의록">
            <p className="text-[length:var(--fs-body)] font-semibold mb-1">회의록</p>
            <span className="actions-row">
              {transcript.engine !== "turns" && (
                <button type="button" className="btn-ghost btn-sm" onClick={() => setMinutesOpen(true)}>
                  회의록 보기
                </button>
              )}
              <a
                className="btn-ghost btn-sm"
                href={`/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(transcript.sessionId)}/minutes`}
                target="_blank"
                rel="noreferrer"
              >
                다운로드 (.md)
              </a>
              {canAct && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={busy || minutesConfirmed}
                  onClick={() => void confirmMinutes()}
                >
                  {minutesConfirmed ? "✓ 확정됨" : "회의록 확정"}
                </button>
              )}
            </span>
          </section>

          {transcript.evaluation ? (
            <div className="mt-3 mb-2">
              {canAct && (
                <form
                  className="sizing-new-form mt-3"
                  aria-label="위원회 제안 확정 (인간 기록)"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void confirm();
                  }}
                >
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                    제안 확정은 인간만 수행합니다 — 의사결정 기록(위원회 제안이 기본값, 변경 가능)과 동일한 경로입니다.
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-[length:var(--fs-caption)]">
                      <span className="block mb-1">결정</span>
                      <select
                        value={form.decision}
                        onChange={(e) => setForm({ ...form, decision: e.target.value as typeof form.decision })}
                        className="sizing-new-input sizing-new-input-sm"
                      >
                        <option value="go">GO</option>
                        <option value="hold">HOLD</option>
                        <option value="kill">KILL</option>
                      </select>
                    </label>
                    <label className="text-[length:var(--fs-caption)] flex-1 min-w-[14rem]">
                      <span className="block mb-1">근거 (비우면 제안 인용)</span>
                      <input
                        value={form.rationale}
                        onChange={(e) => setForm({ ...form, rationale: e.target.value })}
                        className="sizing-new-input w-full"
                      />
                    </label>
                  </div>
                  {form.decision === "hold" && (
                    <label className="block mt-2 text-[length:var(--fs-caption)]">
                      <span className="block mb-1">미완료 산출물 (HOLD 필수)</span>
                      <textarea
                        value={form.missing}
                        onChange={(e) => setForm({ ...form, missing: e.target.value })}
                        className="sizing-new-input w-full"
                        rows={2}
                      />
                    </label>
                  )}
                  <button type="submit" className="btn-ghost btn-sm mt-2" disabled={busy}>
                    결정 기록 (인간 확정)
                  </button>
                </form>
              )}
            </div>
          ) : transcript.engine === "turns" ? (
            // Turn sessions have no manual round advance: an unfinished one is continued through its live view.
            canAct &&
            turnLive?.sessionId !== transcript.sessionId &&
            transcript.status !== "done" && (
              <div className="mt-2">
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => void attachTurnMeeting(transcript.sessionId)}
                >
                  {tr(`${TURN_I18N}.reopen`)}
                </button>
              </div>
            )
          ) : (
            canAct && (
              <div className="mt-2">
                {humanText && (
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                    {transcript.meta.decision_mode === "hybrid"
                      ? "hybrid: 각 라운드에 인간 입장 1건 이상이 필요합니다."
                      : "human_only: 인간 위원 입장을 제출하세요."}
                  </p>
                )}
                {humanText && (
                  <form
                    className="sizing-new-form mb-2"
                    aria-label="인간 위원 입장 제출"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitPosition();
                    }}
                  >
                    <label className="block text-[length:var(--fs-caption)]">
                      <span className="block mb-1">입장 내용</span>
                      <textarea
                        value={position.text}
                        onChange={(e) => setPosition({ ...position, text: e.target.value })}
                        className="sizing-new-input w-full"
                        rows={3}
                        required
                      />
                    </label>
                    <div className="flex flex-wrap items-end gap-2 mt-2">
                      <label className="text-[length:var(--fs-caption)]">
                        <span className="block mb-1">권고</span>
                        <select
                          value={position.recommendation}
                          onChange={(e) =>
                            setPosition({
                              ...position,
                              recommendation: e.target.value as typeof position.recommendation,
                            })
                          }
                          className="sizing-new-input sizing-new-input-sm"
                        >
                          <option value="go">GO</option>
                          <option value="hold">HOLD</option>
                          <option value="kill">KILL</option>
                        </select>
                      </label>
                      <button type="submit" className="btn-ghost btn-sm" disabled={busy || !position.text.trim()}>
                        입장 제출
                      </button>
                    </div>
                  </form>
                )}
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void advance()}>
                  {transcript.rounds.length === 0 ? "라운드 시작" : "다음 라운드 / 의장 종합"}
                </button>
              </div>
            )
          )}
        </div>
      )}

      {notice && (
        <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)]">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">
          {error}
        </p>
      )}
      {minutesOpen && transcript && (
        <MinutesDialog
          opportunityId={opportunityId}
          sessionId={transcript.sessionId}
          committeeLabel={committeeLabel}
          onClose={() => setMinutesOpen(false)}
        />
      )}
      {/* ONE element for both modes: live -> record keeps the same window (focus and scroll are kept). */}
      {meetingWindow && windowProps && (
        <CommitteeMeetingWindow {...windowProps} focusInput={meetingWindow.focusInput} onClose={closeMeetingWindow} />
      )}
    </section>
  );
}
