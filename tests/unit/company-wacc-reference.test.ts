// @version 1.0.0
/**
 * Company financials WACC reference (design 2026-10-11-company-financials-
 * wacc-reference-fix): computeWaccReference -> toCompanyWaccReferencePayload.
 * Pins the ECOS stored unit (percent points, ADR: adapter parses DATA_VALUE
 * with Number() and declares unitCode "percent") and the ratio conversion.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-company-wacc-reference.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { ulid } = await import("../../db/lib/ulid.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { computeWaccReference, RF_SERIES_ID, CORP_BOND_SERIES_ID } = await import("../../db/lib/wacc-reference.ts");
const { toCompanyWaccReferencePayload, BETA_PENDING_REASON } = await import(
  "../../app/web-next/lib/company-wacc-reference.ts"
);

const NOW = new Date().toISOString();
let unitId = "";
let sourceId = "";
let cookie = "";

function seedCompany(): string {
  const id = ulid();
  db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [id, `테스트-${id.slice(-5)}`, NOW]);
  return id;
}
function monthPeriod(ym: string): string {
  const id = `M${ym}`;
  if (!db.query("SELECT 1 FROM md_period WHERE id = ?").get(id)) {
    db.run("INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)", [
      id, "month", `${ym}-01`, `${ym}-28`, Number(ym.slice(0, 4)), NOW,
    ]);
  }
  return id;
}
function obs(seriesId: string, ym: string, value: number) {
  db.run(
    "INSERT INTO fact_market_observation (series_id, period_id, revision_no, value, unit_id, source_id, content_hash, fetched_at) VALUES (?,?,?,?,?,?,?,?)",
    [seriesId, monthPeriod(ym), 1, value, unitId, sourceId, `h-${seriesId}-${ym}`, NOW],
  );
}
function clearObs() {
  db.run("DELETE FROM fact_market_observation");
}
function yearPeriod(year: number): string {
  const ex = db.query("SELECT id FROM md_period WHERE period_type='year' AND fiscal_year=?").get(year) as { id: string } | undefined;
  if (ex) return ex.id;
  const id = `Y${year}`;
  db.run("INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)", [
    id, "year", `${year}-01-01`, `${year}-12-31`, year, NOW,
  ]);
  return id;
}
function fact(companyId: string, year: number, account: string, value: number) {
  const acc = db.query("SELECT id FROM md_account WHERE name_ko = ?").get(account) as { id: string };
  db.run(
    "INSERT INTO fact_financial (id, company_id, period_id, account_id, value, revision_no, source_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), companyId, yearPeriod(year), acc.id, value, 1, sourceId, "2030-01-01T00:00:00Z"],
  );
}
function payload(companyId: string) {
  const ref = computeWaccReference(db, companyId);
  return toCompanyWaccReferencePayload(ref, { subject: { id: companyId, name_ko: ref.subject.name_ko }, latestYear: null });
}
const entry = (p: ReturnType<typeof payload>, key: string) => p.entries.find((e) => e.key === key)!;

beforeAll(async () => {
  unitId = ulid();
  sourceId = ulid();
  db.run("INSERT INTO md_unit (id, code, dimension, si_coefficient, created_at) VALUES (?,?,?,?,?)", [unitId, "PCT.T", "dimensionless", 1, NOW]);
  db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [sourceId, "TESTECOS", "A", NOW]);
  await createUser(db, { userId: "cwr1", role: "analyst", password: "pw-cwr-12345678", createdBy: "test", now: NOW });
  approveUser(db, { userId: "cwr1", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: "cwr1", password: "pw-cwr-12345678" }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("company WACC reference mapper", () => {
  test("1. both series same month: ratio values, YYYY-MM, note on spread, reason null (ECOS percent points -> ratio)", () => {
    clearObs();
    obs(RF_SERIES_ID, "2026-09", 2.85);
    obs(CORP_BOND_SERIES_ID, "2026-09", 3.35);
    const p = payload(seedCompany());
    const rf = entry(p, "risk_free");
    const sp = entry(p, "credit_spread");
    expect(rf.value).toBeCloseTo(0.0285, 10);
    expect(rf.unit).toBe("ratio");
    expect(rf.as_of).toBe("2026-09");
    expect(rf.source_label).toBeTruthy();
    expect(sp.value).toBeCloseTo(0.005, 10);
    expect(sp.as_of).toBe("2026-09");
    expect(sp.note).toBeTruthy();
    expect(sp.reason).toBeNull();
  });

  test("2. corp bond missing: Rf present, spread null with not-collected reason", () => {
    clearObs();
    obs(RF_SERIES_ID, "2026-09", 2.85);
    const p = payload(seedCompany());
    expect(entry(p, "risk_free").value).not.toBeNull();
    const sp = entry(p, "credit_spread");
    expect(sp.value).toBeNull();
    expect(sp.reason).toContain("미수집");
    expect(p.missing).toContain("credit_spread");
  });

  test("3. mismatched latest months: spread uses latest COMMON month, Rf stays latest", () => {
    clearObs();
    obs(RF_SERIES_ID, "2026-08", 2.8);
    obs(RF_SERIES_ID, "2026-09", 2.85);
    obs(CORP_BOND_SERIES_ID, "2026-08", 3.3);
    const p = payload(seedCompany());
    expect(entry(p, "risk_free").as_of).toBe("2026-09");
    const sp = entry(p, "credit_spread");
    expect(sp.value).toBeCloseTo(0.005, 10);
    expect(sp.as_of).toBe("2026-08");
    expect(sp.note).toContain("2026-08");
    expect(sp.note).toContain("2026-09");
  });

  test("3b. no common month: spread null, reason names both latest months", () => {
    clearObs();
    obs(RF_SERIES_ID, "2026-09", 2.85);
    obs(CORP_BOND_SERIES_ID, "2026-07", 3.3);
    const sp = entry(payload(seedCompany()), "credit_spread");
    expect(sp.value).toBeNull();
    expect(sp.reason).toContain("2026-09");
    expect(sp.reason).toContain("2026-07");
  });

  test("4. no ECOS rows: both null and missing", () => {
    clearObs();
    const p = payload(seedCompany());
    expect(entry(p, "risk_free").value).toBeNull();
    expect(entry(p, "credit_spread").value).toBeNull();
    expect(p.missing).toEqual(expect.arrayContaining(["risk_free", "credit_spread"]));
  });

  test("5. no financial facts: observed_de null with reason", () => {
    const p = payload(seedCompany());
    const de = entry(p, "observed_de");
    expect(de.value).toBeNull();
    expect(de.reason).toBeTruthy();
    expect(p.latest_year).toBeNull();
    expect(de.unit).toBe("multiple");
  });

  test("6. two fiscal years: latest year used, as_of = YYYY-12-31", () => {
    const c = seedCompany();
    fact(c, 2024, "부채총계", 900);
    fact(c, 2024, "자본총계", 100);
    fact(c, 2025, "부채총계", 300);
    fact(c, 2025, "자본총계", 200);
    const de = entry(payload(c), "observed_de");
    expect(de.value).toBeCloseTo(1.5, 10);
    expect(de.as_of).toBe("2025-12-31");
  });

  test("7. beta placeholder always present; passthrough when ref supplies it", () => {
    const c = seedCompany();
    const beta = entry(payload(c), "beta_levered");
    expect(beta.value).toBeNull();
    expect(beta.reason).toBe(BETA_PENDING_REASON);
    const ref = computeWaccReference(db, c);
    ref.entries.push({
      key: "beta_levered", label: "b", value: 1.1, as_of: "2026-09-01", anchor_ref: "src:krx", source_label: "KRX", reason: null,
    });
    const p = toCompanyWaccReferencePayload(ref, { subject: { id: c, name_ko: null }, latestYear: null });
    expect(entry(p, "beta_levered").value).toBe(1.1);
    expect(p.entries.map((e) => e.key)).toEqual(["risk_free", "credit_spread", "observed_de", "beta_levered"]);
  });

  test("7b. null ref (compute failed): all N/A, no throw", () => {
    const p = toCompanyWaccReferencePayload(null, { subject: { id: "x", name_ko: null }, latestYear: null });
    expect(p.entries.every((e) => e.value === null && e.reason)).toBe(true);
    expect(p.disclaimer).toBeTruthy();
  });
});

describe("routes", () => {
  test("8a. GET financials returns the new shape", async () => {
    clearObs();
    obs(RF_SERIES_ID, "2026-09", 2.85);
    obs(CORP_BOND_SERIES_ID, "2026-09", 3.35);
    const c = seedCompany();
    const res = await nextRequest(`/api/companies/${c}/financials`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    const w = body.data.wacc_reference;
    expect(w.subject.id).toBe(c);
    expect(w.entries.map((e: { key: string }) => e.key)).toEqual(["risk_free", "credit_spread", "observed_de", "beta_levered"]);
    expect(w.entries[0].value).toBeCloseTo(0.0285, 10);
    expect(Array.isArray(w.missing)).toBe(true);
    expect(typeof w.disclaimer).toBe("string");
    expect(w.latest_year).toBeNull();
  });

  test("8b. suggestions route output is unchanged (percent points, same-month data)", async () => {
    clearObs();
    obs(RF_SERIES_ID, "2026-09", 2.85);
    obs(CORP_BOND_SERIES_ID, "2026-09", 3.35);
    const c = seedCompany();
    const pid = ulid();
    db.run("INSERT INTO md_project (id, project_no, company_id, created_at) VALUES (?,?,?,?)", [pid, `P-${pid.slice(-6)}`, c, NOW]);
    db.run(
      "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
      [pid, "cwr1", "lead", "cwr1", NOW, "test"],
    );
    const res = await nextRequest(`/api/projects/${pid}/wacc/suggestions`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const d = (await res.json()).data;
    expect(d.suggestions[0]).toMatchObject({ key: "risk_free", value: 2.85, as_of: "2026-09", anchor_ref: "src:ecos" });
    expect(d.suggestions[1].key).toBe("credit_spread");
    expect(d.suggestions[1].value).toBeCloseTo(0.5, 10);
    expect(Object.keys(d.suggestions[1]).sort()).toEqual(["anchor_ref", "as_of", "key", "note", "source_label", "value"]);
    expect(d.suggestions[2]).toMatchObject({ key: "observed_de", value: null });
    expect(d.missing).toEqual(["observed_de"]);
  });
});
