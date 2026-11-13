// @version 1.0.0
/**
 * GET/PUT/DELETE /api/opportunities/[id]/driver-links (spec
 * 2026-11-13-s2-driver-linkage D-B, DEC-20261113-05, ADR-0198) — the S1→S2
 * driver promotion path: analyst-only, audited, captured provenance with a
 * server-stamped confidence "C". Route-level through next-route-dispatch +
 * scratch SQLite (pattern: entry-market-flow-route-additive.test.ts).
 * Boundary D-E is pinned here: no score/verdict/factors mutation (row
 * equality before/after PUT) and no grade uplift (the client-supplied
 * confidence key is a 400 and the stored value is always "C").
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-driver-links.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

const NOW = new Date().toISOString();
const ANALYST = "driver-analyst";
const VIEWER = "driver-viewer";
let cookie = "";
let viewerCookie = "";
const json = JSON.stringify;

async function login(userId: string, pw: string) {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: json({ userId, password: pw }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

/** One S1 industry with a completed analysis + version (for the version_no join). */
function seedIndustry(name: string) {
  const ind = `ind-${ulid().slice(-8)}`;
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
    ind,
    ind,
    name,
    name,
    NOW,
  ]);
  db.run(
    "INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
    [`ana-${ind}`, ind, "completed", ANALYST, NOW, NOW],
  );
  db.run(
    "INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [`ver-${ind}`, `ana-${ind}`, 3, json({}), ANALYST, NOW],
  );
  return ind;
}

function seedDriver(industryId: string, status: "accepted" | "proposed" | "dismissed", driver = "물류 수요 확대") {
  const id = `idc-${ulid().slice(-10)}`;
  db.run(
    "INSERT INTO industry_driver_calibration (id, industry_id, version_id, driver, direction, impact_pct, rationale, status, proposed_by, decided_by, decided_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      industryId,
      `ver-${industryId}`,
      driver,
      "upside",
      1.8,
      "외부 참조 대비 우리 CAGR 격차의 근거",
      status,
      "market-sizing-pipeline",
      status === "accepted" ? ANALYST : null,
      status === "accepted" ? NOW : null,
      NOW,
    ],
  );
  return id;
}

function makeOpp(industryId: string | null): string {
  const oppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, industry_id) VALUES (?,?,?,?,?,?,?)",
    [oppId, `opp ${oppId.slice(-5)}`, "scope", "identified", ANALYST, NOW, industryId],
  );
  return oppId;
}

const putLink = (oppId: string, body: unknown, headers: Record<string, string> = { cookie }) =>
  nextRequest(`/api/opportunities/${oppId}/driver-links`, { method: "PUT", headers, body: json(body) });
const getLinks = (oppId: string, headers: Record<string, string> = { cookie }) =>
  nextRequest(`/api/opportunities/${oppId}/driver-links`, { method: "GET", headers });
const delLink = (oppId: string, body: unknown, headers: Record<string, string> = { cookie }) =>
  nextRequest(`/api/opportunities/${oppId}/driver-links`, { method: "DELETE", headers, body: json(body) });

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-driver-a1", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-driver-v1", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await login(ANALYST, "pw-driver-a1");
  viewerCookie = await login(VIEWER, "pw-driver-v1");
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("driver-links PUT — access + strict validation", () => {
  test("unauthenticated PUT is 401", async () => {
    const opp = makeOpp(null);
    expect((await putLink(opp, { driver_row_id: "x" }, {})).status).toBe(401);
  });

  test("viewer PUT is 403 with the role message", async () => {
    const opp = makeOpp(null);
    const res = await putLink(opp, { driver_row_id: "x" }, { cookie: viewerCookie });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("role_required");
    expect(body.error.message).toContain("analyst");
  });

  test("unknown opportunity is 404 (404-not-403)", async () => {
    expect((await putLink("no-such-opp", { driver_row_id: "x" })).status).toBe(404);
  });

  test("unknown driver row is 404", async () => {
    const ind = seedIndustry("드라이버 산업");
    const opp = makeOpp(ind);
    const res = await putLink(opp, { driver_row_id: "idc-missing" });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  test("proposed and dismissed rows are 400 not_accepted", async () => {
    const ind = seedIndustry("미수용 산업");
    const opp = makeOpp(ind);
    const proposed = seedDriver(ind, "proposed");
    const dismissed = seedDriver(ind, "dismissed");
    const r1 = await putLink(opp, { driver_row_id: proposed });
    expect(r1.status).toBe(400);
    expect((await r1.json()).error.code).toBe("not_accepted");
    const r2 = await putLink(opp, { driver_row_id: dismissed });
    expect(r2.status).toBe(400);
    expect((await r2.json()).error.code).toBe("not_accepted");
  });

  test("cross-industry driver is 400 industry_mismatch", async () => {
    const indA = seedIndustry("산업 A");
    const indB = seedIndustry("산업 B");
    const opp = makeOpp(indB);
    const driver = seedDriver(indA, "accepted");
    const res = await putLink(opp, { driver_row_id: driver });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("industry_mismatch");
  });

  test("client-supplied confidence (or any extra key) is a 400 — strict whitelist", async () => {
    const ind = seedIndustry("신뢰도 시도 산업");
    const opp = makeOpp(ind);
    const driver = seedDriver(ind, "accepted");
    const res = await putLink(opp, { driver_row_id: driver, confidence: "A" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toContain("confidence");
  });
});

describe("driver-links PUT — happy path + boundaries", () => {
  test("happy path: captured provenance, server-stamped confidence C, exactly one audit row", async () => {
    const ind = seedIndustry("수용 드라이버 산업");
    const opp = makeOpp(ind);
    const driver = seedDriver(ind, "accepted", "수용된 물류 드라이버");
    const auditsBefore = (
      db.query("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'opportunity.driver_links.update'").get() as {
        c: number;
      }
    ).c;
    const res = await putLink(opp, { driver_row_id: driver, note: "이 기회의 수요 근거" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.links).toHaveLength(1);
    const link = body.data.links[0];
    expect(link.driver_row_id).toBe(driver);
    expect(link.industry_id).toBe(ind);
    expect(link.industry_name).toBe("수용 드라이버 산업");
    expect(link.driver).toBe("수용된 물류 드라이버");
    expect(link.direction).toBe("upside");
    expect(link.impact_pct).toBe(1.8);
    expect(link.decided_by).toBe(ANALYST);
    expect(link.version_no).toBe(3);
    expect(link.confidence).toBe("C");
    expect(link.attached_by).toBe(ANALYST);
    expect(link.note).toBe("이 기회의 수요 근거");
    const auditsAfter = (
      db.query("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'opportunity.driver_links.update'").get() as {
        c: number;
      }
    ).c;
    expect(auditsAfter - auditsBefore).toBe(1);
    const audit = db.query("SELECT target FROM audit_log WHERE target = ?").get(`${opp}:add:${driver}`);
    expect(audit).not.toBeNull();
  });

  test("duplicate driver_row_id is 409 already_linked", async () => {
    const ind = seedIndustry("중복 산업");
    const opp = makeOpp(ind);
    const driver = seedDriver(ind, "accepted");
    expect((await putLink(opp, { driver_row_id: driver })).status).toBe(200);
    const res = await putLink(opp, { driver_row_id: driver });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("already_linked");
  });

  test("cap-11th link is 400", async () => {
    const ind = seedIndustry("상한 산업");
    const opp = makeOpp(ind);
    const links = [];
    for (let i = 0; i < 10; i++) {
      links.push({
        driver_row_id: `idc-seed-${i}`,
        industry_id: ind,
        industry_name: "상한 산업",
        driver: `시드 드라이버 ${i}`,
        direction: "upside",
        impact_pct: 1,
        rationale: "시드",
        decided_by: ANALYST,
        decided_at: NOW,
        version_no: 1,
        confidence: "C",
        attached_by: ANALYST,
        attached_at: NOW,
      });
    }
    db.run("UPDATE opportunity SET driver_links_json = ? WHERE id = ?", [
      json({ links, set_by: ANALYST, set_at: NOW }),
      opp,
    ]);
    const driver = seedDriver(ind, "accepted", "11번째 드라이버");
    const res = await putLink(opp, { driver_row_id: driver });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("cap_exceeded");
  });

  test("no-mutation boundary: attractiveness_score, synergy_score, status, factors_json byte-identical before/after PUT", async () => {
    const ind = seedIndustry("불변 경계 산업");
    const opp = makeOpp(ind);
    db.run(
      "UPDATE opportunity SET attractiveness_score = 72, synergy_score = 55, status = 'assessed', factors_json = ? WHERE id = ?",
      [json({ opportunity: ["기존 요인"], risk: ["기존 위험"] }), opp],
    );
    const before = db
      .query("SELECT attractiveness_score, synergy_score, status, factors_json FROM opportunity WHERE id = ?")
      .get(opp);
    const driver = seedDriver(ind, "accepted", "불변 경계 드라이버");
    const res = await putLink(opp, { driver_row_id: driver });
    expect(res.status).toBe(200);
    const after = db
      .query("SELECT attractiveness_score, synergy_score, status, factors_json FROM opportunity WHERE id = ?")
      .get(opp);
    expect(after).toEqual(before);
    // Only the additive column moved.
    const stored = (
      db.query("SELECT driver_links_json FROM opportunity WHERE id = ?").get(opp) as { driver_links_json: string }
    ).driver_links_json;
    expect(JSON.parse(stored).links).toHaveLength(1);
  });
});

describe("driver-links DELETE", () => {
  test("removes only the targeted link, audit row written; absent link is 404", async () => {
    const ind = seedIndustry("해제 산업");
    const opp = makeOpp(ind);
    const d1 = seedDriver(ind, "accepted", "해제 대상 드라이버");
    const d2 = seedDriver(ind, "accepted", "남는 드라이버");
    await putLink(opp, { driver_row_id: d1 });
    await putLink(opp, { driver_row_id: d2 });
    const auditsBefore = (
      db.query("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'opportunity.driver_links.update'").get() as {
        c: number;
      }
    ).c;
    const res = await delLink(opp, { driver_row_id: d1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.links).toHaveLength(1);
    expect(body.data.links[0].driver_row_id).toBe(d2);
    const auditsAfter = (
      db.query("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'opportunity.driver_links.update'").get() as {
        c: number;
      }
    ).c;
    expect(auditsAfter - auditsBefore).toBe(1);
    // Same-ms writes share a created_at — assert the remove target directly.
    const removed = db.query("SELECT id FROM audit_log WHERE target = ?").get(`${opp}:remove:${d1}`);
    expect(removed).not.toBeNull();
    const absent = await delLink(opp, { driver_row_id: d1 });
    expect(absent.status).toBe(404);
  });

  test("viewer DELETE is 403; unknown opportunity is 404", async () => {
    const ind = seedIndustry("해제 권한 산업");
    const opp = makeOpp(ind);
    const driver = seedDriver(ind, "accepted");
    await putLink(opp, { driver_row_id: driver });
    expect((await delLink(opp, { driver_row_id: driver }, { cookie: viewerCookie })).status).toBe(403);
    expect((await delLink("no-such-opp", { driver_row_id: driver })).status).toBe(404);
  });
});

describe("driver-links GET — tolerant parse + row_status", () => {
  test("the CHECK blocks invalid JSON on write; the lib parse still degrades to null, never a throw", async () => {
    const ind = seedIndustry("손상 산업");
    const opp = makeOpp(ind);
    // The json_valid CHECK keeps hand-corrupted rows out of the column...
    expect(() => db.run("UPDATE opportunity SET driver_links_json = '{not-valid-json' WHERE id = ?", [opp])).toThrow();
    // ...and the tolerant parse is the second line of defense for any row that
    // predates or bypasses the constraint (shape drift, hand-written rows).
    const { parseDriverLinksJson } = await import("../../app/web-next/lib/opportunity-driver-links.ts");
    expect(parseDriverLinksJson("{not-valid-json")).toBeNull();
    expect(parseDriverLinksJson("[1,2]")).toBeNull();
    expect(parseDriverLinksJson(json({ links: "nope" }))).toBeNull();
    expect(parseDriverLinksJson(json({ links: [{ driver_row_id: "x" }], set_by: "u", set_at: NOW }))).toBeNull();
    const res = await getLinks(opp);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.links).toEqual([]);
    expect(body.data.row_status).toEqual({});
  });

  test("row_status maps accepted / changed / missing against the live table", async () => {
    const ind = seedIndustry("상태 산업");
    const opp = makeOpp(ind);
    const accepted = seedDriver(ind, "accepted", "수용 유지 드라이버");
    const changed = seedDriver(ind, "accepted", "나중에 기각된 드라이버");
    const missing = "idc-gone";
    db.run("UPDATE opportunity SET driver_links_json = ? WHERE id = ?", [
      json({
        links: [
          {
            driver_row_id: accepted,
            industry_id: ind,
            industry_name: "상태 산업",
            driver: "수용 유지 드라이버",
            direction: "upside",
            impact_pct: 1,
            rationale: "r",
            decided_by: ANALYST,
            decided_at: NOW,
            version_no: 1,
            confidence: "C",
            attached_by: ANALYST,
            attached_at: NOW,
          },
          {
            driver_row_id: changed,
            industry_id: ind,
            industry_name: "상태 산업",
            driver: "나중에 기각된 드라이버",
            direction: "downside",
            impact_pct: 2,
            rationale: "r",
            decided_by: ANALYST,
            decided_at: NOW,
            version_no: 1,
            confidence: "C",
            attached_by: ANALYST,
            attached_at: NOW,
          },
          {
            driver_row_id: missing,
            industry_id: ind,
            industry_name: "상태 산업",
            driver: "삭제된 드라이버",
            direction: "upside",
            impact_pct: 1,
            rationale: "r",
            decided_by: ANALYST,
            decided_at: NOW,
            version_no: 1,
            confidence: "C",
            attached_by: ANALYST,
            attached_at: NOW,
          },
        ],
        set_by: ANALYST,
        set_at: NOW,
      }),
      opp,
    ]);
    db.run("UPDATE industry_driver_calibration SET status = 'dismissed', decided_by = ?, decided_at = ? WHERE id = ?", [
      ANALYST,
      NOW,
      changed,
    ]);
    const res = await getLinks(opp);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.row_status[accepted]).toBe("accepted");
    expect(body.data.row_status[changed]).toBe("changed");
    expect(body.data.row_status[missing]).toBe("missing");
  });

  test("unauthenticated GET is 401; unknown opportunity is 404", async () => {
    expect((await getLinks("any", {})).status).toBe(401);
    expect((await getLinks("no-such-opp")).status).toBe(404);
  });
});

describe("source assertion — no score/verdict/factors writes in the lib (D-E)", () => {
  const libSrc = readFileSync(join(PROJECT_ROOT, "app/web-next/lib/opportunity-driver-links.ts"), "utf-8");
  test("the lib never mentions the score/status/factors columns", () => {
    expect(libSrc).not.toContain("attractiveness_score");
    expect(libSrc).not.toContain("synergy_score");
    expect(libSrc).not.toContain("factors_json");
    // "status" only ever appears as the DRIVER row's status (read), never as a
    // column write on opportunity — assert the exact legitimate occurrences.
    const statusLines = libSrc.split("\n").filter((l) => /\bstatus\b/.test(l));
    for (const l of statusLines) expect(l).toMatch(/liveStatus|industry_driver_calibration|rowStatus/);
  });
});
