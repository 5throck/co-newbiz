// @version 1.0.0
/**
 * "보유 판정 확인 (AI)" failure modes (decider report 2026-10-14: results "잠깐 나타났다가 사라졌다"; nothing
 * visibly happens) and the unsaved-AI-draft persistence fix. Fake LLM / fake search only; temp DB; no network.
 */
import { test, expect, describe, beforeAll } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(ROOT, "db/data/test-holding-check-diagnosis.sqlite");
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
const run = await import("../../app/web-next/lib/capability-holding-run.ts");
const wr = await import("../../app/web-next/lib/web-research.ts");

const read = (p: string) => readFileSync(join(ROOT, "app/web-next", p), "utf8");
const mkRows = (n: number) => cg.normalizeGapRows(Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, capability: `역량 ${i + 1}`, source: "manual" })));
const SYSTEM = { role: "system" as const, content: "sys" };
const SOURCES = [{ title: "A사 실적", url: "https://example.com/a", snippet: "A사는 상위권 설비 보유" }];
const search = (perRow: Record<string, number[]>, sources = dr.sanitizeWebSources(SOURCES)) => ({ sources, perRow, queries: 2, failureNote: null, skippedRows: 0 });
const heldItem = (id: string, over: Record<string, unknown> = {}) => ({ id, held: { status: "average", currentLevel: "양산 가능", evidence: "상위권" }, sources: [1], basis: { held: "A사 실적 기사", heldSource: "web" }, ...over });
const ok = (text: string) => ({ ok: true, text });
const base = (rows: any[], over: Record<string, unknown> = {}) => ({
  system: SYSTEM, oppName: "기회", marketScope: "산업", current: rows, targets: rows, profileLines: ["- A사: 강점 — 가공"], profileNames: ["A사"],
  search: search(Object.fromEntries(rows.map((r: any) => [r.id, [1]]))), profileScope: "사용한 프로필 1곳(A사)", scopeNote: "", webEnabled: true,
  call: async () => ok("{}"), ...over,
}) as any;

describe("judgeCitedHeldDraft: every dropped row has a specific reason", () => {
  const ctx = { allowedSources: [1], sources: dr.sanitizeWebSources(SOURCES), profileNames: ["A사"] };
  test("reasons", () => {
    expect(dr.judgeCitedHeldDraft(undefined, ctx).reason).toBe("no_item");
    expect(dr.judgeCitedHeldDraft(heldItem("a", { held: { status: "unevaluated" } }), ctx).reason).toBe("unevaluated");
    expect(dr.judgeCitedHeldDraft(heldItem("a", { basis: {} }), ctx).reason).toBe("no_basis");
    expect(dr.judgeCitedHeldDraft(heldItem("a", { sources: [] }), ctx).reason).toBe("no_citation");
    expect(dr.judgeCitedHeldDraft(heldItem("a"), ctx)).toMatchObject({ reason: null, cited: { status: "average", origins: ["web"] } });
    expect(dr.HELD_DROP_LABEL.no_citation).toContain("인용");
  });
  test("source numbers as strings, a string basis, and a profile company named in the basis are accepted", () => {
    expect(dr.judgeCitedHeldDraft(heldItem("a", { sources: ["1"] }), ctx).cited?.web).toHaveLength(1);
    expect(dr.judgeCitedHeldDraft(heldItem("a", { sources: ["[1]"] }), ctx).cited?.web).toHaveLength(1);
    expect(dr.judgeCitedHeldDraft(heldItem("a", { basis: "A사 실적 기사" }), ctx).cited).not.toBeNull();
    const profileOnly = dr.judgeCitedHeldDraft(heldItem("a", { sources: [], basis: { held: "A사 프로필 강점 — 가공" } }), ctx);
    expect(profileOnly.cited?.origins).toEqual(["profile"]);
  });
  test("not fabricated: an explicit web basis without a valid source is still dropped; no profiles means no profile basis", () => {
    expect(dr.judgeCitedHeldDraft(heldItem("a", { sources: [9] }), ctx).reason).toBe("no_citation");
    expect(dr.judgeCitedHeldDraft(heldItem("a", { sources: [], basis: { held: "A사 기사", heldSource: "web" } }), ctx).reason).toBe("no_citation");
    expect(dr.judgeCitedHeldDraft(heldItem("a", { sources: [], basis: { held: "A사 강점", heldSource: "profile" } }), { ...ctx, profileNames: [] }).reason).toBe("no_citation");
    // a source the row was not offered is not accepted
    expect(dr.judgeCitedHeldDraft(heldItem("a"), { ...ctx, allowedSources: [] }).reason).toBe("no_citation");
  });
});

describe("scope and note", () => {
  test("a judged row that only lacks evidence is out of scope (the AI cannot apply anything there)", () => {
    const judged = { ...mkRows(1)[0], currentLevel: "서술", held: { status: "average", holders: [], evidence: "" } } as any;
    expect(hc.needsHoldingCheck(judged)).toBe(false);
    expect(hc.needsHoldingCheck({ ...judged, currentLevel: "" })).toBe(true);
    expect(hc.needsHoldingCheck(mkRows(1)[0])).toBe(true);
    expect(hc.needsHoldingCheck({ ...mkRows(1)[0], held: { status: "unevaluated", holders: [], evidence: "사람이 쓴 근거" }, currentLevel: "x" })).toBe(false);
  });
  test("note carries reasons, kept rows and the missing-search hint", () => {
    const n = hc.holdingNote({ counts: { proposed: 1, insufficient: 4, profile: 0, web: 1, kept: 2, reasons: { no_citation: 3, unevaluated: 1 } }, search: { sources: [], perRow: {}, queries: 0, failureNote: "외부 웹 검색이 설정되지 않았습니다(TAVILY_API_KEY 없음, WEB_SEARCH_DDG_ENABLED 꺼짐) — 프로필 근거만 사용했습니다.", skippedRows: 0 }, webEnabled: true, targeted: 7 });
    expect(n).toContain("미판정 사유: 인용할 프로필·출처 없음 3건");
    expect(n).toContain("사람이 이미 입력한 값이라 바꾸지 않았습니다");
    expect(n).toContain("TAVILY_API_KEY");
  });
});

describe("runHoldingCheck with a fake LLM", () => {
  test("15 rows: 3 calls, fenced JSON, applied rows carry marks and evidence with the citation; reasons are counted", async () => {
    const rows = mkRows(15);
    const sizes: number[] = [];
    const call = async (messages: any[]) => {
      const u = messages.at(-1).content as string;
      const ids = [...u.matchAll(/\[(r\d+)\]/g)].map((m) => m[1]);
      sizes.push(ids.length);
      // r3 gets no citation, r4 says unevaluated, the rest are valid
      const items = ids.map((id) => id === "r3" ? heldItem(id, { sources: [] }) : id === "r4" ? heldItem(id, { held: { status: "unevaluated" } }) : heldItem(id));
      return ok("```json\n" + JSON.stringify({ rows: items }) + "\n```");
    };
    const out = await run.runHoldingCheck(base(rows, { call }));
    expect(sizes.sort((a, b) => b - a)).toEqual([6, 6, 3]);
    expect(out.source).toBe("llm");
    expect(out.counts).toMatchObject({ proposed: 13, insufficient: 2, reasons: { no_citation: 1, unevaluated: 1 } });
    expect(out.rows[0].held.status).toBe("average");
    expect(out.rows[0].held.evidence).toContain("https://example.com/a");
    expect(out.drafts.r1.fields).toEqual(["heldStatus", "currentLevel"]);
    expect(out.rows[2].held.status).toBe("unevaluated");
    expect(out.note).toContain("미판정 사유");
    expect(out.note).toContain("사용한 프로필 1곳");
  });
  test("human values are never overwritten: counted as kept, not as proposed", async () => {
    const rows = mkRows(2).map((r: any, i: number) => (i === 0 ? { ...r, currentLevel: "", held: { status: "none", holders: [], evidence: "사람 근거" } } : r));
    const out = await run.runHoldingCheck(base(rows, { call: async () => ok(JSON.stringify({ rows: [heldItem("r1", { held: { status: "average", currentLevel: "" } }), heldItem("r2")] })) }));
    expect(out.rows[0].held).toMatchObject({ status: "none", evidence: "사람 근거" });
    expect(out.counts.kept).toBe(1);
    expect(out.counts.proposed).toBe(1);
  });
  test("a truncated reply keeps its complete items; the remaining rows are retried once", async () => {
    const rows = mkRows(4);
    let n = 0;
    const call = async () => { n++; if (n === 1) { const full = JSON.stringify({ rows: ["r1", "r2", "r3", "r4"].map((id) => heldItem(id)) }); return ok(full.slice(0, full.indexOf('"id":"r3"') + 12)); } return ok(JSON.stringify({ rows: [heldItem("r3"), heldItem("r4")] })); };
    const out = await run.runHoldingCheck(base(rows, { call }));
    expect(n).toBe(2);
    expect(out.counts.proposed).toBe(4);
    expect(out.note).not.toContain("응답 오류");
  });
  test("unusable replies are reported with the category; no raw text in the note", async () => {
    const rows = mkRows(2);
    const out = await run.runHoldingCheck(base(rows, { call: async () => ok("죄송합니다, 확인할 수 없습니다."), log: () => {} }));
    expect(out.source).toBe("synthesis");
    expect(out.note).toContain("형식 오류");
    expect(out.note).not.toContain("죄송합니다");
    expect(out.rows[0].held.status).toBe("unevaluated");
    const failed = await run.runHoldingCheck(base(rows, { call: async () => ({ ok: false, text: "", reason: "http 500" }), log: () => {} }));
    expect(failed.note).toContain("호출 실패");
  });
  test("profile-only (no search sources): a profile basis is enough; without it the row is dropped with a reason", async () => {
    const rows = mkRows(2);
    const call = async () => ok(JSON.stringify({ rows: [
      { id: "r1", held: { status: "partial", currentLevel: "일부", evidence: "프로필 인용" }, sources: [], basis: { held: "A사 프로필 강점", heldSource: "profile" } },
      { id: "r2", held: { status: "average", currentLevel: "x", evidence: "e" }, sources: [], basis: { held: "추정", heldSource: "web" } },
    ] }));
    const out = await run.runHoldingCheck(base(rows, { call, search: search({ r1: [], r2: [] }, []) }));
    expect(out.counts).toMatchObject({ proposed: 1, insufficient: 1, profile: 1, reasons: { no_citation: 1 } });
    expect(out.rows[0].held.evidence).toContain("그룹/계열사 프로필");
  });
});

describe("holding-check route: visible, specific failures (no LLM)", () => {
  const USER = "hc-analyst";
  let cookie = "";
  const opp = ulid();
  beforeAll(async () => {
    const NOW = new Date().toISOString();
    await createUser(db, { userId: USER, role: "analyst", password: `pw-${USER}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: USER, approvedBy: "test", now: NOW });
    db.run("UPDATE app_user SET must_change_password = 0");
    const login = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: USER, password: `pw-${USER}-12345` }) });
    cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp, "진단 기회", "산업", "selected", USER, NOW]);
  });
  const post = (body: unknown) => nextRequest(`/api/opportunities/${opp}/capability-gap/holding-check`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
  test("no linked profile and no search provider: 400 names what is missing and what to configure", async () => {
    wr.setWebResearchOverrideForTests({ configured: false, sources: [] });
    const res = await post({ rows: [{ id: "a", capability: "A", source: "manual" }] });
    wr.setWebResearchOverrideForTests(null);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    const msg = JSON.stringify(body);
    expect(msg).toContain("프로필이 있는 회사 0곳");
    expect(msg).toContain("TAVILY_API_KEY");
    expect(msg).toContain("our-company");
  });
  test("search finds nothing: the 400 message carries the search failure note", async () => {
    wr.setWebResearchOverrideForTests({ configured: true, sources: [] });
    const res = await post({ rows: [{ id: "a", capability: "A", source: "manual" }] });
    wr.setWebResearchOverrideForTests(null);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("외부 웹 검색 결과가 없어");
  });
  test("sources found but no profile and no LLM: 200, rows untouched, note says why", async () => {
    wr.setWebResearchOverrideForTests({ configured: true, sources: SOURCES });
    const res = await post({ rows: [{ id: "a", capability: "A", source: "manual" }] });
    wr.setWebResearchOverrideForTests(null);
    expect(res.status).toBe(200);
    const d = ((await res.json()) as any).data;
    expect(d.rows[0].held.status).toBe("unevaluated");
    expect(d.note).toContain("LLM 미구성");
  });
});

describe("unsaved AI drafts survive a refetch (the vanishing-drafts bug)", () => {
  const draftRow = (over: Record<string, unknown> = {}) => ({ ...mkRows(1)[0], ...over }) as any;
  test("refetch after the proposal MERGES: AI-filled rows are kept, untouched rows follow the server", () => {
    const stored = [draftRow({ id: "a", capability: "A" }), draftRow({ id: "b", capability: "B" })];
    // the person ran the AI: row a got a draft, a new row n was proposed
    const local = [{ ...stored[0], necessity: "essential", requiredLevel: "초안" }, stored[1], draftRow({ id: "n", capability: "신규" })];
    // a late/duplicate refetch arrives with the stored rows (b changed on the server)
    const server = [stored[0], { ...stored[1], requiredNote: "서버 변경" }];
    const merged = dr.mergeServerRows(local, stored, server);
    expect(merged.map((r: any) => r.id)).toEqual(["a", "b", "n"]);
    expect(merged[0]).toMatchObject({ necessity: "essential", requiredLevel: "초안" }); // draft kept
    expect(merged[1].requiredNote).toBe("서버 변경"); // untouched row follows the server
    expect(merged[2].capability).toBe("신규"); // AI-added unsaved row kept
  });
  test("first load with nothing local takes the server rows; server-new rows are appended; local deletes stay deleted", () => {
    const a = draftRow({ id: "a", capability: "A" }); const b = draftRow({ id: "b", capability: "B" }); const c = draftRow({ id: "c", capability: "C" });
    expect(dr.mergeServerRows([], [], [a, b])).toEqual([a, b]);
    expect(dr.mergeServerRows([b], [a, b], [a, b, c]).map((r: any) => r.id)).toEqual(["b", "c"]); // a deleted locally stays deleted; c is new
    expect(dr.mergeServerRows([a], [a], [])).toEqual([]); // untouched row deleted on the server disappears
  });
  test("interleaving: a refetch that lands AFTER the AI response cannot overwrite it", () => {
    const stored = [draftRow({ id: "a", capability: "A" })];
    let rows = dr.mergeServerRows([], [], stored); // initial load
    const base = stored;
    const aiResponse = [{ ...stored[0], necessity: "essential" as const }];
    rows = dr.mergeDraftResponse(rows, aiResponse); // proposal applied
    const afterRefetch = dr.mergeServerRows(rows, base, stored); // late refetch of the same stored rows
    expect(afterRefetch[0].necessity).toBe("essential");
  });
  test("draft marks: counted, pruned with their row, and discard reverts only the marked cells", () => {
    const stored = [draftRow({ id: "a", capability: "A", necessity: "optional", requiredLevel: "저장값" })];
    const local = [{ ...stored[0], necessity: "essential" as const, currentLevel: "초안 보유", requiredLevel: "사람이 고침" }, draftRow({ id: "n", capability: "신규", necessity: "essential" })];
    const drafts = { a: { fields: ["necessity", "necessityScopeNote", "currentLevel"], basis: {} }, n: { fields: ["necessity", "requiredLevel"], basis: {} } } as any;
    expect(dr.countDraftFields(drafts)).toBe(4); // scope note rides along
    expect(Object.keys(dr.pruneDrafts(drafts, [local[0]]))).toEqual(["a"]);
    const back = dr.discardAiDrafts(local, drafts, stored);
    expect(back.map((r: any) => r.id)).toEqual(["a"]); // the proposed, unsaved row is gone
    expect(back[0]).toMatchObject({ necessity: "optional", currentLevel: "", requiredLevel: "사람이 고침" }); // unmarked human edit kept
  });
  test("hook: loadGap merges (no setGapDrafts({}) / setGapRows(server)), only a different opportunity resets, note is dismissible", () => {
    const hook = read("components/stages/synergy/useSynergyResult.ts");
    const load = hook.slice(hook.indexOf("const loadGap = useCallback"), hook.indexOf("}, [opportunityId]);", hook.indexOf("const loadGap = useCallback")));
    const effect = hook.slice(hook.indexOf("Only a DIFFERENT opportunity"), hook.indexOf("}, [loadGap, opportunityId]);"));
    expect(load).toContain("mergeServerRows(prev, base, r.data.rows)");
    expect(load).not.toContain("setGapDrafts");
    expect(load).not.toContain("setGapRows(r.data.rows)");
    expect(effect).toContain("gapLoadedFor.current !== opportunityId");
    expect(hook).toContain("function discardDrafts");
    expect(hook).toContain("dismissGapNote");
    const tab = read("components/stages/synergy/SynergyCapabilityTab.tsx");
    // i18n: draft chip labels resolve through the catalogs — pin the key call sites.
    for (const k of ['tc("unsavedAiDraft")', 'tc("discardAiDraft")', "onClick={dismissGapNote}", 'data-testid="gap-note"']) expect(tab).toContain(k);
  });
});
