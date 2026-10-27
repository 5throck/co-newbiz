// @version 1.0.0
/**
 * ADR-0186 P4 - family `wacc` (D8) and the two predicate activations (D3), on a scratch SQLite:
 *  - resolveWaccConfirmation matrix (subject unset / absent / assumed / user; selected-target scope),
 *  - S8 completion rule (enforce only), fs GO hard block 409 wacc_unconfirmed (route + contract + snapshot),
 *    later-gate regression block, HOLD / KILL never blocked, off / shadow / enforce,
 *  - the `wacc_status` provisional contract on the read APIs,
 *  - filler vars fin.dd_value_impact_unbridged and fin.targets_meeting_hurdle, each with a TRUE and an UNASSESSED case,
 *    evaluated through the REAL registry entries.
 */
import { test, expect, beforeAll, afterAll, afterEach, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-gate-integrity-p4-wacc.sqlite");
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
const { GATE_INTEGRITY_FAMILIES, gateIntegrityEnvName } = await import("../../app/web-next/lib/gate-integrity-flags.ts");
const { clearSnapshotCache } = await import("../../app/web-next/lib/gate-snapshot.ts");
const { recordGateDecisionRow, integrityActive } = await import("../../app/web-next/lib/gate-decision-contract.ts");
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");
const { resolveWaccConfirmation } = await import("../../db/lib/wacc-confirmation.ts");
const { recordWaccSession, setProjectWaccSubject } = await import("../../db/lib/wacc.ts");
const { recordAssumption } = await import("../../db/lib/assumption.ts");
const { createRun } = await import("../../db/lib/versioning.ts");
const { fillSnapshot, SNAPSHOT_VAR_KEYS } = await import("../../db/lib/snapshot-filler.ts");
const { evaluateKillCriteria } = await import("../../db/lib/kill-criteria.ts");
const { resetRateLimits } = await import("../../app/web-next/lib/gate-integrity.ts");
const S = await import("./_gate-integrity-support.ts");

const ANALYST = "p4w-analyst";
let cookie = "";
const flagNames = GATE_INTEGRITY_FAMILIES.map(gateIntegrityEnvName);
function setFlag(mode: "off" | "shadow" | "enforce", family: (typeof GATE_INTEGRITY_FAMILIES)[number] = "wacc") {
  process.env[gateIntegrityEnvName(family)] = mode;
}
afterEach(() => {
  for (const n of flagNames) delete process.env[n];
  clearSnapshotCache();
  resetRateLimits();
});
beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: `pw-${ANALYST}-123456`, createdBy: "test", now: S.NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: S.NOW });
  db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = ?", [ANALYST]);
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: ANALYST, password: `pw-${ANALYST}-123456` }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

const count = (sql: string, ...args: unknown[]) => (db.query(sql).get(...(args as any[])) as { c: number }).c;
const audits = (action: string) => count("SELECT COUNT(*) c FROM audit_log WHERE action = ?", action);
const dataOf = async <T = any>(res: Response) => ((await res.json()) as { data: T }).data;
const errOf = async (res: Response) => ((await res.json()) as { error: { code: string; details?: Record<string, any> } }).error;

/** A greenfield project whose S8-S10 artifacts are complete, so GO is limited only by the families under test. */
function readyProject(): string {
  const { projectId } = S.seedReadyProject(db, ANALYST);
  return projectId;
}
function session(projectId: string, opts: { wacc?: number; hurdle?: number | null; companyId?: string | null; subject?: boolean } = {}) {
  recordWaccSession(db, { projectId, wacc: opts.wacc ?? 0.095, hurdleIrr: opts.hurdle === undefined ? 0.12 : opts.hurdle, subjectCompanyId: opts.companyId ?? null, actor: ANALYST, now: S.NOW });
  if (opts.subject !== false && !opts.companyId) setProjectWaccSubject(db, projectId, "promoter", "promoter self-execution; confirmed in the WACC session", ANALYST, S.NOW);
}
/** A non-user (assumed) row on a fresh project run. */
function assume(projectId: string, key: "wacc" | "hurdle_irr", value: number) {
  const run = createRun(db, { projectId, label: "assumed rates", createdBy: ANALYST, overrides: {}, now: S.NOW });
  recordAssumption(db, { runId: run.run_id, assumptionKey: key, kind: "assumed", value, asOf: "2026-10-27", rationale: "placeholder rate pending the session", actor: ANALYST, now: S.NOW });
}

const NO_EXTRAS = { snapshotHash: null, acknowledgements: [], briefId: null, divergenceReason: null, killOverrideId: null };
function recordGate(projectId: string, gate: string, decision: "go" | "hold" | "kill" = "go") {
  return recordGateDecisionRow(db, {
    entityType: "project", entityId: projectId, gate, decision, storedRationale: S.IC_RATIONALE,
    missingArtifactsJson: decision === "hold" ? JSON.stringify(["a missing deliverable"]) : null,
    actor: ANALYST, gateEvaluationId: null, learningCapture: decision === "kill" ? "Lessons captured for the next screening round" : null,
    judgementConfirmationsJson: null, extras: integrityActive() ? { ...NO_EXTRAS } : null, now: S.NOW,
  });
}
const fsPost = (projectId: string, body: Record<string, unknown>) =>
  nextRequest(`/api/projects/${projectId}/gate-decisions`, { method: "POST", headers: { cookie }, body: JSON.stringify({ gate: "fs", rationale: S.IC_RATIONALE, ...body }) });

describe("resolveWaccConfirmation - the single reader", () => {
  test("matrix: subject unset / absent / assumed / user; confirmed only when all three are human-confirmed", () => {
    const p = readyProject();
    expect(resolveWaccConfirmation(db, p)).toMatchObject({ confirmed: false, status: "provisional", source_status: "absent", wacc: "absent", hurdle_irr: "absent", subject: null, missing: ["wacc_subject", "wacc", "hurdle_irr"] });

    assume(p, "wacc", 0.1);
    assume(p, "hurdle_irr", 0.12);
    expect(resolveWaccConfirmation(db, p)).toMatchObject({ confirmed: false, source_status: "assumed", wacc: "assumed", hurdle_irr: "assumed", missing: ["wacc_subject", "wacc", "hurdle_irr"] });

    // a user session without the hurdle: still provisional (hurdle missing -> assumed reading)
    session(p, { hurdle: null, subject: false });
    expect(resolveWaccConfirmation(db, p)).toMatchObject({ confirmed: false, wacc: "user", hurdle_irr: "assumed", missing: ["wacc_subject", "hurdle_irr"] });

    // session with both rates but no subject
    session(p, { subject: false });
    expect(resolveWaccConfirmation(db, p)).toMatchObject({ confirmed: false, wacc: "user", hurdle_irr: "user", source_status: "sourced", subject: null, missing: ["wacc_subject"] });

    // subject set -> confirmed
    setProjectWaccSubject(db, p, "promoter", "promoter self-execution; confirmed in the WACC session", ANALYST, S.NOW);
    expect(resolveWaccConfirmation(db, p)).toMatchObject({ confirmed: true, status: "confirmed", source_status: "sourced", subject: "promoter", missing: [], scope: { kind: "project" } });
  });

  test("the selected target's own session is read first; other targets' sessions never count", () => {
    const opp = S.insertOpportunity(db, "brownfield", ANALYST);
    const p = S.insertProject(db, opp, "brownfield");
    db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", ["co-sel", "Selected Co", S.NOW]);
    db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", ["co-oth", "Other Co", S.NOW]);
    const tSel = ulid();
    const tOth = ulid();
    db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [tSel, opp, "Selected Co", "shortlisted", 1, S.NOW, S.NOW]);
    db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [tOth, opp, "Other Co", "shortlisted", 2, S.NOW, S.NOW]);
    setProjectWaccSubject(db, p, "target", "acquisition: the target's risk (bf-13)", ANALYST, S.NOW);
    // only the OTHER target has a user session, and no target is selected yet
    session(p, { companyId: "co-oth" });
    expect(resolveWaccConfirmation(db, p)).toMatchObject({ confirmed: false, wacc: "absent", scope: { kind: "project" } });
    // select the first target: its own session is absent, the other's does not count
    db.run("INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [ulid(), "project", p, p, "test", "s8_target_select", "done", "web", ANALYST, S.NOW, S.NOW, JSON.stringify({ target_id: tSel, rationale: "selected" })]);
    expect(resolveWaccConfirmation(db, p).confirmed).toBe(false);
    session(p, { companyId: "co-sel" });
    expect(resolveWaccConfirmation(db, p)).toMatchObject({ confirmed: true, scope: { kind: "target", subject_company_id: "co-sel" } });
  });
});

describe("one shared scope rule (resolver and filler)", () => {
  function brownfieldWithTarget(subject: "target" | "promoter") {
    const opp = S.insertOpportunity(db, "brownfield", ANALYST);
    const p = S.insertProject(db, opp, "brownfield");
    const co = `co-${ulid().slice(-6)}`;
    db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [co, `Co ${co}`, S.NOW]);
    const t = ulid();
    db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [t, opp, `Co ${co}`, "shortlisted", 1, S.NOW, S.NOW]);
    db.run("INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [ulid(), "project", p, p, "test", "s8_target_select", "done", "web", ANALYST, S.NOW, S.NOW, JSON.stringify({ target_id: t })]);
    setProjectWaccSubject(db, p, subject, "subject confirmed in the WACC session", ANALYST, S.NOW);
    return { p, opp, co, t };
  }
  function targetAssume(p: string, co: string, key: "wacc" | "hurdle_irr", value: number, kind: "assumed" | "user" = "assumed", asOf = "2026-10-27") {
    const run = createRun(db, { projectId: p, label: "t", createdBy: ANALYST, overrides: {}, now: S.NOW });
    db.run("UPDATE run SET subject_company_id = ? WHERE id = ?", [co, run.run_id]);
    recordAssumption(db, { runId: run.run_id, assumptionKey: key, kind, value, asOf, rationale: kind === "assumed" ? "placeholder pending the session" : undefined, actor: ANALYST, now: S.NOW });
  }

  test("a non-user latest row in the target scope governs: no fallback to an older user row or to the project scope", () => {
    const { p, co } = brownfieldWithTarget("target");
    session(p, { subject: false }); // project scope fully user-confirmed
    expect(resolveWaccConfirmation(db, p).confirmed).toBe(true);
    targetAssume(p, co, "wacc", 0.1, "assumed", "2026-10-28"); // target scope now has a (non-user) row
    const c = resolveWaccConfirmation(db, p);
    expect(c).toMatchObject({ confirmed: false, scope: { kind: "target" }, wacc: "assumed", hurdle_irr: "absent" });
    expect(c.missing).toEqual(["wacc", "hurdle_irr"]); // the project-level user rates do not rescue it
    targetAssume(p, co, "wacc", 0.09, "user", "2026-10-29");
    targetAssume(p, co, "hurdle_irr", 0.12, "user", "2026-10-29");
    expect(resolveWaccConfirmation(db, p)).toMatchObject({ confirmed: true, scope: { kind: "target", subject_company_id: co } });
  });

  test("bf-13: a per-target session needs wacc_subject = target; a mismatch is provisional with its own reason", () => {
    const { p, co } = brownfieldWithTarget("promoter");
    targetAssume(p, co, "wacc", 0.09, "user");
    targetAssume(p, co, "hurdle_irr", 0.12, "user");
    expect(resolveWaccConfirmation(db, p)).toMatchObject({ confirmed: false, status: "provisional", reason: "wacc_subject_not_target", missing: ["wacc_subject"] });
    setProjectWaccSubject(db, p, "target", "acquisition: the target's risk (bf-13)", ANALYST, S.NOW);
    expect(resolveWaccConfirmation(db, p)).toMatchObject({ confirmed: true, reason: null });
  });
});

describe("S8 completion rule (family wacc = enforce)", () => {
  const s8 = (p: string) => {
    const ev = evaluateProcess({ type: "project", id: p });
    return { status: ev.stages.find((s) => s.id === "S8")!.status, blockers: ev.blockers, missing: ev.requiredArtifacts };
  };

  test("off and shadow leave S8 as the artifacts say; enforce adds the blocker until the rate is confirmed, then it lifts", () => {
    const p = readyProject();
    expect(s8(p).status).toBe("complete");
    setFlag("shadow");
    expect(s8(p).status).toBe("complete");
    setFlag("enforce");
    const blocked = s8(p);
    expect(blocked.status).not.toBe("complete");
    expect(blocked.blockers.join(" ")).toContain("not human-confirmed");
    expect(blocked.missing).toContain("WACC and hurdle IRR confirmed by a person");
    session(p);
    expect(s8(p).status).toBe("complete");
  });
});

describe("fs GO hard block - 409 wacc_unconfirmed", () => {
  test("enforce through the Route Handler: blocked (ahead of the stage gaps) with details {subject, missing}; HOLD is not; the block lifts after confirmation", async () => {
    const p = readyProject();
    setFlag("enforce");
    const go = await fsPost(p, { decision: "go" });
    expect(go.status).toBe(409);
    const err = await errOf(go);
    expect(err.code).toBe("wacc_unconfirmed");
    expect(err.details).toMatchObject({ subject: null, missing: ["wacc_subject", "wacc", "hurdle_irr"] });
    expect(count("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ? AND gate = 'fs'", p)).toBe(0);
    expect((await fsPost(p, { decision: "hold", rationale: "x", missing_artifacts: ["wacc session"] })).status).toBe(201);
    const k = readyProject();
    expect((await fsPost(k, { decision: "kill", rationale: "x", learning_capture: "Lessons captured for the next screening round" })).status).toBe(201);

    // only the rates, no subject: still blocked, and the missing list shrinks
    session(p, { subject: false });
    const partial = await fsPost(p, { decision: "go" });
    expect(partial.status).toBe(409);
    expect((await errOf(partial)).details).toMatchObject({ missing: ["wacc_subject"] });

    setProjectWaccSubject(db, p, "promoter", "promoter self-execution; confirmed in the WACC session", ANALYST, S.NOW);
    const ok = await fsPost(p, { decision: "go" });
    expect(ok.status, JSON.stringify(await ok.clone().json())).toBe(201);
  });

  test("contract path (proposal confirm / direct write): the snapshot hard block raises the same 409 inside the transaction", () => {
    const p = readyProject();
    setFlag("enforce");
    const r = recordGate(p, "fs");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure).toMatchObject({ status: 409, code: "wacc_unconfirmed", details: { subject: null, missing: ["wacc_subject", "wacc", "hurdle_irr"] } });
    expect(count("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ? AND gate = 'fs'", p)).toBe(0);
    session(p);
    expect(recordGate(p, "fs").ok).toBe(true);
  });

  test("shadow audits the would-block once per day and records; off is the legacy path", async () => {
    const p = readyProject();
    setFlag("shadow");
    const before = audits("gate_integrity.would_block:wacc_unconfirmed");
    expect((await fsPost(p, { decision: "go" })).status).toBe(201);
    expect(audits("gate_integrity.would_block:wacc_unconfirmed")).toBeGreaterThan(before);
    const q = readyProject();
    setFlag("off");
    const r = recordGate(q, "fs");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.snapshotHash).toBeNull();
  });

  test("later gates re-read the state: a regression to assumed blocks dd; an absent session does not (legacy history)", () => {
    const legacy = readyProject();
    S.insertGate(db, "project", legacy, "fs", "go");
    setFlag("enforce");
    expect(recordGate(legacy, "dd").ok).toBe(true); // absent -> not a regression

    const regressed = readyProject();
    S.insertGate(db, "project", regressed, "fs", "go");
    assume(regressed, "wacc", 0.1);
    const r = recordGate(regressed, "dd");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.code).toBe("wacc_unconfirmed");
    expect(recordGate(regressed, "dd", "hold").ok).toBe(true);
  });

  test("the gate snapshot carries the wacc section and names the hard block (enforced follows the mode; absent when off)", async () => {
    const p = readyProject();
    const snap = async () => dataOf<any>(await nextRequest(`/api/projects/${p}/gate-snapshot?gate=fs`, { headers: { cookie } }));
    setFlag("enforce");
    const e = await snap();
    expect(e.snapshot.wacc).toMatchObject({ status: "absent", confirmed: false, missing: ["wacc_subject", "wacc", "hurdle_irr"] });
    expect(e.snapshot.hard_blocks).toContainEqual({ code: "wacc_unconfirmed", keys: ["hurdle_irr", "wacc", "wacc_subject"], enforced: true });
    clearSnapshotCache();
    setFlag("shadow");
    expect((await snap()).snapshot.hard_blocks).toContainEqual({ code: "wacc_unconfirmed", keys: ["hurdle_irr", "wacc", "wacc_subject"], enforced: false });
    clearSnapshotCache();
    setFlag("off");
    expect((await snap()).snapshot.hard_blocks.filter((b: any) => b.code === "wacc_unconfirmed")).toEqual([]);
    session(p);
    clearSnapshotCache();
    setFlag("enforce");
    const ok = await snap();
    expect(ok.snapshot.wacc).toMatchObject({ status: "sourced", confirmed: true, missing: [] });
    expect(ok.snapshot.hard_blocks.filter((b: any) => b.code === "wacc_unconfirmed")).toEqual([]);
  });
});

describe("wacc_status - the provisional display contract", () => {
  const PROVISIONAL = { status: "provisional", reason: "wacc_unconfirmed", missing: ["wacc_subject", "wacc", "hurdle_irr"], subject: null, scope: "project", warnings: [] };

  test("business-case, generate run, ic-package, s8-lens-summary, gate-brief and monitoring-brief carry it; it flips to confirmed without any flag", async () => {
    const p = readyProject();
    db.run("INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      ["run-p4-w", "project", p, p, "test", "s8_business_case", "done", "web", ANALYST, S.NOW, S.NOW]);
    const get = async (path: string) => dataOf<any>(await nextRequest(`/api/projects/${p}/${path}`, { headers: { cookie } }));
    const post = async (path: string, body: unknown) => {
      const res = await nextRequest(`/api/projects/${p}/${path}`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
      expect(res.status, path).toBe(200);
      return dataOf<any>(res);
    };
    const all = async () => ({
      "business-case": (await get("business-case")).wacc_status,
      "generate-run": (await get("business-case/generate/run-p4-w")).wacc_status,
      "ic-package": (await get("ic-package")).wacc_status,
      "s8-lens-summary": (await get("s8-lens-summary")).wacc_status,
      "gate-brief": (await post("gate-brief", { gate: "fs" })).wacc_status,
      "monitoring-brief": (await post("monitoring-brief", {})).wacc_status,
    });
    for (const [surface, v] of Object.entries(await all())) expect(v, surface).toEqual(PROVISIONAL);
    session(p);
    for (const [surface, v] of Object.entries(await all())) expect(v, surface).toEqual({ status: "confirmed", reason: null, missing: [], subject: "promoter", scope: "project", warnings: [] });
  });

  test("warning when the WACC is at or above the hurdle; the WACC route rejects rates outside 0 < r < 1 (rate_out_of_range) and warns in its reply", async () => {
    const p = readyProject();
    const post = (body: Record<string, unknown>) => nextRequest(`/api/projects/${p}/wacc`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
    for (const bad of [{ wacc: 12, hurdle_irr: 0.12 }, { wacc: 0.09, hurdle_irr: 12 }, { wacc: 0, hurdle_irr: 0.1 }, { wacc: 1, hurdle_irr: 0.1 }, { wacc: 0.09, hurdle_irr: -0.05 }]) {
      const res = await post(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect((await errOf(res)).code).toBe("rate_out_of_range");
    }
    const ok = await post({ wacc: 0.12, hurdle_irr: 0.1, subject: "promoter", subject_rationale: "promoter self-execution; confirmed" });
    expect(ok.status).toBe(201);
    expect((await dataOf<any>(ok)).warnings).toEqual(["wacc_not_below_hurdle"]);
    const bc = await dataOf<any>(await nextRequest(`/api/projects/${p}/business-case`, { headers: { cookie } }));
    expect(bc.wacc_status).toMatchObject({ status: "confirmed", warnings: ["wacc_not_below_hurdle"] });
  });
});

// ── Filler vars and the two registry activations ───────────────────────────────────────────────────

function project(): { pid: string; opp: string } {
  const opp = S.insertOpportunity(db, "brownfield", ANALYST);
  return { pid: S.insertProject(db, opp, "brownfield"), opp };
}
function plainRun(pid: string): string {
  const id = ulid();
  db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [id, pid, `hash-${id.slice(-6)}`, ANALYST, S.NOW]);
  return id;
}
const varRow = (runId: string, key: string) =>
  db.query("SELECT value_num, status, evidence_ref FROM project_variable_snapshot WHERE run_id = ? AND var_key = ?").get(runId, key) as { value_num: number | null; status: string; evidence_ref: string | null };
function evalProc(pid: string, procedure: string, runId = plainRun(pid)) {
  return { runId, result: evaluateKillCriteria(db, { runId, projectId: pid, procedure, now: "2026-10-27T10:00:00Z" }) };
}
const outcomeOf = (r: ReturnType<typeof evalProc>, id: string) => r.result.outcomes.find((o) => o.criterion_id === id)?.outcome;

describe("fin.dd_value_impact_unbridged / greenfield-dd dd_finding_with_value_impact_not_in_valuation_bridge", () => {
  const CRIT = "dd_finding_with_value_impact_not_in_valuation_bridge";
  const finding = (pid: string, valueImpact: number | null, assumptionKey: string | null, targetId: string | null = null) =>
    db.run("INSERT INTO dd_finding (id, project_id, category, description, value_impact, assumption_key, created_at, target_id) VALUES (?,?,?,?,?,?,?,?)", [ulid(), pid, "commercial", "customer concentration", valueImpact, assumptionKey, S.NOW, targetId]);
  function adopt(pid: string): void {
    const model = ulid();
    db.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)", [model, pid, "valuation", "case", 5, ANALYST, S.NOW]);
    db.run("INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [ulid(), "project", pid, pid, "test", "s8_case_adopt", "done", "web", ANALYST, S.NOW, S.NOW, JSON.stringify({ model_id: model })]);
  }

  const userKey = (pid: string, key: string, superseded = false) => {
    const run = createRun(db, { projectId: pid, label: "bridge", createdBy: ANALYST, overrides: {}, now: S.NOW });
    recordAssumption(db, { runId: run.run_id, assumptionKey: key, kind: "user", value: 0.1, asOf: "2026-10-27", actor: ANALYST, now: S.NOW });
    if (superseded) {
      const newer = createRun(db, { projectId: pid, label: "newer", createdBy: ANALYST, overrides: {}, now: S.NOW });
      db.run("UPDATE run SET superseded_by = ? WHERE id = ?", [newer.run_id, run.run_id]);
    }
  };

  test("the registry entry is live with the count predicate (no longer inert)", () => {
    const { pid } = project();
    const r = evalProc(pid, "greenfield-dd");
    expect(r.result.outcomes.map((o) => o.criterion_id)).toContain(CRIT);
    expect(SNAPSHOT_VAR_KEYS).toContain("fin.dd_value_impact_unbridged");
  });

  test("TRUE: a finding naming an assumption_key that resolves to nothing fires; keyed-and-resolved, null-impact and zero-impact findings do not count", () => {
    const { pid } = project();
    finding(pid, 5000, "dd.customer_loss"); // key resolves to nothing
    finding(pid, 3000, "bc.capture_rate"); // resolved below
    finding(pid, null, "dd.other"); // no value impact
    finding(pid, 0, "dd.zero");
    userKey(pid, "bc.capture_rate");
    adopt(pid); // adopted after the findings, so not stale
    const r = evalProc(pid, "greenfield-dd");
    expect(varRow(r.runId, "fin.dd_value_impact_unbridged")).toMatchObject({ value_num: 1, status: "present" });
    expect(outcomeOf(r, CRIT)).toBe("true");
  });

  test("FALSE: every keyed finding resolves, or none carries a value impact (present 0)", () => {
    const { pid } = project();
    finding(pid, 4000, "bc.capture_rate");
    userKey(pid, "bc.capture_rate");
    adopt(pid);
    const r = evalProc(pid, "greenfield-dd");
    expect(varRow(r.runId, "fin.dd_value_impact_unbridged")).toMatchObject({ value_num: 0, status: "present" });
    expect(outcomeOf(r, CRIT)).toBe("false");
    const none = project();
    finding(none.pid, null, null);
    const r2 = evalProc(none.pid, "greenfield-dd");
    expect(varRow(r2.runId, "fin.dd_value_impact_unbridged")).toMatchObject({ value_num: 0, status: "present" });
  });

  test("UNASSESSED: a direct adjustment (value impact, no key) never fires - it makes the var missing", () => {
    const { pid } = project();
    finding(pid, 5000, null);
    adopt(pid);
    const r = evalProc(pid, "greenfield-dd");
    expect(varRow(r.runId, "fin.dd_value_impact_unbridged").status).toBe("missing");
    expect(outcomeOf(r, CRIT)).toBe("unassessed");
    expect(r.result.unassessed).toContain(CRIT);
  });

  test("UNASSESSED: no adopted case; an archived or target-scoped adopted model; a stale adoption (a finding newer than the adoption)", () => {
    const a = project();
    finding(a.pid, 5000, "dd.x");
    expect(outcomeOf(evalProc(a.pid, "greenfield-dd"), CRIT)).toBe("unassessed");

    const b = project();
    finding(b.pid, 5000, "dd.x");
    adopt(b.pid);
    db.run("UPDATE business_case_model SET archived_at = ? WHERE project_id = ?", [S.NOW, b.pid]);
    expect(outcomeOf(evalProc(b.pid, "greenfield-dd"), CRIT)).toBe("unassessed");

    const c = project();
    finding(c.pid, 5000, "dd.x");
    adopt(c.pid);
    db.run("UPDATE business_case_model SET target_id = (SELECT id FROM brownfield_target WHERE opportunity_id = ? LIMIT 1) WHERE project_id = ?", [c.opp, c.pid]);
    db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)", ["t-c-" + ulid().slice(-4), c.opp, "T", "shortlisted", S.NOW, S.NOW]);
    db.run("UPDATE business_case_model SET target_id = (SELECT id FROM brownfield_target WHERE opportunity_id = ? LIMIT 1) WHERE project_id = ?", [c.opp, c.pid]);
    expect(outcomeOf(evalProc(c.pid, "greenfield-dd"), CRIT)).toBe("unassessed");

    const d = project();
    adopt(d.pid);
    db.run("UPDATE process_run SET started_at = '2020-01-01T00:00:00Z' WHERE project_id = ? AND stage = 's8_case_adopt'", [d.pid]);
    finding(d.pid, 5000, "dd.x"); // created after the adoption
    expect(outcomeOf(evalProc(d.pid, "greenfield-dd"), CRIT)).toBe("unassessed");
  });

  test("keys resolve only against kind=user assumptions on non-superseded runs", () => {
    const { pid } = project();
    finding(pid, 5000, "bc.capture_rate");
    const run = createRun(db, { projectId: pid, label: "assumed", createdBy: ANALYST, overrides: {}, now: S.NOW });
    recordAssumption(db, { runId: run.run_id, assumptionKey: "bc.capture_rate", kind: "assumed", value: 0.1, asOf: "2026-10-27", rationale: "placeholder pending", actor: ANALYST, now: S.NOW });
    adopt(pid);
    expect(varRow(evalProc(pid, "greenfield-dd").runId, "fin.dd_value_impact_unbridged").value_num).toBe(1); // assumed does not bridge
    const s2 = project();
    finding(s2.pid, 5000, "bc.capture_rate");
    userKey(s2.pid, "bc.capture_rate", true); // the run carrying it is superseded
    adopt(s2.pid);
    expect(varRow(evalProc(s2.pid, "greenfield-dd").runId, "fin.dd_value_impact_unbridged").value_num).toBe(1);
  });

  test("a finding on a comparison target (target_id set) is out of scope (ADR-0157)", () => {
    const { pid, opp } = project();
    const t = ulid();
    db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [t, opp, "T", "shortlisted", 1, S.NOW, S.NOW]);
    adopt(pid);
    finding(pid, 9000, "dd.x", t);
    const r = evalProc(pid, "greenfield-dd");
    expect(varRow(r.runId, "fin.dd_value_impact_unbridged")).toMatchObject({ value_num: 0, status: "present" });
  });
});

describe("fin.targets_meeting_hurdle / brownfield-fs-comparative no_target_meets_base_scenario_hurdle", () => {
  const CRIT = "no_target_meets_base_scenario_hurdle";
  function target(pid: string, opp: string, irr: number | null, opts: { model?: boolean; variant?: string } = {}): string {
    const t = ulid();
    db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [t, opp, `T-${t.slice(-4)}`, "shortlisted", 1, S.NOW, S.NOW]);
    if (opts.model !== false) {
      const m = ulid();
      db.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, target_id, variant, inputs_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [m, pid, "valuation", "case", 5, ANALYST, S.NOW, t, opts.variant ?? "market_forward", "{}"]);
      db.run("INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)", [ulid(), pid, m, "base", "p50", 1000, irr, "seed", S.NOW]);
    }
    return t;
  }
  const hurdle = (pid: string, value: number | null) => {
    if (value === null) return;
    recordWaccSession(db, { projectId: pid, wacc: 0.09, hurdleIrr: value, actor: ANALYST, now: S.NOW });
  };

  test("the registry entry is live with the count predicate", () => {
    const { pid } = project();
    const r = evalProc(pid, "brownfield-fs-comparative");
    expect(r.result.outcomes.map((o) => o.criterion_id)).toContain(CRIT);
    expect(SNAPSHOT_VAR_KEYS).toContain("fin.targets_meeting_hurdle");
  });

  test("TRUE: confirmed hurdle, every shortlisted target below it -> present 0, the escalation fires", () => {
    const { pid, opp } = project();
    hurdle(pid, 0.12);
    target(pid, opp, 0.08);
    target(pid, opp, 0.1);
    const r = evalProc(pid, "brownfield-fs-comparative");
    expect(varRow(r.runId, "fin.targets_meeting_hurdle")).toMatchObject({ value_num: 0, status: "present", evidence_ref: "valuation_simulation" });
    expect(outcomeOf(r, CRIT)).toBe("true");
  });

  test("FALSE: at least one target meets the hurdle (>= inclusive)", () => {
    const { pid, opp } = project();
    hurdle(pid, 0.12);
    target(pid, opp, 0.12);
    target(pid, opp, 0.05);
    const r = evalProc(pid, "brownfield-fs-comparative");
    expect(varRow(r.runId, "fin.targets_meeting_hurdle")).toMatchObject({ value_num: 1, status: "present" });
    expect(outcomeOf(r, CRIT)).toBe("false");
  });

  test("UNASSESSED: hurdle not user-confirmed (only a run_input / assumed rate) -> missing, never zero", () => {
    const { pid, opp } = project();
    target(pid, opp, 0.2);
    assume(pid, "hurdle_irr", 0.05);
    const r = evalProc(pid, "brownfield-fs-comparative");
    expect(varRow(r.runId, "fin.targets_meeting_hurdle").status).toBe("missing");
    expect(outcomeOf(r, CRIT)).toBe("unassessed");
    const none = project();
    target(none.pid, none.opp, 0.2);
    const r2 = evalProc(none.pid, "brownfield-fs-comparative");
    expect(varRow(r2.runId, "fin.targets_meeting_hurdle").status).toBe("missing");
  });

  test("UNASSESSED: no comparative run (no gate-primary base p50 IRR), only a historical variant, or no shortlisted target", () => {
    const a = project();
    hurdle(a.pid, 0.12);
    target(a.pid, a.opp, null, { model: false });
    expect(outcomeOf(evalProc(a.pid, "brownfield-fs-comparative"), CRIT)).toBe("unassessed");

    const b = project();
    hurdle(b.pid, 0.12);
    target(b.pid, b.opp, 0.3, { variant: "historical" }); // historical is comparison evidence, never the gate figure
    expect(outcomeOf(evalProc(b.pid, "brownfield-fs-comparative"), CRIT)).toBe("unassessed");

    const c = project();
    hurdle(c.pid, 0.12);
    expect(outcomeOf(evalProc(c.pid, "brownfield-fs-comparative"), CRIT)).toBe("unassessed");
  });

  test("scope isolation: a target whose own latest hurdle row is non-user is UNASSESSED even with a user hurdle at project scope or older in its own scope", () => {
    const { pid, opp } = project();
    hurdle(pid, 0.12); // project scope: user
    const t = target(pid, opp, 0.3);
    db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", ["co-h", "Hurdle Co", S.NOW]);
    db.run("UPDATE brownfield_target SET company_name = 'Hurdle Co' WHERE id = ?", [t]);
    expect(varRow(evalProc(pid, "brownfield-fs-comparative").runId, "fin.targets_meeting_hurdle")).toMatchObject({ value_num: 1, status: "present" });
    const run = createRun(db, { projectId: pid, label: "t", createdBy: ANALYST, overrides: {}, now: S.NOW });
    db.run("UPDATE run SET subject_company_id = 'co-h' WHERE id = ?", [run.run_id]);
    recordAssumption(db, { runId: run.run_id, assumptionKey: "hurdle_irr", kind: "assumed", value: 0.05, asOf: "2026-10-28", rationale: "placeholder pending the session", actor: ANALYST, now: S.NOW });
    const r = evalProc(pid, "brownfield-fs-comparative");
    expect(varRow(r.runId, "fin.targets_meeting_hurdle").status).toBe("missing");
    expect(outcomeOf(r, CRIT)).toBe("unassessed");
  });

  test("a partly assessed set with no meeting target is UNASSESSED; with a meeting target it is the count", () => {
    const { pid, opp } = project();
    hurdle(pid, 0.12);
    target(pid, opp, 0.05);
    target(pid, opp, null, { model: false });
    expect(outcomeOf(evalProc(pid, "brownfield-fs-comparative"), CRIT)).toBe("unassessed");
    target(pid, opp, 0.2);
    const r = evalProc(pid, "brownfield-fs-comparative");
    expect(varRow(r.runId, "fin.targets_meeting_hurdle")).toMatchObject({ value_num: 1, status: "present" });
    expect(outcomeOf(r, CRIT)).toBe("false");
  });

  test("fillSnapshot writes one row per seeded var (43) including the two new ones", () => {
    const { pid } = project();
    const runId = plainRun(pid);
    const res = fillSnapshot({ runId, projectId: pid, now: new Date("2026-10-27T10:00:00Z") }, db);
    expect(res.rows).toHaveLength(SNAPSHOT_VAR_KEYS.length);
    expect(res.rows.map((r) => r.var_key)).toContain("fin.targets_meeting_hurdle");
  });
});
