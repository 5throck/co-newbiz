// @version 1.0.0
/**
 * ADR-0171 amendment 2026-10-15 (2): S5 entry strategy options (multi-select, one main) stored in the existing
 * entry_strategy column behind a backward-compatible header, plus "진출전략 제안 (AI)". Fake LLM only
 * (CO_NEWBIZ_LLM_PROVIDER=none for routes), temp DB, no network, nothing rendered in a browser.
 */
import { test, expect, describe, beforeAll } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(ROOT, "db/data/test-entry-strategy.sqlite");
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
const es = await import("../../app/web-next/lib/greenfield-entry-strategy.ts");
const ed = await import("../../app/web-next/lib/entry-strategy-draft.ts");
const jd = await import("../../app/web-next/lib/capability-judgement-draft.ts");
const cg = await import("../../app/web-next/lib/capability-gap.ts");
const { systemMessage } = await import("../../app/web-next/lib/prompts.ts");

const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const E = (modes: string[], main: string | null) => es.normalizeModes(modes, main);

describe("parser / serializer", () => {
  test("round trip with several modes and a main", () => {
    const raw = es.serializeEntryStrategy(E(["partner", "build"], "partner"), "근거 문장");
    expect(raw).toBe("[진출방식] build,partner*\n근거 문장");
    expect(es.parseEntryStrategy(raw)).toEqual({ modes: ["build", "partner"], main: "partner", rationale: "근거 문장" });
    expect(es.normalizeStoredEntryStrategy(raw)).toBe(raw);
  });
  test("legacy plain text reads as rationale-only with no modes and serializes unchanged", () => {
    const legacy = "핵심 역량은 직접 구축하고 물류는 제휴한다";
    expect(es.parseEntryStrategy(legacy)).toEqual({ modes: [], main: null, rationale: legacy });
    expect(es.serializeEntryStrategy({ modes: [], main: null }, legacy)).toBe(legacy);
    expect(es.parseEntryStrategy(null)).toEqual({ modes: [], main: null, rationale: "" });
  });
  test("header-only, unknown tokens and a header without a valid mode", () => {
    expect(es.serializeEntryStrategy(E(["hire"], null), "")).toBe("[진출방식] hire*");
    expect(es.parseEntryStrategy("[진출방식] hire*")).toEqual({ modes: ["hire"], main: "hire", rationale: "" });
    expect(es.parseEntryStrategy("[진출방식] bogus\n본문").modes).toEqual([]);
    expect(es.parseEntryStrategy("[진출방식] bogus\n본문").rationale).toContain("본문");
    expect(es.parseEntryStrategy("[진출방식] build,x,build*").modes).toEqual(["build"]);
  });
  test("exactly one main: single is automatic, removing the main reassigns, an invalid main falls back to the first", () => {
    expect(E(["invest"], null)).toEqual({ modes: ["invest"], main: "invest" });
    expect(es.parseEntryStrategy("[\uc9c4\ucd9c\ubc29\uc2dd] invest*,build").modes).toEqual(["build", "invest"]);
    expect(E(["hire", "build"], "invest")).toEqual({ modes: ["build", "hire"], main: "build" });
    let m = es.toggleMode({ modes: [], main: null }, "partner");
    expect(m).toEqual({ modes: ["partner"], main: "partner" });
    m = es.toggleMode(m, "hire");
    expect(m).toEqual({ modes: ["partner", "hire"], main: "partner" });
    m = es.normalizeModes(m.modes, "hire");
    expect(m.main).toBe("hire");
    m = es.toggleMode(m, "hire");
    expect(m).toEqual({ modes: ["partner"], main: "partner" });
    expect(es.toggleMode(m, "partner")).toEqual({ modes: [], main: null });
    expect(es.modesComplete(E(["build", "partner"], "partner"))).toBe(true);
    expect(es.modesComplete({ modes: ["build", "partner"], main: null })).toBe(false);
  });
  test("labelled text for downstream consumers", () => {
    expect(es.entryStrategyText("[진출방식] build*,partner\n핵심 격차 해소")).toBe("진출방식: 직접 구축(주), 전략 제휴 — 근거: 핵심 격차 해소");
    expect(es.entryStrategyText("[진출방식] partner*")).toBe("진출방식: 전략 제휴");
    expect(es.entryStrategyText("그냥 텍스트")).toBe("그냥 텍스트");
    expect(es.entryStrategyText(null)).toBe("");
  });
});

describe("caution helper and fill-empty-only merge", () => {
  test("resolutions outside the selected modes are listed; nothing when no mode is selected", () => {
    const rows = [{ capability: "금형", resolution: "build" as const }, { capability: "물류", resolution: "partner" as const }, { capability: "R&D", resolution: "hire" as const }, { capability: "미정", resolution: null }];
    expect(es.strategyMismatches(E(["build"], null), rows)).toEqual(["물류", "R&D"]);
    expect(es.strategyMismatches(E([], null), rows)).toEqual([]);
    expect(es.cautionText(["a", "b", "c", "d"])).toBe("진출전략에 없는 방식: a, b, c 외 1건");
    expect(es.cautionText(["물류"])).toBe("진출전략에 없는 방식: 물류");
  });
  const P = (over: Record<string, unknown> = {}) => ({ modes: [{ mode: "partner" as const, main: true, reason: "r" }, { mode: "build" as const, main: false, reason: "r2" }], rationale: "AI 근거문", alternatives: "AI 대안", basis: {}, cautions: [], ...over });
  test("fills only empty parts and marks them; human values are never overwritten", () => {
    const empty = es.mergeEntryProposal({ modes: { modes: [], main: null }, rationale: "", alternatives: "" }, P());
    expect(empty.marks).toEqual(["modes", "rationale", "alternatives"]);
    expect(empty.state.modes).toEqual({ modes: ["build", "partner"], main: "partner" });
    const human = es.mergeEntryProposal({ modes: { modes: ["hire"], main: "hire" }, rationale: "내 근거", alternatives: "" }, P());
    expect(human.state.modes).toEqual({ modes: ["hire"], main: "hire" });
    expect(human.state.rationale).toBe("내 근거");
    expect(human.marks).toEqual(["alternatives"]);
    const none = es.mergeEntryProposal({ modes: { modes: ["hire"], main: "hire" }, rationale: "a", alternatives: "b" }, P());
    expect(none.marks).toEqual([]);
  });
});

describe("AI normalizer", () => {
  test("valid modes only, exactly one main, caps, PII scrub, mode without reason dropped", () => {
    const n = ed.normalizeEntryProposal({
      modes: [{ mode: "partner", main: true, reason: "연락처 010-1234-5678 제휴가 빠름" }, { mode: "build", main: true, reason: "내재화" }, { mode: "bogus", reason: "x" }, { mode: "partner", reason: "중복" }, { mode: "invest", reason: "" }, "hire"],
      rationale: "가".repeat(900), alternatives: "나".repeat(900), basis: { modes: "S3 격차", assumption: "가정", rationale: "x" }, cautions: ["a@b.com 주의", ""], confidence: "high",
    })!;
    expect(n.modes.map((m) => m.mode)).toEqual(["build", "partner"]);
    expect(n.modes.filter((m) => m.main)).toHaveLength(1);
    expect(n.modes.find((m) => m.main)!.mode).toBe("partner");
    expect(n.modes.find((m) => m.mode === "partner")!.reason).not.toContain("010");
    expect(n.rationale.length).toBe(600);
    expect(n.alternatives.length).toBe(600);
    expect(n.cautions).toEqual(["주의"]);
    expect(n.basis.assumption).toBe("가정");
  });
  test("nothing usable -> null; label and Korean mode names accepted", () => {
    expect(ed.normalizeEntryProposal(null)).toBeNull();
    expect(ed.normalizeEntryProposal({ modes: [] })).toBeNull();
    expect(ed.normalizeEntryProposal({ modes: [{ mode: "전략 제휴", main: true, reason: "r" }] })!.modes[0].mode).toBe("partner");
  });
  test("capability evidence puts 필수 gaps first; S4 lines are empty without a record", () => {
    const rows = cg.normalizeGapRows([{ id: "a", capability: "보유", necessity: "essential", requiredLevel: "x", held: { status: "leading" } }, { id: "b", capability: "격차", necessity: "essential", requiredLevel: "y", held: { status: "none" } }]);
    const lines = ed.capabilityEvidenceLines(rows as any);
    expect(lines[0]).toContain("[핵심 격차] 격차");
    expect(ed.routeDecisionLines(db as any, "nope")).toEqual([]);
  });
});

describe("orchestrator with a fake LLM", () => {
  const base = { system: systemMessage("s5.entry_strategy_draft"), oppName: "기회", marketScope: "시장", capabilityLines: ["- [핵심 격차] 금형"], log: () => {} };
  test("success: proposal normalized, prompt carries S3 gaps and the proposal-only rules", async () => {
    let prompt = "";
    const res = await ed.runEntryStrategyDraft({ ...base, call: async (m: any[]) => { prompt = m[1].content; return { ok: true, text: JSON.stringify({ proposals: [{ id: "entry", modes: [{ mode: "build", main: true, reason: "격차" }], rationale: "금형 격차 해소", alternatives: "제휴는 일정", basis: { modes: "S3" } }] }) }; } });
    expect(res.source).toBe("llm");
    expect(res.proposal!.modes[0]).toMatchObject({ mode: "build", main: true });
    for (const k of ["핵심 격차", "S4", "정확히 하나만", "지어내지 마세요", "개인정보"]) expect(prompt + base.system.content).toContain(k);
    expect(res.note).toContain("외부 웹 검색은 쓰지 않았습니다");
  });
  test("failure and empty answers -> no proposal with a reason", async () => {
    const bad = await ed.runEntryStrategyDraft({ ...base, call: async () => ({ ok: false, text: "", reason: "x" }) });
    expect(bad.proposal).toBeNull();
    expect(bad.source).toBe("synthesis");
    const empty = await ed.runEntryStrategyDraft({ ...base, call: async () => ({ ok: true, text: JSON.stringify({ proposals: [{ id: "entry", modes: [] }] }) }) });
    expect(empty.proposal).toBeNull();
    expect(empty.note).toContain("근거가 부족");
  });
  test("registered prompt never asks for a decision", () => {
    const sys = systemMessage("s5.entry_strategy_draft").content;
    expect(sys).toContain("proposal");
    expect(sys).toContain("Do not fabricate");
  });
});

describe("consumers use the parsed text", () => {
  test("judgement-draft strategyText labels the modes", () => {
    const t = jd.strategyText({ entry_strategy: "[진출방식] partner*,hire\n제휴 우선", alternatives_considered: "구축 보류" });
    expect(t).toContain("진출방식: 전략 제휴(주), 인력 영입 — 근거: 제휴 우선");
    expect(t).not.toContain("[진출방식]");
    expect(jd.strategyText({ entry_strategy: "Build 선호" })).toContain("Build 선호");
  });
  test("recommendation, gate brief and charter read through entryStrategyText", () => {
    expect(read("app/web-next/app/api/greenfield/[oppId]/recommendation/route.ts")).toContain("entryStrategyText(assessment?.entry_strategy)");
    expect(read("app/web-next/lib/gate-brief.ts")).toContain("entryStrategyText(row.entry_strategy)");
    expect(read("app/web-next/lib/project-charter.ts")).toContain("entryStrategyText(gf?.entry_strategy)");
  });
});

describe("routes", () => {
  const OWNER = "entry-analyst", VIEWER = "entry-viewer";
  let cookie = "", vcookie = "", oppId = "";
  const req = (path: string, init?: RequestInit) => nextRequest(path, init);
  const login = async (u: string) => (await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: u, password: `pw-${u}-12345` }) })).headers.getSetCookie()[0]?.split(";")[0] ?? "";
  beforeAll(async () => {
    const NOW = new Date().toISOString();
    for (const [u, role] of [[OWNER, "analyst"], [VIEWER, "viewer"]] as const) {
      await createUser(db, { userId: u, role, password: `pw-${u}-12345`, createdBy: "test", now: NOW });
      approveUser(db, { userId: u, approvedBy: "test", now: NOW });
    }
    db.run("UPDATE app_user SET must_change_password = 0");
    cookie = await login(OWNER); vcookie = await login(VIEWER);
    oppId = ulid();
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "진출 기회", "산업", "selected", OWNER, NOW]);
  });
  const post = (id: string, c = cookie) => req(`/api/greenfield/${id}/entry-strategy-draft`, { method: "POST", headers: { cookie: c }, body: "{}" });
  const count = () => (db.query("SELECT COUNT(*) n FROM greenfield_assessment").get() as { n: number }).n;

  test("draft route without an LLM: 200 synthesis, empty proposal, writes nothing; viewer 403; unknown 404", async () => {
    const before = count();
    const res = await post(oppId);
    expect(res.status).toBe(200);
    const d = ((await res.json()) as any).data;
    expect(d.proposal).toBeNull();
    expect(d.source).toBe("synthesis");
    expect(d.note).toContain("LLM 미구성");
    expect(count()).toBe(before);
    expect((await post(oppId, vcookie)).status).toBe(403);
    expect((await post("nope")).status).toBe(404);
  });
  test("route source: proposal only, same permission as the assessment save, no web search", () => {
    const src = read("app/web-next/app/api/greenfield/[oppId]/entry-strategy-draft/route.ts");
    expect(src).toContain('requireBusinessActor(auth.auth, "write"');
    expect(src).not.toMatch(/db\.run|INSERT|UPDATE |DELETE |appendAudit|researchSources|gatherHoldingSources/);
    expect(src).toContain("s5.entry_strategy_draft");
  });
  test("in-process table: draft route resolves and is not human-only", async () => {
    const { isHumanOnly, matchRoute } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
    expect(matchRoute("/api/greenfield/x/entry-strategy-draft")).not.toBeNull();
    expect(isHumanOnly("POST", "/api/greenfield/x/entry-strategy-draft", {})).toBe(false);
  });
  test("saving stores the canonical header in the existing column; legacy text stays plain", async () => {
    const save = (entry_strategy: string) => req(`/api/greenfield/${oppId}`, { method: "POST", headers: { cookie }, body: JSON.stringify({ entry_strategy, alternatives_considered: "대안" }) });
    expect((await save("[진출방식] partner,build*\n근거")).status).toBe(200);
    const stored = () => (db.query("SELECT entry_strategy e FROM greenfield_assessment WHERE opportunity_id = ?").get(oppId) as { e: string }).e;
    expect(stored()).toBe("[진출방식] build*,partner\n근거");
    expect((await save("옛날 글")).status).toBe(200);
    expect(stored()).toBe("옛날 글");
    const got = ((await (await req(`/api/greenfield/${oppId}`, { headers: { cookie } })).json()) as any).data;
    expect(got.assessment.entry_strategy).toBe("옛날 글");
  });
  test("omitting fields keeps the stored values (strategy-only save keeps capability lines; lines-only save keeps the strategy)", async () => {
    const stored = () => db.query("SELECT entry_strategy e, alternatives_considered a, business_case_lines_json j FROM greenfield_assessment WHERE opportunity_id = ?").get(oppId) as { e: string; a: string; j: string };
    const lines = JSON.stringify([{ line: "임대", category: "opex", amount: 10, amountUnit: "krw_m", currency: "KRW", period: "yearly" }, { source: "capability", capabilityKey: "kept", reflected: true, category: "capex", amount: 3000, amountUnit: "krw_m", currency: "KRW", period: "lumpsum", line: "x 역량 해소" }]);
    db.run("UPDATE greenfield_assessment SET business_case_lines_json = ? WHERE opportunity_id = ?", [lines, oppId]);
    const post = (body: unknown) => req(`/api/greenfield/${oppId}`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
    expect((await post({ entry_strategy: "[진출방식] hire*\n새 근거", alternatives_considered: "새 대안" })).status).toBe(200);
    const after = stored();
    expect(after.j).toBe(lines); // business_case_lines omitted -> stored capability lines untouched
    expect(after.e).toBe("[진출방식] hire*\n새 근거");
    expect((await post({ business_case_lines: [{ line: "임대", category: "opex", amount: 12, amountUnit: "krw_m", currency: "KRW", period: "yearly" }] })).status).toBe(200);
    const again = stored();
    expect(again.e).toBe("[진출방식] hire*\n새 근거"); // entry_strategy omitted -> kept
    expect(again.a).toBe("새 대안");
    expect(JSON.parse(again.j)).toHaveLength(1);
  });
});

describe("registration and UI structure", () => {
  test("eval call-site, openapi, MCP draft tool (no decision tool)", () => {
    expect(read("tests/eval/call-sites.yaml")).toContain("greenfield/[oppId]/entry-strategy-draft/route.ts");
    expect(read("docs/architecture/openapi.yaml")).toContain("/api/greenfield/{oppId}/entry-strategy-draft:");
    const tools = read("mcp/co-newbiz/tools/stage-tools.ts");
    expect(tools).toContain('name: "draft_entry_strategy"');
    expect(tools).toContain("/api/greenfield/{opportunityId}/entry-strategy-draft");
  });
  test("section: four options, main marker, exactly two textareas, caps, AI chips, no 'choose among' heading", () => {
    const sec = read("app/web-next/components/stages/EntryStrategySection.tsx");
    expect(sec.match(/<textarea/g)).toHaveLength(2);
    // i18n: labels moved to the catalog (stages.s5.entryStrategy / common) — pin the key call sites.
    for (const k of ["ENTRY_MODES.map", 'type="checkbox"', 'type="radio"', 't("primaryMode")', 't("selectionEvidence")', 't("alternativesConsideredButNotChosen")', "ENTRY_RATIONALE_CAP", "ENTRY_ALTERNATIVES_CAP", "rows={3}", "rows={2}",
      't("entryStrategyProposalAi")', 'tc("unsavedAiDraft")', 'tc("discardAiDraft")', 't("theResolutionMethodJudgementsBelow")', 't("aiEvidence")', "cautionText(mismatches)", "/entry-strategy-draft", 'aria-hidden="true">✦']) expect(sec).toContain(k);
    expect(sec).toContain('{t("entryStrategy")}</h3>');
    expect(sec).not.toMatch(/[0-9]\uFE0F\u20E3/);
    expect(sec).not.toContain("중 선택");
    expect(sec).toContain("canAct &&");
    expect(es.ENTRY_RATIONALE_CAP).toBe(600);
    expect(es.ENTRY_ALTERNATIVES_CAP).toBe(600);
    for (const m of es.ENTRY_MODES) expect(es.ENTRY_MODE_LABEL[m].length).toBeGreaterThan(0);
    expect(Object.values(es.ENTRY_MODE_LABEL)).toEqual(["\uc9c1\uc811 \uad6c\ucd95", "\uc804\ub7b5 \uc81c\ud734", "\uc778\ub825 \uc601\uc785", "\uc9c0\ubd84 \ud22c\uc790"]);
    expect(es.ENTRY_MODES).toContain("invest");
    expect(es.ENTRY_MODE_HINT.invest).not.toMatch(/\uc778\uc218|M&A/);
  });
  test("page: old textareas replaced by the section, save serializes modes, refetch keeps unsaved edits", () => {
    const page = read("app/web-next/components/stages/GreenfieldStage.tsx");
    expect(page).toContain("<EntryStrategySection");
    expect(page).not.toContain('aria-label="진출전략"');
    expect(page).not.toContain('aria-label="검토한 대안"');
    expect(page).not.toContain("중 선택)");
    expect(page).toContain("serializeEntryStrategy(entryModes, entryStrategy)");
    expect(page).toContain("!entryDirty.current");
    expect(page).toContain("parseEntryStrategy(r.data.assessment?.entry_strategy)");
  });
});
