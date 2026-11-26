// @version 1.0.0
/**
 * POST/GET /api/projects/[id]/wacc/ecos/collect — in-app ECOS collection for the WACC reference values
 * (risk-free rate + credit spread), plus static assertions for the "WACC 참조값" missing-item rendering.
 *
 * Real route handlers + scratch SQLite. The ECOS adapter reaches the network only through scripts/lib/ssrf.ts
 * safeFetch (pinned http(s), not global fetch), so that one export is replaced by a recorded mock — NO live
 * network (any ECOS call without an installed mock throws).
 * Covers: authorization (viewer 403, non-member/admin 404, anonymous 401), 503 without ECOS_API_KEY (no run,
 * no audit), 202 + job_run lifecycle + audit with the calling user as actor, observations landing for the
 * two reference series so GET .../wacc/suggestions turns risk_free/credit_spread from null into values,
 * partial failures (unpublished months) staying a success, global 409 already_running, and a run where
 * nothing landed ending failed (HTTP stays 202).
 */
import { test, expect, beforeAll, afterAll, afterEach, describe, mock } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DB_PATH = "db/data/test-wacc-ecos-collect-route.sqlite";
// Module-level env/mocks are process-wide (coverage runs every tests/unit file in ONE process): remember the
// originals and restore them in afterAll so later files never see this file's DB path or ssrf mock.
const ENV_ORIGINALS: Record<string, string | undefined> = {
  CO_NEWBIZ_DB_PATH: process.env.CO_NEWBIZ_DB_PATH,
  ECOS_API_KEY: process.env.ECOS_API_KEY,
};
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
const { loadPipelineKeys } = await import("../../scripts/lib/env-keys.ts");
const { ECOS_COLLECT_JOB_KEY, betaCollectionIdle, setBetaCollectionTestHooks } = await import(
  "../../app/web-next/lib/beta-collection-runner.ts"
);

const NOW = new Date().toISOString();
const FAKE_KEY = ["fixture", "ecos", "key"].join("-"); // dummy fixture, not a credential

// ── ECOS mock: safeFetch is the adapter's only network seam (the rest of ssrf.ts stays real) ──
const actualSsrf = await import("../../scripts/lib/ssrf.ts");
let ecosHandler: ((url: string) => Response) | null = null;
mock.module("../../scripts/lib/ssrf.ts", () => ({
  ...actualSsrf,
  safeFetch: (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => {
    if (new URL(url).host === "ecos.bok.or.kr") {
      if (!ecosHandler) throw new Error("test: real ECOS network access is blocked — install mockEcos() first");
      return Promise.resolve(ecosHandler(url));
    }
    return actualSsrf.safeFetch(url, init);
  },
}));

// Make the pipeline-key load a no-op first, so deleting/setting ECOS_API_KEY below is authoritative.
loadPipelineKeys();
const savedKey = process.env.ECOS_API_KEY;
const setKey = () => {
  process.env.ECOS_API_KEY = FAKE_KEY;
};

const RF_ITEM = "5020000";
const currentYm = (() => {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
})();

/** ECOS mock: every month has a point except the current one (not yet published → error envelope). */
function mockEcos(opts: { allFail?: boolean } = {}): void {
  ecosHandler = (url) => {
    const parts = new URL(url).pathname.split("/");
    // /api/StatisticSearch/<key>/json/kr/1/10/<stat>/M/<ym>/<ym>/<item>
    const ym = parts[parts.length - 2];
    const item = parts[parts.length - 1];
    if (opts.allFail || ym === currentYm) {
      return new Response(JSON.stringify({ RESULT: { CODE: "INFO-200", MESSAGE: "no data" } }), { status: 200 });
    }
    const value = item === RF_ITEM ? "3.10" : "4.20";
    return new Response(
      JSON.stringify({ StatisticSearch: { row: [{ ITEM_CODE1: item, DATA_VALUE: value, TIME: ym }] } }),
      { status: 200 },
    );
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
function mkProject(no: string, companyId: string): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, company_id, status) VALUES (?,?,?,?, 'open')", [
    id,
    no,
    NOW,
    companyId,
  ]);
  for (const [userId, role] of [
    ["ec-analyst", "lead"],
    ["ec-viewer", "member"],
  ]) {
    db.run(
      "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
      [id, userId, role, "test", NOW, "ecos collect test"],
    );
  }
  return id;
}
const collect = (projectId: string, cookie: string | null, method: "POST" | "GET" = "POST") =>
  nextRequest(`/api/projects/${projectId}/wacc/ecos/collect`, { method, headers: cookie ? { cookie } : {} });
const runs = () =>
  db.query("SELECT * FROM job_run WHERE job_key = ? ORDER BY started_at, id").all(ECOS_COLLECT_JOB_KEY) as Array<
    Record<string, unknown>
  >;
const auditCount = (target?: string) =>
  (
    db
      .query(
        `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'wacc_ecos.collect_requested'${target ? " AND target = ?" : ""}`,
      )
      .get(...(target ? [target] : [])) as { n: number }
  ).n;
const suggestions = async (projectId: string) =>
  (
    (await (
      await nextRequest(`/api/projects/${projectId}/wacc/suggestions`, { headers: { cookie: analystCookie } })
    ).json()) as {
      data: { suggestions: Array<{ key: string; value: number | null; reason?: string }> };
    }
  ).data.suggestions;

beforeAll(async () => {
  analystCookie = await mkUser("ec-analyst", "analyst");
  viewerCookie = await mkUser("ec-viewer", "viewer");
  outsiderCookie = await mkUser("ec-outsider", "analyst");
  adminCookie = await mkUser("ec-admin", "admin");
  const company = ulid();
  db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [company, "에코스테스트", NOW]);
  projectA = mkProject("PRJ-EC-A", company);
  projectB = mkProject("PRJ-EC-B", company);
});

afterEach(() => {
  ecosHandler = null;
  setBetaCollectionTestHooks({});
  if (savedKey === undefined) delete process.env.ECOS_API_KEY;
  else process.env.ECOS_API_KEY = savedKey;
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  mock.module("../../scripts/lib/ssrf.ts", () => actualSsrf); // drop the safeFetch stub
  for (const [key, value] of Object.entries(ENV_ORIGINALS)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("authorization and preflight", () => {
  test("viewer 403 role_required; outsider and admin 404; anonymous 401 — nothing recorded", async () => {
    setKey();
    const viewer = await collect(projectA, viewerCookie);
    expect(viewer.status).toBe(403);
    expect(((await viewer.json()) as { error: { code: string } }).error.code).toBe("role_required");
    expect((await collect(projectA, outsiderCookie)).status).toBe(404);
    expect((await collect(projectA, adminCookie)).status).toBe(404);
    expect((await collect(projectA, null)).status).toBe(401);
    expect(runs()).toHaveLength(0);
    expect(auditCount()).toBe(0);
  }, 60000);

  test("GET status: a member (even viewer) sees {run:null}; outsider 404", async () => {
    const res = await collect(projectA, viewerCookie, "GET");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { run: unknown } }).data.run).toBeNull();
    expect((await collect(projectA, outsiderCookie, "GET")).status).toBe(404);
  }, 60000);

  test("missing ECOS_API_KEY -> 503 ecos_api_key_missing (clear error, no run, no audit)", async () => {
    delete process.env.ECOS_API_KEY;
    const res = await collect(projectA, analystCookie);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { data: unknown; error: { code: string; message: string } };
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("ecos_api_key_missing");
    expect(body.error.message).toContain("ECOS_API_KEY");
    expect(runs()).toHaveLength(0);
    expect(auditCount()).toBe(0);
  }, 60000);
});

describe("failure and concurrency", () => {
  test("a run where nothing landed ends failed (HTTP stays 202); a failed run does not block a retry", async () => {
    setKey();
    mockEcos({ allFail: true });
    const res = await collect(projectA, analystCookie);
    expect(res.status).toBe(202);
    await betaCollectionIdle();
    const run = (
      (await (await collect(projectA, analystCookie, "GET")).json()) as {
        data: { run: { status: string; error: string } };
      }
    ).data.run;
    expect(run.status).toBe("failed");
    expect(run.error).toContain("0 observations");
    expect(run.error).toContain("INFO-200");
    // the references stay missing, with their reason
    const sugg = await suggestions(projectA);
    expect(sugg.find((s) => s.key === "risk_free")?.value).toBeNull();
    expect(sugg.find((s) => s.key === "risk_free")?.reason).toContain("ECOS");
  }, 60000);

  test("a running collection blocks everyone (global 409 already_running) until it settles", async () => {
    setKey();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setBetaCollectionTestHooks({
      ecosRun: async () => {
        await gate;
        return { rowsUpserted: 4, rowsChanged: 0, series: [], failures: [] };
      },
    });
    const first = await collect(projectA, analystCookie);
    expect(first.status).toBe(202);
    const started = ((await first.json()) as { data: { run_id: string; status: string } }).data;
    expect(started.status).toBe("running");

    for (const project of [projectA, projectB]) {
      const dup = await collect(project, analystCookie);
      expect(dup.status).toBe(409);
      const body = (await dup.json()) as { error: { code: string; details?: { run_id?: string } } };
      expect(body.error.code).toBe("already_running");
      expect(body.error.details?.run_id).toBe(started.run_id);
    }
    const mid = ((await (await collect(projectB, viewerCookie, "GET")).json()) as { data: { run: { status: string } } })
      .data.run;
    expect(mid.status).toBe("running");

    release();
    await betaCollectionIdle();
    const done = (
      (await (await collect(projectB, viewerCookie, "GET")).json()) as {
        data: { run: { status: string; result: { rows_upserted: number } } };
      }
    ).data.run;
    expect(done.status).toBe("success");
    expect(done.result.rows_upserted).toBe(4);
  }, 60000);
});

describe("success path — real fetchSource over the mocked ECOS payload", () => {
  test("202 -> job_run success, audit by the caller, observations land, suggestions turn from null to values", async () => {
    setKey();
    mockEcos();
    const before = await suggestions(projectA);
    expect(before.find((s) => s.key === "risk_free")?.value).toBeNull();
    expect(before.find((s) => s.key === "credit_spread")?.value).toBeNull();
    const runsBefore = runs().length;
    const auditBefore = auditCount(projectA);

    const res = await collect(projectA, analystCookie);
    expect(res.status).toBe(202);
    const data = ((await res.json()) as { data: { run_id: string; status: string; project_id: string } }).data;
    expect(data).toMatchObject({ status: "running", project_id: projectA });
    const row0 = db.query('SELECT status, actor, "trigger" AS trig FROM job_run WHERE id = ?').get(data.run_id) as {
      status: string;
      actor: string;
      trig: string;
    };
    expect(row0.actor).toBe("ec-analyst");
    expect(row0.trig).toBe("manual");

    await betaCollectionIdle();
    expect(runs().length).toBe(runsBefore + 1);
    const run = db
      .query("SELECT status, rows_written, finished_at, detail_json FROM job_run WHERE id = ?")
      .get(data.run_id) as {
      status: string;
      rows_written: number;
      finished_at: string | null;
      detail_json: string;
    };
    expect(run.status).toBe("success");
    expect(run.finished_at).not.toBeNull();
    expect(run.rows_written).toBeGreaterThan(0);
    // unpublished (current) month failed in isolation → kept as a warning, not a failed run
    const detail = JSON.parse(run.detail_json) as {
      warnings: Array<{ message: string }>;
      series: Array<{ seriesId: string }>;
    };
    expect(detail.warnings.length).toBeGreaterThan(0);
    expect(detail.series.map((s) => s.seriesId).sort()).toEqual(["ecos:721Y001:5020000", "ecos:721Y001:7020000"]);
    expect(auditCount(projectA)).toBe(auditBefore + 1);

    const obs = (sid: string) =>
      (db.query("SELECT COUNT(*) AS n FROM fact_market_observation WHERE series_id = ?").get(sid) as { n: number }).n;
    expect(obs("ecos:721Y001:5020000")).toBeGreaterThan(5);
    expect(obs("ecos:721Y001:7020000")).toBeGreaterThan(5);

    const after = await suggestions(projectA);
    const rf = after.find((s) => s.key === "risk_free");
    const cs = after.find((s) => s.key === "credit_spread");
    expect(rf?.value).toBeCloseTo(3.1, 5);
    expect(cs?.value).toBeCloseTo(1.1, 5); // 4.20 - 3.10 in the same month
  }, 60000);
});

describe("WACC 참조값 section — missing items are rendered, not silently filtered (static)", () => {
  const WEB = join(import.meta.dirname, "../../app/web-next");
  const panel = readFileSync(join(WEB, "components/wacc/WaccPanel.tsx"), "utf8");
  const ko = JSON.parse(readFileSync(join(WEB, "locales/ko.json"), "utf8"));
  const en = JSON.parse(readFileSync(join(WEB, "locales/en.json"), "utf8"));
  const keysOf = (d: { stages: { s8: { wacc: { waccPanel: Record<string, string> } } } }) => d.stages.s8.wacc.waccPanel;

  test("null suggestions are listed with their reason (REF_LABEL + x.reason)", () => {
    expect(panel).toContain("const missingSuggestions = (sugg?.suggestions ?? []).filter((x) => x.value === null)");
    expect(panel).toContain('data-testid="wacc-reference-missing"');
    expect(panel).toContain("missingSuggestions.map((x) =>");
    expect(panel).toContain("REF_LABEL[x.key]");
    expect(panel).toContain("x.reason");
  });

  test("ECOS collection button: only when risk_free/credit_spread are missing, inside the analyst-only block, reloads suggestions", () => {
    expect(panel).toContain('x.key === "risk_free" || x.key === "credit_spread"');
    expect(panel).toContain("{missingEcos && (");
    expect(panel).toContain("/wacc/ecos/collect");
    expect(panel).toMatch(/useCollectRun\([\s\S]{0,120}wacc\/ecos\/collect[\s\S]{0,120}loadSugg\(\)/);
    // the reference block sits inside the canWriteProject gate (read-only users get no collect button)
    const gate = panel.indexOf("{canAct && (\n        <>");
    expect(gate).toBeGreaterThan(-1);
    expect(panel.indexOf('data-testid="wacc-reference-missing"')).toBeGreaterThan(gate);
  });

  test("apply-all shows the applicable count and is disabled at zero; the old label is gone", () => {
    expect(panel).toContain('t("applyApplicableCount", { n: applicableCount, total: sugg.suggestions.length })');
    expect(panel).toContain("disabled={applicableCount === 0}");
    expect(panel).not.toContain("applyToTheWholeCapm");
    for (const d of [ko, en]) {
      expect(keysOf(d).applyApplicableCount).toContain("{n}");
      expect(keysOf(d).applyApplicableCount).toContain("{total}");
      expect(keysOf(d).applyToTheWholeCapm).toBeUndefined();
      for (const k of [
        "referenceMissingTitle",
        "collectEcosRun",
        "collectEcosRunning",
        "collectEcosDone",
        "collectEcosFailed",
        "collectEcosStartFailed",
      ]) {
        expect(typeof keysOf(d)[k]).toBe("string");
      }
    }
    expect(ko.errors.codes.ecos_api_key_missing).toContain("ECOS_API_KEY");
    expect(en.errors.codes.ecos_api_key_missing).toContain("ECOS_API_KEY");
  });

  test("the beta panel shows 수집 실행 only to writers", () => {
    const beta = readFileSync(join(WEB, "components/wacc/BetaPanel.tsx"), "utf8");
    expect(beta).toContain("canWriteProject(me?.role)");
    expect(beta).toContain("{canCollect && (");
    expect(beta).toContain("betaCollectUrl(projectId)");
  });
});
