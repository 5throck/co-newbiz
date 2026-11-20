// committee-minutes-schema — the chair minutes pass output contract
// (ADR-0196 §2.3, phase B). The minutes pass returns ONE JSON object in the
// snake_case shape stored verbatim in process_run.meta_json.minutes_draft.
//
// Hard rules enforced HERE, in code, after parsing — never left to the model:
//   * every `position_ref` must resolve to an agent_position.id in the same
//     session; exchanges with unresolved refs are DROPPED (a fabricated quote
//     is impossible to cite);
//   * every `seat` must be a seat that actually spoke in the session;
//   * discussion `issue_id`s must exist in the stored agenda;
//   * there is NO recommendation field and NO dissent field — the renderer
//     takes the recommendation from gate_evaluation and dissent from
//     dissent_json verbatim (ADR-0096 §6); the schema below simply has no
//     place for them.
import { z } from "zod";

export const MINUTES_ACTS = ["raised", "agree", "rebut", "ask", "answer"] as const;
export const MINUTES_RESOLUTIONS = ["agreed", "narrowed", "unresolved"] as const;

const seatKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const issueId = z.string().regex(/^I\d{1,2}$/);

export const minutesExchangeSchema = z.object({
  seat: seatKey,
  act: z.enum(MINUTES_ACTS),
  summary: z.string().min(1),
  position_ref: z.string().min(1),
});

export const minutesDiscussionSchema = z.object({
  issue_id: issueId,
  exchanges: z.array(minutesExchangeSchema).max(40),
  resolution: z.enum(MINUTES_RESOLUTIONS),
  resolution_note: z.string().optional(),
});

export const minutesAgreementSchema = z.object({
  text: z.string().min(1),
  seats: z.array(seatKey).max(20),
});

export const minutesOpenQuestionSchema = z.object({
  text: z.string().min(1),
  owner_seat: seatKey.optional(),
  owner_role: z.string().max(64).optional(),
  due_hint: z.string().max(64).optional(),
});

export const minutesActionItemSchema = z.object({
  text: z.string().min(1),
  owner_seat: seatKey.optional(),
  owner_role: z.string().max(64).optional(),
});

/** The stored / rendered minutes JSON — zod-validated, ref-resolved. */
export const committeeMinutesSchema = z.object({
  agenda: z.array(z.object({ id: issueId, title: z.string().min(1) })).max(8),
  discussion: z.array(minutesDiscussionSchema).max(8),
  agreements: z.array(minutesAgreementSchema).max(20),
  open_questions: z.array(minutesOpenQuestionSchema).max(20),
  action_items: z.array(minutesActionItemSchema).max(20),
});

export type MinutesExchange = z.infer<typeof minutesExchangeSchema>;
export type MinutesDiscussion = z.infer<typeof minutesDiscussionSchema>;
export type CommitteeMinutesJson = z.infer<typeof committeeMinutesSchema>;

/**
 * Tolerant pre-normalization for model output that deviates from the stored
 * shape in the ways models actually deviate: a separate top-level `resolutions`
 * array instead of the per-item `resolution` field, items missing `resolution`
 * altogether, owner fields that name a Korean role or a seat ARRAY instead of
 * one seat key, and exchanges whose `act` drifts off the closed vocabulary.
 * Shape is repaired, never content: ref-resolution below still drops every
 * exchange whose seat/ref does not resolve to the session. Unknown keys are
 * dropped by zod.
 */
function isSeatKey(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v);
}

function sanitizeOwner(record: Record<string, unknown>, key = "owner_seat"): void {
  const v = record[key];
  if (v === undefined) return;
  if (isSeatKey(v)) return;
  // A non-seat owner (Korean role name, array of seats/roles) belongs in
  // owner_role, which is free-text; owner_seat stays unset (optional).
  delete record[key];
  const label = Array.isArray(v) ? v.filter((x) => typeof x === "string").join(", ") : typeof v === "string" ? v : "";
  if (label && record.owner_role === undefined) record.owner_role = label.slice(0, 64);
}

/** Internal normalization result: the repaired draft plus the INDEXES (within
 * the discussion array) of items whose resolution was SILENTLY FILLED by the
 * "unresolved" default (no per-item resolution AND no top-level resolutions
 * entry carried one). The top-level resolutions-array mapping path is an
 * authored-content repair and is never counted. Indexes — not a bare count —
 * because the agenda filter below drops off-agenda items, and the visible
 * count must match the stored draft. Design §8.6 (supplement F). */
interface NormalizedDraft {
  draft: unknown;
  degradedIndexes: Set<number>;
}

function normalizeMinutesDraft(raw: unknown): NormalizedDraft {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { draft: raw, degradedIndexes: new Set() };
  const draft = { ...(raw as Record<string, unknown>) };
  const degradedIndexes = new Set<number>();
  const resolutions = Array.isArray(draft.resolutions) ? (draft.resolutions as Array<Record<string, unknown>>) : [];
  const byIssue = new Map(
    resolutions.filter((r) => typeof r.issue_id === "string").map((r) => [r.issue_id as string, r]),
  );
  delete draft.resolutions;
  if (Array.isArray(draft.discussion)) {
    draft.discussion = (draft.discussion as Array<Record<string, unknown>>).map((d, idx) => {
      if (d.resolution === undefined) {
        const r = byIssue.get(d.issue_id as string);
        if (r?.resolution !== undefined) d.resolution = r.resolution;
        else {
          d.resolution = "unresolved";
          degradedIndexes.add(idx);
        }
      }
      if (d.resolution_note === undefined && byIssue.get(d.issue_id as string)?.note !== undefined)
        d.resolution_note = byIssue.get(d.issue_id as string)?.note;
      if (Array.isArray(d.exchanges)) {
        d.exchanges = (d.exchanges as Array<Record<string, unknown>>).filter((e) => isSeatKey(e.seat));
        for (const e of d.exchanges as Array<Record<string, unknown>>)
          if (e.act !== undefined && !MINUTES_ACTS.includes(e.act as (typeof MINUTES_ACTS)[number])) e.act = "raised";
      }
      return d;
    });
  }
  for (const listKey of ["agreements", "open_questions", "action_items"] as const) {
    if (!Array.isArray(draft[listKey])) continue;
    draft[listKey] = (draft[listKey] as Array<Record<string, unknown>>).map((item) => {
      if (listKey === "agreements" && Array.isArray(item.seats)) item.seats = item.seats.filter((s) => isSeatKey(s));
      else sanitizeOwner(item);
      return item;
    });
  }
  return { draft, degradedIndexes };
}

/** The result of resolving a minutes draft: the ref-checked draft (null when
 * it does not validate at all — callers fall back to the deterministic
 * minutes) plus the count of discussion items in the RESULTING draft whose
 * resolution was silently filled by the "unresolved" default. The tolerant
 * repair is kept (§8.12); the repair becomes visible through this count,
 * persisted as the minutes_draft.degraded_resolutions sibling meta key. */
export interface ResolvedMinutesDraft {
  draft: CommitteeMinutesJson | null;
  degraded: number;
}

/**
 * Resolve a parsed minutes draft against the session it claims to describe:
 * drops exchanges whose seat never spoke or whose position_ref does not
 * resolve to a session position id, and discussion entries whose issue is not
 * on the agenda. Returns { draft: null, degraded: 0 } when the draft does not
 * validate at all — callers fall back to the deterministic minutes.
 */
export function resolveMinutesDraft(
  raw: unknown,
  ctx: { knownSeats: readonly string[]; positionIds: readonly string[]; agendaIds: readonly string[] },
): ResolvedMinutesDraft {
  const normalized = normalizeMinutesDraft(raw);
  const parsed = committeeMinutesSchema.safeParse(normalized.draft);
  if (!parsed.success) return { draft: null, degraded: 0 };
  const draft = parsed.data;
  const seats = new Set(ctx.knownSeats);
  const positions = new Set(ctx.positionIds);
  const agenda = new Set(ctx.agendaIds);
  const kept: number[] = [];
  const discussion = draft.discussion
    .filter((d, idx) => {
      if (agenda.has(d.issue_id)) {
        kept.push(idx);
        return true;
      }
      return false;
    })
    .map((d) => ({ ...d, exchanges: d.exchanges.filter((e) => seats.has(e.seat) && positions.has(e.position_ref)) }));
  // Count only the fills that survive into the stored draft — a silently
  // filled item dropped by the agenda filter must not inflate the chip.
  const degraded = [...normalized.degradedIndexes].filter((idx) => kept.includes(idx)).length;
  return { draft: { ...draft, discussion }, degraded };
}

// ── Minutes v2 (ADR-0204 phase 3, design 2026-11-20 §4.6 / §13 Q7 / §15.2) ─────
//
// The stored shape of a turn-engine meeting's minutes. UNLIKE v1 almost every
// field is assembled by CODE from the stored turn rows (participants, consensus
// proposal, votes, outcome, tally, per-seat recommendation, sittings). The chair
// model only SELECTS which turns go in the short per-issue excerpt (and may cut
// a turn down to verbatim fragments) and lists open items. The full transcript
// is NOT stored here: appendix A / B are rebuilt from agent_position at read
// time (deterministic, never LLM text).
//
// Hard rules (enforced in committee-minutes-v2.ts, never left to the model):
//   * every excerpt `turn_id` resolves to a live (non-abandoned) speech turn of
//     the same issue in the same session;
//   * every `quote` is made of verbatim fragments of that turn's utterance;
//   * there is NO recommendation field and NO dissent field — the renderer reads
//     the recommendation from gate_evaluation and dissent from dissent_json
//     verbatim (ADR-0096 §6), exactly as for v1.

export const MINUTES_V2_VERSION = 2 as const;

const seatName = z.object({ seat: z.string().min(1), name: z.string().min(1) });

export const minutesV2ExcerptSchema = z.object({
  turn_id: z.string().min(1),
  seq: z.number().int().min(1),
  speaker_seat: z.string().min(1),
  /** Display name (never an agent key); the chair is "의장". */
  speaker_name: z.string().min(1),
  role: z.enum(["seat", "chair", "human"]),
  move: z.string().min(1),
  addressed_name: z.string().min(1).optional(),
  /** Verbatim words of the turn: the whole utterance, or fragments joined by " … ". */
  quote: z.string().min(1),
  /** True when the quote is the whole utterance. */
  quote_full: z.boolean(),
  /** True when the model's quote was not verbatim and the whole utterance was used instead. */
  quote_repaired: z.boolean().optional(),
});

export const minutesV2VoteSchema = z.object({
  seat: z.string().min(1),
  name: z.string().min(1),
  vote: z.enum(["accept", "reserve", "no_response"]),
  /** The voter's own words (verbatim), when stored. */
  reason: z.string().optional(),
});

export const minutesV2IssueSchema = z.object({
  issue_id: issueId,
  title: z.string().min(1),
  participants: z.array(seatName.extend({ reason: z.string() })).max(40),
  /** Seats that spoke on the issue on the chair's grant without being listed participants. */
  guests: z.array(seatName).max(40),
  /** Seats that sat the issue out — never counted as accept. */
  sat_out: z.array(seatName).max(40),
  excerpt: z.array(minutesV2ExcerptSchema).max(8),
  excerpt_source: z.enum(["llm", "fallback"]),
  consensus: z
    .object({
      turn_id: z.string().min(1),
      proposal: z.string().min(1),
      rests_on_turns: z.array(z.string()).max(40),
    })
    .nullable(),
  votes: z.array(minutesV2VoteSchema).max(40),
  outcome: z.enum(MINUTES_RESOLUTIONS),
  /** close row reason: budget | consensus_failed | ... */
  outcome_reason: z.string().optional(),
  tally: z.object({
    accept: z.number().int().min(0),
    reserve: z.number().int().min(0),
    abstain: z.number().int().min(0),
    not_participating: z.number().int().min(0),
  }),
  seat_recommendations: z
    .array(
      seatName.extend({
        recommendation: z.enum(["go", "hold", "kill"]),
        veto_dissent: z.boolean().optional(),
      }),
    )
    .max(40),
});

export const minutesV2OpenItemSchema = z.object({
  text: z.string().min(1),
  owner_seat: seatKey.optional(),
  owner_name: z.string().optional(),
  issue_id: issueId.optional(),
});

export const committeeMinutesV2Schema = z.object({
  version: z.literal(MINUTES_V2_VERSION),
  overview: z.object({
    kind: z.literal("ai_committee_meeting"),
    engine: z.literal("turns"),
    held_at: z.string().min(1),
    chair_seat: z.string().min(1),
    seats: z.array(seatName).max(40),
    /** Seats that took no part in any issue (reported, never counted as accept). */
    not_participating: z.array(seatName).max(40),
    human_participants: z.array(z.object({ user_id: z.string().min(1), seat: z.string().min(1) })).max(40),
    /** One entry per sitting; more than one means the meeting was restarted (§15.2). */
    sittings: z
      .array(
        z.object({
          attempt: z.number().int().min(1),
          started_at: z.string().optional(),
          ended_at: z.string().optional(),
          closed_issue_ids: z.array(issueId).max(8),
        }),
      )
      .min(1)
      .max(20),
  }),
  issues: z.array(minutesV2IssueSchema).max(8),
  open_items: z.array(minutesV2OpenItemSchema).max(20),
  provenance: z.object({
    /** How the excerpts / open items were chosen. */
    source: z.enum(["llm", "fallback", "mixed"]),
    fallback_issue_ids: z.array(issueId).max(8),
    /** Model references dropped because they did not resolve (logged, never silent). */
    rejected_refs: z.number().int().min(0),
    /** Model quotes that were not verbatim and were replaced by the whole utterance. */
    repaired_quotes: z.number().int().min(0),
    notes: z.array(z.string()).max(20),
  }),
});

export type MinutesV2Excerpt = z.infer<typeof minutesV2ExcerptSchema>;
export type MinutesV2Issue = z.infer<typeof minutesV2IssueSchema>;
export type CommitteeMinutesV2Json = z.infer<typeof committeeMinutesV2Schema>;

/** Any stored minutes JSON: v1 (round engine; no `version` key) or v2 (turn engine). */
export type AnyMinutesJson = CommitteeMinutesJson | CommitteeMinutesV2Json;

/** True for a v2 minutes JSON. A stored draft without `version` is v1. */
export function isMinutesV2(json: unknown): json is CommitteeMinutesV2Json {
  return typeof json === "object" && json !== null && (json as { version?: unknown }).version === MINUTES_V2_VERSION;
}

/** The raw model output of the v2 minutes pass (before reference resolution). */
export const minutesV2LlmOutputSchema = z.object({
  issues: z
    .array(
      z.object({
        issue_id: issueId,
        excerpt: z
          .array(
            z.object({
              turn: z.union([z.number(), z.string()]),
              quote: z.string().optional(),
            }),
          )
          .max(12),
      }),
    )
    .max(8),
  open_items: z
    .array(
      z.object({
        text: z.string().min(1),
        owner_seat: z.string().optional(),
        issue_id: z.string().optional(),
      }),
    )
    .max(20)
    .optional(),
});
export type MinutesV2LlmOutput = z.infer<typeof minutesV2LlmOutputSchema>;
