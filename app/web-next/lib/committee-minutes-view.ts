// committee-minutes-view — client-safe view helpers for the turn-meeting minutes v2 (ADR-0204 phase 3
// UI, design 2026-11-20 §4.6). Type-only imports of the backend zod schema (erased at build) keep
// the wire types in one place; the render component consumes the helpers below.
//
//   * minutesJsonOf      — the v2 JSON of a minutes GET payload (null unless version 2);
//   * minutesHasBodyTabs — the meeting window shows the 회의록 / 전체 발언 tabs only for v2;
//   * tallyOf            — a close row's counts with 불참 kept visible (never folded into abstain).
import type { CommitteeMinutesV2Json, MinutesV2Issue } from "./committee-minutes-schema.ts";

/** The ?format=json payload of GET .../minutes — v1 fields plus the v2 turn-meeting record. */
export interface MinutesJsonPayload {
  sessionId: string;
  status: string;
  committeeKey: string | null;
  gate: string | null;
  decisionMode: string | null;
  track: string | null;
  agenda: Array<{ id: string; title: string }> | null;
  agendaMeta?: { source: string; model?: string | null } | null;
  minutesDraft: {
    json: unknown;
    fallback: boolean;
    prompt_version?: string | null;
    created_at?: string | null;
  } | null;
  /** 2 = turn-meeting minutes v2, 1 = round-engine (or pre-v2 turn) draft, null = none stored. */
  minutesVersion: 1 | 2 | null;
  engine?: "rounds" | "turns" | null;
  /** The stored v2 minutes JSON (turn engine); absent/null on v1 sessions. */
  minutes?: CommitteeMinutesV2Json | null;
  /** Appendix A (full transcript) / B (abandoned attempts) from the stored rows; null on v1. */
  appendix?: {
    transcript: Array<{
      turnId: string;
      seq: number;
      attempt: number;
      issueIndex: number;
      speakerName: string;
      move: string;
      utterance: string;
      line: string;
    }>;
    abandoned: Array<{ attempt: number; turns: unknown[] }>;
  } | null;
  minutesConfirmed: { by: string; at: string } | null;
  recommendation: string | null;
  dissentJson: string | Array<{ member_key: string; position_md: string }> | null;
  degradedResolutions?: number | null;
}

/** The v2 minutes JSON of the payload; null unless the draft is version 2. */
export function minutesJsonOf(p: Pick<MinutesJsonPayload, "minutes" | "minutesVersion"> | null | undefined) {
  return p?.minutesVersion === 2 ? (p.minutes ?? null) : null;
}

/** The meeting window offers the 회의록 / 전체 발언 tabs only for a v2 minutes record. */
export function minutesHasBodyTabs(p: Pick<MinutesJsonPayload, "minutesVersion"> | null | undefined): boolean {
  return p?.minutesVersion === 2;
}

/** A close row's tally, 불참 kept as its own number (never folded into 기권). */
export function tallyOf(issue: MinutesV2Issue): {
  accept: number;
  reserve: number;
  abstain: number;
  notParticipating: number;
} {
  const t = issue.tally;
  return {
    accept: t.accept,
    reserve: t.reserve,
    abstain: t.abstain,
    notParticipating: t.not_participating ?? 0,
  };
}

/** Verbatim dissent entries of the payload (string form parsed; failures degrade to none). */
export function parseMinutesDissent(
  dissentJson: MinutesJsonPayload["dissentJson"],
): Array<{ member_key: string; position_md: string }> {
  if (!dissentJson) return [];
  if (Array.isArray(dissentJson)) return dissentJson;
  try {
    const parsed = JSON.parse(dissentJson) as unknown;
    return Array.isArray(parsed) ? (parsed as Array<{ member_key: string; position_md: string }>) : [];
  } catch {
    return [];
  }
}
