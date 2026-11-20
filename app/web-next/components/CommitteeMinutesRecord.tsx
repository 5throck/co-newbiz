"use client";

// CommitteeMinutesRecord — the shared "open the minutes of a finished meeting" entry for surfaces
// that do not own a CommitteePanel's state (the S4 결정 tab's 위원회 심의 이력, …).
//
// Fetches the minutes payload, then:
//   * minutes v2 (turn meeting)  → the meeting window in record mode: 회의록 / 전체 발언 tabs,
//                                  the transcript read from GET .../committee-sessions/{id};
//   * anything else (v1 draft, round engine) → the legacy MinutesDialog.
// While loading / on failure the window itself says so. Same window as CommitteePanel's "회의록 보기".
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { MinutesJsonPayload } from "../lib/committee-minutes-view.ts";
import { participantsByIssue, type TurnView } from "../lib/committee-progress-view.ts";
import { CommitteeMeetingWindow } from "./CommitteeMeetingWindow.tsx";
import { MinutesDialog } from "./CommitteeMinutesView.tsx";

interface RecordTranscript {
  engine?: "rounds" | "turns";
  turns?: TurnView[];
  agenda?: Array<{ title: string; participants?: unknown }> | null;
}

type RecordState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "legacy" }
  | { phase: "v2"; payload: MinutesJsonPayload; transcript: RecordTranscript };

/** GET an endpoint and unwrap the standard { data } envelope. */
async function getData<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T } | T;
  return "data" in (body as object) && (body as { data?: T }).data !== undefined
    ? ((body as { data: T }).data as T)
    : (body as T);
}

export function CommitteeMinutesRecord({
  opportunityId,
  sessionId,
  committeeLabel,
  onClose,
  sessionsApiBase,
}: {
  /** Opportunity-scoped sessions (the default scope). */
  opportunityId?: string;
  /** Project-scoped sessions (e.g. the IC package): the `.../committee-sessions` base URL, overriding the opportunity one. */
  sessionsApiBase?: string;
  sessionId: string;
  committeeLabel: string;
  onClose: () => void;
}) {
  const tr = useTranslations();
  const [state, setState] = useState<RecordState>({ phase: "loading" });
  useEffect(() => {
    let alive = true;
    setState({ phase: "loading" });
    const root = sessionsApiBase ?? `/api/opportunities/${encodeURIComponent(opportunityId ?? "")}/committee-sessions`;
    const base = `${root}/${encodeURIComponent(sessionId)}`;
    (async () => {
      try {
        const payload = await getData<MinutesJsonPayload>(`${base}/minutes?format=json`);
        if (payload.minutesVersion !== 2) {
          if (alive) setState({ phase: "legacy" });
          return;
        }
        const transcript = await getData<RecordTranscript>(base);
        if (alive) setState({ phase: "v2", payload, transcript });
      } catch {
        if (alive) setState({ phase: "error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [opportunityId, sessionId, sessionsApiBase]);

  if (state.phase === "legacy") {
    return (
      <MinutesDialog
        opportunityId={opportunityId ?? ""}
        sessionsApiBase={sessionsApiBase}
        sessionId={sessionId}
        committeeLabel={committeeLabel || tr("common.committeeMinutes.title")}
        onClose={onClose}
      />
    );
  }
  const record = state.phase === "v2" ? state.transcript : null;
  return (
    <CommitteeMeetingWindow
      mode="record"
      turns={record?.turns ?? []}
      titles={(record?.agenda ?? []).map((a) => a.title)}
      participants={participantsByIssue(record?.agenda)}
      minutes={state.phase === "v2" ? state.payload : null}
      minutesState={state.phase === "v2" ? "loaded" : state.phase === "error" ? "error" : "loading"}
      onClose={onClose}
    />
  );
}
