/**
 * KSIC handling on the market-overview surface (ADR-0111):
 *  - migration 0078 semantics: ksic_code becomes nullable, existing NEW-*
 *    placeholder values are nulled, the HYD-BRK freeze sentinel is kept,
 *    and the UNIQUE index still allows any number of NULLs
 *  - POST /api/market-overview/analyses stores what was typed (or NULL —
 *    no fabricated NEW- codes), applies a supplied code to an existing
 *    same-name industry (fill-or-update), and rejects bad formats
 *  - code collisions surface as 409 code_in_use (POST and PATCH alike)
 *  - GET /api/market-overview/ksic searches the curated master dataset
 *
 * Mirrors the scratch-SQLite + nextRequest pattern of
 * tests/unit/projects-list-route.test.ts.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const TEST_DB_PATH = "db/data/test-market-overview-ksic.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

const NOW = new Date().toISOString();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  const setCookie = res.headers.getSetCookie()[0] ?? "";
  return setCookie.split(";")[0];
}

function industryCode(nameKo: string): string | null | undefined {
  const row = db.query("SELECT ksic_code FROM md_industry WHERE name_ko = ?").get(nameKo) as
    | { ksic_code: string | null }
    | undefined;
  return row?.ksic_code;
}

let analystCookie: string;
let viewerCookie: string;

beforeAll(async () => {
  await createUser(db, { userId: "analyst1", role: "analyst", password: "pw-analyst-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "analyst1", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "viewer1", role: "viewer", password: "pw-viewer-123456", createdBy: "test", now: NOW });
  approveUser(db, { userId: "viewer1", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie("analyst1", "pw-analyst-12345");
  viewerCookie = await loginCookie("viewer1", "pw-viewer-123456");

  // Dedicated rows so the 409 collision tests never depend on side effects
  // of other tests: "code-owner" holds 28299 for both the POST and PATCH
  // collision cases; "기존 발전 산업" is the PATCH target.
  const ins = db.query(
    "INSERT INTO md_industry (id, ksic_code, naics_code, isic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?,?,?)",
  );
  ins.run(["test-industry-owner", "28299", null, null, "코드 소유 산업", "owner", NOW]);
  ins.run(["test-industry-patch-target", "35111", null, null, "기존 발전 산업", "patch-target", NOW]);
});

afterAll(async () => {
  resetDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
});

describe("migration 0078 — ksic_code nullable + NEW-* cleanup", () => {
  test("nulls NEW-* placeholders, keeps HYD-BRK and real codes, allows NULLs under the unique index", () => {
    const path = "db/data/test-ksic-migration-0078.sqlite";
    for (const s of ["", "-wal", "-shm"]) if (existsSync(path + s)) rmSync(path + s);
    const raw = new Database(path, { create: true });
    try {
      // Pre-0078 shape (0033 rebuild): ksic_code TEXT NOT NULL + UNIQUE index.
      raw.run(`
        CREATE TABLE md_industry (
          id TEXT PRIMARY KEY NOT NULL,
          ksic_code TEXT NOT NULL,
          naics_code TEXT,
          isic_code TEXT,
          name_ko TEXT NOT NULL,
          name_en TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX idx_md_industry_ksic ON md_industry(ksic_code);
      `);
      const ins = raw.query(
        "INSERT INTO md_industry (id, ksic_code, naics_code, isic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?,?,?)",
      );
      ins.run(["id-1", "NEW-FXENCH", null, null, "가짜코드 산업", "x", NOW]);
      ins.run(["id-2", "NEW-HR", null, null, "휴머노이드 로봇", "x", NOW]);
      ins.run(["id-3", "HYD-BRK", null, null, "유압브레이커", "x", NOW]);
      ins.run(["id-4", "282", null, null, "이차전지", "x", NOW]);

      const sql = readFileSync(
        join(import.meta.dirname, "..", "..", "db", "migrations", "0078_md_industry_ksic_nullable.sql"),
        "utf-8",
      );
      raw.run(sql);

      const rows = raw.query("SELECT id, ksic_code FROM md_industry ORDER BY id").all() as Array<{ id: string; ksic_code: string | null }>;
      expect(rows.find((r) => r.id === "id-1")!.ksic_code).toBeNull();
      expect(rows.find((r) => r.id === "id-2")!.ksic_code).toBeNull();
      expect(rows.find((r) => r.id === "id-3")!.ksic_code).toBe("HYD-BRK");
      expect(rows.find((r) => r.id === "id-4")!.ksic_code).toBe("282");

      const cols = raw.query("PRAGMA table_info(md_industry)").all() as Array<{ name: string; notnull: number }>;
      expect(cols.find((c) => c.name === "ksic_code")!.notnull).toBe(0);

      // Multiple NULLs coexist; a duplicated non-NULL code still violates the index.
      raw.run(`INSERT INTO md_industry (id, ksic_code, naics_code, isic_code, name_ko, name_en, created_at)
               VALUES ('n1', NULL, NULL, NULL, 'A', 'A', '${NOW}'), ('n2', NULL, NULL, NULL, 'B', 'B', '${NOW}')`);
      expect(() =>
        raw.run(`INSERT INTO md_industry (id, ksic_code, naics_code, isic_code, name_ko, name_en, created_at)
                 VALUES ('n3', '282', NULL, NULL, 'C', 'C', '${NOW}')`),
      ).toThrow();

      const fkIssues = raw.query("PRAGMA foreign_key_check").all();
      expect(fkIssues.length).toBe(0);
    } finally {
      raw.close();
      for (const s of ["", "-wal", "-shm"]) if (existsSync(path + s)) rmSync(path + s);
    }
  });

  test("freshly migrated schema has nullable ksic_code", () => {
    const cols = db.query("PRAGMA table_info(md_industry)").all() as Array<{ name: string; notnull: number }>;
    expect(cols.find((c) => c.name === "ksic_code")!.notnull).toBe(0);
  });
});

describe("migration 0079 — stale profile-anchor remap", () => {
  test("remaps 264/29192/30111/30303 to 261/29280/31111/3131, guarding collisions", () => {
    const path = "db/data/test-ksic-migration-0079.sqlite";
    for (const s of ["", "-wal", "-shm"]) if (existsSync(path + s)) rmSync(path + s);
    const raw = new Database(path, { create: true });
    try {
      raw.run(`
        CREATE TABLE md_industry (
          id TEXT PRIMARY KEY NOT NULL,
          ksic_code TEXT,
          naics_code TEXT,
          isic_code TEXT,
          name_ko TEXT NOT NULL,
          name_en TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX idx_md_industry_ksic ON md_industry(ksic_code);
      `);
      const ins = raw.query(
        "INSERT INTO md_industry (id, ksic_code, naics_code, isic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?,?,?)",
      );
      ins.run(["r-1", "29192", null, null, "로봇 산업", "x", NOW]); // remappable (no 29280 owner)
      ins.run(["r-2", "264", null, null, "반도체 산업", "x", NOW]); // remappable
      ins.run(["r-4", "30111", null, null, "충돌 조선 산업", "x", NOW]); // target 31111 already owned below
      ins.run(["r-5", "31111", null, null, "이미 31111 보유 산업", "x", NOW]);
      ins.run(["r-6", "HYD-BRK", null, null, "유압브레이커", "x", NOW]); // sentinel untouched

      const sql = readFileSync(
        join(import.meta.dirname, "..", "..", "db", "migrations", "0079_profile_anchor_remap.sql"),
        "utf-8",
      );
      raw.run(sql);

      const rows = raw.query("SELECT id, ksic_code FROM md_industry ORDER BY id").all() as Array<{ id: string; ksic_code: string | null }>;
      const codeOf = (id: string) => rows.find((r) => r.id === id)!.ksic_code;
      expect(codeOf("r-1")).toBe("29280"); // remapped
      expect(codeOf("r-2")).toBe("261"); // remapped
      expect(codeOf("r-4")).toBe("30111"); // collision: guard left the old value
      expect(codeOf("r-5")).toBe("31111"); // owner keeps the code
      expect(codeOf("r-6")).toBe("HYD-BRK"); // sentinel untouched
    } finally {
      raw.close();
      for (const s of ["", "-wal", "-shm"]) if (existsSync(path + s)) rmSync(path + s);
    }
  });
});

describe("migration 0080 — HYD-BRK sentinel retirement", () => {
  function openWithRows(rows: Array<[string, string | null]>) {
    const path = `db/data/test-ksic-migration-0080-${rows[0][0]}.sqlite`;
    for (const s of ["", "-wal", "-shm"]) if (existsSync(path + s)) rmSync(path + s);
    const raw = new Database(path, { create: true });
    raw.run(`
      CREATE TABLE md_industry (
        id TEXT PRIMARY KEY NOT NULL,
        ksic_code TEXT,
        naics_code TEXT,
        isic_code TEXT,
        name_ko TEXT NOT NULL,
        name_en TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_md_industry_ksic ON md_industry(ksic_code);
    `);
    const ins = raw.query(
      "INSERT INTO md_industry (id, ksic_code, naics_code, isic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?,?,?)",
    );
    for (const [id, code] of rows) ins.run([id, code, null, null, `name-${id}`, "x", NOW]);
    return { raw, path };
  }
  const apply0080 = (raw: Database) =>
    raw.run(readFileSync(
      join(import.meta.dirname, "..", "..", "db", "migrations", "0080_hyd_brk_sentinel_retirement.sql"),
      "utf-8",
    ));
  const cleanup = (raw: Database, path: string) => {
    raw.close();
    for (const s of ["", "-wal", "-shm"]) if (existsSync(path + s)) rmSync(path + s);
  };

  test("remaps the sentinel to KSIC 29241 when the code is free", () => {
    const { raw, path } = openWithRows([["h-1", "HYD-BRK"]]);
    try {
      apply0080(raw);
      const code = raw.query("SELECT ksic_code FROM md_industry WHERE id = 'h-1'").get() as { ksic_code: string | null };
      expect(code.ksic_code).toBe("29241");
    } finally {
      cleanup(raw, path);
    }
  });

  test("falls back to NULL (미지정) when 29241 is already owned by another row", () => {
    const { raw, path } = openWithRows([["h-1", "29241"], ["h-2", "HYD-BRK"]]);
    try {
      apply0080(raw);
      const rows = raw.query("SELECT id, ksic_code FROM md_industry ORDER BY id").all() as Array<{ id: string; ksic_code: string | null }>;
      expect(rows.find((r) => r.id === "h-1")!.ksic_code).toBe("29241");
      expect(rows.find((r) => r.id === "h-2")!.ksic_code).toBeNull();
    } finally {
      cleanup(raw, path);
    }
  });
});

describe("POST /api/market-overview/analyses — KSIC handling", () => {
  test("no code → industry stored with NULL ksic_code, never a NEW- placeholder", async () => {
    const res = await req("/api/market-overview/analyses", {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ name_ko: "코드 없는 신산업" }),
    });
    expect(res.status).toBe(201);
    expect(industryCode("코드 없는 신산업")).toBeNull();
  });

  test("typed code is stored verbatim", async () => {
    const res = await req("/api/market-overview/analyses", {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ name_ko: "산업용 로봇 분석", ksic_code: "  29192  " }),
    });
    expect(res.status).toBe(201);
    expect(industryCode("산업용 로봇 분석")).toBe("29192");
  });

  test("same-name industry gets the newly supplied code (fill-or-update, not dropped)", async () => {
    const res = await req("/api/market-overview/analyses", {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ name_ko: "산업용 로봇 분석", ksic_code: "264" }),
    });
    // 201 = new analysis, 200 = the still-in-progress analysis is reused —
    // both are fine here; what matters is that the supplied code lands.
    expect([200, 201]).toContain(res.status);
    expect(industryCode("산업용 로봇 분석")).toBe("264");
  });

  test("non-numeric codes are rejected (NEW-* placeholder retired)", async () => {
    for (const bad of ["abc", "NEW-123", "28x21"]) {
      const res = await req("/api/market-overview/analyses", {
        method: "POST",
        headers: { cookie: analystCookie },
        body: JSON.stringify({ name_ko: `형식오류-${bad}`, ksic_code: bad }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("invalid_ksic_code");
    }
  });

  test("a code already owned by a different industry → 409 code_in_use", async () => {
    const res = await req("/api/market-overview/analyses", {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ name_ko: "다른 발전 산업", ksic_code: "28299" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("code_in_use");
  });

  test("viewer role is forbidden", async () => {
    const res = await req("/api/market-overview/analyses", {
      method: "POST",
      headers: { cookie: viewerCookie },
      body: JSON.stringify({ name_ko: "뷰어 산업" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/market-overview/industry/:id — KSIC handling", () => {
  test("invalid code rejected", async () => {
    const row = db.query("SELECT id FROM md_industry WHERE name_ko = ?").get("기존 발전 산업") as { id: string };
    const res = await req(`/api/market-overview/industry/${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ name_ko: "기존 발전 산업", ksic_code: "not-a-code" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_ksic_code");
  });

  test("retired HYD-BRK sentinel is rejected; NULL clears the code", async () => {
    const row = db.query("SELECT id FROM md_industry WHERE name_ko = ?").get("기존 발전 산업") as { id: string };
    const path = `/api/market-overview/industry/${encodeURIComponent(row.id)}`;
    const setSentinel = await req(path, {
      method: "PATCH",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ name_ko: "기존 발전 산업", ksic_code: "HYD-BRK" }),
    });
    expect(setSentinel.status).toBe(400);
    const errBody = (await setSentinel.json()) as { error: { code: string } };
    expect(errBody.error.code).toBe("invalid_ksic_code");

    const clear = await req(path, {
      method: "PATCH",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ name_ko: "기존 발전 산업", ksic_code: null }),
    });
    expect(clear.status).toBe(200);
    expect(industryCode("기존 발전 산업")).toBeNull();
  });

  test("collision with another industry's code → 409 code_in_use", async () => {
    const row = db.query("SELECT id FROM md_industry WHERE name_ko = ?").get("기존 발전 산업") as { id: string };
    const res = await req(`/api/market-overview/industry/${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ name_ko: "기존 발전 산업", ksic_code: "28299" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("code_in_use");
  });
});

describe("GET /api/market-overview/ksic — curated master search", () => {
  test("anonymous request is rejected", async () => {
    const res = await req("/api/market-overview/ksic");
    expect(res.status).toBe(401);
  });

  test("code prefix search finds profile entries", async () => {
    const res = await req("/api/market-overview/ksic?q=292", { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { entries: Array<{ code: string; name_ko: string }> } };
    expect(body.data.entries.some((e) => e.code === "29241")).toBe(true);
    expect(body.data.entries.some((e) => e.code === "29280")).toBe(true);
  });

  test("corrected profile anchors are searchable (261/31111)", async () => {
    const res = await req("/api/market-overview/ksic?q=26", { headers: { cookie: analystCookie } });
    const body = (await res.json()) as { data: { entries: Array<{ code: string; name_ko: string }> } };
    expect(body.data.entries.some((e) => e.code === "261" && e.name_ko === "반도체 제조업")).toBe(true);

    const res2 = await req("/api/market-overview/ksic?q=311", { headers: { cookie: analystCookie } });
    const body2 = (await res2.json()) as { data: { entries: Array<{ code: string; name_ko: string }> } };
    expect(body2.data.entries.some((e) => e.code === "31111" && e.name_ko === "강선 건조업")).toBe(true);
  });

  test("Korean name search works — 74100 shows its official 11th-revision name (ADR-0111 revision)", async () => {
    const res = await req(`/api/market-overview/ksic?q=${encodeURIComponent("사업시설")}`, { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { entries: Array<{ code: string; name_ko: string }> } };
    const entry = body.data.entries.find((e) => e.code === "74100");
    expect(entry?.name_ko).toBe("사업시설 유지·관리 서비스업");
  });

  test("profile alias search matches via the detail field", async () => {
    const res = await req(`/api/market-overview/ksic?q=${encodeURIComponent("발전소")}`, { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { entries: Array<{ code: string }> } };
    expect(body.data.entries.some((e) => e.code === "74100")).toBe(true);
  });

  test("empty query returns the full curated list", async () => {
    const res = await req("/api/market-overview/ksic", { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { entries: unknown[] }, meta: { count: number } };
    expect(body.data.entries.length).toBe(13);
    expect(body.meta.count).toBe(13);
  });
});
