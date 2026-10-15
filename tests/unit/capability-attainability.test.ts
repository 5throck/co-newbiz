// @version 1.0.0
/**
 * Required-capability attainability (ADR-0168; edit surface moved to S5 by ADR-0171 and the
 * 5-step scale retired by ADR-0172): narrative levels, the shared row parser round-trip
 * (attainability and 기대 수준 must survive S3 save, S5 save and re-read), the summary/banner view
 * model, the S5 opportunity PUT/confirm contract (validation, expected_level_required, human-only
 * confirm, audit with surface), and the S8 project routes (GET read-only summary, writes 410 moved).
 */
import { test, expect, beforeAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-capability-attainability.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const cg = await import("../../app/web-next/lib/capability-gap.ts");
const att = await import("../../app/web-next/lib/capability-attainability.ts");
const { isHumanOnly, InProcessRestPort } = await import("../../app/web-next/lib/mcp/in-process-port.ts");

const NOW = new Date().toISOString();
const req = (path: string, init?: RequestInit) => nextRequest(path, init);
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const LEAD = "att-lead";
const VIEWER = "att-viewer";
let leadCookie = "";
let viewerCookie = "";
let projectId = "";
let oppId = "";
const json = JSON.stringify;
const url = () => `/api/projects/${projectId}/capability-attainability`; // S8 read-only summary
const oppUrl = () => `/api/opportunities/${oppId}/capability-attainability`; // S5 edit surface
const get = async () => ((await (await req(url(), { headers: { cookie: leadCookie } })).json()) as { data: any }).data;
const put = (rows: unknown[], cookie = leadCookie) => req(oppUrl(), { method: "PUT", headers: { cookie }, body: json({ rows }) });
const post = (body: unknown, cookie = leadCookie) => req(`${oppUrl()}/confirm`, { method: "POST", headers: { cookie }, body: json(body) });
const storedRows = () => cg.parseGapRegister((db.query("SELECT capability_gap_json j FROM opportunity WHERE id = ?").get(oppId) as { j: string }).j).rows;

beforeAll(async () => {
  for (const [id, role] of [[LEAD, "analyst"], [VIEWER, "viewer"]] as const) {
    await createUser(db, { userId: id, role, password: `pw-${id}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: id, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  leadCookie = await loginCookie(LEAD, `pw-${LEAD}-12345`);
  viewerCookie = await loginCookie(VIEWER, `pw-${VIEWER}-12345`);

  oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "att 기회", "산업", "selected", LEAD, NOW]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), oppId, "greenfield", "test", "대안 검토", LEAD, NOW]);
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [ulid(), oppId, "직접 진출", "M&A 대안", "test", LEAD, NOW, NOW],
  );
  const rows = [
    { id: "r1", capability: "정밀 가공", source: "manual", held: { status: "unmet" }, requiredLevel: "숙련", currentLevel: "자체 경험 약간" },
    { id: "r2", capability: "품질 인증", source: "manual", held: { status: "met", holders: ["A사"] }, requiredLevel: "실무", currentLevel: "실무" },
  ];
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows, updatedAt: NOW }), oppId]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "t", LEAD, NOW]);
  }
  projectId = promoteOpportunity(oppId, { promotedBy: LEAD, needToKnowBasis: "att test" }).project.id;
});

describe("narrative levels (5-step scale retired)", () => {
  test("the scale helpers are gone; level text is kept verbatim up to the narrative cap", () => {
    for (const k of ["LEVEL_SCALE", "LEVEL_LABELS", "levelStep", "isLegacyLevelText", "levelGap"]) expect(k in cg).toBe(false);
    expect(cg.normalizeGapRows([{ capability: "x", requiredLevel: "높은 수준", currentLevel: "" }])[0].requiredLevel).toBe("높은 수준");
    expect(cg.normalizeGapRows([{ capability: "x", requiredLevel: "가".repeat(450) }])[0].requiredLevel).toHaveLength(cg.NARRATIVE_CAP);
  });
});

describe("expectedLevel (기대 수준) storage", () => {
  test("normalize keeps it, caps at 400, omits it when empty, round-trips through history", () => {
    const [r] = cg.normalizeGapRows([{ capability: "c", attainability: { grade: "high", rationale: "r", expectedLevel: `  ${"나".repeat(450)} ` } }]);
    expect(r.attainability?.expectedLevel).toHaveLength(400);
    const [e] = cg.normalizeGapRows([{ capability: "c", attainability: { grade: "high", rationale: "r", expectedLevel: "   " } }]);
    expect(e.attainability).not.toHaveProperty("expectedLevel");
    const hist = cg.normalizeAttainability({ history: [{ invalidatedAt: NOW, expectedLevel: "이전 기대 수준", reason: "s3_changed" }] });
    expect(hist?.history?.[0].expectedLevel).toBe("이전 기대 수준");
  });
});

describe("normalizeGapRows round-trips attainability", () => {
  const a = { closingCostKrwM: 1200, monthsToAttain: 18, grade: "low", rationale: "인력 확보 어려움", evidence: ["면담 메모"], draftedBy: "human", confirmedBy: "u", confirmedAt: NOW };
  test("kept field by field; bad values sanitised; confirm needs both fields", () => {
    const [r] = cg.normalizeGapRows([{ capability: "c", attainability: a }]);
    expect(r.attainability).toEqual(a as unknown as typeof r.attainability);
    const [bad] = cg.normalizeGapRows([{ capability: "c", attainability: { closingCostKrwM: -5, monthsToAttain: "x", grade: "great", confirmedBy: "u" } }]);
    expect(bad.attainability?.closingCostKrwM).toBeNull();
    expect(bad.attainability?.monthsToAttain).toBeNull();
    expect(bad.attainability?.grade).toBeNull();
    expect(bad.attainability?.confirmedBy).toBeNull();
    expect(cg.normalizeGapRows([{ capability: "c" }])[0].attainability).toBeUndefined();
  });
});

describe("summary view model", () => {
  const mk = (grade: any, status: any = "average") => ({ id: ulid(), capability: "c", source: "manual", requiredNote: "", held: { status, holders: [], evidence: "" }, resolution: null, note: "", requiredLevel: "", currentLevel: "", ...(grade ? { attainability: { closingCostKrwM: null, monthsToAttain: null, grade, rationale: "r", evidence: [], draftedBy: "human", confirmedBy: null, confirmedAt: null } } : {}) }) as any;
  test("empty register and unjudged rows warn; all judged medium/high does not", () => {
    expect(att.attainabilitySummary([]).banner).toBe(true);
    expect(att.attainabilitySummary([]).bannerText).toBe(att.ATTAINABILITY_EMPTY_BANNER_TEXT);
    const s = att.attainabilitySummary([mk("high"), mk(null, "none"), mk("low", "partial")]);
    expect(s.grades).toEqual({ high: 1, medium: 0, low: 1, unjudged: 1 });
    expect(s.held).toEqual({ leading: 0, average: 1, partial: 1, none: 1, unevaluated: 0 });
    expect(s.bannerReasons).toEqual(["unjudged", "low"]);
    expect(s.bannerText).toBe(att.ATTAINABILITY_BANNER_TEXT);
    expect(att.attainabilitySummary([mk("high"), mk("medium")]).banner).toBe(false);
    expect(att.attainabilitySummary([mk(null, "unevaluated")]).bannerReasons).toContain("unevaluated");
  });
});

describe("routes", () => {
  test("legacy project: every row 미판정 with banner; no attainability stored", async () => {
    const v = await get();
    expect(v.opportunity_id).toBe(oppId);
    expect(v.rows).toHaveLength(2);
    expect(v.summary.grades.unjudged).toBe(2);
    expect(v.summary.banner).toBe(true);
    expect(v.rows[0].grade_label).toBe("미판정");
    expect(v.rows[0].current_level).toBe("자체 경험 약간"); // legacy text kept
    expect(v.rows[0].required_level).toBe("숙련"); // narrative text, no scale logic
    expect(v.rows[0]).not.toHaveProperty("required_step");
    expect(v.rows[0].necessity).toBe("");
  });

  test("validation: rationale required for 높음/낮음, scale values, cost >= 0, unknown row", async () => {
    let r = await put([{ id: "r1", grade: "low" }]);
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error.code).toBe("rationale_required");
    // S3-owned fields (levels included) are rejected, not silently dropped (ADR-0170 D2)
    r = await put([{ id: "r1", requiredLevel: "숙련" }]);
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error.code).toBe("s3_owned_field");
    r = await put([{ id: "r1", closingCostKrwM: -1 }]);
    expect(((await r.json()) as any).error.code).toBe("invalid_cost");
    r = await put([{ id: "nope", grade: "medium" }]);
    expect(((await r.json()) as any).error.code).toBe("unknown_row");
    expect((await put([{ id: "r1", grade: "medium" }], viewerCookie)).status).toBe(403);
    // a medium grade needs no rationale
    r = await put([{ id: "r2", grade: "medium" }]);
    expect(r.status).toBe(200);
  });

  test("save a draft, audit entry, then S3 save and S5 save keep it (regression), confirm is human-only", async () => {
    const res = await put([{ id: "r1", resolution: "hire", closingCostKrwM: 800, monthsToAttain: 12, grade: "low", rationale: "영입 대상 부족", evidence: ["헤드헌터 의견"] }]);
    expect(res.status).toBe(200);
    const saved = ((await res.json()) as any).data;
    expect(saved.changed).toBe(1);
    expect(saved.rows.find((x: any) => x.id === "r1")).toMatchObject({ grade: "low", closing_cost_krw_m: 800, months_to_attain: 12, drafted_by: "human", confirmed_at: null, resolution: "hire" });
    const audit = db.query("SELECT action, actor_user_id a, target FROM audit_log WHERE action = 'capability_attainability.save' ORDER BY created_at DESC LIMIT 1").get() as any;
    expect(audit.a).toBe(LEAD);
    expect(audit.target).toBe(`${oppId}#capability@ui:surface=S5`);

    // S3 / S5 share this save path: the client echoes the GET rows (with attainability) back
    const s3 = await req(`/api/opportunities/${oppId}/capability-gap`, { headers: { cookie: leadCookie } });
    const s3Rows = ((await s3.json()) as any).data.rows;
    expect(s3Rows.find((x: any) => x.id === "r1").attainability.grade).toBe("low");
    const edited = s3Rows.map((x: any) => (x.id === "r1" ? { ...x, note: "S5에서 수정", requiredLevel: "선도" } : x));
    expect((await req(`/api/opportunities/${oppId}/capability-gap`, { method: "PUT", headers: { cookie: leadCookie }, body: json({ rows: edited }) })).status).toBe(200);
    // a client that drops the field (older S5 build) must not erase it either
    const stripped = edited.map(({ attainability: _a, ...rest }: any) => rest);
    expect((await req(`/api/opportunities/${oppId}/capability-gap`, { method: "PUT", headers: { cookie: leadCookie }, body: json({ rows: stripped }) })).status).toBe(200);
    const after = storedRows().find((x) => x.id === "r1")!;
    expect(after.attainability?.grade).toBe("low");
    expect(after.attainability?.closingCostKrwM).toBe(800);
    expect(after.note).toBe("S5에서 수정");
    expect(after.requiredLevel).toBe("선도");
    // and the client cannot forge a confirmation through the S3 save
    const forged = s3Rows.map((x: any) => (x.id === "r1" ? { ...x, attainability: { ...x.attainability, confirmedBy: "boss", confirmedAt: NOW } } : x));
    await req(`/api/opportunities/${oppId}/capability-gap`, { method: "PUT", headers: { cookie: leadCookie }, body: json({ rows: forged }) });
    expect(storedRows().find((x) => x.id === "r1")!.attainability?.confirmedBy).toBeNull();
  });

  test("confirm: human-only (port refuses), viewer 403, expected_level_required, sets confirmedBy/At, edit clears it, nothing_to_confirm 409", async () => {
    expect(isHumanOnly("POST", `${oppUrl()}/confirm`, {})).toBe(true);
    expect(isHumanOnly("POST", `${url()}/confirm`, {})).toBe(true); // legacy project route stays refused too
    const port = new InProcessRestPort({ userId: LEAD, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" });
    expect((await port.post(`${oppUrl()}/confirm`, {})).error?.code).toBe("human_only");
    expect((await port.post(`${url()}/confirm`, {})).error?.code).toBe("human_only");
    expect((await post({}, viewerCookie)).status).toBe(403);
    // r1 has a resolution (hire) but no 기대 수준 yet: OD-7 blocks the confirm with a 400 (not a gate block)
    const blocked = await post({});
    expect(blocked.status).toBe(400);
    const err = ((await blocked.json()) as any).error;
    expect(err.code).toBe("expected_level_required");
    expect(err.message).toContain("정밀 가공");
    expect(storedRows().find((x) => x.id === "r1")!.attainability?.confirmedAt).toBeNull();
    // the same save also proves a 기대 수준 draft can be saved without a gate
    expect((await put([{ id: "r1", expectedLevel: "영입한 인력이 자체 수행 가능한 수준", category: "capex" }])).status).toBe(200);
    const ok = await post({});
    expect(ok.status).toBe(200);
    const data = ((await ok.json()) as any).data;
    expect(data.confirmed).toBe(2); // r1 (low) and r2 (medium) were judged
    expect(data.rows.find((x: any) => x.id === "r1")).toMatchObject({ confirmed_by: LEAD, expected_level: "영입한 인력이 자체 수행 가능한 수준" });
    const audit = db.query("SELECT target FROM audit_log WHERE action = 'capability_attainability.confirm'").get() as any;
    expect(audit.target).toBe(`${oppId}#capability@ui:surface=S5`);
    expect((await post({})).status).toBe(409);
    // editing a judged row clears its confirmation
    await put([{ id: "r1", rationale: "수정된 근거" }]);
    const v = await get();
    expect(v.rows.find((x: any) => x.id === "r1").confirmed_at).toBeNull();
    expect(v.rows.find((x: any) => x.id === "r2").confirmed_at).not.toBeNull();
    expect(v.summary.confirmed).toBe(1);
  });

  test("category: judgement-owned round trip; a confirmed row with 비용 > 0 and no 분류 is blocked with category_required", async () => {
    // r2 has no 해소 비용; give it one — the edit also clears its confirmation
    expect((await put([{ id: "r2", closingCostKrwM: 500, rationale: "설비 견적 기반" }])).status).toBe(200);
    const blocked = await post({});
    expect(blocked.status).toBe(400);
    const err = ((await blocked.json()) as any).error;
    expect(err.code).toBe("category_required");
    expect(err.message).toContain("품질 인증");
    expect(storedRows().find((x) => x.id === "r2")!.attainability?.confirmedAt).toBeNull();
    expect((await put([{ id: "r2", category: "opex" }])).status).toBe(200);
    expect(storedRows().find((x) => x.id === "r2")!.attainability?.category).toBe("opex");
    expect((await post({})).status).toBe(200);
  });

  test("expectedLevel: round trip, 400 cap rejected, clearing removes it, not part of the S3 hash", async () => {
    const lk = await import("../../app/web-next/lib/capability-linkage.ts");
    const before = lk.capabilityRowHash(storedRows().find((x) => x.id === "r2")!);
    let r = await put([{ id: "r2", expectedLevel: "가".repeat(401) }]);
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error.code).toBe("text_too_long");
    r = await put([{ id: "r2", expectedLevel: 5 }]);
    expect(((await r.json()) as any).error.code).toBe("invalid_request");
    r = await put([{ id: "r2", expectedLevel: "  ".concat("나".repeat(400)) }]);
    expect(r.status).toBe(200);
    expect(storedRows().find((x) => x.id === "r2")!.attainability?.expectedLevel).toHaveLength(400);
    expect(lk.capabilityRowHash(storedRows().find((x) => x.id === "r2")!)).toBe(before); // judgement-owned, not hashed
    expect(lk.isStale(storedRows().find((x) => x.id === "r2")!)).toBe(false);
    expect((await get()).rows.find((x: any) => x.id === "r2").expected_level).toHaveLength(400);
    r = await put([{ id: "r2", expectedLevel: "" }]);
    expect(storedRows().find((x) => x.id === "r2")!.attainability).not.toHaveProperty("expectedLevel");
  });

  test("S5 never writes S3-owned fields: every one is rejected and the stored S3 values are untouched", async () => {
    const before = JSON.stringify(storedRows().map((x) => ({ capability: x.capability, requiredNote: x.requiredNote, necessity: x.necessity, requiredLevel: x.requiredLevel, held: x.held, currentLevel: x.currentLevel, note: x.note })));
    for (const patch of [{ capability: "x" }, { requiredNote: "x" }, { necessity: "essential" }, { necessityScopeNote: "x" }, { held: { status: "leading" } }, { requiredLevel: "x" }, { currentLevel: "x" }, { source: "manual" }, { note: "x" }]) {
      const r = await put([{ id: "r2", grade: "medium", ...patch }]);
      expect(r.status).toBe(400);
      expect(((await r.json()) as any).error.code).toBe("s3_owned_field");
    }
    expect(JSON.stringify(storedRows().map((x) => ({ capability: x.capability, requiredNote: x.requiredNote, necessity: x.necessity, requiredLevel: x.requiredLevel, held: x.held, currentLevel: x.currentLevel, note: x.note })))).toBe(before);
  });
});

describe("S8 project routes after the move (ADR-0171)", () => {
  test("GET stays: read-only summary with expected_level and edit_at S5", async () => {
    const v = await get();
    expect(v.edit_at).toBe("S5");
    expect(v.track).toBe("greenfield");
    expect(v.rows[0]).toHaveProperty("expected_level");
    expect(v.rows[0]).toHaveProperty("note");
    expect(v.opportunity_id).toBe(oppId);
  });

  test("Green Field PUT and confirm return 410 moved with editAt S5 and write nothing", async () => {
    const snapshot = (db.query("SELECT capability_gap_json j FROM opportunity WHERE id = ?").get(oppId) as { j: string }).j;
    const res = await req(url(), { method: "PUT", headers: { cookie: leadCookie }, body: json({ rows: [{ id: "r2", grade: "high", rationale: "x" }] }) });
    expect(res.status).toBe(410);
    const body = (await res.json()) as any;
    expect(body.error).toMatchObject({ code: "moved", editAt: "S5" });
    const c = await req(`${url()}/confirm`, { method: "POST", headers: { cookie: leadCookie }, body: json({}) });
    expect(c.status).toBe(410);
    expect(((await c.json()) as any).error).toMatchObject({ code: "moved", editAt: "S5" });
    expect((db.query("SELECT capability_gap_json j FROM opportunity WHERE id = ?").get(oppId) as { j: string }).j).toBe(snapshot);
    // the human-only guard still comes first for non-human callers
    const port = new InProcessRestPort({ userId: LEAD, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" });
    expect((await port.post(`${url()}/confirm`, {})).error?.code).toBe("human_only");
  });

  test("a Brown Field project keeps the legacy write path until the S7 surface ships (slice 2b)", async () => {
    db.run("UPDATE md_project SET track = 'brownfield' WHERE id = ?", [projectId]);
    try {
      expect((await get()).edit_at).toBe("S7");
      const res = await req(url(), { method: "PUT", headers: { cookie: leadCookie }, body: json({ rows: [{ id: "r2", grade: "medium" }] }) });
      expect(res.status).toBe(200);
    } finally {
      db.run("UPDATE md_project SET track = 'greenfield' WHERE id = ?", [projectId]);
    }
  });
});

describe("consumers read the ADR-0172 order", () => {
  test("pre_fs gate brief carries the capability line: 필요도, 보유 판정; 해소 방식, 기대 수준, 개월, 달성 가능성 + the S5 check counts", async () => {
    const { buildGateContext, capabilityBriefLine } = await import("../../app/web-next/lib/gate-brief.ts");
    const [row] = cg.normalizeGapRows([{ id: "z", capability: "정밀 가공", necessity: "essential", held: { status: "none" }, resolution: "hire", attainability: { grade: "low", rationale: "r", monthsToAttain: 12, expectedLevel: "영입 인력이 자체 수행", confirmedBy: LEAD, confirmedAt: NOW } }]);
    const line = capabilityBriefLine(row);
    expect(line).toBe("정밀 가공(필요도 필수, 보유 판정 미보유; 영입, 기대 수준 영입 인력이 자체 수행, 12개월, 달성 가능성 낮음(확정))");
    expect(line.indexOf("필요도")).toBeLessThan(line.indexOf("보유 판정"));
    expect(line.indexOf("보유 판정")).toBeLessThan(line.indexOf("달성 가능성"));
    expect(line).not.toContain("S5 수준");
    const ctx = buildGateContext(db, "opportunity", oppId, "pre_fs");
    expect(ctx).toContain("필요 역량 점검(S5):");
    expect(ctx).toContain("참고 정보이며 승인 조건이 아닙니다");
    expect(ctx).not.toContain("S5 수준");
  });

  test("route advisory exposes largeGapRows for 필수 rows that are 부분 보유/미보유 and keeps the deprecated aliases", async () => {
    db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [
      json({ rows: storedRows().map((x) => (x.id === "r1" ? { ...x, necessity: "essential" } : x)), updatedAt: NOW }), oppId,
    ]);
    const res = await req(`/api/opportunities/${oppId}/route-advisory`, { headers: { cookie: leadCookie } });
    expect(res.status).toBe(200);
    const g = ((await res.json()) as any).data.capabilityGap;
    expect(g.largeGapRows.map((r: any) => r.capability)).toEqual(["정밀 가공"]);
    expect(g.rows[0]).toMatchObject({ capability: "정밀 가공", necessity: "essential" });
    expect(g.rows[0].cautions.map((c: any) => c.label)).toContain("큰 격차 주의");
    expect(g.unmet).toBe(g.none);
    expect(g.met).toBe(g.leading + g.average);
  });
});
