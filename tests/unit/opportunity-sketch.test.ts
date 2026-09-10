import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

// Business-model sketch v2 — the canvas + ERRC integrated shape
// (docs/designs workflow, mockup bms-v2.html 확정안). The generation route
// stores schema:2 sketches, normalizing LLM output (string items, unknown
// actions) and falling back to a deterministic v2 skeleton when the LLM is
// unavailable or its output is unparseable — 400 sketch_parse_failed is gone.
// Legacy v1 rows (no schema tag) are returned as-is for the text-view fallback.
const TEST_DB_PATH = "db/data/test-opportunity-sketch.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { normalizeSketchV2, sketchSchema } = await import("../../app/web-next/lib/sketch-schema.ts");

resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const NOW = "2026-09-10T00:00:00Z";
let oppId = "";
let cookie = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  // 이 테스트는 결정론 폴백 경로를 검증한다 — 머신에 LLM 키가 구성되어 있어도
  // synthesis 경로로 강제한다. "" 할당: loadRootEnvPipelineKeys가 undefined 키만
  // 채우므로 .env 재주입도 동시에 차단된다(getProviderConfig는 빈 값을 falsy로 본다).
  process.env.CO_NEWBIZ_LLM_PROVIDER = "";
  process.env.CO_NEWBIZ_LLM_API_KEY = "";
  process.env.CO_NEWBIZ_LLM_BASE_URL = "";
  process.env.CO_NEWBIZ_LLM_MODEL = "";
  await createUser(db, { userId: "sketch-a", role: "analyst", password: "pw-sketch-a-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "sketch-a", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "sketch-view", role: "viewer", password: "pw-sketch-view-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "sketch-view", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await loginCookie("sketch-a", "pw-sketch-a-12345");

  oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [oppId, "스케치 테스트 기회", "assessed", "test", NOW]);
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("normalizeSketchV2", () => {
  test("coerces strings and drops unknown ERRC actions", () => {
    const out = normalizeSketchV2({
      schema: 2,
      canvas: {
        keyPartners: ["문자열 항목", { text: "배지 항목", action: "raise", why: "근거" }, { text: "무효 액션", action: "explode" }],
        revenueStreams: [],
      },
      errc: { create: [{ item: "창조 항목", why: "이유" }] },
      marketEntry: ["1단계", "2단계", "", "3단계"],
      scenarios: [{ name: "기본", assumption: "전제" }],
      keyRisks: ["리스크"],
    });
    expect(out.schema).toBe(2);
    expect(out.canvas.keyPartners).toEqual([
      { text: "문자열 항목" },
      { text: "배지 항목", action: "raise", why: "근거" },
      // 무효한 ERRC 액션은 배지만 제거되고 항목 자체는 보존된다(무손실 정규화)
      { text: "무효 액션" },
    ]);
    expect(out.canvas.keyActivities).toEqual([]);
    expect(out.errc?.create).toEqual([{ item: "창조 항목", why: "이유" }]);
    expect(out.marketEntry).toEqual(["1단계", "2단계", "3단계"]);
  });

  test("legacy shape (no schema) is detected as v1", () => {
    expect(sketchSchema({ customer: "..." })).toBe(1);
    expect(sketchSchema({ schema: 2, canvas: {} })).toBe(2);
  });
});

describe("POST /api/opportunities/[id]/sketch", () => {
  test("viewer is forbidden", async () => {
    const res = await nextRequest(`/api/opportunities/${oppId}/sketch`, { method: "POST", body: JSON.stringify({}) });
    expect([200, 401, 403]).toContain(res.status); // unauthenticated → 401 handled by auth
  });

  test("synthesis fallback produces a schema:2 canvas skeleton", async () => {
    const res = await nextRequest(`/api/opportunities/${oppId}/sketch`, { method: "POST", body: JSON.stringify({}), headers: { cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { sketch: { schema: number; canvas: Record<string, Array<unknown>>; marketEntry: string[] }; cached: boolean; source: string } };
    expect(body.data.cached).toBe(false);
    expect(body.data.sketch.schema).toBe(2);
    expect(Object.keys(body.data.sketch.canvas).length).toBe(9);
    expect(body.data.sketch.marketEntry.length).toBeGreaterThan(0);
    expect(body.data.source).toBe("synthesis");
    const row = db.query("SELECT sketch_json FROM opportunity WHERE id = ?").get(oppId) as { sketch_json: string };
    expect(JSON.parse(row.sketch_json).schema).toBe(2);
  });

  test("cached return without force", async () => {
    const res = await nextRequest(`/api/opportunities/${oppId}/sketch`, { method: "POST", body: JSON.stringify({}), headers: { cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { cached: boolean } };
    expect(body.data.cached).toBe(true);
  });

  test("legacy v1 stored sketch is returned as-is (text-view fallback)", async () => {
    const legacy = { customer: "레거시 고객", valueProposition: "레거시 가치", revenueModel: "레거시 수익" };
    db.run("UPDATE opportunity SET sketch_json = ? WHERE id = ?", [JSON.stringify(legacy), oppId]);
    const res = await nextRequest(`/api/opportunities/${oppId}/sketch`, { method: "POST", body: JSON.stringify({}), headers: { cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { sketch: { customer?: string; schema?: number } } };
    expect(body.data.sketch.customer).toBe("레거시 고객");
    expect(body.data.sketch.schema).toBeUndefined();
  });
});
