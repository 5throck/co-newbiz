// @version 1.0.0
/**
 * ADR-0161 Row 2 (backend) against the REAL route handlers and a scratch SQLite:
 *  (a) execution-baseline POST is human-only (bearer / agent 403), wired into
 *      HUMAN_ONLY_ROUTES + mcp-coverage exclusions; validation; audit entries;
 *  (b) tranche reconciliation vs the S8 adopted case: exact match passes,
 *      ANY difference is a finding (O2), retired rows excluded; the baseline
 *      never writes capex_tranche and the two-person release is unaffected;
 *  (c) PMI guards: greenfield / non-PMI sub-track writes 403, m_and_a
 *      unchanged; stage-tab PMI visibility;
 *  (d) venture_class defaults (Q7) + audited override;
 *  (e) retroactive rule: completed S11 stays recommended (not reopened),
 *      not-yet-reached S11 blocks; fail-closed on unresolved track;
 *  (f) policy migration entry (process owner = project lead) + in-flight counts.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-greenfield-execution.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { issueApiToken } = await import("../../db/lib/api-tokens.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { AGENT_KEYS } = await import("../../app/web-next/lib/agent-registry.generated.ts");
const { isHumanOnly } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
const gx = await import("../../app/web-next/lib/greenfield-execution.ts");
const { pmiKickoffApplies, pmiApplicability } = await import("../../app/web-next/lib/pmi-kickoff.ts");
const { stageTabGroupsFor, STAGE_TAB_GROUPS } = await import("../../app/web-next/lib/stage-tabs.ts");
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");

const NOW = new Date().toISOString();
const A1 = "gx_analyst1";
const A2 = "gx_analyst2";
const AGENT = [...AGENT_KEYS][0];
let c1 = "";
let c2 = "";
let agentCookie = "";
let bearer = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
const post = (path: string, body: unknown, cookie = c1) => nextRequest(path, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
const get = (path: string, cookie = c1) => nextRequest(path, { headers: { cookie } });
const json = async (res: Response) => (await res.json()) as Record<string, any>;

function seedProject(track: "greenfield" | "brownfield" | null, subTrack: string | null, opts: { caseType?: "greenfield" | "brownfield"; origin?: string } = {}): string {
  const opp = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp, `gx ${ulid()}`, "테스트", "selected", A1, NOW]);
  if (track) {
    db.run("INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [
      ulid(), opp, track, subTrack, "test", A1, NOW,
    ]);
  }
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, source_opportunity_id, track, origin) VALUES (?,?,?,?,?,?)", [
    id, `GX-${id.slice(-8)}`, NOW, opp, track, opts.origin ?? null,
  ]);
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [id, A1, "lead", "root", NOW, "author"]);
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [id, A2, "member", "root", NOW, "review"]);
  db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [ulid(), id, "t", "h", A1, NOW]);
  if (opts.caseType) {
    db.run(
      "INSERT INTO project_case_classification (id, project_id, case_type, origin, classified_by, classified_at, rationale) VALUES (?,?,?,?,?,?,?)",
      [ulid(), id, opts.caseType, opts.origin ?? "internal", A1, NOW, "t"],
    );
  }
  return id;
}

/** Adopted S8 case with capex lines (KRW_M). horizon 2, 100/yr from year 1 -> 200. */
function seedAdoptedCase(projectId: string, annual = 100, horizon = 2, unit: string | null = "KRW_M") {
  const model = ulid();
  db.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)", [model, projectId, "greenfield_cost", "case", horizon, A1, NOW]);
  db.run("INSERT INTO business_case_line (id, model_id, category, name, annual_amount_krw_m, start_year, growth_rate, created_by, created_at, unit) VALUES (?,?,?,?,?,?,?,?,?,?)", [
    ulid(), model, "capex", "plant", annual, 1, 0, A1, NOW, unit,
  ]);
  db.run(
    `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [ulid(), "project", projectId, projectId, "t", "s8_case_adopt", "done", "web", A1, NOW, NOW, JSON.stringify({ model_id: model })],
  );
}

function seedS10(projectId: string) {
  db.run("INSERT INTO deal_structure_hypothesis (id, project_id, vehicle, hypothesized_by, hypothesized_at, rationale) VALUES (?,?,?,?,?,?)", [ulid(), projectId, "direct", A1, NOW, "t"]);
}

/** Minimal complete entries (KPI + hiring + one permit milestone). */
const FULL_ENTRIES = {
  permit_milestones: [{ name: "건축허가", issuer: "시청", target_date: "2027-03-01" }],
  hiring_plan: [{ role_family: "생산", quarter: "2027-Q1", headcount: 12 }],
  kpi_targets: [{ metric_key: "revenue_vs_case", target_value: 100, due: "2028-Q4" }],
};
const ackAll = (findings: Array<{ code: string }>) => findings.map((f) => ({ code: f.code, rationale: `확인: ${f.code}` }));

const tranche = (p: string, no: number, amount: number) =>
  post(`/api/projects/${p}/capex-tranches`, { action: "create", tranche_no: no, amount, release_condition: `cond ${no}` });

beforeAll(async () => {
  for (const [id, pw] of [[A1, "pw-gx-analyst-1"], [A2, "pw-gx-analyst-2"], [AGENT, "pw-agent-1234567"]] as const) {
    await createUser(db, { userId: id, role: "analyst", password: pw, createdBy: "test", now: NOW });
    approveUser(db, { userId: id, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  c1 = await loginCookie(A1, "pw-gx-analyst-1");
  c2 = await loginCookie(A2, "pw-gx-analyst-2");
  agentCookie = await loginCookie(AGENT, "pw-agent-1234567");
  bearer = issueApiToken(db, { userId: A1, label: "agent", scopes: ["read", "write"], now: NOW }).token;
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("(a) execution-baseline human-only + validation + audit", () => {
  test("wiring: HUMAN_ONLY_ROUTES + coverage exclusions", () => {
    expect(isHumanOnly("POST", "/api/projects/X/execution-baseline", {})).toBe(true);
    expect(isHumanOnly("POST", "/api/projects/X/policy-migration", {})).toBe(true);
    expect(isHumanOnly("GET", "/api/projects/X/execution-baseline", {})).toBe(false);
    const ex = readFileSync("scripts/co-newbiz/mcp-coverage.exclusions.yaml", "utf-8");
    expect(ex).toContain('route: "POST /api/projects/{}/execution-baseline"');
    expect(ex).toContain('route: "POST /api/projects/{}/policy-migration"');
  });
  test("bearer and agent session get 403 human_only", async () => {
    const p = seedProject("greenfield", null);
    for (const path of [`/api/projects/${p}/execution-baseline`, `/api/projects/${p}/policy-migration`]) {
      const b = await nextRequest(path, { method: "POST", headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify({ action: "confirm", rationale: "x", migration_note: "x" }) });
      expect(b.status).toBe(403);
      expect((await json(b)).error.code).toBe("human_only");
      const a = await post(path, { action: "confirm", rationale: "x", migration_note: "x" }, agentCookie);
      expect(a.status).toBe(403);
    }
    expect(gx.latestExecutionBaseline(p, db)).toBeNull();
  });
  test("rationale required, bounded; entries validated; audit before/after", async () => {
    const p = seedProject("greenfield", null);
    const path = `/api/projects/${p}/execution-baseline`;
    expect((await post(path, { action: "confirm" })).status).toBe(400);
    expect((await post(path, { action: "confirm", rationale: "   " })).status).toBe(400);
    expect((await post(path, { action: "confirm", rationale: "x".repeat(gx.MAX_RATIONALE_LEN + 1) })).status).toBe(400);
    expect((await post(path, { action: "nope" })).status).toBe(400);
    // entries validation
    const bad = [
      { permit_milestones: [{ name: "건축허가", issuer: "시청", target_date: "2027-13-40" }] },
      { hiring_plan: [{ role_family: "생산", quarter: "2027-Q1", headcount: 5, name: "홍길동" }] },
      { hiring_plan: [{ role_family: "생산", quarter: "2027Q1", headcount: 5 }] },
      { kpi_targets: [{ metric_key: "Revenue!", target_value: 1, due: "2027-Q1" }] },
      { kpi_targets: [{ metric_key: "revenue_vs_case", target_value: "1", due: "2027-Q1" }] },
      { incentive_obligations: [{ obligation: "x".repeat(gx.ENTRY_LIMITS.text + 1) }] },
      { unknown_key: [] },
      { permit_milestones: Array.from({ length: gx.ENTRY_LIMITS.list + 1 }, () => ({ name: "a", issuer: "b", target_date: "2027-01-01" })) },
    ];
    for (const entries of bad) expect((await post(path, { action: "record_entries", entries })).status).toBe(400);
    const entries = {
      permit_milestones: [{ name: "건축허가", issuer: "시청", target_date: "2027-03-01", gates_ref: "tranche 1" }],
      certification_milestones: [{ name: "ISO 9001", issuer: "인증기관", target_date: "2027-09-01" }],
      hiring_plan: [{ role_family: "생산", quarter: "2027-Q1", headcount: 12 }],
      kpi_targets: [{ metric_key: "goal:revenue", target_value: 100, unit: "KRW_M", due: "2028-Q4" }],
      incentive_obligations: [{ obligation: "고용 50명 유지", deadline: "2029-12-31", depends_on: "tranche 2" }],
    };
    const r = await post(path, { action: "record_entries", entries });
    expect(r.status).toBe(201);
    expect((await json(r)).data.record.entries.hiring_plan[0]).toEqual({ role_family: "생산", quarter: "2027-Q1", headcount: 12 });
    // R3: only the project lead confirms.
    const nonLead = await post(path, { action: "confirm", rationale: "x" }, c2);
    expect(nonLead.status).toBe(403);
    expect((await json(nonLead)).error.code).toBe("lead_required");
    // R3: open findings must each be acknowledged.
    const open = await post(path, { action: "confirm", rationale: "IC 승인 조건과 일치 확인" });
    expect(open.status).toBe(409);
    const ob = await json(open);
    expect(ob.error.code).toBe("findings_open");
    const openFindings = ob.meta.open_findings as Array<{ code: string }>;
    expect(openFindings.map((f) => f.code)).toEqual(expect.arrayContaining(["no_tranches", "no_adopted_case", "s10_structure_missing"]));
    const partial = await post(path, { action: "confirm", rationale: "x", acknowledged_findings: ackAll(openFindings).slice(1) });
    expect((await json(partial)).error.code).toBe("findings_open");
    const badAck = await post(path, { action: "confirm", rationale: "x", acknowledged_findings: [{ code: "no_tranches", rationale: "x".repeat(501) }] });
    expect(badAck.status).toBe(400);
    const c = await post(path, { action: "confirm", rationale: "IC 승인 조건과 일치 확인 — 갭은 다음 분기 해소 ".repeat(5), acknowledged_findings: ackAll(openFindings) });
    expect(c.status).toBe(201);
    const body = (await json(c)).data;
    expect(body.record.confirmation.confirmed_by).toBe(A1);
    expect(body.record.confirmation.entries_recorded_by).toBe(A1);
    expect(body.record.confirmation.acknowledged_findings.length).toBe(openFindings.length);
    expect(body.record.entries.permit_milestones.length).toBe(1); // entries carried into the confirmation snapshot
    expect(body.open_findings.map((f: { code: string }) => f.code)).toEqual(expect.arrayContaining(["no_tranches", "no_adopted_case", "s10_structure_missing"]));
    const audits = db.query("SELECT action, actor_user_id, target FROM audit_log WHERE target LIKE ? ORDER BY created_at, id").all(`${p}:%`) as Array<{ action: string; actor_user_id: string; target: string }>;
    expect(audits.map((a) => a.action)).toEqual(["execution_baseline.entries_recorded", "execution_baseline.confirmed"]);
    expect(audits[1].target).toContain('"before"');
    expect(audits[1].target).toContain('"confirmed_by"');
    expect(audits[1].target).toContain('"recorded_by"');
    // R10: the audit target holds hashes + a <=120-char summary, never the full rationale / ack text.
    const detail = JSON.parse(audits[1].target.slice(audits[1].target.indexOf("|") + 1));
    expect(detail.rationale.length).toBeLessThanOrEqual(gx.AUDIT_SUMMARY_LEN);
    expect(detail.rationale_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(audits[1].target).not.toContain("확인: no_tranches");
    // New entries supersede the confirmation (re-confirmation required).
    await post(path, { action: "record_entries", entries: {} });
    expect(gx.latestExecutionBaseline(p, db)?.confirmation).toBeNull();
    // R4: a confirmation exists -> reconfirm_required (warning when S11 is otherwise complete, blocking otherwise).
    expect(gx.executionBaselineS11Check(p, { otherCriteriaMet: true }, db)).toMatchObject({ requirement: "reconfirm_required", blocks: false });
    expect(gx.executionBaselineS11Check(p, { otherCriteriaMet: false }, db)).toMatchObject({ requirement: "reconfirm_required", blocks: true });
  });
  test("R3: empty required sections -> 409 baseline_empty", async () => {
    const p = seedProject("greenfield", null);
    const path = `/api/projects/${p}/execution-baseline`;
    const r = await post(path, { action: "confirm", rationale: "x" });
    expect(r.status).toBe(409);
    const b = await json(r);
    expect(b.error.code).toBe("baseline_empty");
    expect(b.meta.missing_sections).toEqual(["kpi_targets", "hiring_plan", "permit_or_certification_milestones"]);
    // intra_venture: step 2 does not apply, so milestones are not required.
    const iv = seedProject("greenfield", "intra_venture");
    await post(`/api/projects/${iv}/execution-baseline`, { action: "record_entries", entries: { hiring_plan: FULL_ENTRIES.hiring_plan, kpi_targets: FULL_ENTRIES.kpi_targets } });
    const r2 = await post(`/api/projects/${iv}/execution-baseline`, { action: "confirm", rationale: "x" });
    expect((await json(r2)).error.code).toBe("findings_open");
  });
  test("brownfield refused 403 not_applicable_track; unresolved track 409 needs_classification", async () => {
    const b = seedProject("brownfield", "m_and_a");
    const rb = await post(`/api/projects/${b}/execution-baseline`, { action: "confirm", rationale: "x" });
    expect(rb.status).toBe(403);
    expect((await json(rb)).error.code).toBe("not_applicable_track");
    const u = seedProject(null, null);
    const ru = await post(`/api/projects/${u}/execution-baseline`, { action: "confirm", rationale: "x" });
    expect(ru.status).toBe(409);
    expect((await json(ru)).error.code).toBe("needs_classification");
    const g = await json(await get(`/api/projects/${u}/execution-baseline`));
    expect(g.data.applicability.state).toBe("needs_classification");
    expect(g.data.blocks).toBe(false);
    expect(g.data.warning).toBeTruthy();
  });
  test("MNPI project: non-insider refused", async () => {
    const p = seedProject("greenfield", null);
    db.run("INSERT INTO project_classification (project_id, sensitivity, mnpi_flag, classified_by, classified_at) VALUES (?,?,?,?,?)", [p, "restricted", 1, A1, NOW]);
    const r = await post(`/api/projects/${p}/execution-baseline`, { action: "confirm", rationale: "x" });
    expect(r.status).toBe(403);
    expect((await json(r)).error.code).toBe("insider_required");
    // R9: the three new GETs check insider status too.
    for (const sub of ["execution-baseline", "policy-migration", "post-management"]) {
      const g = await get(`/api/projects/${p}/${sub}`);
      expect(g.status).toBe(403);
      expect((await json(g)).error.code).toBe("insider_required");
    }
  });
});

describe("(b) tranche reconciliation (O2 exact match) + release unaffected", () => {
  test("exact match: no difference finding; any difference is a finding; retired excluded", async () => {
    const p = seedProject("greenfield", null);
    seedAdoptedCase(p, 100, 2); // 200 KRW_M
    seedS10(p);
    await tranche(p, 1, 120);
    const t2 = (await json(await tranche(p, 2, 80))).data.tranche;
    let rec = gx.trancheReconciliation(p, db);
    expect(rec.case.capex_total_krw_m).toBe(200);
    expect(rec.tranche_total).toBe(200);
    expect(rec.matches).toBe(true);
    expect(rec.findings).toEqual([]);
    // Difference of 0.5 million — still a finding, no tolerance.
    await post(`/api/projects/${p}/capex-tranches`, { action: "update", tranche_id: t2.id, amount: 80.5 });
    rec = gx.trancheReconciliation(p, db);
    expect(rec.matches).toBe(false);
    expect(rec.difference).toBe(0.5);
    expect(rec.findings.map((f) => f.code)).toContain("tranche_total_differs");
    // R5: withheld rows are listed but excluded from the sum.
    await post(`/api/projects/${p}/capex-tranches`, { action: "set_status", tranche_id: t2.id, status: "withheld", reason: "보류" });
    rec = gx.trancheReconciliation(p, db);
    expect(rec.tranche_total).toBe(120);
    expect(rec.tranches.length).toBe(2);
    // Retired rows are excluded entirely.
    await post(`/api/projects/${p}/capex-tranches`, { action: "retire", tranche_id: t2.id, reason: "재설계" });
    rec = gx.trancheReconciliation(p, db);
    expect(rec.tranche_total).toBe(120);
    expect(rec.tranches.length).toBe(1);
  });
  test("R5: a capex line with a null unit is a finding (not assumed KRW_M)", async () => {
    const p = seedProject("greenfield", null);
    seedAdoptedCase(p, 100, 1, null);
    seedS10(p);
    await tranche(p, 1, 100);
    const rec = gx.trancheReconciliation(p, db);
    expect(rec.case.capex_total_krw_m).toBeNull();
    expect(rec.matches).toBe(false);
    expect(rec.findings.map((f) => f.code)).toContain("case_unit_not_comparable");
  });
  test("non-KRW currency is not converted; reported as a finding", async () => {
    const p = seedProject("greenfield", null);
    seedAdoptedCase(p, 100, 1);
    seedS10(p);
    await post(`/api/projects/${p}/capex-tranches`, { action: "create", tranche_no: 1, amount: 100, currency: "USD", release_condition: "x" });
    const rec = gx.trancheReconciliation(p, db);
    expect(rec.matches).toBe(false);
    expect(rec.difference).toBeNull();
    expect(rec.findings.map((f) => f.code)).toContain("tranche_currency_not_comparable");
  });
  test("confirm never writes capex_tranche; the two-person release still works; status shows drift after release", async () => {
    const p = seedProject("greenfield", null);
    seedAdoptedCase(p, 50, 1);
    seedS10(p);
    const t = (await json(await tranche(p, 1, 50))).data.tranche;
    const before = JSON.stringify(db.query("SELECT * FROM capex_tranche WHERE project_id = ?").all(p));
    expect((await post(`/api/projects/${p}/execution-baseline`, { action: "record_entries", entries: FULL_ENTRIES })).status).toBe(201);
    expect((await post(`/api/projects/${p}/execution-baseline`, { action: "confirm", rationale: "정합 확인" })).status).toBe(201);
    expect(gx.executionBaselineRequirement(p, { otherCriteriaMet: true }, db)).toBe("satisfied");
    expect(JSON.stringify(db.query("SELECT * FROM capex_tranche WHERE project_id = ?").all(p))).toBe(before);
    const path = `/api/projects/${p}/capex-tranches`;
    expect((await json(await post(path, { action: "set_status", tranche_id: t.id, status: "released", reason: "조건 충족" }))).data.release_pending).toBe(true);
    const rel = await post(path, { action: "set_status", tranche_id: t.id, status: "released", reason: "승인" }, c2);
    expect((await json(rel)).data.tranche.status).toBe("released");
    const st = (await json(await get(`/api/projects/${p}/execution-baseline`))).data;
    // R3: a tranche change after confirmation -> reconfirm_required (non-blocking once S11 is otherwise complete).
    expect(st.requirement).toBe("reconfirm_required");
    expect(st.blocks).toBe(false);
    expect(st.findings.map((f: { code: string }) => f.code)).toContain("tranches_changed_since_confirmation");
    expect(gx.executionBaselineS11Check(p, { otherCriteriaMet: false }, db).blocks).toBe(true);
  });
});

describe("(c) PMI guards", () => {
  test("pmiKickoffApplies truth table unchanged", () => {
    expect(pmiKickoffApplies("brownfield", "m_and_a")).toBe(true);
    expect(pmiKickoffApplies("brownfield", null)).toBe(true);
    expect(pmiKickoffApplies("brownfield", "partnership")).toBe(false);
    expect(pmiKickoffApplies("greenfield", null)).toBe(false);
    expect(pmiKickoffApplies(null, null)).toBe(false);
  });
  test("greenfield / non-PMI sub-track writes 403; m_and_a unchanged", async () => {
    const g = seedProject("greenfield", null);
    const part = seedProject("brownfield", "partnership");
    for (const p of [g, part]) {
      for (const [path, body] of [
        [`/api/projects/${p}/pmi/synergy-certifications`, { run_rate_bp: 10, sustained_quarters: 2 }],
        [`/api/projects/${p}/pmi/key-talent`, { role_ref: "E-T1-001" }],
        [`/api/projects/${p}/pmi/kickoff`, { owner: "x", plan_note: "통합 계획 기준선 이십자 이상입니다" }],
      ] as const) {
        const r = await post(path, body);
        expect(r.status).toBe(403);
        expect((await json(r)).error.code).toBe("not_applicable_track");
      }
      expect((await get(`/api/projects/${p}/pmi/key-talent`)).status).toBe(200); // reads stay available (design §8.2.4)
    }
    const m = seedProject("brownfield", "m_and_a");
    const s = await post(`/api/projects/${m}/pmi/synergy-certifications`, { run_rate_bp: 10, sustained_quarters: 2 });
    expect(s.status).toBe(201);
    const kt = await post(`/api/projects/${m}/pmi/key-talent`, { role_ref: "E-T1-001" });
    expect(kt.status).toBe(201);
    const ktId = (await json(kt)).data.id;
    expect((await nextRequest(`/api/projects/${m}/pmi/key-talent/${ktId}`, { method: "PUT", headers: { cookie: c1 }, body: JSON.stringify({ role_ref: "E-T1-002" }) })).status).toBe(200);
    expect((await post(`/api/projects/${m}/pmi/kickoff`, { owner: "PMO", plan_note: "통합 계획 기준선 — 100일 계획과 시너지 추적" })).status).toBe(201);
  });
  test("key-talent status validated against DB CHECK values (legacy retained/exited -> 400, not 500)", async () => {
    const m = seedProject("brownfield", "m_and_a");
    for (const bad of ["retained", "exited"]) {
      const r = await post(`/api/projects/${m}/pmi/key-talent`, { role_ref: "E-T9-001", status: bad });
      expect(r.status).toBe(400);
      expect((await json(r)).error.code).toBe("invalid_request");
    }
    const ktId = (await json(await post(`/api/projects/${m}/pmi/key-talent`, { role_ref: "E-T9-001" }))).data.id;
    const put = (status: string) => nextRequest(`/api/projects/${m}/pmi/key-talent/${ktId}`, { method: "PUT", headers: { cookie: c1 }, body: JSON.stringify({ status }) });
    for (const bad of ["retained", "exited"]) {
      const r = await put(bad);
      expect(r.status).toBe(400);
      expect((await json(r)).error.code).toBe("invalid_request");
    }
    const r1 = await put("departed_regretted");
    expect(r1.status).toBe(200);
    const d1 = (await json(r1)).data;
    expect(d1.status).toBe("departed_regretted");
    expect(d1.exit_date).toBeTruthy();
    expect((await put("departed_planned")).status).toBe(200);
    expect((await json(await put("active"))).data.status).toBe("active");
    const created = await post(`/api/projects/${m}/pmi/key-talent`, { role_ref: "E-T9-002", status: "departed_planned" });
    expect(created.status).toBe(201);
    expect((await json(created)).data.exit_date).toBeTruthy();
  });
  test("stage tabs: PMI tab hidden when not applicable; m_and_a groups identical", () => {
    expect(stageTabGroupsFor({ pmiApplies: true })).toBe(STAGE_TAB_GROUPS);
    const hidden = stageTabGroupsFor({ pmiApplies: false });
    const s12 = hidden.find((g) => g.stage === "S12")!;
    expect([...s12.tabs, ...s12.more].some((t) => t.seg === "/pmi")).toBe(false);
    expect(s12.tabs.map((t) => t.seg)).toEqual(["/portfolio", "/charter"]);
    expect(hidden.filter((g) => g.stage !== "S12")).toEqual(STAGE_TAB_GROUPS.filter((g) => g.stage !== "S12"));
  });
});

describe("(d) venture_class defaults (Q7) and S12 applicability", () => {
  test("defaults per sub-track; non-greenfield none", () => {
    expect(gx.defaultVentureClass("greenfield", null)).toBe("driving");
    expect(gx.defaultVentureClass("greenfield", "none")).toBe("driving");
    expect(gx.defaultVentureClass("greenfield", "existing_business_rbd")).toBe("enabling");
    expect(gx.defaultVentureClass("greenfield", "intra_venture")).toBe("emergent");
    expect(gx.defaultVentureClass("brownfield", "m_and_a")).toBeNull();
  });
  test("recording prefills the default; an override is audited", () => {
    const p = seedProject("greenfield", "existing_business_rbd");
    const runId = (db.query("SELECT id FROM run WHERE project_id = ?").get(p) as { id: string }).id;
    const row = (k: string, vc?: "driving" | "enabling" | "emergent") => ({
      section: "strategic" as const, measure_key: k, target_value: "1", actual_value: "1", status: "on_target" as const, evidence_ref: "doc:gx-scorecard", observed_at: NOW, ...(vc ? { venture_class: vc } : {}),
    });
    const r1 = gx.recordGreenfieldScorecardCycle({ projectId: p, runId, reviewCycle: "2026-Q3", actor: A1, now: NOW, rows: [row("utilisation_pct")] } as never, db);
    expect(r1.default_venture_class).toBe("enabling");
    expect(r1.overrides).toEqual([]);
    expect((db.query("SELECT venture_class FROM venture_scorecard WHERE project_id = ?").get(p) as { venture_class: string }).venture_class).toBe("enabling");
    const r2 = gx.recordGreenfieldScorecardCycle({ projectId: p, runId, reviewCycle: "2026-Q4", actor: A1, now: NOW, rows: [row("headcount_vs_plan", "driving")] } as never, db);
    expect(r2.overrides).toEqual(["driving"]);
    const a = db.query("SELECT target FROM audit_log WHERE action = 'venture_scorecard.venture_class_override' AND target LIKE ?").get(`${p}:%`) as { target: string };
    expect(a.target).toContain('"before":"enabling"');
  });
  test("S12 applicability: greenfield with null origin gets portfolio monitoring; brownfield cells; never blocking", () => {
    const g = seedProject("greenfield", null);
    expect(gx.postManagementApplicability(g, db)).toMatchObject({ portfolio_venture_monitoring: true, integration_monitoring: false, partnership_monitoring: false, pmi_applies: false, blocking: false });
    expect(gx.postManagementApplicability(seedProject("brownfield", "m_and_a"), db)).toMatchObject({ integration_monitoring: true, partnership_monitoring: false, pmi_applies: true });
    expect(gx.postManagementApplicability(seedProject("brownfield", "strategic_investment"), db)).toMatchObject({ integration_monitoring: true });
    expect(gx.postManagementApplicability(seedProject("brownfield", "partnership"), db)).toMatchObject({ integration_monitoring: false, partnership_monitoring: true, pmi_applies: false });
    expect(gx.postManagementApplicability(seedProject("brownfield", "jv"), db)).toMatchObject({ integration_monitoring: false, pmi_applies: true });
  });
  test("post-management GET: ramp-up view resolves goals as reference only (not judged)", async () => {
    const p = seedProject("greenfield", null);
    db.run(
      "INSERT INTO project_business_goal (id, project_id, metric_key, direction, target_value, rationale, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), p, "revenue", "gte", 100, "t", A1, NOW],
    );
    const d = (await json(await get(`/api/projects/${p}/post-management`))).data;
    expect(d.greenfield_ramp_up.gate_blocking).toBe(false);
    expect(d.greenfield_ramp_up.default_venture_class).toBe("driving");
    expect(d.greenfield_ramp_up.goals[0]).toMatchObject({ metric_key: "revenue", judgement: "not_judged", reference_only: true });
    expect(d.integration_monitoring).toBeNull();
  });
});

describe("(e) retroactive rule + fail-closed", () => {
  function seedIcGo(projectId: string, at: string) {
    for (const gate of ["entity_ic", "group_ic"]) {
      db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "project", projectId, gate, "go", "t", A1, at]);
    }
  }
  test("R1: IC GO dates are NOT evidence — DSE4PW-like fixture (GOs 2026-09-04, S11 not complete) is blocking at S11", () => {
    const dse = seedProject("greenfield", "existing_business_rbd", { caseType: "greenfield" });
    db.run("UPDATE md_project SET project_no = ? WHERE id = ?", [`PRJ-DSE4PW-${dse.slice(-4)}`, dse]);
    seedIcGo(dse, "2026-09-04T00:00:00.000Z");
    expect(gx.executionBaselineS11Check(dse, { otherCriteriaMet: true }, db)).toMatchObject({ requirement: "blocking", blocks: true });
    expect(gx.executionBaselineRequirement(dse, { otherCriteriaMet: false }, db)).toBe("blocking");
    expect(gx.s11CompletedBeforeRule(dse, db)).toBe(false);
    expect(gx.executionBaselineRequirement(seedProject("brownfield", "m_and_a"), { otherCriteriaMet: true }, db)).toBe("not_applicable");
  });
  test("R1/R4: only a migration snapshot listing S11 exempts (recommended); a snapshot without S11 does not", () => {
    const p = seedProject("greenfield", null);
    seedIcGo(p, "2026-10-20T00:00:00.000Z");
    expect(gx.recordPolicyMigration({ projectId: p, migrationNote: "ADR-0161 소급 적용", completedStages: ["S8", "S9", "S10", "S11"], actor: A1 }, db).ok).toBe(true);
    expect(gx.executionBaselineRequirement(p, { otherCriteriaMet: true }, db)).toBe("recommended");
    const q = seedProject("greenfield", null);
    expect(gx.recordPolicyMigration({ projectId: q, migrationNote: "S10에서 이행", completedStages: ["S8", "S9", "S10"], actor: A1 }, db).ok).toBe(true);
    expect(gx.executionBaselineRequirement(q, { otherCriteriaMet: true }, db)).toBe("blocking");
  });
  test("R2: case_type vs route CONFLICT blocks S11 with explicit text; no signal never blocks", () => {
    const conflict = seedProject("brownfield", null, { caseType: "greenfield" });
    const c = gx.executionBaselineS11Check(conflict, { otherCriteriaMet: true }, db);
    expect(c).toMatchObject({ requirement: "classification_conflict", blocks: true });
    expect(c.blocker).toContain("트랙 분류 충돌");
    const none = seedProject(null, null);
    expect(gx.executionBaselineS11Check(none, { otherCriteriaMet: true }, db)).toMatchObject({ requirement: "needs_classification", blocks: false });
    // PMI uses the same resolver: a conflicting track never applies PMI.
    expect(pmiApplicability(db, conflict).applies).toBe(false);
  });
  test("brownfield / m_and_a process output has no ADR-0161 item (byte-identical blockers)", () => {
    const g = seedProject("greenfield", null);
    expect(evaluateProcess({ type: "project", id: g }).currentStage).toBe("S8");
    for (const b of [seedProject("brownfield", "m_and_a"), seedProject("brownfield", null), seedProject(null, null)]) {
      const ev = evaluateProcess({ type: "project", id: b });
      expect(JSON.stringify(ev.blockers)).not.toContain("실행 기준선");
      expect(JSON.stringify(ev.blockers)).not.toContain("트랙 분류");
    }
  });
  test("fail-closed: unassessed case_type and no route -> needs_classification; conflict too; case_type alone resolves", () => {
    expect(gx.executionBaselineScope(seedProject(null, null), db).state).toBe("needs_classification");
    expect(gx.executionBaselineScope(seedProject("brownfield", null, { caseType: "greenfield" }), db).state).toBe("needs_classification");
    expect(gx.executionBaselineScope(seedProject(null, null, { caseType: "greenfield" }), db).state).toBe("applies");
    // origin never identifies greenfield (Q5)
    expect(gx.executionBaselineScope(seedProject("brownfield", "m_and_a", { origin: "internal" }), db).state).toBe("not_applicable");
  });
});

describe("(f) policy migration entry + in-flight counts", () => {
  test("lead only, migration_note required, one entry, no pin change", async () => {
    const p = seedProject("greenfield", "existing_business_rbd");
    const path = `/api/projects/${p}/policy-migration`;
    const pinsBefore = (db.query("SELECT COUNT(*) c FROM project_policy_pin").get() as { c: number }).c;
    expect((await post(path, { migration_note: "x" }, c2)).status).toBe(403); // member, not lead
    expect((await post(path, {})).status).toBe(400);
    expect((await post(path, { migration_note: "x".repeat(gx.MAX_MIGRATION_NOTE_LEN + 1) })).status).toBe(400);
    const r = await post(path, { migration_note: "ADR-0161 소급 적용 — 프로세스 책임자 기록" });
    expect(r.status).toBe(201);
    const d = (await json(r)).data;
    expect(d.applies).toMatchObject({ track: "greenfield", greenfield_execution_baseline: "applies", portfolio_venture_monitoring: true, pmi_tab: false });
    expect(d.entry.migration_note).toBe("ADR-0161 소급 적용 — 프로세스 책임자 기록");
    expect(d.entry.migration_note_hash).toMatch(/^[0-9a-f]{16}$/);
    expect((await post(path, { migration_note: "again" })).status).toBe(409);
    const row = db.query("SELECT target FROM audit_log WHERE action = 'policy_migration' AND target LIKE ?").get(`${p}|%`) as { target: string };
    expect(JSON.parse(row.target.slice(p.length + 1))).toMatchObject({ adr: "ADR-0161", from_spec: "2.7.0", to_spec: "2.8.0" });
    expect((db.query("SELECT COUNT(*) c FROM project_policy_pin").get() as { c: number }).c).toBe(pinsBefore);
    const g = (await json(await get(path))).data;
    expect(g.entry.actor).toBe(A1);
  });
  test("in-flight counts: read-only, counts per applicability", () => {
    const before = db.query("SELECT COUNT(*) c FROM audit_log").get() as { c: number };
    const c = gx.inFlightAdr0161Counts(db);
    expect(c.total).toBe((db.query("SELECT COUNT(*) c FROM md_project WHERE status = 'open' AND deleted_at IS NULL").get() as { c: number }).c);
    expect(c.greenfield_execution_baseline).toBeGreaterThan(0);
    expect(c.integration_monitoring).toBeGreaterThan(0);
    expect(c.partnership_monitoring).toBeGreaterThan(0);
    expect(c.needs_classification).toBeGreaterThan(0);
    expect(c.migrated).toBeGreaterThanOrEqual(2);
    expect(Object.values(c.by_track).reduce((a, b) => a + b, 0)).toBe(c.total);
    expect(JSON.stringify(c.projects)).not.toContain("amount");
    expect((db.query("SELECT COUNT(*) c FROM audit_log").get() as { c: number }).c).toBe(before.c);
  });
});
