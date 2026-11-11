// @version 1.0.0
/**
 * S6 Target Universe record shape — DEC-20261111-05 / design
 * 2026-11-11-s6-universe-viability-criteria §5 + test plan §9.4.
 *
 * opportunity.target_universe_json gains the `financial_criteria` key (JSON
 * column, no migration) — the storage S7 checklist item t-08 compares
 * against (`유니버스 정의의 재무 기준`). Locked in:
 *   - PUT with financial_criteria persists the key (trimmed);
 *   - PUT WITHOUT it preserves a stored value (ADR-0139 preserve-when-absent,
 *     identical to the criteria/scope semantics — legacy UI paths never send
 *     it and must not erase a recorded value);
 *   - PUT with "" nulls it (explicit clear);
 *   - >600 chars is trimmed to the cap (viability 400 + hand-edit headroom);
 *   - GET passes the key through untouched.
 * Temp DB only; no network.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-s6-universe-record.sqlite";
const NOW = "2026-11-11T10:00:00Z";

const PREV_ENV: Record<string, string | undefined> = {};
function setEnv(key: string, value: string): void {
  PREV_ENV[key] = process.env[key];
  process.env[key] = value;
}
setEnv("CO_NEWBIZ_DB_PATH", TEST_DB_PATH);

if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
for (const s of ["-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
const dbMod = await import("../../db/client.ts");
const { resetDb, getDb } = dbMod;
const { runMigrations } = await import("../../db/migrate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

const db = (() => {
  resetDb();
  runMigrations(TEST_DB_PATH);
  return getDb(TEST_DB_PATH);
})();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}

let analystCookie = "";
let oppId = "";

beforeAll(async () => {
  const ANALYST = "s6rec-analyst";
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-s6rec-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const login = await req("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ userId: ANALYST, password: "pw-s6rec-12345" }),
  });
  analystCookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];

  oppId = ulid();
  db.run(
    `INSERT INTO opportunity (id, name, market_scope, value_chain_node, market_size_krw_m, growth_rate,
       attractiveness_score, synergy_score, rationale, status, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [oppId, "S6 기록 형상 테스트", "로봇 산업", "시스템 통합", 5000, 8.0, 80, 70, "근거", "selected", "test", NOW],
  );
});

afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  for (const [k, v] of Object.entries(PREV_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function putUniverse(
  body: Record<string, unknown>,
): Promise<{ status: number; universe: Record<string, unknown> | null }> {
  const res = await req(`/api/brownfield/${oppId}/targets`, {
    method: "PUT",
    headers: { cookie: analystCookie },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return { status: res.status, universe: (await res.json()).data.universe as Record<string, unknown> };
}

async function storedUniverse(): Promise<Record<string, unknown>> {
  const row = db.query("SELECT target_universe_json FROM opportunity WHERE id = ?").get(oppId) as {
    target_universe_json: string;
  };
  return JSON.parse(row.target_universe_json) as Record<string, unknown>;
}

describe("§5.1 — financial_criteria in target_universe_json", () => {
  test("PUT with financial_criteria persists the key (trimmed)", async () => {
    const { universe } = await putUniverse({
      definition: "범위 정의",
      financial_criteria: "  부품 세그먼트 이익풀·마진 구조 조건  ",
      min_long_list: 4,
    });
    expect(universe?.financial_criteria).toBe("부품 세그먼트 이익풀·마진 구조 조건");
    expect((await storedUniverse()).financial_criteria).toBe("부품 세그먼트 이익풀·마진 구조 조건");
    expect(universe?.definition).toBe("범위 정의");
    expect(universe?.min_long_list).toBe(4);
  });

  test("PUT without financial_criteria preserves the stored value (ADR-0139 preserve-when-absent)", async () => {
    const { universe } = await putUniverse({ definition: "범위 정의 2" });
    expect(universe?.financial_criteria).toBe("부품 세그먼트 이익풀·마진 구조 조건");
  });

  test("PUT with '' nulls it (explicit clear)", async () => {
    const { universe } = await putUniverse({ definition: "범위 정의 3", financial_criteria: "   " });
    expect(universe?.financial_criteria).toBeNull();
    expect((await storedUniverse()).financial_criteria).toBeNull();
  });

  test("values over 600 chars are trimmed to the cap", async () => {
    const long = "v".repeat(900);
    const { universe } = await putUniverse({ definition: "범위 정의 4", financial_criteria: long });
    const fc = universe?.financial_criteria as string | undefined;
    expect(fc).toBe("v".repeat(600));
    expect(fc?.length).toBe(600);
  });

  test("GET passes the key through untouched", async () => {
    await putUniverse({ definition: "범위 정의 5", financial_criteria: "검증 필요: 가치사슬 단계별 재무 (ADR-0066)" });
    const res = await req(`/api/brownfield/${oppId}/targets`, { method: "GET", headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const data = (await res.json()).data as { universe: Record<string, unknown> };
    expect(data.universe?.financial_criteria).toBe("검증 필요: 가치사슬 단계별 재무 (ADR-0066)");
  });

  test("PUT without definition is still rejected (the viability axis never replaces the required definition)", async () => {
    const res = await req(`/api/brownfield/${oppId}/targets`, {
      method: "PUT",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ financial_criteria: "x" }),
    });
    expect(res.status).toBe(400);
  });
});
