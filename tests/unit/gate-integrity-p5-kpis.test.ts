// @version 1.0.0
/**
 * ADR-0186 P5-c: gate-integrity KPI API (G1-G12) on a seeded scratch DB, the admin-only route, and the graceful
 * degradation (status migration_pending) of the KPI API and the shadow report on a DB migrated only to 0172.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync, mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-gate-integrity-p5-kpis.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
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
const { buildGateIntegrityKpis, businessDays } = await import("../../app/web-next/lib/gate-integrity-kpis.ts");
const { buildShadowReport, renderHuman } = await import("../../scripts/co-newbiz/gate-integrity-shadow-report.ts");
const { recordGateDecisionRow } = await import("../../app/web-next/lib/gate-decision-contract.ts");
const { countersignDecision } = await import("../../app/web-next/lib/gate-countersign.ts");
const { appendAudit } = await import("../../db/lib/access-control.ts");
const S = await import("./_gate-integrity-support.ts");

const ADMIN = "k-admin";
const MAKER = "k-maker";
const CHECKER = "k-checker";
const cookies: Record<string, string> = {};
const W = { from: "2026-09-07T00:00:00.000Z", to: "2026-09-14T00:00:00.000Z", now: "2026-10-27T09:00:00.000Z" };
const at = (d: string) => `${d}T10:00:00.000Z`;

async function login(userId: string, role: "analyst" | "admin"): Promise<string> {
  await createUser(db, { userId, role, password: `pw-${userId}-123456`, createdBy: "test", now: S.NOW });
  approveUser(db, { userId, approvedBy: "test", now: S.NOW });
  db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = ?", [userId]);
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password: `pw-${userId}-123456` }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
beforeAll(async () => {
  for (const [u, r] of [[ADMIN, "admin"], [MAKER, "analyst"], [CHECKER, "analyst"]] as const) cookies[u] = await login(u, r);
  await S.grantRole(db, CHECKER, "entity-ic-reviewer", ADMIN);
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

/** A decision row with optional snapshot / AI recommendation / divergence reason at a chosen time. */
function decide(o: { entity?: string; entityType?: "opportunity" | "project"; gate: string; decision: "go" | "hold" | "kill"; when: string; ai?: string | null; reason?: string | null; snapshot?: Record<string, unknown>; acks?: unknown[] }): string {
  const id = ulid();
  db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at, ai_recommended_decision, divergence_reason) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, o.entityType ?? "opportunity", o.entity ?? `e-${id}`, o.gate, o.decision, "seed", MAKER, o.when, o.ai ?? null, o.reason ?? null]);
  if (o.snapshot || o.acks) {
    db.run("INSERT INTO gate_decision_snapshot (decision_id, schema_version, snapshot_json, snapshot_hash, acknowledgements_json, computed_at, engine_versions_json) VALUES (?,?,?,?,?,?,?)",
      [id, 1, JSON.stringify(o.snapshot ?? {}), "h", JSON.stringify(o.acks ?? []), o.when, "{}"]);
  }
  return id;
}
const kpi = (id: string, extra: Record<string, unknown> = {}) => buildGateIntegrityKpis(db, { ...W, ...extra }).kpis.find((k) => k.id === id)!;

describe("KPI response contract", () => {
  test("families: every rule family carries its server-resolved mode and a readiness verdict, aggregate only", () => {
    const r = buildGateIntegrityKpis(db, { ...W, env: { CO_NEWBIZ_GATE_INTEGRITY_WAIVER: "enforce", CO_NEWBIZ_GATE_INTEGRITY_LADDER: "shadow" } });
    expect(r.families.map((f) => f.family).sort()).toEqual(["divergence", "kill_binding", "ladder", "maker_checker", "rationale", "snapshot_ack", "validators", "waiver", "wacc"].sort());
    expect(r.families.find((f) => f.family === "waiver")?.mode).toBe("enforce");
    expect(r.families.find((f) => f.family === "waiver")?.verdict.state).toBe("enforcing");
    expect(r.families.find((f) => f.family === "ladder")?.mode).toBe("shadow");
    expect(r.families.find((f) => f.family === "rationale")?.mode).toBe("off");
    // only counts, modes and verdict codes: no free text, no ids
    for (const f of r.families) expect(Object.keys(f).sort()).toEqual(["clean_days", "decisions", "family", "mode", "verdict", "would_blocks_14d"]);
    // structured breach params are numbers, or short gate / role codes - never reason text or project ids
    for (const k of r.kpis) for (const i of k.breach.items) for (const v of Object.values(i.params)) expect(typeof v === "number" || /^[a-z_-]+$/.test(String(v))).toBe(true);
  });

  test("twelve KPIs in order, each with period / value / numerator / denominator / rate / breach / status", () => {
    const r = buildGateIntegrityKpis(db, W);
    expect(r.kpis.map((k) => k.id)).toEqual(["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"]);
    for (const k of r.kpis) {
      expect(k.status).toBe("ok");
      expect(k.period).toEqual({ from: W.from, to: W.to });
      expect(typeof k.breach.breached).toBe("boolean");
      expect(Array.isArray(k.breach.reasons)).toBe(true);
      expect("numerator" in k && "denominator" in k && "rate" in k && "li" in k).toBe(true);
    }
    expect(r.kpis.filter((k) => k.li).map((k) => k.id)).toEqual(["G3", "G5", "G6", "G10", "G11", "G12"]);
  });
});

describe("G1-G5 (decision based)", () => {
  test("G1: mix per gate with legacy split; GO share over 95% on 10+ decisions breaches; the gate filter scopes it", () => {
    for (let i = 0; i < 11; i += 1) decide({ gate: "screening", decision: "go", when: at("2026-09-08") });
    decide({ gate: "pre_fs", decision: "go", when: at("2026-09-08") });
    decide({ gate: "pre_fs", decision: "hold", when: at("2026-09-08") });
    const k = kpi("G1");
    const v = k.value as any;
    expect(v.by_gate.screening).toMatchObject({ go: 11, total: 11, legacy: 11, go_share: 1 });
    expect(v.by_gate.pre_fs).toMatchObject({ go: 1, hold: 1, total: 2 });
    expect(k.breach.breached).toBe(true);
    expect(k.breach.reasons.join(" ")).toContain("screening");
    expect(kpi("G1", { gate: "pre_fs" }).breach.breached).toBe(false);
  });
  test("G1: a mix shift of more than 30 points against the prior 4 weeks breaches", () => {
    for (let i = 0; i < 4; i += 1) decide({ gate: "target_screening", decision: "hold", when: at("2026-08-20") });
    decide({ gate: "target_screening", decision: "go", when: at("2026-08-20") });
    for (let i = 0; i < 3; i += 1) decide({ gate: "target_screening", decision: "go", when: at("2026-09-09") });
    decide({ gate: "target_screening", decision: "hold", when: at("2026-09-09") });
    const k = kpi("G1", { gate: "target_screening" });
    expect(k.breach.reasons.join(" ")).toContain("points versus the prior 4 weeks");
  });
  test("G2: divergence = ai differs / with recommendation; 0% over 10 decisions and above 40% breach", () => {
    for (let i = 0; i < 10; i += 1) decide({ gate: "dd", decision: "go", ai: "go", when: at("2026-09-09") });
    const zero = kpi("G2", { gate: "dd" });
    expect(zero).toMatchObject({ numerator: 0, denominator: 10, rate: 0 });
    expect(zero.breach.breached).toBe(true);
    for (let i = 0; i < 6; i += 1) decide({ gate: "entity_ic", decision: "go", ai: i < 5 ? "hold" : "go", when: at("2026-09-09") });
    const hi = kpi("G2", { gate: "entity_ic" });
    expect(hi).toMatchObject({ numerator: 5, denominator: 6 });
    expect(hi.breach.breached).toBe(false); // fewer than 10 decisions
  });
  test("G3: divergent GO decisions with a passing reason / divergent GO; shortfall and would-block events breach", () => {
    decide({ gate: "fs", decision: "go", ai: "hold", reason: "허용 가능한 위험이며 확정된 할인율 기준으로 수익성이 허들을 넘음", when: at("2026-09-09") });
    decide({ gate: "fs", decision: "go", ai: "hold", reason: "ok", when: at("2026-09-09") });
    decide({ gate: "fs", decision: "hold", ai: "go", reason: null, when: at("2026-09-09") }); // HOLD: not counted
    const k = kpi("G3", { gate: "fs" });
    expect(k).toMatchObject({ numerator: 1, denominator: 2, rate: 0.5 });
    expect((k.value as any).shortfall).toBe(1);
    expect(k.breach.breached).toBe(true);
    appendAudit(db, { actor: MAKER, action: "gate_integrity.would_block:divergence_reason_required", target: "project:P:fs", now: at("2026-09-09") });
    expect((kpi("G3", { gate: "fs" }).value as any).would_block_divergence_reason_required).toBe(1);
  });
  test("G4: acknowledgements per gate and kind; a reason reused across more than 5 decisions breaches", () => {
    for (let i = 0; i < 6; i += 1) decide({ gate: "group_ic", decision: "go", when: at("2026-09-10"), snapshot: {}, acks: [{ key: `k${i}`, kind: "kill_unassessed", reason: "같은 사유 문장을 반복해서 사용함" }, { key: `r${i}`, kind: "rag_red", reason: `서로 다른 사유 ${i}번 검토 기록` }] });
    const k = kpi("G4", { gate: "group_ic" });
    expect((k.value as any).by_gate_and_kind.group_ic).toEqual({ kill_unassessed: 6, rag_red: 6 });
    expect(k.denominator).toBe(12);
    expect(k.breach.reasons.join(" ")).toContain("reused across more than 5 decisions");
  });
  test("G5: unassessed / evaluated criteria in GO snapshots per gate; above 25% breaches", () => {
    decide({ gate: "fs", decision: "go", when: at("2026-09-11"), snapshot: { kill: { evaluated: 4, unassessed: [{}, {}] } } });
    decide({ gate: "fs", decision: "kill", when: at("2026-09-11"), snapshot: { kill: { evaluated: 10, unassessed: [{}, {}, {}] } } }); // not a GO
    const k = kpi("G5", { gate: "fs" });
    expect(k).toMatchObject({ numerator: 2, denominator: 4, rate: 0.5 });
    expect((k.value as any).by_gate.fs.share).toBe(0.5);
    expect(k.breach.breached).toBe(true);
  });
});

describe("G6-G12 (state based)", () => {
  test("G6 / G12: would-block events per family, code and week; the streak resets on an event and needs the write volume", () => {
    appendAudit(db, { actor: MAKER, action: "gate_integrity.would_block:ack_required", target: "project:PRJ-1:dd", now: at("2026-09-08") });
    appendAudit(db, { actor: MAKER, action: "gate_integrity.would_block:ack_required", target: "project:PRJ-2:dd", now: at("2026-09-09") });
    appendAudit(db, { actor: MAKER, action: "gate_integrity.would_block:wacc_unconfirmed", target: "project:PRJ-1:fs", now: at("2026-09-16") });
    const g6 = kpi("G6");
    expect((g6.value as any).by_family_code_week.snapshot_ack.ack_required).toEqual({ "2026-09-07": 2 });
    expect(g6.numerator).toBe(3); // 2 ack_required + the divergence event of G3; the wacc event is outside [from, to)
    expect(g6.breach.breached).toBe(true);
    const wide = kpi("G6", { to: "2026-09-30T00:00:00.000Z" });
    expect(wide.numerator).toBe(4);
    // G12: for `to` = 2026-09-30 the last would-block of snapshot_ack was 2026-09-09 -> 20 clear days (09-10..09-29), wacc 2026-09-16 -> 13 days
    const g12 = (buildGateIntegrityKpis(db, { ...W, to: "2026-09-30T00:00:00.000Z", minWrites: 1 }).kpis.find((k) => k.id === "G12")!.value as any).by_family;
    expect(g12.snapshot_ack.streak_days).toBe(20);
    expect(g12.snapshot_ack.qualifies_14_days).toBe(true);
    expect(g12.wacc.streak_days).toBe(13);
    expect(g12.wacc.qualifies_14_days).toBe(false);
    const strict = (buildGateIntegrityKpis(db, { ...W, to: "2026-09-30T00:00:00.000Z", minWrites: 100000 }).kpis.find((k) => k.id === "G12")!.value as any).by_family;
    expect(strict.snapshot_ack.qualifies_14_days).toBe(false); // a quiet system does not pass by being unused
  });

  test("G7: countersign latency (business days), pending count and the single-holder warning", () => {
    expect(businessDays("2026-10-02T10:00:00Z", "2026-10-06T10:00:00Z")).toBe(2); // Fri -> Tue: Fri + Mon
    const a = S.seedIcReadyProject(db, MAKER).projectId;
    const b = S.seedIcReadyProject(db, MAKER).projectId;
    for (const p of [a, b]) S.addMember(db, p, MAKER, "lead");
    const rec = (pid: string, when: string) => recordGateDecisionRow(db, { entityType: "project", entityId: pid, gate: "entity_ic", decision: "go", storedRationale: S.IC_RATIONALE, missingArtifactsJson: null, actor: MAKER, gateEvaluationId: null, learningCapture: null, judgementConfirmationsJson: null, extras: null, now: when });
    const signed = rec(a, "2026-09-08T09:00:00.000Z");
    const pending = rec(b, "2026-09-08T09:00:00.000Z");
    expect(signed.ok && pending.ok).toBe(true);
    if (!signed.ok) return;
    const cs = countersignDecision(db, { projectId: a, decisionId: signed.id, checkerId: CHECKER, decision: "approved", reason: "법인 심의 기록과 근거를 확인하고 승인함", conditions: [], now: "2026-09-10T09:00:00.000Z" });
    expect(cs.ok).toBe(true);
    const k = kpi("G7", { from: "2026-09-01T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z" });
    const v = k.value as any;
    expect(v).toMatchObject({ countersigned: 1, pending: 1, pending_over_5_business_days: 1, median_business_days: 2 });
    expect(k.breach.breached).toBe(true);
    expect(k.breach.reasons.join(" ")).toContain("5 business days");
    expect(k.breach.reasons.join(" ")).toContain("fewer than 2 active holders");
    // structured codes run parallel to the English fallback text
    expect(k.breach.items).toHaveLength(k.breach.reasons.length);
    expect(k.breach.items.map((i) => i.code)).toEqual(expect.arrayContaining(["countersign_pending_old", "reviewer_holders_low"]));
    expect(k.breach.items.find((i) => i.code === "reviewer_holders_low")?.params.role).toMatch(/-ic-reviewer$/);
  });

  test("G8: open conditions, older than 30 days, open at a reached group_ic gate", () => {
    const pid = S.seedIcReadyProject(db, MAKER).projectId;
    const d = S.insertGate(db, "project", pid, "entity_ic", "go");
    db.run("INSERT INTO condition_precedent (id, project_id, source_decision_id, gate, text, clear_by, origin, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", [ulid(), pid, d, "entity_ic", "old", "group_ic", "recorder", "open", MAKER, "2026-08-01T00:00:00.000Z"]);
    db.run("INSERT INTO condition_precedent (id, project_id, source_decision_id, gate, text, clear_by, origin, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", [ulid(), pid, d, "entity_ic", "new", "closing", "recorder", "open", MAKER, "2026-10-26T00:00:00.000Z"]);
    const before = (kpi("G8").value as any).past_clear_by_gate;
    S.insertGate(db, "project", pid, "group_ic", "go");
    const k = kpi("G8");
    expect((k.value as any).open).toBeGreaterThanOrEqual(2);
    expect((k.value as any).older_than_30_days).toBeGreaterThanOrEqual(1);
    expect((k.value as any).past_clear_by_gate).toBe(before + 1);
    expect(k.breach.breached).toBe(true);
  });

  test("G9: active / expired / expiring waivers, mean age, concentration by clause, active over 90 days breaches", () => {
    const pid = S.insertProject(db, null);
    const doc = S.insertGovernanceDoc(db);
    const w = (clause: string, status: string, approved: string | null, expires: string) => db.run("INSERT INTO waiver (id, project_id, governance_doc_id, clause_ref, reason, requested_by, approver_role, approved_by, approved_at, expires_at, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [ulid(), pid, doc, clause, "r", MAKER, "entity-ic-reviewer", approved ? CHECKER : null, approved, expires, status, "2026-07-01T00:00:00.000Z"]);
    w("c1", "active", "2026-10-20T00:00:00.000Z", "2026-11-05T00:00:00.000Z"); // active, expiring in 9 days
    w("c1", "active", "2026-06-01T00:00:00.000Z", "2026-12-30T00:00:00.000Z"); // active, > 90 days old
    w("c2", "active", "2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"); // expired
    const k = kpi("G9");
    const v = k.value as any;
    expect(v).toMatchObject({ active: 2, expired: 1, expiring_14d: 1, active_over_90_days: 1 });
    expect(v.concentration_by_clause).toMatchObject({ c1: 2, c2: 1 });
    expect(v.mean_active_age_days).toBeGreaterThan(50);
    expect(k.breach.breached).toBe(true);
  });

  test("G10: unconfirmed mandatory na rows, backlog over 14 days, median days to confirmation", () => {
    const pid = S.seedIcReadyProject(db, MAKER).projectId;
    const rows = db.query("SELECT id FROM project_checklist_item_state WHERE project_id = ? AND checklist_id = 'chk-commercial-dd-checklist' LIMIT 2").all(pid) as Array<{ id: string }>;
    db.run("UPDATE project_checklist_item_state SET status = 'na', assessed_at = '2026-10-01T00:00:00.000Z', na_confirmed_by = NULL WHERE id = ?", [rows[0].id]);
    db.run("UPDATE project_checklist_item_state SET status = 'na', assessed_at = '2026-10-10T00:00:00.000Z', na_confirmed_by = ?, na_confirmed_at = '2026-10-14T00:00:00.000Z' WHERE id = ?", [CHECKER, rows[1].id]);
    const k = kpi("G10");
    const v = k.value as any;
    expect(v.unconfirmed).toBeGreaterThanOrEqual(1);
    expect(v.unconfirmed_over_14_days).toBeGreaterThanOrEqual(1);
    expect(v.median_days_to_confirmation).toBe(4);
    expect(k.breach.breached).toBe(true);
  });

  test("G11: projects at S8+ whose WACC is provisional, over all projects at S8+", () => {
    const k = kpi("G11");
    const v = k.value as any;
    expect(v.projects_at_s8_or_later).toBeGreaterThanOrEqual(1); // seedReadyProject adds an S8 case
    expect(v.provisional).toBe(v.projects_at_s8_or_later); // none confirmed yet
    expect(k.breach.breached).toBe(true);
    expect(k.rate).toBe(1);
  });
});

describe("route", () => {
  test("admin only, aggregate only, validated parameters, default period", async () => {
    const get = (q: string, who: string) => nextRequest(`/api/admin/gate-integrity/kpis${q}`, { headers: { cookie: cookies[who] } });
    expect((await get("", MAKER)).status).toBe(403);
    expect((await nextRequest("/api/admin/gate-integrity/kpis")).status).toBe(401);
    const res = await get(`?from=${W.from}&to=${W.to}`, ADMIN);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any; meta: any };
    expect(body.meta.count).toBe(12);
    expect(body.data.kpis.length).toBe(12);
    expect(JSON.stringify(body)).not.toContain("S.GENUINE");
    expect((await get("?gate=nope", ADMIN)).status).toBe(400);
    expect((await get("?from=garbage", ADMIN)).status).toBe(400);
    expect((await get(`?from=${W.to}&to=${W.from}`, ADMIN)).status).toBe(400);
    expect((await get("?min_writes=-1", ADMIN)).status).toBe(400);
    const dflt = (await (await get("", ADMIN)).json()) as { data: any };
    expect(new Date(dflt.data.period.from).getUTCDay()).toBe(1); // Monday
  });
});

describe("a database migrated only to 0172", () => {
  function oldDb(): { path: string; dir: string; handle: InstanceType<typeof Database> } {
    const dir = mkdtempSync(join(tmpdir(), "co-newbiz-p5k-old-"));
    const path = join(dir, "old.sqlite");
    const late = readdirSync(join(PROJECT_ROOT, "db/migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f) && f >= "0173");
    const seed = new Database(path);
    seed.run("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY NOT NULL, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
    for (const f of late) seed.run("INSERT INTO schema_migrations VALUES (?,?,?)", [f, f, "2026-01-01T00:00:00Z"]);
    seed.close();
    resetDb();
    runMigrations(path); // applies 0001..0172 only (0173+ pre-marked)
    const h = getDb(path);
    h.run("DELETE FROM schema_migrations WHERE filename >= '0173'");
    return { path, dir, handle: h };
  }
  test("KPI API: unmigrated sections are migration_pending (naming the migrations), the rest still compute", () => {
    const o = oldDb();
    try {
      const r = buildGateIntegrityKpis(o.handle, { ...W });
      const by = Object.fromEntries(r.kpis.map((k) => [k.id, k]));
      for (const id of ["G1", "G2", "G3", "G4", "G5"]) {
        expect(by[id].status).toBe("migration_pending");
        expect(by[id].migration_pending!.migrations).toEqual(["0173_gate_decision_snapshot"]);
        expect(by[id].breach.breached).toBe(false);
      }
      expect(by.G7.status).toBe("migration_pending");
      expect(by.G7.migration_pending!.migrations).toEqual(["0175_condition_precedent", "0176_human_role_grant"]);
      expect(by.G8.migration_pending!.migrations).toEqual(["0175_condition_precedent"]);
      expect(by.G10.migration_pending!.migrations).toEqual(["0177_na_confirmation"]);
      for (const id of ["G6", "G9", "G11", "G12"]) expect(by[id].status).toBe("ok");
      expect(r.unapplied_migrations).toContain("0173_gate_decision_snapshot.sql");
      expect(r.unapplied_migrations).toContain("0179_project_reconfirm_requirement.sql");
    } finally {
      resetDb(); getDb(TEST_DB_PATH); rmSync(o.dir, { recursive: true, force: true });
    }
  });
  test("shadow report: no throw; grant holders and the na backlog are migration_pending, would-block rows still summarised; human output says so", () => {
    const o = oldDb();
    try {
      appendAudit(o.handle, { actor: "x", action: "gate_integrity.would_block:ack_required", target: "project:P:dd", now: at("2026-09-08") });
      const ro = new Database(o.path, { readonly: true });
      const rep = buildShadowReport(ro, { from: W.from, to: W.to });
      ro.close();
      expect(rep.totals.would_block).toBe(1);
      expect(rep.readiness.grant_holders).toBeNull();
      expect(rep.readiness.second_grant_holder_ready).toBeNull();
      expect(rep.readiness.legacy_unconfirmed_mandatory_na).toBeNull();
      const sections = rep.migration_pending.map((p) => p.section);
      expect(sections).toContain("readiness.grant_holders");
      expect(sections).toContain("readiness.legacy_unconfirmed_mandatory_na");
      expect(rep.migration_pending.find((p) => p.section === "readiness.grant_holders")!.migrations).toEqual(["0176_human_role_grant"]);
      expect(rep.unapplied_migrations.length).toBeGreaterThan(0);
      const text = renderHuman(rep);
      expect(text).toContain("MIGRATION PENDING (0176_human_role_grant)");
      expect(text).toContain("Unapplied gate-integrity migrations");
      const cli = Bun.spawnSync(["bun", join(PROJECT_ROOT, "scripts/co-newbiz/gate-integrity-shadow-report.ts"), "--db-path", o.path, "--json", "--from", W.from, "--to", W.to]);
      expect(cli.exitCode).toBe(0);
      expect(JSON.parse(cli.stdout.toString()).migration_pending.length).toBeGreaterThan(0);
    } finally {
      resetDb(); getDb(TEST_DB_PATH); rmSync(o.dir, { recursive: true, force: true });
    }
  });
});
