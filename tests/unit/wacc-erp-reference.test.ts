// @version 1.0.0
/**
 * ADR-0207 - published ERP reference: registry reader, GET .../wacc/suggestions
 * (default, alternatives, stale, non-KR, no company bound) and the confirmation
 * audit on POST .../wacc. Real route handlers + scratch SQLite; the registry is
 * the shipped region-profiles/KR.yaml (read-only).
 */
import { test, expect, beforeAll, afterAll, afterEach, describe, setSystemTime } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-wacc-erp-reference.sqlite";
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
const erp = await import("../../db/lib/erp-reference.ts");

const NOW = "2026-11-26T00:00:00.000Z";
// The shipped default is fresh only for 12 months from its as_of, so the clock is pinned: the "fresh" cases must
// not flip to stale as wall-clock time passes. The stale cases move the clock forward explicitly.
const PIN = new Date("2026-11-26T12:00:00Z");
setSystemTime(PIN);
const USER = "erp-analyst";
const PW = "pw-erp-analyst-12345";
let cookie = "";
let projectKr = "";
let projectNoCompany = "";
let projectOther = "";
let companyId = "";

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function login(): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: USER, password: PW }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
async function suggestions(project: string, c = cookie) {
  const res = await req(`/api/projects/${project}/wacc/suggestions`, { headers: { cookie: c } });
  expect(res.status).toBe(200);
  return (await res.json()).data as {
    suggestions: Array<Record<string, any>>;
    erp_alternatives: Array<Record<string, any>>;
    apply_all_excluded: Array<Record<string, any>>;
    missing: string[];
    subject: unknown;
  };
}
function newProject(no: string, scopeRegions?: string[], withCompany = true): string {
  const p = createProject(no).id;
  if (withCompany) db.run("UPDATE md_project SET company_id = ? WHERE id = ?", [companyId, p]);
  if (scopeRegions) {
    const opp = crypto.randomUUID();
    db.run(
      "INSERT INTO opportunity (id, name, status, created_at, created_by, target_scope_json) VALUES (?, 'erp-test', 'assessed', ?, 'test', ?)",
      [
        opp,
        NOW,
        JSON.stringify({ regions: scopeRegions, segments: [], unit_basis: "krw_m_year", set_by: "test", set_at: NOW }),
      ],
    );
    db.run("UPDATE md_project SET source_opportunity_id = ? WHERE id = ?", [opp, p]);
  }
  grantProjectMembership(db, {
    projectId: p,
    userId: USER,
    projectRole: "lead",
    grantedBy: USER,
    needToKnowBasis: "erp reference test",
    now: NOW,
  });
  return p;
}

beforeAll(async () => {
  await createUser(db, { userId: USER, role: "analyst", password: PW, createdBy: "test", now: NOW });
  approveUser(db, { userId: USER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await login();
  companyId = crypto.randomUUID();
  db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?, 'erp-test-company', ?)", [companyId, NOW]);
  projectKr = newProject("NP-ERP-KR-1", ["kr"]);
  projectNoCompany = newProject("NP-ERP-NOCO-1", undefined, false);
  projectOther = newProject("NP-ERP-OTHER-1", ["na"]);
});

afterEach(() => setSystemTime(PIN));

afterAll(() => {
  setSystemTime();
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  for (const [k, v] of Object.entries(ENV_ORIGINALS)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ── registry reader (pure) ──
const entry = (over: Record<string, unknown> = {}) => ({
  id: "src-a",
  source: "Source A",
  url: "https://example.org/a",
  value_pct: 5.5,
  basis: "implied",
  as_of: "2026-06-01",
  verified_on: "2026-06-01",
  maintainer: "quant-methodologist",
  ...over,
});
const registryDoc = (entries: unknown[], def = "src-a") => ({
  erp_references: { data: { default_source_id: def, entries } },
});
const NOW_DATE = new Date("2026-11-26T12:00:00Z");

describe("erp-reference registry reader", () => {
  test("shipped KR registry loads with a default and a verified Damodaran value", () => {
    const r = erp.loadKrErpRegistry();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const def = r.registry.entries.find((e) => e.id === r.registry.default_source_id)!;
    expect(def.url.startsWith("https://pages.stern.nyu.edu/")).toBe(true);
    expect(def.value_pct).toBeGreaterThan(0);
  });

  test("stale boundary: exactly 12 months is fresh, 12 months + 1 day is stale, 11 months fresh, 13 months stale", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    expect(erp.isOlderThanStaleWindow("2025-12-26", now)).toBe(false); // 11 months
    expect(erp.isOlderThanStaleWindow("2025-11-26", now)).toBe(false); // exactly 12 months
    expect(erp.isOlderThanStaleWindow("2025-11-25", now)).toBe(true); // 12 months + 1 day
    expect(erp.isOlderThanStaleWindow("2025-10-26", now)).toBe(true); // 13 months
    expect(erp.monthsBetween("2025-11-26", now)).toBe(12);
    expect(erp.monthsBetween("2025-12-27", now)).toBe(10);
  });

  test("stale is raised by as_of alone and by verified_on alone, with the reason naming the date", () => {
    const asOfOld = erp.buildErpOffer(
      "KR",
      NOW_DATE,
      erp.parseErpRegistry(registryDoc([entry({ as_of: "2025-10-01" })])),
    );
    expect(asOfOld.erp).toMatchObject({ stale: true });
    expect((asOfOld.erp as any).stale_reason).toContain("as_of 2025-10-01");
    const verifiedOld = erp.buildErpOffer(
      "KR",
      NOW_DATE,
      erp.parseErpRegistry(registryDoc([entry({ verified_on: "2025-10-01" })])),
    );
    expect(verifiedOld.erp).toMatchObject({ stale: true });
    expect((verifiedOld.erp as any).stale_reason).toContain("verified_on 2025-10-01");
    const fresh = erp.buildErpOffer("KR", NOW_DATE, erp.parseErpRegistry(registryDoc([entry()])));
    expect(fresh.erp).toMatchObject({ stale: false, stale_reason: null });
    expect(fresh.apply_all_excluded).toEqual([]);
  });

  test("default is chosen via default_source_id; alternatives exclude the default and superseded entries", () => {
    const doc = registryDoc(
      [
        entry({ id: "first", source: "First" }),
        entry({ id: "chosen", source: "Chosen", value_pct: 6 }),
        entry({ id: "old", source: "Old", superseded_by: "chosen" }),
        entry({ id: "other", source: "Other", value_pct: 7 }),
      ],
      "chosen",
    );
    const offer = erp.buildErpOffer("KR", NOW_DATE, erp.parseErpRegistry(doc));
    expect(offer.erp).toMatchObject({
      source_id: "chosen",
      is_default: true,
      value: 6,
      anchor_ref: "https://example.org/a",
    });
    expect(offer.erp_alternatives.map((a) => a.source_id)).toEqual(["first", "other"]);
    expect(offer.erp_alternatives.every((a) => a.is_default === false)).toBe(true);
  });

  test("non-KR market, missing section and malformed registry give a null entry with a reason code, never a value", () => {
    expect(erp.buildErpOffer("OTHER", NOW_DATE).erp).toMatchObject({ value: null, reason_code: "erp_market_not_kr" });
    expect(erp.buildErpOffer("KR", NOW_DATE, erp.parseErpRegistry({})).erp).toMatchObject({
      value: null,
      reason_code: "erp_no_registry",
    });
    expect(
      erp.buildErpOffer("KR", NOW_DATE, erp.parseErpRegistry(registryDoc([entry({ value_pct: "x" })]))).erp,
    ).toMatchObject({ value: null, reason_code: "erp_registry_error" });
    expect(
      erp.buildErpOffer("KR", NOW_DATE, erp.parseErpRegistry(registryDoc([entry()], "dangling"))).erp,
    ).toMatchObject({ value: null, reason_code: "erp_registry_error" });
    expect(erp.loadKrErpRegistry("/nonexistent/KR.yaml")).toMatchObject({ ok: false, reason_code: "erp_no_registry" });
  });

  test("resolveErpReferenceAudit derives default/stale from the registry; null id is manual; unknown id is null", () => {
    const loaded = erp.parseErpRegistry(registryDoc([entry(), entry({ id: "src-b", as_of: "2025-01-01" })]));
    expect(erp.resolveErpReferenceAudit(null, NOW_DATE, loaded)).toEqual({ id: null, isDefault: false, stale: false });
    expect(erp.resolveErpReferenceAudit("src-a", NOW_DATE, loaded)).toEqual({
      id: "src-a",
      isDefault: true,
      stale: false,
    });
    expect(erp.resolveErpReferenceAudit("src-b", NOW_DATE, loaded)).toEqual({
      id: "src-b",
      isDefault: false,
      stale: true,
    });
    expect(erp.resolveErpReferenceAudit("nope", NOW_DATE, loaded)).toBeNull();
  });
});

// ── GET .../wacc/suggestions ──
describe("GET /api/projects/[id]/wacc/suggestions - ERP reference", () => {
  test("KR project: default erp entry present, existing keys unchanged, fresh default not excluded", async () => {
    const body = await suggestions(projectKr);
    expect(body.suggestions.map((s) => s.key)).toEqual([
      "risk_free",
      "credit_spread",
      "observed_de",
      "erp",
      "tax_rate",
    ]);
    const e = body.suggestions[3];
    const reg = erp.loadKrErpRegistry();
    if (!reg.ok) throw new Error("registry must load");
    const def = reg.registry.entries.find((x) => x.id === reg.registry.default_source_id)!;
    expect(e).toMatchObject({
      key: "erp",
      value: def.value_pct,
      as_of: def.as_of,
      verified_on: def.verified_on,
      anchor_ref: def.url,
      source_label: def.source,
      basis: def.basis,
      source_id: def.id,
      is_default: true,
      stale: false,
      stale_reason: null,
    });
    expect(typeof e.age_months).toBe("number");
    expect(Array.isArray(body.erp_alternatives)).toBe(true);
    expect(body.apply_all_excluded).toEqual([]);
    expect(body.missing.some((m) => m.startsWith("erp:"))).toBe(false);
    // The pre-existing keys keep their shape (null + reason when nothing is collected).
    expect(body.suggestions[0]).toMatchObject({ key: "risk_free", value: null });
  });

  test("stale default (clock past 12 months) is excluded from apply-all via apply_all_excluded + missing, but still carries its value", async () => {
    setSystemTime(new Date("2027-03-01T00:00:00Z"));
    const staleCookie = await login();
    const body = await suggestions(projectKr, staleCookie);
    const e = body.suggestions.find((s) => s.key === "erp")!;
    expect(e).toMatchObject({ stale: true, is_default: true });
    expect(typeof e.value).toBe("number");
    expect(e.stale_reason).toContain("more than 12 months");
    expect(body.apply_all_excluded).toEqual([
      expect.objectContaining({ key: "erp", reason_code: "erp_reference_stale" }),
    ]);
    expect(body.missing.some((m) => m.startsWith("erp: erp_reference_stale"))).toBe(true);
  });

  test("project that declared a non-KR scope gets a null erp with a reason; other keys unaffected", async () => {
    const body = await suggestions(projectOther);
    expect(body.suggestions.map((s) => s.key)).toEqual([
      "risk_free",
      "credit_spread",
      "observed_de",
      "erp",
      "tax_rate",
    ]);
    expect(body.suggestions[3]).toMatchObject({ key: "erp", value: null, reason_code: "erp_market_not_kr" });
    expect(typeof body.suggestions[3].reason).toBe("string");
    expect(body.erp_alternatives).toEqual([]);
  });

  test("ERP entry survives the no-company early return", async () => {
    const body = await suggestions(projectNoCompany);
    expect(body.subject).toBeNull();
    expect(body.suggestions.map((x) => x.key)).toEqual(["erp", "tax_rate"]);
    expect(body.suggestions[0]).toMatchObject({ key: "erp", is_default: true });
    expect(typeof body.suggestions[0].value).toBe("number");
    expect(body.missing.length).toBeGreaterThan(0); // the unbound-company message is still reported
  });

  test("non-member gets 404 and anonymous 401 (access unchanged)", async () => {
    const anon = await req(`/api/projects/${projectKr}/wacc/suggestions`);
    expect(anon.status).toBe(401);
    await createUser(db, {
      userId: "erp-outsider",
      role: "analyst",
      password: "pw-outsider-12345",
      createdBy: "test",
      now: NOW,
    });
    approveUser(db, { userId: "erp-outsider", approvedBy: "test", now: NOW });
    db.run("UPDATE app_user SET must_change_password = 0");
    const res = await req("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId: "erp-outsider", password: "pw-outsider-12345" }),
    });
    const outsider = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
    const r = await req(`/api/projects/${projectKr}/wacc/suggestions`, { headers: { cookie: outsider } });
    expect(r.status).toBe(404);
  });
});

// ── POST .../wacc confirmation audit ──
const CAPM = (erpComponent: Record<string, unknown>) => [
  { key: "wacc.risk_free", value: 0.03, kind: "live", source_label: "ECOS", anchor_ref: "src:ecos" },
  erpComponent,
  { key: "wacc.beta_unlevered", value: 1.0, kind: "derived" },
  { key: "wacc.target_de", value: 0.5, kind: "user" },
  { key: "wacc.tax_rate", value: 0.24, kind: "user" },
  { key: "wacc.cost_of_debt", value: 0.05, kind: "user" },
];
async function confirm(project: string, erpComponent: Record<string, unknown>) {
  return req(`/api/projects/${project}/wacc`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ wacc: 0.09, mode: "capm", components: CAPM(erpComponent) }),
  });
}
const erpAudit = (runId: string) =>
  db
    .query("SELECT target FROM audit_log WHERE action = 'assumption_set' AND target LIKE ?")
    .all(`${runId}:wacc.erp:%`) as Array<{ target: string }>;

describe("POST /api/projects/[id]/wacc - ERP reference audit", () => {
  const reg = erp.loadKrErpRegistry();
  if (!reg.ok) throw new Error("registry must load");
  const def = reg.registry.entries.find((x) => x.id === reg.registry.default_source_id)!;

  test("applied default reference: row stays kind=user with citation and erp_reference_id; audit carries id/default/stale", async () => {
    const res = await confirm(projectKr, {
      key: "wacc.erp",
      value: def.value_pct / 100,
      kind: "user",
      source_label: def.source,
      anchor_ref: def.url,
      as_of: def.as_of,
      erp_reference_id: def.id,
      erp_reference_default: false, // client claim is ignored - the server derives it
      erp_reference_stale: true,
    });
    expect(res.status).toBe(201);
    const runId = (await res.json()).data.run_id as string;
    const row = db
      .query(
        "SELECT kind, anchor_ref, as_of, rationale FROM assumption WHERE run_id = ? AND assumption_key = 'wacc.erp'",
      )
      .get(runId) as any;
    expect(row).toMatchObject({ kind: "user", anchor_ref: def.url, as_of: def.as_of });
    expect(row.rationale).toContain(def.source);
    expect(row.rationale).toContain(`erp_reference_id=${def.id}`);
    expect(row.rationale).not.toContain("edited_from_reference");
    expect(erpAudit(runId).map((a) => a.target)).toEqual([
      `${runId}:wacc.erp:user:erp_reference_id=${def.id}:erp_reference_default=true:erp_reference_stale=false`,
    ]);
  });

  test("manual entry audits erp_reference_id=null / default=false / stale=false", async () => {
    const res = await confirm(projectKr, {
      key: "wacc.erp",
      value: 0.055,
      kind: "user",
      rationale: "analyst judgement",
    });
    expect(res.status).toBe(201);
    const runId = (await res.json()).data.run_id as string;
    expect(erpAudit(runId).map((a) => a.target)).toEqual([
      `${runId}:wacc.erp:user:erp_reference_id=null:erp_reference_default=false:erp_reference_stale=false`,
    ]);
    const row = db
      .query("SELECT rationale FROM assumption WHERE run_id = ? AND assumption_key = 'wacc.erp'")
      .get(runId) as any;
    expect(row.rationale).toBe("analyst judgement");
  });

  test("stale reference at confirmation time is flagged stale; edited_from_reference lands in the row note", async () => {
    setSystemTime(new Date("2027-03-01T00:00:00Z"));
    const c = await login();
    const res = await req(`/api/projects/${projectKr}/wacc`, {
      method: "POST",
      headers: { cookie: c, "content-type": "application/json" },
      body: JSON.stringify({
        wacc: 0.09,
        mode: "capm",
        components: CAPM({
          key: "wacc.erp",
          value: 0.05,
          kind: "user",
          source_label: def.source,
          anchor_ref: def.url,
          erp_reference_id: def.id,
          edited_from_reference: true,
        }),
      }),
    });
    expect(res.status).toBe(201);
    const runId = (await res.json()).data.run_id as string;
    expect(erpAudit(runId).map((a) => a.target)).toEqual([
      `${runId}:wacc.erp:user:erp_reference_id=${def.id}:erp_reference_default=true:erp_reference_stale=true`,
    ]);
    const row = db
      .query("SELECT kind, rationale FROM assumption WHERE run_id = ? AND assumption_key = 'wacc.erp'")
      .get(runId) as any;
    expect(row.kind).toBe("user");
    expect(row.rationale).toContain("edited_from_reference: true");
  });

  test("unknown erp_reference_id is 400 and creates no run", async () => {
    const before = (db.query("SELECT COUNT(*) AS n FROM run WHERE project_id = ?").get(projectKr) as { n: number }).n;
    const res = await confirm(projectKr, {
      key: "wacc.erp",
      value: 0.05,
      kind: "user",
      erp_reference_id: "not-in-registry",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("invalid_request");
    expect((db.query("SELECT COUNT(*) AS n FROM run WHERE project_id = ?").get(projectKr) as { n: number }).n).toBe(
      before,
    );
  });

  test("malformed ERP fields are 400: bad id shape, non-boolean flags, or fields on another component", async () => {
    for (const bad of [
      { key: "wacc.erp", value: 0.05, kind: "user", erp_reference_id: "has space" },
      { key: "wacc.erp", value: 0.05, kind: "user", erp_reference_id: 42 },
      { key: "wacc.erp", value: 0.05, kind: "user", erp_reference_id: def.id, erp_reference_stale: "yes" },
      { key: "wacc.erp", value: 0.05, kind: "user", erp_reference_default: 1 },
      { key: "wacc.erp", value: 0.05, kind: "user", edited_from_reference: "true" },
    ]) {
      const res = await confirm(projectKr, bad);
      expect(res.status).toBe(400);
    }
    const res = await req(`/api/projects/${projectKr}/wacc`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        wacc: 0.09,
        mode: "capm",
        components: CAPM({ key: "wacc.erp", value: 0.05, kind: "user" }).map((c) =>
          c.key === "wacc.tax_rate" ? { ...c, erp_reference_id: def.id } : c,
        ),
      }),
    });
    expect(res.status).toBe(400);
  });
});
