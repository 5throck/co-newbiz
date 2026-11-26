// @version 1.0.0
/**
 * POST/GET /api/projects/[id]/wacc/beta-series/collect — the in-app "수집 실행" (KRX beta collection).
 *
 * Real route handlers + scratch SQLite (db/data/test-beta-series-collect-route.sqlite). KRX HTTP is a
 * recorded mock on globalThis.fetch — NO live network; pacing is zeroed through the runner's test hooks.
 * Covers: authorization (viewer 403, non-member/admin 404, unauthenticated 401), 400 without a subject
 * company, 503 without KRX_API_KEY (no job_run row, no audit), 202 + job_run lifecycle + audit with the
 * calling user as actor, per-project 409 already_running, cross-project 409 collection_busy, the failure
 * path landing on the run (status failed, not an HTTP error), stale-run sweep, and the shared core staying
 * callable from the CLI wrapper (betaSeriesMain) with unchanged exit behavior.
 */
import { test, expect, beforeAll, afterAll, afterEach, describe } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import type { BetaCollectionResult } from "../../scripts/co-newbiz/beta-series-core.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DB_PATH = "db/data/test-beta-series-collect-route.sqlite";
const TMP = mkdtempSync(join(tmpdir(), "beta-collect-"));
// Module-level env is process-wide (coverage runs every tests/unit file in ONE process): remember the
// originals and put them back in afterAll so later files never see this file's temp paths.
const ENV_ORIGINALS: Record<string, string | undefined> = {
  CO_NEWBIZ_DB_PATH: process.env.CO_NEWBIZ_DB_PATH,
  CO_NEWBIZ_KRX_CODE_CACHE: process.env.CO_NEWBIZ_KRX_CODE_CACHE,
};
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
// Keep the tracked db/data/krx-stock-code-cache.json untouched: the flow resolves codes through the mocked master.
process.env.CO_NEWBIZ_KRX_CODE_CACHE = join(TMP, "krx-stock-code-cache.json");
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { loadPipelineKeys } = await import("../../scripts/lib/env-keys.ts");
const { resetKrxRunState } = await import("../../scripts/co-newbiz/source-adapters.ts");
const { BetaSeriesError, runBetaCollection } = await import("../../scripts/co-newbiz/beta-series-core.ts");
const { betaSeriesMain } = await import("../../scripts/co-newbiz/beta-series.ts");
const { BETA_COLLECT_JOB_KEY, STALE_RUN_MS, betaCollectionIdle, setBetaCollectionTestHooks, sweepStaleBetaRuns } =
  await import("../../app/web-next/lib/beta-collection-runner.ts");

const NOW = new Date().toISOString();

/** A minimal, fully typed collection result for runs whose content the test does not care about. */
const fakeResult = (projectId: string, collected: number): BetaCollectionResult => ({
  projectId,
  backfillOnly: false,
  collected,
  krxCalls: 0,
  budget: 2000,
  cacheHits: 0,
  emptyDays: 0,
  series: [],
});
const PACING = { minIntervalMs: 0, retryDelayMs: 1 };
const FAKE_KEY = ["fixture", "krx", "key"].join("-"); // dummy fixture, not a credential

// Make the pipeline-key load a no-op first, so deleting/setting KRX_API_KEY below is authoritative.
loadPipelineKeys();
const savedKey = process.env.KRX_API_KEY;
const realFetch = globalThis.fetch;
const setKey = () => {
  process.env.KRX_API_KEY = FAKE_KEY;
};

// ── KRX mock (recorded payload shapes; NO network) ──────────────────────────
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const stockRow = (basDd: string, code: string, close: string) => ({
  BAS_DD: basDd,
  ISU_CD: code,
  ISU_NM: "n",
  TDD_CLSPRC: close,
});
const masterRows = (market: "kospi" | "kosdaq") =>
  market === "kospi"
    ? [{ ISU_CD: "KR7000001001", ISU_SRT_CD: "000001", ISU_NM: "다른회사", ISU_ABBRV: "다른회사", MKT_TP_NM: "KOSPI" }]
    : [
        {
          ISU_CD: "KR7108490004",
          ISU_SRT_CD: "108490",
          ISU_NM: "로보티즈",
          ISU_ABBRV: "로보티즈",
          MKT_TP_NM: "KOSDAQ",
        },
      ];
function mockKrx(): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const service = url.pathname.replace("/svc/apis/", "").replace(".json", "");
    const basDd = url.searchParams.get("basDd") ?? "";
    let rows: unknown[];
    if (service === "sto/stk_isu_base_info") rows = masterRows("kospi");
    else if (service === "sto/ksq_isu_base_info") rows = masterRows("kosdaq");
    else if (service === "idx/kospi_dd_trd") rows = [{ BAS_DD: basDd, IDX_NM: "코스피", CLSPRC_IDX: "6625.93" }];
    else if (service === "idx/kosdaq_dd_trd") rows = [{ BAS_DD: basDd, IDX_NM: "코스닥", CLSPRC_IDX: "892.27" }];
    else rows = [stockRow(basDd, "108490", "297500")];
    return json({ OutBlock_1: rows });
  }) as typeof fetch;
}

// ── fixtures ────────────────────────────────────────────────────────────────
let analystCookie = "";
let viewerCookie = "";
let outsiderCookie = "";
let adminCookie = "";
let projectA = ""; // analyst member, subject company 로보티즈
let projectB = ""; // analyst member, subject company (second company)
let projectNoCompany = "";
let companyA = "";

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
function mkProject(no: string, companyId: string | null, members: Array<[string, string]>): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, company_id, status) VALUES (?,?,?,?, 'open')", [
    id,
    no,
    NOW,
    companyId,
  ]);
  for (const [userId, role] of members) {
    db.run(
      "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
      [id, userId, role, "test", NOW, "beta collect test"],
    );
  }
  return id;
}
const collect = (projectId: string, cookie: string | null, method: "POST" | "GET" = "POST") =>
  nextRequest(`/api/projects/${projectId}/wacc/beta-series/collect`, {
    method,
    headers: cookie ? { cookie } : {},
  });
const runsOf = (projectId: string) =>
  db
    .query(
      "SELECT * FROM job_run WHERE job_key = ? AND json_extract(detail_json, '$.project_id') = ? ORDER BY started_at, id",
    )
    .all(BETA_COLLECT_JOB_KEY, projectId) as Array<Record<string, unknown>>;

beforeAll(async () => {
  analystCookie = await mkUser("bc-analyst", "analyst");
  viewerCookie = await mkUser("bc-viewer", "viewer");
  outsiderCookie = await mkUser("bc-outsider", "analyst");
  adminCookie = await mkUser("bc-admin", "admin");

  companyA = ulid();
  const companyB = ulid();
  db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [companyA, "로보티즈", NOW]);
  db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [companyB, "다른회사", NOW]);
  const members: Array<[string, string]> = [
    ["bc-analyst", "lead"],
    ["bc-viewer", "member"],
  ];
  projectA = mkProject("PRJ-BC-A", companyA, members);
  projectB = mkProject("PRJ-BC-B", companyB, members);
  projectNoCompany = mkProject("PRJ-BC-NC", null, members);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setBetaCollectionTestHooks({});
  if (savedKey === undefined) delete process.env.KRX_API_KEY;
  else process.env.KRX_API_KEY = savedKey;
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  rmSync(TMP, { recursive: true, force: true });
  for (const [key, value] of Object.entries(ENV_ORIGINALS)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("authorization and preflight", () => {
  test("viewer member 403 role_required (no run, no audit); outsider and admin 404; anonymous 401", async () => {
    setKey();
    const viewer = await collect(projectA, viewerCookie);
    expect(viewer.status).toBe(403);
    expect(((await viewer.json()) as { error: { code: string } }).error.code).toBe("role_required");
    expect((await collect(projectA, outsiderCookie)).status).toBe(404);
    expect((await collect(projectA, adminCookie)).status).toBe(404);
    expect((await collect(projectA, null)).status).toBe(401);
    expect(runsOf(projectA)).toHaveLength(0);
    expect(
      db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'beta_series.collect_requested'").get(),
    ).toEqual({ n: 0 });
  }, 60000);

  test("GET status: member (even viewer) sees {run:null} before any run; outsider 404", async () => {
    const viewer = await collect(projectA, viewerCookie, "GET");
    expect(viewer.status).toBe(200);
    expect(((await viewer.json()) as { data: { run: unknown } }).data.run).toBeNull();
    expect((await collect(projectA, outsiderCookie, "GET")).status).toBe(404);
  }, 60000);

  test("no subject company -> 400 no_subject_company, nothing recorded", async () => {
    setKey();
    const res = await collect(projectNoCompany, analystCookie);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("no_subject_company");
    expect(runsOf(projectNoCompany)).toHaveLength(0);
  }, 60000);

  test("missing KRX_API_KEY -> 503 krx_api_key_missing (clear error, no crash, no run, no audit)", async () => {
    delete process.env.KRX_API_KEY;
    const res = await collect(projectA, analystCookie);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { data: unknown; error: { code: string; message: string } };
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("krx_api_key_missing");
    expect(body.error.message).toContain("KRX_API_KEY");
    expect(runsOf(projectA)).toHaveLength(0);
    expect(
      db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'beta_series.collect_requested'").get(),
    ).toEqual({ n: 0 });
  }, 60000);
});

describe("concurrency (409) and failure recording", () => {
  test("a running run blocks the same project (already_running) and other projects (collection_busy)", async () => {
    setKey();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setBetaCollectionTestHooks({
      run: async (opts) => {
        await gate;
        return {
          projectId: opts.projectId,
          backfillOnly: false,
          collected: 7,
          krxCalls: 3,
          budget: 2000,
          cacheHits: 0,
          emptyDays: 0,
          series: [],
        };
      },
    });
    const first = await collect(projectB, analystCookie);
    expect(first.status).toBe(202);
    const started = ((await first.json()) as { data: { run_id: string; status: string } }).data;
    expect(started.status).toBe("running");

    const same = await collect(projectB, analystCookie);
    expect(same.status).toBe(409);
    const sameBody = (await same.json()) as { error: { code: string; details?: { run_id?: string } } };
    expect(sameBody.error.code).toBe("already_running");
    expect(sameBody.error.details?.run_id).toBe(started.run_id);

    const other = await collect(projectA, analystCookie);
    expect(other.status).toBe(409);
    expect(((await other.json()) as { error: { code: string } }).error.code).toBe("collection_busy");

    // The status poll reports running while the gate is closed…
    const mid = ((await (await collect(projectB, viewerCookie, "GET")).json()) as { data: { run: { status: string } } })
      .data.run;
    expect(mid.status).toBe("running");

    release();
    await betaCollectionIdle();
    const done = (
      (await (await collect(projectB, analystCookie, "GET")).json()) as {
        data: { run: { status: string; finished_at: string | null; result: { collected: number } } };
      }
    ).data.run;
    expect(done.status).toBe("success");
    expect(done.finished_at).not.toBeNull();
    expect(done.result.collected).toBe(7);
    // exactly one run was ever recorded for B, none for the rejected A attempt
    expect(runsOf(projectB)).toHaveLength(1);
    expect(runsOf(projectA)).toHaveLength(0);
    // and the slot is free again
    setBetaCollectionTestHooks({
      run: async (opts) => fakeResult(opts.projectId, 1),
    });
    expect((await collect(projectB, analystCookie)).status).toBe(202);
    await betaCollectionIdle();
  }, 60000);

  test("a failure inside the run lands on the run (failed + error), not as an HTTP error", async () => {
    setKey();
    setBetaCollectionTestHooks({
      run: async () => {
        throw new BetaSeriesError("zero_collected", "0 observations collected. Most likely cause: KRX 401 — fixture.");
      },
    });
    const res = await collect(projectA, analystCookie);
    expect(res.status).toBe(202);
    await betaCollectionIdle();
    const run = (
      (await (await collect(projectA, analystCookie, "GET")).json()) as {
        data: { run: { status: string; error: string } };
      }
    ).data.run;
    expect(run.status).toBe("failed");
    expect(run.error).toContain("0 observations collected");
    // a failed run does not block a retry
    setBetaCollectionTestHooks({
      run: async (opts) => fakeResult(opts.projectId, 2),
    });
    expect((await collect(projectA, analystCookie)).status).toBe(202);
    await betaCollectionIdle();
    expect(runsOf(projectA).map((r) => r.status)).toEqual(["failed", "success"]);
  }, 60000);

  test("stale 'running' rows (server killed mid-run) are failed by the sweep so the project is not blocked", () => {
    const id = ulid();
    const old = new Date(Date.now() - STALE_RUN_MS - 60_000).toISOString();
    const project = ulid();
    db.run(
      `INSERT INTO job_run (id, job_key, started_at, status, "trigger", actor, attempt, detail_json) VALUES (?,?,?, 'running','manual','x',1,?)`,
      [id, BETA_COLLECT_JOB_KEY, old, JSON.stringify({ project_id: project })],
    );
    expect(sweepStaleBetaRuns(db, new Date())).toBe(1);
    const row = db.query("SELECT status, error FROM job_run WHERE id = ?").get(id) as { status: string; error: string };
    expect(row.status).toBe("failed");
    expect(row.error).toContain("timeout_or_crash");
  });
});

describe("success path — real core over the mocked KRX payload", () => {
  test("202 -> job_run running->success, audit by the calling user, series + listing + stock_series written", async () => {
    setKey();
    mockKrx();
    setBetaCollectionTestHooks({ pacing: PACING, from: "2026-10", to: "2026-10" });
    const res = await collect(projectA, analystCookie);
    expect(res.status).toBe(202);
    const data = ((await res.json()) as { data: { run_id: string; status: string; project_id: string } }).data;
    expect(data).toMatchObject({ status: "running", project_id: projectA });

    // job_run row exists immediately (running) with the calling user as actor, manual trigger
    const row0 = db
      .query('SELECT status, actor, "trigger" AS trig, env FROM job_run WHERE id = ?')
      .get(data.run_id) as {
      status: string;
      actor: string;
      trig: string;
      env: string | null;
    };
    expect(row0.actor).toBe("bc-analyst");
    expect(row0.trig).toBe("manual");
    expect(row0.env).toBeNull(); // scheduler-owned sweep/health queries never touch it

    await betaCollectionIdle();
    const run = db.query("SELECT * FROM job_run WHERE id = ?").get(data.run_id) as {
      status: string;
      finished_at: string | null;
      rows_written: number;
      error: string | null;
    };
    expect(run.status).toBe("success");
    expect(run.finished_at).not.toBeNull();
    expect(run.rows_written).toBeGreaterThan(0);

    // every accepted start of projectA (earlier tests started runs too) has exactly one audit row, by the caller
    const audit = db
      .query("SELECT actor_user_id FROM audit_log WHERE action = 'beta_series.collect_requested' AND target = ?")
      .all(projectA) as Array<{ actor_user_id: string }>;
    expect(audit.length).toBe(runsOf(projectA).length);
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((a) => a.actor_user_id === "bc-analyst")).toBe(true);

    const obs = (sid: string) =>
      (db.query("SELECT COUNT(*) AS n FROM fact_market_observation WHERE series_id = ?").get(sid) as { n: number }).n;
    expect(obs(`krx:stock:${companyA}:close`)).toBeGreaterThan(15);
    expect(obs("krx:index:KOSDAQ:close")).toBeGreaterThan(15);
    expect(obs("krx:index:KOSPI:close")).toBeGreaterThan(15);
    const series = db
      .query("SELECT ticker, market, registered_by FROM stock_series WHERE company_id = ?")
      .get(companyA);
    expect(series).toEqual({ ticker: "108490", market: "kosdaq", registered_by: "beta-series" });

    // the status poll carries the summary, and the existing GET beta-series now has aligned rows
    const status = (
      (await (await collect(projectA, viewerCookie, "GET")).json()) as {
        data: { run: { status: string; result: { collected: number; krx_calls: number } } };
      }
    ).data.run;
    expect(status.status).toBe("success");
    expect(status.result.collected).toBeGreaterThan(0);
    const beta = await nextRequest(`/api/projects/${projectA}/wacc/beta-series`, {
      headers: { cookie: analystCookie },
    });
    const betaData = ((await beta.json()) as { data: { aligned_count: number; listing_market: string } }).data;
    expect(betaData.aligned_count).toBeGreaterThan(15);
    expect(betaData.listing_market).toBe("KOSDAQ");
  }, 60000);
});

describe("shared core stays callable from the CLI wrapper", () => {
  test("runBetaCollection: result + injected log sink, no console output", async () => {
    setKey();
    mockKrx();
    const lines: string[] = [];
    const result = await runBetaCollection({
      projectId: projectA,
      from: "2026-10",
      to: "2026-10",
      pacing: PACING,
      log: (l) => lines.push(l),
      warn: (l) => lines.push(l),
    });
    expect(result.collected).toBeGreaterThan(0);
    expect(result.series.map((s) => s.seriesId)).toContain(`krx:stock:${companyA}:close`);
    expect(lines.some((l) => l.startsWith("\nbeta-series done"))).toBe(true);
  }, 60000);

  test("betaSeriesMain (the CLI entry) collects through the core with unchanged output", async () => {
    setKey();
    mockKrx();
    const logged: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => void logged.push(a.join(" "));
    try {
      await betaSeriesMain(
        ["bun", "beta-series.ts", "--project", projectA, "--from", "2026-10", "--to", "2026-10"],
        PACING,
      );
    } finally {
      console.log = origLog;
    }
    expect(logged.some((l) => l.includes("beta-series done:"))).toBe(true);
  }, 60000);

  test("betaSeriesMain: missing key -> 'beta-series: KRX_API_KEY is not set' on stderr and exit code 1", async () => {
    delete process.env.KRX_API_KEY;
    const errors: string[] = [];
    const origErr = console.error;
    const origExit = process.exit;
    console.error = (...a: unknown[]) => void errors.push(a.join(" "));
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as typeof process.exit;
    try {
      await expect(betaSeriesMain(["bun", "beta-series.ts", "--project", projectA], PACING)).rejects.toThrow("exit:1");
    } finally {
      console.error = origErr;
      process.exit = origExit;
    }
    expect(errors).toEqual(["beta-series: KRX_API_KEY is not set (.env) — nothing can be collected."]);
  }, 60000);

  test("betaSeriesMain: unknown project -> exit 1; no --project -> usage + exit 2", async () => {
    setKey();
    const errors: string[] = [];
    const origErr = console.error;
    const origExit = process.exit;
    console.error = (...a: unknown[]) => void errors.push(a.join(" "));
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as typeof process.exit;
    try {
      resetKrxRunState(PACING);
      await expect(betaSeriesMain(["bun", "beta-series.ts", "--project", "nope"], PACING)).rejects.toThrow("exit:1");
      await expect(betaSeriesMain(["bun", "beta-series.ts"], PACING)).rejects.toThrow("exit:2");
    } finally {
      console.error = origErr;
      process.exit = origExit;
    }
    expect(errors[0]).toBe("beta-series: project 'nope' not found.");
    expect(errors[1]).toContain("usage: beta-series --project");
  }, 60000);
});
