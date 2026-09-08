/**
 * committee-llm — position-meta parser tests (no network: the LLM call itself
 * is exercised only through the honest-degradation path with a stubbed
 * complete()).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { parsePositionMeta, makeLlmCommitteeAgent } from "../../app/web-next/lib/committee-llm.ts";

describe("parsePositionMeta", () => {
  test("parses a well-formed tail and strips it from the position", () => {
    const text = '### [역량] greenfield-agent\n\n찬성 입장.\n\n<!--position-meta:{"recommendation":"go","confidence":85,"veto_dissent":false}-->';
    const r = parsePositionMeta(text);
    expect(r).not.toBeNull();
    expect(r!.recommendation).toBe("go");
    expect(r!.confidence).toBe(85);
    expect(r!.vetoDissent).toBeUndefined();
    expect(r!.positionMd).not.toContain("position-meta");
    expect(r!.positionMd).toContain("greenfield-agent");
  });

  test("veto dissent round-trips as true", () => {
    const r = parsePositionMeta('x\n<!--position-meta:{"recommendation":"kill","confidence":90,"veto_dissent":true}-->');
    expect(r!.recommendation).toBe("kill");
    expect(r!.vetoDissent).toBe(true);
  });

  test("invalid recommendation / broken JSON → null (no fabricated verdict)", () => {
    expect(parsePositionMeta('a\n<!--position-meta:{"recommendation":"maybe"}-->')).toBeNull();
    expect(parsePositionMeta('a\n<!--position-meta:{broken}-->')).toBeNull();
    expect(parsePositionMeta("no tail at all")).toBeNull();
  });

  test("confidence is clamped to 0..100", () => {
    const r = parsePositionMeta('a\n<!--position-meta:{"recommendation":"hold","confidence":250}-->');
    expect(r!.confidence).toBe(100);
  });
});

describe("makeLlmCommitteeAgent degradation", () => {
  const origFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = origFetch as typeof fetch; });

  test("LLM failure → explicit degraded position, no verdict fields", async () => {
    globalThis.fetch = (async () => { throw new Error("boom"); }) as unknown as typeof fetch;
    const agent = makeLlmCommitteeAgent();
    const r = await agent("risk-officer", "안건: 진출 방식");
    expect(r.positionMd).toContain("degraded");
    expect(r.recommendation).toBeUndefined();
    expect(r.confidence).toBeUndefined();
  });
});
