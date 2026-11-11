// 프롬프트 레지스트리 무결성 — SSOT(prompts.json)와 생성물(prompts.generated.ts)의
// 정합성, 에이전트 키 유효성, 프롬프트 최소 품질을 기계적으로 지킨다.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROMPTS, type PromptKey } from "../../app/web-next/lib/prompts.generated.ts";
import { AGENT_REGISTRY } from "../../app/web-next/lib/agent-registry.generated.ts";
import { promptAgent, promptSystem, systemMessage } from "../../app/web-next/lib/prompts.ts";

const SSOT = JSON.parse(readFileSync(join(import.meta.dir, "../../app/web-next/prompts/prompts.json"), "utf-8")) as {
  prompts: Array<{ key: string; agent: string | null; purpose: string; system: string }>;
};

describe("prompt registry", () => {
  test("generated module is in sync with prompts.json SSOT", () => {
    expect(Object.keys(PROMPTS).sort()).toEqual(SSOT.prompts.map((p) => p.key).sort());
    for (const p of SSOT.prompts) {
      expect(PROMPTS[p.key as PromptKey]).toEqual({ key: p.key, agent: p.agent, purpose: p.purpose, system: p.system });
    }
  });

  test("every entry has non-empty key, purpose, system, and unique keys", () => {
    const keys = SSOT.prompts.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of SSOT.prompts) {
      expect(p.purpose.length).toBeGreaterThan(0);
      expect(p.system.length).toBeGreaterThan(0);
    }
  });

  test("static agent keys exist in the agents/ roster", () => {
    const roster = new Set(AGENT_REGISTRY.map((a) => a.key));
    for (const p of SSOT.prompts) {
      if (p.agent !== null) expect(roster.has(p.agent)).toBeTrue();
    }
  });

  test("promptAgent rejects runtime-agent entries without an override key", () => {
    const dyn = SSOT.prompts.find((p) => p.agent === null);
    expect(dyn).toBeDefined();
    expect(() => promptAgent(dyn!.key as PromptKey)).toThrow();
    expect(promptAgent(dyn!.key as PromptKey, { key: "risk-officer" }).key).toBe("risk-officer");
  });

  test("promptAgent keeps the SSOT purpose and allows purpose override", () => {
    expect(promptAgent("s2.discover").purpose).toBe(PROMPTS["s2.discover"].purpose);
    expect(promptAgent("s1.sizing_summarize", { purpose: "S1 시장규모 단계 요약 — 테스트" }).purpose).toContain(
      "테스트",
    );
  });

  test("systemMessage returns the exact SSOT text", () => {
    for (const p of SSOT.prompts) {
      expect(systemMessage(p.key as PromptKey)).toEqual({ role: "system", content: p.system });
      expect(promptSystem(p.key as PromptKey)).toBe(p.system);
    }
  });

  test("s6.universe_criteria_draft output schema carries the viability field (DEC-20261111-05)", () => {
    const s6 = SSOT.prompts.find((p) => p.key === "s6.universe_criteria_draft");
    if (!s6) throw new Error("s6.universe_criteria_draft missing from prompts.json");
    expect(s6.system).toContain('{"criteria":{"industry":"","region":"","size":"","viability":"","rationale":""}}');
  });
});
