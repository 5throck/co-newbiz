// @version 1.1.0
/**
 * ADR-0193 PR-B - kill-criteria stage scoping in the gate snapshot (design 2026-11-07 section 7, tests 1-13):
 * the stage classifier (not_reached / triggered / reached), carries from every recorded decision, the three hard
 * blocks (no Group IC override), out_of_track and open_monitoring closures, partial_input, the legacy schema-v1
 * read path, and the contract's refusal of an acknowledgement for a not-reached key. Real scratch SQLite through the
 * full migration chain and the REAL registry files; carries are seeded as recorded decision snapshots.
 */
import { test, expect, beforeAll, afterAll, afterEach, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { CarrySource } from "../../app/web-next/lib/gate-kill-scope.ts";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-kill-criteria-carry.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { GATE_INTEGRITY_FAMILIES, gateIntegrityEnvName } = await import(
  "../../app/web-next/lib/gate-integrity-flags.ts"
);
const { snapshotHash } = await import("../../app/web-next/lib/gate-canonical.ts");
const {
  previewGateSnapshot,
  clearSnapshotCache,
  normalizeStoredSnapshot,
  verifyStoredSnapshotHash,
  killEnforceGuard,
  carriedWithoutDataSource,
  assertKillEnforceSafe,
  KILL_EVIDENCE_CAVEATS,
  OPPORTUNITY_SCOPE_VARS,
} = await import("../../app/web-next/lib/gate-snapshot.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { recordGateDecisionRow } = await import("../../app/web-next/lib/gate-decision-contract.ts");
const { GATE_SNAPSHOT_SCHEMA_VERSION, insertGateSnapshot, getGateSnapshot } = await import(
  "../../db/repositories/gate-snapshot.repository.ts"
);
const { classifyKill, criterionTrack, deriveOpenCarries, carryDue } = await import(
  "../../app/web-next/lib/gate-kill-scope.ts"
);
const { listLegacyScreeningKillAcks } = await import("../../app/web-next/lib/gate-kill-legacy.ts");
const S = await import("./_gate-integrity-support.ts");

const ANALYST = "carry-analyst";
const flagNames = GATE_INTEGRITY_FAMILIES.map(gateIntegrityEnvName);
function setFlags(mode: "off" | "shadow" | "enforce", ...families: Array<(typeof GATE_INTEGRITY_FAMILIES)[number]>) {
  for (const f of families) process.env[gateIntegrityEnvName(f)] = mode;
}
const SNAP = ["snapshot_ack", "kill_binding", "divergence"] as const;
afterEach(() => {
  delete process.env.CO_NEWBIZ_KILL_ENFORCE_GUARD_TEST;
  for (const n of flagNames) delete process.env[n];
  clearSnapshotCache();
});

beforeAll(async () => {
  await createUser(db, {
    userId: ANALYST,
    role: "analyst",
    password: `pw-${ANALYST}-123456`,
    createdBy: "test",
    now: S.NOW,
  });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: S.NOW });
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

const preview = (entityType: "opportunity" | "project", entityId: string, gate: string) =>
  previewGateSnapshot({ entityType, entityId, gate, actor: ANALYST, db }, { fresh: true });
const keysOf = (xs: Array<{ key: string }>) => xs.map((x) => x.key);

/** A recorded decision with a stored snapshot whose kill section is what the test needs a later gate to see. */
function addDecision(
  entityType: "opportunity" | "project",
  entityId: string,
  gate: string,
  decision: "go" | "hold" | "kill",
  kill: Record<string, unknown>,
  opts: { version?: number; at?: string; stored?: Record<string, unknown> } = {},
): string {
  const at = opts.at ?? "2026-10-28T09:00:00Z";
  const id = S.insertGate(db, entityType, entityId, gate, decision, at);
  const version = opts.version ?? 2;
  const snapshot = {
    schema_version: version,
    gate,
    entity: { type: entityType, id: entityId },
    ...(opts.stored ?? {}),
    kill,
  };
  insertGateSnapshot(db, {
    decisionId: id,
    schemaVersion: version,
    snapshotJson: JSON.stringify(snapshot),
    snapshotHash: snapshotHash(snapshot),
    submittedHash: null,
    acknowledgements: [],
    computedAt: at,
    engineVersionsJson: "{}",
    evalRunId: null,
    briefId: null,
  });
  return id;
}
const nr = (key: string, evaluable_from: string, reevaluate_at: string) => ({ key, evaluable_from, reevaluate_at });

const ZERO_SITE = "greenfield-screening:zero_site_clears_infrastructure_minimums"; // halt, S5 -> fs (ADR-0193 14.1)
const PARTNER_GF = "greenfield-screening:partner_dependency_unconfirmed_and_no_alternative"; // mark_conditional, S5 -> fs
const NO_TARGET = "brownfield-screening:no_viable_target_in_longlist"; // halt, S6 -> pre_fs
const HHI = "brownfield-screening:preliminary_hhi_flags_certain_block"; // escalate, S7 -> fs
const INFRA_PLAN = "greenfield-screening:infrastructure_plan_not_finalized_at_site_announcement"; // escalate, S5 -> fs
const FIVE = [ZERO_SITE, INFRA_PLAN, PARTNER_GF, NO_TARGET, HHI];
const NO_SHAPE = "deal-shape-chain:no_viable_deal_shape"; // mark_conditional, brownfield-only, S7 -> target_screening (deal-shape-to-S7 R-1/R-2)
const PARTNER_FIN = "deal-shape-chain:partner_dd_red_financial_distress"; // halt, S5 -> fs (14.2)
const PARTNER_IP = "deal-shape-chain:partner_dd_red_ip_chain"; // halt, S5 -> fs (14.2)
const RESCOPED_AT_PRE_FS = (t: "greenfield" | "brownfield") => [
  PARTNER_FIN,
  PARTNER_IP,
  `${t}-pre-fs:wacc_hurdle_still_assumed`,
  `${t}-pre-fs:certification_transferability_unconfirmed_and_load_bearing`,
];

describe("1. S3 Screening: the five unmeasurable criteria are not_reached with their carry", () => {
  test("opportunity at S3, track undecided: 0 kill_unassessed acks, the five keys listed not_reached with reevaluate_at", () => {
    const o = S.insertOpportunity(db, null, ANALYST);
    const { snapshot } = preview("opportunity", o, "screening");
    expect(snapshot.schema_version).toBe(GATE_SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.kill.procedures).toEqual(["brownfield-screening", "greenfield-screening"]);
    expect(snapshot.kill.unassessed).toEqual([]);
    expect(snapshot.required_acks.filter((a) => a.kind === "kill_unassessed")).toEqual([]);
    const byKey = new Map(snapshot.kill.not_reached.map((n) => [n.key, n]));
    for (const k of FIVE) expect(byKey.has(k)).toBe(true);
    expect(byKey.get(ZERO_SITE)).toMatchObject({ evaluable_from: "S5", reevaluate_at: "fs" });
    expect(byKey.get(HHI)).toMatchObject({ evaluable_from: "S7", reevaluate_at: "fs" });
    expect(byKey.get(NO_TARGET)).toMatchObject({ evaluable_from: "S6", reevaluate_at: "pre_fs" });
    expect(snapshot.kill.not_reached).toEqual([...snapshot.kill.not_reached].sort((a, b) => (a.key < b.key ? -1 : 1)));
    expect(snapshot.kill.current_stage).toMatch(/^S([1-9]|1[0-2])$/);
  });
  test("not_reached, carried_in and current_stage are inside the hash; computed_at stays outside", () => {
    const o = S.insertOpportunity(db, null, ANALYST);
    const { snapshot, hash } = preview("opportunity", o, "screening");
    const tweak = (
      patch: (k: {
        not_reached: Array<{ key: string }>;
        carried_in: Array<{ key: string }>;
        current_stage: string;
      }) => void,
    ) => {
      const copy = JSON.parse(JSON.stringify(snapshot));
      patch(copy.kill);
      return snapshotHash(copy);
    };
    expect(snapshotHash(snapshot)).toBe(hash);
    expect(tweak((k) => k.not_reached.pop())).not.toBe(hash);
    expect(tweak((k) => k.carried_in.push({ key: "x" }))).not.toBe(hash);
    expect(
      tweak((k) => {
        k.current_stage = "S12";
      }),
    ).not.toBe(hash);
    expect(snapshotHash({ ...snapshot, computed_at: "2030-01-01T00:00:00Z" })).toBe(hash);
  });
});

describe("2 + 13a. a triggered result is never hidden by stage scoping; early trigger carries partial_input (C-5)", () => {
  test("brownfield longlist with zero shortlisted at S3: triggered (not not_reached), partial_input, halt hard block", () => {
    const b = S.insertOpportunity(db, "brownfield", ANALYST);
    db.run(
      "INSERT INTO brownfield_target (id, opportunity_id, company_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      [ulid(), b, "T1", "excluded", S.NOW, S.NOW],
    );
    const { snapshot } = preview("opportunity", b, "screening");
    const t = snapshot.kill.triggered.find((x) => x.key === NO_TARGET);
    if (!t) throw new Error("expected the no_viable_target criterion to be triggered");
    expect(t).toMatchObject({ binding: true, override_id: null, partial_input: true, action: "halt" });
    expect(keysOf(snapshot.kill.not_reached)).not.toContain(NO_TARGET);
    expect(snapshot.hard_blocks.find((h) => h.code === "kill_binding_unoverridden")?.keys).toContain(NO_TARGET);
  });
  test("a trigger at or after its stage is not partial_input", () => {
    expect(
      classifyKill({
        outcome: "triggered",
        procedure: "brownfield-screening",
        evaluable_from: "S6",
        current_stage: "S6",
        track: "brownfield",
      }),
    ).toEqual({ cls: "triggered", partial_input: false });
    expect(
      classifyKill({
        outcome: "triggered",
        procedure: "brownfield-screening",
        evaluable_from: "S6",
        current_stage: "S3",
        track: "brownfield",
      }),
    ).toEqual({ cls: "triggered", partial_input: true });
  });
});

describe("3. reached criteria stay fail-closed", () => {
  test("classifier: reached + unassessed stays unassessed; an entry without evaluable_from is reached, never deferred", () => {
    expect(
      classifyKill({
        outcome: "unassessed",
        procedure: "greenfield-fs",
        evaluable_from: "S8",
        current_stage: "S8",
        track: "greenfield",
      }),
    ).toEqual({ cls: "unassessed", partial_input: false });
    expect(
      classifyKill({
        outcome: "unassessed",
        procedure: "greenfield-fs",
        evaluable_from: undefined,
        current_stage: "S1",
        track: null,
      }).cls,
    ).toBe("unassessed");
    expect(
      classifyKill({
        outcome: "unassessed",
        procedure: "greenfield-fs",
        evaluable_from: "S8",
        current_stage: "S7",
        track: null,
      }).cls,
    ).toBe("not_reached");
    expect(
      classifyKill({
        outcome: "false",
        procedure: "greenfield-fs",
        evaluable_from: "S8",
        current_stage: "S7",
        track: null,
      }).cls,
    ).toBe("not_reached");
    // ADR-0193 14.2: a criterion whose reevaluate_at is a LATER gate than the evaluating gate is deferred even when its stage is reached
    const deferred = {
      procedure: "deal-shape-chain",
      evaluable_from: "S5",
      current_stage: "S6",
      track: "greenfield",
      reevaluate_at: "fs",
      gate: "pre_fs",
    } as const;
    expect(classifyKill({ ...deferred, outcome: "unassessed" })).toEqual({ cls: "not_reached", partial_input: false });
    expect(classifyKill({ ...deferred, outcome: "false" }).cls).toBe("not_reached");
    expect(classifyKill({ ...deferred, outcome: "triggered" })).toEqual({ cls: "triggered", partial_input: true }); // a trigger is never scoped away
    // at its own gate (or later) it is reached; legacy callers without the pair are unchanged; open_monitoring never defers
    expect(classifyKill({ ...deferred, outcome: "unassessed", gate: "fs" }).cls).toBe("unassessed");
    expect(classifyKill({ ...deferred, outcome: "unassessed", reevaluate_at: "pre_fs" }).cls).toBe("unassessed");
    expect(classifyKill({ ...deferred, outcome: "unassessed", reevaluate_at: undefined }).cls).toBe("unassessed");
    expect(classifyKill({ ...deferred, outcome: "unassessed", reevaluate_at: "open_monitoring" }).cls).toBe(
      "unassessed",
    );
  });
  test("project fs: the S8 criterion with a missing variable still needs its kill_unassessed acknowledgement", () => {
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const { snapshot } = preview("project", projectId, "fs");
    expect(keysOf(snapshot.kill.unassessed)).toContain("greenfield-fs:permit_critical_path_exceeds_incentive_deadline");
    expect(keysOf(snapshot.kill.not_reached)).not.toContain(
      "greenfield-fs:permit_critical_path_exceeds_incentive_deadline",
    );
    expect(snapshot.required_acks.map((a) => a.kind)).toContain("kill_unassessed");
  });
});

describe("4 + 5 + 10. carries: closure by evaluation, overdue, carried halt (C-1)", () => {
  test("4. a Screening GO carry is evaluated at the project fs gate although that gate's procedure set does not include it", () => {
    const { projectId, oppId } = S.seedReadyProject(db, ANALYST);
    const from = addDecision("opportunity", oppId, "screening", "go", {
      not_reached: [nr(ZERO_SITE, "S5", "pre_fs"), nr(INFRA_PLAN, "S5", "pre_fs")],
      carried_in: [],
      unassessed: [],
    });
    const { snapshot } = preview("project", projectId, "fs");
    expect(snapshot.kill.procedures).toEqual(["greenfield-fs"]);
    const ci = new Map(snapshot.kill.carried_in.map((c) => [c.key, c]));
    expect(ci.get(ZERO_SITE)).toMatchObject({
      from_decision_id: from,
      outcome: "unassessed",
      closure: "open",
      action: "halt",
      reevaluate_at: "pre_fs",
      implicit: false,
    });
    expect(ci.get(INFRA_PLAN)).toMatchObject({
      outcome: "unassessed",
      closure: "open",
      action: "escalate_to_risk_officer",
    });
    // a carried non-halt criterion still needs the acknowledgement; a carried halt does not get an ack path at all
    expect(keysOf(snapshot.kill.unassessed)).toContain(INFRA_PLAN);
    expect(keysOf(snapshot.kill.unassessed)).not.toContain(ZERO_SITE);
  });
  test("a carry closes only by evaluation: a later snapshot listing it evaluated=false removes it from the open set", () => {
    const sources = [
      {
        decision_id: "d1",
        gate: "screening",
        decision: "go",
        decided_at: "2026-10-01T00:00:00Z",
        schema_version: 2,
        snapshot: { kill: { not_reached: [nr(ZERO_SITE, "S5", "pre_fs")] } },
      },
      {
        decision_id: "d2",
        gate: "pre_fs",
        decision: "go",
        decided_at: "2026-10-02T00:00:00Z",
        schema_version: 2,
        snapshot: {
          kill: { not_reached: [], carried_in: [{ key: ZERO_SITE, outcome: "unassessed", closure: "open" }] },
        },
      },
    ];
    const open = (src: CarrySource[]) => deriveOpenCarries(src, () => null).map((c) => c.key);
    expect(open(sources)).toEqual([ZERO_SITE]); // evaluated but still unassessed: stays open, an ack never closes it
    const closed = [
      ...sources,
      {
        decision_id: "d3",
        gate: "fs",
        decision: "go",
        decided_at: "2026-10-03T00:00:00Z",
        schema_version: 2,
        snapshot: { kill: { carried_in: [{ key: ZERO_SITE, outcome: "false", closure: "evaluated" }] } },
      },
    ];
    expect(open(closed)).toEqual([]);
  });
  test("5. a carry that cannot be classified as reached is overdue: kill_carry_overdue hard block", () => {
    setFlags("enforce", ...SNAP);
    const { projectId, oppId } = S.seedReadyProject(db, ANALYST);
    addDecision("opportunity", oppId, "screening", "go", {
      not_reached: [nr("greenfield-screening:no_such_criterion", "S5", "pre_fs")],
      carried_in: [],
    });
    const { snapshot } = preview("project", projectId, "fs");
    expect(snapshot.kill.carried_in).toMatchObject([
      { key: "greenfield-screening:no_such_criterion", outcome: "overdue", closure: "open" },
    ]);
    expect(snapshot.hard_blocks.find((h) => h.code === "kill_carry_overdue")).toMatchObject({
      keys: ["greenfield-screening:no_such_criterion"],
      enforced: true,
    });
    const go = recordProjectGo(projectId, snapshot);
    expect(go.ok).toBe(false);
    if (!go.ok) expect(go.failure).toMatchObject({ status: 409, code: "kill_carry_overdue" });
    const hold = recordProjectDecision(projectId, "hold", snapshot);
    expect(hold.ok).toBe(true); // HOLD is never blocked, and stores its snapshot
  });
  test("10. C-1: a carried halt still unassessed at its re-evaluation gate hard-blocks (no ack path, no override); the same criterion first reached there needs only the ack", () => {
    setFlags("enforce", ...SNAP);
    const { projectId, oppId } = S.seedReadyProject(db, ANALYST);
    addDecision("opportunity", oppId, "screening", "go", {
      not_reached: [nr(ZERO_SITE, "S5", "pre_fs")],
      carried_in: [],
    });
    const { snapshot } = preview("project", projectId, "fs");
    const hb = snapshot.hard_blocks.find((h) => h.code === "kill_carry_unassessed");
    expect(hb).toMatchObject({ keys: [ZERO_SITE], enforced: true });
    expect(snapshot.required_acks.map((a) => a.key)).not.toContain(ZERO_SITE);
    const go = recordProjectGo(projectId, snapshot);
    expect(go.ok).toBe(false);
    if (!go.ok) expect(go.failure).toMatchObject({ status: 409, code: "kill_carry_unassessed" });
    // not overridable: even with every acknowledgement supplied, the GO stays refused (R-5)
    const withAcks = recordProjectGo(
      projectId,
      snapshot,
      snapshot.required_acks
        .map((a) => ({ key: a.key, kind: a.kind, reason: S.GENUINE }))
        .concat([{ key: ZERO_SITE, kind: "kill_unassessed", reason: S.GENUINE }]),
    );
    expect(withAcks.ok).toBe(false);
    // first reached at the gate (no carry): the same halt criterion is an ordinary acknowledgement
    const { projectId: p2 } = S.seedReadyProject(db, ANALYST);
    const fresh = preview("project", p2, "fs");
    expect(fresh.snapshot.hard_blocks.map((h) => h.code)).not.toContain("kill_carry_unassessed");
  });
});

describe("6. legacy (schema v1) decisions", () => {
  test("a legacy acknowledged GO opens implicit carries for unassessed keys that were not yet evaluable; the legacy hash still verifies", () => {
    const { projectId, oppId } = S.seedReadyProject(db, ANALYST);
    const legacyKill = {
      procedures: ["greenfield-screening"],
      evaluated: 3,
      inert: 0,
      inert_list: [],
      false_count: 0,
      triggered: [],
      unassessed: [
        {
          key: ZERO_SITE,
          procedure: "greenfield-screening",
          criterion_id: "zero_site_clears_infrastructure_minimums",
          title: "t",
          action: "halt",
        },
        {
          key: "greenfield-screening:strategic_fit_knock_out_failed",
          procedure: "greenfield-screening",
          criterion_id: "strategic_fit_knock_out_failed",
          title: "t",
          action: "halt",
        },
      ],
      eval_run_id: null,
    };
    const id = addDecision("opportunity", oppId, "screening", "go", legacyKill, { version: 1 });
    const stored = getGateSnapshot(id, db);
    if (!stored) throw new Error("snapshot row missing");
    expect(stored.schema_version).toBe(1);
    expect(verifyStoredSnapshotHash(stored)).toEqual({ ok: true, reason: null });
    expect(verifyStoredSnapshotHash({ ...stored, snapshot_hash: "0".repeat(64) })).toEqual({
      ok: false,
      reason: "hash_mismatch",
    });
    expect(verifyStoredSnapshotHash({ ...stored, schema_version: 99 }).ok).toBe(false);
    const read = normalizeStoredSnapshot(stored.snapshot) as {
      kill: { not_reached: unknown[]; carried_in: unknown[] };
    };
    expect(read.kill.not_reached).toEqual([]);
    expect(read.kill.carried_in).toEqual([]);
    const { snapshot } = preview("project", projectId, "fs");
    const ci = snapshot.kill.carried_in.find((c) => c.key === ZERO_SITE);
    if (!ci) throw new Error("expected the implicit carry for the zero-site criterion");
    expect(ci).toMatchObject({ from_decision_id: id, implicit: true, outcome: "unassessed", closure: "open" });
    // a criterion that WAS evaluable at Screening (S3) is not an implicit carry: its ack stood
    expect(keysOf(snapshot.kill.carried_in)).not.toContain("greenfield-screening:strategic_fit_knock_out_failed");
  });
  test("a v1 HOLD carries nothing (only acknowledged GOs were acknowledgements)", () => {
    const open = deriveOpenCarries(
      [
        {
          decision_id: "h",
          gate: "screening",
          decision: "hold",
          decided_at: "2026-10-01T00:00:00Z",
          schema_version: 1,
          snapshot: { kill: { unassessed: [{ key: ZERO_SITE }] } },
        },
      ],
      () => ({ evaluable_from: "S5", reevaluate_at: "pre_fs" }),
    );
    expect(open).toEqual([]);
  });
  test("R-4: the one-time listing shows legacy Screening acknowledgements and the later gate that re-asks them; it writes nothing", () => {
    const o = S.insertOpportunity(db, "greenfield", ANALYST);
    const legacy = addDecision(
      "opportunity",
      o,
      "screening",
      "go",
      { unassessed: [{ key: ZERO_SITE }] },
      { version: 1 },
    );
    db.run("UPDATE gate_decision SET decided_by = ? WHERE id = ?", [ANALYST, legacy]);
    // acknowledgements live on the snapshot row; seed one through a fresh decision with an ack payload
    const id2 = S.insertGate(db, "opportunity", o, "screening", "go", "2026-10-29T09:00:00Z");
    const snap = { schema_version: 1, kill: { unassessed: [{ key: ZERO_SITE }] } };
    insertGateSnapshot(db, {
      decisionId: id2,
      schemaVersion: 1,
      snapshotJson: JSON.stringify(snap),
      snapshotHash: snapshotHash(snap),
      submittedHash: null,
      acknowledgements: [{ key: ZERO_SITE, kind: "kill_unassessed", reason: "accepted at screening" }],
      computedAt: "2026-10-29T09:00:00Z",
      engineVersionsJson: "{}",
      evalRunId: null,
      briefId: null,
    });
    const before = db.query("SELECT COUNT(*) c FROM audit_log").get() as { c: number };
    const rows = listLegacyScreeningKillAcks(db).filter((r) => r.entity_id === o);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      decision_id: id2,
      key: ZERO_SITE,
      reevaluate_at: "fs",
      evaluable_from: "S5",
      implicit_carry: true,
      reason: "accepted at screening",
    });
    expect((db.query("SELECT COUNT(*) c FROM audit_log").get() as { c: number }).c).toBe(before.c);
    S.insertGate(db, "opportunity", o, "pre_fs", "kill");
    expect(listLegacyScreeningKillAcks(db).filter((r) => r.entity_id === o)).toEqual([]); // not in flight any more
  });
});

describe("7. the contract rejects an acknowledgement for a not_reached key", () => {
  test("GO with an ack for a not-reached key is 400 ack_not_reached, even with the fresh hash", () => {
    setFlags("enforce", ...SNAP);
    const o = S.insertOpportunity(db, "greenfield", ANALYST);
    const { snapshot, hash } = preview("opportunity", o, "screening");
    expect(snapshot.kill.not_reached.length).toBeGreaterThan(0);
    const stale = snapshot.kill.not_reached[0].key;
    const res = recordGateDecisionRow(db, {
      entityType: "opportunity",
      entityId: o,
      gate: "screening",
      decision: "go",
      storedRationale: S.GENUINE,
      missingArtifactsJson: null,
      actor: ANALYST,
      gateEvaluationId: null,
      learningCapture: null,
      judgementConfirmationsJson: null,
      extras: {
        snapshotHash: hash,
        acknowledgements: [{ key: stale, reason: S.GENUINE }],
        briefId: null,
        divergenceReason: null,
        killOverrideId: null,
      },
      now: new Date().toISOString(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.failure).toMatchObject({ status: 400, code: "ack_not_reached", details: { keys: [stale] } });
    const clean = recordGateDecisionRow(db, {
      entityType: "opportunity",
      entityId: o,
      gate: "screening",
      decision: "go",
      storedRationale: S.GENUINE,
      missingArtifactsJson: null,
      actor: ANALYST,
      gateEvaluationId: null,
      learningCapture: null,
      judgementConfirmationsJson: null,
      extras: { snapshotHash: hash, acknowledgements: [], briefId: null, divergenceReason: null, killOverrideId: null },
      now: new Date().toISOString(),
    });
    expect(clean.ok).toBe(true);
    if (clean.ok) {
      const stored = getGateSnapshot(clean.id, db);
      if (!stored) throw new Error("snapshot row missing");
      expect(stored.schema_version).toBe(3);
      expect(verifyStoredSnapshotHash(stored).ok).toBe(true);
      // the GO is now a recorded carry source for later gates
      expect(
        deriveOpenCarries(
          [
            {
              decision_id: clean.id,
              gate: "screening",
              decision: "go",
              decided_at: "2026-11-01T00:00:00Z",
              schema_version: 2,
              snapshot: stored.snapshot as Record<string, unknown>,
            },
          ],
          () => null,
        )
          .map((c) => c.key)
          .sort(),
      ).toEqual(keysOf(snapshot.kill.not_reached).sort());
    }
  });
});

describe("8 + 12. track switch and HOLD carries (C-4)", () => {
  test("8. after a route change the old-track carry is closed out_of_track, listed with the route decision id, never counted evaluated", () => {
    const o = S.insertOpportunity(db, "greenfield", ANALYST);
    const from = addDecision("opportunity", o, "screening", "go", {
      not_reached: [nr(ZERO_SITE, "S5", "pre_fs"), nr(HHI, "S7", "target_screening")],
      carried_in: [],
    });
    const routeId = ulid();
    db.run("UPDATE route_decision SET is_current = 0 WHERE opportunity_id = ?", [o]);
    db.run(
      "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)",
      [routeId, o, "brownfield", "reversal", ANALYST, "2026-10-30T09:00:00Z"],
    );
    const { snapshot } = preview("opportunity", o, "pre_fs");
    expect(snapshot.track).toBe("brownfield");
    const ci = snapshot.kill.carried_in.find((c) => c.key === ZERO_SITE);
    if (!ci) throw new Error("expected the out_of_track carry for the zero-site criterion");
    expect(ci).toMatchObject({
      from_decision_id: from,
      outcome: "out_of_track",
      closure: "out_of_track",
      route_decision_id: routeId,
    });
    expect(keysOf(snapshot.kill.unassessed)).not.toContain(ZERO_SITE);
    expect(snapshot.hard_blocks.map((h) => h.code)).not.toContain("kill_carry_unassessed");
    // the brownfield carry that is not yet due stays open (not listed, not dropped)
    expect(
      deriveOpenCarries(
        [
          {
            decision_id: from,
            gate: "screening",
            decision: "go",
            decided_at: "2026-10-28T09:00:00Z",
            schema_version: 2,
            snapshot: { kill: { not_reached: [nr(HHI, "S7", "target_screening")] } },
          },
        ],
        () => null,
      ).map((c) => c.key),
    ).toEqual([HHI]);
    expect(carryDue("target_screening", "pre_fs")).toBe(false);
  });
  test("a legacy (v1) pre_fs GO that acknowledged #12/#13 unassessed gets an implicit carry to fs (registry deferral, ADR-0193 14.2); a criterion owned by its own gate does not", () => {
    const scope = (k: string) =>
      k.includes("wacc") || k.includes("certification")
        ? { evaluable_from: "S4", reevaluate_at: "fs" }
        : { evaluable_from: "S4", reevaluate_at: "pre_fs" };
    const W = "greenfield-pre-fs:wacc_hurdle_still_assumed";
    const C = "greenfield-pre-fs:certification_transferability_unconfirmed_and_load_bearing";
    const OWN = "greenfield-pre-fs:entry_route_undecided_at_pre_fs_exit";
    const open = deriveOpenCarries(
      [
        {
          decision_id: "legacy",
          gate: "pre_fs",
          decision: "go",
          decided_at: "2026-10-01T00:00:00Z",
          schema_version: 1,
          snapshot: { kill: { unassessed: [{ key: W }, { key: C }, { key: OWN }] } },
        },
      ],
      scope,
    );
    expect(open.map((c) => c.key)).toEqual([C, W].sort());
    expect(open.every((c) => c.implicit && c.reevaluate_at === "fs")).toBe(true);
  });
  test("12. a carry recorded by a HOLD is evaluated at re-entry; a KILL carries nothing", () => {
    const { projectId, oppId } = S.seedReadyProject(db, ANALYST);
    const hold = addDecision("opportunity", oppId, "pre_fs", "hold", {
      not_reached: [nr(INFRA_PLAN, "S5", "pre_fs")],
      carried_in: [],
    });
    const { snapshot } = preview("project", projectId, "fs");
    expect(snapshot.kill.carried_in.find((c) => c.key === INFRA_PLAN)).toMatchObject({
      from_decision_id: hold,
      outcome: "unassessed",
    });
    const k = deriveOpenCarries(
      [
        {
          decision_id: "k",
          gate: "pre_fs",
          decision: "kill",
          decided_at: "2026-10-01T00:00:00Z",
          schema_version: 2,
          snapshot: { kill: { not_reached: [nr(ZERO_SITE, "S5", "pre_fs")] } },
        },
      ],
      () => null,
    );
    expect(k).toEqual([]);
  });
  test("a recorded carry survives later decisions that do not list it (every decision of the lineage is read)", () => {
    const sources = [
      {
        decision_id: "a",
        gate: "screening",
        decision: "go",
        decided_at: "2026-10-01T00:00:00Z",
        schema_version: 2,
        snapshot: { kill: { not_reached: [nr(HHI, "S7", "target_screening")] } },
      },
      {
        decision_id: "b",
        gate: "pre_fs",
        decision: "go",
        decided_at: "2026-10-02T00:00:00Z",
        schema_version: 2,
        snapshot: { kill: { not_reached: [], carried_in: [] } },
      },
    ];
    expect(deriveOpenCarries(sources as CarrySource[], () => null).map((c) => c.key)).toEqual([HHI]);
  });
});

describe("11. C-3 lineage gap at the first project gate", () => {
  test("a project without source_opportunity_id: kill_lineage_missing hard block, operator-actionable, GO refused; HOLD stored", () => {
    setFlags("enforce", ...SNAP);
    const orphan = S.insertProject(db, null);
    S.addMember(db, orphan, ANALYST, "lead");
    const { snapshot } = preview("project", orphan, "fs");
    expect(snapshot.kill.lineage_missing).toBe(true);
    expect(snapshot.hard_blocks.find((h) => h.code === "kill_lineage_missing")).toMatchObject({
      keys: [orphan],
      enforced: true,
    });
    const go = recordProjectGo(orphan, snapshot);
    expect(go.ok).toBe(false);
    if (!go.ok) {
      expect(go.failure).toMatchObject({ status: 409, code: "kill_lineage_missing" });
      expect(go.failure.message).toContain("md_project.source_opportunity_id");
      expect(go.failure.message).toContain("promote");
      expect(go.failure.details?.repair).toBeTruthy();
    }
    expect(recordProjectDecision(orphan, "hold", snapshot).ok).toBe(true);
    // a linked project, and later gates, never raise it
    const linked = S.insertProject(db, S.insertOpportunity(db, "greenfield", ANALYST));
    S.addMember(db, linked, ANALYST, "lead");
    expect(preview("project", linked, "fs").snapshot.kill.lineage_missing).toBe(false);
    expect(preview("project", orphan, "dd").snapshot.kill.lineage_missing).toBe(false);
  });
  test("shadow mode audits the would-block and does not refuse (family kill_binding)", () => {
    setFlags("shadow", ...SNAP);
    const orphan = S.insertProject(db, null);
    S.addMember(db, orphan, ANALYST, "lead");
    const { snapshot } = preview("project", orphan, "fs");
    expect(snapshot.hard_blocks.find((h) => h.code === "kill_lineage_missing")?.enforced).toBe(false);
  });
});

describe("13b. S12 criteria leave IC as open_monitoring carries, evaluated by data phase (C-6, Q5; risk-officer A)", () => {
  const MON = [
    "pmi-integration-execution:key_talent_attrition_above_threshold_at_90d",
    "pmi-integration-execution:synergy_run_rate_uncertified_at_bau_handover",
  ];
  test("a brownfield entity_ic snapshot reports both S12 criteria unassessed - post-close data not yet available - visible in the carry list, never silently skipped", () => {
    const o = S.insertOpportunity(db, "brownfield", ANALYST);
    const pid = S.insertProject(db, o, "brownfield");
    S.addMember(db, pid, ANALYST, "lead");
    const { snapshot } = preview("project", pid, "entity_ic");
    const mon = snapshot.kill.carried_in.filter((c) => c.closure === "open_monitoring");
    expect(keysOf(mon)).toEqual(MON);
    expect(
      mon.every(
        (c) =>
          c.outcome === "unassessed" &&
          c.reason === "post-close data not yet available" &&
          c.reevaluate_at === "open_monitoring" &&
          c.evaluable_from === "S12" &&
          c.title.length > 0,
      ),
    ).toBe(true);
    // information only: no acknowledgement, no hard block (no gate can obtain post-close data), never an ack target
    for (const k of MON) {
      expect(keysOf(snapshot.kill.triggered)).not.toContain(k);
      expect(keysOf(snapshot.kill.unassessed)).not.toContain(k);
    }
    expect(snapshot.hard_blocks.map((h) => h.code)).not.toContain("kill_carry_unassessed");
    expect(snapshot.hard_blocks.map((h) => h.code)).not.toContain("kill_carry_overdue");
  });
  test("an acknowledgement for an open_monitoring key is rejected 400 ack_not_reached", () => {
    setFlags("enforce", "snapshot_ack"); // the ack contract only: a bare fixture project also trips unrelated binding halts
    const o = S.insertOpportunity(db, "brownfield", ANALYST);
    const pid = S.insertProject(db, o, "brownfield");
    S.addMember(db, pid, ANALYST, "lead");
    // ADR-0196: a convened session so the ack contract error under test is not masked by committee_session_missing.
    S.seedCommitteeSession(db, pid, ANALYST);
    const view = preview("project", pid, "entity_ic");
    const res = recordGateDecisionRow(db, {
      entityType: "project",
      entityId: pid,
      gate: "entity_ic",
      decision: "go",
      storedRationale: S.GENUINE,
      missingArtifactsJson: null,
      actor: ANALYST,
      gateEvaluationId: null,
      learningCapture: null,
      judgementConfirmationsJson: null,
      extras: {
        snapshotHash: view.hash,
        acknowledgements: [{ key: MON[0], reason: S.GENUINE }],
        briefId: null,
        divergenceReason: null,
        killOverrideId: null,
      },
      now: new Date().toISOString(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.failure).toMatchObject({ status: 400, code: "ack_not_reached", details: { keys: [MON[0]] } });
  });
  test("the dd gate evaluates only the clean-team criterion of the pmi procedure (flow.spec 2.19.0)", () => {
    const o = S.insertOpportunity(db, "brownfield", ANALYST);
    const pid = S.insertProject(db, o, "brownfield");
    S.addMember(db, pid, ANALYST, "lead");
    const { snapshot } = preview("project", pid, "dd");
    expect(snapshot.kill.procedures).toContain("pmi-integration-execution");
    expect(snapshot.kill.inert_list.map((i) => i.key)).toContain(
      "pmi-integration-execution:clean_team_protocol_breach",
    );
    expect(snapshot.kill.inert_list.map((i) => i.key)).not.toContain(MON[0]);
    expect(keysOf(snapshot.kill.triggered)).not.toContain(MON[1]);
  });
});

/** Run `fn` as if #9 still had no opportunity-scope source (ADR-0194 item A not landed); the real list is restored afterwards. */
function withoutDealShapeSource<T>(fn: () => T): T {
  const vars = OPPORTUNITY_SCOPE_VARS as string[];
  const at = vars.indexOf("dealshape.viable_shapes");
  vars.splice(at, 1);
  try {
    return fn();
  } finally {
    vars.splice(at, 0, "dealshape.viable_shapes");
  }
}

describe("B. enforce guard: kill_binding=enforce is fail-closed while a carried or own-gate criterion has no data source at its scope", () => {
  test("real registry (ADR-0193 14.1, ADR-0194 item A): #4/#5/#6/#8 are re-scoped to fs and #9 now has an opportunity-scope source, so no offender is left", () => {
    expect(OPPORTUNITY_SCOPE_VARS).toContain("dealshape.viable_shapes");
    expect(carriedWithoutDataSource()).toEqual([]);
    // #7 reads screening.viable_targets and #9 reads dealshape.viable_shapes, both opportunity-scope variables
    const offenders = carriedWithoutDataSource().map((o) => o.key);
    for (const k of [HHI, INFRA_PLAN, PARTNER_GF, ZERO_SITE, NO_TARGET, NO_SHAPE]) expect(offenders).not.toContain(k);
    // #10-#13 are deferred past their own gate to fs, so the reached-at-own-gate listing does not carry them
    for (const t of ["greenfield", "brownfield"] as const)
      for (const k of RESCOPED_AT_PRE_FS(t)) expect(offenders).not.toContain(k);
  });
  test("the guard still detects a reached-at-own-gate criterion whose variable has no opportunity source (#9 without its source, restored after)", () => {
    const offenders = withoutDealShapeSource(() => carriedWithoutDataSource());
    expect(offenders.map((o) => o.key)).toEqual([NO_SHAPE]);
    // first met at pre_fs, where #9 is a carry to its own gate target_screening (deal-shape-to-S7 R-2); also listed there as reached_at_own_gate
    expect(offenders[0]).toMatchObject({
      kind: "carried",
      reevaluate_at: "target_screening",
      missing_vars: ["dealshape.viable_shapes"],
    });
    expect(carriedWithoutDataSource()).toEqual([]);
  });
  test("startup check: the real registry is enforce-safe now; the refusal logic still holds when a source is missing, and the test environment bypass is explicit", () => {
    const enforce = { NODE_ENV: "production", CO_NEWBIZ_GATE_INTEGRITY_KILL_BINDING: "enforce" };
    expect(() => assertKillEnforceSafe(enforce)).not.toThrow(); // ADR-0194: no offender left against the real registry
    expect(killEnforceGuard({ NODE_ENV: "development" }).unsafe).toBe(false);
    withoutDealShapeSource(() => {
      expect(() => assertKillEnforceSafe(enforce)).toThrow(/kill_enforce_unsafe/);
      expect(() =>
        assertKillEnforceSafe({ ...enforce, CO_NEWBIZ_GATE_INTEGRITY_KILL_BINDING: "shadow" }),
      ).not.toThrow();
      expect(() => assertKillEnforceSafe({ NODE_ENV: "production" })).not.toThrow(); // production default is shadow
      expect(killEnforceGuard({ NODE_ENV: "development" }).unsafe).toBe(true);
      expect(killEnforceGuard({ NODE_ENV: "test" }).unsafe).toBe(false);
      expect(killEnforceGuard({ NODE_ENV: "test", CO_NEWBIZ_KILL_ENFORCE_GUARD_TEST: "on" }).unsafe).toBe(true);
    });
    expect(killEnforceGuard({ NODE_ENV: "test", CO_NEWBIZ_KILL_ENFORCE_GUARD_TEST: "on" }).unsafe).toBe(false);
  });
  test("decision path: with the guard live and a criterion lacking its source, a GO is refused kill_enforce_unsafe (409), the snapshot flags it, HOLD is never blocked; with the real registry it is not raised", () => {
    process.env.CO_NEWBIZ_KILL_ENFORCE_GUARD_TEST = "on";
    setFlags("enforce", ...SNAP);
    const { projectId } = S.seedReadyProject(db, ANALYST);
    expect(preview("project", projectId, "fs").snapshot.hard_blocks.map((h) => h.code)).not.toContain(
      "kill_enforce_unsafe",
    );
    withoutDealShapeSource(() => {
      const view = preview("project", projectId, "fs");
      expect(view.snapshot.hard_blocks.find((h) => h.code === "kill_enforce_unsafe")).toMatchObject({ enforced: true });
      expect(view.snapshot.hard_blocks.find((h) => h.code === "kill_enforce_unsafe")?.keys).toEqual([NO_SHAPE]);
      const go = recordProjectGo(projectId, view);
      expect(go.ok).toBe(false);
      if (!go.ok) expect(go.failure).toMatchObject({ status: 409, code: "kill_enforce_unsafe" });
      expect(recordProjectDecision(projectId, "hold", view).ok).toBe(true);
    });
  });
  test("shadow mode never raises it (the flag is not enforce)", () => {
    process.env.CO_NEWBIZ_KILL_ENFORCE_GUARD_TEST = "on";
    setFlags("shadow", ...SNAP);
    const { projectId } = S.seedReadyProject(db, ANALYST);
    expect(preview("project", projectId, "fs").snapshot.hard_blocks.map((h) => h.code)).not.toContain(
      "kill_enforce_unsafe",
    );
  });
});

describe("C. #5 caveat; D. scheduled items; E. IC package lists open carries by name", () => {
  test("C. #5 is read at the site-announcement date, so it carries no evidence caveat (ADR-0194 B-3: the C-6 text is gone)", () => {
    const { projectId, oppId } = S.seedReadyProject(db, ANALYST);
    addDecision("opportunity", oppId, "screening", "go", {
      not_reached: [nr(INFRA_PLAN, "S5", "pre_fs")],
      carried_in: [],
    });
    const { snapshot } = preview("project", projectId, "fs");
    expect(KILL_EVIDENCE_CAVEATS).toEqual({});
    expect(snapshot.kill.caveats).toEqual([]);
    // #5 is still evaluated at fs (fail-closed): no announcement or assertion is recorded, so it reads unassessed.
    expect(keysOf([...snapshot.kill.unassessed, ...snapshot.kill.triggered])).toContain(INFRA_PLAN);
  });
  test("D. deal-shape-chain (#9-#11) shows at Screening as pending with its scheduled gate (target_screening / fs / fs), not absent; pre_fs owns the carry", () => {
    const o = S.insertOpportunity(db, "greenfield", ANALYST);
    const { snapshot } = preview("opportunity", o, "screening");
    expect(snapshot.kill.scheduled.map((x) => x.key)).toEqual([NO_SHAPE, PARTNER_FIN, PARTNER_IP]);
    // each item shows its own re-evaluation gate: #9 at target_screening (deal-shape-to-S7 R-2), #10/#11 at fs (ADR-0193 14.2)
    expect(snapshot.kill.scheduled.every((x) => x.status === "pending" && x.title.length > 0)).toBe(true);
    expect(snapshot.kill.scheduled.map((x) => x.reevaluate_at)).toEqual(["target_screening", "fs", "fs"]);
    expect(snapshot.kill.procedures).not.toContain("deal-shape-chain");
    expect(preview("opportunity", o, "pre_fs").snapshot.kill.scheduled).toEqual([]);
  });
  test("E. the IC package names the carried criteria that are evaluated but still unassessed, and the open_monitoring ones", async () => {
    const { projectId, oppId } = S.seedReadyProject(db, ANALYST);
    addDecision("opportunity", oppId, "screening", "go", {
      not_reached: [nr(INFRA_PLAN, "S5", "pre_fs")],
      carried_in: [],
    });
    const cookie = await (async () => {
      const res = await nextRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ userId: ANALYST, password: `pw-${ANALYST}-123456` }),
      });
      return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
    })();
    db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = ?", [ANALYST]);
    const res = await nextRequest(`/api/projects/${projectId}/ic-package`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const data = (
      (await res.json()) as {
        data: { kill_carries: { gate: string; open: Array<{ key: string; title: string } & Record<string, unknown>> } };
      }
    ).data;
    expect(data.kill_carries.gate).toBe("entity_ic");
    const open = data.kill_carries.open.find((c) => c.key === INFRA_PLAN);
    expect(open).toMatchObject({
      outcome: "unassessed",
      closure: "open",
      reevaluate_at: "pre_fs",
      action: "escalate_to_risk_officer",
    });
    expect(open?.title.length).toBeGreaterThan(0);
  });
});

describe("13c. #5 point-in-time predicate (C-6, ADR-0194 item B)", () => {
  // The full truth table lives in tests/unit/site-announcement.test.ts; here the gate snapshot proves the end-to-end read.
  function recordPlan(projectId: string, answer: "yes" | "no", effectiveOn: string | null, reviewed = true): void {
    const runId = ulid();
    db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [
      runId,
      projectId,
      `hash-${runId.slice(-6)}`,
      ANALYST,
      S.NOW,
    ]);
    db.run(
      "INSERT INTO dimension_input (id, run_id, project_id, var_key, value_kind, value_text, evidence_ref, asserted_by, reviewed_by, rationale, observed_at, effective_on) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        ulid(),
        runId,
        projectId,
        "infra.plan_finalized",
        "text",
        answer,
        "doc:plan-1",
        ANALYST,
        reviewed ? "carry-reviewer" : null,
        "test",
        "2026-11-01T00:00:00Z",
        effectiveOn,
      ],
    );
  }
  function recordAnnouncement(projectId: string, announcedOn: string): void {
    db.run(
      "INSERT INTO site_announcement (id, project_id, announced_on, announcement_kind, evidence_ref, recorded_by, recorded_at) VALUES (?,?,?,?,?,?,?)",
      [ulid(), projectId, announcedOn, "public_announcement", "doc:announcement-1", ANALYST, "2026-11-01T00:00:00Z"],
    );
  }
  /** A ready greenfield project at fs whose screening decision carried #5 (the real flow: #5 is re-evaluated at fs). */
  function seed(): string {
    const { projectId, oppId } = S.seedReadyProject(db, ANALYST);
    addDecision("opportunity", oppId, "screening", "go", {
      not_reached: [nr(INFRA_PLAN, "S5", "pre_fs")],
      carried_in: [],
    });
    return projectId;
  }
  const outcome = (projectId: string): "triggered" | "unassessed" | "clean" => {
    const k = preview("project", projectId, "fs").snapshot.kill;
    if (keysOf(k.triggered).includes(INFRA_PLAN)) return "triggered";
    if (keysOf(k.unassessed).includes(INFRA_PLAN)) return "unassessed";
    return "clean";
  };
  test("a plan finalized after the announcement triggers; before or on the same day is clean; every gap stays unassessed", () => {
    const a = seed();
    expect(outcome(a)).toBe("unassessed"); // nothing recorded
    recordAnnouncement(a, "2026-03-10");
    expect(outcome(a)).toBe("unassessed"); // announcement but no assertion
    recordPlan(a, "yes", "2026-05-01");
    expect(outcome(a)).toBe("triggered"); // finalized after the announcement

    const b = seed();
    recordAnnouncement(b, "2026-03-10");
    recordPlan(b, "yes", "2026-03-10");
    expect(outcome(b)).toBe("clean"); // same day counts as clean

    const c = seed();
    recordAnnouncement(c, "2026-03-10");
    recordPlan(c, "yes", null);
    expect(outcome(c)).toBe("unassessed"); // yes without effective_on is never clean
    const d = seed();
    recordAnnouncement(d, "2026-03-10");
    recordPlan(d, "yes", "2026-01-01", false);
    expect(outcome(d)).toBe("unassessed"); // unreviewed assertion fills nothing
  });
});

describe("overrides: a carried triggered halt is overridable on the project (R-5 keeps overdue / carried-unassessed / lineage un-overridable)", () => {
  test("the project override universe includes the carried opportunity procedures and the pmi procedure", async () => {
    const { PMI_PROCEDURE, OPPORTUNITY_PROCEDURES } = await import("../../app/web-next/lib/gate-snapshot.ts");
    expect(PMI_PROCEDURE).toBe("pmi-integration-execution");
    expect(OPPORTUNITY_PROCEDURES.screening("greenfield")).toContain("greenfield-screening");
    expect(OPPORTUNITY_PROCEDURES.pre_fs("brownfield")).toContain("deal-shape-chain");
  });
});

describe("RESCOPE-2 (ADR-0193 14.1/14.2): criteria listed at the opportunity pre_fs gate whose evidence is project-scoped are not_reached with a carry to fs", () => {
  for (const track of ["greenfield", "brownfield"] as const) {
    test(`${track} opportunity at pre_fs: #10/#11/#12/#13 are not_reached (carry to fs), never reached-unassessed; #9 is ${track === "brownfield" ? "not_reached (carry to target_screening)" : "out_of_track (no carry, no ack)"}`, () => {
      const o = S.insertOpportunity(db, track, ANALYST);
      const { snapshot } = preview("opportunity", o, "pre_fs");
      expect(snapshot.kill.procedures).toEqual(["deal-shape-chain", `${track}-pre-fs`].sort());
      const nrByKey = new Map(snapshot.kill.not_reached.map((n) => [n.key, n]));
      for (const k of RESCOPED_AT_PRE_FS(track)) {
        expect(nrByKey.get(k)).toMatchObject({ reevaluate_at: "fs" });
        expect(keysOf(snapshot.kill.unassessed)).not.toContain(k);
        expect(snapshot.required_acks.map((a) => a.key)).not.toContain(k); // no meaningless blind acknowledgement
        expect(keysOf(snapshot.kill.triggered)).not.toContain(k);
      }
      // a deferral is not an overdue carry at its own gate
      expect(snapshot.kill.carried_in.filter((c) => RESCOPED_AT_PRE_FS(track).includes(c.key))).toEqual([]);
      // #9 (deal-shape-to-S7 R-2): the S7 evaluation cannot exist at pre_fs, so it never asks for a blind acknowledgement here.
      expect(keysOf(snapshot.kill.unassessed)).not.toContain(NO_SHAPE);
      expect(snapshot.required_acks.map((a) => a.key)).not.toContain(NO_SHAPE);
      if (track === "brownfield") {
        expect(nrByKey.get(NO_SHAPE)).toMatchObject({ evaluable_from: "S7", reevaluate_at: "target_screening" }); // a carry to target_screening
      } else {
        expect(keysOf(snapshot.kill.not_reached)).not.toContain(NO_SHAPE); // brownfield-only criterion: nothing to carry on greenfield
      }
    });
  }
  test("a pre_fs GO recorded from that snapshot opens the carries, and the project fs gate evaluates them (carried halts hard-block while unassessed, C-1)", () => {
    setFlags("enforce", ...SNAP);
    const { projectId, oppId } = S.seedReadyProject(db, ANALYST);
    const opp = preview("opportunity", oppId, "pre_fs").snapshot;
    addDecision("opportunity", oppId, "pre_fs", "go", {
      not_reached: opp.kill.not_reached,
      carried_in: opp.kill.carried_in,
      unassessed: opp.kill.unassessed,
    });
    const open = deriveOpenCarries(
      [
        {
          decision_id: "x",
          gate: "pre_fs",
          decision: "go",
          decided_at: "2026-10-28T09:00:00Z",
          schema_version: 2,
          snapshot: { kill: { not_reached: opp.kill.not_reached } },
        },
      ],
      () => null,
    ).map((c) => c.key);
    for (const k of RESCOPED_AT_PRE_FS("greenfield")) expect(open).toContain(k);
    const { snapshot } = preview("project", projectId, "fs");
    const ci = new Map(snapshot.kill.carried_in.map((c) => [c.key, c]));
    for (const k of RESCOPED_AT_PRE_FS("greenfield"))
      expect(ci.get(k)).toMatchObject({ reevaluate_at: "fs", closure: expect.stringMatching(/^(open|evaluated)$/) });
    expect(ci.get(PARTNER_FIN)).toMatchObject({ action: "halt" });
  });
});

describe("RESCOPE sources at the first project gate: the re-scoped carries are assessable at fs (ADR-0193 14.1)", () => {
  const WACC_GF = "greenfield-pre-fs:wacc_hurdle_still_assumed";
  const carriedAt = (oppId: string, keys: Array<[string, string]>) =>
    addDecision("opportunity", oppId, "pre_fs", "go", {
      not_reached: keys.map(([k, from]) => nr(k, from, "fs")),
      carried_in: [],
    });
  test("#4: site_candidate with a complete four-flag assessment is read (no SQL error); one clearing site closes the carry false, none clearing triggers the halt", () => {
    const { projectId, oppId } = S.seedReadyProject(db, ANALYST);
    carriedAt(oppId, [[ZERO_SITE, "S5"]]);
    const before = preview("project", projectId, "fs").snapshot.kill.carried_in.find((c) => c.key === ZERO_SITE);
    if (!before) throw new Error("expected the zero-site carry to be open");
    expect(before).toMatchObject({ outcome: "unassessed", closure: "open" }); // no site assessed: never a silent pass
    db.run(
      "INSERT INTO site_candidate (id, project_id, name, wastewater_capacity_sufficient, power_capacity_sufficient, industrial_water_sufficient, logistics_access_sufficient) VALUES (?,?,?,?,?,?,?)",
      [ulid(), projectId, "partial", 1, 1, null, null],
    );
    expect(preview("project", projectId, "fs").snapshot.kill.carried_in.find((c) => c.key === ZERO_SITE)).toMatchObject(
      { outcome: "unassessed" },
    ); // partial assessment cannot manufacture a clearance
    db.run(
      "INSERT INTO site_candidate (id, project_id, name, wastewater_capacity_sufficient, power_capacity_sufficient, industrial_water_sufficient, logistics_access_sufficient) VALUES (?,?,?,?,?,?,?)",
      [ulid(), projectId, "none clears", 0, 1, 1, 1],
    );
    const trig = preview("project", projectId, "fs").snapshot.kill;
    expect(keysOf(trig.triggered)).toContain(ZERO_SITE);
    db.run(
      "INSERT INTO site_candidate (id, project_id, name, wastewater_capacity_sufficient, power_capacity_sufficient, industrial_water_sufficient, logistics_access_sufficient) VALUES (?,?,?,?,?,?,?)",
      [ulid(), projectId, "clears", 1, 1, 1, 1],
    );
    expect(preview("project", projectId, "fs").snapshot.kill.carried_in.find((c) => c.key === ZERO_SITE)).toMatchObject(
      { outcome: "false", closure: "evaluated" },
    );
  });
  test("#12: a gate-evaluation run carries no assumptions, so the WACC status is read from the project's confirmed rate session (sourced closes, absent stays unassessed)", async () => {
    const { projectId, oppId } = S.seedReadyProject(db, ANALYST);
    carriedAt(oppId, [[WACC_GF, "S4"]]);
    expect(preview("project", projectId, "fs").snapshot.kill.carried_in.find((c) => c.key === WACC_GF)).toMatchObject({
      outcome: "unassessed",
      closure: "open",
    });
    const { setProjectWaccSubject, recordWaccSession } = await import("../../db/lib/wacc.ts");
    setProjectWaccSubject(db, projectId, "project_newco", "test: subject confirmed by a person", ANALYST, S.NOW);
    recordWaccSession(db, {
      projectId,
      wacc: 0.09,
      hurdleIrr: 0.12,
      mode: "direct",
      rationale: "test: person-confirmed rates",
      anchorRef: "test:wacc",
      subjectCompanyId: null,
      actor: ANALYST,
      now: S.NOW,
    });
    clearSnapshotCache();
    expect(preview("project", projectId, "fs").snapshot.kill.carried_in.find((c) => c.key === WACC_GF)).toMatchObject({
      outcome: "false",
      closure: "evaluated",
    });
  });
});

describe("O-2 deal-shape-chain is evaluated at pre_fs, where its registry reevaluate_at and flow.spec 2.19.0 own it", () => {
  test("opportunity pre_fs includes deal-shape-chain; Screening does not", () => {
    const o = S.insertOpportunity(db, "greenfield", ANALYST);
    expect(preview("opportunity", o, "pre_fs").snapshot.kill.procedures).toEqual([
      "deal-shape-chain",
      "greenfield-pre-fs",
    ]);
    expect(preview("opportunity", o, "screening").snapshot.kill.procedures).toEqual(["greenfield-screening"]);
  });
});

// ── helpers that record through the real contract ───────────────────────────
function recordProjectDecision(
  projectId: string,
  decision: "go" | "hold" | "kill",
  _built: unknown,
  acks: Array<{ key: string; kind?: string; reason: string }> = [],
) {
  const fresh = preview("project", projectId, "fs");
  return recordGateDecisionRow(db, {
    entityType: "project",
    entityId: projectId,
    gate: "fs",
    decision,
    storedRationale: S.GENUINE,
    missingArtifactsJson: decision === "hold" ? '["x"]' : null,
    actor: ANALYST,
    gateEvaluationId: null,
    learningCapture: decision === "kill" ? "lesson" : null,
    judgementConfirmationsJson: null,
    extras: {
      snapshotHash: fresh.hash,
      acknowledgements: acks,
      briefId: null,
      divergenceReason: null,
      killOverrideId: null,
    },
    now: new Date().toISOString(),
  });
}
function recordProjectGo(
  projectId: string,
  built: unknown,
  acks: Array<{ key: string; kind?: string; reason: string }> = [],
) {
  return recordProjectDecision(projectId, "go", built, acks);
}

describe("deal-shape-to-S7 (risk-officer R-1..R-3, 2026-11-08): #9 is brownfield-only and evaluated at target_screening", () => {
  const rows = (oppId: string, viable: number[]) => {
    const shapes = ["full_acquisition", "majority_stake", "spv", "holdco_route"];
    for (const [i, v] of viable.entries()) {
      db.run(
        "INSERT INTO opportunity_deal_shape_evaluation (id, opportunity_id, shape, intent, viable, rationale, evidence_ref, evaluated_by, evaluated_at, superseded_by) VALUES (?,?,?,?,?,?,?,?,?,NULL)",
        [ulid(), oppId, shapes[i], "integration", v, "r", null, ANALYST, S.NOW],
      );
    }
  };
  const atPreFs = (oppId: string) => preview("opportunity", oppId, "pre_fs").snapshot;
  const carryFromPreFs = (oppId: string) => {
    const snap = atPreFs(oppId);
    addDecision("opportunity", oppId, "pre_fs", "go", {
      not_reached: snap.kill.not_reached,
      carried_in: snap.kill.carried_in,
      unassessed: snap.kill.unassessed,
    });
  };

  test("criterionTrack: the registry `track` wins, else the procedure prefix, else track-neutral; classifyKill uses it per criterion", () => {
    expect(criterionTrack("deal-shape-chain", { track: "brownfield" })).toBe("brownfield");
    expect(criterionTrack("deal-shape-chain", {})).toBeNull(); // #10/#11: track-neutral, never dropped by procedure scoping
    expect(criterionTrack("deal-shape-chain", null)).toBeNull();
    expect(criterionTrack("greenfield-fs", {})).toBe("greenfield");
    const base = {
      procedure: "deal-shape-chain",
      evaluable_from: "S7",
      current_stage: "S5",
      reevaluate_at: "target_screening",
      gate: "pre_fs",
    };
    // greenfield: the brownfield-only criterion closes out_of_track; the track-neutral siblings are untouched
    expect(classifyKill({ ...base, outcome: "unassessed", track: "greenfield", entry_track: "brownfield" }).cls).toBe(
      "out_of_track",
    );
    expect(classifyKill({ ...base, outcome: "unassessed", track: "greenfield" }).cls).toBe("not_reached");
    // brownfield: deferred; undecided track: deferred (never silently scoped away)
    expect(classifyKill({ ...base, outcome: "unassessed", track: "brownfield", entry_track: "brownfield" }).cls).toBe(
      "not_reached",
    );
    expect(classifyKill({ ...base, outcome: "unassessed", track: null, entry_track: "brownfield" }).cls).toBe(
      "not_reached",
    );
    // triggered always wins, even off-track and early (a recorded zero-viable set stays visible)
    expect(classifyKill({ ...base, outcome: "triggered", track: "greenfield", entry_track: "brownfield" })).toEqual({
      cls: "triggered",
      partial_input: true,
    });
  });

  test("the real registry: #9 carries track brownfield; #10/#11 carry none (R-1)", () => {
    const { loadKillCriteriaRegistry } = require("../../app/web-next/lib/ic-review-steps.ts") as {
      loadKillCriteriaRegistry: (p: string) => Array<{ criterion_id: string; track?: string }>;
    };
    const by = new Map(loadKillCriteriaRegistry("deal-shape-chain").map((e) => [e.criterion_id, e.track]));
    expect(by.get("no_viable_deal_shape")).toBe("brownfield");
    expect(by.get("partner_dd_red_financial_distress")).toBeUndefined();
    expect(by.get("partner_dd_red_ip_chain")).toBeUndefined();
  });

  test("brownfield: pre_fs carries #9 to target_screening, where it is evaluated natively - unassessed without rows, false with a viable shape, triggered (RECYCLE, never halt) with zero viable", () => {
    const o = S.insertOpportunity(db, "brownfield", ANALYST);
    carryFromPreFs(o);
    // no live rows: honestly unassessed at its own gate, an acknowledgement is asked (mark_conditional is not a halt)
    const none = preview("opportunity", o, "target_screening").snapshot;
    expect(none.kill.procedures).toContain("deal-shape-chain");
    expect(none.kill.carried_in.find((c) => c.key === NO_SHAPE)).toMatchObject({
      outcome: "unassessed",
      closure: "open",
      reevaluate_at: "target_screening",
    });
    expect(keysOf(none.kill.unassessed)).toContain(NO_SHAPE);
    expect(none.hard_blocks.map((h) => h.code)).not.toContain("kill_carry_unassessed"); // not a halt
    expect(none.hard_blocks.map((h) => h.code)).not.toContain("kill_carry_overdue");
    // the partner criteria #10/#11 are NOT this gate's (flow.spec 2.20.0: target_screening lists #9 only)
    for (const k of [PARTNER_FIN, PARTNER_IP]) {
      expect(keysOf(none.kill.not_reached)).not.toContain(k);
      expect(keysOf(none.kill.unassessed)).not.toContain(k);
    }
    rows(o, [1, 0]);
    const clean = preview("opportunity", o, "target_screening").snapshot;
    expect(clean.kill.carried_in.find((c) => c.key === NO_SHAPE)).toMatchObject({
      outcome: "false",
      closure: "evaluated",
    });
    expect(keysOf(clean.kill.unassessed)).not.toContain(NO_SHAPE);
    const z = S.insertOpportunity(db, "brownfield", ANALYST);
    carryFromPreFs(z);
    rows(z, [0, 0]);
    const zero = preview("opportunity", z, "target_screening").snapshot;
    expect(zero.kill.triggered.find((t) => t.key === NO_SHAPE)).toMatchObject({
      action: "mark_conditional",
      binding: false,
    });
    expect(zero.kill.carried_in.find((c) => c.key === NO_SHAPE)).toMatchObject({
      outcome: "triggered",
      closure: "evaluated",
    });
  });

  test("greenfield: out_of_track wins over kill_carry_overdue - a #9 carry opened before the track was decided closes at the first later gate (fs), never overdue", () => {
    setFlags("enforce", ...SNAP);
    const { projectId, oppId } = S.seedReadyProject(db, ANALYST); // greenfield; never records target_screening
    const from = addDecision("opportunity", oppId, "pre_fs", "go", {
      not_reached: [nr(NO_SHAPE, "S7", "target_screening")],
      carried_in: [],
    });
    const { snapshot } = preview("project", projectId, "fs");
    expect(snapshot.track).toBe("greenfield");
    const ci = snapshot.kill.carried_in.find((c) => c.key === NO_SHAPE);
    if (!ci) throw new Error("expected the out_of_track carry for the no-shape criterion");
    expect(ci).toMatchObject({ from_decision_id: from, outcome: "out_of_track", closure: "out_of_track" });
    expect(ci.route_decision_id).not.toBeNull();
    expect(snapshot.hard_blocks.map((h) => h.code)).not.toContain("kill_carry_overdue");
    expect(keysOf(snapshot.kill.unassessed)).not.toContain(NO_SHAPE);
    expect(keysOf(snapshot.kill.triggered)).not.toContain(NO_SHAPE);
    // a recorded zero-viable set on a greenfield opportunity still reads as a trigger at its own pre_fs gate (triggered wins before out_of_track)
    const g = S.insertOpportunity(db, "greenfield", ANALYST);
    rows(g, [0]);
    expect(keysOf(atPreFs(g).kill.triggered)).toContain(NO_SHAPE);
  });

  test("enforce guard (R-3): the real registry stays enforce-safe - #9's only variable is an opportunity-scope variable at pre_fs (carried) and target_screening (own gate)", () => {
    expect(carriedWithoutDataSource()).toEqual([]);
    expect(OPPORTUNITY_SCOPE_VARS).toContain("dealshape.viable_shapes");
  });
});
