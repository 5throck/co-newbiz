// @version 1.0.0
/**
 * Company-profile headless-Chrome search fallback and DART-grounded content separation
 * (design 2026-11-13-profile-headless-fallback, DEC-20261113-06): test plan cases 1-6.
 *   1. Pure-function reason/chip variants (dart-aware split, prefix preserved).
 *   2. Chain integration: the Playwright provider engages only after a fully-blocked base chain,
 *      respects WEB_SEARCH_PLAYWRIGHT_ENABLED=false (zero launches) and surfaces unavailable.
 *   3. Pipeline structural wiring (playwright options, provenance flag, dart-grounding call shape).
 *   4. Basis normalization pure function (financial|estimate whitelist, legacy strings, truncation).
 *   5. Offline pipeline end-to-end: DART found -> split degraded wording + itemBasis + grounded
 *      ledger wording (needs_judgement); DART missing -> the exact unchanged wording (regression).
 *   6. Analyst edit resets the edited indexes' basis to estimate; degraded clearing unchanged.
 * Fakes only: injected providers, Playwright override, stubbed DART fetch, fake LLM transport
 * (CO_NEWBIZ_LLM_PROVIDER=none). No real network, no real browser, no real LLM.
 */
import { test, expect, describe, afterAll, beforeEach } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
// Type-only namespace (runtime usages go through the `wr` namespace below).
import type * as wrT from "../../app/web-next/lib/web-research.ts";

const ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(ROOT, "db/data/test-profile-headless-fallback.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
// bun test may run sibling files in flight: blank keys are remembered and restored in afterAll.
const BLANKED_ENV_KEYS = [
  "DART_API_KEY",
  "TAVILY_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "SERPER_API_KEY",
  "WEB_SEARCH_DDG_ENABLED",
  "WEB_SEARCH_PLAYWRIGHT_ENABLED",
  "CHROME_PATH",
] as const;
const BLANKED_ENV_ORIGINALS = BLANKED_ENV_KEYS.map((k) => [k, process.env[k]] as const);
process.env.DART_API_KEY = "";
process.env.TAVILY_API_KEY = "";
process.env.WEB_SEARCH_DDG_ENABLED = "false";
delete process.env.WEB_SEARCH_PLAYWRIGHT_ENABLED;
delete process.env.CHROME_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const wr = await import("../../app/web-next/lib/web-research.ts");
const ps = await import("../../app/web-next/lib/playwright-search.ts");
const pd = await import("../../app/web-next/lib/profile-degraded.ts");
const pipe = await import("../../app/web-next/lib/company-profile-pipeline.ts");
const edit = await import("../../app/web-next/lib/profile-analyst-edit.ts");

const NOW = new Date().toISOString();

afterAll(async () => {
  pipe._profileJobs.clear();
  wr.setWebResearchOverrideForTests(null);
  ps.setPlaywrightSearchOverrideForTests(null);
  wr.resetWebResearchStateForTests();
  for (const [k, v] of BLANKED_ENV_ORIGINALS) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

const src = (u: string) => ({ title: `헤드리스 ${u}`, url: `https://${u}.example.com/x`, snippet: "헤드리스 스니펫" });
function fake(
  name: wrT.ProviderName,
  status: wrT.ProviderStatus,
  http?: number,
  sources: wrT.WebSource[] = [],
): wrT.SearchProvider {
  return { name, unavailable: () => null, search: async () => ({ sources, status, http }) };
}

// ── case 1: pure-function reason/chip variants ──
describe("case 1: noResearchDegradedReason / degradedChip dart variants", () => {
  test("DART found: prefix preserved, DART success stated, qualitative-only disclaimer kept", () => {
    const r = pd.noResearchDegradedReason(
      ["Tavily 쿼터 초과(432)", "Brave Search 쿼터 초과(429)", "Playwright 봇 차단"],
      true,
      {
        found: true,
        years: "2019 / 2023",
        accounts: 40,
      },
    );
    expect(r).toStartWith(pd.NO_RESEARCH_DEGRADED_PREFIX);
    expect(r).toContain("DART 재무는 정상 입수(2019 / 2023, 40계정)");
    expect(r).toContain("Tavily 쿼터 초과(432), Brave Search 쿼터 초과(429), Playwright 봇 차단");
    expect(r).toEndWith("정성 항목(강점·약점·SWOT·경쟁)만 AI 추정이며 검증되지 않았습니다");
    // downstream prefix consumers (chip suppression, analyst-edit clearing, holding labels) keep matching
    expect(pd.isNoResearchDegraded(r)).toBe(true);
  });
  test("unconfigured search keeps the (웹 검색 미구성) cause and the DART clause", () => {
    const r = pd.noResearchDegradedReason([], false, { found: true, years: "2025", accounts: 7 });
    expect(r).toContain("(웹 검색 미구성)");
    expect(r).toContain("DART 재무는 정상 입수(2025, 7계정)");
  });
  test("DART missing: exactly the current string (no softening)", () => {
    expect(pd.noResearchDegradedReason(["Tavily 쿼터 초과(432)"], true)).toBe(
      "외부 검색 근거 없음 (Tavily 쿼터 초과(432)) — 정성 항목은 AI 추정이며 검증되지 않았습니다",
    );
    expect(pd.noResearchDegradedReason([], true, { found: false, years: "", accounts: 0 })).toBe(
      "외부 검색 근거 없음 — 정성 항목은 AI 추정이며 검증되지 않았습니다",
    );
  });
  test("chip: dartGrounded split label, legacy call stays backward-compatible", () => {
    const r = pd.noResearchDegradedReason(["Tavily 쿼터 초과(432)"], true, {
      found: true,
      years: "2025",
      accounts: 35,
    });
    expect(pd.degradedChip(r, true).label).toBe("검색 근거 없음 — 재무는 공시 기반, 정성 항목 미검증(AI 추정)");
    expect(pd.degradedChip(r, true).hint).toBe("검색이 복구되면 재분석해 프로필을 다시 생성하세요.");
    expect(pd.degradedChip(r).label).toBe("검색 근거 없음 — 정성 항목 미검증(AI 추정)");
    expect(pd.degradedChip(r).hint).toBe(pd.degradedChip(r, true).hint);
    expect(pd.degradedChip("LLM 응답 파싱 실패", true).label).toBe("부분 분석(폴백)");
  });
});

// ── case 2: chain integration ──
describe("case 2: chain-integrated Playwright fallback", () => {
  beforeEach(() => {
    // Per-test setup, not cross-file assumptions: sibling suites run in flight
    // in the same process and two of them set the web-research override at
    // import time without clearing it — testOverride short-circuits
    // researchSourcesDetailed BEFORE the provider chain, so clear it here
    // before installing this suite's own fakes.
    wr.setWebResearchOverrideForTests(null);
    wr.resetWebResearchStateForTests();
    ps.setPlaywrightSearchOverrideForTests(null);
    delete process.env.WEB_SEARCH_PLAYWRIGHT_ENABLED;
    delete process.env.CHROME_PATH;
  });
  test("engages only after a fully-blocked base chain and flows headless sources into the same result", async () => {
    wr.setWebProvidersForTests([fake("tavily", "quota_exceeded", 432)]);
    ps.setPlaywrightSearchOverrideForTests([src("h1"), src("h2")]);
    const rescued = await wr.researchSourcesDetailed(["q1", "q2"], 12, {
      playwright: true,
      deadlineAt: Date.now() + 30_000,
      playwrightQueries: 2,
    });
    expect(rescued.sources.map((s) => s.url)).toEqual(["https://h1.example.com/x", "https://h2.example.com/x"]);
    expect(rescued.providers.map((p) => [p.name, p.status])).toEqual([
      ["tavily", "quota_exceeded"],
      ["playwright", "ok"],
    ]);
    expect(wr.providerFailureCauses(rescued.providers)).toEqual(["Tavily 쿼터 초과(432)"]);
    // a base provider with results must stop the chain before the Playwright provider (last resort only)
    wr.resetWebResearchStateForTests();
    wr.setWebProvidersForTests([fake("tavily", "ok", undefined, [src("t1")])]);
    const normal = await wr.researchSourcesDetailed(["q"], 12, { playwright: true, deadlineAt: Date.now() + 30_000 });
    expect(normal.sources.map((s) => s.url)).toEqual(["https://t1.example.com/x"]);
    expect(normal.providers.map((p) => p.name)).toEqual(["tavily"]);
  });
  test("WEB_SEARCH_PLAYWRIGHT_ENABLED=false never launches (override sources would have been returned otherwise)", async () => {
    wr.setWebProvidersForTests([fake("tavily", "quota_exceeded", 432)]);
    ps.setPlaywrightSearchOverrideForTests([src("must-not-appear")]);
    process.env.WEB_SEARCH_PLAYWRIGHT_ENABLED = "false";
    const r = await wr.researchSourcesDetailed(["q"], 12, { playwright: true, deadlineAt: Date.now() + 30_000 });
    expect(r.sources).toHaveLength(0);
    expect(r.providers.map((p) => [p.name, p.status])).toEqual([
      ["tavily", "quota_exceeded"],
      ["playwright", "disabled"],
    ]);
    // "disabled" is a deliberate opt-out, not a failure: no Playwright cause in the degraded reason
    expect(wr.providerFailureCauses(r.providers)).toEqual(["Tavily 쿼터 초과(432)"]);
  });
  test("a deadline with too little time left skips the browser session", async () => {
    wr.setWebProvidersForTests([fake("tavily", "quota_exceeded", 432)]);
    ps.setPlaywrightSearchOverrideForTests([src("too-late")]);
    const r = await wr.researchSourcesDetailed(["q"], 12, { playwright: true, deadlineAt: Date.now() + 1_000 });
    expect(r.sources).toHaveLength(0);
    expect(r.providers.find((p) => p.name === "playwright")).toBeUndefined();
  });
  test("no Chrome under a real (non-test) environment surfaces unavailable with its cause label", async () => {
    const savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.CHROME_PATH = "/nonexistent/chrome-for-tests";
    try {
      wr.setWebProvidersForTests([fake("tavily", "quota_exceeded", 432)]);
      const r = await wr.researchSourcesDetailed(["q"], 12, { playwright: true, deadlineAt: Date.now() + 30_000 });
      expect(r.providers.find((p) => p.name === "playwright")?.status).toBe("unavailable");
      expect(wr.providerFailureCauses(r.providers)).toContain("Playwright 실행 불가(Chrome 없음 또는 기동 실패)");
    } finally {
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedNodeEnv;
      delete process.env.CHROME_PATH;
    }
  });
});

// ── case 3: pipeline structural wiring ──
describe("case 3: pipeline structural assertions", () => {
  const psrc = () => readFileSync(join(ROOT, "app/web-next/lib/company-profile-pipeline.ts"), "utf8");
  test("step 2 passes the playwright options with the deadline budget; provenance flag in dataSources", () => {
    const s = psrc();
    expect(s).toContain("playwright: true");
    expect(s).toContain("deadlineAt: Date.now() + PROFILE_SEARCH_DEADLINE_MS");
    expect(s).toContain("playwrightQueries: PROFILE_PLAYWRIGHT_QUERIES");
    expect(s).toContain("const PROFILE_SEARCH_DEADLINE_MS = 30_000");
    expect(s).toContain("const PROFILE_PLAYWRIGHT_QUERIES = 2");
    expect(s).toContain("webResearchPlaywright: true");
    expect(s).toContain("Playwright headless 검색으로 근거를 확보했습니다");
  });
  test("step 3 receives the deterministic DART block and the basis normalization is exported", () => {
    const s = psrc();
    expect(s).toContain("DART 공시 재무(검증된 원데이터");
    expect(s).toContain("normalizeSwotItems");
    expect(s).toContain("basisLedgerEntry");
    expect(s).toContain("재무 기반 — ");
    expect(typeof pipe.normalizeSwotItems).toBe("function");
  });
});

// ── case 4: basis normalization pure function ──
describe("case 4: normalizeSwotItems", () => {
  test("objects keep text, whitelist b, align indexes; nonsense and bare strings become estimate", () => {
    const n = pipe.normalizeSwotItems([
      { t: "매출 성장", b: "financial" },
      { t: "리서치 기반", b: "nonsense" },
      "레거시 문자열",
      { t: "  " },
      { b: "financial" },
    ]);
    expect(n.items).toEqual(["매출 성장", "리서치 기반", "레거시 문자열"]);
    expect(n.basis).toEqual(["financial", "estimate", "estimate"]);
  });
  test("legacy bare-string arrays behave exactly like the old arr() (empty dropped, cap 5)", () => {
    const n = pipe.normalizeSwotItems(["a", "", "  b  ", "c", "d", "e", "f"]);
    expect(n.items).toEqual(["a", "  b  ", "c", "d", "e"]);
    expect(n.basis).toEqual(["estimate", "estimate", "estimate", "estimate", "estimate"]);
  });
  test("non-array and empty inputs yield empty output", () => {
    expect(pipe.normalizeSwotItems(undefined).items).toEqual([]);
    expect(pipe.normalizeSwotItems("문자열").items).toEqual([]);
    expect(pipe.normalizeSwotItems([])).toEqual({ items: [], basis: [] });
  });
});

// ── cases 5 + 6: offline pipeline end-to-end ──
let seq = 0;
const fakeComplete =
  (qualitative: string, seen?: { messages: Array<{ role: string; content: string }> }) =>
  async (messages: Array<{ role: string; content: string }>) => {
    if (seen && seen.messages.length === 0) seen.messages = messages;
    return {
      source: "llm" as const,
      provider: "fake",
      text:
        messages.some((m) => m.content.includes("경쟁사")) && !messages.some((m) => m.content.includes("강점"))
          ? JSON.stringify({ competitors: [], positioning: "" })
          : qualitative,
    };
  };

/** Qualitative LLM response with per-item basis tags (prompt contract §6.3). */
const qualitativeJson = JSON.stringify({
  strengths: [
    { t: "매출 성장세 지속", b: "financial" },
    { t: "근거 없는 강점", b: "estimate" },
  ],
  weaknesses: [{ t: "부채 비중 높음", b: "financial" }],
  opportunities: [{ t: "건설기계 교체 수요", b: "estimate" }],
  threats: [{ t: "원자재 가격 상승", b: "estimate" }],
  businessAssessment: "건설기계 부품 제조사.",
  industryExposure: ["건설기계"],
});

function stubDartFetch(): () => void {
  const original = globalThis.fetch;
  // Revenue varies by year so the derived ratios are non-trivial; the summation check passes
  // (자산총계 2000억 = 부채총계 1200억 + 자본총계 800억).
  const revenueByYear: Record<string, string> = {
    "2021": "80000000000",
    "2022": "90000000000",
    "2023": "100000000000",
    "2024": "90000000000",
    "2025": "110000000000",
  };
  globalThis.fetch = Object.assign(
    (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("company.json")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "000", corp_name: "수산세보틱스" }), {
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url.includes("fnlttSinglAcntAll.json")) {
        const params = new URL(url).searchParams;
        const list = [
          { account_nm: "매출액", thstrm_amount: revenueByYear[params.get("bsns_year") ?? ""] ?? "80000000000" },
          { account_nm: "매출원가", thstrm_amount: "50000000000" },
          { account_nm: "영업이익", thstrm_amount: "10000000000" },
          { account_nm: "당기순이익", thstrm_amount: "5000000000" },
          { account_nm: "자산총계", thstrm_amount: "200000000000" },
          { account_nm: "부채총계", thstrm_amount: "120000000000" },
          { account_nm: "자본총계", thstrm_amount: "80000000000" },
        ];
        return Promise.resolve(
          new Response(JSON.stringify({ status: "000", list }), { headers: { "content-type": "application/json" } }),
        );
      }
      // disclosures list / any other endpoint: nothing found (013) — cross-check degrades non-fatally
      return Promise.resolve(
        new Response(JSON.stringify({ status: "013" }), { headers: { "content-type": "application/json" } }),
      );
    },
    { preconnect: (_url: string | URL) => {} },
  ) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function insertMember(companyName: string, dartCorpCode: string | null): string {
  seq += 1;
  const gid = `g${seq}`;
  const mid = `m${seq}`;
  db.run("INSERT INTO company_group (id, name, created_by, created_at) VALUES (?,?,?,?)", [
    gid,
    `그룹 ${seq}`,
    "test",
    NOW,
  ]);
  db.run(
    "INSERT INTO company_group_member (id, group_id, company_name, dart_corp_code, role, created_at) VALUES (?,?,?,?,?,?)",
    [mid, gid, companyName, dartCorpCode, "hq", NOW],
  );
  return mid;
}

const profile = (mid: string) => pipe.loadLatestProfile(db, { kind: "member", id: mid })!;

describe("case 5: DART found + search fully blocked -> split wording, itemBasis, grounded ledger", () => {
  test("degraded states the DART success, items carry the basis tags, ledger stays needs_judgement", async () => {
    const restoreFetch = stubDartFetch();
    process.env.DART_API_KEY = ["dart", "test", "key"].join("-");
    wr.setWebResearchOverrideForTests({ configured: true, sources: [] }); // short-circuits BEFORE the provider chain
    try {
      const mid = insertMember("수산세보틱스", "00126380");
      const seen = { messages: [] as Array<{ role: string; content: string }> };
      await pipe.runCompanyProfilePipeline(db, pipe.resolveMemberSubject(db, mid), "test", {
        deps: { complete: fakeComplete(qualitativeJson, seen) as never },
      });
      const p = profile(mid);

      // AC-3: BOTH the (empty) provider causes and the DART clause; years and account count stated
      expect(p.degraded).toStartWith("외부 검색 근거 없음");
      expect(p.degraded).toContain("DART 재무는 정상 입수(2025 / 2024 / 2023 / 2022 / 2021, 35계정)");
      expect(p.degraded).toContain("정성 항목(강점·약점·SWOT·경쟁)만 AI 추정이며 검증되지 않았습니다");
      expect(p.dataSources.dart).toBe(true);
      expect(p.dataSources.webResearchCount).toBe(0);
      expect(p.dataSources.webResearchPlaywright).toBeUndefined();

      // D-C: the step-3 prompt actually carried the deterministic block
      const userPrompt = seen.messages.find((m) => m.role === "user")!.content;
      expect(userPrompt).toContain("DART 공시 재무(검증된 원데이터 — 이 블록의 수치는 인용 가능)");
      expect(userPrompt).toContain("매출액(억원): 2021 800, 2022 900, 2023 1000, 2024 900, 2025 1100");
      expect(userPrompt).toContain("영업이익률");

      // AC-5: basis tags normalized index-aligned; text arrays unchanged
      expect(p.itemBasis).toEqual({
        strengths: ["financial", "estimate"],
        weaknesses: ["financial"],
        opportunities: ["estimate"],
        threats: ["estimate"],
      });
      expect(p.strengths).toEqual(["매출 성장세 지속", "근거 없는 강점"]);
      // note: bun's toMatchObject mutates the received object when an asymmetric matcher is
      // involved — assert status and evidence separately instead.
      const sLedger = p.verificationLedger!.find((l) => l.item.startsWith("강점: 매출 성장세"));
      expect(sLedger?.status).toBe("needs_judgement");
      expect(sLedger?.evidence).toContain("재무 기반");
      expect(sLedger?.evidence).toContain("DART 재무에서 도출(LLM 추론)");
      expect(p.verificationLedger!.find((l) => l.item.startsWith("강점: 근거 없는"))!.evidence).toBe(
        "LLM 추정 — 분석가 확인 필요",
      );
      expect(p.verificationLedger!.find((l) => l.item.startsWith("약점: 부채"))!.evidence).toContain("재무 기반");

      // chip label variants per dataSources.dart
      expect(pd.degradedChip(p.degraded!, true).label).toContain("재무는 공시 기반");
      expect(pd.degradedChip(p.degraded!, false).label).toBe("검색 근거 없음 — 정성 항목 미검증(AI 추정)");
      // schemaVersion unchanged, additive fields only
      const wrapper = JSON.parse(
        (db.query("SELECT payload FROM company_profile_version WHERE member_id = ?").get(mid) as { payload: string })
          .payload,
      ) as { schemaVersion: number; profile: Record<string, unknown> };
      expect(wrapper.schemaVersion).toBe(3);
      expect(wrapper.profile.strengths).toEqual(["매출 성장세 지속", "근거 없는 강점"]);
    } finally {
      restoreFetch();
      wr.setWebResearchOverrideForTests(null);
      wr.resetWebResearchStateForTests();
    }
  });
  test("AC-4 regression: the offline no-DART path produces the exact current degraded string, and financial claims are clamped to estimate", async () => {
    wr.setWebResearchOverrideForTests({ configured: true, sources: [] });
    try {
      const mid = insertMember("수산세보틱스", null);
      // qualitativeJson claims b:"financial" although the DART block was never in the prompt —
      // the honesty clamp must downgrade every tag to estimate (no fabricated provenance).
      await pipe.runCompanyProfilePipeline(db, pipe.resolveMemberSubject(db, mid), "test", {
        deps: { complete: fakeComplete(qualitativeJson) as never },
      });
      const p = profile(mid);
      expect(p.degraded).toBe("외부 검색 근거 없음 — 정성 항목은 AI 추정이며 검증되지 않았습니다");
      expect(p.dataSources.dart).toBe(false);
      expect(p.itemBasis).toEqual({
        strengths: ["estimate", "estimate"],
        weaknesses: ["estimate"],
        opportunities: ["estimate"],
        threats: ["estimate"],
      });
      // the would-be-financial item keeps the PLAIN estimate wording — never a financial-grounding claim
      expect(p.verificationLedger!.find((l) => l.item.startsWith("강점: 매출 성장세"))?.evidence).toBe(
        "LLM 추정 — 분석가 확인 필요",
      );
      expect(JSON.stringify(p.verificationLedger)).not.toContain("재무 기반");
    } finally {
      wr.setWebResearchOverrideForTests(null);
    }
  });
});

describe("case 6: analyst edit resets the edited indexes' basis to estimate", () => {
  test("edited index clears, unchanged index keeps financial; degraded clearing behavior unchanged", async () => {
    // a DART-found run so the itemBasis actually carries financial tags (design §6.7 semantics)
    const restoreFetch = stubDartFetch();
    process.env.DART_API_KEY = ["dart", "test", "key"].join("-");
    wr.setWebResearchOverrideForTests({ configured: true, sources: [] });
    try {
      const mid = insertMember("수산세보틱스", "00126380");
      await pipe.runCompanyProfilePipeline(db, pipe.resolveMemberSubject(db, mid), "test", {
        deps: { complete: fakeComplete(qualitativeJson) as never },
      });
      const before = profile(mid);
      expect(before.degraded).toStartWith("외부 검색 근거 없음");
      expect(before.itemBasis!.strengths).toEqual(["financial", "estimate"]);

      const res = edit.applyFieldOverrides(db, { kind: "member", id: mid }, "alice", {
        strengths: ["매출 성장세 지속", "분석가가 수정한 강점"],
        reason: "공시 확인",
      });
      expect(res.fields).toEqual(["strengths"]);
      const p = profile(mid);
      expect(p.strengths).toEqual(["매출 성장세 지속", "분석가가 수정한 강점"]);
      expect(p.itemBasis!.strengths).toEqual(["financial", "estimate"]); // index 0 unchanged keeps its tag; the rewritten index 1 was already estimate
      expect(p.weaknesses).toEqual(before.weaknesses);
      expect(p.itemBasis!.weaknesses).toEqual(["financial"]);

      // a financial-grounded edited index resets: replace index 0 too
      const res2 = edit.applyFieldOverrides(db, { kind: "member", id: mid }, "alice", {
        strengths: ["완전히 새로운 강점"],
        reason: "전면 수정",
      });
      expect(res2.fields).toEqual(["strengths"]);
      const p2 = profile(mid);
      expect(p2.itemBasis!.strengths).toEqual(["estimate"]);
      // degraded stays (no analyst evidence added)
      expect(p2.degraded).toStartWith("외부 검색 근거 없음");
    } finally {
      restoreFetch();
      wr.setWebResearchOverrideForTests(null);
      wr.resetWebResearchStateForTests();
    }
  });
  test("old payloads without itemBasis render unchanged (no reset crash)", async () => {
    const mid = insertMember("수산세보틱스", null);
    const legacy = {
      companyName: "수산세보틱스",
      strengths: ["기존 강점"],
      weaknesses: [],
      businessAssessment: "",
      industryExposure: [],
      researchSources: [],
      dataSources: { dart: false, dartYear: null, webResearchCount: 0 },
      verificationLedger: [],
      degraded: null,
    };
    db.run(
      "INSERT INTO company_profile_version (id, member_id, version_no, payload, source_ref, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
      [
        `v${seq}`,
        mid,
        1,
        JSON.stringify({ methodology: "company-profile v3", schemaVersion: 3, profile: legacy }),
        null,
        "alice",
        NOW,
      ],
    );
    const res = edit.applyFieldOverrides(db, { kind: "member", id: mid }, "alice", {
      strengths: ["바뀐 강점"],
      reason: "확인",
    });
    expect(res.fields).toEqual(["strengths"]);
    expect(profile(mid).itemBasis).toBeUndefined();
  });
});

// ── UI structural pins (test plan case 5, UI part) ──
describe("UI structure", () => {
  const read = (f: string) => readFileSync(join(ROOT, f), "utf-8");
  test("grounding chip renders only when itemBasis AND dartFinancials.available are present; locale keys exist in en+ko", () => {
    // the chip lives next to its sibling chips in ProfileEvidence.tsx; the SWOT tab consumes it
    const evidence = read("app/web-next/components/stages/our-company/ProfileEvidence.tsx");
    expect(evidence).toContain("export function FinancialGroundedChip");
    expect(evidence).toContain('t("financialGroundedChip")');
    expect(evidence).toContain("profile.dartFinancials?.available");
    expect(evidence).toContain('profile.itemBasis?.[field]?.[index] !== "financial"');
    const swot = read("app/web-next/components/stages/our-company/ProfileSwotTab.tsx");
    expect(swot).toContain("<FinancialGroundedChip");
    // locale JSON nests 4 deep under components.* and 2 deep under common.* — the intersection
    // type gives both paths without loosening to any.
    type LocaleJson = Record<string, Record<string, Record<string, Record<string, string>>>> & {
      common: Record<string, string>;
    };
    const ko = JSON.parse(read("app/web-next/locales/ko.json")) as LocaleJson;
    const en = JSON.parse(read("app/web-next/locales/en.json")) as LocaleJson;
    expect(ko.components.ourCompany.profileBasicTabs.financialGroundedChip).toBe("재무 기반");
    expect(en.components.ourCompany.profileBasicTabs.financialGroundedChip).toBe("Financial-grounded");
    expect(ko.common.headlessSearchChip).toBe("headless 검색");
    expect(en.common.headlessSearchChip).toBe("Headless search");
  });
  test("DegradedChip carries the dartGrounded prop and the headless provenance chip at all three render sites", () => {
    for (const f of [
      "app/web-next/components/stages/our-company/ProfileChips.tsx",
      "app/web-next/components/stages/our-company/ProfileReport.tsx",
      "app/web-next/components/brownfield-target/TargetAiProfileTab.tsx",
    ]) {
      expect(read(f)).toContain("dartGrounded");
      expect(read(f)).toContain("webResearchPlaywright");
    }
  });
});
