// @version 1.0.0
/**
 * Business-target standards master data + fs-gate evidence — ADR-0114 regression.
 *
 * Proves against the REAL route handlers (nextRequest harness) and the real
 * scratch SQLite:
 *  (a) admin CRUD on md_business_target: create/list/update, tombstone delete
 *      (0081 convention — row survives with deleted_at, lists filter it),
 *      admin-only writes, duplicate scope+metric rejection, custom-label rule;
 *  (b) resolution precedence: an affiliate-specific row shadows the
 *      group-common row of the same metric (shadowed row surfaced as context);
 *  (c) evaluation formulas: final-year line compounding matching the S8
 *      rendering, operating margin excluding capex, period vs horizon,
 *      indeterminate without an adopted case, manual for custom KPIs;
 *  (d) deny-by-default visibility on /api/projects/:id/target-check
 *      (non-member 404, admin 404 via role separation) and the honest
 *      resolvable:false when the project has no initiating affiliate.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-business-targets.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const {
  listBusinessTargets,
  resolveBusinessTargets,
  evaluateTargets,
  finalYearLineAmount,
  formatTargetValue,
  projectTargetScope,
} = await import("../../app/web-next/lib/business-targets.ts");

const NOW = new Date().toISOString();
const ADMIN = "admin1";
const ANALYST = "analyst1"; // project lead member
const OUTSIDER = "outsider1"; // analyst, not a member
const G1 = ulid();
const G2 = ulid(); // second group — created mid-test to break the single-group fallback
const M1 = ulid(); // 테스트중공업
const C1 = ulid(); // md_company row linked to the project (0047), matched by name
let adminCookie = "";
let analystCookie = "";
let outsiderCookie = "";
let projectId = ""; // company_id = C1 → registry member M1
let projectIdNoCompany = "";

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

function post(json: unknown, cookie: string) {
  return req("/api/admin/business-targets", { method: "POST", headers: { cookie }, body: JSON.stringify(json) });
}

const SCOPE = { groupId: G1, groupName: "테스트그룹", memberId: M1, memberName: "테스트중공업" };

function adoptedCase(): NonNullable<Parameters<typeof evaluateTargets>[2]> {
  return {
    id: "case-1",
    kind: "revenue",
    name: "Base",
    horizon_years: 5,
    scenario: "base",
    source: "generated",
    recommended: true,
    adopted: true,
    created_by: "test",
    created_at: NOW,
    lines: [
      { id: "l1", category: "revenue", name: "장비 매출", annual_amount_krw_m: 40000, start_year: 1, growth_rate: 0.05, unit: null, note: null },
      { id: "l2", category: "labor", name: "인건비", annual_amount_krw_m: 20000, start_year: 1, growth_rate: 0, unit: null, note: null },
      { id: "l3", category: "opex", name: "운영비", annual_amount_krw_m: 10000, start_year: 1, growth_rate: 0, unit: null, note: null },
      // capex is investment — must stay out of the operating-margin numerator
      { id: "l4", category: "capex", name: "설비 투자", annual_amount_krw_m: 20000, start_year: 1, growth_rate: 0, unit: null, note: null },
    ],
    simulations: [],
  };
}

describe("business-target standards (ADR-0114)", () => {
  beforeAll(async () => {
    await createUser(db, { userId: ADMIN, role: "admin", password: "pw-admin-12345", createdBy: "test", now: NOW });
    approveUser(db, { userId: ADMIN, approvedBy: "test", now: NOW });
    await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-analyst-12345", createdBy: "test", now: NOW });
    approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
    await createUser(db, { userId: OUTSIDER, role: "analyst", password: "pw-outsider-12345", createdBy: "test", now: NOW });
    approveUser(db, { userId: OUTSIDER, approvedBy: "test", now: NOW });
    db.run("UPDATE app_user SET must_change_password = 0");
    adminCookie = await loginCookie(ADMIN, "pw-admin-12345");
    analystCookie = await loginCookie(ANALYST, "pw-analyst-12345");
    outsiderCookie = await loginCookie(OUTSIDER, "pw-outsider-12345");

    db.run("INSERT INTO company_group (id, name, created_by, created_at) VALUES (?,?,?,?)", [G1, "테스트그룹", "test", NOW]);
    db.run("INSERT INTO company_group_member (id, group_id, company_name, role, created_at) VALUES (?,?,?,?,?)", [M1, G1, "테스트중공업", "affiliate", NOW]);

    const opp1 = ulid();
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp1, "타깃 테스트 기회", "테스트 산업", "selected", ANALYST, NOW]);
    db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)", [ulid(), opp1, "greenfield", "test route", ANALYST, NOW]);
    db.run(
      `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [ulid(), opp1, "직접 진출", "M&A 대안 검토", "test", ANALYST, NOW, NOW],
    );
    // ADR-0136: 역량 격차 건수는 S3 레지스터(opportunity.capability_gap_json)에서 센다.
    db.run(
      "UPDATE opportunity SET capability_gap_json = ? WHERE id = ?",
      [JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), opp1],
    );
  // Promotion preconditions (2026-09-12): screening + pre_fs must be GO.
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", opp1, gate, "go", "test", ANALYST, NOW]);
  }
    projectId = promoteOpportunity(opp1, { promotedBy: ANALYST, needToKnowBasis: "business-target test" }).project.id;
    // md_project.company_id references md_company (0047) — for brownfield it is
    // the acquisition target; here it matches the registry member by name.
    db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [C1, "테스트중공업", NOW]);
    db.run("UPDATE md_project SET company_id = ? WHERE id = ?", [C1, projectId]);

    const opp2 = ulid();
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp2, "회사 미지정 기회", "테스트 산업", "selected", ANALYST, NOW]);
    db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)", [ulid(), opp2, "greenfield", "test route", ANALYST, NOW]);
    db.run(
      `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [ulid(), opp2, "직접 진출", "M&A 대안 검토", "test", ANALYST, NOW, NOW],
    );
    // ADR-0136: 역량 격차 건수는 S3 레지스터(opportunity.capability_gap_json)에서 센다.
    db.run(
      "UPDATE opportunity SET capability_gap_json = ? WHERE id = ?",
      [JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), opp2],
    );
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", opp2, gate, "go", "test", ANALYST, NOW]);
  }
    projectIdNoCompany = promoteOpportunity(opp2, { promotedBy: ANALYST, needToKnowBasis: "business-target test" }).project.id;
  });

  afterAll(() => {
    resetDb();
    for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  });

  test("formatting: money shown in 억원, ratios as %", () => {
    expect(formatTargetValue(50000, "krw_m")).toBe("500억원");
    expect(formatTargetValue(0.07, "pct")).toBe("7%");
    expect(formatTargetValue(5, "years")).toBe("5년");
  });

  test("admin-only writes: analyst gets forbidden, anonymous gets 401", async () => {
    const analystRes = await post({ group_id: G1, metric_key: "revenue", direction: "gte", target_value: 50000 }, analystCookie);
    expect(analystRes.status).toBe(403);
    const anonRes = await req("/api/admin/business-targets", { method: "POST", body: JSON.stringify({}) });
    expect(anonRes.status).toBe(401);
  });

  test("POST creates group-common and affiliate standards; validation errors are specific", async () => {
    const rev = await post({ group_id: G1, metric_key: "revenue", direction: "gte", target_value: 50000 }, adminCookie);
    expect(rev.status).toBe(201);
    const marginGroup = await post({ group_id: G1, metric_key: "operating_margin", direction: "gte", target_value: 0.07 }, adminCookie);
    expect(marginGroup.status).toBe(201);
    const marginAffiliate = await post({ group_id: G1, member_id: M1, metric_key: "operating_margin", direction: "gte", target_value: 0.08 }, adminCookie);
    expect(marginAffiliate.status).toBe(201);
    const period = await post({ group_id: G1, metric_key: "period", direction: "lte", target_value: 5 }, adminCookie);
    expect(period.status).toBe(201);
    const npv = await post({ group_id: G1, metric_key: "npv", direction: "gte", target_value: 30000 }, adminCookie);
    expect(npv.status).toBe(201);
    const custom = await post({ group_id: G1, metric_key: "custom", label: "R&D 투자 비중", direction: "lte", target_value: 0.15 }, adminCookie);
    expect(custom.status).toBe(201);

    const dup = await post({ group_id: G1, member_id: M1, metric_key: "operating_margin", direction: "gte", target_value: 0.1 }, adminCookie);
    expect(dup.status).toBe(400);
    expect((await dup.json()).error?.code).toBe("duplicate_target");
    const noLabel = await post({ group_id: G1, metric_key: "custom", direction: "gte", target_value: 1 }, adminCookie);
    expect(noLabel.status).toBe(400);
    expect((await noLabel.json()).error?.code).toBe("custom_label_required");
    const badGroup = await post({ group_id: "no-such-group", metric_key: "revenue", direction: "gte", target_value: 1 }, adminCookie);
    expect(badGroup.status).toBe(400);
    expect((await badGroup.json()).error?.code).toBe("unknown_group");
    expect(listBusinessTargets().length).toBe(6);
  });

  test("scope resolution: company→member name match, plus the single-group fallback", () => {
    const linked = projectTargetScope(projectId);
    expect(linked).not.toBeNull();
    expect(linked!.memberId).toBe(M1);
    expect(linked!.groupId).toBe(G1);
    // no company link + exactly one active group → that group's common standards
    const fallback = projectTargetScope(projectIdNoCompany);
    expect(fallback).not.toBeNull();
    expect(fallback!.groupId).toBe(G1);
    expect(fallback!.memberId).toBeNull();
  });

  test("a second group without a company link leaves the scope unresolved", () => {
    db.run("INSERT INTO company_group (id, name, created_by, created_at) VALUES (?,?,?,?)", [G2, "다른그룹", "test", NOW]);
    expect(projectTargetScope(projectIdNoCompany)).toBeNull();
    // the company-linked project still resolves to its member's group
    expect(projectTargetScope(projectId)!.groupId).toBe(G1);
  });

  test("affiliate row shadows the group-common row of the same metric", () => {
    const resolved = resolveBusinessTargets(G1, M1);
    const margin = resolved.find((r) => r.row.metric_key === "operating_margin")!;
    expect(margin.source).toBe("affiliate");
    expect(margin.row.target_value).toBe(0.08);
    expect(margin.overridden?.target_value).toBe(0.07);
    const revenue = resolved.find((r) => r.row.metric_key === "revenue")!;
    expect(revenue.source).toBe("group");
    expect(resolved.length).toBe(5);
  });

  test("evaluation: final-year compounding, margin excludes capex, statuses are 3-valued", () => {
    const resolved = resolveBusinessTargets(G1, M1);
    const entries = evaluateTargets(resolved, SCOPE, adoptedCase(), "base");
    const byMetric = Object.fromEntries(entries.map((e) => [e.metric_key, e]));

    // final-year revenue = 40000 × 1.05^4 ≈ 48620.25 백만 (486.2억) < 500억 → missed
    expect(finalYearLineAmount({ annual_amount_krw_m: 40000, start_year: 1, growth_rate: 0.05 }, 5)).toBeCloseTo(48620.25, 2);
    expect(byMetric.revenue.status).toBe("missed");
    // margin = (48620.25 − 30000) / 48620.25 ≈ 0.383 — capex 20000 excluded → met vs 8%
    expect(byMetric.operating_margin.actual!).toBeCloseTo(0.383, 2);
    expect(byMetric.operating_margin.status).toBe("met");
    expect(byMetric.operating_margin.source).toBe("affiliate");
    expect(byMetric.operating_margin.overridden_note).toContain("그룹 공통 기준");
    // period 5 ≤ 5 → met
    expect(byMetric.period.status).toBe("met");
    // no simulation rows → indeterminate, never a fabricated number
    expect(byMetric.npv.status).toBe("indeterminate");
    expect(byMetric.npv.actual).toBeNull();
    // custom KPI → manual
    expect(byMetric.custom.status).toBe("manual");
    expect(byMetric.custom.label).toBe("R&D 투자 비중");
  });

  test("NPV/IRR use only the recommended scenario p50; a missing one is indeterminate (no first-p50 fallback)", () => {
    const resolved = resolveBusinessTargets(G1, M1);
    const sim = (scenario: string) => ({ id: `s-${scenario}`, model_id: "case-1", scenario, percentile: "p50", npv_krw_m: 90000, irr: 0.2, note: null });
    const c = { ...adoptedCase(), simulations: [sim("bull")] } as ReturnType<typeof adoptedCase>;
    const miss = Object.fromEntries(evaluateTargets(resolved, SCOPE, c, "base").map((e) => [e.metric_key, e]));
    expect(miss.npv.status).toBe("indeterminate");
    expect(miss.npv.actual).toBeNull();
    expect(miss.npv.actual_basis).toContain("대체하지 않음");
    const none = Object.fromEntries(evaluateTargets(resolved, SCOPE, c, null).map((e) => [e.metric_key, e]));
    expect(none.npv.status).toBe("indeterminate");
    const hit = Object.fromEntries(evaluateTargets(resolved, SCOPE, c, "bull").map((e) => [e.metric_key, e]));
    expect(hit.npv.actual).toBe(90000);
  });

  test("no adopted case → indeterminate for computable metrics, manual for custom", () => {
    const resolved = resolveBusinessTargets(G1, M1);
    const entries = evaluateTargets(resolved, SCOPE, null, null);
    for (const e of entries) {
      expect(["indeterminate", "manual"]).toContain(e.status);
      expect(e.actual).toBeNull();
    }
  });

  test("lines starting beyond the horizon contribute nothing", () => {
    expect(finalYearLineAmount({ annual_amount_krw_m: 1000, start_year: 6, growth_rate: 0.1 }, 5)).toBe(0);
  });

  test("target-check visibility: member 200, outsider 404, admin 404 (role separation)", async () => {
    const memberRes = await req(`/api/projects/${projectId}/target-check`, { headers: { cookie: analystCookie } });
    expect(memberRes.status).toBe(200);
    const memberBody = await memberRes.json();
    expect(memberBody.data.resolvable).toBe(true);
    expect(memberBody.data.scope.memberName).toBe("테스트중공업");
    expect(memberBody.data.entries.length).toBe(5);

    expect((await req(`/api/projects/${projectId}/target-check`, { headers: { cookie: outsiderCookie } })).status).toBe(404);
    expect((await req(`/api/projects/${projectId}/target-check`, { headers: { cookie: adminCookie } })).status).toBe(404);
  });

  test("project with no resolvable scope degrades honestly", async () => {
    const res = await req(`/api/projects/${projectIdNoCompany}/target-check`, { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.resolvable).toBe(false);
    expect(body.data.reason).toBe("scope_unresolved");
    expect(body.data.entries.length).toBe(0);
  });

  test("PUT edits value/direction in place; DELETE tombstones instead of erasing", async () => {
    const targets = listBusinessTargets();
    const revenue = targets.find((t) => t.metric_key === "revenue")!;
    const put = await req("/api/admin/business-targets", {
      method: "PUT",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ id: revenue.id, target_value: 55000 }),
    });
    expect(put.status).toBe(200);
    expect(listBusinessTargets().find((t) => t.id === revenue.id)!.target_value).toBe(55000);

    const del = await req("/api/admin/business-targets", { method: "DELETE", headers: { cookie: adminCookie }, body: JSON.stringify({ id: revenue.id }) });
    expect(del.status).toBe(200);
    // tombstone: the row survives with deleted_at; the active list filters it
    const row = db.query("SELECT deleted_at FROM md_business_target WHERE id = ?").get(revenue.id) as { deleted_at: string | null };
    expect(row.deleted_at).not.toBeNull();
    expect(listBusinessTargets().some((t) => t.id === revenue.id)).toBe(false);

    // and the evidence table immediately loses the metric
    const check = await req(`/api/projects/${projectId}/target-check`, { headers: { cookie: analystCookie } });
    const body = await check.json();
    expect(body.data.entries.some((e: { metric_key: string }) => e.metric_key === "revenue")).toBe(false);
  });
});
