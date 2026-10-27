// @version 1.0.0
/**
 * ADR-0186 P3 - family `validators`: bf-01 derived from the validator completeness engine, the brownfield dd / entity_ic /
 * group_ic GO hard block 409 validators_incomplete, and the bf-03 hard block at a brownfield pre_fs GO (owner decision O-3,
 * 409 certification_unconfirmed), on a scratch SQLite. Greenfield is untouched; HOLD and KILL are never blocked; off / shadow /
 * enforce each behave as documented.
 */
import { test, expect, beforeAll, afterAll, afterEach, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-gate-integrity-p3-validators.sqlite");
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
const { derivedBf01, ddCompletionSummary, listDdWorkspace, BF_FEASIBILITY_CHECKLIST_ID, BF_VALIDATORS_ITEM_ID } = await import("../../app/web-next/lib/dd-checklist-tailor.ts");
const { certificationProblem, unconfirmedLoadBearingCertifications } = await import("../../app/web-next/lib/gate-certification.ts");
const { resetRateLimits } = await import("../../app/web-next/lib/gate-integrity.ts");
const S = await import("./_gate-integrity-support.ts");

const ANALYST = "p3v-analyst";
let cookie = "";
const flagNames = GATE_INTEGRITY_FAMILIES.map(gateIntegrityEnvName);
function setFlags(mode: "off" | "shadow" | "enforce", ...families: Array<(typeof GATE_INTEGRITY_FAMILIES)[number]>) {
  for (const f of families) process.env[gateIntegrityEnvName(f)] = mode;
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

const CORE = ["antitrust", "region-labor", "hr-comp", "customer", "incentive", "certification"] as const;

/** A brownfield M&A project (classified external) the analyst is on, with the brownfield-feasibility checklist attached. */
function bfProject(): { projectId: string; oppId: string } {
  const oppId = S.insertOpportunity(db, "brownfield", ANALYST);
  db.run("UPDATE route_decision SET sub_track = 'm_and_a' WHERE opportunity_id = ?", [oppId]);
  const projectId = S.insertProject(db, oppId, "brownfield");
  db.run("UPDATE opportunity SET project_id = ? WHERE id = ?", [projectId, oppId]);
  db.run(
    "INSERT INTO project_case_classification (id, project_id, case_type, origin, technology_track, classified_by, classified_at, rationale) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), projectId, "brownfield", "external", "none", ANALYST, S.NOW, "p3 validators test"],
  );
  S.addMember(db, projectId, ANALYST, "lead");
  return { projectId, oppId };
}

function writeValidator(projectId: string, key: string): void {
  db.run(
    "INSERT INTO compliance_check (id, project_id, gate, rule_key, layer, result, detail, detected_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), projectId, "DD", `ma-validator-${key}`, "procedure", "pass", `${key} recorded`, S.NOW],
  );
}

const NO_EXTRAS = { snapshotHash: null, acknowledgements: [], briefId: null, divergenceReason: null, killOverrideId: null };
function recordGate(entityType: "project" | "opportunity", entityId: string, gate: string, decision: "go" | "hold" | "kill" = "go") {
  return recordGateDecisionRow(db, {
    entityType, entityId, gate, decision, storedRationale: S.IC_RATIONALE,
    missingArtifactsJson: decision === "hold" ? JSON.stringify(["a missing deliverable"]) : null,
    actor: ANALYST, gateEvaluationId: null, learningCapture: decision === "kill" ? "Lessons captured for the next screening round" : null,
    judgementConfirmationsJson: null, extras: integrityActive() ? { ...NO_EXTRAS } : null, now: S.NOW,
  });
}
const gateRows = (entityId: string, gate: string) => count("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ? AND gate = ?", entityId, gate);

describe("bf-01 / brownfield GO hard block - validators_incomplete", () => {
  test("enforce: dd / entity_ic / group_ic GO is 409 while an applicable core validator is missing; nothing is written", () => {
    setFlags("enforce", "validators");
    const { projectId } = bfProject();
    for (const gate of ["dd", "entity_ic", "group_ic"]) {
      const r = recordGate("project", projectId, gate);
      expect(r.ok, gate).toBe(false);
      if (!r.ok) {
        expect(r.failure).toMatchObject({ status: 409, code: "validators_incomplete" });
        expect(r.failure.details?.missing).toEqual([...CORE].sort());
      }
      expect(gateRows(projectId, gate)).toBe(0);
    }
    // two covered -> the other four named
    writeValidator(projectId, "antitrust");
    writeValidator(projectId, "certification");
    const partial = recordGate("project", projectId, "dd");
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.failure.details?.missing).toEqual(["customer", "hr-comp", "incentive", "region-labor"]);
    // HOLD and KILL are never blocked
    expect(recordGate("project", projectId, "dd", "hold").ok).toBe(true);
    expect(recordGate("project", projectId, "dd", "kill").ok).toBe(true);
    // all six -> GO recorded (contract path: a snapshot is stored)
    for (const k of ["region-labor", "hr-comp", "customer", "incentive"]) writeValidator(projectId, k);
    const done = recordGate("project", projectId, "dd");
    expect(done.ok).toBe(true);
    if (done.ok) expect(done.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("greenfield is untouched; shadow audits the would-block and records; off is the legacy path", () => {
    setFlags("enforce", "validators");
    const gf = S.seedReadyProject(db, ANALYST);
    expect(recordGate("project", gf.projectId, "dd").ok).toBe(true);

    const { projectId } = bfProject();
    setFlags("shadow", "validators");
    const before = audits("gate_integrity.would_block:validators_incomplete");
    expect(recordGate("project", projectId, "dd").ok).toBe(true);
    expect(audits("gate_integrity.would_block:validators_incomplete")).toBe(before + 1);

    const b2 = bfProject();
    setFlags("off", "validators");
    const r = recordGate("project", b2.projectId, "dd");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.snapshotHash).toBeNull(); // legacy single INSERT
  });

  test("the gate snapshot names the hard block (enforced flag follows the mode) and omits it when the family is off", async () => {
    const { projectId } = bfProject();
    const snap = async () => dataOf<any>(await nextRequest(`/api/projects/${projectId}/gate-snapshot?gate=dd`, { headers: { cookie } }));
    setFlags("enforce", "validators");
    const e = await snap();
    expect(e.snapshot.validators).toMatchObject({ declared: 6, applicable: 6, completed: 0, missing: [...CORE].sort() });
    expect(e.snapshot.hard_blocks).toContainEqual({ code: "validators_incomplete", keys: [...CORE].sort(), enforced: true });
    clearSnapshotCache();
    setFlags("shadow", "validators");
    expect((await snap()).snapshot.hard_blocks).toContainEqual({ code: "validators_incomplete", keys: [...CORE].sort(), enforced: false });
    clearSnapshotCache();
    setFlags("off", "validators");
    expect((await snap()).snapshot.hard_blocks.filter((b: any) => b.code === "validators_incomplete")).toEqual([]);
  });

  test("through the Route Handler: the brownfield demo deal's dd GO is 409 validators_incomplete (ahead of the stage gaps), HOLD is not; shadow records it", async () => {
    const { seedS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");
    const { projectId } = seedS1ToS12Demo(TEST_DB_PATH, { humanDecisions: false, subTrackDd: true });
    S.addMember(db, projectId, ANALYST, "lead");
    S.insertGate(db, "project", projectId, "fs", "go");
    const dd = (body: Record<string, unknown>) => nextRequest(`/api/projects/${projectId}/gate-decisions`, { method: "POST", headers: { cookie }, body: JSON.stringify({ gate: "dd", rationale: S.IC_RATIONALE, ...body }) });
    setFlags("enforce", "validators");
    const go = await dd({ decision: "go" });
    expect(go.status).toBe(409);
    const err = await errOf(go);
    expect(err.code).toBe("validators_incomplete");
    expect(err.details?.missing).toEqual([...CORE].sort());
    expect(count("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ? AND gate = 'dd'", projectId)).toBe(0);
    expect((await dd({ decision: "hold", rationale: "x", missing_artifacts: ["validators"] })).status).toBe(201);
    // shadow audits the would-block and records the GO (the demo deal is the C3 defect: a hand-set bf-01 pass let it through)
    setFlags("shadow", "validators");
    const before = audits("gate_integrity.would_block:validators_incomplete");
    expect((await dd({ decision: "go" })).status).toBe(201);
    expect(audits("gate_integrity.would_block:validators_incomplete")).toBe(before + 1);
    // off: the legacy path, no rule runs
    setFlags("off", "validators");
    expect((await dd({ decision: "go" })).status).toBe(201);
    // all six recorded -> the block lifts under enforce
    setFlags("enforce", "validators");
    for (const k of CORE) writeValidator(projectId, k);
    const after = await dd({ decision: "go" });
    expect(after.status, JSON.stringify(await after.clone().json())).toBe(201);
    expect((await dataOf<any>(after)).snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("bf-01 - derived, read-only, a manual pass has no effect", () => {
  test("off: nothing is derived and the hand-set state stands (legacy)", async () => {
    const { projectId } = bfProject();
    expect(derivedBf01(projectId)).toBeNull();
    const put = await nextRequest(`/api/projects/${projectId}/dd-checklist/state`, {
      method: "PUT", headers: { cookie }, body: JSON.stringify({ checklist_id: BF_FEASIBILITY_CHECKLIST_ID, item_id: BF_VALIDATORS_ITEM_ID, status: "pass" }),
    });
    expect(put.status).toBe(200);
    const ws = listDdWorkspace(projectId);
    const item = ws.domains.find((d) => d.checklistId === BF_FEASIBILITY_CHECKLIST_ID)?.items.find((i) => i.id === BF_VALIDATORS_ITEM_ID);
    expect(item?.state).toMatchObject({ status: "pass" });
    expect(item?.state?.derived).toBeUndefined();
  });

  test("enforce: the verdict comes from the engine; a stored manual pass is ignored; a manual write is 409 derived_item", async () => {
    setFlags("enforce", "validators");
    const { projectId } = bfProject();
    // a legacy hand-set pass sits in the table
    db.run("INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, assessed_by, assessed_at) VALUES (?,?,?,?,?,?,?)",
      [ulid(), projectId, BF_FEASIBILITY_CHECKLIST_ID, BF_VALIDATORS_ITEM_ID, "pass", ANALYST, S.NOW]);
    const d = derivedBf01(projectId)!;
    expect(d.status).toBe("fail");
    expect(d.missing).toEqual([...CORE]);
    const view = () => listDdWorkspace(projectId).domains.find((x) => x.checklistId === BF_FEASIBILITY_CHECKLIST_ID)!.items.find((i) => i.id === BF_VALIDATORS_ITEM_ID)!.state;
    expect(view()).toMatchObject({ status: "fail", derived: true, assessed_by: "validator-engine" });
    expect(view()?.note).toContain("antitrust");
    const unmetWithout = ddCompletionSummary(projectId).mandatoryUnmet;
    expect(unmetWithout).toBeGreaterThanOrEqual(1); // the manual pass does not satisfy bf-01
    // the manual write is refused (and leaves the stored row alone)
    const put = await nextRequest(`/api/projects/${projectId}/dd-checklist/state`, {
      method: "PUT", headers: { cookie }, body: JSON.stringify({ checklist_id: BF_FEASIBILITY_CHECKLIST_ID, item_id: BF_VALIDATORS_ITEM_ID, status: "pass", note: "reviewed by hand" }),
    });
    expect(put.status).toBe(409);
    expect((await errOf(put)).code).toBe("derived_item");
    // another item of the same checklist is still hand-judged
    const other = await nextRequest(`/api/projects/${projectId}/dd-checklist/state`, {
      method: "PUT", headers: { cookie }, body: JSON.stringify({ checklist_id: BF_FEASIBILITY_CHECKLIST_ID, item_id: "bf-04", status: "pass" }),
    });
    expect(other.status).toBe(200);
    // recording the six validators flips the derived verdict, the view and the completion count
    for (const k of CORE) writeValidator(projectId, k);
    expect(derivedBf01(projectId)).toMatchObject({ status: "pass", missing: [] });
    expect(view()).toMatchObject({ status: "pass", derived: true });
    expect(ddCompletionSummary(projectId).mandatoryUnmet).toBe(unmetWithout - 1);
  });

  test("shadow: reads are not derived, the manual write is accepted and audited as a would-block", async () => {
    setFlags("shadow", "validators");
    const { projectId } = bfProject();
    const before = audits("gate_integrity.would_block:derived_item");
    const put = await nextRequest(`/api/projects/${projectId}/dd-checklist/state`, {
      method: "PUT", headers: { cookie }, body: JSON.stringify({ checklist_id: BF_FEASIBILITY_CHECKLIST_ID, item_id: BF_VALIDATORS_ITEM_ID, status: "pass" }),
    });
    expect(put.status).toBe(200);
    expect(audits("gate_integrity.would_block:derived_item")).toBe(before + 1);
    expect(derivedBf01(projectId)).toBeNull();
    expect(listDdWorkspace(projectId).domains.find((x) => x.checklistId === BF_FEASIBILITY_CHECKLIST_ID)!.items.find((i) => i.id === BF_VALIDATORS_ITEM_ID)!.state?.derived).toBeUndefined();
  });

  test("a project without the brownfield-feasibility checklist (greenfield) has no bf-01 to derive", () => {
    setFlags("enforce", "validators");
    const gf = S.seedReadyProject(db, ANALYST);
    expect(derivedBf01(gf.projectId)).toBeNull();
  });
});

describe("bf-03 - certification transferability at a brownfield pre_fs GO (owner decision O-3)", () => {
  function cert(projectId: string, over: Record<string, unknown> = {}): string {
    const id = ulid();
    const row = { name: "KC safety certification", load_bearing: 1, transferability_basis: null, transferable_on_coc: null, transferability_evidence_ref: null, confirmed_at: null, ...over };
    db.run(
      "INSERT INTO certification (id, project_id, name, agency, status, transferability_basis, transferable_on_coc, transferability_evidence_ref, load_bearing, confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [id, projectId, row.name, "KTL", "granted", row.transferability_basis, row.transferable_on_coc, row.transferability_evidence_ref, row.load_bearing, row.confirmed_at] as never,
    );
    return id;
  }

  test("certificationProblem: confirmed only with basis verified, a yes/no position, an evidence reference and confirmed_at", () => {
    const base = { transferability_basis: "verified", transferable_on_coc: "yes", transferability_evidence_ref: "kab:rule-12", confirmed_at: S.NOW };
    expect(certificationProblem(base)).toBeNull();
    expect(certificationProblem({ ...base, transferable_on_coc: "no" })).toBeNull(); // confirmed non-transferable is a confirmation
    expect(certificationProblem({ ...base, transferability_basis: "inferred" })).toBe("not_verified");
    expect(certificationProblem({ ...base, transferability_basis: null })).toBe("not_verified");
    expect(certificationProblem({ ...base, transferable_on_coc: null })).toBe("no_position");
    expect(certificationProblem({ ...base, transferability_evidence_ref: " " })).toBe("no_evidence");
    expect(certificationProblem({ ...base, confirmed_at: null })).toBe("not_confirmed");
  });

  test("enforce: an unconfirmed load-bearing certification blocks the pre_fs GO; confirming it, or it not being load-bearing, lifts the block; HOLD / KILL are not blocked", () => {
    setFlags("enforce", "validators");
    const { projectId, oppId } = bfProject();
    const certId = cert(projectId);
    cert(projectId, { name: "Not load-bearing", load_bearing: 0 });
    expect(unconfirmedLoadBearingCertifications(db, oppId)).toMatchObject([{ id: certId, problem: "not_verified", project_id: projectId }]);
    const blocked = recordGate("opportunity", oppId, "pre_fs");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.failure).toMatchObject({ status: 409, code: "certification_unconfirmed" });
      expect(blocked.failure.details?.certifications).toMatchObject([{ id: certId }]);
    }
    expect(gateRows(oppId, "pre_fs")).toBe(0);
    expect(recordGate("opportunity", oppId, "pre_fs", "hold").ok).toBe(true);
    expect(recordGate("opportunity", oppId, "pre_fs", "kill").ok).toBe(true);
    // the snapshot of the opportunity names it
    db.run("UPDATE certification SET transferability_basis = 'inferred', transferable_on_coc = 'yes' WHERE id = ?", [certId]);
    expect(recordGate("opportunity", oppId, "pre_fs").ok).toBe(false); // inference is not confirmation
    db.run("UPDATE certification SET transferability_basis = 'verified', transferability_evidence_ref = 'certifying body rule 12.3', confirmed_at = ? WHERE id = ?", [S.NOW, certId]);
    const ok = recordGate("opportunity", oppId, "pre_fs");
    expect(ok.ok).toBe(true);
    expect(gateRows(oppId, "pre_fs")).toBe(3);
  });

  test("the opportunity snapshot lists the hard block; shadow audits and records; off and non-pre_fs gates and greenfield are untouched", async () => {
    const { projectId, oppId } = bfProject();
    const certId = cert(projectId);
    setFlags("enforce", "validators");
    const snap = await dataOf<any>(await nextRequest(`/api/opportunities/${oppId}/gate-snapshot?gate=pre_fs`, { headers: { cookie } }));
    expect(snap.snapshot.hard_blocks).toContainEqual({ code: "certification_unconfirmed", keys: [certId], enforced: true });
    clearSnapshotCache();
    const target = await dataOf<any>(await nextRequest(`/api/opportunities/${oppId}/gate-snapshot?gate=target_screening`, { headers: { cookie } }));
    expect(target.snapshot.hard_blocks.filter((b: any) => b.code === "certification_unconfirmed")).toEqual([]);
    setFlags("shadow", "validators");
    const before = audits("gate_integrity.would_block:certification_unconfirmed");
    expect(recordGate("opportunity", oppId, "pre_fs").ok).toBe(true);
    expect(audits("gate_integrity.would_block:certification_unconfirmed")).toBe(before + 1);
    setFlags("off", "validators");
    const b2 = bfProject();
    cert(b2.projectId);
    expect(recordGate("opportunity", b2.oppId, "pre_fs").ok).toBe(true);
    // greenfield opportunity: bf-03 is a brownfield rule
    setFlags("enforce", "validators");
    const gfOpp = S.insertOpportunity(db, "greenfield", ANALYST);
    const gfProject = S.insertProject(db, gfOpp, "greenfield");
    cert(gfProject);
    expect(recordGate("opportunity", gfOpp, "pre_fs").ok).toBe(true);
  });

  test("known gap: an opportunity with no promoted project has no certification record, so the check passes vacuously", () => {
    setFlags("enforce", "validators");
    const opp = S.insertOpportunity(db, "brownfield", ANALYST);
    expect(unconfirmedLoadBearingCertifications(db, opp)).toEqual([]);
    expect(recordGate("opportunity", opp, "pre_fs").ok).toBe(true);
  });
});
