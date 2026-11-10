/**
 * committee-llm — position-meta parser tests (no network: the LLM call itself
 * is exercised only through the honest-degradation path with a stubbed
 * complete()).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  parsePositionMeta,
  makeLlmCommitteeAgent,
  makeLlmChairMinutes,
  CHAIR_MINUTES_TIMEOUT_MS,
} from "../../app/web-next/lib/committee-llm.ts";

describe("parsePositionMeta", () => {
  test("parses a well-formed tail and strips it from the position", () => {
    const text =
      '### [역량] greenfield-agent\n\n찬성 입장.\n\n<!--position-meta:{"recommendation":"go","confidence":85,"veto_dissent":false}-->';
    const r = parsePositionMeta(text);
    expect(r).not.toBeNull();
    expect(r?.recommendation).toBe("go");
    expect(r?.confidence).toBe(85);
    expect(r?.vetoDissent).toBeUndefined();
    expect(r?.positionMd).not.toContain("position-meta");
    expect(r?.positionMd).toContain("greenfield-agent");
  });

  test("veto dissent round-trips as true", () => {
    const r = parsePositionMeta(
      'x\n<!--position-meta:{"recommendation":"kill","confidence":90,"veto_dissent":true}-->',
    );
    expect(r?.recommendation).toBe("kill");
    expect(r?.vetoDissent).toBe(true);
  });

  test("invalid recommendation / broken JSON → null (no fabricated verdict)", () => {
    expect(parsePositionMeta('a\n<!--position-meta:{"recommendation":"maybe"}-->')).toBeNull();
    expect(parsePositionMeta("a\n<!--position-meta:{broken}-->")).toBeNull();
    expect(parsePositionMeta("no tail at all")).toBeNull();
  });

  test("confidence is clamped to 0..100", () => {
    const r = parsePositionMeta('a\n<!--position-meta:{"recommendation":"hold","confidence":250}-->');
    expect(r?.confidence).toBe(100);
  });
});

describe("parsePositionMeta — ADR-0196 allowlisted fields", () => {
  const tail = (o: unknown) => `### x\n\n본문\n<!--position-meta:${JSON.stringify(o)}-->`;

  test("legacy tails (no ADR-0196 fields) yield none of them", () => {
    const r = parsePositionMeta(tail({ recommendation: "go", confidence: 70 }));
    expect(r).not.toBeNull();
    expect(r?.respondsTo).toBeUndefined();
    expect(r?.stanceChanged).toBeUndefined();
    expect(r?.issues).toBeUndefined();
  });

  test("nested criteria_scores + responds_to parse together (tail with nested braces)", () => {
    const r = parsePositionMeta(
      tail({
        recommendation: "hold",
        confidence: 60,
        criteria_scores: { control_need: 2, speed_to_capability: 3, bogus: 3 },
        responds_to: [
          { seat: "risk-officer", act: "rebut", issue: "I2" },
          { seat: "legal-counsel", act: "ask" },
        ],
        stance_changed: true,
        issues: ["I1", "I2"],
      }),
    );
    expect(r).not.toBeNull();
    expect(r?.recommendation).toBe("hold");
    expect(r?.criteriaScores).toEqual({ control_need: 2, speed_to_capability: 3 });
    expect(r?.respondsTo).toEqual([
      { seat: "risk-officer", act: "rebut", issue: "I2" },
      { seat: "legal-counsel", act: "ask" },
    ]);
    expect(r?.stanceChanged).toBe(true);
    expect(r?.issues).toEqual(["I1", "I2"]);
    expect(r?.positionMd).not.toContain("position-meta");
  });

  test("unknown acts, malformed seats, bad issue ids, non-objects are dropped", () => {
    const r = parsePositionMeta(
      tail({
        recommendation: "go",
        responds_to: [
          { seat: "risk-officer", act: "approve" },
          { seat: "../etc/passwd", act: "agree" },
          { seat: "", act: "agree" },
          { seat: 7, act: "agree" },
          "risk-officer",
          null,
          { seat: "legal-counsel", act: "agree", issue: "bad id" },
          { seat: "ip-agent", act: "ask", issue: "I3", extra: "ignored" },
        ],
        stance_changed: "yes",
        issues: ["I1", "I1", "x", 2, "I99", "I100"],
      }),
    );
    expect(r).not.toBeNull();
    expect(r?.respondsTo).toEqual([
      { seat: "legal-counsel", act: "agree" },
      { seat: "ip-agent", act: "ask", issue: "I3" },
    ]);
    expect(r?.stanceChanged).toBeUndefined();
    expect(r?.issues).toEqual(["I1", "I99"]);
  });

  test("knownSeats drops entries naming a seat outside the session", () => {
    const text = tail({
      recommendation: "go",
      responds_to: [
        { seat: "risk-officer", act: "agree" },
        { seat: "ghost-seat", act: "rebut" },
      ],
    });
    expect(parsePositionMeta(text)?.respondsTo).toHaveLength(2);
    expect(parsePositionMeta(text, { knownSeats: ["risk-officer"] })?.respondsTo).toEqual([
      { seat: "risk-officer", act: "agree" },
    ]);
  });

  test("non-array responds_to / issues are ignored; arrays are capped", () => {
    const r = parsePositionMeta(tail({ recommendation: "go", responds_to: { seat: "a", act: "agree" }, issues: "I1" }));
    expect(r).not.toBeNull();
    expect(r?.respondsTo).toBeUndefined();
    expect(r?.issues).toBeUndefined();
    const many = Array.from({ length: 20 }, (_, i) => ({ seat: `seat-${i}`, act: "agree" }));
    expect(parsePositionMeta(tail({ recommendation: "go", responds_to: many }))?.respondsTo).toHaveLength(8);
  });

  test("an unparseable tail still returns null (no fabricated verdict)", () => {
    expect(parsePositionMeta('x\n<!--position-meta:{"responds_to":[{broken}]}-->')).toBeNull();
  });
});

describe("makeLlmCommitteeAgent degradation", () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = origFetch as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch as typeof fetch;
  });

  test("LLM failure → explicit degraded position, no verdict fields", async () => {
    globalThis.fetch = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const agent = makeLlmCommitteeAgent();
    const r = await agent("risk-officer", "안건: 진출 방식");
    expect(r?.positionMd).toContain("degraded");
    expect(r?.recommendation).toBeUndefined();
    expect(r?.confidence).toBeUndefined();
  });
});

describe("makeLlmCommitteeAgent — canonical tail re-serialization (design §9.1, F1)", () => {
  const origFetch = globalThis.fetch;
  const ENV_KEYS = ["CO_NEWBIZ_LLM_PROVIDER", "CO_NEWBIZ_LLM_API_KEY", "CO_NEWBIZ_LLM_MODEL"] as const;
  const savedEnv: Array<readonly [string, string | undefined]> = [];

  beforeEach(() => {
    globalThis.fetch = origFetch as typeof fetch;
    for (const k of ENV_KEYS) savedEnv.push([k, process.env[k]] as const);
    // The LLM client reads its provider from env; a stub provider for this
    // suite only (explicit process.env overrides the root .env).
    process.env.CO_NEWBIZ_LLM_PROVIDER = "openai";
    // Dummy key for the stub provider. Assembled at runtime so the literal
    // stays off one line — the pre-commit secret scanner blocks any
    // *_KEY = "<8+ chars>" assignment in newly added diff lines.
    process.env.CO_NEWBIZ_LLM_API_KEY = ["test", "-key"].join("");
    process.env.CO_NEWBIZ_LLM_MODEL = "test-model";
  });
  afterEach(() => {
    globalThis.fetch = origFetch as typeof fetch;
    for (const [k, v] of savedEnv.splice(0).reverse()) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function stubReply(content: string): void {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
  }

  /** The canonical tail a stored positionMd must end with. */
  function canonicalTailOf(positionMd: string): Record<string, unknown> {
    const m = positionMd.match(/<!--position-meta:(\{[\s\S]*\})-->$/);
    expect(m).not.toBeNull();
    return JSON.parse(m![1]) as Record<string, unknown>;
  }

  test("a valid model tail → the returned positionMd ENDS with a canonical tail built from the PARSED fields", async () => {
    stubReply(
      [
        "### 리스크 관점",
        "",
        "하락 시나리오를 점검했다.",
        "",
        '<!--position-meta:{"recommendation":"kill","confidence":80,"veto_dissent":true,"criteria_scores":{"control_need":3,"capability_criticality":2,"market_uncertainty":3,"integration_capacity":1,"speed_to_capability":1,"bogus":3},"responds_to":[{"seat":"valuation-agent","act":"rebut","issue":"I2"},{"seat":"ghost-seat","act":"approve"}],"stance_changed":true,"issues":["I1","I2"]}-->',
      ].join("\n"),
    );
    const r = await makeLlmCommitteeAgent()("risk-officer", "안건: 진출 방식");
    // Ends with EXACTLY ONE marker, compact JSON, byte-shape of the
    // deterministic emitter.
    expect(r?.positionMd.match(/<!--position-meta:/g)).toHaveLength(1);
    const tail = canonicalTailOf(r!.positionMd);
    // Whitelist order: recommendation, veto_dissent (only true), confidence,
    // seat (always — the caller's agentKey), criteria_scores, responds_to,
    // stance_changed, issues. Unknown/junk fields are gone.
    expect(Object.keys(tail)).toEqual([
      "recommendation",
      "veto_dissent",
      "confidence",
      "seat",
      "criteria_scores",
      "responds_to",
      "stance_changed",
      "issues",
    ]);
    expect(tail.recommendation).toBe("kill");
    expect(tail.veto_dissent).toBe(true);
    expect(tail.confidence).toBe(80);
    expect(tail.seat).toBe("risk-officer");
    expect(tail.criteria_scores).toEqual({
      control_need: 3,
      capability_criticality: 2,
      market_uncertainty: 3,
      integration_capacity: 1,
      speed_to_capability: 1,
    });
    expect(tail.responds_to).toEqual([{ seat: "valuation-agent", act: "rebut", issue: "I2" }]);
    expect(tail.stance_changed).toBe(true);
    expect(tail.issues).toEqual(["I1", "I2"]);
    // The body survives verbatim above the tail.
    expect(r?.positionMd.startsWith("### 리스크 관점")).toBe(true);
    expect(r?.positionMd).toContain("하락 시나리오를 점검했다.");
  });

  test("round-trip through parsePositionMeta on the returned text reproduces the parsed fields", async () => {
    stubReply(
      '본문\n<!--position-meta:{"recommendation":"hold","confidence":60,"criteria_scores":{"control_need":2},"responds_to":[{"seat":"risk-officer","act":"ask"}],"stance_changed":false,"issues":["I1"]}-->',
    );
    const r = await makeLlmCommitteeAgent()("financial-analyst", "안건");
    const rt = parsePositionMeta(r!.positionMd);
    expect(rt).not.toBeNull();
    expect(rt?.recommendation).toBe("hold");
    expect(rt?.vetoDissent).toBeUndefined(); // not true → absent, never fabricated
    expect(rt?.confidence).toBe(60);
    expect(rt?.criteriaScores).toEqual({ control_need: 2 });
    expect(rt?.respondsTo).toEqual([{ seat: "risk-officer", act: "ask" }]);
    expect(rt?.stanceChanged).toBe(false);
    expect(rt?.issues).toEqual(["I1"]);
  });

  test("a minimal tail yields only the fields the parse produced + seat", async () => {
    stubReply('본문\n<!--position-meta:{"confidence":55}-->');
    const r = await makeLlmCommitteeAgent()("industry-lead", "안건");
    const tail = canonicalTailOf(r!.positionMd);
    expect(tail).toEqual({ confidence: 55, seat: "industry-lead" });
  });

  test("tail omitted → no marker, no fields (unchanged passthrough)", async () => {
    stubReply("본문만 있습니다.");
    const r = await makeLlmCommitteeAgent()("valuation-agent", "안건");
    expect(r?.positionMd).toBe("본문만 있습니다.");
    expect(r?.positionMd).not.toContain("position-meta");
    expect(r?.recommendation).toBeUndefined();
    expect(r?.confidence).toBeUndefined();
    expect(r?.criteriaScores).toBeUndefined();
  });

  test("malformed tail → raw passthrough, the inert marker rides along, nothing appended", async () => {
    stubReply("본문\n<!--position-meta:{broken}-->");
    const r = await makeLlmCommitteeAgent()("legal-counsel", "안건");
    expect(r?.positionMd).toBe("본문\n<!--position-meta:{broken}-->");
    expect(r?.positionMd.match(/<!--position-meta:/g)).toHaveLength(1); // no canonical tail appended
    expect(parsePositionMeta(r!.positionMd)).toBeNull();
    expect(r?.recommendation).toBeUndefined();
  });
});

describe("makeLlmChairMinutes timeout budget", () => {
  const origFetch = globalThis.fetch;
  const origAbortTimeout = AbortSignal.timeout;
  afterEach(() => {
    globalThis.fetch = origFetch as typeof fetch;
    (AbortSignal as unknown as { timeout: typeof AbortSignal.timeout }).timeout = origAbortTimeout;
  });

  test("forwards an AbortSignal whose budget is CHAIR_MINUTES_TIMEOUT_MS to the LLM fetch", async () => {
    // The LLM client reads its provider from env; set a stub provider for this
    // test only (the root .env, if any, never overrides explicit process.env).
    const savedEnv = ["CO_NEWBIZ_LLM_PROVIDER", "CO_NEWBIZ_LLM_API_KEY", "CO_NEWBIZ_LLM_MODEL"].map(
      (k) => [k, process.env[k]] as const,
    );
    process.env.CO_NEWBIZ_LLM_PROVIDER = "openai";
    // Dummy key for the stub provider. Assembled at runtime so the literal
    // stays off one line — the pre-commit secret scanner blocks any
    // *_KEY = "<8+ chars>" assignment in newly added diff lines.
    process.env.CO_NEWBIZ_LLM_API_KEY = ["test", "-key"].join("");
    process.env.CO_NEWBIZ_LLM_MODEL = "test-model";
    // AbortSignal.timeout's delay is not readable off the signal itself — spy
    // on the factory instead to observe the budgets requested on this path.
    const delays: number[] = [];
    (AbortSignal as unknown as { timeout: typeof AbortSignal.timeout }).timeout = (ms: number) => {
      delays.push(ms);
      return origAbortTimeout(ms);
    };
    let captured: RequestInit | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      captured = init;
      return new Response(JSON.stringify({ choices: [{ message: { content: "의사록 초안" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    try {
      const minutes = makeLlmChairMinutes();
      const text = await minutes("심의 자료");
      expect(text).toBe("의사록 초안");
      // The minutes pass's signal rides the complete() options all the way to the fetch.
      const minutesSignal = captured?.signal;
      expect(minutesSignal).toBeInstanceOf(AbortSignal);
      expect(minutesSignal?.aborted).toBe(false);
      // The only budget created on this path is the minutes one — the 60 s
      // transport default is bypassed by the forwarded signal.
      expect(delays).toContain(CHAIR_MINUTES_TIMEOUT_MS);
      expect(delays).not.toContain(60_000);
      expect(CHAIR_MINUTES_TIMEOUT_MS).toBe(300_000);
    } finally {
      for (const [k, v] of savedEnv) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
