// @version 1.0.0
/**
 * ADR-0208 slice 4 - the gated KOFIA collection: the collector (app/web-next/lib/kofia-collector.ts) and
 * POST/GET /api/projects/[id]/wacc/kofia/collect. Real route handlers + scratch SQLite; the KOFIA transport is the injected
 * `post` seam with the recorded fixtures, so NO live network.
 * Covers: the switch is OFF by default (collector refuses BEFORE any network call; POST 503 kofia_collect_disabled without a run
 * or an audit row; GET reports enabled:false), switch ON (202, job_run lifecycle, audit by the caller, day-grain observations
 * for the KTB and the ten grades, re-run idempotent), authorization (viewer 403, outsider/admin 404, anonymous 401), a
 * layout change failing the run (nothing written), and the global 409 already_running.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DB_PATH = "db/data/test-wacc-kofia-collect-route.sqlite";
const ENV_ORIGINALS: Record<string, string | undefined> = {
  CO_NEWBIZ_DB_PATH: process.env.CO_NEWBIZ_DB_PATH,
  CO_NEWBIZ_KOFIA_COLLECT: process.env.CO_NEWBIZ_KOFIA_COLLECT,
};
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
delete process.env.CO_NEWBIZ_KOFIA_COLLECT;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { KOFIA_GRADES, KOFIA_KTB_SERIES_ID, kofiaGradeSeriesId, latestKofiaDate, readKofiaGradeReading } = await import(
  "../../db/lib/kofia-grade-yield.ts"
);
const { collectKofiaGradeYields, kofiaCollectEnabled, KofiaCollectDisabledError } = await import(
  "../../app/web-next/lib/kofia-collector.ts"
);
const { KOFIA_COLLECT_JOB_KEY, kofiaCollectionIdle, setKofiaCollectionTestHooks } = await import(
  "../../app/web-next/lib/kofia-collection-runner.ts"
);

const NOW = new Date().toISOString();
const fx = (name: string) => readFileSync(join(import.meta.dirname, "..", "fixtures", "kofia", name), "utf8");

/** Recorded transport: answers the three service calls from the fixtures and counts them. */
function fixtureTransport() {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      async post(body: string): Promise<string> {
        const fn = body.match(/<pfmFnName>(\w+)<\/pfmFnName>/)?.[1] ?? "";
        calls.push(fn);
        if (fn === "getExistMaxDate") return fx("get-exist-max-date.xml");
        if (fn === "getHeadList") return fx("get-head-list.xml");
        if (fn === "selectDay") return fx("select-day-average.xml");
        throw new Error(`unexpected call ${fn}`);
      },
    },
  };
}

let analystCookie = "";
let viewerCookie = "";
let outsiderCookie = "";
let adminCookie = "";
let projectA = "";
let projectB = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
async function mkUser(userId: string, role: "analyst" | "viewer" | "admin"): Promise<string> {
  await createUser(db, { userId, role, password: `pw-${userId}-12345`, createdBy: "test", now: NOW });
  approveUser(db, { userId, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = ?", [userId]);
  return loginCookie(userId, `pw-${userId}-12345`);
}
function mkProject(no: string): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, status) VALUES (?,?,?, 'open')", [id, no, NOW]);
  for (const [userId, role] of [
    ["kf-analyst", "lead"],
    ["kf-viewer", "member"],
  ]) {
    db.run(
      "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
      [id, userId, role, "test", NOW, "kofia collect test"],
    );
  }
  return id;
}
const collect = (projectId: string, cookie: string | null, method: "POST" | "GET" = "POST") =>
  nextRequest(`/api/projects/${projectId}/wacc/kofia/collect`, { method, headers: cookie ? { cookie } : {} });
const runs = () =>
  db.query("SELECT * FROM job_run WHERE job_key = ? ORDER BY started_at, id").all(KOFIA_COLLECT_JOB_KEY) as Array<
    Record<string, unknown>
  >;
const auditCount = () =>
  (db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'wacc_kofia.collect_requested'").get() as { n: number })
    .n;
const obsCount = (sid: string) =>
  (db.query("SELECT COUNT(*) AS n FROM fact_market_observation WHERE series_id = ?").get(sid) as { n: number }).n;
const clearKofia = () => {
  db.run("DELETE FROM fact_market_observation WHERE series_id LIKE 'kofia:%'");
  db.run("DELETE FROM job_run WHERE job_key = ?", [KOFIA_COLLECT_JOB_KEY]);
};

beforeAll(async () => {
  analystCookie = await mkUser("kf-analyst", "analyst");
  viewerCookie = await mkUser("kf-viewer", "viewer");
  outsiderCookie = await mkUser("kf-outsider", "analyst");
  adminCookie = await mkUser("kf-admin", "admin");
  projectA = mkProject("PRJ-KF-A");
  projectB = mkProject("PRJ-KF-B");
});
afterEach(() => {
  delete process.env.CO_NEWBIZ_KOFIA_COLLECT;
  setKofiaCollectionTestHooks({});
  clearKofia();
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  for (const [key, value] of Object.entries(ENV_ORIGINALS)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("the switch is OFF by default", () => {
  test("kofiaCollectEnabled() is false when unset or not exactly 'on'", () => {
    expect(kofiaCollectEnabled()).toBe(false);
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "true";
    expect(kofiaCollectEnabled()).toBe(false);
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    expect(kofiaCollectEnabled()).toBe(true);
  });

  test("the collector refuses before any network call and writes nothing", async () => {
    const t = fixtureTransport();
    await expect(collectKofiaGradeYields(db, new Date(), t.deps)).rejects.toBeInstanceOf(KofiaCollectDisabledError);
    expect(t.calls).toEqual([]);
    expect(obsCount(KOFIA_KTB_SERIES_ID)).toBe(0);
  });

  test("POST -> 503 kofia_collect_disabled: no run, no audit, no network", async () => {
    const t = fixtureTransport();
    setKofiaCollectionTestHooks({ deps: t.deps });
    const a0 = auditCount();
    const res = await collect(projectA, analystCookie);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { data: unknown; error: { code: string; message: string } };
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("kofia_collect_disabled");
    expect(body.error.message).toContain("CO_NEWBIZ_KOFIA_COLLECT");
    expect(runs()).toHaveLength(0);
    expect(auditCount()).toBe(a0);
    expect(t.calls).toEqual([]);
  }, 60000);

  test("GET status stays readable and says enabled:false", async () => {
    const res = await collect(projectA, viewerCookie, "GET");
    expect(res.status).toBe(200);
    const data = ((await res.json()) as { data: { enabled: boolean; run: unknown } }).data;
    expect(data.enabled).toBe(false);
    expect(data.run).toBeNull();
  }, 60000);

  test("the suggestions payload reports kofia_collect.enabled false; and true once the switch is on", async () => {
    const company = ulid();
    db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [company, "코피아테스트", NOW]);
    const p = mkProject("PRJ-KF-S");
    db.run("UPDATE md_project SET company_id = ? WHERE id = ?", [company, p]);
    const get = async () =>
      (
        (await (
          await nextRequest(`/api/projects/${p}/wacc/suggestions`, { headers: { cookie: analystCookie } })
        ).json()) as {
          data: { kofia_collect: { enabled: boolean } };
        }
      ).data.kofia_collect.enabled;
    expect(await get()).toBe(false);
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    expect(await get()).toBe(true);
  }, 60000);
});

describe("authorization (switch on)", () => {
  test("viewer 403 role_required; outsider and admin 404; anonymous 401 - nothing recorded", async () => {
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    const a0 = auditCount();
    const viewer = await collect(projectA, viewerCookie);
    expect(viewer.status).toBe(403);
    expect(((await viewer.json()) as { error: { code: string } }).error.code).toBe("role_required");
    expect((await collect(projectA, outsiderCookie)).status).toBe(404);
    expect((await collect(projectA, adminCookie)).status).toBe(404);
    expect((await collect(projectA, null)).status).toBe(401);
    expect(runs()).toHaveLength(0);
    expect(auditCount()).toBe(a0);
  }, 60000);
});

describe("switch ON", () => {
  test("collector: three calls, KTB 3y and the ten grades stored as day-grain observations; re-run is a no-op", async () => {
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    const t = fixtureTransport();
    const r = await collectKofiaGradeYields(db, new Date(), t.deps);
    expect(t.calls).toEqual(["getExistMaxDate", "getHeadList", "selectDay"]);
    expect(r).toMatchObject({ date: "2026-11-26", ktb_pct: 3.612, grades_written: 10, rows_changed: 0 });
    expect(r.source_url).toContain("kofiabond.or.kr");
    expect(obsCount(KOFIA_KTB_SERIES_ID)).toBe(1);
    for (const g of KOFIA_GRADES) expect(obsCount(kofiaGradeSeriesId(g))).toBe(1);
    // day-grain period, percent unit, source 'kofia'
    const row = db
      .query(
        `SELECT p.period_type AS pt, p.start_date AS d, u.code AS unit, s.code AS source, o.value AS v
         FROM fact_market_observation o JOIN md_period p ON p.id = o.period_id
         JOIN md_unit u ON u.id = o.unit_id JOIN md_source s ON s.id = o.source_id
         WHERE o.series_id = ?`,
      )
      .get(kofiaGradeSeriesId("BBB-")) as Record<string, unknown>;
    expect(row).toEqual({ pt: "date", d: "2026-11-26", unit: "percent", source: "kofia", v: 10.07 });
    expect(latestKofiaDate(db)).toBe("2026-11-26");
    const reading = readKofiaGradeReading(db, "A");
    expect(reading).toMatchObject({
      date: "2026-11-26",
      month: "2026-11",
      gradeYieldPct: 4.934,
      ktbPct: 3.612,
      aaMinusPct: 4.274,
      bbbMinusPct: 10.07,
    });
    // a month with no data -> null
    expect(readKofiaGradeReading(db, "A", "2026-10")).toBeNull();
    // BB+ is not a KOFIA grade
    expect(readKofiaGradeReading(db, "BB+")).toBeNull();
    // idempotent: same values, no new revision
    await collectKofiaGradeYields(db, new Date(), fixtureTransport().deps);
    expect(obsCount(kofiaGradeSeriesId("A"))).toBe(1);
  }, 60000);

  test("POST -> 202, job_run by the caller, audit, observations; GET shows the run with enabled:true", async () => {
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    const t = fixtureTransport();
    setKofiaCollectionTestHooks({ deps: t.deps });
    const a0 = auditCount();
    const res = await collect(projectA, analystCookie);
    expect(res.status).toBe(202);
    const data = ((await res.json()) as { data: { run_id: string; status: string; project_id: string } }).data;
    expect(data).toMatchObject({ status: "running", project_id: projectA });
    const row0 = db.query('SELECT actor, "trigger" AS trig FROM job_run WHERE id = ?').get(data.run_id) as {
      actor: string;
      trig: string;
    };
    expect(row0).toEqual({ actor: "kf-analyst", trig: "manual" });
    await kofiaCollectionIdle();
    expect(auditCount()).toBe(a0 + 1);
    const get = (
      (await (await collect(projectB, viewerCookie, "GET")).json()) as {
        data: { enabled: boolean; run: { status: string; result: { date: string; grades_written: number } } };
      }
    ).data;
    expect(get.enabled).toBe(true);
    expect(get.run.status).toBe("success");
    expect(get.run.result).toMatchObject({ date: "2026-11-26", grades_written: 10 });
    expect(obsCount(KOFIA_KTB_SERIES_ID)).toBe(1);
  }, 60000);

  test("a layout change fails the run and writes nothing", async () => {
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    setKofiaCollectionTestHooks({
      deps: {
        async post(body: string) {
          const fn = body.match(/<pfmFnName>(\w+)<\/pfmFnName>/)?.[1];
          if (fn === "getExistMaxDate") return fx("get-exist-max-date.xml");
          if (fn === "getHeadList") return fx("get-head-list.xml");
          return "<html><body>service moved</body></html>";
        },
      },
    });
    expect((await collect(projectA, analystCookie)).status).toBe(202);
    await kofiaCollectionIdle();
    const run = (
      (await (await collect(projectA, analystCookie, "GET")).json()) as {
        data: { run: { status: string; error: string } };
      }
    ).data.run;
    expect(run.status).toBe("failed");
    expect(run.error).toContain("not a service response");
    expect(obsCount(KOFIA_KTB_SERIES_ID)).toBe(0);
  }, 60000);

  test("a running collection blocks everyone (global 409 already_running)", async () => {
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = fixtureTransport().deps;
    setKofiaCollectionTestHooks({
      deps: {
        async post(body: string) {
          await gate;
          return inner.post(body);
        },
      },
    });
    const first = await collect(projectA, analystCookie);
    expect(first.status).toBe(202);
    const started = ((await first.json()) as { data: { run_id: string } }).data;
    for (const project of [projectA, projectB]) {
      const dup = await collect(project, analystCookie);
      expect(dup.status).toBe(409);
      const body = (await dup.json()) as { error: { code: string; details?: { run_id?: string } } };
      expect(body.error.code).toBe("already_running");
      expect(body.error.details?.run_id).toBe(started.run_id);
    }
    release();
    await kofiaCollectionIdle();
    expect(runs()).toHaveLength(1);
  }, 60000);
});
