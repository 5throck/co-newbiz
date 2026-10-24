// @version 1.0.0
/**
 * ADR-0172 amendment 2026-10-14 (3): S3 AI actions.
 *  A. "필요 역량 제안 (AI)" works from synergy areas, the S2 sketch and the S1 factors (source kind per row).
 *  B. "보유 판정 확인 (AI)": Playwright headless provider in the web-research chain, per-row 미판정 reasons,
 *     optional same-group scope, unverified profile claims are non-citable, degraded profiles are flagged.
 * Fakes only: no network, no browser, no real LLM (CO_NEWBIZ_LLM_PROVIDER=none, provider/Playwright overrides).
 */
import { test, expect, describe, beforeAll, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(ROOT, "db/data/test-capability-ai-sources.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const cg = await import("../../app/web-next/lib/capability-gap.ts");
const dr = await import("../../app/web-next/lib/capability-gap-necessity-draft.ts");
const hc = await import("../../app/web-next/lib/capability-holding-check.ts");
const hx = await import("../../app/web-next/lib/capability-holding-context.ts");
const hr = await import("../../app/web-next/lib/capability-holding-run.ts");
const rq = await import("../../app/web-next/lib/capability-requirement-sources.ts");
const rd = await import("../../app/web-next/lib/capability-requirement-draft.ts");
const wr = await import("../../app/web-next/lib/web-research.ts");
const ps = await import("../../app/web-next/lib/playwright-search.ts");
const pd = await import("../../app/web-next/lib/profile-degraded.ts");

const NOW = new Date().toISOString();
const SYSTEM = { role: "system" as const, content: "sys" };
const ok = (text: string) => ({ ok: true as const, text, finishReason: "stop" });

// ───────────────────────── A. requirement proposal sources ─────────────────────────

describe("A. requirement proposal evidence base (routes, no LLM)", () => {
  const USER = "src-analyst";
  let cookie = "";
  const req = (path: string, init?: RequestInit) => nextRequest(path, init);
  const mkOpp = (cols: Record<string, string | null> = {}) => {
    const id = ulid();
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, sketch_json, factors_json, rationale, value_chain_node) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [id, "소스 기회", "산업", "selected", USER, NOW, cols.sketch ?? null, cols.factors ?? null, cols.rationale ?? null, cols.node ?? null]);
    return id;
  };
  const post = (id: string, body: unknown) => req(`/api/opportunities/${id}/capability-gap/llm-draft`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
  beforeAll(async () => {
    await createUser(db, { userId: USER, role: "analyst", password: `pw-${USER}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: USER, approvedBy: "test", now: NOW });
    db.run("UPDATE app_user SET must_change_password = 0");
    const login = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: USER, password: `pw-${USER}-12345` }) });
    cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
  });

  test("zero rows + only the S2 sketch: rows seeded with source s2_sketch and the shared origin label", async () => {
    const id = mkOpp({ sketch: JSON.stringify({ requiredCapabilities: ["스택 설계", "BOP 통합"] }) });
    const res = await post(id, { rows: [] });
    expect(res.status).toBe(200);
    const d = ((await res.json()) as any).data;
    expect(d.rows.map((r: any) => r.capability)).toEqual(["스택 설계", "BOP 통합"]);
    expect(d.rows.every((r: any) => r.source === "s2_sketch" && r.necessity === "" && r.requiredLevel === "")).toBe(true);
    expect(d.rows[0].requiredNote.startsWith(`${cg.gapSourceLabel("s2_sketch", true)} — `)).toBe(true);
    expect(d.note).toContain("근거: S2 스케치");
    expect(d.note).not.toContain("시너지 영역·");
    expect((db.query("SELECT capability_gap_json j FROM opportunity WHERE id = ?").get(id) as { j: string | null }).j).toBeNull();
  });
  test("zero rows + only S1 factors / rationale: rows seeded with source s1_factors", async () => {
    const id = mkOpp({ factors: JSON.stringify({ opportunity: ["수요 증가 대응 설비", "인증 확보"], risk: ["규제"] }), rationale: "성장 시장" });
    const d = ((await (await post(id, {})).json()) as any).data;
    expect(d.rows.map((r: any) => r.capability)).toEqual(["수요 증가 대응 설비", "인증 확보"]);
    expect(d.rows.every((r: any) => r.source === "s1_factors")).toBe(true);
    expect(d.rows[0].requiredNote.startsWith(`${cg.gapSourceLabel("s1_factors", true)} — `)).toBe(true);
    expect(d.note).toContain("근거: S1 요인");
  });
  test("zero rows + synergy areas stays synergy_area; sketch and S1 add rows after it, deduped, note lists every source used", async () => {
    const id = mkOpp({ sketch: JSON.stringify({ requiredCapabilities: ["정밀 가공 노하우", "스택 설계"] }), factors: JSON.stringify({ opportunity: ["인증 확보"], risk: [] }) });
    const sa = ulid();
    db.run("INSERT INTO synergy_analysis (id, company_id, status, current_step, created_by, created_at, opportunity_id) VALUES (?,?,?,?,?,?,?)", [sa, "md-synergy-registry-sentinel", "completed", 3, "test", NOW, id]);
    db.run("INSERT INTO synergy_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)", [ulid(), sa, 1, JSON.stringify({ marketLinkage: { synergyAreas: [{ area: "정밀가공 노하우" }] } }), "test", NOW]);
    const d = ((await (await post(id, { rows: [] })).json()) as any).data;
    expect(d.rows.map((r: any) => [r.capability, r.source])).toEqual([["정밀가공 노하우", "synergy_area"], ["스택 설계", "s2_sketch"], ["인증 확보", "s1_factors"]]);
    expect(d.note).toContain("근거: 시너지 영역·S2 스케치·S1 요인");
  });
  test("nothing at all (no rows, no synergy, no sketch, no S1 content): precise 400 naming what to do", async () => {
    const id = mkOpp();
    const res = await post(id, { rows: [] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("no_rows");
    expect(body.error.message).toContain("시너지 분석 실행, S2 스케치 작성 또는 S1 요인 입력");
  });
  test("the opportunity name / market scope alone do not count as evidence", () => {
    expect(rq.buildRequirementSources({ oppName: "x", marketScope: "산업", valueChainNode: "노드" })).toEqual([]);
    expect(rq.buildRequirementSources({ oppName: "x", marketScope: null, rationale: "근거 있음" }).map((b) => b.kind)).toEqual(["s1_factors"]);
  });
  test("v2 sketch canvas (activities/resources) is a source when requiredCapabilities is absent", () => {
    const blocks = rq.buildRequirementSources({ oppName: "x", marketScope: null, sketchJson: JSON.stringify({ schema: 2, canvas: { keyResources: [{ text: "시험 설비" }], keyActivities: [{ text: "조립" }] } }) });
    expect(blocks[0].kind).toBe("s2_sketch");
    expect(blocks[0].names).toEqual(["시험 설비", "조립"]);
    expect(blocks[0].text).toContain("핵심 자원: 시험 설비");
  });
  test("requiredNote wording: shared label first, never duplicated", () => {
    expect(rq.sourcedRequiredNote("s2_sketch", "스택 필요")).toBe("S2 스케치에서 도출 — 스택 필요");
    expect(rq.sourcedRequiredNote("s2_sketch", "S2 스케치에서 도출 — 이미 있음")).toBe("S2 스케치에서 도출 — 이미 있음");
    expect(rq.sourcedRequiredNote("s1_factors", "")).toBe("S1 요인에서 도출");
    expect(rq.sourcedRequiredNote("synergy_area", "시너지 영역 X에서 도출 — 사유")).toBe("시너지 영역 X에서 도출 — 사유");
  });
});

describe("A. requirement proposal with a fake LLM", () => {
  const blocks = rq.buildRequirementSources({ oppName: "o", marketScope: "m", sketchJson: JSON.stringify({ requiredCapabilities: ["스택 설계"] }), factorsJson: JSON.stringify({ opportunity: ["인증"], risk: [] }), rationale: "r" });
  const ctx = { oppName: "o", marketScope: "m", synergyAreasText: "", extraSourcesText: blocks.map((b) => `${b.heading}\n${b.text}`).join("\n\n"), sourceKinds: blocks.map((b) => b.kind) };
  test("new rows carry the source kind the LLM names; unknown kinds fall back to the first available; prompt labels every block", async () => {
    const prompts: string[] = [];
    const call = async (messages: any[]) => {
      prompts.push(messages.at(-1).content);
      return ok(JSON.stringify({ newRows: [
        { capability: "스택 조립", source: "s2_sketch", requiredNote: "스케치 항목", necessity: "essential", requiredLevel: "양산", basis: { necessity: "b", requiredLevel: "b" } },
        { capability: "인증 대응", source: "s1_factors", requiredNote: "요인 인증", necessity: "optional", requiredLevel: "취득", basis: { necessity: "b", requiredLevel: "b" } },
        { capability: "엉뚱", source: "synergy_area", requiredNote: "", necessity: "optional", requiredLevel: "x", basis: { necessity: "b", requiredLevel: "b" } },
      ] }));
    };
    const out = await rd.runRequirementDraft({ system: SYSTEM, ctx, current: [], call });
    expect(out.rows.map((r: any) => [r.capability, r.source])).toEqual([["스택 조립", "s2_sketch"], ["인증 대응", "s1_factors"], ["엉뚱", "s2_sketch"]]);
    expect(out.rows[0].requiredNote).toBe("S2 스케치에서 도출 — 스케치 항목");
    expect(out.rows[1].requiredNote).toBe("S1 요인에서 도출 — 요인 인증");
    expect(out.rows[0].necessity).toBe("essential");
    expect(prompts[0]).toContain("[S2 비즈니스 모델 스케치]");
    expect(prompts[0]).toContain("[S1 요인·기회 정보]");
    expect(prompts[0]).toContain("s2_sketch|s1_factors");
    expect(out.answered).toBe(true);
  });
});

// ───────────────────────── B1. Playwright provider in the chain ─────────────────────────

describe("B1. web-research chain: Playwright last, opt-in, diagnosed, breaker-aware", () => {
  const fake = (name: string, status: string, sources: any[] = [], http?: number) => ({
    name, unavailable: () => null as null, calls: 0,
    async search() { (this as any).calls++; return { sources, status, http }; },
  });
  const PW = [{ title: "브라우저 결과", url: "https://example.com/pw", snippet: "s" }];
  // Sibling test files blank the search keys at module level and bun runs every file
  // in one process — a blank landing inside a B1 test sends gatherHoldingSources down
  // its not-configured early return (rowsNotSearched undefined). The fakes here never
  // read these keys; only the configuration gate does. Pin a deterministically
  // configured state per test and restore whatever the process had.
  const SEARCH_ENV_KEYS = ["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY", "SERPER_API_KEY", "WEB_SEARCH_DDG_ENABLED"] as const;
  let savedSearchEnv: Array<[string, string | undefined]> = [];
  beforeEach(() => {
    savedSearchEnv = SEARCH_ENV_KEYS.map((k) => [k, process.env[k]]);
    if (!process.env.TAVILY_API_KEY?.trim()) process.env.TAVILY_API_KEY = "test";
    delete process.env.WEB_SEARCH_DDG_ENABLED;
  });
  afterEach(() => {
    for (const [k, v] of savedSearchEnv) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    wr.setWebProvidersForTests(null); wr.resetWebResearchStateForTests(); ps.setPlaywrightSearchOverrideForTests(null); delete process.env.WEB_SEARCH_PLAYWRIGHT_ENABLED;
  });

  test("after Tavily quota and DuckDuckGo block it runs last and its status is in the diagnostics list", async () => {
    wr.setWebProvidersForTests([fake("tavily", "quota_exceeded", [], 432) as any, fake("ddg", "blocked") as any]);
    ps.setPlaywrightSearchOverrideForTests(PW);
    const r = await wr.researchSourcesDetailed(["q"], 8, { playwright: true });
    expect(r.sources.map((s) => s.url)).toEqual(["https://example.com/pw"]);
    expect(r.providers.map((p) => [p.name, p.status])).toEqual([["tavily", "quota_exceeded"], ["ddg", "blocked"], ["playwright", "ok"]]);
  });
  test("not attempted when an earlier provider found results", async () => {
    wr.setWebProvidersForTests([fake("tavily", "ok", [{ title: "t", url: "https://e.com/a", snippet: "" }]) as any]);
    ps.setPlaywrightSearchOverrideForTests(PW);
    const r = await wr.researchSourcesDetailed(["q"], 8, { playwright: true });
    expect(r.providers.map((p) => p.name)).toEqual(["tavily"]);
    expect(r.sources).toHaveLength(1);
  });
  test("other callers keep their behaviour: without the option Playwright is never in the chain", async () => {
    wr.setWebProvidersForTests([fake("tavily", "empty") as any]);
    ps.setPlaywrightSearchOverrideForTests(PW);
    const r = await wr.researchSourcesDetailed(["q"], 8);
    expect(r.providers.map((p) => p.name)).toEqual(["tavily"]);
    expect(r.sources).toEqual([]);
  });
  test("disabled in tests unless the override is set; opt-out switch WEB_SEARCH_PLAYWRIGHT_ENABLED=false wins", async () => {
    wr.setWebProvidersForTests([fake("tavily", "empty") as any]);
    const none = await wr.researchSourcesDetailed(["q"], 8, { playwright: true });
    expect(none.providers.find((p) => p.name === "playwright")?.status).toBe("disabled");
    ps.setPlaywrightSearchOverrideForTests(PW);
    process.env.WEB_SEARCH_PLAYWRIGHT_ENABLED = "false";
    expect(wr.isPlaywrightProviderEnabled()).toBe(false);
    const off = await wr.researchSourcesDetailed(["q"], 8, { playwright: true });
    expect(off.providers.find((p) => p.name === "playwright")?.status).toBe("disabled");
    delete process.env.WEB_SEARCH_PLAYWRIGHT_ENABLED;
    expect(wr.isPlaywrightProviderEnabled()).toBe(true);
  });
  test("empty override is reported as empty; the caller's deadline stops it from starting", async () => {
    wr.setWebProvidersForTests([fake("tavily", "empty") as any]);
    ps.setPlaywrightSearchOverrideForTests([]);
    const empty = await wr.researchSourcesDetailed(["q"], 8, { playwright: true });
    expect(empty.providers.find((p) => p.name === "playwright")?.status).toBe("empty");
    wr.resetWebResearchStateForTests();
    wr.setWebProvidersForTests([fake("tavily", "empty") as any]);
    ps.setPlaywrightSearchOverrideForTests(PW);
    const late = await wr.researchSourcesDetailed(["q"], 8, { playwright: true, deadlineAt: Date.now() + 1000 });
    expect(late.providers.map((p) => p.name)).toEqual(["tavily"]);
  });
  test("a blocked / unavailable Playwright opens the circuit breaker (next call is skipped, not relaunched)", async () => {
    const pw = fake("playwright", "unavailable");
    wr.setWebProvidersForTests([fake("tavily", "empty") as any, pw as any]);
    const a = await wr.researchSourcesDetailed(["q"], 8, { playwright: true });
    expect(a.providers.find((p) => p.name === "playwright")?.status).toBe("unavailable");
    expect(wr.isProviderCircuitOpen("playwright")).toBe(true);
    const b = await wr.researchSourcesDetailed(["q"], 8, { playwright: true });
    expect(pw.calls).toBe(1);
    expect(b.providers.find((p) => p.name === "playwright")).toMatchObject({ status: "unavailable", circuitOpen: true });
    expect(wr.providerFailureCauses(a.providers).some((c) => c.includes("Playwright"))).toBe(true);
  });
  test("holding-check search uses it: all other providers down, Playwright supplies the sources and shows in providers", async () => {
    wr.setWebProvidersForTests([fake("tavily", "quota_exceeded", [], 432) as any, fake("ddg", "blocked") as any]);
    ps.setPlaywrightSearchOverrideForTests(PW);
    const row = cg.normalizeGapRows([{ id: "r1", capability: "스택 설계" }])[0];
    const res = await hc.gatherHoldingSources([row], ["A사"], "산업", true);
    expect(res.sources.length).toBeGreaterThan(0);
    expect(res.failureNote).toBeNull();
    expect(res.providers?.map((p) => p.name)).toContain("playwright");
    expect(res.providers?.find((p) => p.name === "playwright")?.status).toBe("ok");
  });
  test("when Playwright is also unavailable the probe fails fast and the note names it", async () => {
    wr.setWebProvidersForTests([fake("tavily", "quota_exceeded", [], 432) as any, fake("playwright", "unavailable") as any]);
    const row = cg.normalizeGapRows([{ id: "r1", capability: "스택 설계" }])[0];
    const res = await hc.gatherHoldingSources([row], ["A사"], "산업", true);
    expect(res.sources).toEqual([]);
    expect(res.rowsNotSearched).toBe(1);
    expect(res.failureNote).toContain("Playwright");
  });
  test("playwright-search exports the detailed form; CHROME_PATH and the dynamic import stay; env names are documented", () => {
    const src = readFileSync(join(ROOT, "app/web-next/lib/playwright-search.ts"), "utf8");
    expect(src).toContain("playwrightSearchDetailed");
    expect(src).toContain("CHROME_PATH");
    expect(src).toContain("dynamicImport");
    for (const f of [".env.sample", "app/web-next/.env.sample"]) {
      const sample = readFileSync(join(ROOT, f), "utf8");
      expect(sample).toContain("WEB_SEARCH_PLAYWRIGHT_ENABLED");
      expect(sample).toContain("CHROME_PATH");
    }
  });
});

// ───────────────────────── B2. per-row reasons ─────────────────────────

describe("B2. 미판정 reasons", () => {
  test("normalize: reads basis.reason | reason | held.reason, strips tags/control chars, caps at 120", () => {
    expect(hc.normalizeUnevaluatedReason({ basis: { reason: "프로필에 <b>관련</b> 정보 없음\n" } })).toBe("프로필에 관련 정보 없음");
    expect(hc.normalizeUnevaluatedReason({ reason: "a".repeat(300) })).toHaveLength(120);
    expect(hc.normalizeUnevaluatedReason({ held: { reason: "근거 부족" } })).toBe("근거 부족");
    expect(hc.normalizeUnevaluatedReason({ basis: "문자열" })).toBe("");
    expect(hc.normalizeUnevaluatedReason(null)).toBe("");
  });
  test("summary: most common first, top 3 plus the rest", () => {
    expect(hc.topReasonSummary({ 근거부족: 4, 프로필없음: 8 })).toBe("프로필없음 (8건) · 근거부족 (4건)");
    expect(hc.topReasonSummary({ a: 5, b: 4, c: 3, d: 2, e: 1 })).toBe("a (5건) · b (4건) · c (3건) · 그 외 3건");
    expect(hc.topReasonSummary(undefined)).toBe("");
  });
  const rows = ["r1", "r2", "r3", "r4"].map((id) => cg.normalizeGapRows([{ id, capability: `역량${id}` }])[0]);
  const search = { sources: [], perRow: {}, queries: 0, failureNote: "검색 없음", skippedRows: 0 };
  const base = { system: SYSTEM, oppName: "o", marketScope: null, current: rows, targets: rows, profileLines: ["- A사 · 강점 [검증됨]: x"], profileNames: ["A사"], search, profileScope: "사용한 프로필 1곳(A사)", scopeNote: "", webEnabled: false };
  test("run: reasons per row, grouped in the note, all-unevaluated heuristic names the profile; nothing hardcoded", async () => {
    const call = async () => ok(JSON.stringify({ rows: [
      { id: "r1", held: { status: "unevaluated" }, basis: { reason: "프로필에 해당 분야 정보 없음" } },
      { id: "r2", held: { status: "unevaluated" }, basis: { reason: "프로필에 해당 분야 정보 없음" } },
      { id: "r3", held: { status: "unevaluated" }, basis: { reason: "근거 부족" } },
      { id: "r4", held: { status: "unevaluated" } },
    ] }));
    const out = await hr.runHoldingCheck({ ...base, call });
    expect(out.unevaluatedReasons).toMatchObject({ r1: "프로필에 해당 분야 정보 없음", r3: "근거 부족", r4: "LLM이 사유 없이 미판정으로 답함" });
    expect(out.note).toContain("미판정 사유: 프로필에 해당 분야 정보 없음 (2건) · 근거 부족 (1건)");
    expect(out.note).toContain("사용한 프로필(A사)에 이 사업 기회의 역량 관련 정보가 없습니다. 다른 계열사 프로필을 포함하거나 프로필을 보강하세요.");
    expect(out.rows.every((r: any) => r.held.status === "unevaluated")).toBe(true); // reasons are transient, not stored in the register
    expect(JSON.stringify(out.rows)).not.toContain("프로필에 해당 분야");
  });
  test("run: the heuristic is silent when something was proposed; group scope variant drops the 'include other affiliates' advice", async () => {
    const call = async () => ok(JSON.stringify({ rows: [{ id: "r1", held: { status: "partial", currentLevel: "일부", evidence: "A사 강점" }, basis: { held: "A사 강점 인용", heldSource: "profile" } }] }));
    const out = await hr.runHoldingCheck({ ...base, call });
    expect(out.note).not.toContain("역량 관련 정보가 없습니다");
    const none = await hr.runHoldingCheck({ ...base, call: async () => ok(JSON.stringify({ rows: [{ id: "zz", held: { status: "unevaluated" } }] })), groupScope: { requested: true, extraNames: ["B사"], note: hx.groupScopeNote(["B사"], 1) } });
    expect(none.note).toContain("프로필을 보강하세요.");
    expect(none.note).not.toContain("다른 계열사 프로필을 포함하거나");
    expect(none.note).toContain("그룹 내 다른 계열사 근거 포함: B사");
  });
  test("prompt asks for basis.reason (<=120 chars, Korean) on unevaluated rows", () => {
    const p = hc.buildHoldingPrompt({ oppName: "o", marketScope: null, rows: rows.slice(0, 1), profileLines: [], search });
    expect(p).toContain("basis.reason");
    expect(p).toContain("120자");
    expect(p).toContain('"reason"');
  });
  test("UI: reason on the 보유 판정 cell as title + aria-describedby + visible text, transient state only", () => {
    const tab = readFileSync(join(ROOT, "app/web-next/components/stages/synergy/SynergyCapabilityTab.tsx"), "utf8");
    // i18n: the visible reason label moved to the catalog — pin the key (stages.s3.synergyCapabilityTab.reasonNotJudged).
    for (const k of ["holdReasons[r.id]", "aria-describedby", 't("reasonNotJudged")', 't("alsoReferencesOtherAffiliateProfiles")', 'type="checkbox"']) expect(tab).toContain(k);
    const hook = readFileSync(join(ROOT, "app/web-next/components/stages/synergy/useSynergyResult.ts"), "utf8");
    expect(hook).toContain("includeGroupMembers: includeGroup");
    expect(hook).toContain("unevaluatedReasons");
  });
});

// ───────────────────────── B3. group scope ─────────────────────────

describe("B3. optional same-group scope", () => {
  const m = (id: string, name: string, group: string) => ({ id, company_name: name, group_id: group });
  const all = [m("1", "가", "g1"), m("2", "나", "g1"), m("3", "다", "g1"), m("4", "라", "g2"), ...Array.from({ length: 12 }, (_, i) => m(`x${i}`, `계열${String(i).padStart(2, "0")}`, "g1"))];
  test("adds only the other members of the scoped member's group, capped at 8, stable order", () => {
    const extra = hx.selectGroupExtraMembers(all, [all[0]]);
    expect(extra).toHaveLength(8);
    expect(extra.every((x: any) => x.group_id === "g1" && x.id !== "1")).toBe(true);
    expect(extra.map((x: any) => x.id)).toEqual(hx.selectGroupExtraMembers(all, [all[0]]).map((x: any) => x.id));
    expect(hx.selectGroupExtraMembers(all, [all[3]]).map((x: any) => x.id)).toEqual([]); // g2 has no other member
  });
  test("nothing to add when the scope already is the whole registry", () => {
    expect(hx.selectGroupExtraMembers(all, all)).toEqual([]);
  });
  test("note names the companies used, the semantics, and the empty cases", () => {
    const n = hx.groupScopeNote(["나", "다"], 2);
    expect(n).toContain("그룹 내 다른 계열사 근거 포함: 나, 다");
    expect(n).toContain("선택한 회사·그룹 기준");
    expect(hx.groupScopeNote([], 0)).toContain("다른 계열사가 없어");
    expect(hx.groupScopeNote([], 3)).toContain("프로필이 없어");
  });
  test("prompt names the extra companies and requires the company name in the evidence", () => {
    const row = cg.normalizeGapRows([{ id: "r1", capability: "역량" }])[0];
    const s = { sources: [], perRow: {}, queries: 0, failureNote: null, skippedRows: 0 };
    const p = hc.buildHoldingPrompt({ oppName: "o", marketScope: null, rows: [row], profileLines: [], search: s, extraCompanyNames: ["나", "다"] });
    expect(p).toContain("[참고 범위]");
    expect(p).toContain("나, 다");
    expect(p).toContain("evidence 본문에 회사명을 반드시 적고");
    expect(hc.buildHoldingPrompt({ oppName: "o", marketScope: null, rows: [row], profileLines: [], search: s })).not.toContain("[참고 범위]");
  });
  test("route reads includeGroupMembers === true only (default off)", () => {
    const src = readFileSync(join(ROOT, "app/web-next/app/api/opportunities/[id]/capability-gap/holding-check/route.ts"), "utf8");
    expect(src).toContain("body.includeGroupMembers === true");
    expect(src).toContain("selectGroupExtraMembers(allMembers, scoped)");
  });
});

// ───────────────────────── B4. unverified profile claims ─────────────────────────

describe("B4. profile verification state", () => {
  const profile = (over: Record<string, unknown> = {}) => ({
    companyName: "A사", dartCorpCode: null, dartFinancials: {},
    strengths: ["핵심 기술 보유"], weaknesses: ["규모 작음"], businessAssessment: "사업 평가 문장", industryExposure: ["산업1"],
    researchSources: [], dataSources: { dart: true, dartYear: "2025", webResearchCount: 0 },
    stepSummaries: [{ step: 1, title: "DART", summary: "재무 입수", source: "dart" }, { step: 3, title: "SWOT", summary: "도출", source: "llm" }],
    swot: { opportunities: ["기회"], threats: ["위협"] },
    verificationLedger: [
      { item: "DART 재무제표 입수 (2025, 10계정)", status: "confirmed", evidence: "url" },
      { item: "강점: 핵심 기술 보유", status: "needs_judgement", evidence: "LLM 추정 — 분석가 확인 필요" },
      { item: "약점: 규모 작음", status: "needs_judgement", evidence: "LLM 추정 — 분석가 확인 필요" },
    ],
    ...over,
  }) as any;
  test("no research: header says so, every qualitative line is labelled unverified, nothing is citable", () => {
    const ev = hx.profileEvidence("A사", profile());
    expect(ev.researched).toBe(false);
    expect(ev.citable).toBe(false);
    expect(ev.lines[0]).toContain("외부 검색 근거 없이 생성되어 미검증");
    expect(ev.lines.find((l: string) => l.includes("강점"))).toContain("[미검증 — LLM 추정]");
    expect(ev.lines.find((l: string) => l.includes("사업 평가"))).toContain("[미검증 — 검색 근거 없이 생성]");
    expect(ev.lines.find((l: string) => l.includes("분석 단계 DART"))).toContain("[검증됨 — 공시·결정론]");
  });
  test("a confirmed ledger item is [검증됨] and citable; research-backed fields without a ledger entry are citable", () => {
    const ev = hx.profileEvidence("A사", profile({ strengths: ["검증된 강점"], verificationLedger: [{ item: "강점: 검증된 강점", status: "confirmed", evidence: "공시" }] }));
    expect(ev.lines.find((l: string) => l.includes("강점"))).toContain("[검증됨]");
    expect(ev.citable).toBe(true);
    const researched = hx.profileEvidence("A사", profile({ dataSources: { dart: true, dartYear: "2025", webResearchCount: 3 } }));
    expect(researched.researched).toBe(true);
    expect(researched.lines.find((l: string) => l.includes("사업 평가"))).toContain("[검색 근거 기반");
    expect(researched.lines.find((l: string) => l.includes("강점"))).toContain("[미검증 — LLM 추정]"); // ledger still wins
    expect(researched.citable).toBe(true);
    expect(researched.lines.some((l: string) => l.includes("안내:"))).toBe(false);
  });
  const raw = { held: { status: "average", currentLevel: "수준", evidence: "A사 강점" }, basis: { held: "A사 강점 인용", heldSource: "profile" } };
  const ctx = { allowedSources: [] as number[], sources: [] as any[], profileNames: ["A사"] };
  test("normalizer: a judged status backed only by an unverified profile is dropped with the specific reason", () => {
    const r = dr.judgeCitedHeldDraft(raw, { ...ctx, verifiedProfileNames: [] });
    expect(r.cited).toBeNull();
    expect(r.reason).toBe("unverified_profile");
    expect(dr.HELD_DROP_LABEL.unverified_profile).toBe("프로필 근거가 미검증(LLM 추정)");
  });
  test("normalizer: verified profile, disclosure fact or a cited web source still justify a judgement", () => {
    expect(dr.judgeCitedHeldDraft(raw, { ...ctx, verifiedProfileNames: ["A사"] }).cited?.origins).toEqual(["profile"]);
    expect(dr.judgeCitedHeldDraft({ ...raw, basis: { held: "공시 수치", heldSource: "dart" } }, { ...ctx, verifiedProfileNames: [], disclosureNames: ["A사"] }).cited?.origins).toEqual(["dart"]);
    const web = dr.judgeCitedHeldDraft({ ...raw, sources: [1] }, { allowedSources: [1], sources: [{ title: "t", url: "https://e.com/a", snippet: "" }], profileNames: ["A사"], verifiedProfileNames: [] });
    expect(web.cited?.origins).toEqual(["web"]); // the unverified profile is not counted as an origin
  });
  test("normalizer: without verifiedProfileNames the old behaviour is kept (back-compat)", () => {
    expect(dr.judgeCitedHeldDraft(raw, ctx).cited?.origins).toEqual(["profile"]);
  });
  test("run: unverified-only profile -> all rows 미판정 with the reason, and the note says the profile text is unverified", async () => {
    const rows = ["r1", "r2"].map((id) => cg.normalizeGapRows([{ id, capability: `역량${id}` }])[0]);
    const call = async () => ok(JSON.stringify({ rows: rows.map((r: any) => ({ id: r.id, ...raw })) }));
    const out = await hr.runHoldingCheck({
      system: SYSTEM, oppName: "o", marketScope: null, current: rows, targets: rows, profileLines: ["- A사 · 강점 [미검증 — LLM 추정]: x"],
      profileNames: ["A사"], verifiedProfileNames: [], unverifiedProfileNames: ["A사"],
      search: { sources: [], perRow: {}, queries: 0, failureNote: null, skippedRows: 0 }, profileScope: "사용한 프로필 1곳(A사)", scopeNote: "", webEnabled: false, call,
    });
    expect(out.counts.proposed).toBe(0);
    expect(out.unevaluatedReasons.r1).toBe("프로필 근거가 미검증(LLM 추정)");
    expect(out.note).toContain("미판정 사유: 프로필 근거가 미검증(LLM 추정) (2건)");
    expect(out.note).toContain("프로필의 정성 내용이 검색 근거 없이 생성되어 미검증입니다 — 프로필을 검색 복구 후 다시 생성하세요.");
    expect(out.note).not.toContain("역량 관련 정보가 없습니다");
  });
  test("prompt tells the LLM not to cite [미검증] profile lines", () => {
    const row = cg.normalizeGapRows([{ id: "r1", capability: "역량" }])[0];
    const p = hc.buildHoldingPrompt({ oppName: "o", marketScope: null, rows: [row], profileLines: [], search: { sources: [], perRow: {}, queries: 0, failureNote: null, skippedRows: 0 } });
    expect(p).toContain("[미검증…] 표시가 붙은 줄은 LLM 추정");
  });
});

// ───────────────────────── B5. degraded profile ─────────────────────────

describe("B5. profile generated without search evidence is flagged degraded", () => {
  test("reason text and chip wording", () => {
    const r = pd.noResearchDegradedReason(["Tavily 쿼터 초과(432)", "DuckDuckGo 봇 차단"], true);
    expect(r).toBe("외부 검색 근거 없음 (Tavily 쿼터 초과(432), DuckDuckGo 봇 차단) — 정성 항목은 AI 추정이며 검증되지 않았습니다");
    expect(pd.noResearchDegradedReason([], false)).toContain("(웹 검색 미구성)");
    expect(pd.isNoResearchDegraded(r)).toBe(true);
    expect(pd.isNoResearchDegraded("LLM 응답 파싱 실패")).toBe(false);
    expect(pd.degradedChip(r).hint).toContain("검색이 복구되면 재분석");
    expect(pd.degradedChip("LLM 응답 파싱 실패").label).toBe("부분 분석(폴백)");
  });
  test("pipeline sets degraded when no sources came back, keeps the LLM-failure guard separate, and reports provider diagnostics", () => {
    const src = readFileSync(join(ROOT, "app/web-next/lib/company-profile-pipeline.ts"), "utf8");
    for (const k of ["researchSourcesDetailed", "providerFailureCauses(researchProviders)", "noResearchDegradedReason", "degraded = degraded ?? noResearchReason", "priorDegraded === null && llmDegraded"]) expect(src).toContain(k);
    expect(src).toContain("출처 0건 — ${noResearchReason}");
  });
  test("UI chip: icon + text, hint, used on every profile header; stored profiles are not rewritten", () => {
    const chips = readFileSync(join(ROOT, "app/web-next/components/stages/our-company/ProfileChips.tsx"), "utf8");
    expect(chips).toContain("export function DegradedChip");
    expect(chips).toContain('aria-hidden="true">!</span>');
    for (const f of ["components/stages/our-company/ProfileReport.tsx", "components/brownfield-target/TargetAiProfileTab.tsx", "components/stages/our-company/ProfileChips.tsx"]) {
      expect(readFileSync(join(ROOT, "app/web-next", f), "utf8")).toContain("<DegradedChip");
    }
  });
});
