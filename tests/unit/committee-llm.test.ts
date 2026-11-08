/**
 * committee-llm — position-meta parser tests (no network: the LLM call itself
 * is exercised only through the honest-degradation path with a stubbed
 * complete()).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { parsePositionMeta, makeLlmCommitteeAgent } from "../../app/web-next/lib/committee-llm.ts";

describe("parsePositionMeta", () => {
  test("parses a well-formed tail and strips it from the position", () => {
    const text =
      '### [역량] greenfield-agent\n\n찬성 입장.\n\n<!--position-meta:{"recommendation":"go","confidence":85,"veto_dissent":false}-->';
    const r = parsePositionMeta(text);
    expect(r).not.toBeNull();
    expect(r!.recommendation).toBe("go");
    expect(r!.confidence).toBe(85);
    expect(r!.vetoDissent).toBeUndefined();
    expect(r!.positionMd).not.toContain("position-meta");
    expect(r!.positionMd).toContain("greenfield-agent");
  });

  test("veto dissent round-trips as true", () => {
    const r = parsePositionMeta(
      'x\n<!--position-meta:{"recommendation":"kill","confidence":90,"veto_dissent":true}-->',
    );
    expect(r!.recommendation).toBe("kill");
    expect(r!.vetoDissent).toBe(true);
  });

  test("invalid recommendation / broken JSON → null (no fabricated verdict)", () => {
    expect(parsePositionMeta('a\n<!--position-meta:{"recommendation":"maybe"}-->')).toBeNull();
    expect(parsePositionMeta("a\n<!--position-meta:{broken}-->")).toBeNull();
    expect(parsePositionMeta("no tail at all")).toBeNull();
  });

  test("confidence is clamped to 0..100", () => {
    const r = parsePositionMeta('a\n<!--position-meta:{"recommendation":"hold","confidence":250}-->');
    expect(r!.confidence).toBe(100);
  });
});

describe("parsePositionMeta — ADR-0196 allowlisted fields", () => {
  const tail = (o: unknown) => `### x\n\n본문\n<!--position-meta:${JSON.stringify(o)}-->`;

  test("legacy tails (no ADR-0196 fields) yield none of them", () => {
    const r = parsePositionMeta(tail({ recommendation: "go", confidence: 70 }))!;
    expect(r.respondsTo).toBeUndefined();
    expect(r.stanceChanged).toBeUndefined();
    expect(r.issues).toBeUndefined();
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
    )!;
    expect(r.recommendation).toBe("hold");
    expect(r.criteriaScores).toEqual({ control_need: 2, speed_to_capability: 3 });
    expect(r.respondsTo).toEqual([
      { seat: "risk-officer", act: "rebut", issue: "I2" },
      { seat: "legal-counsel", act: "ask" },
    ]);
    expect(r.stanceChanged).toBe(true);
    expect(r.issues).toEqual(["I1", "I2"]);
    expect(r.positionMd).not.toContain("position-meta");
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
    )!;
    expect(r.respondsTo).toEqual([
      { seat: "legal-counsel", act: "agree" },
      { seat: "ip-agent", act: "ask", issue: "I3" },
    ]);
    expect(r.stanceChanged).toBeUndefined();
    expect(r.issues).toEqual(["I1", "I99"]);
  });

  test("knownSeats drops entries naming a seat outside the session", () => {
    const text = tail({
      recommendation: "go",
      responds_to: [
        { seat: "risk-officer", act: "agree" },
        { seat: "ghost-seat", act: "rebut" },
      ],
    });
    expect(parsePositionMeta(text)!.respondsTo).toHaveLength(2);
    expect(parsePositionMeta(text, { knownSeats: ["risk-officer"] })!.respondsTo).toEqual([
      { seat: "risk-officer", act: "agree" },
    ]);
  });

  test("non-array responds_to / issues are ignored; arrays are capped", () => {
    const r = parsePositionMeta(
      tail({ recommendation: "go", responds_to: { seat: "a", act: "agree" }, issues: "I1" }),
    )!;
    expect(r.respondsTo).toBeUndefined();
    expect(r.issues).toBeUndefined();
    const many = Array.from({ length: 20 }, (_, i) => ({ seat: `seat-${i}`, act: "agree" }));
    expect(parsePositionMeta(tail({ recommendation: "go", responds_to: many }))!.respondsTo).toHaveLength(8);
  });

  test("an unparseable tail still returns null (no fabricated verdict)", () => {
    expect(parsePositionMeta('x\n<!--position-meta:{"responds_to":[{broken}]}-->')).toBeNull();
  });
});

describe("makeLlmCommitteeAgent degradation", () => {
  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch as typeof fetch;
  });

  test("LLM failure → explicit degraded position, no verdict fields", async () => {
    globalThis.fetch = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const agent = makeLlmCommitteeAgent();
    const r = await agent("risk-officer", "안건: 진출 방식");
    expect(r.positionMd).toContain("degraded");
    expect(r.recommendation).toBeUndefined();
    expect(r.confidence).toBeUndefined();
  });
});
