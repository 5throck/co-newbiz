// @version 1.0.0
/**
 * ADR-0171 amendment 2026-10-15: S5 "판정 제안 (AI)". Fake LLM only (CO_NEWBIZ_LLM_PROVIDER=none for routes), temp DB,
 * no network. Covers the normalizer, fill-empty-only, batching and partial failure, the proposal-only route (never
 * writes, never confirms), PII, stale rows, UI structure, the eval call-site and the openapi/MCP registration.
 */
import { test, expect, describe, beforeAll } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(ROOT, "db/data/test-capability-judgement-ai.sqlite");
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
const jd = await import("../../app/web-next/lib/capability-judgement-draft.ts");
const { systemMessage } = await import("../../app/web-next/lib/prompts.ts");

const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const row = (id: string, over: Record<string, unknown> = {}) => ({ ...cg.normalizeGapRows([{ id, capability: `역량 ${id}`, necessity: "essential", requiredLevel: "업계 상위", currentLevel: "부분 보유" }])[0], ...over }) as any;
const GOOD = (id: string, over: Record<string, unknown> = {}) => ({
  id, resolution: "partner", expectedLevel: "제휴사를 통해 양산 공정 접근", costKrwM: 800, monthsToAttain: 12, grade: "medium", rationale: "S3 보유 수준이 부분 보유이며 제휴로 공백을 메울 수 있다고 가정",
  basis: { resolution: "자체 구축 시간이 길다", expectedLevel: "필요 수준 대비", cost: "유사 제휴 규모 가정", months: "계약·이전 기간 가정", grade: "보유 수준 부분", estimate: "유사 사례 규모 가정" }, ...over,
});

describe("normalizer", () => {
  test("valid item keeps every field with its basis", () => {
    const n = jd.normalizeJudgementProposal(GOOD("a"));
    expect(n.proposal).toMatchObject({ resolution: "partner", costKrwM: 800, monthsToAttain: 12, grade: "medium" });
    expect(n.proposal!.basis.estimate).toContain("가정");
  });
  test("invalid resolution key, negative or absurd numbers are dropped with a reason", () => {
    const n = jd.normalizeJudgementProposal(GOOD("a", { resolution: "buy", costKrwM: -5, monthsToAttain: 9999 }));
    expect(n.proposal!.resolution).toBeNull();
    expect(n.proposal!.costKrwM).toBeNull();
    expect(n.proposal!.monthsToAttain).toBeNull();
    expect(Object.keys(n.unfilled)).toEqual(expect.arrayContaining(["resolution", "cost", "months"]));
    expect(jd.normalizeJudgementProposal(GOOD("a", { costKrwM: jd.COST_MAX_KRW_M + 1 })).proposal!.costKrwM).toBeNull();
  });
  test("a number without an estimate/basis is never accepted (no fabricated numbers)", () => {
    const n = jd.normalizeJudgementProposal(GOOD("a", { basis: { resolution: "r", expectedLevel: "e", grade: "g" } }));
    expect(n.proposal!.costKrwM).toBeNull();
    expect(n.proposal!.monthsToAttain).toBeNull();
    expect(n.unfilled.cost).toContain("근거");
  });
  test("caps expected level and rationale", () => {
    const n = jd.normalizeJudgementProposal(GOOD("a", { expectedLevel: "가".repeat(900), rationale: "나".repeat(900) }));
    expect(n.proposal!.expectedLevel).toHaveLength(cg.NARRATIVE_CAP);
    expect(n.proposal!.rationale).toHaveLength(jd.RATIONALE_CAP);
  });
  test("high/low grade without a rationale is downgraded to unjudged with a reason; medium may stand", () => {
    const low = jd.normalizeJudgementProposal(GOOD("a", { grade: "low", rationale: "" }));
    expect(low.proposal!.grade).toBeNull();
    expect(low.unfilled.grade).toContain("근거");
    expect(jd.normalizeJudgementProposal(GOOD("a", { grade: "medium", rationale: "" })).proposal!.grade).toBe("medium");
    expect(jd.normalizeJudgementProposal(GOOD("a", { grade: "높음" })).proposal!.grade).toBe("high");
  });
  test("PII is scrubbed from free text; garbage items give null", () => {
    const n = jd.normalizeJudgementProposal(GOOD("a", { rationale: "담당 hong@example.com 010-1234-5678 900101-1234567 확인 후 제휴" }));
    expect(n.proposal!.rationale).not.toMatch(/@|010-|900101/);
    expect(n.proposal!.rationale).toContain("제휴");
    expect(jd.normalizeJudgementProposal("x").proposal).toBeNull();
    expect(jd.normalizeJudgementProposal({ id: "a" }).proposal).toBeNull();
  });
});

describe("targets and fill-empty-only", () => {
  test("default targets: stale, unjudged, or lacking resolution/expected level; capped at 12", () => {
    const done = row("done", { resolution: "build", attainability: { ...cg.normalizeAttainability({})!, expectedLevel: "x", grade: "high", rationale: "r" } });
    const rows = [done, row("u1"), ...Array.from({ length: 14 }, (_, i) => row(`m${i}`))];
    const t = jd.selectJudgementTargets(rows);
    expect(t.targets.map((r: any) => r.id)).not.toContain("done");
    expect(t.targets).toHaveLength(jd.JUDGEMENT_ROW_CAP);
    expect(t.capped).toBe(3);
    expect(jd.selectJudgementTargets(rows, ["done", "nope"]).unknown).toEqual(["nope"]);
  });
  test("server strips fields the stored row already holds", () => {
    const r = row("a", { resolution: "hire", attainability: { ...cg.normalizeAttainability({})!, expectedLevel: "사람 값", rationale: "사람 근거" } });
    const p = jd.normalizeJudgementProposal(GOOD("a")).proposal!;
    const s = jd.emptyOnly(r, p);
    expect(s.proposal!.resolution).toBeNull();
    expect(s.proposal!.expectedLevel).toBe("");
    expect(s.proposal!.rationale).toBe("");
    expect(s.proposal!.grade).toBe("medium"); // medium needs no rationale; the stored row also keeps its own
  });
  test("client merge never overwrites a non-empty field and only marks what it filled", () => {
    const cur = { a: { resolution: "build", expectedLevel: "", cost: "", months: "6", grade: "", rationale: "", category: "", period: "" } };
    const p = jd.normalizeJudgementProposal(GOOD("a")).proposal!;
    const m = jd.mergeJudgementProposals(cur, { a: p });
    expect(m.drafts.a.resolution).toBe("build");
    expect(m.drafts.a.months).toBe("6");
    expect(m.drafts.a.cost).toBe("800");
    expect(m.marks.a).toEqual(expect.arrayContaining(["expectedLevel", "cost", "grade", "rationale"]));
    expect(m.marks.a).not.toContain("resolution");
    expect(m.marks.a).not.toContain("months");
    expect(jd.mergeJudgementProposals(m.drafts, { a: p }).applied).toBe(0);
  });
  test("stale rows: prior values stay, only empty fields get proposals", () => {
    const cur = { s: { resolution: "invest", expectedLevel: "이전 기대", cost: "", months: "", grade: "low", rationale: "이전 근거", category: "", period: "" } };
    const m = jd.mergeJudgementProposals(cur, { s: jd.normalizeJudgementProposal(GOOD("s")).proposal! });
    expect(m.drafts.s).toMatchObject({ resolution: "invest", expectedLevel: "이전 기대", grade: "low", rationale: "이전 근거", cost: "800", months: "12" });
  });
  test("category (분류): parsed with English tokens and Korean labels, needs its own basis, filled empty-only", () => {
    const basis = () => ({ ...GOOD("a").basis, category: "설비 견적 기반" });
    const ok = jd.normalizeJudgementProposal(GOOD("a", { category: "설비투자", basis: basis() })).proposal!;
    expect(ok.category).toBe("capex");
    expect(ok.basis.category).toBe("설비 견적 기반");
    expect(jd.normalizeJudgementProposal(GOOD("a", { category: "labor", basis: basis() })).proposal!.category).toBe("labor");
    expect(jd.normalizeJudgementProposal(GOOD("a", { category: "운영비", basis: basis() })).proposal!.category).toBe("opex");
    // an invalid value and a basis-less value are both declined with a reason
    const bad = jd.normalizeJudgementProposal(GOOD("a", { category: "tv" }));
    expect(bad.proposal!.category).toBeNull();
    expect(bad.unfilled.category).toContain("올바르지 않음");
    const noBasis = jd.normalizeJudgementProposal(GOOD("a", { category: "labor" }));
    expect(noBasis.proposal!.category).toBeNull();
    expect(noBasis.unfilled.category).toContain("근거");
    // the client merge fills only an empty category and marks it
    const pc = jd.normalizeJudgementProposal(GOOD("a", { category: "labor", basis: basis() })).proposal!;
    const m = jd.mergeJudgementProposals({ b: { resolution: "", expectedLevel: "", cost: "", months: "", grade: "", rationale: "", category: "", period: "" } }, { b: pc });
    expect(m.drafts.b.category).toBe("labor");
    expect(m.marks.b).toContain("category");
    // the server strips a category the stored row already holds (fill-empty-only)
    const held = jd.emptyOnly(row("a", { attainability: { ...cg.normalizeAttainability({})!, category: "opex" } }), pc);
    expect(held.kept).toContain("category");
    expect(held.proposal!.category).toBeNull();
  });
  test("a high grade is not merged without a rationale", () => {
    const m = jd.mergeJudgementProposals({ a: { resolution: "", expectedLevel: "", cost: "", months: "", grade: "", rationale: "", category: "", period: "" } }, { a: { resolution: null, expectedLevel: "", costKrwM: null, monthsToAttain: null, grade: "high", rationale: "", category: null } });
    expect(m.drafts.a.grade).toBe("");
  });
});

describe("orchestration with a fake LLM", () => {
  const targets = Array.from({ length: 9 }, (_, i) => row(`r${i}`));
  const ids = (msgs: any[]) => [...String(msgs[1].content).matchAll(/- id: (\S+)/g)].map((m) => m[1]);
  const run = (call: any) => jd.runJudgementDraft({ system: systemMessage("s5.capability_judgement_draft"), oppName: "기회", marketScope: "시장", targets, call, log: () => {} });

  test("batches of 4 rows, every row proposed, nothing confirmed", async () => {
    const seen: number[] = [];
    const res = await run(async (msgs: any[]) => { const i = ids(msgs); seen.push(i.length); return { ok: true, text: JSON.stringify({ rows: i.map((id) => GOOD(id)) }) }; });
    expect(seen.sort()).toEqual([1, 4, 4]);
    expect(res.source).toBe("llm");
    expect(res.counts).toMatchObject({ rows: 9, proposed: 9, failedRows: 0 });
    expect(JSON.stringify(res)).not.toMatch(/confirmed/);
    expect(res.note).toContain("9개 행 제안");
    expect(res.note).toContain("웹 검색은 쓰지 않았습니다");
  });
  test("one failed batch is retried once; a permanent failure gives an honest partial note with the category", async () => {
    let calls = 0;
    const res = await run(async (msgs: any[]) => {
      calls++;
      const i = ids(msgs);
      if (i.includes("r4")) return { ok: true, text: "죄송합니다 JSON이 아닙니다" };
      return { ok: true, text: JSON.stringify({ rows: i.map((id) => GOOD(id)) }) };
    });
    expect(calls).toBe(4); // 3 batches + 1 retry of the bad batch
    expect(res.counts.proposed).toBe(5);
    expect(res.counts.failedRows).toBe(4);
    expect(res.note).toContain("응답 오류");
    expect(res.note).toContain("형식 오류");
    expect(res.unfilled.r4).toBeDefined();
    expect(res.drafts.r4).toBeUndefined();
  });
  test("truncated array keeps the complete items", async () => {
    const res = await run(async (msgs: any[]) => { const i = ids(msgs); const full = JSON.stringify({ rows: i.map((id) => GOOD(id)) }); return { ok: true, text: i.length > 2 ? full.slice(0, Math.floor(full.length * 0.6)) : full }; });
    expect(res.counts.proposed).toBeGreaterThan(0);
  });
  test("every call failing returns synthesis and changes nothing", async () => {
    const res = await run(async () => ({ ok: false, text: "", reason: "call_failed" }));
    expect(res.source).toBe("synthesis");
    expect(res.drafts).toEqual({});
    expect(res.note).toContain("호출 실패");
  });
  test("unsupported fields are reported with a reason, no numbers invented", async () => {
    const res = await run(async (msgs: any[]) => ({ ok: true, text: JSON.stringify({ rows: ids(msgs).map((id) => ({ id, resolution: "build", expectedLevel: "자체 라인 가동", costKrwM: null, monthsToAttain: null, grade: null, rationale: "", basis: { resolution: "내재화 선호", expectedLevel: "필요 수준 기준" }, unfilled: { cost: "규모를 가늠할 입력 없음", months: "일정 정보 없음", grade: "근거 부족" } })) }) }));
    expect(res.drafts.r0.costKrwM).toBeNull();
    expect(res.unfilled.r0).toContain("규모를 가늠할 입력 없음");
    expect(res.note).toContain("근거 부족으로 비움");
  });
  test("fields a person already filled are kept and not reported as missing", async () => {
    const t = [row("k", { resolution: "hire", attainability: { ...cg.normalizeAttainability({})!, expectedLevel: "사람 값", grade: "medium", rationale: "사람 근거" } })];
    const res = await jd.runJudgementDraft({ system: systemMessage("s5.capability_judgement_draft"), oppName: "o", marketScope: null, targets: t, log: () => {}, call: async () => ({ ok: true, text: JSON.stringify({ rows: [GOOD("k")] }) }) });
    expect(res.drafts.k.resolution).toBeNull();
    expect(res.drafts.k.expectedLevel).toBe("");
    expect(res.counts.kept).toBeGreaterThan(0);
    expect(res.drafts.k.costKrwM).toBe(800);
  });
  test("prompt carries S3 evidence, the hints and the proposal-only rules; stale rows are flagged", () => {
    const p = jd.buildJudgementPrompt({ oppName: "기회", marketScope: "시장", entryStrategy: "Partner 선호", profileLines: ["- A사 · 강점 [미검증 — LLM 추정]: x"], rows: [row("a", { requiredNote: "메모" })] });
    for (const k of ["필요도", "필요 수준", "보유 판정", "보유 근거", "Partner 선호", "작성 안내", "unfilled", "지어내지 마세요", "개인정보"]) expect(p).toContain(k);
    expect(p).toContain("직접 구축을 마친 뒤");
    expect(jd.strategyText({ entry_strategy: "Build", alternatives_considered: "Partner" })).toContain("Build");
  });
  test("registered prompt never asks for confirmation", () => {
    const sys = systemMessage("s5.capability_judgement_draft").content;
    expect(sys).toContain("confirmation");
    expect(sys).toContain("proposal only");
    expect(sys).toContain("Never fabricate");
  });
});

describe("route", () => {
  const OWNER = "ai-judge-analyst", VIEWER = "ai-judge-viewer";
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
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, capability_gap_json) VALUES (?,?,?,?,?,?,?)", [oppId, "판정 기회", "산업", "selected", OWNER, NOW, JSON.stringify({ rows: [row("a"), row("b")], updatedAt: NOW })]);
  });
  const post = (id: string, body: unknown, c = cookie) => req(`/api/opportunities/${id}/capability-attainability/ai-draft`, { method: "POST", headers: { cookie: c }, body: JSON.stringify(body) });
  const stored = () => (db.query("SELECT capability_gap_json j FROM opportunity WHERE id = ?").get(oppId) as { j: string }).j;

  test("no LLM: 200 synthesis, says why, writes nothing; viewers 403; unknown opportunity 404; unknown row 400", async () => {
    const before = stored();
    const res = await post(oppId, {});
    expect(res.status).toBe(200);
    const d = ((await res.json()) as any).data;
    expect(d.source).toBe("synthesis");
    expect(d.drafts).toEqual({});
    expect(d.note).toContain("LLM 미구성");
    expect(d.counts.rows).toBe(2);
    expect(stored()).toBe(before);
    expect((await post(oppId, {}, vcookie)).status).toBe(403);
    expect((await post("nope", {})).status).toBe(404);
    expect((await post(oppId, { rowIds: ["zzz"] })).status).toBe(400);
    expect((await post(oppId, { rowIds: "a" })).status).toBe(400);
  });
  test("route source: proposal only (no DB write, no confirm), same permission as the S5 save, no web search", () => {
    const src = read("app/web-next/app/api/opportunities/[id]/capability-attainability/ai-draft/route.ts");
    expect(src).toContain('requireBusinessActor(auth.auth, "write"');
    expect(src).not.toMatch(/db\.run|INSERT|UPDATE |DELETE |confirmAndWrite|saveAttainability|writeRegister|researchSources|gatherHoldingSources/);
    expect(src).toContain("s5.capability_judgement_draft");
  });
  test("human-only table: ai-draft is NOT human-only, confirm still is", async () => {
    const { isHumanOnly, matchRoute } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
    expect(isHumanOnly("POST", "/api/opportunities/x/capability-attainability/ai-draft", {})).toBe(false);
    expect(isHumanOnly("POST", "/api/opportunities/x/capability-attainability/confirm", {})).toBe(true);
    expect(matchRoute("/api/opportunities/x/capability-attainability/ai-draft")).not.toBeNull();
  });
});

describe("registration and UI structure", () => {
  test("eval call-site, openapi, MCP tool (read/draft only, no confirm tool)", async () => {
    expect(read("tests/eval/call-sites.yaml")).toContain("capability-attainability/ai-draft/route.ts");
    expect(read("docs/architecture/openapi.yaml")).toContain("/api/opportunities/{id}/capability-attainability/ai-draft:");
    const tools = read("mcp/co-newbiz/tools/stage-tools.ts");
    expect(tools).toContain('name: "draft_capability_judgement"');
    expect(tools).not.toMatch(/name: "[a-z_]*confirm_capability/);
    expect(tools).not.toContain("capability-attainability/confirm");
  });
  test("S5 editor: button, note, unsaved counter and discard; S8 panel has no AI", () => {
    const ed = read("app/web-next/components/stages/CapabilityJudgementEditor.tsx");
    // i18n: AI action labels moved to the catalogs — pin the key call sites.
    for (const k of ['t("judgementProposalAi")', 'tc("unsavedAiDraft")', 'tc("discardAiDraft")', "ai-note", "/ai-draft", 't("theAiDraftsTheEmpty")']) expect(ed).toContain(k);
    expect(ed).toContain("aiDraft && canAct");
    expect(read("app/web-next/components/stages/GreenfieldStage.tsx")).toContain("aiDraft");
    const panel = read("app/web-next/components/stages/CapabilityAttainabilityPanel.tsx");
    expect(panel).not.toContain("aiDraft");
    expect(panel).not.toContain("판정 제안");
  });
  test("dialog: per-capability button, AI chips with icon + text, basis lines; table marker", () => {
    const dlg = read("app/web-next/components/stages/CapabilityJudgementDialog.tsx");
    for (const k of ['t("aiProposalForThisCapability")', 'tc("aiDraft")', "ai-basis-", 't("aiEvidence")', 't("aiEstimate")']) expect(dlg).toContain(k);
    expect(dlg).toContain('aria-hidden="true">✦');
    const tbl = read("app/web-next/components/stages/CapabilityJudgementTable.tsx");
    expect(tbl).toContain("ai-draft-chip");
    expect(tbl).toContain('tc("unsaved")');
    expect(tbl).not.toContain("api.post");
  });
  test("refetch keeps unsaved drafts (merge guard) and marks clear on human edit", () => {
    const ed = read("app/web-next/components/stages/CapabilityJudgementEditor.tsx");
    expect(ed).toContain("dirtyRef.current.size === 0");
    expect(ed).toContain("A human edit of an AI-drafted field clears its AI marker");
  });
});
