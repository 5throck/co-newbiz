// @version 1.0.0
// biome-ignore-all lint/suspicious/noExplicitAny: test-only payload reads — the
// assertions pin exact field values deep inside the stored matrix, so a typed
// envelope would restate every literal twice; the anys never cross a trust
// boundary (same header discipline as market-sizing-web-grounding.test.ts).
/**
 * S1 web-grounding quota-rescue contract (design 2026-11-14-s1-quota-rescue,
 * DEC-20261114-01): the R7 consumption amendment and the headless-rescue scope
 * extension to the S1 pipeline.
 *   1. excerptsFromChainResult — the pure consumption contract: quotaExceeded
 *      is a cost signal, NOT an emptiness signal; sources found by fallback
 *      providers flow through, [] only when the chain is empty.
 *   2. Chain regression — the live 2026-11-14 diagnosis state (Tavily 432 +
 *      DDG ok) yields sources WITH quotaExceeded=true; the old helper discarded
 *      exactly these.
 *   3. Plumbing, deadline provided — quantitativeExcerpts forwards the
 *      playwright rescue options (headless override sources come back); a
 *      stale deadline skips the browser (PLAYWRIGHT_MIN_REMAINING_MS guard).
 *   4. Plumbing, no deadline — no playwright provider in the chain (browser
 *      reserved for the two consensus tiers).
 *   5. End-to-end quota path — the diagnosis state heals the top-down
 *      consensus: web extraction lands (origin web_research), the 5-B forecast
 *      persists once as web_research, the anchor gains its URL-grounded
 *      source, and the R7 10-query bound is intact.
 *   6. End-to-end headless rescue — fully-blocked base chain + playwright
 *      override: the consensus source is the headless source, steps 2/4 stay
 *      browser-free.
 *   7. R7 degradation preserved — fully-blocked + playwright disabled: empty
 *      excerpts, zero extraction calls, LLM-prior path, no references.
 *   8. Structural pins — the option object, constants and the run-scoped
 *      deadline wiring in the pipeline source.
 * Fakes only: injected providers (setWebProvidersForTests), the Playwright
 * override, stubbed LLM transport (module mock, armed/disarmed discipline).
 * No real network, no real browser, no real LLM.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
// Type-only namespace for the dynamically imported web-research module (runtime usages go through `wr` below).
import type * as wrT from "../../app/web-next/lib/web-research.ts";

const ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(ROOT, "db/data/test-s1-quota-rescue.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_QUEUE_NO_SPAWN = "1";
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

// bun test may run sibling files in flight: remembered keys are restored in
// afterAll. TAVILY_API_KEY="testkey" makes isWebResearchConfigured()
// deterministic (the root-env loader never overrides an explicit value); the
// provider fakes below replace the whole chain, so no real network is touched.
const ENV_KEYS = [
  "TAVILY_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "SERPER_API_KEY",
  "WEB_SEARCH_DDG_ENABLED",
  "WEB_SEARCH_PLAYWRIGHT_ENABLED",
  "CHROME_PATH",
] as const;
const ENV_ORIGINALS = ENV_KEYS.map((k) => [k, process.env[k]] as const);
process.env.TAVILY_API_KEY = "testkey";
process.env.WEB_SEARCH_DDG_ENABLED = "false";
delete process.env.WEB_SEARCH_PLAYWRIGHT_ENABLED;
delete process.env.CHROME_PATH;

// LLM seam — same mock.module discipline as market-sizing-web-grounding.test.ts:
// snapshot the originals BY VALUE, arm the stub only inside the pipeline
// describe, forward to the originals when disarmed (sibling suites keep their
// env-driven behavior). Extraction calls (R2 protocol, identified by the
// marker in the instruction) are dispatched to their own JSON stub.
const realLlm = await import("../../app/web-next/lib/llm.ts");
const realLlmSnapshot = { ...realLlm };
const realIsLlmConfigured = realLlmSnapshot.isLlmConfigured;
const realCompleteOrFallback = realLlmSnapshot.completeOrFallback;
const EXTRACTION_MARKER = "웹 발췌 정량 추출";
const llmStub: {
  armed: boolean;
  json: Record<string, unknown>;
  extractJson: Record<string, unknown>;
  prompts: string[];
} = {
  armed: false,
  json: {},
  extractJson: { items: [] as Array<Record<string, unknown>> },
  prompts: [],
};
mock.module("../../app/web-next/lib/llm.ts", () => ({
  ...realLlmSnapshot,
  isLlmConfigured: () => (llmStub.armed ? true : realIsLlmConfigured()),
  completeOrFallback: (messages: unknown, fallback: unknown, opts?: { maxTokens?: number }) => {
    if (!llmStub.armed) {
      return realCompleteOrFallback(
        messages as Parameters<typeof realCompleteOrFallback>[0],
        fallback as Parameters<typeof realCompleteOrFallback>[1],
        opts as Parameters<typeof realCompleteOrFallback>[2],
      );
    }
    const text = JSON.stringify(messages);
    llmStub.prompts.push(text);
    if (text.includes(EXTRACTION_MARKER)) {
      return Promise.resolve({ source: "llm" as const, text: JSON.stringify(llmStub.extractJson) });
    }
    return Promise.resolve({
      source: "llm" as const,
      text: opts?.maxTokens === 400 ? "스텁 단계 요약 — 테스트 고정문" : JSON.stringify(llmStub.json),
    });
  },
}));

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const wr = await import("../../app/web-next/lib/web-research.ts");
const ps = await import("../../app/web-next/lib/playwright-search.ts");
const pipeline = await import("../../app/web-next/lib/market-sizing-pipeline.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

const NOW = new Date().toISOString();

// Canned excerpts — every fake provider hands back this list, so every
// quantitative search tier sees the same numbered excerpts and index 0 is
// uniformly valid. Validated extraction items must quote excerpt[0]'s URL back
// (R2), so every extraction stub item cites SOURCES[0]/HEADLESS_SOURCES[0].
const SOURCES: wrT.WebSource[] = [
  {
    title: "글로벌 리서치 시장 보고서",
    url: "https://ddg.example.com/market-report",
    snippet: "2026년 글로벌 시장 규모는 12.8B 달러이며 2030년 42.5B 달러 전망, 연평균 성장률(CAGR)은 8.0%이다.",
  },
  {
    title: "국내 산업 보고서",
    url: "https://ddg.example.com/kr-report",
    snippet: "국내 시장은 연평균 6.5% 성장이 전망된다.",
  },
];
// The headless rescue sources — distinct URLs so their origin is provable.
const HEADLESS_SOURCES: wrT.WebSource[] = [
  {
    title: "헤드리스 시장 보고서",
    url: "https://headless.example.com/market-report",
    snippet: "브라우저 세션으로 회수한 보고서 — 2030년 42.5B 달러 전망, CAGR 8.0%.",
  },
  {
    title: "헤드리스 산업 동향",
    url: "https://headless.example.com/trend",
    snippet: "헤드리스 스니펫",
  },
];

afterAll(async () => {
  pipeline.resetQuantSearchQueryCountForTests();
  wr.setWebResearchOverrideForTests(null);
  wr.setWebProvidersForTests(null);
  ps.setPlaywrightSearchOverrideForTests(null);
  wr.resetWebResearchStateForTests();
  llmStub.armed = false;
  for (const [k, v] of ENV_ORIGINALS) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
      return;
    } catch {
      await Bun.sleep(50 * (attempt + 1));
    }
  }
});

// ── case 1: the pure consumption contract (the amendment itself) ──
describe("excerptsFromChainResult — R7 소비 규칙 (amendment 2026-11-14)", () => {
  test("quotaExceeded=true with non-empty sources returns the sources (the defect pin — old code returned [])", () => {
    const out = pipeline.excerptsFromChainResult({ sources: SOURCES, quotaExceeded: true });
    expect(out.map((s) => s.url)).toEqual(SOURCES.map((s) => s.url));
  });
  test("empty chain → [] regardless of quotaExceeded (the original R7 guarantee)", () => {
    expect(pipeline.excerptsFromChainResult({ sources: [], quotaExceeded: true })).toEqual([]);
    expect(pipeline.excerptsFromChainResult({ sources: [], quotaExceeded: false })).toEqual([]);
  });
  test("healthy chain passes through unchanged", () => {
    expect(pipeline.excerptsFromChainResult({ sources: SOURCES, quotaExceeded: false })).toEqual(SOURCES);
  });
});

// ── case 2: the live-diagnosis chain state (the trigger of the defect) ──
describe("researchSourcesDetailed — quota state still carries fallback sources (2026-11-14 live diagnosis)", () => {
  beforeEach(() => {
    // Cross-file safety (one-process full-suite runs): another suite may have
    // left the web-research module seams set — testOverride short-circuits
    // BEFORE the provider chain, so clear every seam before installing ours.
    wr.setWebResearchOverrideForTests(null);
    wr.setWebProvidersForTests(null);
    ps.setPlaywrightSearchOverrideForTests(null);
    wr.resetWebResearchStateForTests();
  });
  afterEach(() => {
    wr.setWebProvidersForTests(null);
    wr.resetWebResearchStateForTests();
  });

  test("Tavily quota_exceeded(432) + DDG ok → sources present WITH quotaExceeded=true", async () => {
    const tavily: wrT.SearchProvider = {
      name: "tavily",
      unavailable: () => null,
      search: async () => ({ sources: [], status: "quota_exceeded", http: 432 }),
    };
    const ddg: wrT.SearchProvider = {
      name: "ddg",
      unavailable: () => null,
      search: async () => ({ sources: SOURCES, status: "ok" }),
    };
    wr.setWebProvidersForTests([tavily, ddg]);
    const r = await wr.researchSourcesDetailed(["드론 market CAGR forecast consensus"], 10);
    expect(r.quotaExceeded).toBe(true);
    expect(r.sources.map((s) => s.url)).toEqual(SOURCES.map((s) => s.url));
    expect(r.providers.map((p) => [p.name, p.status])).toEqual([
      ["tavily", "quota_exceeded"],
      ["ddg", "ok"],
    ]);
    // the old consumption rule discarded exactly this shape — the amendment keeps it
    expect(pipeline.excerptsFromChainResult(r)).toEqual(r.sources);
  });
});

// ── cases 3-4: quantitativeExcerpts plumbing (option forwarding) ──
describe("quantitativeExcerpts — playwright option plumbing", () => {
  beforeEach(() => {
    // Cross-file safety: testOverride short-circuits BEFORE providerOverride —
    // clear it before installing this suite's fakes.
    wr.setWebResearchOverrideForTests(null);
    wr.resetWebResearchStateForTests();
    // Tavily quota-exhausted for every query → the base chain stays empty, so
    // the playwright provider is the only way any source can come back.
    wr.setWebProvidersForTests([
      {
        name: "tavily",
        unavailable: () => null,
        search: async () => ({ sources: [], status: "quota_exceeded", http: 432 }),
      },
    ]);
    ps.setPlaywrightSearchOverrideForTests(null);
    pipeline.resetQuantSearchQueryCountForTests();
  });
  afterEach(() => {
    wr.setWebProvidersForTests(null);
    ps.setPlaywrightSearchOverrideForTests(null);
    wr.resetWebResearchStateForTests();
    pipeline.resetQuantSearchQueryCountForTests();
  });

  test("deadline provided → forwards the rescue options; headless sources come back", async () => {
    ps.setPlaywrightSearchOverrideForTests(HEADLESS_SOURCES);
    const out = await pipeline.quantitativeExcerpts(["q1", "q2"], { deadlineAt: Date.now() + 30_000 });
    expect(out.map((s) => s.url)).toEqual(HEADLESS_SOURCES.map((s) => s.url));
    // R7 cost accounting untouched — queries counted regardless of provider
    expect(pipeline.getQuantSearchQueryCountForTests()).toBe(2);
  });

  test("stale deadline → the internal PLAYWRIGHT_MIN_REMAINING_MS guard skips the browser", async () => {
    ps.setPlaywrightSearchOverrideForTests(HEADLESS_SOURCES);
    const out = await pipeline.quantitativeExcerpts(["q"], { deadlineAt: Date.now() - 30_000 });
    expect(out).toEqual([]);
  });

  test("no deadline → no playwright provider in the chain (override sources never appear)", async () => {
    ps.setPlaywrightSearchOverrideForTests(HEADLESS_SOURCES);
    const out = await pipeline.quantitativeExcerpts(["q1", "q2"]);
    expect(out).toEqual([]);
    expect(out.some((s) => s.url.startsWith("https://headless.example.com"))).toBe(false);
  });
});

// ── cases 5-7: end-to-end pipeline over the real harness ──
describe("runSizingPipeline — quota-rescue end-to-end", () => {
  beforeEach(() => {
    llmStub.armed = true;
    llmStub.prompts.length = 0;
    llmStub.json = {};
    llmStub.extractJson = { items: [] };
    // Cross-file safety: testOverride short-circuits BEFORE providerOverride —
    // clear it before resetting the breaker/provider state.
    wr.setWebResearchOverrideForTests(null);
    wr.resetWebResearchStateForTests();
    pipeline.resetQuantSearchQueryCountForTests();
  });
  afterEach(() => {
    wr.setWebProvidersForTests(null);
    ps.setPlaywrightSearchOverrideForTests(null);
    delete process.env.WEB_SEARCH_PLAYWRIGHT_ENABLED;
    wr.resetWebResearchStateForTests();
  });
  afterAll(() => {
    llmStub.armed = false;
    pipeline.resetQuantSearchQueryCountForTests();
  });

  const REGION_CODES = ["china", "apac_ex_china", "north_america", "europe", "mea", "latam_row"];
  // One completion object satisfies every step parser (same convention as
  // market-sizing-web-grounding.test.ts): 6 regions × 2 cells × $1.0B.
  const stubCompletion = () => ({
    position: "midstream",
    note: "스텁 — 가치사슬 위치 고정",
    relatedIndustries: [],
    segments: [
      { code: "seg_a", label: "세그먼트A" },
      { code: "seg_b", label: "세그먼트B" },
    ],
    sources: [{ label: "스텁 소스", estimate: 12, status: "consensus", methodology: "테스트 고정 앵커" }],
    regions: [{ code: "china", weight: 100, mix: { seg_a: 50, seg_b: 50 }, adjustment: "스텁 배분" }],
    baseline: Object.fromEntries(REGION_CODES.map((r) => [r, { seg_a: 1.0, seg_b: 1.0 }])),
    cagr: Object.fromEntries(REGION_CODES.map((r) => [r, { seg_a: 0.05, seg_b: 0.05 }])),
    overrides: [],
  });
  // Extraction items for ALL three extraction schemas at once — each call
  // keeps only the items its numericFields validate (R2 per-item rule), and
  // every item must cite excerpt index 0, whose URL is the FIRST merged
  // source of that call (the fakes return the full list for every query).
  const stubExtraction = (excerptUrl: string, label: string) => ({
    items: [
      { source_label: label, url: excerptUrl, excerpt_index: 0, cagr: 0.08 },
      { source_label: label, url: excerptUrl, excerpt_index: 0, target_year: 2030, size_b: 42.5 },
      { source_label: label, url: excerptUrl, excerpt_index: 0, size_b: 12.8, year: 2026 },
    ],
  });

  const quotaTavily = (): wrT.SearchProvider => ({
    name: "tavily",
    unavailable: () => null,
    search: async () => ({ sources: [], status: "quota_exceeded", http: 432 }),
  });
  const blockedDdg = (): wrT.SearchProvider => ({
    name: "ddg",
    unavailable: () => null,
    search: async () => ({ sources: [], status: "blocked" }),
  });

  const insertAnalysis = (nameKo: string): { aid: string; industryId: string } => {
    const indId = ulid();
    db.run("INSERT INTO md_industry (id, name_ko, name_en, created_at) VALUES (?,?,?,?)", [indId, nameKo, nameKo, NOW]);
    const aid = ulid();
    db.run("INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at) VALUES (?,?,?,?,?)", [
      aid,
      indId,
      "in_progress",
      "test",
      NOW,
    ]);
    return { aid, industryId: indId };
  };

  const matrixOf = (aid: string): Record<string, any> => {
    const stored = db
      .query("SELECT payload FROM market_sizing_version WHERE analysis_id = ? ORDER BY version_no DESC LIMIT 1")
      .get(aid) as { payload: string };
    return (JSON.parse(stored.payload) as { matrix: Record<string, any> }).matrix;
  };

  const referenceRows = (industryId: string): Array<Record<string, any>> =>
    db.query("SELECT * FROM market_external_reference WHERE industry_id = ?").all(industryId) as Array<
      Record<string, any>
    >;

  const extractionPrompts = (): string[] => llmStub.prompts.filter((p) => p.includes(EXTRACTION_MARKER));

  test("AC-1 — Tavily 432 + DDG ok (the diagnosis state): web consensus lands, LLM prior skipped, 10-query bound intact", async () => {
    llmStub.json = stubCompletion();
    llmStub.extractJson = stubExtraction(SOURCES[0].url, SOURCES[0].title);
    wr.setWebProvidersForTests([
      quotaTavily(),
      { name: "ddg", unavailable: () => null, search: async () => ({ sources: SOURCES, status: "ok" }) },
    ]);
    const { aid, industryId } = insertAnalysis("쿼터 구조 스텁 산업");
    await expect(pipeline.runSizingPipeline(db, aid)).resolves.toBeUndefined();
    const matrix = matrixOf(aid);

    // step 5 — the consensus enters from web extraction (old code: permanent 미입력)
    expect(matrix.consistency.topDownCagr).toBe(8.0);
    expect(matrix.consistency.source).toEqual({
      label: SOURCES[0].title,
      url: SOURCES[0].url,
      origin: "web_research",
    });
    // the honest LLM-prior consensus query must NOT be fired (the web tier answered)
    expect(llmStub.prompts.join("\n")).not.toContain("공개된 시장 성장률 컨센서스");

    // step 5-B — the forecast lands and persists ONCE as web_research (R9)
    expect(matrix.externalForecast.sourceUrl).toBe(SOURCES[0].url);
    expect(matrix.externalForecast.targetYear).toBe(2030);
    expect(matrix.externalForecast.marketSize).toBeCloseTo(42.5, 5);
    const rows = referenceRows(industryId);
    expect(rows).toHaveLength(1);
    expect(rows[0].captured_from).toBe("web_research");
    expect(rows[0].source_url).toBe(SOURCES[0].url);

    // step 2 — the anchor also gains its URL-grounded source through the same fix
    const withUrl = (matrix.anchor.sources as Array<{ sourceUrl?: string }>).filter((s) => s.sourceUrl);
    expect(withUrl.length).toBeGreaterThanOrEqual(1);
    expect(withUrl.some((s) => s.sourceUrl === SOURCES[0].url)).toBe(true);

    // R7 cost bound unchanged — 3+2+2+3 tracked queries per run
    expect(pipeline.getQuantSearchQueryCountForTests()).toBe(10);
  });

  test("AC-2 — fully-blocked base chain + playwright override: the consensus source is the headless source", async () => {
    llmStub.json = stubCompletion();
    llmStub.extractJson = stubExtraction(HEADLESS_SOURCES[0].url, HEADLESS_SOURCES[0].title);
    wr.setWebProvidersForTests([quotaTavily(), blockedDdg()]);
    ps.setPlaywrightSearchOverrideForTests(HEADLESS_SOURCES);
    const { aid, industryId } = insertAnalysis("헤드리스 구조 스텁 산업");
    await expect(pipeline.runSizingPipeline(db, aid)).resolves.toBeUndefined();
    const matrix = matrixOf(aid);
    expect(matrix.consistency.topDownCagr).toBe(8.0);
    expect(matrix.consistency.source).toEqual({
      label: HEADLESS_SOURCES[0].title,
      url: HEADLESS_SOURCES[0].url,
      origin: "web_research",
    });
    expect(llmStub.prompts.join("\n")).not.toContain("공개된 시장 성장률 컨센서스");
    const rows = referenceRows(industryId);
    expect(rows).toHaveLength(1);
    expect(rows[0].captured_from).toBe("web_research");
    expect(rows[0].source_url).toBe(HEADLESS_SOURCES[0].url);
    // the base chain is dead and steps 2/4 got no deadline — no browser sources may
    // leak into the anchor or the growth-context tiers
    expect(
      (matrix.anchor.sources as Array<{ sourceUrl?: string }>).every(
        (s) => !s.sourceUrl?.startsWith("https://headless.example.com"),
      ),
    ).toBe(true);
    // R7 cost bound unchanged — headless reuses the same queries, no extra tracked calls
    expect(pipeline.getQuantSearchQueryCountForTests()).toBe(10);
  });

  test("AC-3 regression — fully-blocked + playwright disabled: the original R7 degradation, byte for byte", async () => {
    llmStub.json = stubCompletion();
    wr.setWebProvidersForTests([quotaTavily(), blockedDdg()]);
    // would rescue if the flag were on — proving the opt-out is what keeps it off
    ps.setPlaywrightSearchOverrideForTests(HEADLESS_SOURCES);
    process.env.WEB_SEARCH_PLAYWRIGHT_ENABLED = "false";
    const { aid, industryId } = insertAnalysis("열화 유지 스텁 산업");
    await expect(pipeline.runSizingPipeline(db, aid)).resolves.toBeUndefined();
    const matrix = matrixOf(aid);
    // no excerpts anywhere → zero extraction calls (발췌 날조 금지)
    expect(extractionPrompts()).toHaveLength(0);
    // the honest LLM-prior path stays exactly as before
    expect(llmStub.prompts.join("\n")).toContain("공개된 시장 성장률 컨센서스");
    expect(llmStub.prompts.join("\n")).toContain("미래 시장 전망치");
    expect(matrix.consistency.topDownCagr).toBe(0);
    expect(matrix.consistency.source).toBeUndefined();
    expect(referenceRows(industryId)).toHaveLength(0);
    // R7 cost bound unchanged
    expect(pipeline.getQuantSearchQueryCountForTests()).toBe(10);
  });
});

// ── case 8: structural pins (house source-assertion pattern) ──
describe("structural pins — market-sizing-pipeline.ts wiring", () => {
  const source = (): string => readFileSync(join(ROOT, "app/web-next/lib/market-sizing-pipeline.ts"), "utf8");
  test("the helper forwards the playwright options only behind a deadline; constants mirror the profile pipeline", () => {
    const s = source();
    expect(s).toContain("opts.deadlineAt !== undefined");
    expect(s).toContain("playwright: true");
    expect(s).toContain("deadlineAt: opts.deadlineAt");
    expect(s).toContain("playwrightQueries: SIZING_PLAYWRIGHT_QUERIES");
    expect(s).toContain("const SIZING_SEARCH_DEADLINE_MS = 30_000");
    expect(s).toContain("const SIZING_PLAYWRIGHT_QUERIES = 2");
    // the consumption amendment — the discard is gone, the pure helper owns the rule
    expect(s).toContain("excerptsFromChainResult(r)");
    expect(s).not.toContain("if (r.quotaExceeded) return []");
  });
  test("the run-scoped deadline is computed once and passed to BOTH consensus-tier call sites", () => {
    const s = source();
    expect(s).toContain("const webGroundingDeadline = Date.now() + SIZING_SEARCH_DEADLINE_MS");
    expect(s.match(/\{ deadlineAt: webGroundingDeadline \}/g)?.length).toBe(2);
  });
});
