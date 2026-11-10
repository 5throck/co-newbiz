// @version 1.1.0
/**
 * ADR-0196 phase B — committee-minutes-schema: the chair minutes draft
 * contract. Fabricated position refs and non-session seats are DROPPED by
 * resolveMinutesDraft, which makes an invented quote impossible to cite.
 *
 * Amendment 2026-11-10 (design §8.6, supplement F): resolveMinutesDraft
 * returns { draft, degraded } — degraded counts the discussion items whose
 * resolution was SILENTLY FILLED by the "unresolved" default, so the tolerant
 * repair becomes visible (persisted as minutes_draft.degraded_resolutions).
 * §8.5: the generated committee.minutes prompt carries the decision rule
 * (recorded dissent never makes an issue unresolved) — asserted here as a
 * codegen snapshot.
 */
import { describe, test, expect } from "bun:test";
import { committeeMinutesSchema, resolveMinutesDraft } from "../../app/web-next/lib/committee-minutes-schema.ts";
import { PROMPTS } from "../../app/web-next/lib/prompts.generated.ts";

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
    expect(out.draft).not.toBeNull();
    expect(out.draft?.discussion).toHaveLength(1);
    expect(out.draft?.discussion[0].exchanges).toHaveLength(2);
    expect(out.draft?.agreements).toHaveLength(1);
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
    const out = resolveMinutesDraft(invented, CTX);
    expect(out.draft?.discussion[0].exchanges).toHaveLength(1);
    expect(out.draft?.discussion[0].exchanges[0].position_ref).toBe("POS-1");
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
    );
    expect(out.draft?.discussion[0].exchanges.map((e) => e.seat)).toEqual(["industry-lead"]);
  });

  test("a discussion entry off the agenda is dropped", () => {
    const out = resolveMinutesDraft(
      { ...VALID_DRAFT, discussion: [{ ...VALID_DRAFT.discussion[0], issue_id: "I7" }] },
      CTX,
    );
    expect(out.draft?.discussion).toHaveLength(0);
  });

  test("an invalid schema (missing fields, bad act) returns a null draft — caller falls back", () => {
    expect(resolveMinutesDraft({ agenda: "nope" }, CTX).draft).toBeNull();
  });

  test("model shape drift is repaired, not fatal: a bad act normalizes to 'raised', a non-seat owner moves to owner_role, and a structurally garbage draft still returns a null draft", () => {
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
    );
    expect(out.draft?.discussion[0].exchanges[0]?.act).toBe("raised");
    expect(out.draft?.open_questions[0]?.owner_seat).toBeUndefined();
    expect(out.draft?.open_questions[0]?.owner_role).toBe("법무·규제 확인");
    expect(out.draft?.action_items[0]?.owner_seat).toBeUndefined();
    expect(out.draft?.action_items[0]?.owner_role).toBe("risk-officer, ir-agent");
    // structurally garbage input (non-object agenda) is still rejected outright
    expect(resolveMinutesDraft({ ...VALID_DRAFT, agenda: "nope" }, CTX).draft).toBeNull();
  });
});

describe("resolveMinutesDraft — degraded resolution count (design §8.6, supplement F)", () => {
  test("two items missing resolution with NO top-level resolutions → degraded: 2, both filled 'unresolved'", () => {
    const out = resolveMinutesDraft(
      {
        ...VALID_DRAFT,
        discussion: [
          { issue_id: "I1", exchanges: [{ seat: "risk-officer", act: "raised", summary: "s", position_ref: "POS-1" }] },
          { issue_id: "I2", exchanges: [] },
        ],
      },
      CTX,
    );
    expect(out.draft).not.toBeNull();
    expect(out.degraded).toBe(2);
    expect(out.draft?.discussion.every((d) => d.resolution === "unresolved")).toBe(true);
  });

  test("a fully-formed draft (every item carries its resolution) → degraded: 0", () => {
    const out = resolveMinutesDraft(VALID_DRAFT, CTX);
    expect(out.draft).not.toBeNull();
    expect(out.degraded).toBe(0);
  });

  test("the top-level resolutions array is an authored-content repair — mapping from it is NOT degraded", () => {
    const out = resolveMinutesDraft(
      {
        ...VALID_DRAFT,
        discussion: [
          { issue_id: "I1", exchanges: [{ seat: "risk-officer", act: "raised", summary: "s", position_ref: "POS-1" }] },
        ],
        resolutions: [{ issue_id: "I1", resolution: "narrowed", note: "상위 배열에서 기재한 결론" }],
      },
      CTX,
    );
    expect(out.draft).not.toBeNull();
    expect(out.draft?.discussion[0].resolution).toBe("narrowed");
    expect(out.draft?.discussion[0].resolution_note).toBe("상위 배열에서 기재한 결론");
    expect(out.degraded).toBe(0);
  });

  test("a top-level resolutions entry WITHOUT a resolution still counts as silently filled", () => {
    const out = resolveMinutesDraft(
      {
        ...VALID_DRAFT,
        discussion: [
          { issue_id: "I1", exchanges: [{ seat: "risk-officer", act: "raised", summary: "s", position_ref: "POS-1" }] },
        ],
        resolutions: [{ issue_id: "I1", note: "결론 없는 메모" }],
      },
      CTX,
    );
    expect(out.draft?.discussion[0].resolution).toBe("unresolved");
    expect(out.degraded).toBe(1);
  });

  test("a silently filled item dropped by the agenda filter is NOT counted — the chip matches the stored draft", () => {
    const out = resolveMinutesDraft(
      {
        ...VALID_DRAFT,
        discussion: [
          { issue_id: "I1", exchanges: [] }, // on agenda, silently filled → counted
          { issue_id: "I9", exchanges: [] }, // off agenda → dropped entirely
        ],
      },
      CTX,
    );
    expect(out.draft?.discussion).toHaveLength(1);
    expect(out.degraded).toBe(1);
  });

  test("a draft that does not validate at all → { draft: null, degraded: 0 }", () => {
    const out = resolveMinutesDraft(
      {
        ...VALID_DRAFT,
        discussion: [
          { issue_id: "I1", exchanges: [{ seat: "risk-officer", act: "raised", summary: "s", position_ref: "POS-1" }] },
          { issue_id: "I2", exchanges: [] },
          { issue_id: "I3", exchanges: [] },
          { issue_id: "I4", exchanges: [] },
          { issue_id: "I5", exchanges: [] },
          { issue_id: "I6", exchanges: [] },
          { issue_id: "I7", exchanges: [] },
          { issue_id: "I8", exchanges: [] },
          { issue_id: "I9", exchanges: [] }, // 9 items — over the zod max of 8
        ],
      },
      CTX,
    );
    expect(out.draft).toBeNull();
    expect(out.degraded).toBe(0);
  });
});

describe("resolveMinutesDraft — dissent ≠ unresolved (schema layer never overrides, §8.5)", () => {
  test("authored 'agreed' with a rebut exchange stays 'agreed' — the normalizer only fills when MISSING", () => {
    // The red-team seat structurally rebuts (D5); convergence semantics are
    // the chair's call. The schema layer must NEVER rewrite an authored
    // resolution because an exchange happens to contain a rebut.
    const out = resolveMinutesDraft(
      {
        ...VALID_DRAFT,
        discussion: [
          {
            issue_id: "I1",
            exchanges: [
              { seat: "risk-officer", act: "rebut", summary: "반박하나 입장은 수렴", position_ref: "POS-1" },
              { seat: "industry-lead", act: "agree", summary: "조건부 동의", position_ref: "POS-2" },
            ],
            resolution: "agreed",
            resolution_note: "반박을 근거로 반영해 수렴 — 근거: S1 CAGR 18% 수치 합치",
          },
        ],
      },
      CTX,
    );
    expect(out.draft?.discussion[0].resolution).toBe("agreed");
    expect(out.degraded).toBe(0);
  });

  test("authored 'narrowed' with a dissent-carrying exchange stays 'narrowed'", () => {
    const out = resolveMinutesDraft(
      {
        ...VALID_DRAFT,
        discussion: [
          {
            issue_id: "I1",
            exchanges: [{ seat: "risk-officer", act: "rebut", summary: "이의 유지", position_ref: "POS-1" }],
            resolution: "narrowed",
          },
        ],
      },
      CTX,
    );
    expect(out.draft?.discussion[0].resolution).toBe("narrowed");
    expect(out.degraded).toBe(0);
  });
});

describe("committee.minutes prompt — decision rule present (codegen snapshot, §8.5)", () => {
  const system = PROMPTS["committee.minutes"].system;

  test("the # Task section carries the convergence decision rule", () => {
    expect(system).toContain(
      "Apply this decision rule for `resolution`: agreed = the seats' positions converged and no rebuttal remains outstanding",
    );
    expect(system).toContain("narrowed = partial convergence, or the issue's scope was reduced to what is settled");
    expect(system).toContain("unresolved only when the rounds were exhausted without convergence");
  });

  test("recorded dissent never makes an issue unresolved (dissent orthogonality)", () => {
    expect(system).toContain("A recorded dissent never makes an issue unresolved");
    expect(system).toContain("dissent is preserved verbatim in dissent_json and does not affect convergence");
  });

  test("every unresolved binds an owner-carrying open question; resolution_note cites deal evidence", () => {
    expect(system).toContain(
      "Every `unresolved` issue must be paired with an open question that names an owner (`owner_seat` or `owner_role`)",
    );
    expect(system).toContain(
      "Each `resolution_note` must cite the deal evidence it rests on from the material (figures, scores, or stated positions), never a generic restatement",
    );
  });

  test("the # Output contract line matches the rule; the 5-section skeleton is unchanged", () => {
    expect(system).toContain("a recorded dissent never forces unresolved");
    // No undeclared headings — the machine bar's closed vocabulary.
    const headings = system
      .split("\n")
      .filter((l) => /^#\s+\S/.test(l))
      .map((l) => l.trim());
    expect(headings).toEqual([
      "# Evidence boundary",
      "# Task",
      "# Output contract",
      "# Language",
      "# Proposal-only disclaimer",
    ]);
  });
});
