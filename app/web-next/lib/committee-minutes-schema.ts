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

function normalizeMinutesDraft(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const draft = { ...(raw as Record<string, unknown>) };
  const resolutions = Array.isArray(draft.resolutions) ? (draft.resolutions as Array<Record<string, unknown>>) : [];
  const byIssue = new Map(
    resolutions.filter((r) => typeof r.issue_id === "string").map((r) => [r.issue_id as string, r]),
  );
  delete draft.resolutions;
  if (Array.isArray(draft.discussion)) {
    draft.discussion = (draft.discussion as Array<Record<string, unknown>>).map((d) => {
      if (d.resolution === undefined) {
        const r = byIssue.get(d.issue_id as string);
        if (r?.resolution !== undefined) d.resolution = r.resolution;
        else d.resolution = "unresolved";
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
  return draft;
}

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
  const parsed = committeeMinutesSchema.safeParse(normalizeMinutesDraft(raw));
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
