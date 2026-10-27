// @version 1.0.0
/**
 * ADR-0186 P3 - maker / checker on entity_ic and group_ic GO, condition precedents, Group IC kill overrides and
 * the checker-grant rule, on the real Route Handlers against a scratch SQLite.
 *   countersign : same-user 403 (no state change), non-holder 403, revoked grant 409, admin/viewer/non-member/bearer refused,
 *                 approved / conditional / rejected, one countersign per decision, HOLD / KILL / legacy not applicable
 *   effective   : an un-countersigned IC GO is not-GO for the ladder, S11, the process gate status, the stage-gate derivation,
 *                 the IC package and the gate-decisions GET (strict only under maker_checker = enforce; shadow audits)
 *   conditions  : created with an IC GO, listed in the snapshot, cleared by a different eligible user, block the group_ic GO
 *                 and S11 completion, never deleted
 *   override    : issued by a group-ic-reviewer, honoured end to end by the kill_binding family, issuer != recorder, revoke, audit
 *   grants      : an admin cannot seat the maker of a pending IC GO as its checker (family maker_checker)
 */
import { test, expect, beforeAll, afterAll, afterEach, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-gate-integrity-p3-mc.sqlite");
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
const { issueApiToken } = await import("../../db/lib/api-tokens.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { revokeHumanRoleGrant } = await import("../../db/lib/human-roles.ts");
const { GATE_INTEGRITY_FAMILIES, gateIntegrityEnvName } = await import("../../app/web-next/lib/gate-integrity-flags.ts");
const { resetRateLimits } = await import("../../app/web-next/lib/gate-integrity.ts");
const { clearSnapshotCache } = await import("../../app/web-next/lib/gate-snapshot.ts");
const { evaluateProcess, latestGateDecisions } = await import("../../app/web-next/lib/process-flow.ts");
const { ladderBlock } = await import("../../app/web-next/lib/gate-ladder.ts");
const { countersignState, effectiveGoTimes, effectiveGateVerdict } = await import("../../db/lib/gate-effective.ts");
const { s11ConditionBlockers } = await import("../../app/web-next/lib/gate-conditions.ts");
const { recomputeRag } = await import("../../db/lib/rag-service.ts");
const S = await import("./_gate-integrity-support.ts");

const ADMIN = "p3-admin";
const MAKER = "p3-maker";
const CHECKER = "p3-checker";
const OTHER = "p3-other"; // member, no grant
const OUTSIDER = "p3-outsider"; // not a member
const VIEWER = "p3-viewer";
const cookies: Record<string, string> = {};
const grants: Record<string, string> = {};

const flagNames = GATE_INTEGRITY_FAMILIES.map(gateIntegrityEnvName);
function setFlags(mode: "off" | "shadow" | "enforce", ...families: Array<(typeof GATE_INTEGRITY_FAMILIES)[number]>) {
  for (const f of families) process.env[gateIntegrityEnvName(f)] = mode;
}
afterEach(() => {
  for (const n of flagNames) delete process.env[n];
  clearSnapshotCache();
  resetRateLimits();
});

async function login(userId: string, role: "analyst" | "viewer" | "admin"): Promise<string> {
  await createUser(db, { userId, role, password: `pw-${userId}-123456`, createdBy: "test", now: S.NOW });
  approveUser(db, { userId, approvedBy: "test", now: S.NOW });
  db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = ?", [userId]);
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password: `pw-${userId}-123456` }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  for (const [u, r] of [[ADMIN, "admin"], [MAKER, "analyst"], [CHECKER, "analyst"], [OTHER, "analyst"], [OUTSIDER, "analyst"], [VIEWER, "viewer"]] as const) {
    cookies[u] = await login(u, r);
  }
  grants.entity = await S.grantRole(db, CHECKER, "entity-ic-reviewer", ADMIN);
  grants.group = await S.grantRole(db, CHECKER, "group-ic-reviewer", ADMIN);
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

const errOf = async (res: Response) => ((await res.json()) as { error: { code: string; details?: Record<string, any> } }).error;
const dataOf = async <T = any>(res: Response) => ((await res.json()) as { data: T }).data;
const count = (sql: string, ...args: unknown[]) => (db.query(sql).get(...(args as any[])) as { c: number }).c;
const audits = (action: string) => count("SELECT COUNT(*) c FROM audit_log WHERE action = ?", action);

/** A project the maker leads, with the checker and a no-grant colleague on the deal. */
function icProject(): { projectId: string; oppId: string } {
  const r = S.seedIcReadyProject(db, MAKER);
  S.addMember(db, r.projectId, CHECKER);
  S.addMember(db, r.projectId, OTHER);
  return r;
}

const post = (pid: string, body: Record<string, unknown>, who = MAKER) =>
  nextRequest(`/api/projects/${pid}/gate-decisions`, { method: "POST", headers: { cookie: cookies[who] }, body: JSON.stringify(body) });
const recordIc = (pid: string, gate: "entity_ic" | "group_ic", extra: Record<string, unknown> = {}, who = MAKER) =>
  post(pid, { gate, decision: "go", rationale: S.IC_RATIONALE, gap_rationale: S.IC_GAP, ...extra }, who);
const countersign = (pid: string, decisionId: string, body: Record<string, unknown>, who = CHECKER) =>
  nextRequest(`/api/projects/${pid}/gate-decisions/${decisionId}/countersign`, { method: "POST", headers: { cookie: cookies[who] }, body: JSON.stringify(body) });
const approve = (pid: string, decisionId: string, who = CHECKER) =>
  countersign(pid, decisionId, { decision: "approved", reason: "The package was reviewed independently and the decision stands" }, who);
const listDecisions = async (pid: string, who = MAKER) => dataOf<any>(await nextRequest(`/api/projects/${pid}/gate-decisions`, { headers: { cookie: cookies[who] } }));
const chainRow = (pid: string, gate: string) => db.query("SELECT * FROM approval_chain WHERE project_id = ? AND gate = ?").get(pid, gate) as Record<string, any> | null;

/** Record an entity_ic GO under the contract and return its id (all P3 families enforced unless the caller overrides). */
async function icGoUnderContract(pid: string, gate: "entity_ic" | "group_ic" = "entity_ic", extra: Record<string, unknown> = {}): Promise<string> {
  const res = await recordIc(pid, gate, extra);
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await dataOf<{ id: string }>(res)).id;
}

describe("effective state - an IC GO is in force only after a different reviewer countersigns it", () => {
  test("enforce: the recorded GO reads pending everywhere; after the countersign it is GO everywhere", async () => {
    setFlags("enforce", "maker_checker", "ladder");
    const { projectId } = icProject();
    const res = await recordIc(projectId, "entity_ic");
    expect(res.status).toBe(201);
    const rec = await dataOf<any>(res);
    expect(rec).toMatchObject({ gate: "entity_ic", decision: "go", awaiting_countersign: true, conditions: [] });
    const id = rec.id as string;
    // the contract stored a snapshot (so this is not a legacy row) and noted the maker on the chain
    expect(count("SELECT COUNT(*) c FROM gate_decision_snapshot WHERE decision_id = ?", id)).toBe(1);
    expect(chainRow(projectId, "entity_ic")).toMatchObject({ recorded_by: MAKER, decided_by: null, gate_decision_id: null });

    // gate-decisions GET: the effective verdict is pending, the recorded one is GO, the state says why
    const view = await listDecisions(projectId);
    const entity = view.latest.find((l: any) => l.gate === "entity_ic");
    expect(entity).toMatchObject({ decision: "pending", recorded_decision: "go", countersign_state: "pending_countersign", awaiting_countersign: true, decision_id: id });
    expect(view.history.find((h: any) => h.id === id)).toMatchObject({ decision: "go", countersign_state: "pending_countersign", countersign: null });
    // process engine / S11 / pipeline read the effective state
    const ev = evaluateProcess({ type: "project", id: projectId });
    expect(ev.gateStatus.entity_ic).toBe("pending");
    expect(ev.awaitingCountersign).toEqual(["entity_ic"]);
    expect(ev.blockers.some((b) => b.includes("countersign"))).toBe(true);
    // the ladder: group_ic needs an EFFECTIVE entity_ic GO
    expect(ladderBlock("project", projectId, "group_ic")).toMatchObject({ blocker: "entity_ic" });
    const blocked = await recordIc(projectId, "group_ic");
    expect(blocked.status).toBe(409);
    const blockedErr = await errOf(blocked);
    expect(blockedErr.code).toBe("gate_prerequisites_incomplete");
    expect(blockedErr.details).toMatchObject({ blocker: "entity_ic", awaiting_countersign: true });
    expect(count("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ? AND gate = 'group_ic'", projectId)).toBe(0);
    // the stage-gate derivation of the RAG engine does not count it as reached
    expect(recomputeRag(db, projectId, "manual", { actor: MAKER, now: S.NOW }).stageGate).toBe("entity_ic");
    // the IC package carries both verdicts
    const pkg = await dataOf<any>(await nextRequest(`/api/projects/${projectId}/ic-package`, { headers: { cookie: cookies[MAKER] } }));
    expect(pkg.gates.latest.find((g: any) => g.gate === "entity_ic")).toMatchObject({ decision: "pending", recorded_decision: "go", awaiting_countersign: true, countersign_state: "pending_countersign" });
    expect(effectiveGoTimes(db, projectId, ["entity_ic"])).toEqual([]);
    // the group_ic snapshot says why the ladder is not satisfied
    const snap = await dataOf<any>(await nextRequest(`/api/projects/${projectId}/gate-snapshot?gate=group_ic`, { headers: { cookie: cookies[MAKER] } }));
    expect(snap.snapshot.ladder).toMatchObject({ prior_gate: "entity_ic", prior_decision: "go", prior_decision_id: id, effective: false, blocker: "entity_ic", prior_awaiting_countersign: true });

    // the checker countersigns
    const ok = await approve(projectId, id);
    expect(ok.status).toBe(201);
    expect(await dataOf<any>(ok)).toMatchObject({ id, gate: "entity_ic", decision: "approved", countersign_state: "countersigned", effective: true });
    expect(chainRow(projectId, "entity_ic")).toMatchObject({ status: "approved", decided_by: CHECKER, gate_decision_id: id, recorded_by: MAKER });
    expect(chainRow(projectId, "entity_ic")!.decision_reason).toContain("reviewed independently");
    expect(audits("gate_decision.countersign")).toBeGreaterThan(0);
    const after = await listDecisions(projectId);
    expect(after.latest.find((l: any) => l.gate === "entity_ic")).toMatchObject({ decision: "go", recorded_decision: "go", countersign_state: "countersigned", awaiting_countersign: false });
    expect(after.history.find((h: any) => h.id === id).countersign).toMatchObject({ status: "approved", by: CHECKER });
    expect(evaluateProcess({ type: "project", id: projectId }).gateStatus.entity_ic).toBe("go");
    expect(ladderBlock("project", projectId, "group_ic")).toBeNull();
    expect(effectiveGoTimes(db, projectId, ["entity_ic"])).toHaveLength(1);
    expect(effectiveGateVerdict(db, projectId, "entity_ic")).toMatchObject({ verdict: "go", state: "countersigned" });
    expect(recomputeRag(db, projectId, "manual", { actor: MAKER, now: S.NOW }).stageGate).toBe("group_ic");
    const group = await recordIc(projectId, "group_ic");
    expect(group.status, JSON.stringify(await group.clone().json())).toBe(201);
  });

  test("off and shadow: consumers keep reading the recorded GO (the label still says awaiting); shadow audits the would-block", async () => {
    setFlags("shadow", "maker_checker");
    setFlags("shadow", "ladder");
    const { projectId } = icProject();
    const id = await icGoUnderContract(projectId, "entity_ic");
    const view = await listDecisions(projectId);
    expect(view.latest.find((l: any) => l.gate === "entity_ic")).toMatchObject({ decision: "go", recorded_decision: "go", awaiting_countersign: true });
    expect(evaluateProcess({ type: "project", id: projectId }).gateStatus.entity_ic).toBe("go");
    expect(ladderBlock("project", projectId, "group_ic")).toBeNull();
    expect(ladderBlock("project", projectId, "group_ic", { strict: true })).toMatchObject({ blocker: "entity_ic" });
    const before = audits("gate_integrity.would_block:countersign_pending");
    const group = await recordIc(projectId, "group_ic");
    expect(group.status).toBe(201); // shadow never blocks
    expect(audits("gate_integrity.would_block:countersign_pending")).toBe(before + 1);
    expect(chainRow(projectId, "entity_ic")).toMatchObject({ recorded_by: MAKER, gate_decision_id: null });
    expect(id).toBeTruthy();
  });

  test("legacy = at or before the PERSISTED cutoff, never a missing snapshot: a GO without a snapshot after the cutoff is pending; a decision below the cutoff is effective and not countersignable", async () => {
    // (a) recorded with every family off: no snapshot, but AFTER the cutoff -> not legacy, so under enforce it is pending
    const { projectId } = icProject();
    const res = await recordIc(projectId, "entity_ic"); // flags default to off in the unit environment
    expect(res.status).toBe(201);
    const id = (await dataOf<any>(res)).id as string;
    expect(count("SELECT COUNT(*) c FROM gate_decision_snapshot WHERE decision_id = ?", id)).toBe(0);
    setFlags("enforce", "maker_checker", "ladder");
    expect(countersignState(db, projectId, { id, gate: "entity_ic", decision: "go", decided_by: MAKER })).toBe("pending_countersign");
    expect(evaluateProcess({ type: "project", id: projectId }).gateStatus.entity_ic).toBe("pending");
    // (b) simulate a pre-contract row by moving the (otherwise immutable) cutoff over it
    const cut = db.query("SELECT max_decision_rowid m FROM gate_integrity_cutoff WHERE name = 'maker_checker'").get() as { m: number };
    expect(() => db.run("UPDATE gate_integrity_cutoff SET max_decision_rowid = 0")).toThrow(/fixed once written/);
    db.run("DROP TRIGGER trg_gate_integrity_cutoff_no_update");
    try {
      const rowid = (db.query("SELECT rowid r FROM gate_decision WHERE id = ?").get(id) as { r: number }).r;
      db.run("UPDATE gate_integrity_cutoff SET max_decision_rowid = ?", [rowid]);
      expect(evaluateProcess({ type: "project", id: projectId }).gateStatus.entity_ic).toBe("go");
      expect(ladderBlock("project", projectId, "group_ic")).toBeNull();
      const view = await listDecisions(projectId);
      expect(view.latest.find((l: any) => l.gate === "entity_ic")).toMatchObject({ decision: "go", countersign_state: "legacy", awaiting_countersign: false });
      const cs = await approve(projectId, id);
      expect(cs.status).toBe(409);
      expect((await errOf(cs)).code).toBe("countersign_not_applicable");
    } finally {
      db.run("UPDATE gate_integrity_cutoff SET max_decision_rowid = ?", [cut.m]);
      db.run("CREATE TRIGGER trg_gate_integrity_cutoff_no_update BEFORE UPDATE ON gate_integrity_cutoff BEGIN SELECT RAISE(ABORT, 'gate_integrity_cutoff is fixed once written (ADR-0186)'); END");
    }
    expect(() => db.run("DELETE FROM gate_integrity_cutoff")).toThrow(/fixed once written/);
  });

  test("B1: a snapshot-build fault in shadow mode cannot forge an effective IC GO - after the flip to enforce it is pending", async () => {
    setFlags("shadow", "maker_checker");
    const { projectId } = icProject();
    // force the snapshot builder to fail (the shadow fallback then records the GO without a snapshot)
    db.run("ALTER TABLE kill_criteria_override RENAME TO kill_criteria_override_off");
    let id: string;
    const errSpy = console.error;
    console.error = () => {};
    try {
      const res = await recordIc(projectId, "entity_ic");
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
      id = (await dataOf<any>(res)).id as string;
    } finally {
      console.error = errSpy;
      db.run("ALTER TABLE kill_criteria_override_off RENAME TO kill_criteria_override");
    }
    expect(count("SELECT COUNT(*) c FROM gate_decision_snapshot WHERE decision_id = ?", id)).toBe(0);
    expect(audits("gate_integrity.would_block:snapshot_error")).toBeGreaterThan(0);
    setFlags("enforce", "maker_checker", "ladder");
    expect(countersignState(db, projectId, { id, gate: "entity_ic", decision: "go", decided_by: MAKER })).toBe("pending_countersign");
    expect(evaluateProcess({ type: "project", id: projectId }).gateStatus.entity_ic).toBe("pending");
    expect(ladderBlock("project", projectId, "group_ic")).toMatchObject({ blocker: "entity_ic" });
    expect((await approve(projectId, id)).status).toBe(201); // a different reviewer can still put it in force
    expect(evaluateProcess({ type: "project", id: projectId }).gateStatus.entity_ic).toBe("go");
  });

  test("HOLD and KILL are effective at once and need no countersign", async () => {
    setFlags("enforce", "maker_checker");
    const { projectId } = icProject();
    const hold = await post(projectId, { gate: "entity_ic", decision: "hold", rationale: "x", missing_artifacts: ["a missing deliverable"] });
    expect(hold.status).toBe(201);
    const holdId = (await dataOf<any>(hold)).id as string;
    const view = await listDecisions(projectId);
    expect(view.latest.find((l: any) => l.gate === "entity_ic")).toMatchObject({ decision: "hold", awaiting_countersign: false });
    const cs = await approve(projectId, holdId);
    expect(cs.status).toBe(409);
    expect((await errOf(cs)).code).toBe("countersign_not_applicable");
  });
});

describe("countersign - authorization and integrity", () => {
  test("the recorder cannot countersign their own GO: 403 checker_must_differ and NO state change", async () => {
    setFlags("enforce", "maker_checker");
    const { projectId } = icProject();
    const id = await icGoUnderContract(projectId);
    // give the maker the grant too: even then the same person cannot be the checker
    const chainBefore = chainRow(projectId, "entity_ic");
    const auditsBefore = audits("gate_decision.countersign");
    const g = await S.grantRole(db, MAKER, "entity-ic-reviewer", ADMIN);
    const res = await approve(projectId, id, MAKER);
    expect(res.status).toBe(403);
    expect((await errOf(res)).code).toBe("checker_must_differ");
    expect(chainRow(projectId, "entity_ic")).toEqual(chainBefore);
    expect(audits("gate_decision.countersign")).toBe(auditsBefore);
    expect(evaluateProcess({ type: "project", id: projectId }).gateStatus.entity_ic).toBe("pending");
    revokeHumanRoleGrant(db, { id: g, revokedBy: ADMIN, now: S.NOW });
  });

  test("deny-by-default: a member without the grant, the wrong-role holder, admin, viewer, a non-member, a bearer token are all refused", async () => {
    setFlags("enforce", "maker_checker");
    const { projectId } = icProject();
    const id = await icGoUnderContract(projectId);
    const before = chainRow(projectId, "entity_ic");
    const noGrant = await approve(projectId, id, OTHER);
    expect(noGrant.status).toBe(403);
    expect((await errOf(noGrant)).code).toBe("human_role_required");
    // a group-ic-reviewer alone cannot countersign the ENTITY committee's GO
    const GROUP_ONLY = "p3-group-only";
    await login(GROUP_ONLY, "analyst").then((c) => { cookies[GROUP_ONLY] = c; });
    S.addMember(db, projectId, GROUP_ONLY);
    await S.grantRole(db, GROUP_ONLY, "group-ic-reviewer", ADMIN);
    const wrongRole = await approve(projectId, id, GROUP_ONLY);
    expect(wrongRole.status).toBe(403);
    expect((await errOf(wrongRole)).code).toBe("human_role_required");
    expect((await approve(projectId, id, ADMIN)).status).toBe(403);
    expect((await approve(projectId, id, VIEWER)).status).toBe(403);
    expect((await approve(projectId, id, OUTSIDER)).status).toBe(404);
    const { token } = issueApiToken(db, { userId: CHECKER, label: "p3-test", scopes: ["read", "write"], now: S.NOW });
    const bearer = await nextRequest(`/api/projects/${projectId}/gate-decisions/${id}/countersign`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ decision: "approved", reason: "The package was reviewed independently" }) });
    expect(bearer.status).toBe(403);
    expect((await errOf(bearer)).code).toBe("human_only");
    expect((await nextRequest(`/api/projects/${projectId}/gate-decisions/${id}/countersign`, { method: "POST", body: "{}" })).status).toBe(401);
    expect(chainRow(projectId, "entity_ic")).toEqual(before);
    expect(evaluateProcess({ type: "project", id: projectId }).gateStatus.entity_ic).toBe("pending");
  });

  test("a grant revoked after it was issued answers 409 grant_revoked and changes nothing", async () => {
    setFlags("enforce", "maker_checker");
    const { projectId } = icProject();
    const id = await icGoUnderContract(projectId);
    const REV = "p3-revoked-checker";
    cookies[REV] = await login(REV, "analyst");
    S.addMember(db, projectId, REV);
    const gid = await S.grantRole(db, REV, "entity-ic-reviewer", ADMIN);
    revokeHumanRoleGrant(db, { id: gid, revokedBy: ADMIN, now: S.NOW });
    const before = chainRow(projectId, "entity_ic");
    const res = await approve(projectId, id, REV);
    expect(res.status).toBe(409);
    expect((await errOf(res)).code).toBe("grant_revoked");
    expect(chainRow(projectId, "entity_ic")).toEqual(before);
    // a checker whose grant is live still can
    expect((await approve(projectId, id)).status).toBe(201);
  });

  test("approved once: a second countersign, a countersign of a superseded decision, an unknown id and a wrong project are refused", async () => {
    setFlags("enforce", "maker_checker");
    const { projectId } = icProject();
    const first = await icGoUnderContract(projectId);
    expect((await approve(projectId, first)).status).toBe(201);
    const again = await approve(projectId, first);
    expect(again.status).toBe(409);
    expect((await errOf(again)).code).toBe("already_countersigned");
    // a re-decision supersedes the first one; the old id cannot be countersigned (and the new GO needs its own countersign)
    const second = await icGoUnderContract(projectId);
    const stale = await countersign(projectId, first, { decision: "approved", reason: "The package was reviewed independently again" });
    expect(stale.status).toBe(409);
    expect(["decision_superseded", "already_countersigned"]).toContain((await errOf(stale)).code);
    expect(evaluateProcess({ type: "project", id: projectId }).gateStatus.entity_ic).toBe("pending");
    expect((await approve(projectId, second)).status).toBe(201);
    expect(evaluateProcess({ type: "project", id: projectId }).gateStatus.entity_ic).toBe("go");
    expect((await approve(projectId, "nope")).status).toBe(404);
    const other = icProject();
    expect((await approve(other.projectId, second)).status).toBe(404);
  });

  test("rejected leaves the GO non-effective and on the record; the maker records a new decision that needs its own countersign", async () => {
    setFlags("enforce", "maker_checker");
    const { projectId } = icProject();
    const id = await icGoUnderContract(projectId);
    const res = await countersign(projectId, id, { decision: "rejected", reason: "The financing plan does not close; resubmit with a funded plan" });
    expect(res.status).toBe(201);
    expect(await dataOf<any>(res)).toMatchObject({ decision: "rejected", countersign_state: "countersign_rejected", effective: false });
    expect(evaluateProcess({ type: "project", id: projectId }).gateStatus.entity_ic).toBe("pending");
    const view = await listDecisions(projectId);
    expect(view.history.find((h: any) => h.id === id)).toMatchObject({ decision: "go", countersign_state: "countersign_rejected", countersign: { status: "rejected", by: CHECKER } });
    const retry = await approve(projectId, id);
    expect(retry.status).toBe(409);
    const next = await icGoUnderContract(projectId);
    expect(next).not.toBe(id);
    expect((await approve(projectId, next)).status).toBe(201);
    expect(evaluateProcess({ type: "project", id: projectId }).gateStatus.entity_ic).toBe("go");
  });

  test("validation: decision enum, reason required and substantive, conditional needs conditions, others must not carry them", async () => {
    setFlags("enforce", "maker_checker");
    const { projectId } = icProject();
    const id = await icGoUnderContract(projectId);
    expect((await countersign(projectId, id, { decision: "maybe", reason: "The package was reviewed independently" })).status).toBe(400);
    expect((await countersign(projectId, id, { decision: "approved" })).status).toBe(400);
    const weak = await countersign(projectId, id, { decision: "approved", reason: "ok" });
    expect(weak.status).toBe(422);
    expect((await errOf(weak)).code).toBe("rationale_insufficient");
    const noConds = await countersign(projectId, id, { decision: "conditional", reason: "Approved on the condition that consent is obtained" });
    expect(noConds.status).toBe(422);
    expect((await errOf(noConds)).code).toBe("conditions_required");
    const surplus = await countersign(projectId, id, { decision: "approved", reason: "The package was reviewed independently", conditions: [{ text: "Obtain the landlord consent letter", clear_by: "closing" }] });
    expect(surplus.status).toBe(400);
    expect(chainRow(projectId, "entity_ic")).toMatchObject({ gate_decision_id: null });
  });

  test("conditional: the checker's conditions become condition precedents created by the checker", async () => {
    setFlags("enforce", "maker_checker", "validators");
    const { projectId } = icProject();
    const id = await icGoUnderContract(projectId);
    const res = await countersign(projectId, id, {
      decision: "conditional", reason: "Approved on the condition that the landlord consent is obtained",
      conditions: [{ text: "Obtain the landlord consent letter before closing", clear_by: "closing", owner_role: "legal-counsel" }],
    });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    const d = await dataOf<any>(res);
    expect(d).toMatchObject({ countersign_state: "countersigned", effective: true });
    expect(d.conditions).toHaveLength(1);
    expect(db.query("SELECT created_by, origin, status, clear_by, owner_role, source_decision_id FROM condition_precedent WHERE id = ?").get(d.conditions[0]))
      .toEqual({ created_by: CHECKER, origin: "countersign", status: "open", clear_by: "closing", owner_role: "legal-counsel", source_decision_id: id });
    expect(chainRow(projectId, "entity_ic")).toMatchObject({ status: "conditional", conditions: "Obtain the landlord consent letter before closing" });
    expect(evaluateProcess({ type: "project", id: projectId }).gateStatus.entity_ic).toBe("go"); // conditional is effective
    expect(audits("condition.create")).toBeGreaterThan(0);
  });
});

describe("conditions precedent", () => {
  test("an IC GO with conditions[] creates rows in the same transaction; invalid input is refused whatever the flag mode", async () => {
    const { projectId } = icProject();
    // shape errors are 400 / 422 with every family off
    const gone = (extra: Record<string, unknown>, gate = "entity_ic", decision = "go") => post(projectId, { gate, decision, rationale: S.IC_RATIONALE, gap_rationale: S.IC_GAP, missing_artifacts: ["a"], ...extra });
    expect((await gone({ conditions: "x" })).status).toBe(400);
    expect((await gone({ conditions: [{ text: "Obtain the landlord consent letter", clear_by: "someday" }] })).status).toBe(400);
    expect((await gone({ conditions: [{ clear_by: "closing" }] })).status).toBe(400);
    expect((await gone({ conditions: [{ text: "Obtain the landlord consent letter", clear_by: "closing" }] }, "dd")).status).toBe(400);
    expect((await gone({ conditions: [{ text: "Obtain the landlord consent letter", clear_by: "closing" }] }, "entity_ic", "hold")).status).toBe(400);
    const weak = await gone({ conditions: [{ text: "ok", clear_by: "closing" }] });
    expect(weak.status).toBe(422);
    expect((await errOf(weak)).code).toBe("rationale_insufficient");
    expect((await gone({ conditions: [{ text: "Obtain the landlord consent letter", clear_by: "group_ic" }] }, "group_ic")).status).toBe(400);
    expect(count("SELECT COUNT(*) c FROM condition_precedent WHERE project_id = ?", projectId)).toBe(0);
    expect(count("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ? AND gate IN ('entity_ic','group_ic')", projectId)).toBe(0);

    setFlags("enforce", "maker_checker", "validators");
    const res = await recordIc(projectId, "entity_ic", { conditions: [
      { text: "Obtain the landlord consent letter before closing", clear_by: "closing" },
      { text: "Confirm the final permit schedule with the authority", clear_by: "group_ic", owner_role: "certification-agent" },
    ] });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    const d = await dataOf<any>(res);
    expect(d.conditions).toHaveLength(2);
    const rows = await dataOf<any>(await nextRequest(`/api/projects/${projectId}/conditions`, { headers: { cookie: cookies[CHECKER] } }));
    expect(rows.conditions.map((c: any) => [c.clear_by, c.status, c.created_by, c.origin, c.source_decision_id])).toEqual([
      ["closing", "open", MAKER, "recorder", d.id], ["group_ic", "open", MAKER, "recorder", d.id],
    ]);
    expect((await nextRequest(`/api/projects/${projectId}/conditions?status=cleared`, { headers: { cookie: cookies[CHECKER] } }).then(dataOf)).conditions).toEqual([]);
    expect((await nextRequest(`/api/projects/${projectId}/conditions?status=zzz`, { headers: { cookie: cookies[CHECKER] } })).status).toBe(400);
    expect((await nextRequest(`/api/projects/${projectId}/conditions`, { headers: { cookie: cookies[OUTSIDER] } })).status).toBe(404);
    // listed in the snapshot and the IC package
    const snap = await dataOf<any>(await nextRequest(`/api/projects/${projectId}/gate-snapshot?gate=group_ic`, { headers: { cookie: cookies[MAKER] } }));
    expect(snap.snapshot.conditions_open.map((c: any) => c.clear_by).sort()).toEqual(["closing", "group_ic"]);
    expect(snap.snapshot.hard_blocks).toContainEqual({ code: "condition_open", keys: [expect.any(String)], enforced: true });
    const pkg = await dataOf<any>(await nextRequest(`/api/projects/${projectId}/ic-package`, { headers: { cookie: cookies[MAKER] } }));
    expect(pkg.gates.conditions_open).toBe(2);
    expect(pkg.gates.conditions).toHaveLength(2);
    expect(audits("condition.create")).toBeGreaterThanOrEqual(2);
  });

  test("clearing: a different grant holder, evidence for a closing condition, never the creator, not twice; a closed condition is immutable", async () => {
    setFlags("enforce", "maker_checker", "validators");
    const { projectId } = icProject();
    const id = await icGoUnderContract(projectId, "entity_ic", { conditions: [{ text: "Obtain the landlord consent letter before closing", clear_by: "closing" }] });
    const cond = db.query("SELECT id FROM condition_precedent WHERE project_id = ?").get(projectId) as { id: string };
    const clear = (body: Record<string, unknown>, who = CHECKER, cid = cond.id) =>
      nextRequest(`/api/projects/${projectId}/conditions/${cid}/clear`, { method: "POST", headers: { cookie: cookies[who] }, body: JSON.stringify(body) });
    const NOTE = "Landlord consent letter received and filed in the data room";
    expect((await clear({ note: NOTE }, OTHER)).status).toBe(403); // no grant
    expect((await errOf(await clear({ note: NOTE }, OTHER))).code).toBe("human_role_required");
    expect((await clear({ note: NOTE }, MAKER)).status).toBe(403);
    const { token } = issueApiToken(db, { userId: CHECKER, label: "p3-clear", scopes: ["read", "write"], now: S.NOW });
    expect((await nextRequest(`/api/projects/${projectId}/conditions/${cond.id}/clear`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ note: NOTE }) })).status).toBe(403);
    expect((await clear({ note: NOTE }, OUTSIDER)).status).toBe(404);
    expect((await clear({ note: NOTE }, CHECKER, "ghost")).status).toBe(404);
    expect((await clear({})).status).toBe(400);
    expect((await clear({ note: "ok" })).status).toBe(422);
    const noEvidence = await clear({ note: NOTE });
    expect(noEvidence.status).toBe(400);
    expect((await errOf(noEvidence)).code).toBe("evidence_required");
    // the creator cannot clear even with a grant
    const g = await S.grantRole(db, MAKER, "entity-ic-reviewer", ADMIN);
    const self = await clear({ note: NOTE, evidence_ref: "dataroom:consent-letter" }, MAKER);
    expect(self.status).toBe(403);
    expect((await errOf(self)).code).toBe("clearer_must_differ");
    revokeHumanRoleGrant(db, { id: g, revokedBy: ADMIN, now: S.NOW });
    const ok = await clear({ note: NOTE, evidence_ref: "dataroom:consent-letter" });
    expect(ok.status, JSON.stringify(await ok.clone().json())).toBe(200);
    expect((await dataOf<any>(ok)).condition).toMatchObject({ status: "cleared", cleared_by: CHECKER, evidence_ref: "dataroom:consent-letter" });
    expect(audits("condition.clear")).toBeGreaterThan(0);
    const twice = await clear({ note: NOTE, evidence_ref: "dataroom:other" });
    expect(twice.status).toBe(409);
    expect((await errOf(twice)).code).toBe("condition_not_open");
    expect(() => db.run("UPDATE condition_precedent SET text = 'x' WHERE id = ?", [cond.id])).toThrow(/immutable/);
    expect(() => db.run("DELETE FROM condition_precedent WHERE id = ?", [cond.id])).toThrow(/never deleted/);
    expect(id).toBeTruthy();
  });

  test("withdraw: same authorization, no evidence needed, audited", async () => {
    setFlags("enforce", "maker_checker", "validators");
    const { projectId } = icProject();
    await icGoUnderContract(projectId, "entity_ic", { conditions: [{ text: "Obtain the landlord consent letter before closing", clear_by: "establishment" }] });
    const cond = db.query("SELECT id FROM condition_precedent WHERE project_id = ?").get(projectId) as { id: string };
    const url = `/api/projects/${projectId}/conditions/${cond.id}/withdraw`;
    expect((await nextRequest(url, { method: "POST", headers: { cookie: cookies[OTHER] }, body: JSON.stringify({ note: "No longer needed after the lease change" }) })).status).toBe(403);
    const res = await nextRequest(url, { method: "POST", headers: { cookie: cookies[CHECKER] }, body: JSON.stringify({ note: "No longer needed after the lease change" }) });
    expect(res.status).toBe(200);
    expect((await dataOf<any>(res)).condition).toMatchObject({ status: "withdrawn", cleared_by: CHECKER });
    expect(audits("condition.withdraw")).toBe(1);
  });

  test("open group_ic conditions block the group_ic GO until cleared (409 condition_open); other families unaffected", async () => {
    setFlags("enforce", "maker_checker", "validators");
    const { projectId } = icProject();
    const id = await icGoUnderContract(projectId, "entity_ic", { conditions: [{ text: "Confirm the final permit schedule with the authority", clear_by: "group_ic" }] });
    expect((await approve(projectId, id)).status).toBe(201);
    const blocked = await recordIc(projectId, "group_ic");
    expect(blocked.status).toBe(409);
    const e = await errOf(blocked);
    expect(e.code).toBe("condition_open");
    expect(e.details?.conditions).toHaveLength(1);
    expect(count("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ? AND gate = 'group_ic'", projectId)).toBe(0);
    // HOLD / KILL are never blocked by a condition
    expect((await post(projectId, { gate: "group_ic", decision: "hold", rationale: "x", missing_artifacts: ["permit schedule"] })).status).toBe(201);
    const cond = db.query("SELECT id FROM condition_precedent WHERE project_id = ?").get(projectId) as { id: string };
    const cleared = await nextRequest(`/api/projects/${projectId}/conditions/${cond.id}/clear`, { method: "POST", headers: { cookie: cookies[CHECKER] }, body: JSON.stringify({ note: "The authority confirmed the permit schedule in writing" }) });
    expect(cleared.status, JSON.stringify(await cleared.clone().json())).toBe(200);
    const ok = await recordIc(projectId, "group_ic");
    expect(ok.status, JSON.stringify(await ok.clone().json())).toBe(201);
    // shadow: audited, not blocked
    setFlags("shadow", "validators");
    const p2 = icProject();
    const id2 = await icGoUnderContract(p2.projectId, "entity_ic", { conditions: [{ text: "Confirm the final permit schedule with the authority", clear_by: "group_ic" }] });
    expect((await approve(p2.projectId, id2)).status).toBe(201);
    expect((await recordIc(p2.projectId, "group_ic")).status).toBe(201);
    expect(audits("gate_integrity.would_block:condition_open")).toBe(1);
  });

  test("open establishment / closing conditions keep S11 incomplete and block the execution baseline and establishment step 5; flag off and shadow do not", async () => {
    const { projectId } = icProject();
    const id = await icGoUnderContract(projectId, "entity_ic", { conditions: [
      { text: "Obtain the landlord consent letter before closing", clear_by: "closing" },
      { text: "Register the site lease before the establishment completes", clear_by: "establishment" },
      { text: "Confirm the final permit schedule with the authority", clear_by: "group_ic" },
    ] });
    expect(id).toBeTruthy();
    // off / shadow: no effect on the engine
    expect(s11ConditionBlockers(projectId)).toEqual({ blockers: [], missing: [] });
    setFlags("shadow", "validators");
    expect(s11ConditionBlockers(projectId)).toEqual({ blockers: [], missing: [] });
    setFlags("enforce", "validators");
    const cp = s11ConditionBlockers(projectId);
    expect(cp.blockers).toHaveLength(1);
    expect(cp.blockers[0]).toContain("2 open condition precedent");
    expect(cp.missing).toEqual(["IC condition precedents cleared"]); // the group_ic one waits for the group sitting, not S11
    const ev = evaluateProcess({ type: "project", id: projectId });
    expect(ev.stages.find((s) => s.id === "S11")!.status).not.toBe("complete");
    expect(ev.blockers.some((b) => b.includes("open condition precedent"))).toBe(true);
    // the execution baseline cannot be confirmed
    const { confirmExecutionBaseline } = await import("../../app/web-next/lib/greenfield-execution.ts");
    const conf = confirmExecutionBaseline({ projectId, rationale: "Confirming the execution baseline for the project", actor: MAKER });
    expect(conf.ok).toBe(false);
    expect(conf.ok === false && conf.code).toBe("condition_open");
    // closing every S11 condition lifts the blocker
    for (const c of db.query("SELECT id, clear_by FROM condition_precedent WHERE project_id = ? AND clear_by IN ('closing','establishment')").all(projectId) as Array<{ id: string; clear_by: string }>) {
      const r = await nextRequest(`/api/projects/${projectId}/conditions/${c.id}/clear`, { method: "POST", headers: { cookie: cookies[CHECKER] }, body: JSON.stringify({ note: "The condition was satisfied and documented in the data room", evidence_ref: "dataroom:evidence" }) });
      expect(r.status).toBe(200);
    }
    expect(s11ConditionBlockers(projectId)).toEqual({ blockers: [], missing: [] });
    expect(evaluateProcess({ type: "project", id: projectId }).blockers.some((b) => b.includes("open condition precedent"))).toBe(false);
    const after = confirmExecutionBaseline({ projectId, rationale: "Confirming the execution baseline for the project", actor: MAKER });
    expect(after.ok === false && after.code).not.toBe("condition_open"); // now blocked only by the baseline's own content rules
    // shadow / off did not block the confirmation before (covered by the unchanged baseline suite)
  });

  test("an acknowledged mark_conditional kill result becomes a condition precedent on an IC GO only", async () => {
    const { markConditionalConditions } = await import("../../app/web-next/lib/gate-decision-contract.ts");
    const snapshot = {
      kill: {
        triggered: [
          { key: "brownfield-dd:partner_dependency_unconfirmed_and_no_alternative", procedure: "brownfield-dd", criterion_id: "partner_dependency_unconfirmed_and_no_alternative", title: "Partner dependency unconfirmed", action: "mark_conditional", binding: false, override_id: null },
          { key: "entity-ic-review:x", procedure: "entity-ic-review", criterion_id: "x", title: "Escalation only", action: "escalate_to_risk_officer", binding: false, override_id: null },
        ],
      },
    } as any;
    const covered = [
      { key: "brownfield-dd:partner_dependency_unconfirmed_and_no_alternative", kind: "kill_triggered", reason: "The partner will be confirmed before closing" },
      { key: "entity-ic-review:x", kind: "kill_triggered", reason: "Escalated to the risk officer already" },
    ];
    expect(markConditionalConditions(snapshot, covered, "entity_ic")).toEqual([
      { text: "Partner dependency unconfirmed: The partner will be confirmed before closing", clear_by: "group_ic", owner_role: null, origin: "kill_conditional" },
    ]);
    expect(markConditionalConditions(snapshot, covered, "group_ic")[0].clear_by).toBe("closing");
    expect(markConditionalConditions(snapshot, covered, "dd")).toEqual([]); // the table is IC-scoped
    expect(markConditionalConditions(snapshot, [], "entity_ic")).toEqual([]); // not acknowledged -> nothing created
  });
});

describe("Group IC kill-criteria override", () => {
  const UNREVIEWED = "entity-ic-review:analysis_task_reviewed_by_null_on_required_deliverable";
  const triggerHalt = (projectId: string) => db.run("INSERT INTO analysis_task (id, project_id, deliverable_type, reviewed_by) VALUES (?,?,?,NULL)", [ulid(), projectId, "dd_report"]);
  const issue = (projectId: string, body: Record<string, unknown>, who = CHECKER) =>
    nextRequest(`/api/projects/${projectId}/kill-overrides`, { method: "POST", headers: { cookie: cookies[who] }, body: JSON.stringify(body) });
  const REASON = "The unreviewed deliverable is a supplementary appendix and is reviewed before closing";
  const body = { procedure_key: "entity-ic-review", criterion_id: "analysis_task_reviewed_by_null_on_required_deliverable", reason: REASON };

  test("only a group-ic-reviewer issues; halt criteria of the entity's own procedures only; one active per criterion; audited", async () => {
    const { projectId } = icProject();
    const early = await issue(projectId, body); // before any group_ic sitting (owner decision O-7)
    expect(early.status, JSON.stringify(await early.clone().json())).toBe(201);
    expect(await dataOf<any>(early)).toMatchObject({ entity_type: "project", entity_id: projectId, procedure_key: "entity-ic-review", issued_by: CHECKER });
    expect(audits("kill_override.issue")).toBeGreaterThan(0);
    const dup = await issue(projectId, body);
    expect(dup.status).toBe(409);
    expect((await errOf(dup)).code).toBe("override_exists");
    const p2 = icProject();
    for (const who of [OTHER, MAKER]) {
      const r = await issue(p2.projectId, body, who);
      expect(r.status).toBe(403);
      expect((await errOf(r)).code).toBe("human_role_required");
    }
    // an entity-ic-reviewer alone is not enough
    const ENTITY_ONLY = "p3-entity-only";
    cookies[ENTITY_ONLY] = await login(ENTITY_ONLY, "analyst");
    S.addMember(db, p2.projectId, ENTITY_ONLY);
    await S.grantRole(db, ENTITY_ONLY, "entity-ic-reviewer", ADMIN);
    expect((await issue(p2.projectId, body, ENTITY_ONLY)).status).toBe(403);
    expect((await issue(p2.projectId, body, ADMIN)).status).toBe(403); // admin is excluded by role separation
    expect((await issue(p2.projectId, body, OUTSIDER)).status).toBe(404);
    const { token } = issueApiToken(db, { userId: CHECKER, label: "p3-ov", scopes: ["read", "write"], now: S.NOW });
    expect((await nextRequest(`/api/projects/${p2.projectId}/kill-overrides`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) })).status).toBe(403);
    expect(count("SELECT COUNT(*) c FROM kill_criteria_override WHERE entity_id = ?", p2.projectId)).toBe(0);
    // validation
    expect((await issue(p2.projectId, { ...body, reason: "" })).status).toBe(400);
    expect((await issue(p2.projectId, { ...body, reason: "ok" })).status).toBe(422);
    expect((await issue(p2.projectId, { procedure_key: "entity-ic-review" })).status).toBe(400);
    expect((await issue(p2.projectId, { ...body, criterion_id: "no_such_criterion" })).status).toBe(422);
    expect((await issue(p2.projectId, { ...body, procedure_key: "greenfield-screening" })).status).toBe(422);
    const { loadKillCriteriaRegistry } = await import("../../app/web-next/lib/ic-review-steps.ts");
    const nonHalt = loadKillCriteriaRegistry("entity-ic-review").find((e) => e.action !== "halt");
    if (nonHalt) {
      const r = await issue(p2.projectId, { ...body, criterion_id: nonHalt.criterion_id });
      expect(r.status).toBe(422);
      expect((await errOf(r)).code).toBe("override_not_applicable");
    }
    // list + revoke
    const list = await dataOf<any>(await nextRequest(`/api/projects/${projectId}/kill-overrides`, { headers: { cookie: cookies[MAKER] } }));
    expect(list.overrides).toHaveLength(1);
    const oid = list.overrides[0].id as string;
    const rev = (who: string) => nextRequest(`/api/projects/${projectId}/kill-overrides/${oid}/revoke`, { method: "POST", headers: { cookie: cookies[who] } });
    expect((await rev(OTHER)).status).toBe(403);
    expect((await rev(CHECKER)).status).toBe(200);
    expect(audits("kill_override.revoke")).toBe(1);
    expect((await rev(CHECKER)).status).toBe(409);
    expect((await dataOf<any>(await nextRequest(`/api/projects/${projectId}/kill-overrides`, { headers: { cookie: cookies[MAKER] } }))).overrides).toEqual([]);
    const all = await dataOf<any>(await nextRequest(`/api/projects/${projectId}/kill-overrides?include_revoked=1`, { headers: { cookie: cookies[MAKER] } }));
    expect(all.overrides[0]).toMatchObject({ revoked_by: CHECKER });
    expect(() => db.run("DELETE FROM kill_criteria_override WHERE id = ?", [oid])).toThrow(/never deleted/);
    // after a revocation a fresh override can be issued
    expect((await issue(projectId, body)).status).toBe(201);
  });

  test("end to end (family kill_binding): without an override the GO is 409; with one issued by ANOTHER person it is accepted; the issuer cannot use their own", async () => {
    setFlags("enforce", "kill_binding");
    const { projectId } = icProject();
    triggerHalt(projectId);
    const blocked = await recordIc(projectId, "entity_ic");
    expect(blocked.status).toBe(409);
    expect((await errOf(blocked)).code).toBe("kill_binding_unoverridden");
    expect((await issue(projectId, body)).status).toBe(201);
    // the fixture project also trips the establishment classification halt of the IC procedure universe
    expect((await issue(projectId, { procedure_key: "entity-establishment-execution", criterion_id: "origin_classification_missing_at_entity_ic_exit", reason: REASON })).status).toBe(201);
    clearSnapshotCache();
    // the issuer recording the GO himself: refused (issuer is not the recorder of the decision it unblocks)
    const selfUse = await recordIc(projectId, "entity_ic", {}, CHECKER);
    expect(selfUse.status).toBe(409);
    const selfErr = await errOf(selfUse);
    expect(selfErr.code).toBe("kill_binding_unoverridden");
    expect(selfErr.details?.self_issued).toContain(UNREVIEWED);
    // the maker (a different person) records it
    const ok = await recordIc(projectId, "entity_ic");
    expect(ok.status, JSON.stringify(await ok.clone().json())).toBe(201);
    // the override is listed beside the next snapshot (it is ACK-listed once snapshot_ack is on)
    setFlags("enforce", "snapshot_ack");
    const snap = await dataOf<any>(await nextRequest(`/api/projects/${projectId}/gate-snapshot?gate=group_ic`, { headers: { cookie: cookies[MAKER] } }));
    expect(snap.snapshot.required_acks.find((a: any) => a.kind === "kill_override")).toBeTruthy();
    expect(snap.snapshot.hard_blocks).toEqual([]);
  });

  test("a revoked override blocks the GO again", async () => {
    setFlags("enforce", "kill_binding");
    const { projectId } = icProject();
    triggerHalt(projectId);
    const issued = await dataOf<any>(await issue(projectId, body));
    expect((await nextRequest(`/api/projects/${projectId}/kill-overrides/${issued.id}/revoke`, { method: "POST", headers: { cookie: cookies[CHECKER] } })).status).toBe(200);
    clearSnapshotCache();
    const blocked = await recordIc(projectId, "entity_ic");
    expect(blocked.status).toBe(409);
    expect((await errOf(blocked)).code).toBe("kill_binding_unoverridden");
  });

  test("opportunity twin: the same grant and halt-only rules on /api/opportunities/:id/kill-overrides", async () => {
    const opp = S.insertOpportunity(db, "brownfield", MAKER);
    const url = `/api/opportunities/${opp}/kill-overrides`;
    const b = { procedure_key: "brownfield-screening", criterion_id: "no_viable_target_in_longlist", reason: REASON };
    expect((await nextRequest(url, { method: "POST", headers: { cookie: cookies[OTHER] }, body: JSON.stringify(b) })).status).toBe(403);
    const res = await nextRequest(url, { method: "POST", headers: { cookie: cookies[CHECKER] }, body: JSON.stringify(b) });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    expect((await nextRequest(url, { method: "POST", headers: { cookie: cookies[CHECKER] }, body: JSON.stringify(b) })).status).toBe(409);
    expect((await nextRequest(`/api/opportunities/ghost/kill-overrides`, { method: "POST", headers: { cookie: cookies[CHECKER] }, body: JSON.stringify(b) })).status).toBe(404);
    const list = await dataOf<any>(await nextRequest(url, { headers: { cookie: cookies[MAKER] } }));
    expect(list.overrides).toHaveLength(1);
    expect((await nextRequest(`${url}/${list.overrides[0].id}/revoke`, { method: "POST", headers: { cookie: cookies[CHECKER] } })).status).toBe(200);
  });
});

describe("grant rule - the maker of a pending IC GO cannot be seated as its checker", () => {
  const grant = (userId: string, roleKey: string) =>
    nextRequest("/api/admin/human-roles", { method: "POST", headers: { cookie: cookies[ADMIN] }, body: JSON.stringify({ user_id: userId, role_key: roleKey }) });

  test("enforce: 409 checker_conflict while the GO is pending (role-specific); lifts after the countersign; shadow audits; off allows", async () => {
    setFlags("enforce", "maker_checker");
    const U = "p3-grant-maker";
    cookies[U] = await login(U, "analyst");
    const { projectId } = icProject();
    S.addMember(db, projectId, U);
    const res = await post(projectId, { gate: "entity_ic", decision: "go", rationale: S.IC_RATIONALE, gap_rationale: S.IC_GAP }, U);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    const id = (await dataOf<any>(res)).id as string;
    const conflict = await grant(U, "entity-ic-reviewer");
    expect(conflict.status).toBe(409);
    const e = await errOf(conflict);
    expect(e.code).toBe("checker_conflict");
    expect(e.details?.decisions[0]).toMatchObject({ project_id: projectId, decision_id: id, gate: "entity_ic" });
    expect(count("SELECT COUNT(*) c FROM app_user_human_role WHERE user_id = ?", U)).toBe(0);
    // the other role does not countersign an entity_ic GO: allowed
    expect((await grant(U, "group-ic-reviewer")).status).toBe(201);
    setFlags("shadow", "maker_checker");
    const before = audits("gate_integrity.would_block:checker_conflict");
    expect((await grant(U, "entity-ic-reviewer")).status).toBe(201);
    expect(audits("gate_integrity.would_block:checker_conflict")).toBe(before + 1);
    // even with the seat granted, the countersign engine refuses a same-person countersign
    setFlags("enforce", "maker_checker");
    const self = await approve(projectId, id, U);
    expect(self.status).toBe(403);
    expect((await errOf(self)).code).toBe("checker_must_differ");
    // once a different reviewer decided, the conflict no longer exists for a later grant
    expect((await approve(projectId, id)).status).toBe(201);
    const V = "p3-grant-maker-2";
    cookies[V] = await login(V, "analyst");
    S.addMember(db, projectId, V);
    const r2 = await post(projectId, { gate: "entity_ic", decision: "go", rationale: S.IC_RATIONALE, gap_rationale: S.IC_GAP }, V);
    const id2 = (await dataOf<any>(r2)).id as string;
    expect((await approve(projectId, id2)).status).toBe(201);
    expect((await grant(V, "entity-ic-reviewer")).status).toBe(201);
  });

  test("off: the rule does not run", async () => {
    const U = "p3-grant-maker-off";
    cookies[U] = await login(U, "analyst");
    const { projectId } = icProject();
    S.addMember(db, projectId, U);
    setFlags("shadow", "maker_checker"); // the GO needs a snapshot to be pending; record under shadow, grant under off
    expect((await post(projectId, { gate: "entity_ic", decision: "go", rationale: S.IC_RATIONALE, gap_rationale: S.IC_GAP }, U)).status).toBe(201);
    setFlags("off", "maker_checker");
    expect((await grant(U, "entity-ic-reviewer")).status).toBe(201);
  });
});

describe("security review follow-ups (B2 refusal audit, J1, J2, J5, J6, J8)", () => {
  const refusals = (action: string) => count("SELECT COUNT(*) c FROM audit_log WHERE action = ?", action);
  const clearUrl = (pid: string, cid: string, kind: "clear" | "withdraw" = "clear") => `/api/projects/${pid}/conditions/${cid}/${kind}`;
  const NOTE = "Landlord consent letter received and filed in the data room";

  test("B2: refused attempts leave an audit row (self-countersign, no grant, revoked grant), de-duplicated per day", async () => {
    setFlags("enforce", "maker_checker");
    const { projectId } = icProject();
    const id = await icGoUnderContract(projectId);
    const g = await S.grantRole(db, MAKER, "entity-ic-reviewer", ADMIN);
    const self = before("gate_decision.countersign.refused:checker_must_differ");
    expect((await approve(projectId, id, MAKER)).status).toBe(403);
    expect(refusals("gate_decision.countersign.refused:checker_must_differ")).toBe(self + 1);
    expect((await approve(projectId, id, MAKER)).status).toBe(403); // same target, same day: de-duplicated
    expect(refusals("gate_decision.countersign.refused:checker_must_differ")).toBe(self + 1);
    revokeHumanRoleGrant(db, { id: g, revokedBy: ADMIN, now: S.NOW });
    const noGrant = before("gate_decision.countersign.refused:human_role_required");
    expect((await approve(projectId, id, OTHER)).status).toBe(403);
    expect(refusals("gate_decision.countersign.refused:human_role_required")).toBe(noGrant + 1);
    const REV = "p3-b2-revoked";
    cookies[REV] = await login(REV, "analyst");
    S.addMember(db, projectId, REV);
    revokeHumanRoleGrant(db, { id: await S.grantRole(db, REV, "entity-ic-reviewer", ADMIN), revokedBy: ADMIN, now: S.NOW });
    const rv = before("gate_decision.countersign.refused:grant_revoked");
    expect((await approve(projectId, id, REV)).status).toBe(409);
    expect(refusals("gate_decision.countersign.refused:grant_revoked")).toBe(rv + 1);
    // the audit row names the actor and the decision
    const row = db.query("SELECT actor_user_id, target FROM audit_log WHERE action = 'gate_decision.countersign.refused:checker_must_differ' ORDER BY created_at DESC LIMIT 1").get() as { actor_user_id: string; target: string };
    expect(row).toEqual({ actor_user_id: MAKER, target: `${projectId}:entity_ic:${id}` });
  });

  test("B2: per-actor daily cap (the append-only log cannot be flooded) and the grant-conflict / clear / override refusals are audited", async () => {
    const { recordRefusal } = await import("../../app/web-next/lib/gate-integrity.ts");
    const FLOODER = "p3-flooder";
    let written = 0;
    for (let i = 0; i < 130; i++) if (recordRefusal(db, { actor: FLOODER, scope: "gate_decision.countersign", target: `t${i}` }, "checker_must_differ")) written++;
    expect(written).toBe(100);
    // H2: hitting the cap leaves exactly ONE marker row for the actor that day (not one per dropped attempt)
    expect(count("SELECT COUNT(*) c FROM audit_log WHERE actor_user_id = ? AND action = 'gate_decision.countersign.refused_cap_reached'", FLOODER)).toBe(1);
    expect(count("SELECT COUNT(*) c FROM audit_log WHERE actor_user_id = ? AND action LIKE '%.refused:%'", FLOODER)).toBe(100); // the marker does not count toward the cap

    setFlags("enforce", "maker_checker", "validators");
    const { projectId } = icProject();
    // grant conflict
    const U = "p3-b2-grant-maker";
    cookies[U] = await login(U, "analyst");
    S.addMember(db, projectId, U);
    expect((await post(projectId, { gate: "entity_ic", decision: "go", rationale: S.IC_RATIONALE, gap_rationale: S.IC_GAP }, U)).status).toBe(201);
    const gc = before("grant.issue.refused:checker_conflict");
    expect((await nextRequest("/api/admin/human-roles", { method: "POST", headers: { cookie: cookies[ADMIN] }, body: JSON.stringify({ user_id: U, role_key: "entity-ic-reviewer" }) })).status).toBe(409);
    expect(refusals("grant.issue.refused:checker_conflict")).toBe(gc + 1);
    // override refusal (no grant)
    const ov = before("kill_override.issue.refused:human_role_required");
    const body = { procedure_key: "entity-ic-review", criterion_id: "analysis_task_reviewed_by_null_on_required_deliverable", reason: "The appendix is reviewed before closing as agreed" };
    expect((await nextRequest(`/api/projects/${projectId}/kill-overrides`, { method: "POST", headers: { cookie: cookies[OTHER] }, body: JSON.stringify(body) })).status).toBe(403);
    expect(refusals("kill_override.issue.refused:human_role_required")).toBe(ov + 1);
  });

  test("J1: the recorder of the source decision cannot clear (even holding a grant and not being the creator); withdraw needs the grant matching the condition's gate", async () => {
    setFlags("enforce", "maker_checker", "validators");
    const { projectId } = icProject();
    const id = await icGoUnderContract(projectId);
    // the CHECKER attaches a condition at the countersign; the MAKER (recorder of the decision) is not its creator
    const cs = await countersign(projectId, id, { decision: "conditional", reason: "Approved on the condition that consent is obtained", conditions: [{ text: "Obtain the landlord consent letter before closing", clear_by: "closing" }] });
    expect(cs.status).toBe(201);
    const cid = (await dataOf<any>(cs)).conditions[0] as string;
    const g = await S.grantRole(db, MAKER, "entity-ic-reviewer", ADMIN);
    const r = await nextRequest(clearUrl(projectId, cid), { method: "POST", headers: { cookie: cookies[MAKER] }, body: JSON.stringify({ note: NOTE, evidence_ref: "dataroom:x" }) });
    expect(r.status).toBe(403);
    expect((await errOf(r)).code).toBe("clearer_must_differ");
    expect(db.query("SELECT status FROM condition_precedent WHERE id = ?").get(cid)).toEqual({ status: "open" });
    expect(refusals("condition.clear.refused:clearer_must_differ")).toBeGreaterThan(0);
    revokeHumanRoleGrant(db, { id: g, revokedBy: ADMIN, now: S.NOW });
    // withdraw: a holder of the OTHER role cannot, the matching one (a third person) can
    const GROUP_ONLY = "p3-j1-group-only";
    cookies[GROUP_ONLY] = await login(GROUP_ONLY, "analyst");
    S.addMember(db, projectId, GROUP_ONLY);
    await S.grantRole(db, GROUP_ONLY, "group-ic-reviewer", ADMIN);
    const wrong = await nextRequest(clearUrl(projectId, cid, "withdraw"), { method: "POST", headers: { cookie: cookies[GROUP_ONLY] }, body: JSON.stringify({ note: "No longer needed after the lease change" }) });
    expect(wrong.status).toBe(403);
    expect((await errOf(wrong)).code).toBe("human_role_required");
    const ENTITY_HOLDER = "p3-j1-entity-holder";
    cookies[ENTITY_HOLDER] = await login(ENTITY_HOLDER, "analyst");
    S.addMember(db, projectId, ENTITY_HOLDER);
    await S.grantRole(db, ENTITY_HOLDER, "entity-ic-reviewer", ADMIN);
    const ok = await nextRequest(clearUrl(projectId, cid, "withdraw"), { method: "POST", headers: { cookie: cookies[ENTITY_HOLDER] }, body: JSON.stringify({ note: "No longer needed after the lease change" }) });
    expect(ok.status, JSON.stringify(await ok.clone().json())).toBe(200);
  });

  test("J2: the grant is the first thing checked inside the transaction - a non-holder learns nothing about the condition or the criterion", async () => {
    setFlags("enforce", "validators");
    const { projectId } = icProject();
    await icGoUnderContract(projectId, "entity_ic", { conditions: [{ text: "Obtain the landlord consent letter before closing", clear_by: "closing" }] });
    const cid = (db.query("SELECT id FROM condition_precedent WHERE project_id = ?").get(projectId) as { id: string }).id;
    // empty / weak note and an unknown condition id: still 403 for a non-holder (never 400 / 422 / 404)
    for (const [c, b] of [[cid, {}], [cid, { note: "ok" }], ["ghost", { note: NOTE }]] as const) {
      const r = await nextRequest(clearUrl(projectId, c), { method: "POST", headers: { cookie: cookies[OTHER] }, body: JSON.stringify(b) });
      expect(r.status, `${c} ${JSON.stringify(b)}`).toBe(403);
    }
    const bad = await nextRequest(`/api/projects/${projectId}/kill-overrides`, { method: "POST", headers: { cookie: cookies[OTHER] }, body: JSON.stringify({ procedure_key: "nope", criterion_id: "nope", reason: "x" }) });
    expect(bad.status).toBe(403);
    const rev = await nextRequest(`/api/projects/${projectId}/kill-overrides/ghost/revoke`, { method: "POST", headers: { cookie: cookies[OTHER] } });
    expect(rev.status).toBe(403);
    // a holder gets the specific answers
    expect((await nextRequest(clearUrl(projectId, "ghost"), { method: "POST", headers: { cookie: cookies[CHECKER] }, body: JSON.stringify({ note: NOTE }) })).status).toBe(404);
  });

  test("J5: enforce-readiness reports fewer than two distinct active holders per IC reviewer role", async () => {
    const { makerCheckerReadiness } = await import("../../app/web-next/lib/gate-readiness.ts");
    setFlags("enforce", "maker_checker");
    const r = makerCheckerReadiness(db);
    expect(r.mode).toBe("enforce");
    const entity = r.roles.find((x) => x.role === "entity-ic-reviewer")!;
    expect(entity.required).toBe(2);
    // the suite has several holders by now; shrink the question to a scratch database for the 1-holder case
    const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
    const { readdirSync, readFileSync } = require("node:fs") as typeof import("node:fs");
    const { splitSqlStatements } = require("../../db/migrate.ts") as typeof import("../../db/migrate.ts");
    const dir = join(PROJECT_ROOT, "db/migrations");
    const mem = new Database(":memory:");
    mem.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
    for (const f of readdirSync(dir).filter((x: string) => x.endsWith(".sql")).sort()) for (const st of splitSqlStatements(readFileSync(join(dir, f), "utf-8"))) mem.run(st);
    for (const u of ["a", "b"]) mem.run("INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)", [u, u, "analyst", "active", "s", "h", 1, S.NOW]);
    mem.run("INSERT INTO app_user_human_role (id, user_id, role_key, granted_by, granted_at) VALUES ('1','a','entity-ic-reviewer','x',?)", [S.NOW]);
    mem.run("INSERT INTO app_user_human_role (id, user_id, role_key, granted_by, granted_at) VALUES ('2','a','group-ic-reviewer','x',?)", [S.NOW]);
    const one = makerCheckerReadiness(mem);
    expect(one.ready).toBe(false);
    expect(one.roles.map((x) => x.active_holders)).toEqual([1, 1]);
    expect(one.warnings).toHaveLength(2);
    expect(one.warnings[0]).toContain("entity-ic-reviewer has 1 active holder");
    mem.run("INSERT INTO app_user_human_role (id, user_id, role_key, granted_by, granted_at) VALUES ('3','b','entity-ic-reviewer','x',?)", [S.NOW]);
    mem.run("INSERT INTO app_user_human_role (id, user_id, role_key, granted_by, granted_at) VALUES ('4','b','group-ic-reviewer','x',?)", [S.NOW]);
    expect(makerCheckerReadiness(mem)).toMatchObject({ ready: true, warnings: [] });
    mem.run("UPDATE app_user_human_role SET revoked_at = ? WHERE id = '3'", [S.NOW]); // a revoked holder does not count
    expect(makerCheckerReadiness(mem).ready).toBe(false);
    setFlags("shadow", "maker_checker");
    expect(makerCheckerReadiness(mem).warnings).toEqual([]); // warnings only matter under enforce
    // endpoint: admin only
    expect((await nextRequest("/api/admin/human-roles/readiness", { headers: { cookie: cookies[ADMIN] } })).status).toBe(200);
    expect((await nextRequest("/api/admin/human-roles/readiness", { headers: { cookie: cookies[MAKER] } })).status).toBe(403);
    expect((await dataOf<any>(await nextRequest("/api/admin/human-roles/readiness", { headers: { cookie: cookies[ADMIN] } }))).roles).toHaveLength(2);
  });

  test("J6: conditions GET and project kill-overrides GET apply the MNPI insider check and write a read access-log row", async () => {
    const { projectId } = icProject();
    const reads = (table: string) => count("SELECT COUNT(*) c FROM data_access_log WHERE table_key = ? AND project_id = ? AND action = 'read'", table, projectId);
    expect((await nextRequest(`/api/projects/${projectId}/conditions`, { headers: { cookie: cookies[OTHER] } })).status).toBe(200);
    expect(reads("condition_precedent")).toBe(1);
    expect((await nextRequest(`/api/projects/${projectId}/kill-overrides`, { headers: { cookie: cookies[OTHER] } })).status).toBe(200);
    expect(reads("kill_criteria_override")).toBe(1);
    db.run("INSERT OR REPLACE INTO project_classification (project_id, sensitivity, mnpi_flag, wall_group, classified_by, classified_at) VALUES (?, 'restricted', 1, NULL, 'test', ?)", [projectId, S.NOW]);
    db.run("INSERT INTO insider_list (project_id, user_id, added_at, reason) VALUES (?,?,?,?)", [projectId, MAKER, S.NOW, "p3 test"]);
    for (const path of ["conditions", "kill-overrides"]) {
      const r = await nextRequest(`/api/projects/${projectId}/${path}`, { headers: { cookie: cookies[OTHER] } });
      expect([403, 404]).toContain(r.status); // not an insider: refused (403 insider_required, or hidden by the wall)
      expect((await nextRequest(`/api/projects/${projectId}/${path}`, { headers: { cookie: cookies[MAKER] } })).status).toBe(200);
    }
  });

  test("J8: an open condition may change only its close columns (trigger); a closed one is immutable", async () => {
    setFlags("enforce", "validators");
    const { projectId } = icProject();
    await icGoUnderContract(projectId, "entity_ic", { conditions: [{ text: "Obtain the landlord consent letter before closing", clear_by: "closing" }] });
    const cid = (db.query("SELECT id FROM condition_precedent WHERE project_id = ?").get(projectId) as { id: string }).id;
    for (const col of ["text = 'edited'", "clear_by = 'group_ic'", "created_by = 'someone'", "gate = 'group_ic'", "origin = 'countersign'", "owner_role = 'x'", "source_decision_id = 'x'", "created_at = 'x'"]) {
      expect(() => db.run(`UPDATE condition_precedent SET ${col} WHERE id = ?`, [cid]), col).toThrow(/may change only its status and close columns|FOREIGN KEY/);
    }
    db.run("UPDATE condition_precedent SET status = 'cleared', cleared_by = 'u', cleared_at = ?, clear_note = 'n' WHERE id = ?", [S.NOW, cid]);
    expect(() => db.run("UPDATE condition_precedent SET clear_note = 'again' WHERE id = ?", [cid])).toThrow(/immutable/);
  });
});

function before(action: string): number {
  return (db.query("SELECT COUNT(*) c FROM audit_log WHERE action = ?").get(action) as { c: number }).c;
}
