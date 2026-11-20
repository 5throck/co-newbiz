"use client";

// CommitteeSessionRowSummary — the ONE history-row look of a committee meeting, shared by every
// surface that lists sessions (CommitteePanel's "위원회 소집 이력", the S4 결정 tab's "위원회 심의 이력").
//
//   left   convened date + time (HH:mm) · committee display name · gate label · duration · 대화형 badge
//   right  proposal chip (GO / HOLD / KILL, when the caller knows it) · 제안됨 / 진행 중 chip · trailing
//
// Plain words only — never the raw status ("done"), decision mode ("agent_team") or gate id ("pre_fs").
// The wrapper (a toggle button, a list item) is the caller's; this renders the two spans inside it.
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { formatDateTimeHm } from "../lib/format.ts";
import { GATE_LABEL_KEY } from "../lib/label-keys.ts";
import { committeeKeyLabel, type SessionHistoryRow, sessionDurationSeconds } from "../lib/committee-progress-view.ts";

const T = "common.committee.turns";

const REC_LABEL: Record<string, string> = { go: "GO", hold: "HOLD", kill: "KILL" };

export function CommitteeSessionRowSummary({
  session,
  committeeLabel,
  rec = null,
  trailing,
}: {
  session: SessionHistoryRow;
  /** The committee's display name; empty falls back to a readable form of the registry key. */
  committeeLabel: string;
  /** The chair's proposal (go | hold | kill), when known. */
  rec?: string | null;
  trailing?: ReactNode;
}) {
  const tr = useTranslations();
  const locale = useLocale();
  const gate = session.meta?.gate;
  const duration = sessionDurationSeconds(session);
  const durationText =
    duration !== null
      ? Math.floor(duration / 60) > 0
        ? tr(`${T}.history.durationMinutesSeconds`, { minutes: Math.floor(duration / 60), seconds: duration % 60 })
        : tr(`${T}.history.durationSeconds`, { seconds: duration })
      : null;
  const name = committeeLabel || committeeKeyLabel(session.meta?.committee_key ?? "");
  return (
    <>
      <span className="flex flex-wrap items-center gap-2 text-[length:var(--fs-caption)]">
        <span className="tabular-nums">{formatDateTimeHm(session.startedAt, locale)}</span>
        {name && <span className="font-semibold">{name}</span>}
        {gate && <span className="text-[color:var(--muted-fg)]">{tr(GATE_LABEL_KEY[gate] ?? gate)}</span>}
        {durationText && <span className="text-[color:var(--muted-fg)] tabular-nums">· {durationText}</span>}
        {session.engine === "turns" && (
          <span className="status-chip status-info">{tr(`${T}.history.engineTurns`)}</span>
        )}
      </span>
      <span className="flex items-center gap-1">
        {rec && (
          <span
            className={`status-chip ${rec === "go" ? "status-green" : rec === "hold" ? "status-amber" : "status-red"}`}
          >
            {tr(`${T}.history.proposal`)} {REC_LABEL[rec] ?? rec.toUpperCase()}
          </span>
        )}
        <span className={`status-chip ${session.meta?.synthesized ? "status-green" : "status-in-progress"}`}>
          {session.meta?.synthesized ? tr(`${T}.history.proposed`) : tr(`${T}.history.inProgress`)}
        </span>
        {trailing}
      </span>
    </>
  );
}
