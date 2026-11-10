// @version 1.0.0
/**
 * ADR-0196 phase B — committee-minutes-schema: the chair minutes draft
 * contract. Fabricated position refs and non-session seats are DROPPED by
 * resolveMinutesDraft, which makes an invented quote impossible to cite.
 */
import { describe, test, expect } from "bun:test";
import { committeeMinutesSchema, resolveMinutesDraft } from "../../app/web-next/lib/committee-minutes-schema.ts";

const VALID_DRAFT = {
  agenda: [
    { id: "I1", title: "수요 전제 신뢰도" },
    { id: "I2", title: "인증 이전 가능성" },
  ],
  discussion: [
    {
      issue_id: "I1",
      exchanges: [
        { seat: "risk-officer", act: "rebut", summary: "프록시 신뢰도 상한 반박", position_ref: "POS-1" },
        { seat: "industry-lead", act: "answer", summary: "산포 근거 제시", position_ref: "POS-2" },
      ],
      resolution: "narrowed",
      resolution_note: "1-hop 재검증 조건부 합의",
    },
  ],
  agreements: [{ text: "데이터 신뢰도 등급 상향 필요", seats: ["risk-officer", "industry-lead"] }],
  open_questions: [
    { text: "2-hop 근거 자료 확보", owner_seat: "market-intelligence-agent", due_hint: "다음 라운드 전" },
  ],
  action_items: [{ text: "프록시 사슬 재검증", owner_seat: "market-intelligence-agent" }],
};

const CTX = {
  knownSeats: ["risk-officer", "industry-lead", "market-intelligence-agent"],
  positionIds: ["POS-1", "POS-2"],
  agendaIds: ["I1", "I2"],
};

describe("committeeMinutesSchema (zod)", () => {
  test("a valid draft parses", () => {
    const r = committeeMinutesSchema.safeParse(VALID_DRAFT);
    expect(r.success).toBe(true);
  });

  test("a non-session seat in exchanges does not fail zod — resolution drops it", () => {
    const r = committeeMinutesSchema.safeParse({
      ...VALID_DRAFT,
      discussion: [
        {
          ...VALID_DRAFT.discussion[0],
          exchanges: [{ seat: "fabricated-colleague", act: "agree", summary: "x", position_ref: "POS-1" }],
        },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe("resolveMinutesDraft — fabrication cannot survive", () => {
  test("a valid draft round-trips", () => {
    const out = resolveMinutesDraft(VALID_DRAFT, CTX);
    expect(out).not.toBeNull();
    expect(out?.discussion).toHaveLength(1);
    expect(out?.discussion[0].exchanges).toHaveLength(2);
    expect(out?.agreements).toHaveLength(1);
  });

  test("an invented position_ref is dropped — the exchange cannot be cited", () => {
    const invented = {
      ...VALID_DRAFT,
      discussion: [
        {
          issue_id: "I1",
          exchanges: [
            { seat: "risk-officer", act: "raised", summary: "존재하지 않는 발언 인용", position_ref: "POS-999" },
            { seat: "risk-officer", act: "rebut", summary: "실제 발언", position_ref: "POS-1" },
          ],
          resolution: "unresolved",
        },
      ],
    };
    const out = resolveMinutesDraft(invented, CTX) as NonNullable<ReturnType<typeof resolveMinutesDraft>>;
    expect(out.discussion[0].exchanges).toHaveLength(1);
    expect(out.discussion[0].exchanges[0].position_ref).toBe("POS-1");
  });

  test("a non-session seat is dropped", () => {
    const out = resolveMinutesDraft(
      {
        ...VALID_DRAFT,
        discussion: [
          {
            issue_id: "I1",
            exchanges: [
              { seat: "ghost-seat", act: "agree", summary: "세션에 없는 좌석", position_ref: "POS-1" },
              { seat: "industry-lead", act: "agree", summary: "실제 좌석", position_ref: "POS-2" },
            ],
            resolution: "agreed",
          },
        ],
      },
      CTX,
    ) as NonNullable<ReturnType<typeof resolveMinutesDraft>>;
    expect(out.discussion[0].exchanges.map((e) => e.seat)).toEqual(["industry-lead"]);
  });

  test("a discussion entry off the agenda is dropped", () => {
    const out = resolveMinutesDraft(
      { ...VALID_DRAFT, discussion: [{ ...VALID_DRAFT.discussion[0], issue_id: "I7" }] },
      CTX,
    ) as NonNullable<ReturnType<typeof resolveMinutesDraft>>;
    expect(out.discussion).toHaveLength(0);
  });

  test("an invalid schema (missing fields, bad act) returns null — caller falls back", () => {
    expect(resolveMinutesDraft({ agenda: "nope" }, CTX)).toBeNull();
  });

  test("model shape drift is repaired, not fatal: a bad act normalizes to 'raised', a non-seat owner moves to owner_role, and a structurally garbage draft still returns null", () => {
    const out = resolveMinutesDraft(
      {
        ...VALID_DRAFT,
        discussion: [
          {
            issue_id: "I1",
            exchanges: [{ seat: "risk-officer", act: "shout", summary: "x", position_ref: "POS-1" }],
            resolution: "agreed",
          },
        ],
        open_questions: [{ text: "q", owner_seat: "법무·규제 확인" }],
        action_items: [{ text: "a", owner_seat: ["risk-officer", "ir-agent"] }],
      },
      CTX,
    ) as NonNullable<ReturnType<typeof resolveMinutesDraft>>;
    expect(out.discussion[0].exchanges[0]?.act).toBe("raised");
    expect(out.open_questions[0]?.owner_seat).toBeUndefined();
    expect(out.open_questions[0]?.owner_role).toBe("법무·규제 확인");
    expect(out.action_items[0]?.owner_seat).toBeUndefined();
    expect(out.action_items[0]?.owner_role).toBe("risk-officer, ir-agent");
    // structurally garbage input (non-object agenda) is still rejected outright
    expect(resolveMinutesDraft({ ...VALID_DRAFT, agenda: "nope" }, CTX)).toBeNull();
  });
});
