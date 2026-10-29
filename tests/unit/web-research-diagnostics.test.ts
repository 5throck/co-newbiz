// @version 1.0.0
/**
 * Web-research diagnostics, circuit breaker, provider chain, DDG challenge detection and the S3 holding-check
 * fail-fast / evidence-context behaviour (ADR-0172 amendment 2026-10-14 (2)). Fakes only: injected providers,
 * stubbed fetch, CO_NEWBIZ_LLM_PROVIDER=none. No real network, no real LLM.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
// Type-only namespace for the dynamically imported web-research module (runtime usages go through `wr` below).
import type * as wrT from "../../app/web-next/lib/web-research.ts";

process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
const wr = await import("../../app/web-next/lib/web-research.ts");
const ps = await import("../../app/web-next/lib/playwright-search.ts");
const hc = await import("../../app/web-next/lib/capability-holding-check.ts");
const run = await import("../../app/web-next/lib/capability-holding-run.ts");
const dr = await import("../../app/web-next/lib/capability-gap-necessity-draft.ts");
const ctx = await import("../../app/web-next/lib/capability-holding-context.ts");
const cg = await import("../../app/web-next/lib/capability-gap.ts");

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = ["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY", "SERPER_API_KEY", "WEB_SEARCH_DDG_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  wr.setWebResearchOverrideForTests(null);
  // Other files (brownfield-llm-support) set a process-wide Playwright override that would make the chain look reachable.
  ps.setPlaywrightSearchOverrideForTests(null);
  globalThis.fetch = (async () => { throw new Error("no real network in tests"); }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  wr.resetWebResearchStateForTests();
});

const src = (u: string) => ({ title: u, url: `https://${u}.example.com/x`, snippet: "s" });
function fake(name: wrT.ProviderName, status: wrT.ProviderStatus, sources: ReturnType<typeof src>[] = [], log?: string[], http?: number): wrT.SearchProvider {
  return { name, unavailable: () => null, search: async (q: string) => { log?.push(`${name}:${q}`); return { sources, status, http }; } };
}

const CHALLENGE = `<html><body><div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div><form id="challenge-form"></form></body></html>`;
const LITE = `<table><tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Flite.example.com%2Fa&amp;rut=1" class='result-link'>Lite 결과 <b>하나</b></a></td></tr><tr><td class='result-snippet'>스니펫 &amp; 본문</td></tr></table>`;

describe("DuckDuckGo challenge detection", () => {
  test("challenge page without result links is detected; real results and plain empties are not", () => {
    expect(wr.isDdgChallengePage(CHALLENGE)).toBe(true);
    expect(wr.isDdgChallengePage("<html>nothing</html>", 202)).toBe(true);
    expect(wr.isDdgChallengePage("<html>no results</html>", 200)).toBe(false);
    expect(wr.isDdgChallengePage('<a class="result__a" href="https://x.com">anomaly in markets</a>')).toBe(false);
  });
  test("parseDdgLiteResults decodes redirects defensively", () => {
    const out = wr.parseDdgLiteResults(LITE);
    expect(out).toEqual([{ title: "Lite 결과 하나", url: "https://lite.example.com/a", snippet: "스니펫 & 본문" }]);
    expect(wr.parseDdgLiteResults("<html></html>")).toEqual([]);
  });
  test("html blocked -> lite tried once -> lite results are used; both blocked -> status blocked", async () => {
    delete process.env.TAVILY_API_KEY; delete process.env.BRAVE_SEARCH_API_KEY; delete process.env.SERPER_API_KEY;
    process.env.WEB_SEARCH_DDG_ENABLED = "";
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("duckduckgo")) calls.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
      if (url.includes("html.duckduckgo.com")) return new Response(CHALLENGE, { status: 200 });
      return new Response(LITE, { status: 200 });
    }) as typeof fetch;
    const ok = await wr.researchSourcesDetailed(["q"], 5);
    expect(ok.sources[0].url).toBe("https://lite.example.com/a");
    expect(ok.providers.find((p) => p.name === "ddg")?.status).toBe("ok");
    expect(calls).toEqual(["GET https://html.duckduckgo.com/html/", "POST https://lite.duckduckgo.com/lite/"]);

    wr.resetWebResearchStateForTests();
    globalThis.fetch = (async () => new Response(CHALLENGE, { status: 200 })) as unknown as typeof fetch;
    const blocked = await wr.researchSourcesDetailed(["q"], 5);
    expect(blocked.sources).toHaveLength(0);
    expect(blocked.providers.find((p) => p.name === "ddg")?.status).toBe("blocked");
  });
});

describe("circuit breaker", () => {
  test("opens after quota/blocked, skips the provider, closes after ~10 minutes, and is resettable", async () => {
    let t = 1_000_000;
    wr.setWebResearchClockForTests(() => t);
    const log: string[] = [];
    wr.setWebProvidersForTests([fake("tavily", "quota_exceeded", [], log, 432), fake("ddg", "blocked", [], log)]);
    const first = await wr.researchSourcesDetailed(["a", "b"], 5);
    expect(first.providers.map((p) => [p.name, p.status])).toEqual([["tavily", "quota_exceeded"], ["ddg", "blocked"]]);
    expect(log).toEqual(["tavily:a", "ddg:a"]); // the first quota/blocked answer stops the remaining queries
    expect(wr.isProviderCircuitOpen("tavily")).toBe(true);
    const second = await wr.researchSourcesDetailed(["c"], 5);
    expect(log).toHaveLength(2); // no further provider calls while open
    expect(second.providers.every((p) => p.circuitOpen)).toBe(true);
    expect(second.quotaExceeded).toBe(true);
    t += 10 * 60 * 1000 + 1;
    expect(wr.isProviderCircuitOpen("tavily")).toBe(false);
    await wr.researchSourcesDetailed(["d"], 5);
    expect(log.length).toBeGreaterThan(2);
    wr.resetWebResearchStateForTests();
    expect(wr.isProviderCircuitOpen("tavily")).toBe(false);
  });
  test("empty results do not open the breaker", async () => {
    wr.setWebProvidersForTests([fake("tavily", "empty"), fake("ddg", "empty")]);
    await wr.researchSourcesDetailed(["a"], 5);
    expect(wr.isProviderCircuitOpen("tavily")).toBe(false);
  });
});

describe("provider chain", () => {
  test("order tavily -> brave -> serper -> ddg; stops at the first provider with results", async () => {
    const log: string[] = [];
    wr.setWebProvidersForTests([fake("tavily", "empty", [], log), fake("brave", "empty", [], log), fake("serper", "ok", [src("s")], log), fake("ddg", "ok", [src("d")], log)]);
    const r = await wr.researchSourcesDetailed(["q"], 5);
    expect(log).toEqual(["tavily:q", "brave:q", "serper:q"]);
    expect(r.sources.map((s) => s.url)).toEqual(["https://s.example.com/x"]);
    expect(r.providers.map((p) => p.name)).toEqual(["tavily", "brave", "serper"]);
  });
  test("a key-less provider is reported no_key and skipped; quota on the first moves on to the next", async () => {
    const noKey: wrT.SearchProvider = { name: "brave", unavailable: () => "no_key", search: async () => { throw new Error("must not run"); } };
    wr.setWebProvidersForTests([fake("tavily", "quota_exceeded", [], undefined, 432), noKey, fake("ddg", "ok", [src("d")])]);
    const r = await wr.researchSourcesDetailed(["q"], 5);
    expect(r.providers.map((p) => p.status)).toEqual(["quota_exceeded", "no_key", "ok"]);
    expect(r.quotaExceeded).toBe(true);
    expect(r.sources).toHaveLength(1);
  });
  test("brave and serper JSON adapters use their key headers (stubbed fetch)", async () => {
    delete process.env.TAVILY_API_KEY;
    process.env.BRAVE_SEARCH_API_KEY = "test"; process.env.SERPER_API_KEY = "test"; process.env.WEB_SEARCH_DDG_ENABLED = "false";
    const seen: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      seen.push(url.split("?")[0]);
      if (url.includes("brave.com")) { expect((init?.headers as Record<string, string>)["X-Subscription-Token"]).toBe("test"); return new Response("", { status: 429 }); }
      expect((init?.headers as Record<string, string>)["X-API-KEY"]).toBe("test");
      return Response.json({ organic: [{ title: "t", link: "https://serper.example.com/r", snippet: "x" }] });
    }) as typeof fetch;
    const r = await wr.researchSourcesDetailed(["q"], 5);
    expect(r.providers.map((p) => [p.name, p.status])).toEqual([["tavily", "no_key"], ["brave", "quota_exceeded"], ["serper", "ok"], ["ddg", "disabled"]]);
    expect(seen).toEqual(["https://api.search.brave.com/res/v1/web/search", "https://google.serper.dev/search"]);
    expect(r.sources[0].url).toBe("https://serper.example.com/r");
  });
});

describe("query builder", () => {
  test("keyword distillation strips suffixes and parentheses and caps length", () => {
    expect(dr.distillCapabilityKeyword("정밀 가공 역량")).toBe("정밀 가공");
    expect(dr.distillCapabilityKeyword("품질관리 체계 구축 (ISO 9001 기준)")).toBe("품질관리");
    expect(dr.distillCapabilityKeyword("역량")).toBe("역량");
    expect(dr.distillCapabilityKeyword("대형 선박용 저속 디젤엔진 크랭크샤프트 단조 및 열처리 일관 생산 능력").length).toBeLessThanOrEqual(24);
  });
  test("two queries (company+keyword, keyword+market scope) and an English variant only with Latin tokens", () => {
    const q = dr.buildHeldQueries("정밀 가공 역량", ["A사"], "선박 엔진 시장");
    expect(q).toEqual(["A사 정밀 가공", "정밀 가공 선박 엔진 시장 업계 주요 기업"]);
    expect(dr.buildHeldQueries("정밀 가공 역량", [], null)).toEqual(["정밀 가공 업계 주요 기업"]);
    const en = dr.buildHeldQueries("ISO 9001 인증 관리 체계", ["A사"], "산업");
    expect(en).toHaveLength(3);
    expect(en[2]).toContain("ISO");
    expect(en.every((x) => x.length < 60)).toBe(true);
    expect(dr.buildHeldQueries("   ", ["A사"], null)).toEqual([]);
  });
});

const mkRows = (n: number) => cg.normalizeGapRows(Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, capability: `역량 ${i + 1}`, source: "manual" })));

describe("holding search: probe then skip", () => {
  test("all providers failing -> one probe call, no per-row searches, precise note with causes and action", async () => {
    const log: string[] = [];
    wr.setWebProvidersForTests([fake("tavily", "quota_exceeded", [], log, 432), fake("brave", "empty", [], log), fake("ddg", "blocked", [], log)]);
    // brave is "empty" -> reachable, so the probe must NOT skip; use only failing providers for the skip case
    wr.resetWebResearchStateForTests();
    wr.setWebProvidersForTests([fake("tavily", "quota_exceeded", [], log, 432), fake("ddg", "blocked", [], log)]);
    process.env.WEB_SEARCH_DDG_ENABLED = "";
    const res = await hc.gatherHoldingSources(mkRows(12), ["A사"], "산업", true);
    expect(log).toEqual(["tavily:A사 역량 1", "ddg:A사 역량 1"]); // the single probe only
    expect(res.queries).toBe(1);
    expect(res.rowsNotSearched).toBe(12);
    expect(res.failureNote).toContain("외부 검색 불가 — Tavily 쿼터 초과(432), DuckDuckGo 봇 차단");
    expect(res.failureNote).toContain("프로필·공시 정보만으로 판정했습니다");
    expect(res.failureNote).toContain("조치:");
    expect(res.failureNote).toContain("BRAVE_SEARCH_API_KEY");
    const note = hc.holdingNote({ counts: { proposed: 0, insufficient: 12, profile: 0, disclosure: 0, web: 0 }, search: res, webEnabled: true, targeted: 12 });
    expect(note).toContain("Tavily 쿼터 초과(432)");
    expect(note).toContain("프로필 0건 / 공시 0건 / 웹 0건");
    expect(note).toContain("12개 행의 웹 검색을 건너뛰었습니다");
  });
  test("when a provider works the per-row searches run", async () => {
    const log: string[] = [];
    wr.setWebProvidersForTests([fake("tavily", "ok", [src("a")], log)]);
    process.env.WEB_SEARCH_DDG_ENABLED = "";
    const res = await hc.gatherHoldingSources(mkRows(3), ["A사"], "산업", true);
    expect(log.length).toBeGreaterThan(1 + 3);
    expect(res.failureNote).toBeNull();
    expect(res.rowsNotSearched ?? 0).toBe(0);
  });
});

describe("evidence context", () => {
  const profile = {
    companyName: "A사", dartCorpCode: null, dartFinancials: { available: true, year: "2025", items: [{ name: "매출액", value: 1_234_500_000_000 }, { name: "연구개발비", value: 25_000_000_000 }] },
    strengths: ["정밀 가공"], weaknesses: ["해외 거점 부족"], businessAssessment: "선박 엔진 부품 전문", industryExposure: ["조선"],
    researchSources: [], dataSources: { dart: true, dartYear: "2025", webResearchCount: 0 }, stepSummaries: [{ step: 1, title: "사업", summary: "주력 제품은 크랭크샤프트", source: "dart" }],
    swot: { opportunities: ["친환경 엔진"], threats: ["원가 상승"] }, competitive: { competitors: [{ name: "B사", note: "경쟁" }], positioning: "국내 2위" },
  } as any;
  test("profile lines carry every textual field with names, capped; disclosure lines carry account values", () => {
    const lines = ctx.profileEvidenceLines("A사", profile);
    for (const label of ["사업 평가", "강점", "약점", "산업 노출", "SWOT 기회", "경쟁 포지셔닝", "주요 경쟁사"]) expect(lines.join("\n")).toContain(`A사 · ${label}`);
    expect(lines.join("\n").length).toBeLessThan(2800);
    const d = ctx.disclosureEvidenceLines("A사", ctx.loadDisclosureItems({ query: () => ({ all: () => [], get: () => undefined }) } as any, null, profile));
    expect(d[0]).toContain("공시 2025");
    expect(d[0]).toContain("매출액 12,345억원");
    expect(ctx.profileEvidenceLines("A사", null)).toEqual([]);
  });
  test("opportunity context is labelled as background in the prompt, never as holding evidence", () => {
    const prompt = hc.buildHoldingPrompt({
      oppName: "기회", marketScope: "산업", rows: mkRows(1), profileLines: ["- A사 · 강점: 정밀 가공"], disclosureLines: ["- A사 · 공시 2025: 매출액 1억원"],
      contextLines: ctx.opportunityContextLines("산업", "정밀 가공 — 기회: x · 위험: y"),
      search: { sources: [], perRow: {}, queries: 0, failureNote: "외부 검색 불가", skippedRows: 0 },
    });
    expect(prompt).toContain("[공시·재무 근거]");
    expect(prompt).toContain("보유 근거가 아닙니다");
    expect(prompt).toContain("profile|dart|web|both");
    expect(prompt.indexOf("보유 근거가 아닙니다")).toBeGreaterThan(prompt.indexOf("[공시·재무 근거]"));
  });
});

describe("citation rules with disclosure evidence", () => {
  const base = { allowedSources: [] as number[], sources: [] as any[], profileNames: ["A사"] };
  const item = (heldSource: string) => ({ id: "r1", held: { status: "average", currentLevel: "양산", evidence: "매출 기반" }, sources: [], basis: { held: "공시 매출액", heldSource } });
  test("dart basis counts only when disclosure facts were provided; never fabricated otherwise", () => {
    expect(dr.judgeCitedHeldDraft(item("dart"), { ...base, disclosureNames: ["A사"] }).cited?.origins).toEqual(["dart"]);
    expect(dr.judgeCitedHeldDraft(item("dart"), { ...base, disclosureNames: [] }).reason).toBe("no_citation");
    expect(dr.judgeCitedHeldDraft(item("dart"), { ...base, profileNames: [] }).reason).toBe("no_citation");
    expect(dr.judgeCitedHeldDraft(item("profile"), base).cited?.origins).toEqual(["profile"]);
  });
  test("runHoldingCheck counts profile / disclosure / web separately", async () => {
    const rows = mkRows(2);
    const call = async () => ({ ok: true, text: JSON.stringify({ rows: [
      { id: "r1", held: { status: "average", currentLevel: "x", evidence: "e" }, sources: [], basis: { held: "공시 매출액", heldSource: "dart" } },
      { id: "r2", held: { status: "partial", currentLevel: "x", evidence: "e" }, sources: [], basis: { held: "A사 강점", heldSource: "profile" } },
    ] }) });
    const out = await run.runHoldingCheck({
      system: { role: "system", content: "s" }, oppName: "o", marketScope: null, current: rows, targets: rows, profileLines: ["- A사 · 강점: x"], profileNames: ["A사"],
      disclosureLines: ["- A사 · 공시 2025: 매출액 1억원"], disclosureNames: ["A사"], search: { sources: [], perRow: {}, queries: 0, failureNote: null, skippedRows: 0 },
      profileScope: "사용한 프로필 1곳", scopeNote: "", webEnabled: false, call,
    } as any);
    expect(out.counts).toMatchObject({ proposed: 2, profile: 1, disclosure: 1, web: 0 });
    expect(out.note).toContain("프로필 1건 / 공시 1건 / 웹 0건");
  });
  test("no fabrication: a LLM answer without any citation stays unevaluated", () => {
    expect(dr.judgeCitedHeldDraft({ id: "r1", held: { status: "average", currentLevel: "x", evidence: "e" }, sources: [], basis: { held: "추정" } }, { ...base, disclosureNames: ["A사"] }).reason).toBe("no_citation");
  });
});
