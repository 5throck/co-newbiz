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
 * Resolve a parsed minutes draft against the session it claims to describe:
 * drops exchanges whose seat never spoke or whose position_ref does not
 * resolve to a session position id, and discussion entries whose issue is not
 * on the agenda. Returns null when the draft does not validate at all —
 * callers fall back to the deterministic minutes.
 */
export function resolveMinutesDraft(
  raw: unknown,
  ctx: { knownSeats: readonly string[]; positionIds: readonly string[]; agendaIds: readonly string[] },
): CommitteeMinutesJson | null {
  const parsed = committeeMinutesSchema.safeParse(raw);
  if (!parsed.success) return null;
  const draft = parsed.data;
  const seats = new Set(ctx.knownSeats);
  const positions = new Set(ctx.positionIds);
  const agenda = new Set(ctx.agendaIds);
  const discussion = draft.discussion
    .filter((d) => agenda.has(d.issue_id))
    .map((d) => ({ ...d, exchanges: d.exchanges.filter((e) => seats.has(e.seat) && positions.has(e.position_ref)) }));
  return { ...draft, discussion };
}
