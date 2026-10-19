// s9.dd_tailor executor의 한국어 강제 규칙 (2026-10-19 decider report:
// "산업 맞춤 제안이 영어로 작성"). The label is the visible one-liner — a Korean
// industry name inside an English sentence does NOT pass, and TWO repair retries
// are attempted before the tailor fails loudly (the person retries).
import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";

const EN = JSON.stringify([
  { item_label: "Assess revenue concentration on the top-3 customers", rationale: "Customer concentration is a common blind spot." },
  { item_label: "Benchmark pricing power across the last downturn", rationale: "Pricing power needs a benchmark." },
]);
const KO = JSON.stringify([
  { item_label: "상위 3개 고객 매출 집중도를 계약서 기준으로 검증", rationale: "고객 집중도는 일반 항목이 놓치는 사각지대입니다." },
  { item_label: "경기 침체기 벤치마크로 가격 전가력을 검증", rationale: "가격 전가력에는 산업 벤치마크가 필요합니다." },
]);

describe("makeLlmDdTailorExecutor Korean enforcement", () => {
  const resets: Array<() => void> = [];
  afterEach(() => { for (const r of resets.splice(0)) r(); });

  async function setup(replies: string[]) {
    let call = 0;
    const seen: string[] = [];
    const mod = await import("../../app/web-next/lib/llm.ts");
    const mod2 = await import("../../app/web-next/lib/prompts.ts");
    resets.push(() => mock.restore());
    mock.module("../../app/web-next/lib/llm.ts", () => ({
      ...mod,
      isLlmConfigured: () => true,
      complete: async (_messages: unknown, _opts: unknown) => {
        const reply = replies[Math.min(call, replies.length - 1)];
        seen.push(reply);
        call += 1;
        return reply;
      },
    }));
    mod2; // promptAgent reads the real registry — no mock needed
    const { makeLlmDdTailorExecutor } = await import("../../app/web-next/lib/llm-executors.ts");
    return {
      run: () => makeLlmDdTailorExecutor()("commercial", { projectId: "p", industry: "휴머노이드 로봇" }),
      seen,
    };
  }

  test("an English-only first pass is repaired once into Korean", async () => {
    const { run, seen } = await setup([EN, KO]);
    const drafts = await run();
    expect(seen.length).toBe(2); // 1 pass + 1 repair
    expect(drafts.every((d) => /[가-힣]/.test(d.itemLabel))).toBe(true);
    expect(drafts[0].itemLabel).toContain("매출 집중도");
  });

  test("a Korean industry name inside an English sentence does NOT pass as Korean", async () => {
    const EN_WITH_KO_NAME = JSON.stringify([
      { item_label: "Assess 휴머노이드 로봇 demand cyclicality against the proxy chain", rationale: "Ties DD back to the S8 demand anchor." },
    ]);
    const { run, seen } = await setup([EN_WITH_KO_NAME, KO]);
    const drafts = await run();
    expect(seen.length).toBe(2); // the Korean industry name must not rescue the English label
    expect(drafts[0].itemLabel).toContain("상위 3개 고객");
  });

  test("two failed repairs fail the tailor loudly (no silent English output)", async () => {
    const { run, seen } = await setup([EN, EN, EN]);
    await expect(run()).rejects.toThrow("한국어로 작성되지 않았습니다");
    expect(seen.length).toBe(3); // 1 pass + 2 repairs
  });

  test("a Korean first pass needs no repair", async () => {
    const { run, seen } = await setup([KO]);
    const drafts = await run();
    expect(seen.length).toBe(1);
    expect(drafts.every((d) => /[가-힣]/.test(d.itemLabel))).toBe(true);
  });
});
