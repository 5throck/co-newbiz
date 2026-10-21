/**
 * S12 완결 (2026-10-21) — the greenfield "실행 기준선 대비 차이" view (flow.spec S12
 * output, ADR-0161 reference-only) and the kill-with-learning corpus surfaced to
 * S1/S2 (ADR-0150 criterion 6). Scratch SQLite; the baseline arithmetic is
 * exercised through buildBaselineVariance with hand-made entries so the rules
 * are pinned independently of the S11 confirmation flow.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { baselineVariance, buildBaselineVariance, quarterEnd } from "../../app/web-next/lib/baseline-variance.ts";
import { EMPTY_ENTRIES } from "../../app/web-next/lib/greenfield-execution.ts";

const TEST_DB_PATH = "db/data/test-s12-variance.sqlite";
const NOW = "2026-10-21T10:00:00Z";
type Db = ReturnType<typeof GetDb>;
let db: Db;

const ANALYST = "s12var-analyst";
const OUTSIDER = "s12var-outsider";
let analystCookie = "";
let outsiderCookie = "";
let projectId = "";

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const req = (path: string, init?: RequestInit) => nextRequest(path, init);

beforeAll(async () => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);
  for (const [u, role] of [[ANALYST, "analyst"], [OUTSIDER, "analyst"]] as const) {
    await createUser(db, { userId: u, role, password: "pw-12345-abcde", createdBy: "test", now: NOW });
    approveUser(db, { userId: u, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  const login = async (userId: string): Promise<string> => {
    const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password: "pw-12345-abcde" }) });
    return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
  };
  analystCookie = await login(ANALYST);
  outsiderCookie = await login(OUTSIDER);

  const opportunityId = ulid();
  db.run(
    `INSERT INTO opportunity (id, name, market_scope, value_chain_node, market_size_krw_m, growth_rate,
       attractiveness_score, synergy_score, rationale, status, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [opportunityId, "S12 variance 기회", "로봇 산업", "시스템 통합", 5000, 8.0, 80, 70, "근거", "selected", ANALYST, NOW],
  );
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)", [ulid(), opportunityId, "greenfield", "test", ANALYST, NOW]);
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    [ulid(), opportunityId, "직접 진출", "M&A 대안", "test", ANALYST, NOW, NOW],
  );
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), opportunityId]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", opportunityId, gate, "go", "test", ANALYST, NOW]);
  }
  const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
  projectId = promoteOpportunity(opportunityId, { promotedBy: ANALYST, needToKnowBasis: "s12 variance test" }).project.id;
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("baseline variance — arithmetic over a confirmed baseline and a scorecard cycle", () => {
  test("quarterEnd resolves the quarter's last day; other shapes are null", () => {
    expect(quarterEnd("2027-Q1")).toBe("2027-03-31");
    expect(quarterEnd("2028-Q2")).toBe("2028-06-30");
    expect(quarterEnd("2027-13")).toBeNull();
  });

  test("hiring/milestones count what is due by the cycle; KPI compares to target; missing scorecard rows are insufficient_evidence", () => {
    db.run(
      `INSERT INTO capex_tranche (id, project_id, tranche_no, amount, currency, release_condition, status, source_stage, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?), (?,?,?,?,?,?,?,?,?,?)`,
      [ulid(), projectId, 1, 300, "KRW", "착공", "released", "S10", ANALYST, NOW, ulid(), projectId, 2, 700, "KRW", "준공", "planned", "S10", ANALYST, NOW],
    );
    const entries = {
      ...EMPTY_ENTRIES,
      hiring_plan: [{ role_family: "엔지니어", quarter: "2027-Q1", headcount: 10 }, { role_family: "영업", quarter: "2027-Q2", headcount: 5 }, { role_family: "운영", quarter: "2028-Q1", headcount: 20 }],
      kpi_targets: [{ metric_key: "utilisation_pct", target_value: 60, unit: "%", due: "2027-06-30" }, { metric_key: "revenue_krw_m", target_value: 900, unit: "백만", due: "2028-12-31" }],
      permit_milestones: [{ name: "건축허가", issuer: "시", target_date: "2027-01-15", gates_ref: null, source_id: null }, { name: "사용승인", issuer: "시", target_date: "2028-03-01", gates_ref: null, source_id: null }],
      incentive_obligations: [{ obligation: "고용 50명 유지", deadline: "2029-12-31", depends_on: null, incentive_id: null }],
    };
    const scorecard = [
      { section: "strategic", measure_key: "headcount_vs_plan", target_value: "15", actual_value: "12", status: "deviation" },
      { section: "strategic", measure_key: "utilisation_pct", target_value: "60", actual_value: "65", status: "on_target" },
      { section: "financial", measure_key: "capex_deployed_vs_tranche", target_value: "300", actual_value: "300", status: "on_target" },
    ];
    const rows = buildBaselineVariance(db, projectId, entries, "2027-Q2", scorecard);
    const by = (key: string) => rows.find((r) => r.key === key)!;
    expect(by("capex_deployed_vs_tranche")).toMatchObject({ baseline: 300, actual: 300, variance: 0, status: "on_plan" });
    expect(by("headcount_vs_plan")).toMatchObject({ baseline: 15, actual: 12, variance: -3, status: "behind" });
    expect(by("utilisation_pct")).toMatchObject({ baseline: 60, actual: 65, variance: 5, status: "ahead", comparison: "higher_is_better_assumed" });
    expect(rows.find((r) => r.key === "revenue_krw_m")).toBeUndefined(); // not due by 2027-Q2
    expect(by("permit_milestones_met")).toMatchObject({ baseline: 1, actual: null, status: "insufficient_evidence" });
    expect(by("incentive_obligations_due")).toMatchObject({ baseline: 0, actual: null, status: "insufficient_evidence", comparison: "reference_only" }); // deadline 2029 — not yet due
  });

  test("the view degrades honestly: a greenfield project without a confirmed baseline reports no_confirmed_baseline; post-management carries it", async () => {
    expect(baselineVariance(db, projectId).status).toBe("no_confirmed_baseline");
    const res = await req(`/api/projects/${projectId}/post-management`, { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const data = (await res.json()).data as { baseline_variance: { status: string; gate_blocking: boolean } };
    expect(data.baseline_variance.status).toBe("no_confirmed_baseline");
    expect(data.baseline_variance.gate_blocking).toBe(false);
  });
});

describe("kill learnings corpus — ADR-0150 criterion 6 surfaced to S1/S2", () => {
  test("a kill with captured learning is returned; non-members see the lesson but not the project", async () => {
    let res = await req(`/api/portfolio/learnings`, { headers: { cookie: analystCookie } });
    expect(((await res.json()).data as { total: number }).total).toBe(0);

    const runId = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [runId, projectId, "recorder", "h", ANALYST, NOW]);
    db.run(
      `INSERT INTO venture_transition_decision (id, run_id, project_id, review_cycle, decision, decided_by, decided_at, rationale, learning_capture, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [ulid(), runId, projectId, "2027-Q3", "kill_with_learning_captured", "venture-portfolio-ic", NOW, "시장 축소", "진입 시점 가정이 낙관적이었다 — 선행 지표를 S1에서 먼저 확인할 것", NOW],
    );
    res = await req(`/api/portfolio/learnings?track=greenfield`, { headers: { cookie: analystCookie } });
    let data = (await res.json()).data as { rows: Array<{ name: string | null; learning_capture: string; track: string | null }>; by_track: Array<{ track: string | null; kills: number }>; total: number };
    expect(data.total).toBe(1);
    expect(data.rows[0]).toMatchObject({ track: "greenfield" });
    expect(data.rows[0].name).not.toBeNull();
    expect(data.rows[0].learning_capture).toContain("선행 지표");
    expect(data.by_track).toEqual([{ track: "greenfield", kills: 1 }]);

    res = await req(`/api/portfolio/learnings`, { headers: { cookie: outsiderCookie } });
    data = (await res.json()).data as typeof data;
    expect(data.rows[0].name).toBeNull();
    expect(data.rows[0].learning_capture).toContain("선행 지표");
    expect((await req(`/api/portfolio/learnings?track=brownfield`, { headers: { cookie: analystCookie } })).status).toBe(200);
    expect((((await (await req(`/api/portfolio/learnings?track=brownfield`, { headers: { cookie: analystCookie } })).json()).data) as { rows: unknown[] }).rows).toEqual([]);
  });
});
