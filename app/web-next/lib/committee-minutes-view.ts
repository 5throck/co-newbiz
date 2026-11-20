// committee-minutes-view — client-safe view helpers for the turn-meeting minutes v2 (ADR-0204 phase 3
// UI, design 2026-11-20 §4.6). Type-only imports of the backend zod schema (erased at build) keep
// the wire types in one place; the render component consumes the helpers below.
//
//   * minutesJsonOf      — the v2 JSON of a minutes GET payload (null unless version 2);
//   * minutesHasBodyTabs — the meeting window shows the 회의록 / 전체 발언 tabs only for v2;
//   * tallyOf            — a close row's counts with 불참 kept visible (never folded into abstain);
//   * chairSummaryLines  — the history row's chair-synthesis lines, built from display names (never
//                          the raw gate / agent keys) through the catalog.
import type { TranslatorFn } from "../i18n/config.ts";
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
  /**
   * NOT sent by the API today — the v2 JSON lives at `minutesDraft.json` (`minutesVersion` 2). Kept
   * optional so a future top-level field (or a test fixture) is honored; `minutesJsonOf` prefers it.
   */
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

/** Structural guard for a v2 minutes JSON (the backend zod schema is not imported client-side). */
function isV2Shape(json: unknown): json is CommitteeMinutesV2Json {
  if (typeof json !== "object" || json === null) return false;
  const j = json as { version?: unknown; issues?: unknown; overview?: unknown };
  return j.version === 2 && Array.isArray(j.issues) && typeof j.overview === "object" && j.overview !== null;
}

/**
 * The v2 minutes JSON of the payload; null unless the draft is version 2. The API serves it at
 * `minutesDraft.json` (there is no top-level `minutes` field); a top-level `minutes` wins when present.
 */
export function minutesJsonOf(
  p:
    | (Pick<MinutesJsonPayload, "minutesVersion"> & Partial<Pick<MinutesJsonPayload, "minutes" | "minutesDraft">>)
    | null
    | undefined,
): CommitteeMinutesV2Json | null {
  if (p?.minutesVersion !== 2) return null;
  if (isV2Shape(p.minutes)) return p.minutes;
  const fromDraft = p.minutesDraft?.json;
  return isV2Shape(fromDraft) ? fromDraft : null;
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

/**
 * The two chair-synthesis lines of an expanded history row. Every identifier arrives already
 * resolved to a display name (committee label, gate label, chair seat name) — the raw gate id
 * ("pre_fs") and agent key never reach the text.
 */
export function chairSummaryLines(
  tr: TranslatorFn,
  a: {
    committee: string;
    rec: string;
    gate: string;
    chair: string;
    /** Average seat score, or null when no scored positions exist. */
    scoreAvg: number | null;
    dissentCount: number;
  },
): { proposal: string; basis: string } {
  const scores =
    a.scoreAvg !== null
      ? tr("common.committee.turns.history.scoreAverage", { avg: a.scoreAvg })
      : tr("common.committee.turns.history.scoreNone");
  const dissent =
    a.dissentCount > 0
      ? tr("common.committee.turns.history.dissentCount", { count: a.dissentCount })
      : tr("common.committee.turns.history.dissentNone");
  return {
    proposal: tr("common.committee.turns.history.proposalLine", {
      committee: a.committee,
      rec: a.rec,
      gate: a.gate,
      chair: a.chair,
    }),
    basis: tr("common.committee.turns.history.basisLine", { scores, dissent }),
  };
}
