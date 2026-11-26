// @version 1.0.0
/**
 * ADR-0208 slice 2 - the disclosed rating through the API: POST/GET .../wacc/credit-rating/collect (202 + poll,
 * 409 already_running, 503 without a DART key, viewer 403, outsider 404, audit), GET .../wacc/suggestions reading the
 * cache only (disclosed / stale / legacy-spread / both sources / recorded misses), and the server-derived
 * confirmation audit with credit_rating_snapshot_id on POST .../wacc. Real route handlers + scratch SQLite; DART is
 * injected through the runner's test hooks - no live call.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-wacc-credit-rating-disclosed.sqlite";
const ENV_ORIGINALS: Record<string, string | undefined> = { CO_NEWBIZ_DB_PATH: process.env.CO_NEWBIZ_DB_PATH };
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { grantProjectMembership } = await import("../../db/lib/access-control.ts");
const { createProject } = await import("../../db/repositories/project.repository.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { RF_SERIES_ID, CORP_BOND_SERIES_ID, CORP_BOND_BBBM_SERIES_ID } = await import("../../db/lib/wacc-reference.ts");
const { insertDisclosures } = await import("../../db/repositories/dart-evidence-cache.repository.ts");
const repo = await import("../../db/repositories/dart-credit-rating.repository.ts");
const { CREDIT_RATING_PARSER_VERSION: V, addMonthsIso } = await import("../../db/lib/credit-rating-disclosure.ts");
const { seoulToday } = await import("../../db/lib/iso-date.ts");
const { CREDIT_RATING_COLLECT_JOB_KEY, creditRatingCollectionIdle, setCreditRatingCollectionTestHooks } = await import(
  "../../app/web-next/lib/credit-rating-collection-runner.ts"
);

const NOW = new Date().toISOString();
const TODAY = seoulToday(new Date());
/** A date `months` before today, as YYYY-MM-DD / YYYY.MM.DD. */
const ago = (months: number) => addMonthsIso(TODAY, -months);
const dotted = (iso: string) => iso.replaceAll("-", ".");

const PW = (u: string) => `pw-${u}-12345`;
let analystCookie = "";
let viewerCookie = "";
let outsiderCookie = "";
let adminCookie = "";
let unitId = "";
let sourceId = "";
let companyD = ""; // has a DART corp code
let companyOther = ""; // another DART corp code (snapshot-ownership test)
let companyNoCorp = "";
const CORP_D = "00555001";
const CORP_OTHER = "00555002";
let projectD = "";
let projectD2 = ""; // same company as projectD
let projectNoCorp = "";
let projectNoCompany = "";

const req = (path: string, init?: RequestInit) => nextRequest(path, init);
async function mkUser(userId: string, role: "analyst" | "viewer" | "admin"): Promise<string> {
  await createUser(db, { userId, role, password: PW(userId), createdBy: "test", now: NOW });
  approveUser(db, { userId, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = ?", [userId]);
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password: PW(userId) }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
function mkProject(no: string, companyId: string | null, members: string[] = ["dr-analyst", "dr-viewer"]): string {
  const p = createProject(no).id;
  if (companyId) db.run("UPDATE md_project SET company_id = ? WHERE id = ?", [companyId, p]);
  for (const userId of members) {
    grantProjectMembership(db, {
      projectId: p,
      userId,
      projectRole: userId === "dr-analyst" ? "lead" : "member",
      grantedBy: "dr-analyst",
      needToKnowBasis: "disclosed credit rating test",
      now: NOW,
    });
  }
  return p;
}

function monthPeriod(ym: string): string {
  const id = `M${ym}`;
  if (!db.query("SELECT 1 FROM md_period WHERE id = ?").get(id)) {
    db.run(
      "INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)",
      [id, "month", `${ym}-01`, `${ym}-28`, Number(ym.slice(0, 4)), NOW],
    );
  }
  return id;
}
function obs(seriesId: string, ym: string, value: number) {
  db.run(
    "INSERT INTO fact_market_observation (series_id, period_id, revision_no, value, unit_id, source_id, content_hash, fetched_at) VALUES (?,?,?,?,?,?,?,?)",
    [seriesId, monthPeriod(ym), 1, value, unitId, sourceId, `h-${seriesId}-${ym}`, NOW],
  );
}
const clearObs = () => db.run("DELETE FROM fact_market_observation");
function seedFull(ym = "2026-10") {
  obs(RF_SERIES_ID, ym, 3.861);
  obs(CORP_BOND_SERIES_ID, ym, 4.549);
  obs(CORP_BOND_BBBM_SERIES_ID, ym, 10.358);
}
const clearSnapshots = () => db.run("DELETE FROM dart_credit_rating_snapshot");
const clearRuns = () => db.run("DELETE FROM job_run WHERE job_key = ?", [CREDIT_RATING_COLLECT_JOB_KEY]);

const ratingRow = (agency: string, grade: string, rated_on: string, source = "section") => ({
  source,
  agency,
  agency_raw: agency,
  instrument: "corporate_bond",
  grade,
  grade_raw: grade,
  outlook: null,
  rated_on,
  rated_on_precision: "day",
  excluded_reason: null,
  raw: "",
});
function putSnapshot(
  corp: string,
  kind: "business_report" | "debt_securities_filing",
  rcept: string,
  status: "parsed" | "not_disclosed" | "parse_failed" | "section_absent",
  ratings: unknown[],
) {
  return repo.insertCreditRatingSnapshot(db, {
    corpCode: corp,
    sourceKind: kind,
    sourceRceptNo: rcept,
    parserVersion: V,
    status,
    ratings,
    issues: null,
    now: NOW,
  });
}

const suggestions = async (project: string, cookie = analystCookie) => {
  const res = await req(`/api/projects/${project}/wacc/suggestions`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()).data as {
    suggestions: Array<Record<string, any>>;
    apply_all_excluded: Array<Record<string, any>>;
    missing: string[];
  };
};
const credit = (d: { suggestions: Array<Record<string, any>> }) =>
  d.suggestions.find((s) => s.key === "credit_spread")!;
const collect = (project: string, cookie: string | null, method: "POST" | "GET" = "POST", query = "") =>
  req(`/api/projects/${project}/wacc/credit-rating/collect${query}`, { method, headers: cookie ? { cookie } : {} });
const runs = () =>
  db
    .query("SELECT * FROM job_run WHERE job_key = ? ORDER BY started_at, id")
    .all(CREDIT_RATING_COLLECT_JOB_KEY) as Array<Record<string, any>>;
const auditCount = () =>
  (
    db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'wacc_credit_rating.collect_requested'").get() as {
      n: number;
    }
  ).n;

/** Injected DART: counts calls so "the GET never calls DART" is provable. */
const dartCalls = { text: 0, list: 0, bdrs: 0 };
function reportText(): string {
  return `Ⅰ. 회사의 개요 사. 신용평가에 관한 사항 ${dotted(ago(2))} 회사채 A+ 한국신용평가(주) (AAA~D) 정기평정 ${dotted(ago(2))} 회사채 A NICE신용평가(주) (AAA~D) 정기평정 아. 종업원 현황 다수`;
}
function installDart(over: { gate?: Promise<void>; fail?: boolean } = {}) {
  setCreditRatingCollectionTestHooks({
    dartConfigured: true,
    deps: {
      fetchDisclosureText: (async (rcept: string) => {
        dartCalls.text++;
        if (over.gate) await over.gate;
        if (over.fail) return { available: false, rcept_no: rcept, error: "DART HTTP 500" };
        return { available: true, rcept_no: rcept, text: reportText() };
      }) as never,
      listBusinessReports: (async () => {
        dartCalls.list++;
        return { ok: !over.fail, rows: [], error: over.fail ? "list down" : undefined };
      }) as never,
      fetchDebtSecuritiesFilings: (async () => {
        dartCalls.bdrs++;
        return over.fail ? { ok: false, filings: [], error: "bdRs down" } : { ok: true, filings: [] };
      }) as never,
    },
  });
}
function cacheReportList(corp: string, rcept = "20260310000501") {
  insertDisclosures(
    db,
    [
      {
        rcept_no: rcept,
        corp_code: corp,
        corp_name: "Test Co",
        report_nm: "사업보고서 (2025.12)",
        rcept_dt: rcept.slice(0, 8),
      },
    ],
    NOW,
  );
}

beforeAll(async () => {
  unitId = ulid();
  sourceId = ulid();
  db.run("INSERT INTO md_unit (id, code, dimension, si_coefficient, created_at) VALUES (?,?,?,?,?)", [
    unitId,
    "PCT.DR",
    "dimensionless",
    1,
    NOW,
  ]);
  db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [
    sourceId,
    "TESTECOS-DR",
    "A",
    NOW,
  ]);
  analystCookie = await mkUser("dr-analyst", "analyst");
  viewerCookie = await mkUser("dr-viewer", "viewer");
  outsiderCookie = await mkUser("dr-outsider", "analyst");
  adminCookie = await mkUser("dr-admin", "admin");
  companyD = ulid();
  companyOther = ulid();
  companyNoCorp = ulid();
  db.run("INSERT INTO md_company (id, name_ko, dart_corp_code, created_at) VALUES (?, 'dr-company-d', ?, ?)", [
    companyD,
    CORP_D,
    NOW,
  ]);
  db.run("INSERT INTO md_company (id, name_ko, dart_corp_code, created_at) VALUES (?, 'dr-company-other', ?, ?)", [
    companyOther,
    CORP_OTHER,
    NOW,
  ]);
  db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?, 'dr-company-nocorp', ?)", [companyNoCorp, NOW]);
  projectD = mkProject("NP-DR-1", companyD);
  projectD2 = mkProject("NP-DR-2", companyD);
  projectNoCorp = mkProject("NP-DR-3", companyNoCorp);
  projectNoCompany = mkProject("NP-DR-4", null);
});

afterEach(() => {
  setCreditRatingCollectionTestHooks({});
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  for (const [k, v] of Object.entries(ENV_ORIGINALS)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("POST/GET .../wacc/credit-rating/collect - authorization and preflight", () => {
  test("viewer 403 role_required; outsider and admin 404; anonymous 401 - nothing recorded", async () => {
    installDart();
    const viewer = await collect(projectD, viewerCookie);
    expect(viewer.status).toBe(403);
    expect(((await viewer.json()) as any).error.code).toBe("role_required");
    expect((await collect(projectD, outsiderCookie)).status).toBe(404);
    expect((await collect(projectD, adminCookie)).status).toBe(404);
    expect((await collect(projectD, null)).status).toBe(401);
    expect(runs()).toHaveLength(0);
    expect(auditCount()).toBe(0);
  }, 60000);

  test("GET status: a member (even viewer) sees {run:null}; outsider 404", async () => {
    const res = await collect(projectD, viewerCookie, "GET");
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ project_id: projectD, run: null });
    expect((await collect(projectD, outsiderCookie, "GET")).status).toBe(404);
  });

  test("missing DART key -> 503 dart_api_key_missing (clear error, no run, no audit)", async () => {
    setCreditRatingCollectionTestHooks({ dartConfigured: false });
    const res = await collect(projectD, analystCookie);
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("dart_api_key_missing");
    expect(body.error.message).toContain("DART_API_KEY");
    expect(runs()).toHaveLength(0);
    expect(auditCount()).toBe(0);
  });

  test("no subject company and a company without a DART corp code are 400 with their own codes", async () => {
    installDart();
    const none = await collect(projectNoCompany, analystCookie);
    expect(none.status).toBe(400);
    expect(((await none.json()) as any).error.code).toBe("no_subject_company");
    const nocorp = await collect(projectNoCorp, analystCookie);
    expect(nocorp.status).toBe(400);
    expect(((await nocorp.json()) as any).error.code).toBe("no_dart_corp_code");
    expect(runs()).toHaveLength(0);
    expect(auditCount()).toBe(0);
  });

  test("an unknown target_id is 400 (a shortlisted target is required)", async () => {
    installDart();
    const res = await collect(projectD, analystCookie, "POST", "?target_id=nope");
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("invalid_request");
    expect(runs()).toHaveLength(0);
  });
});

describe("POST .../wacc/credit-rating/collect - run lifecycle", () => {
  test("202 + job_run + audit (actor = calling user); the poll ends success; the cache then serves the suggestions", async () => {
    clearSnapshots();
    clearRuns();
    clearObs();
    seedFull();
    cacheReportList(CORP_D);
    installDart();
    const auditBefore = auditCount();
    // before collecting: the suggestions GET reads the cache only - rating_not_collected + collect hint, no DART call
    const before = credit(await suggestions(projectD));
    expect(before).toMatchObject({
      rating: "BBB-",
      rating_source: "default",
      reason_code: "rating_not_collected",
      disclosed_status: "rating_not_collected",
      collect_hint: true,
    });
    expect(dartCalls).toEqual({ text: 0, list: 0, bdrs: 0 });

    const res = await collect(projectD, analystCookie);
    expect(res.status).toBe(202);
    const started = (await res.json()).data as {
      project_id: string;
      run_id: string;
      status: string;
      started_at: string;
    };
    expect(started).toMatchObject({ project_id: projectD, status: "running" });
    expect(auditCount()).toBe(auditBefore + 1);
    const audit = db
      .query(
        "SELECT actor_user_id, target FROM audit_log WHERE action = 'wacc_credit_rating.collect_requested' ORDER BY created_at DESC, id DESC",
      )
      .get() as { actor_user_id: string; target: string };
    expect(audit).toEqual({ actor_user_id: "dr-analyst", target: projectD });
    expect(runs()[0]).toMatchObject({ id: started.run_id, trigger: "manual", actor: "dr-analyst" });

    await creditRatingCollectionIdle();
    const poll = (await (await collect(projectD, viewerCookie, "GET")).json()).data.run as Record<string, any>;
    expect(poll).toMatchObject({ run_id: started.run_id, status: "success", error: null });
    expect(poll.result).toMatchObject({
      corp_code: CORP_D,
      report_rcept_no: "20260310000501",
      report_status: "parsed",
      report_fetched: true,
      bdrs_filings: 0,
    });
    expect(dartCalls.text).toBe(1);

    // after collecting: the suggestion is the disclosed rating (lowest of A+ / A = A)
    const after = credit(await suggestions(projectD));
    expect(after).toMatchObject({
      rating: "A",
      rating_source: "disclosed",
      rating_stale: false,
      rating_instrument: "corporate_bond",
      source_rcept_no: "20260310000501",
      rating_evidence_kind: "business_report",
      reason_code: "disclosed_rating",
      disclosed_status: null,
      collect_hint: false,
      spread_basis: "ecos_interpolated",
      derived: true,
      flags: ["interpolated"],
    });
    expect(after.value).toBeCloseTo(1.4545, 3);
    expect(after.rating_agencies.map((a: any) => [a.agency, a.grade])).toEqual([
      ["nice", "A"],
      ["kis", "A+"],
    ]);
    expect(typeof after.credit_rating_snapshot_id).toBe("string");
    expect(after.note).toContain("disclosed A");
    expect(after.agency_links).toHaveLength(3);
    // fresh disclosed rating: eligible for apply-all
    const d = await suggestions(projectD);
    expect(d.apply_all_excluded.some((x) => x.key === "credit_spread")).toBe(false);
    // the suggestions GET itself never called DART
    expect(dartCalls).toEqual({ text: 1, list: 0, bdrs: 1 });
  }, 60000);

  test("a running collection blocks the project AND the same company in another project (409 already_running)", async () => {
    clearSnapshots();
    clearRuns();
    cacheReportList(CORP_D);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    installDart({ gate });
    const auditBefore = auditCount();
    try {
      const first = await collect(projectD, analystCookie);
      expect(first.status).toBe(202);
      const runId = (await first.json()).data.run_id as string;
      for (const project of [projectD, projectD2]) {
        const dup = await collect(project, analystCookie);
        expect(dup.status).toBe(409);
        const body = (await dup.json()) as any;
        expect(body.error.code).toBe("already_running");
        expect(body.error.details.run_id).toBe(runId);
      }
      expect(runs()).toHaveLength(1);
      expect(auditCount()).toBe(auditBefore + 1); // only the accepted request is audited
      const mid = (await (await collect(projectD, viewerCookie, "GET")).json()).data.run;
      expect(mid.status).toBe("running");
    } finally {
      release();
    }
    await creditRatingCollectionIdle();
    expect((await (await collect(projectD, viewerCookie, "GET")).json()).data.run.status).toBe("success");
  }, 60000);

  test("a run where DART could not be read ends failed (HTTP stays 202) and does not block a retry", async () => {
    clearSnapshots();
    clearRuns();
    db.run("DELETE FROM dart_disclosure");
    installDart({ fail: true });
    const res = await collect(projectD, analystCookie);
    expect(res.status).toBe(202);
    await creditRatingCollectionIdle();
    const run = (await (await collect(projectD, analystCookie, "GET")).json()).data.run;
    expect(run.status).toBe("failed");
    expect(run.error).toContain("DART could not be read");
    expect(db.query("SELECT COUNT(*) AS n FROM dart_credit_rating_snapshot").get()).toEqual({ n: 0 });
    // retry is allowed
    cacheReportList(CORP_D);
    installDart();
    const again = await collect(projectD, analystCookie);
    expect(again.status).toBe(202);
    await creditRatingCollectionIdle();
  }, 60000);
});

describe("GET .../wacc/suggestions - credit_spread with the disclosed rating (cache only)", () => {
  test("fresh disclosed rating: mapped from the rating, eligible for apply-all, Kd indicative follows", async () => {
    clearObs();
    seedFull();
    clearSnapshots();
    const s = putSnapshot(CORP_D, "business_report", "20260310000601", "parsed", [
      ratingRow("kis", "BBB+", ago(3)),
      ratingRow("nice", "BBB", ago(3)),
    ]);
    const d = await suggestions(projectD);
    const c = credit(d);
    expect(c).toMatchObject({
      rating: "BBB",
      rating_source: "disclosed",
      rating_stale: false,
      source_rcept_no: "20260310000601",
      credit_rating_snapshot_id: s.id,
      rating_rated_on: ago(3),
      spread_basis: "ecos_interpolated",
    });
    expect(c.value).toBeCloseTo(4.468, 2); // BBB, notch 9 of the 4..10 geometric ladder (design table)
    expect(c.kd_indicative_pct).toBeCloseTo(8.329, 2);
    expect(d.apply_all_excluded).toEqual([]);
    expect(d.missing.some((m) => m.startsWith("credit_spread"))).toBe(false);
  });

  test("a stale disclosed rating stays visible and applicable but is excluded from apply-all with credit_rating_stale", async () => {
    clearObs();
    seedFull();
    clearSnapshots();
    putSnapshot(CORP_D, "business_report", "20250310000602", "parsed", [ratingRow("kis", "A-", ago(20))]);
    const d = await suggestions(projectD);
    const c = credit(d);
    expect(c).toMatchObject({ rating: "A-", rating_source: "disclosed", rating_stale: true });
    expect(c.value).not.toBeNull();
    expect(d.apply_all_excluded).toHaveLength(1);
    expect(d.apply_all_excluded[0]).toMatchObject({ key: "credit_spread", reason_code: "credit_rating_stale" });
    expect(d.missing.some((m) => m.startsWith("credit_spread: credit_rating_stale"))).toBe(true);
  });

  test("the stale boundary: 17 and 18 months fresh, 19 months stale", async () => {
    clearObs();
    seedFull();
    for (const [months, stale] of [
      [17, false],
      [18, false],
      [19, true],
    ] as const) {
      clearSnapshots();
      putSnapshot(CORP_D, "business_report", "20260310000603", "parsed", [ratingRow("kis", "A", ago(months))]);
      expect(credit(await suggestions(projectD)).rating_stale).toBe(stale);
    }
  });

  test("BBB- not collected: the disclosed rating is shown but the AA- legacy spread is excluded from apply-all", async () => {
    clearObs();
    obs(RF_SERIES_ID, "2026-10", 3.861);
    obs(CORP_BOND_SERIES_ID, "2026-10", 4.549);
    clearSnapshots();
    putSnapshot(CORP_D, "business_report", "20260310000604", "parsed", [ratingRow("kis", "BBB+", ago(3))]);
    const d = await suggestions(projectD);
    expect(credit(d)).toMatchObject({ rating: "BBB+", rating_source: "disclosed", spread_basis: "aa_minus_legacy" });
    expect(d.apply_all_excluded.map((x) => x.reason_code)).toEqual(["credit_spread_legacy_basis"]);
  });

  test("report and debt-securities filing differ: the lower is used and the other is returned", async () => {
    clearObs();
    seedFull();
    clearSnapshots();
    putSnapshot(CORP_D, "business_report", "20260310000605", "parsed", [ratingRow("kis", "A", ago(6))]);
    putSnapshot(CORP_D, "debt_securities_filing", "20260801000606", "parsed", [
      ratingRow("kis", "BBB+", ago(2), "bdrs"),
    ]);
    const c = credit(await suggestions(projectD));
    expect(c).toMatchObject({
      rating: "BBB+",
      rating_evidence_kind: "debt_securities_filing",
      source_rcept_no: "20260801000606",
      rating_alternative: {
        rating: "A",
        evidence_kind: "business_report",
        source_rcept_no: "20260310000605",
        stale: false,
      },
    });
  });

  test("recorded misses are reported, never read as 'unrated': not_disclosed and parse_failed fall to the default with a status", async () => {
    clearObs();
    seedFull();
    for (const status of ["not_disclosed", "parse_failed", "section_absent"] as const) {
      clearSnapshots();
      putSnapshot(CORP_D, "business_report", "20260310000607", status, []);
      const d = await suggestions(projectD);
      const c = credit(d);
      expect(c).toMatchObject({
        rating: "BBB-",
        rating_source: "default",
        disclosed_status: status,
        reason_code: "no_disclosed_rating_and_synthetic_unavailable",
        collect_hint: true,
      });
      expect(d.apply_all_excluded[0]).toMatchObject({ reason_code: "credit_rating_default_basis" });
    }
  });

  test("a company without a DART corp code: default, no collect hint (nothing could be collected)", async () => {
    clearObs();
    seedFull();
    const c = credit(await suggestions(projectNoCorp));
    expect(c).toMatchObject({ rating_source: "default", disclosed_status: "no_dart_corp_code", collect_hint: false });
  });

  test("a snapshot of another company never leaks into this company's suggestion", async () => {
    clearObs();
    seedFull();
    clearSnapshots();
    putSnapshot(CORP_OTHER, "business_report", "20260310000608", "parsed", [ratingRow("kis", "AA", ago(2))]);
    const c = credit(await suggestions(projectD));
    expect(c).toMatchObject({ rating_source: "default", disclosed_status: "rating_not_collected" });
  });
});

// ── POST .../wacc confirmation audit with credit_rating_snapshot_id ──
const CAPM = (spread: Record<string, unknown>) => [
  { key: "wacc.risk_free", value: 0.03, kind: "live", source_label: "ECOS", anchor_ref: "src:ecos" },
  { key: "wacc.erp", value: 0.05, kind: "user" },
  { key: "wacc.beta_unlevered", value: 1.0, kind: "derived" },
  { key: "wacc.target_de", value: 0.5, kind: "user" },
  { key: "wacc.tax_rate", value: 0.24, kind: "user" },
  spread,
];
async function confirm(spread: Record<string, unknown>, project = projectD) {
  return req(`/api/projects/${project}/wacc`, {
    method: "POST",
    headers: { cookie: analystCookie, "content-type": "application/json" },
    body: JSON.stringify({ wacc: 0.09, mode: "capm", components: CAPM(spread) }),
  });
}
const spreadAudit = (runId: string) =>
  (
    db
      .query("SELECT target FROM audit_log WHERE action = 'assumption_set' AND target LIKE ?")
      .all(`${runId}:wacc.debt_spread:%`) as Array<{ target: string }>
  ).map((a) => a.target);
const rationaleOf = (runId: string) =>
  (
    db
      .query("SELECT kind, rationale FROM assumption WHERE run_id = ? AND assumption_key = 'wacc.debt_spread'")
      .get(runId) as { kind: string; rationale: string }
  ).rationale;
const runCount = (project = projectD) =>
  (db.query("SELECT COUNT(*) AS n FROM run WHERE project_id = ?").get(project) as { n: number }).n;

describe("POST /api/projects/[id]/wacc - disclosed credit-rating audit (server-derived)", () => {
  let snapshotId = "";
  const applied = (over: Record<string, unknown> = {}) => ({
    key: "wacc.debt_spread",
    value: 0.014545,
    kind: "user",
    source_label: "DART disclosed rating A",
    anchor_ref: "src:ecos",
    as_of: "2026-10",
    credit_rating_basis: "disclosed",
    credit_rating_snapshot_id: snapshotId,
    reference_as_of: "2026-10",
    ...over,
  });
  const arrange = () => {
    clearObs();
    seedFull();
    clearSnapshots();
    snapshotId = putSnapshot(CORP_D, "business_report", "20260310000701", "parsed", [
      ratingRow("kis", "A+", ago(3)),
      ratingRow("nice", "A", ago(3)),
    ]).id;
  };

  test("applied disclosed reference: stays kind=user; rating, agencies, rcept_no and basis are recorded from the server re-derivation", async () => {
    arrange();
    const res = await confirm(applied());
    expect(res.status).toBe(201);
    const runId = (await res.json()).data.run_id as string;
    const rationale = rationaleOf(runId);
    expect(
      db.query("SELECT kind FROM assumption WHERE run_id = ? AND assumption_key = 'wacc.debt_spread'").get(runId),
    ).toEqual({
      kind: "user",
    });
    expect(rationale).toContain("credit_rating=A;");
    expect(rationale).toContain("credit_rating_source=disclosed");
    expect(rationale).toContain(`credit_rating_snapshot_id=${snapshotId}`);
    expect(rationale).toContain("credit_rating_rcept_no=20260310000701");
    expect(rationale).toContain("credit_rating_agencies=nice:A,kis:A+");
    expect(rationale).toContain(`credit_rating_rated_on=${ago(3)}`);
    expect(rationale).toContain("spread_basis=ecos_interpolated");
    expect(rationale).not.toContain("edited_from_reference");
    expect(spreadAudit(runId)).toEqual([
      `${runId}:wacc.debt_spread:user:credit_rating=A:credit_rating_source=disclosed:spread_basis=ecos_interpolated:edited_from_reference=false`,
    ]);
  });

  test("the edited flag is derived by the server (a client false is ignored when the value differs)", async () => {
    arrange();
    const res = await confirm(applied({ value: 0.02, edited_from_reference: false }));
    expect(res.status).toBe(201);
    const runId = (await res.json()).data.run_id as string;
    expect(rationaleOf(runId)).toContain("edited_from_reference: true");
    expect(spreadAudit(runId)[0]).toEndWith("edited_from_reference=true");
  });

  test("unknown snapshot id is 400 and creates no run", async () => {
    arrange();
    const before = runCount();
    const res = await confirm(applied({ credit_rating_snapshot_id: "01JZZZZZZZZZZZZZZZZZZZZZZZ" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toContain("not a stored credit rating snapshot");
    expect(runCount()).toBe(before);
  });

  test("a snapshot of another company is 400; so is a malformed id", async () => {
    arrange();
    const other = putSnapshot(CORP_OTHER, "business_report", "20260310000702", "parsed", [
      ratingRow("kis", "AA", ago(3)),
    ]);
    const before = runCount();
    const res = await confirm(applied({ credit_rating_snapshot_id: other.id }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.message).toContain("does not belong to the subject company");
    expect((await confirm(applied({ credit_rating_snapshot_id: "short" }))).status).toBe(400);
    expect((await confirm(applied({ credit_rating_snapshot_id: 7 }))).status).toBe(400);
    expect(runCount()).toBe(before);
  });

  test("disclosed needs the snapshot id; the id needs the disclosed basis and a basis at all", async () => {
    arrange();
    const before = runCount();
    expect((await confirm(applied({ credit_rating_snapshot_id: undefined }))).status).toBe(400);
    expect((await confirm(applied({ credit_rating_basis: "default" }))).status).toBe(400);
    expect((await confirm(applied({ credit_rating_basis: undefined, reference_as_of: undefined }))).status).toBe(400);
    expect(runCount()).toBe(before);
  });

  test("the client cannot claim 'default' while a disclosed rating exists, nor 'disclosed' without one", async () => {
    arrange();
    const before = runCount();
    const claimDefault = await confirm(
      applied({ credit_rating_basis: "default", credit_rating_snapshot_id: undefined }),
    );
    expect(claimDefault.status).toBe(400);
    expect(((await claimDefault.json()) as any).error.message).toContain(
      "does not match the server-derived basis 'disclosed'",
    );
    // the corp has a snapshot, but it carries no usable rating
    clearSnapshots();
    const failed = putSnapshot(CORP_D, "business_report", "20260310000703", "parse_failed", []);
    const claimDisclosed = await confirm(applied({ credit_rating_snapshot_id: failed.id }));
    expect(claimDisclosed.status).toBe(400);
    expect(((await claimDisclosed.json()) as any).error.message).toContain(
      "does not match the server-derived basis 'default'",
    );
    expect(runCount()).toBe(before);
  });

  test("a manual spread and a default-basis spread on a company with no evidence audit as in slice 1", async () => {
    clearObs();
    seedFull();
    clearSnapshots();
    const manual = await confirm({
      key: "wacc.debt_spread",
      value: 0.02,
      kind: "user",
      rationale: "analyst judgement",
    });
    expect(manual.status).toBe(201);
    const m = (await manual.json()).data.run_id as string;
    expect(spreadAudit(m)).toEqual([`${m}:wacc.debt_spread:user`]);
    const dflt = await confirm({
      key: "wacc.debt_spread",
      value: 0.06497,
      kind: "user",
      credit_rating_basis: "default",
      reference_as_of: "2026-10",
    });
    expect(dflt.status).toBe(201);
    const d = (await dflt.json()).data.run_id as string;
    expect(spreadAudit(d)).toEqual([
      `${d}:wacc.debt_spread:user:credit_rating=BBB-:credit_rating_source=default:spread_basis=ecos_interpolated:edited_from_reference=false`,
    ]);
    expect(rationaleOf(d)).not.toContain("credit_rating_snapshot_id");
  });

  test("synthetic stays unresolvable until slice 3 (400, no run)", async () => {
    arrange();
    const before = runCount();
    const res = await confirm(applied({ credit_rating_basis: "synthetic", credit_rating_snapshot_id: undefined }));
    expect(res.status).toBe(400);
    expect(runCount()).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// ADR-0208 amendment (2026-11-26): the credit-bureau issuer rating is a lower-confidence rung between the
// corporate-bond rating and the default. Excluded from apply-all, individually applicable, server re-derived.
// ---------------------------------------------------------------------------------------------------------------
const bureauRow = (agency: string | null, grade: string, rated_on: string, cashflow = "C+") => ({
  source: "section",
  agency,
  agency_raw: agency,
  instrument: "issuer_bureau",
  grade,
  grade_raw: grade,
  outlook: null,
  rated_on,
  rated_on_precision: "day",
  excluded_reason: null,
  raw: "",
  cashflow_grade_raw: cashflow,
  agency_carried: false,
});

describe("GET .../wacc/suggestions - the credit-bureau rung", () => {
  test("no bond rating: the latest bureau rating (lowest on that date) is used, shown with its evidence, excluded from apply-all", async () => {
    clearObs();
    seedFull();
    clearSnapshots();
    const s = putSnapshot(CORP_D, "business_report", "20260310000801", "parsed", [
      bureauRow("nice-dnb", "BBB", ago(14), "C+"),
      bureauRow("ecredible", "BB+", ago(2), "B"),
      bureauRow(null, "BBB", ago(2), "C+"),
    ]);
    const d = await suggestions(projectD);
    const c = credit(d);
    expect(c).toMatchObject({
      rating: "BB+",
      rating_source: "bureau",
      rating_stale: false,
      rating_instrument: "issuer_bureau",
      rating_evidence_kind: "business_report",
      credit_rating_snapshot_id: s.id,
      reason_code: "bureau_issuer_rating",
      source_rcept_no: "20260310000801",
    });
    expect(c.rating_bureau).toMatchObject({ agency: "ecredible", cashflow_grade: "B", agency_carried: false });
    expect(c.rating_bureau.rows).toHaveLength(2);
    expect(c.value).not.toBeNull();
    expect(d.apply_all_excluded.map((x) => x.reason_code)).toEqual(["credit_rating_bureau_basis"]);
    expect(d.missing.some((m) => m.startsWith("credit_spread: credit_rating_bureau_basis"))).toBe(true);
  });

  test("a fresh corporate-bond rating beats a fresh bureau rating (and stays in apply-all)", async () => {
    clearObs();
    seedFull();
    clearSnapshots();
    putSnapshot(CORP_D, "business_report", "20260310000802", "parsed", [
      ratingRow("kis", "A", ago(3)),
      bureauRow("nice-dnb", "BB", ago(1)),
    ]);
    const d = await suggestions(projectD);
    expect(credit(d)).toMatchObject({ rating: "A", rating_source: "disclosed", rating_bureau: null });
    expect(d.apply_all_excluded).toEqual([]);
  });

  test("a stale bond rating gives way to a fresh bureau rating; with both stale the bond rating stays", async () => {
    clearObs();
    seedFull();
    clearSnapshots();
    putSnapshot(CORP_D, "business_report", "20260310000803", "parsed", [
      ratingRow("kis", "A", ago(24)),
      bureauRow("ked", "BBB-", ago(2)),
    ]);
    expect(credit(await suggestions(projectD))).toMatchObject({ rating: "BBB-", rating_source: "bureau" });
    clearSnapshots();
    putSnapshot(CORP_D, "business_report", "20260310000804", "parsed", [
      ratingRow("kis", "A", ago(24)),
      bureauRow("ked", "BBB-", ago(20)),
    ]);
    expect(credit(await suggestions(projectD))).toMatchObject({
      rating: "A",
      rating_source: "disclosed",
      rating_stale: true,
    });
  });

  test("a stale bureau rating with no bond rating is still offered, flagged stale and excluded from apply-all", async () => {
    clearObs();
    seedFull();
    clearSnapshots();
    putSnapshot(CORP_D, "business_report", "20260310000805", "parsed", [bureauRow("ked", "BB+", ago(24))]);
    const d = await suggestions(projectD);
    expect(credit(d)).toMatchObject({ rating: "BB+", rating_source: "bureau", rating_stale: true });
    expect(d.apply_all_excluded).toHaveLength(1);
    expect(d.apply_all_excluded[0].reason_code).toBe("credit_rating_bureau_basis");
  });
});

describe("POST /api/projects/[id]/wacc - bureau credit-rating audit (server-derived)", () => {
  let snapshotId = "";
  const applied = (over: Record<string, unknown> = {}) => ({
    key: "wacc.debt_spread",
    value: 0.05,
    kind: "user",
    source_label: "DART bureau rating BB+",
    anchor_ref: "src:ecos",
    as_of: "2026-10",
    credit_rating_basis: "bureau",
    credit_rating_snapshot_id: snapshotId,
    reference_as_of: "2026-10",
    ...over,
  });
  const arrange = () => {
    clearObs();
    seedFull();
    clearSnapshots();
    snapshotId = putSnapshot(CORP_D, "business_report", "20260310000901", "parsed", [
      bureauRow("ecredible", "BB+", ago(2), "B"),
      bureauRow("nice-dnb", "BBB", ago(2), "C+"),
    ]).id;
  };

  test("accepted: stays kind=user; rating, bureau rows, cash-flow grade, lower-confidence marker and snapshot are recorded from the re-derivation", async () => {
    arrange();
    const res = await confirm(applied());
    expect(res.status).toBe(201);
    const runId = (await res.json()).data.run_id as string;
    const rationale = rationaleOf(runId);
    expect(rationale).toContain("credit_rating=BB+;");
    expect(rationale).toContain("credit_rating_source=bureau");
    expect(rationale).toContain(`credit_rating_snapshot_id=${snapshotId}`);
    expect(rationale).toContain("credit_rating_rcept_no=20260310000901");
    expect(rationale).toContain("credit_rating_agencies=ecredible:BB+,nice-dnb:BBB");
    expect(rationale).toContain("credit_rating_confidence=lower");
    expect(rationale).toContain("credit_rating_cashflow_grade=B");
    expect(spreadAudit(runId)[0]).toContain("credit_rating_source=bureau");
  });

  test("bureau needs the snapshot id; the snapshot must be the company's; unknown ids are 400 with no run", async () => {
    arrange();
    const before = runCount();
    expect((await confirm(applied({ credit_rating_snapshot_id: undefined }))).status).toBe(400);
    expect((await confirm(applied({ credit_rating_snapshot_id: "01JZZZZZZZZZZZZZZZZZZZZZZZ" }))).status).toBe(400);
    const other = putSnapshot(CORP_OTHER, "business_report", "20260310000902", "parsed", [
      bureauRow("ked", "A", ago(2)),
    ]);
    const foreign = await confirm(applied({ credit_rating_snapshot_id: other.id }));
    expect(foreign.status).toBe(400);
    expect(((await foreign.json()) as any).error.message).toContain("does not belong to the subject company");
    expect(runCount()).toBe(before);
  });

  test("the client cannot relabel the basis: 'disclosed' for a bureau rating and 'bureau' for a bond rating are 400", async () => {
    arrange();
    const before = runCount();
    const asDisclosed = await confirm(applied({ credit_rating_basis: "disclosed" }));
    expect(asDisclosed.status).toBe(400);
    expect(((await asDisclosed.json()) as any).error.message).toContain(
      "does not match the server-derived basis 'bureau'",
    );
    clearSnapshots();
    const bond = putSnapshot(CORP_D, "business_report", "20260310000903", "parsed", [
      ratingRow("kis", "A", ago(3)),
      bureauRow("ked", "BB", ago(1)),
    ]);
    const asBureau = await confirm(applied({ credit_rating_snapshot_id: bond.id }));
    expect(asBureau.status).toBe(400);
    expect(((await asBureau.json()) as any).error.message).toContain(
      "does not match the server-derived basis 'disclosed'",
    );
    expect(runCount()).toBe(before);
  });
});
