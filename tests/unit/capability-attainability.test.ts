// @version 1.0.0
/**
 * S8 required-capability attainability (ADR-0168, slices 1-2): the 5-step level
 * scale and legacy text, the shared row parser round-trip (attainability must
 * survive S3 save, S5 save and re-read), the summary/banner view model, and the
 * GET/PUT/confirm route contract (validation, human-only confirm, audit).
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
const url = () => `/api/projects/${projectId}/capability-attainability`;
const get = async () => ((await (await req(url(), { headers: { cookie: leadCookie } })).json()) as { data: any }).data;
const put = (rows: unknown[], cookie = leadCookie) => req(url(), { method: "PUT", headers: { cookie }, body: json({ rows }) });
const post = (body: unknown, cookie = leadCookie) => req(`${url()}/confirm`, { method: "POST", headers: { cookie }, body: json(body) });
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

describe("5-step level scale", () => {
  test("labels, order, parse; legacy text maps to null without being deleted", () => {
    expect(cg.LEVEL_LABELS).toEqual(["없음", "기초", "실무", "숙련", "선도"]);
    expect(cg.levelStep("숙련")).toBe(4);
    expect(cg.levelStep(" 실무 ")).toBe(3);
    expect(cg.levelStep("약간 있음")).toBeNull();
    expect(cg.isLegacyLevelText("약간 있음")).toBe(true);
    expect(cg.isLegacyLevelText("")).toBe(false);
    expect(cg.isLegacyLevelText("선도")).toBe(false);
    expect(cg.levelGap("숙련", "기초")).toBe(2);
    expect(cg.levelGap("기초", "숙련")).toBe(0);
    expect(cg.levelGap("숙련", "약간")).toBeNull();
    // the parser keeps legacy text verbatim
    expect(cg.normalizeGapRows([{ capability: "x", requiredLevel: "높은 수준", currentLevel: "" }])[0].requiredLevel).toBe("높은 수준");
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
  const mk = (grade: any, status: any = "met") => ({ id: ulid(), capability: "c", source: "manual", requiredNote: "", held: { status, holders: [], evidence: "" }, resolution: null, note: "", requiredLevel: "", currentLevel: "", ...(grade ? { attainability: { closingCostKrwM: null, monthsToAttain: null, grade, rationale: "r", evidence: [], draftedBy: "human", confirmedBy: null, confirmedAt: null } } : {}) }) as any;
  test("empty register and unjudged rows warn; all judged medium/high does not", () => {
    expect(att.attainabilitySummary([]).banner).toBe(true);
    expect(att.attainabilitySummary([]).bannerText).toBe(att.ATTAINABILITY_EMPTY_BANNER_TEXT);
    const s = att.attainabilitySummary([mk("high"), mk(null, "unmet"), mk("low", "partial")]);
    expect(s.grades).toEqual({ high: 1, medium: 0, low: 1, unjudged: 1 });
    expect(s.held).toEqual({ met: 1, partial: 1, unmet: 1, unevaluated: 0 });
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
    expect(v.rows[0].required_step).toBe(4);
    expect(v.rows[0].current_step).toBeNull();
  });

  test("validation: rationale required for 높음/낮음, scale values, cost >= 0, unknown row", async () => {
    let r = await put([{ id: "r1", grade: "low" }]);
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error.code).toBe("rationale_required");
    r = await put([{ id: "r1", requiredLevel: "대단함" }]);
    expect(((await r.json()) as any).error.code).toBe("invalid_level");
    r = await put([{ id: "r1", closingCostKrwM: -1 }]);
    expect(((await r.json()) as any).error.code).toBe("invalid_cost");
    r = await put([{ id: "nope", grade: "medium" }]);
    expect(((await r.json()) as any).error.code).toBe("unknown_row");
    expect((await put([{ id: "r1", grade: "medium" }], viewerCookie)).status).toBe(403);
    // a medium grade needs no rationale; a legacy level may stay unchanged
    r = await put([{ id: "r2", grade: "medium", currentLevel: "실무" }]);
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
    expect(audit.target).toBe(`${projectId}#capability@ui`);

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

  test("confirm: human-only (port refuses), viewer 403, sets confirmedBy/At, edit clears it, nothing_to_confirm 409", async () => {
    expect(isHumanOnly("POST", `${url()}/confirm`, {})).toBe(true);
    const port = new InProcessRestPort({ userId: LEAD, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" });
    expect((await port.post(`${url()}/confirm`, {})).error?.code).toBe("human_only");
    expect((await post({}, viewerCookie)).status).toBe(403);
    const ok = await post({});
    expect(ok.status).toBe(200);
    const data = ((await ok.json()) as any).data;
    expect(data.confirmed).toBe(2); // r1 (low) and r2 (medium) were judged
    expect(data.rows.find((x: any) => x.id === "r1")).toMatchObject({ confirmed_by: LEAD });
    const audit = db.query("SELECT target FROM audit_log WHERE action = 'capability_attainability.confirm'").get() as any;
    expect(audit.target).toBe(`${projectId}#capability@ui`);
    expect((await post({})).status).toBe(409);
    // editing a judged row clears its confirmation
    await put([{ id: "r1", rationale: "수정된 근거" }]);
    const v = await get();
    expect(v.rows.find((x: any) => x.id === "r1").confirmed_at).toBeNull();
    expect(v.rows.find((x: any) => x.id === "r2").confirmed_at).not.toBeNull();
    expect(v.summary.confirmed).toBe(1);
  });
});
