// @version 1.0.0
/**
 * ADR-0186 P1 - gate-integrity flag plumbing, the full gate ladder and the
 * rationale check on the real gate-decision routes (scratch SQLite).
 *   flags    : off = legacy / shadow = recorded + not blocked / enforce = blocked
 *   shadow   : `gate_integrity.would_block:<code>` audit row, de-duplicated per (entity, gate, code, day)
 *   ladder   : both tracks, stale decisions, cross-entity, legacy rows, source opportunity for fs
 *   rationale: HB 422 on GO only (HOLD and KILL are never blocked)
 */
import { test, expect, beforeAll, afterAll, afterEach, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-gate-integrity-p1.sqlite");
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
const { gateIntegrityMode, gateIntegrityEnvName, GATE_INTEGRITY_FAMILIES } = await import("../../app/web-next/lib/gate-integrity-flags.ts");
const { recordWouldBlock } = await import("../../app/web-next/lib/gate-integrity.ts");
const { ladderBlock } = await import("../../app/web-next/lib/gate-ladder.ts");
const { ladderFor, projectLadderSegment, lastOpportunityGate, gateSequenceBlocker } = await import("../../app/web-next/lib/gate-sequence-view.ts");
const { goRationaleCheck } = await import("../../app/web-next/lib/gate-write-checks.ts");
const S = await import("./_gate-integrity-support.ts");

const ANALYST = "gi-analyst";
let cookie = "";

const flagNames = GATE_INTEGRITY_FAMILIES.map(gateIntegrityEnvName);
function setFlags(mode: "off" | "shadow" | "enforce" | null, ...families: Array<(typeof GATE_INTEGRITY_FAMILIES)[number]>) {
  for (const f of families) {
    if (mode === null) delete process.env[gateIntegrityEnvName(f)];
    else process.env[gateIntegrityEnvName(f)] = mode;
  }
}
afterEach(() => { for (const n of flagNames) delete process.env[n]; });

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-gi-analyst-123", createdBy: "test", now: S.NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: S.NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: ANALYST, password: "pw-gi-analyst-123" }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

const postProject = (pid: string, body: Record<string, unknown>) =>
  nextRequest(`/api/projects/${pid}/gate-decisions`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
const postOpp = (oid: string, body: Record<string, unknown>) =>
  nextRequest(`/api/opportunities/${oid}/gate-decisions`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
const errOf = async (res: Response) => ((await res.json()) as { error: { code: string; details?: Record<string, unknown> } }).error;
const wouldBlockRows = (code: string) => db.query("SELECT * FROM audit_log WHERE action = ?").all(`gate_integrity.would_block:${code}`) as Array<{ target: string }>;

describe("flag modes", () => {
  test("defaults: unit/dev = off, production = shadow; explicit values win; junk falls back to the default", () => {
    expect(gateIntegrityMode("rationale", {})).toBe("off");
    expect(gateIntegrityMode("rationale", { NODE_ENV: "test" })).toBe("off");
    expect(gateIntegrityMode("rationale", { NODE_ENV: "production" })).toBe("shadow");
    expect(gateIntegrityMode("ladder", { NODE_ENV: "production", CO_NEWBIZ_GATE_INTEGRITY_LADDER: "enforce" })).toBe("enforce");
    expect(gateIntegrityMode("ladder", { NODE_ENV: "production", CO_NEWBIZ_GATE_INTEGRITY_LADDER: " OFF " })).toBe("off");
    expect(gateIntegrityMode("ladder", { NODE_ENV: "production", CO_NEWBIZ_GATE_INTEGRITY_LADDER: "maybe" })).toBe("shadow");
    expect(GATE_INTEGRITY_FAMILIES).toEqual(["rationale", "snapshot_ack", "kill_binding", "validators", "wacc", "ladder", "maker_checker", "waiver", "divergence"]);
  });

  test("the unit environment has every family off", () => {
    for (const f of GATE_INTEGRITY_FAMILIES) expect(gateIntegrityMode(f)).toBe("off");
  });

  test("shadow audit rows are de-duplicated per (entity, gate, code, day)", () => {
    const ctx = { entityType: "project" as const, entityId: "P-dedupe", gate: "fs", actor: "u1" };
    const day1 = new Date("2026-10-27T10:00:00Z");
    expect(recordWouldBlock(db, ctx, "dedupe_code", day1)).toBe(true);
    expect(recordWouldBlock(db, ctx, "dedupe_code", new Date("2026-10-27T23:59:00Z"))).toBe(false);
    expect(recordWouldBlock(db, { ...ctx, gate: "dd" }, "dedupe_code", day1)).toBe(true); // other gate
    expect(recordWouldBlock(db, ctx, "other_code", day1)).toBe(true); // other code
    expect(recordWouldBlock(db, { ...ctx, entityId: "P-other" }, "dedupe_code", day1)).toBe(true); // other entity
    expect(recordWouldBlock(db, ctx, "dedupe_code", new Date("2026-10-28T00:30:00Z"))).toBe(true); // next day
    expect(wouldBlockRows("dedupe_code")).toHaveLength(4);
  });
});

describe("gate ladder - ladderFor and the shared rule", () => {
  test("greenfield and brownfield ladders", () => {
    expect([...ladderFor("greenfield")]).toEqual(["screening", "pre_fs", "fs", "dd", "entity_ic", "group_ic"]);
    expect([...ladderFor("brownfield")]).toEqual(["screening", "pre_fs", "target_screening", "fs", "dd", "entity_ic", "group_ic"]);
    expect([...ladderFor(null)]).toEqual(["screening", "pre_fs"]);
    expect([...projectLadderSegment("brownfield")]).toEqual(["fs", "dd", "entity_ic", "group_ic"]);
    expect(lastOpportunityGate("greenfield")).toBe("pre_fs");
    expect(lastOpportunityGate("brownfield")).toBe("target_screening");
  });

  test("gateSequenceBlocker over the full brownfield ladder names the first missing GO", () => {
    const latest = [{ gate: "screening", decision: "go" }, { gate: "pre_fs", decision: "hold" }];
    expect(gateSequenceBlocker(ladderFor("brownfield"), "target_screening", latest)).toBe("pre_fs");
    expect(gateSequenceBlocker(ladderFor("brownfield"), "screening", latest)).toBeNull();
    expect(gateSequenceBlocker(ladderFor("greenfield"), "fs", [{ gate: "screening", decision: "go" }, { gate: "pre_fs", decision: "go" }])).toBeNull();
  });

  test("opportunity carrier: greenfield pre_fs needs screening GO; HOLD and KILL do not satisfy", () => {
    const o = S.insertOpportunity(db, "greenfield");
    expect(ladderBlock("opportunity", o, "screening")).toBeNull();
    expect(ladderBlock("opportunity", o, "pre_fs")).toEqual({ blocker: "screening", blockerCarrier: "opportunity" });
    S.insertGate(db, "opportunity", o, "screening", "hold");
    expect(ladderBlock("opportunity", o, "pre_fs")?.blocker).toBe("screening");
    S.insertGate(db, "opportunity", o, "screening", "go", "2026-10-27T09:05:00Z");
    expect(ladderBlock("opportunity", o, "pre_fs")).toBeNull();
    // a later HOLD at screening re-opens the question (latest decision per gate wins)
    S.insertGate(db, "opportunity", o, "screening", "hold", "2026-10-27T09:10:00Z");
    expect(ladderBlock("opportunity", o, "pre_fs")?.blocker).toBe("screening");
  });

  test("opportunity carrier: brownfield target_screening needs pre_fs, which needs screening", () => {
    const o = S.insertOpportunity(db, "brownfield");
    expect(ladderBlock("opportunity", o, "target_screening")?.blocker).toBe("screening");
    S.insertGate(db, "opportunity", o, "screening", "go");
    expect(ladderBlock("opportunity", o, "target_screening")?.blocker).toBe("pre_fs");
    S.insertGate(db, "opportunity", o, "pre_fs", "go");
    expect(ladderBlock("opportunity", o, "target_screening")).toBeNull();
  });

  test("opportunity carrier: before the S4 route decision only screening and pre_fs apply", () => {
    const o = S.insertOpportunity(db, null);
    expect(ladderBlock("opportunity", o, "pre_fs")?.blocker).toBe("screening");
    expect(ladderBlock("opportunity", o, "target_screening")).toBeNull(); // not on the unknown-track ladder; brownfield-only is gateGoPrerequisiteGaps' rule
  });

  test("stale decisions do not count as GO", () => {
    const o = S.insertOpportunity(db, "greenfield");
    const g = S.insertGate(db, "opportunity", o, "screening", "go");
    expect(ladderBlock("opportunity", o, "pre_fs")).toBeNull();
    db.run("INSERT INTO gate_decision_stale (decision_id, stale_at, stale_reason) VALUES (?,?,?)", [g, S.NOW, "selection changed"]);
    expect(ladderBlock("opportunity", o, "pre_fs")?.blocker).toBe("screening");
  });

  test("cross-entity: a GO recorded on ANOTHER opportunity never satisfies this one", () => {
    const a = S.insertOpportunity(db, "greenfield");
    const b = S.insertOpportunity(db, "greenfield");
    S.insertGate(db, "opportunity", a, "screening", "go");
    expect(ladderBlock("opportunity", b, "pre_fs")?.blocker).toBe("screening");
  });

  test("project carrier: dd needs fs, entity_ic needs dd; group_ic needs entity_ic", () => {
    const o = S.insertOpportunity(db, "greenfield");
    S.insertGate(db, "opportunity", o, "pre_fs", "go");
    const p = S.insertProject(db, o);
    expect(ladderBlock("project", p, "fs")).toBeNull();
    expect(ladderBlock("project", p, "dd")).toEqual({ blocker: "fs", blockerCarrier: "project" });
    S.insertGate(db, "project", p, "fs", "go");
    expect(ladderBlock("project", p, "dd")).toBeNull();
    expect(ladderBlock("project", p, "entity_ic")?.blocker).toBe("dd");
    S.insertGate(db, "project", p, "dd", "go");
    expect(ladderBlock("project", p, "entity_ic")).toBeNull();
    expect(ladderBlock("project", p, "group_ic")?.blocker).toBe("entity_ic");
  });

  test("project fs: greenfield needs the source opportunity's pre_fs GO; brownfield needs target_screening", () => {
    const g = S.insertOpportunity(db, "greenfield");
    const gp = S.insertProject(db, g);
    expect(ladderBlock("project", gp, "fs")).toEqual({ blocker: "pre_fs", blockerCarrier: "opportunity" });
    S.insertGate(db, "opportunity", g, "pre_fs", "go");
    expect(ladderBlock("project", gp, "fs")).toBeNull();

    const b = S.insertOpportunity(db, "brownfield");
    const bp = S.insertProject(db, b, "brownfield");
    S.insertGate(db, "opportunity", b, "pre_fs", "go");
    expect(ladderBlock("project", bp, "fs")).toEqual({ blocker: "target_screening", blockerCarrier: "opportunity" });
    S.insertGate(db, "opportunity", b, "target_screening", "go");
    expect(ladderBlock("project", bp, "fs")).toBeNull();
  });

  test("legacy rows count as effective: a lone target_screening GO (the grandfathered opportunity) still lets its project open fs", () => {
    const b = S.insertOpportunity(db, "brownfield");
    S.insertGate(db, "opportunity", b, "target_screening", "go"); // no screening / pre_fs rows, as in the live data
    const bp = S.insertProject(db, b, "brownfield");
    expect(ladderBlock("project", bp, "fs")).toBeNull();
  });
});

describe("POST gate-decisions - ladder family on the real routes", () => {
  test("opportunity route: off = legacy, shadow = audited not blocked, enforce = 409 ladder_prerequisite_missing", async () => {
    const o = S.insertOpportunity(db, "greenfield", ANALYST);
    // pre_fs GO with no screening GO. The stage-prerequisite rule still answers 409 gate_prerequisites_incomplete
    // when the ladder lets the request through, so the code tells us which rule fired.
    let res = await postOpp(o, { gate: "pre_fs", decision: "go", rationale: S.GENUINE });
    expect((await errOf(res)).code).toBe("gate_prerequisites_incomplete"); // off: ladder did not run

    setFlags("shadow", "ladder");
    res = await postOpp(o, { gate: "pre_fs", decision: "go", rationale: S.GENUINE });
    expect((await errOf(res)).code).toBe("gate_prerequisites_incomplete"); // shadow: not blocked by the ladder
    expect(wouldBlockRows("ladder_prerequisite_missing").some((r) => r.target === `opportunity:${o}:pre_fs`)).toBe(true);
    // a repeat the same day does not add a second row
    await postOpp(o, { gate: "pre_fs", decision: "go", rationale: S.GENUINE });
    expect(wouldBlockRows("ladder_prerequisite_missing").filter((r) => r.target === `opportunity:${o}:pre_fs`)).toHaveLength(1);

    setFlags("enforce", "ladder");
    res = await postOpp(o, { gate: "pre_fs", decision: "go", rationale: S.GENUINE });
    expect(res.status).toBe(409);
    const e = await errOf(res);
    expect(e.code).toBe("ladder_prerequisite_missing");
    expect(e.details).toMatchObject({ blocker: "screening", carrier: "opportunity" });
    expect(db.query("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ? AND gate = 'pre_fs'").get(o)).toEqual({ c: 0 });
  });

  test("HOLD and KILL are never ladder-blocked, even in enforce", async () => {
    setFlags("enforce", "ladder", "rationale");
    const o = S.insertOpportunity(db, "greenfield", ANALYST);
    const hold = await postOpp(o, { gate: "pre_fs", decision: "hold", rationale: "x", missing_artifacts: ["S5 deliverable"] });
    expect(hold.status).toBe(201);
    const kill = await postOpp(o, { gate: "pre_fs", decision: "kill", rationale: "x", learning_capture: "lesson" });
    expect(kill.status).toBe(201);
  });

  test("project route, enforce: fs opens when the source opportunity has pre_fs GO; dd is blocked until fs GO", async () => {
    setFlags("enforce", "ladder");
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const dd = await postProject(projectId, { gate: "dd", decision: "go", rationale: S.GENUINE });
    expect(dd.status).toBe(409);
    expect((await errOf(dd)).code).toBe("ladder_prerequisite_missing");
    const fs = await postProject(projectId, { gate: "fs", decision: "go", rationale: S.GENUINE });
    expect(fs.status).toBe(201);
    const ddAgain = await postProject(projectId, { gate: "dd", decision: "go", rationale: S.GENUINE_2 });
    expect(ddAgain.status).toBe(201);
  });

  test("project route, enforce: fs is blocked when the source opportunity lost its pre_fs GO (HOLD later)", async () => {
    setFlags("enforce", "ladder");
    const { projectId, oppId } = S.seedReadyProject(db, ANALYST);
    S.insertGate(db, "opportunity", oppId, "pre_fs", "hold", "2026-10-27T09:30:00Z");
    const res = await postProject(projectId, { gate: "fs", decision: "go", rationale: S.GENUINE });
    expect(res.status).toBe(409);
    expect((await errOf(res)).details).toMatchObject({ blocker: "pre_fs", carrier: "opportunity" });
  });

  test("the existing entity_ic -> group_ic rule keeps its code and is not flag-gated", async () => {
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const res = await postProject(projectId, { gate: "group_ic", decision: "go", rationale: S.GENUINE, gap_rationale: S.GENUINE_2 });
    expect(res.status).toBe(409);
    expect((await errOf(res)).code).toBe("gate_prerequisites_incomplete");
  });
});

describe("POST gate-decisions - rationale family (GO only)", () => {
  const weak = ["ok", ".", "승인", "승인합니다", "너무 짧음"];

  test.each(weak)("enforce: a GO with rationale %p is 422 rationale_insufficient", async (text) => {
    setFlags("enforce", "rationale");
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const res = await postProject(projectId, { gate: "fs", decision: "go", rationale: text });
    expect(res.status).toBe(422);
    const e = await errOf(res);
    expect(e.code).toBe("rationale_insufficient");
    expect(e.details).toMatchObject({ field: "rationale", profile: "decision" });
    expect(db.query("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ?").get(projectId)).toEqual({ c: 0 });
  });

  test("off: the same weak rationale is recorded as before (legacy)", async () => {
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const res = await postProject(projectId, { gate: "fs", decision: "go", rationale: "ok" });
    expect(res.status).toBe(201);
  });

  test("shadow: recorded, and a would-block row is written once per day", async () => {
    setFlags("shadow", "rationale");
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const res = await postProject(projectId, { gate: "fs", decision: "go", rationale: "ok" });
    expect(res.status).toBe(201);
    expect(wouldBlockRows("rationale_insufficient").filter((r) => r.target === `project:${projectId}:fs`)).toHaveLength(1);
  });

  test("enforce: genuine Korean and English rationales are accepted", async () => {
    setFlags("enforce", "rationale");
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const ko = await postProject(projectId, { gate: "fs", decision: "go", rationale: S.GENUINE });
    expect(ko.status).toBe(201);
    const en = await postProject(projectId, { gate: "dd", decision: "go", rationale: "Commercial and technical diligence found no unmitigated deal breakers." });
    expect(en.status).toBe(201);
  });

  test("enforce: the same rationale on another gate of the same entity is rejected as a duplicate; a different gate text passes", async () => {
    setFlags("enforce", "rationale");
    const { projectId } = S.seedReadyProject(db, ANALYST);
    expect((await postProject(projectId, { gate: "fs", decision: "go", rationale: S.GENUINE })).status).toBe(201);
    const dup = await postProject(projectId, { gate: "dd", decision: "go", rationale: S.GENUINE });
    expect(dup.status).toBe(422);
    expect((await errOf(dup)).details).toMatchObject({ reason: "duplicate_of_other_gate" });
  });

  test("enforce: a weak gap_rationale is rejected on an IC GO that needs one", async () => {
    setFlags("enforce", "rationale");
    const { projectId } = S.seedReadyProject(db, ANALYST);
    expect((await postProject(projectId, { gate: "fs", decision: "go", rationale: S.GENUINE })).status).toBe(201);
    expect((await postProject(projectId, { gate: "dd", decision: "go", rationale: S.GENUINE_2 })).status).toBe(201);
    const res = await postProject(projectId, { gate: "entity_ic", decision: "go", rationale: "Entity IC reviewed the package and agrees to proceed.", gap_rationale: "ok" });
    expect(res.status).toBe(422);
    expect((await errOf(res)).details).toMatchObject({ field: "gap_rationale" });
  });

  test("HOLD and KILL are never rationale-blocked (they keep their existing requirements)", async () => {
    setFlags("enforce", "rationale");
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const hold = await postProject(projectId, { gate: "fs", decision: "hold", rationale: "x", missing_artifacts: ["Business case adoption"] });
    expect(hold.status).toBe(201);
    const kill = await postProject(projectId, { gate: "fs", decision: "kill", rationale: "x", learning_capture: "What we learned" });
    expect(kill.status).toBe(201);
    const noReason = await postProject(projectId, { gate: "dd", decision: "hold", rationale: "", missing_artifacts: ["a"] });
    expect(noReason.status).toBe(400); // an empty rationale is still the old 400
  });

  test("opportunity route: the rationale check runs on GO after the stage prerequisites (enforce)", async () => {
    setFlags("enforce", "rationale");
    const o = S.insertOpportunity(db, "greenfield", ANALYST);
    // Stage prerequisites are incomplete for this bare opportunity, so the existing 409 answers first.
    const res = await postOpp(o, { gate: "screening", decision: "go", rationale: "ok" });
    expect((await errOf(res)).code).toBe("gate_prerequisites_incomplete");
  });
});

describe("goRationaleCheck on the opportunity carrier (the route reaches it after the stage prerequisites)", () => {
  test("enforce: weak -> 422 rationale_insufficient; genuine -> pass; duplicate of another gate's rationale -> 422", async () => {
    setFlags("enforce", "rationale");
    const o = S.insertOpportunity(db, "greenfield", ANALYST);
    const ctx = { entityType: "opportunity" as const, entityId: o, gate: "pre_fs", actor: ANALYST };
    const weak = goRationaleCheck(ctx, "ok");
    expect(weak?.status).toBe(422);
    expect(((await weak!.json()) as { error: { code: string } }).error.code).toBe("rationale_insufficient");
    expect(goRationaleCheck(ctx, S.GENUINE)).toBeNull();
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", o, "screening", "go", S.GENUINE, ANALYST, S.NOW]);
    const dup = goRationaleCheck(ctx, S.GENUINE);
    expect(dup?.status).toBe(422);
    expect(((await dup!.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe("duplicate_of_other_gate");
  });

  test("off: the check does not run; shadow: returns null and audits", () => {
    const o = S.insertOpportunity(db, "greenfield", ANALYST);
    const ctx = { entityType: "opportunity" as const, entityId: o, gate: "screening", actor: ANALYST };
    expect(goRationaleCheck(ctx, "ok")).toBeNull();
    expect(wouldBlockRows("rationale_insufficient").some((r) => r.target === `opportunity:${o}:screening`)).toBe(false);
    setFlags("shadow", "rationale");
    expect(goRationaleCheck(ctx, "ok")).toBeNull();
    expect(wouldBlockRows("rationale_insufficient").some((r) => r.target === `opportunity:${o}:screening`)).toBe(true);
  });
});

describe("shadow audit flood protection", () => {
  test("1,000 distinct entities by one actor write at most the per-actor daily cap; targets are length-bounded", async () => {
    const { WOULD_BLOCK_PER_ACTOR_PER_DAY, WOULD_BLOCK_TARGET_MAX } = await import("../../app/web-next/lib/gate-integrity.ts");
    const before = (db.query("SELECT COUNT(*) c FROM audit_log WHERE actor_user_id = 'flooder'").get() as { c: number }).c;
    const now = new Date("2026-11-02T10:00:00Z");
    for (let i = 0; i < 1000; i++) recordWouldBlock(db, { entityType: "project", entityId: `fake-${i}-${"x".repeat(500)}`, gate: "fs", actor: "flooder" }, "flood_code", now);
    const rows = db.query("SELECT target FROM audit_log WHERE actor_user_id = 'flooder'").all() as Array<{ target: string }>;
    expect(rows.length - before).toBe(WOULD_BLOCK_PER_ACTOR_PER_DAY);
    expect(rows.every((r) => r.target.length <= WOULD_BLOCK_TARGET_MAX)).toBe(true);
  });

  test("an invalid flag value logs a warning once and falls back to the default", () => {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (m: string) => { warns.push(String(m)); };
    try {
      process.env.CO_NEWBIZ_GATE_INTEGRITY_DIVERGENCE = "enfroce";
      expect(gateIntegrityMode("divergence")).toBe("off");
      expect(gateIntegrityMode("divergence")).toBe("off");
    } finally { console.warn = orig; delete process.env.CO_NEWBIZ_GATE_INTEGRITY_DIVERGENCE; }
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("CO_NEWBIZ_GATE_INTEGRITY_DIVERGENCE");
  });
});
