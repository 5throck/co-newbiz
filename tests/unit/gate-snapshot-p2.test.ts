// @version 1.0.0
/**
 * ADR-0186 P2 - the acknowledged-GO snapshot, gate-time kill evaluation and the decision write contract, on the
 * real Route Handlers against a scratch SQLite.
 *   migrations : 0173 / 0174 apply late on a DB that already ran 0176 / 0177
 *   hash       : canonical JSON determinism, volatile fields excluded
 *   GET        : project + opportunity snapshot, read-only (no residue), cached, visibility, role
 *   brief      : one `gate_integrity_eval` run + kill_criteria_evaluation rows + a gate_brief_record per project brief
 *   decision   : 409 snapshot_stale / 422 ack_required (exact keys) / HOLD+KILL need no acks and store a snapshot
 *   binding    : triggered halt without an override is 409; with a Group IC override it needs an acknowledgement
 *   atomicity  : a fault anywhere unwinds the run, ledger, decision and snapshot
 *   opportunity: outcomes live only in snapshot_json (no ledger rows)
 */
import { test, expect, beforeAll, afterAll, afterEach, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-gate-snapshot-p2.sqlite");
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
const { GATE_INTEGRITY_FAMILIES, gateIntegrityEnvName } = await import(
  "../../app/web-next/lib/gate-integrity-flags.ts"
);
const { canonicalJson, canonicalNumber, snapshotHash, VOLATILE_KEYS } = await import(
  "../../app/web-next/lib/gate-canonical.ts"
);
const { clearSnapshotCache } = await import("../../app/web-next/lib/gate-snapshot.ts");
const { processAcknowledgements } = await import("../../app/web-next/lib/gate-decision-contract.ts");
const S = await import("./_gate-integrity-support.ts");

const ANALYST = "p2-analyst";
const OTHER = "p2-other";
const VIEWER = "p2-viewer";
let cookie = "";
let otherCookie = "";
let viewerCookie = "";

const flagNames = GATE_INTEGRITY_FAMILIES.map(gateIntegrityEnvName);
function setFlags(mode: "off" | "shadow" | "enforce", ...families: Array<(typeof GATE_INTEGRITY_FAMILIES)[number]>) {
  for (const f of families) process.env[gateIntegrityEnvName(f)] = mode;
}
const SNAP = ["snapshot_ack", "kill_binding", "divergence"] as const;
afterEach(() => {
  for (const n of flagNames) delete process.env[n];
  clearSnapshotCache();
});

async function login(userId: string, role: "analyst" | "viewer"): Promise<string> {
  await createUser(db, { userId, role, password: `pw-${userId}-123456`, createdBy: "test", now: S.NOW });
  approveUser(db, { userId, approvedBy: "test", now: S.NOW });
  db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = ?", [userId]);
  const res = await nextRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ userId, password: `pw-${userId}-123456` }),
  });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  cookie = await login(ANALYST, "analyst");
  otherCookie = await login(OTHER, "analyst");
  viewerCookie = await login(VIEWER, "viewer");
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

const postProject = (pid: string, body: Record<string, unknown>, c = cookie) =>
  nextRequest(`/api/projects/${pid}/gate-decisions`, {
    method: "POST",
    headers: { cookie: c },
    body: JSON.stringify(body),
  });
const _postOpp = (oid: string, body: Record<string, unknown>, c = cookie) =>
  nextRequest(`/api/opportunities/${oid}/gate-decisions`, {
    method: "POST",
    headers: { cookie: c },
    body: JSON.stringify(body),
  });
const getSnap = (pid: string, gate: string, c = cookie, extra = "") =>
  nextRequest(`/api/projects/${pid}/gate-snapshot?gate=${gate}${extra}`, { headers: { cookie: c } });
const getOppSnap = (oid: string, gate: string, c = cookie, extra = "") =>
  nextRequest(`/api/opportunities/${oid}/gate-snapshot?gate=${gate}${extra}`, { headers: { cookie: c } });
type SnapshotAck = { key: string; kind: string; reason?: string; procedure?: string; covers?: string[] };
interface GateSnapshot {
  required_acks: SnapshotAck[];
  hard_blocks: Array<{ code: string; keys: string[] }>;
  waivers: { active: unknown[] };
  ladder?: unknown;
  validators?: unknown;
  wacc?: unknown;
  conditions_open?: unknown;
  kill: {
    procedures: string[];
    evaluated: number;
    eval_run_id: string | null;
    triggered: Array<{ key: string }>;
    unassessed: Array<{ key: string }>;
    not_reached: Array<{ key: string; reevaluate_at: string }>;
  };
}
interface ErrorDetails {
  snapshot?: GateSnapshot;
  missing?: string[];
  keys?: string[];
  self_issued?: string[];
  reason?: string;
  snapshot_hash?: string;
  field?: string;
  [key: string]: unknown;
}
const errOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; details?: ErrorDetails } }).error;
const dataOf = async <T = unknown>(res: Response) => ((await res.json()) as { data: T }).data;

interface SnapData {
  snapshot_hash: string;
  snapshot: GateSnapshot;
  cached: boolean;
}
const count = (sql: string, ...args: unknown[]) => (db.query(sql).get(...(args as never[])) as { c: number }).c;
const evalRuns = (pid: string, event?: string) =>
  db
    .query("SELECT id, label FROM run WHERE project_id = ? AND label LIKE ? ORDER BY created_at, id")
    .all(pid, `gate_integrity_eval:${event ?? "%"}:%`) as Array<{ id: string; label: string }>;
const REASON = "이 항목은 위험을 인지했으며 후속 조치 일정을 확인한 뒤 진행함";

/** Ack payload for every required key of a snapshot, one reason each (the happy path of the recorder). */
function ackAll(snapshot: GateSnapshot): SnapshotAck[] {
  return (snapshot.required_acks as Array<{ key: string; kind: string }>).map((a) => ({
    key: a.key,
    kind: a.kind,
    reason: REASON,
  }));
}

// A project that has fs GO recorded so entity-level gates are reachable, plus one unreviewed deliverable
// (deliverables.required_unreviewed >= 1 -> entity-ic-review halt criterion triggers).
function readyAtDd(): { projectId: string; oppId: string } {
  const r = S.seedReadyProject(db, ANALYST);
  S.insertGate(db, "project", r.projectId, "fs", "go");
  return r;
}

describe("migrations 0173 / 0174", () => {
  test("a late-arriving 0173/0174 applies on a DB that already ran 0176/0177 and leaves earlier rows alone", () => {
    const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
    const { readdirSync, readFileSync } = require("node:fs") as typeof import("node:fs");
    const { splitSqlStatements } = require("../../db/migrate.ts") as typeof import("../../db/migrate.ts");
    const dir = join(PROJECT_ROOT, "db/migrations");
    const files = readdirSync(dir)
      .filter((f: string) => f.endsWith(".sql"))
      .sort();
    const names = ["0173_gate_decision_snapshot.sql", "0174_kill_criteria_override.sql"];
    const mem = new Database(":memory:");
    mem.run("PRAGMA foreign_keys = ON");
    mem.run(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)",
    );
    const apply = (f: string) => {
      for (const st of splitSqlStatements(readFileSync(join(dir, f), "utf-8"))) mem.run(st);
    };
    for (const f of files) if (!names.includes(f)) apply(f); // includes 0176 and 0177
    expect(files.indexOf("0176_human_role_grant.sql")).toBeGreaterThan(-1);
    mem.run(
      "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES ('g1','opportunity','o1','screening','go','r','u',?)",
      [S.NOW],
    );
    for (const n of names) apply(n);
    expect(
      mem
        .query("SELECT ai_recommended_decision, ai_brief_id, divergence_reason FROM gate_decision WHERE id='g1'")
        .get(),
    ).toEqual({ ai_recommended_decision: null, ai_brief_id: null, divergence_reason: null });
    // the brief_id columns are real foreign keys
    expect(() => mem.run("UPDATE gate_decision SET ai_brief_id = 'nope' WHERE id = 'g1'")).toThrow(/FOREIGN KEY/);
    expect(() =>
      mem.run(
        "INSERT INTO gate_decision_snapshot (decision_id, schema_version, snapshot_json, snapshot_hash, computed_at, engine_versions_json, brief_id) VALUES ('g1',1,'{}','h','t','{}','nope')",
      ),
    ).toThrow(/FOREIGN KEY/);
    // the runner itself finds nothing pending on the scratch DB
    expect(runMigrations(TEST_DB_PATH).applied).toEqual([]);
  });

  test("gate_decision_snapshot and gate_brief_record are append-only (UPDATE and DELETE are rejected by trigger)", () => {
    const { insertGateSnapshot, insertBriefRecord } =
      require("../../db/repositories/gate-snapshot.repository.ts") as typeof import("../../db/repositories/gate-snapshot.repository.ts");
    const o = S.insertOpportunity(db, "greenfield");
    const gid = S.insertGate(db, "opportunity", o, "screening", "go");
    insertGateSnapshot(db, {
      decisionId: gid,
      schemaVersion: 1,
      snapshotJson: "{}",
      snapshotHash: "h",
      submittedHash: null,
      acknowledgements: [],
      computedAt: S.NOW,
      engineVersionsJson: "{}",
      evalRunId: null,
      briefId: null,
    });
    expect(() => db.run("UPDATE gate_decision_snapshot SET snapshot_hash = 'x' WHERE decision_id = ?", [gid])).toThrow(
      /append-only/,
    );
    expect(() => db.run("DELETE FROM gate_decision_snapshot WHERE decision_id = ?", [gid])).toThrow(/append-only/);
    const bid = insertBriefRecord(db, {
      entity_type: "opportunity",
      entity_id: o,
      gate: "screening",
      recommended: "go",
      confidence: "high",
      source: "synthesis",
      rationale_draft_hash: null,
      llm_call_ref: null,
      eval_run_id: null,
      generated_by: ANALYST,
      generated_at: S.NOW,
    });
    expect(() => db.run("UPDATE gate_brief_record SET recommended = 'kill' WHERE id = ?", [bid])).toThrow(
      /append-only/,
    );
    expect(() => db.run("DELETE FROM gate_brief_record WHERE id = ?", [bid])).toThrow(/append-only/);
  });

  test("a snapshot needs an existing decision (foreign key and repository guard)", () => {
    const { insertGateSnapshot } =
      require("../../db/repositories/gate-snapshot.repository.ts") as typeof import("../../db/repositories/gate-snapshot.repository.ts");
    expect(() =>
      insertGateSnapshot(db, {
        decisionId: "nope",
        schemaVersion: 1,
        snapshotJson: "{}",
        snapshotHash: "h",
        submittedHash: null,
        acknowledgements: [],
        computedAt: S.NOW,
        engineVersionsJson: "{}",
        evalRunId: null,
        briefId: null,
      }),
    ).toThrow(/does not exist/);
  });

  test("kill_criteria_override: one active override per (entity, procedure, criterion); never deleted", () => {
    const o = S.insertOpportunity(db, "greenfield");
    const ins = () =>
      db.run(
        "INSERT INTO kill_criteria_override (id, entity_type, entity_id, procedure_key, criterion_id, reason, issued_by, issued_at) VALUES (?,?,?,?,?,?,?,?)",
        [ulid(), "opportunity", o, "p", "c", "r", "u", S.NOW],
      );
    ins();
    expect(ins).toThrow(/UNIQUE/);
    expect(() => db.run("DELETE FROM kill_criteria_override WHERE entity_id = ?", [o])).toThrow(/never deleted/);
    db.run("UPDATE kill_criteria_override SET revoked_at = ?, revoked_by = ? WHERE entity_id = ?", [S.NOW, "u", o]);
    ins(); // a revoked override frees the slot
  });
});

describe("canonical hash", () => {
  test("keys are sorted, numbers have a fixed format, undefined is dropped, null is kept", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }], z: undefined, n: null })).toBe(
      '{"a":[2,{"c":2,"d":1}],"b":1,"n":null}',
    );
    expect(canonicalNumber(1e21)).toBe("1000000000000000000000");
    expect(canonicalNumber(1e-7)).toBe("0.0000001");
    expect(canonicalNumber(-0)).toBe("0");
    expect(canonicalNumber(0.1 + 0.2)).toBe("0.30000000000000004");
    expect(canonicalNumber(12)).toBe("12");
    expect(() => canonicalNumber(Infinity)).toThrow();
  });

  test("the hash ignores key order and volatile ids/timestamps, and changes with any decision-relevant value", () => {
    const a = {
      gate: "dd",
      kill: { eval_run_id: "r1", n: 1 },
      computed_at: "t1",
      ai: { brief_id: "b1", recommended: "go" },
      rag: { assessment_id: "x", overall: "green" },
    };
    const b = {
      rag: { overall: "green", assessment_id: "y" },
      ai: { recommended: "go", brief_id: "b2" },
      computed_at: "t2",
      kill: { n: 1, eval_run_id: "r2" },
      gate: "dd",
    };
    expect(snapshotHash(a)).toBe(snapshotHash(b));
    expect(snapshotHash({ ...a, ai: { brief_id: "b1", recommended: "hold" } })).not.toBe(snapshotHash(a));
    expect([...VOLATILE_KEYS].sort()).toEqual([
      "assessment_id",
      "brief_id",
      "computed_at",
      "eval_run_id",
      "generated_at",
    ]);
  });
});

describe("acknowledgement matching (pure)", () => {
  const required = [
    { key: "a:1", kind: "kill_unassessed", procedure: "pa" },
    { key: "a:2", kind: "kill_unassessed", procedure: "pa" },
    { key: "b:1", kind: "kill_unassessed", procedure: "pb" },
    { key: "rag:overall", kind: "rag_red" },
  ];
  test("one reason may cover several unassessed items of the SAME procedure; one stored entry per item", () => {
    const r = processAcknowledgements(required, [
      { key: "a:1", reason: REASON, covers: ["a:2"] },
      { key: "b:1", reason: REASON },
      { key: "rag:overall", reason: REASON },
    ]);
    expect(r.missing).toEqual([]);
    expect(r.covered.map((c) => c.key)).toEqual(["a:1", "a:2", "b:1", "rag:overall"]);
  });
  test("covering across procedures, or covering a non-unassessed key, is invalid; unknown keys are reported", () => {
    const r = processAcknowledgements(required, [
      { key: "a:1", reason: REASON, covers: ["b:1", "rag:overall", "zzz"] },
    ]);
    expect(r.invalid.map((i) => i.key).sort()).toEqual(["b:1", "rag:overall"]);
    expect(r.unknown).toEqual(["zzz"]);
    expect(r.missing).toEqual(["a:2", "b:1", "rag:overall"]);
  });
  test("a weak reason is reported as weak (not missing); a kind mismatch is invalid", () => {
    const r = processAcknowledgements(required, [
      { key: "rag:overall", reason: "ok" },
      { key: "a:1", kind: "rag_red", reason: REASON },
    ]);
    expect(r.weak.map((w) => w.key)).toEqual(["rag:overall"]);
    expect(r.invalid).toEqual([{ key: "a:1", problem: "kind_mismatch" }]);
    expect(r.missing).toEqual(["a:1", "a:2", "b:1"]);
  });
});

describe("GET gate-snapshot", () => {
  test("project: shape, deterministic hash, required acks, ladder, no residue, then cached", async () => {
    const { projectId } = readyAtDd();
    const runsBefore = count("SELECT COUNT(*) c FROM run WHERE project_id = ?", projectId);
    const res = await getSnap(projectId, "dd");
    expect(res.status).toBe(200);
    const d = await dataOf<SnapData>(res);
    expect(d.snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(d.cached).toBe(false);
    const s = d.snapshot;
    expect(s).toMatchObject({
      schema_version: 3,
      gate: "dd",
      entity: { type: "project", id: projectId },
      track: "greenfield",
    });
    expect(s.kill.procedures).toEqual(["greenfield-dd"]);
    expect(s.kill.evaluated).toBeGreaterThan(0);
    expect(s.kill.eval_run_id).toBeNull();
    expect(s.ladder).toMatchObject({ prior_gate: "fs", effective: true });
    expect(s.validators).toBeNull();
    expect(s.wacc).toMatchObject({ status: "absent", bf13: "n/a" });
    expect(s.required_acks.find((a) => a.key === "rag:absent")).toBeTruthy();
    expect(s.conditions_open).toEqual([]);
    // read-only: the rolled-back transaction left no run, no ledger, no audit row of the evaluation
    expect(count("SELECT COUNT(*) c FROM run WHERE project_id = ?", projectId)).toBe(runsBefore);
    expect(count("SELECT COUNT(*) c FROM kill_criteria_evaluation WHERE project_id = ?", projectId)).toBe(0);
    // a second GET is served from the cache with the same hash
    const again = await dataOf<SnapData>(await getSnap(projectId, "dd"));
    expect(again.cached).toBe(true);
    expect(again.snapshot_hash).toBe(d.snapshot_hash);
  });

  test("hash determinism: a cache-bypassed recomputation of unchanged state yields the same hash", async () => {
    const { projectId } = readyAtDd();
    const first = await dataOf<SnapData>(await getSnap(projectId, "dd"));
    clearSnapshotCache();
    const second = await dataOf<SnapData>(await getSnap(projectId, "dd"));
    expect(second.cached).toBe(false);
    expect(second.snapshot_hash).toBe(first.snapshot_hash);
  });

  test("the hash moves when decision-relevant state moves (a new waiver-free input: an RAG-visible change)", async () => {
    const { projectId } = readyAtDd();
    const before = await dataOf<SnapData>(await getSnap(projectId, "dd"));
    db.run("INSERT INTO analysis_task (id, project_id, deliverable_type, reviewed_by) VALUES (?,?,?,NULL)", [
      ulid(),
      projectId,
      "dd_report",
    ]);
    clearSnapshotCache();
    const after = await dataOf<SnapData>(await getSnap(projectId, "entity_ic"));
    expect(after.snapshot_hash).not.toBe(before.snapshot_hash);
    // the unreviewed deliverable triggers the entity-ic-review halt criterion
    expect(after.snapshot.kill.triggered.map((t) => t.key)).toContain(
      "entity-ic-review:analysis_task_reviewed_by_null_on_required_deliverable",
    );
    expect(after.snapshot.hard_blocks[0].code).toBe("kill_binding_unoverridden");
    expect(after.snapshot.hard_blocks[0].keys).toContain(
      "entity-ic-review:analysis_task_reviewed_by_null_on_required_deliverable",
    );
  });

  test("ADR-0196: GO at entity_ic with no committee session convened is a HARD BLOCK, not an ack (2026-11-09 owner decision)", async () => {
    setFlags("enforce", ...SNAP);
    const { projectId } = S.seedIcReadyProject(db, ANALYST);
    // Strip the seeded committee session: this test exercises the missing-session hard block itself.
    db.run("DELETE FROM process_run WHERE entity_type = 'project' AND entity_id = ?", [projectId]);
    // Neutralise unrelated kill bindings (Group IC overrides issued by someone else) so the
    // committee session rule is the only reason the GO is refused.
    clearSnapshotCache();
    const pre = await dataOf<SnapData>(await getSnap(projectId, "entity_ic"));
    for (const t of pre.snapshot.kill.triggered.filter((x) => x.binding)) {
      const [procedure, criterion] = [t.key.slice(0, t.key.indexOf(":")), t.key.slice(t.key.indexOf(":") + 1)];
      db.run(
        "INSERT INTO kill_criteria_override (id, entity_type, entity_id, procedure_key, criterion_id, reason, issued_by, issued_at) VALUES (?,?,?,?,?,?,?,?)",
        [ulid(), "project", projectId, procedure, criterion, "test exception", OTHER, S.NOW],
      );
    }
    clearSnapshotCache();
    const view = await dataOf<SnapData>(await getSnap(projectId, "entity_ic"));
    // the hard block names the project and is enforced; the old ACK is gone
    expect(view.snapshot.hard_blocks.find((h) => h.code === "committee_session_missing")).toMatchObject({
      keys: [projectId],
      enforced: true,
    });
    expect(view.snapshot.required_acks.find((a) => a.key === "committee:session_missing")).toBeUndefined();
    // a GO with every remaining ack satisfied is still refused by the hard block
    const res = await postProject(projectId, {
      gate: "entity_ic",
      decision: "go",
      rationale: S.IC_RATIONALE,
      gap_rationale: S.IC_GAP,
      snapshot_hash: view.snapshot_hash,
      acknowledgements: ackAll(view.snapshot),
    });
    const err = await errOf(res);
    expect(res.status).toBe(409);
    expect(err.code).toBe("committee_session_missing");
    expect(count("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ?", projectId)).toBe(2); // seeded fs + dd only
  });

  test("visibility: a non-member gets 404, a viewer 403, no gate param 400; an unknown gate 400", async () => {
    const { projectId } = readyAtDd();
    expect((await getSnap(projectId, "dd", otherCookie)).status).toBe(404);
    expect((await getSnap(projectId, "dd", viewerCookie)).status).toBe(403);
    expect((await nextRequest(`/api/projects/${projectId}/gate-snapshot`, { headers: { cookie } })).status).toBe(400);
    expect((await getSnap(projectId, "screening")).status).toBe(400);
    expect((await nextRequest(`/api/projects/${projectId}/gate-snapshot?gate=dd`)).status).toBe(401);
  });

  test("opportunity: outcomes live only in the snapshot (no ledger rows), project-only variables are not_reached at S3 (ADR-0193), no RAG/validators", async () => {
    const o = S.insertOpportunity(db, "greenfield", ANALYST);
    const before = count("SELECT COUNT(*) c FROM kill_criteria_evaluation");
    const res = await getOppSnap(o, "screening");
    expect(res.status).toBe(200);
    const d = await dataOf<SnapData>(res);
    expect(d.snapshot).toMatchObject({
      gate: "screening",
      entity: { type: "opportunity", id: o },
      track: "greenfield",
      rag: null,
      validators: null,
      wacc: null,
    });
    expect(d.snapshot.kill.procedures).toEqual(["greenfield-screening"]);
    expect(d.snapshot.kill.triggered).toEqual([]);
    // ADR-0193: the project-scoped criteria cannot be assessed at S3; they are information only, each with its re-evaluation gate - never a silent pass, never a meaningless acknowledgement
    expect(d.snapshot.kill.unassessed).toEqual([]);
    expect(d.snapshot.kill.not_reached.length).toBeGreaterThan(0);
    // ADR-0193 section 14.1: #4/#5/#6 read project-scoped sources, so they are re-evaluated at fs (the first project gate)
    expect(d.snapshot.kill.not_reached.every((n) => n.reevaluate_at === "fs")).toBe(true);
    expect(d.snapshot.required_acks).toEqual([]);
    expect(d.snapshot.kill.eval_run_id).toBeNull();
    expect(count("SELECT COUNT(*) c FROM kill_criteria_evaluation")).toBe(before);
    expect((await getOppSnap(o, "fs")).status).toBe(400);
    expect((await getOppSnap(o, "screening", viewerCookie)).status).toBe(403);
    expect((await getOppSnap("missing", "screening")).status).toBe(404);
  });

  test("opportunity with an unknown track evaluates both screening procedures; brownfield viable-targets is opportunity-scoped", async () => {
    const o = S.insertOpportunity(db, null, ANALYST);
    const d = await dataOf<SnapData>(await getOppSnap(o, "screening"));
    expect(d.snapshot.kill.procedures).toEqual(["brownfield-screening", "greenfield-screening"]);
    const b = S.insertOpportunity(db, "brownfield", ANALYST);
    const zero = await dataOf<SnapData>(await getOppSnap(b, "screening"));
    expect(zero.snapshot.kill.not_reached.map((u) => u.key)).toContain(
      "brownfield-screening:no_viable_target_in_longlist",
    );
    db.run(
      "INSERT INTO brownfield_target (id, opportunity_id, company_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      [ulid(), b, "T1", "excluded", S.NOW, S.NOW],
    );
    clearSnapshotCache();
    const none = await dataOf<SnapData>(await getOppSnap(b, "screening"));
    expect(none.snapshot.kill.triggered.map((t) => t.key)).toContain(
      "brownfield-screening:no_viable_target_in_longlist",
    );
    expect(none.snapshot.hard_blocks[0]).toMatchObject({ code: "kill_binding_unoverridden" });
  });
});

describe("POST gate-decisions - snapshot contract (project, enforce)", () => {
  test("GO: 409 snapshot_stale without a hash, 422 ack_required with the EXACT keys, then 201 with a stored snapshot and a linked ledger", async () => {
    setFlags("enforce", ...SNAP);
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const view = await dataOf<SnapData>(await getSnap(projectId, "fs"));
    const keys = (view.snapshot.required_acks as Array<{ key: string }>).map((a) => a.key);
    expect(keys.length).toBeGreaterThan(0);
    const runsBefore = count("SELECT COUNT(*) c FROM run WHERE project_id = ?", projectId);

    const noHash = await postProject(projectId, { gate: "fs", decision: "go", rationale: S.GENUINE });
    expect(noHash.status).toBe(409);
    const stale = await errOf(noHash);
    expect(stale.code).toBe("snapshot_stale");
    expect(stale.details).toMatchObject({ reason: "missing", snapshot_hash: view.snapshot_hash });
    expect(stale.details?.snapshot?.required_acks.map((a) => a.key)).toEqual(keys);

    const noAcks = await postProject(projectId, {
      gate: "fs",
      decision: "go",
      rationale: S.GENUINE,
      snapshot_hash: view.snapshot_hash,
    });
    expect(noAcks.status).toBe(422);
    const need = await errOf(noAcks);
    expect(need.code).toBe("ack_required");
    expect(need.details?.missing).toEqual(keys);
    // nothing of the refused attempts survives: no decision, no run, no ledger
    expect(count("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ?", projectId)).toBe(0);
    expect(count("SELECT COUNT(*) c FROM run WHERE project_id = ?", projectId)).toBe(runsBefore);
    expect(count("SELECT COUNT(*) c FROM kill_criteria_evaluation WHERE project_id = ?", projectId)).toBe(0);

    const ok = await postProject(projectId, {
      gate: "fs",
      decision: "go",
      rationale: S.GENUINE,
      snapshot_hash: view.snapshot_hash,
      acknowledgements: ackAll(view.snapshot),
    });
    expect(ok.status).toBe(201);
    const rec = await dataOf<{ id: string; snapshot_hash: string; acknowledgements: number }>(ok);
    expect(rec.snapshot_hash).toBe(view.snapshot_hash);
    expect(rec.acknowledgements).toBe(keys.length);

    const snap = db.query("SELECT * FROM gate_decision_snapshot WHERE decision_id = ?").get(rec.id) as {
      snapshot_hash: string;
      submitted_hash: string;
      schema_version: number;
      acknowledgements_json: string;
      snapshot_json: string;
      eval_run_id: string;
    } | null;
    if (!snap) throw new Error("snapshot row missing");
    expect(snap).toMatchObject({
      snapshot_hash: view.snapshot_hash,
      submitted_hash: view.snapshot_hash,
      schema_version: 3,
    });
    expect(JSON.parse(snap.acknowledgements_json).map((a: { key: string }) => a.key)).toEqual(keys);
    // the decision-to-evaluation link: the snapshot's run is a gate_integrity_eval run holding the project's ledger
    const run = db.query("SELECT id, label, superseded_by FROM run WHERE id = ?").get(snap.eval_run_id) as {
      id: string;
      label: string;
      superseded_by: string;
    } | null;
    if (!run) throw new Error("eval run row missing");
    expect(run.label).toBe("gate_integrity_eval:decision:fs");
    expect(run.superseded_by).toBe(run.id);
    const ledger = db
      .query("SELECT evaluated_by, procedure_key FROM kill_criteria_evaluation WHERE run_id = ?")
      .all(run.id) as Array<{ evaluated_by: string }>;
    expect(ledger.length).toBe(view.snapshot.kill.evaluated);
    expect(ledger.every((r) => r.evaluated_by === `gate-decision:${ANALYST}`)).toBe(true);
    expect(JSON.parse(snap.snapshot_json).kill.eval_run_id).toBe(run.id);
    expect(count("SELECT COUNT(*) c FROM audit_log WHERE action = 'gate_snapshot.record'")).toBeGreaterThan(0);
    // the history marks it as NOT legacy; the stored snapshot is readable through the visible-project check
    const hist = await dataOf<{ history: Array<Record<string, unknown>> }>(
      await nextRequest(`/api/projects/${projectId}/gate-decisions`, { headers: { cookie } }),
    );
    expect(hist.history[0]).toMatchObject({ legacy: false, snapshot_hash: view.snapshot_hash });
    const stored = await dataOf<Record<string, unknown>>(
      await nextRequest(`/api/projects/${projectId}/gate-decisions/${rec.id}/snapshot`, { headers: { cookie } }),
    );
    expect(stored).toMatchObject({ legacy: false, snapshot_hash: view.snapshot_hash });
    expect(
      (
        await nextRequest(`/api/projects/${projectId}/gate-decisions/${rec.id}/snapshot`, {
          headers: { cookie: otherCookie },
        })
      ).status,
    ).toBe(404);
  });

  test("a state change between viewing and recording is 409 snapshot_stale with the FRESH snapshot; the retry succeeds", async () => {
    setFlags("enforce", ...SNAP);
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const seen = await dataOf<SnapData>(await getSnap(projectId, "fs"));
    const gov = S.insertGovernanceDoc(db);
    db.run(
      "INSERT INTO waiver (id, project_id, governance_doc_id, clause_ref, reason, requested_by, approver_role, approved_by, approved_at, expires_at, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'active',?)",
      [
        ulid(),
        projectId,
        gov,
        "chk x-1",
        "test",
        ANALYST,
        "entity-ic-reviewer",
        OTHER,
        S.NOW,
        "2099-01-01T00:00:00Z",
        S.NOW,
      ],
    );
    const res = await postProject(projectId, {
      gate: "fs",
      decision: "go",
      rationale: S.GENUINE,
      snapshot_hash: seen.snapshot_hash,
      acknowledgements: ackAll(seen.snapshot),
    });
    expect(res.status).toBe(409);
    const e = await errOf(res);
    expect(e.code).toBe("snapshot_stale");
    expect(e.details?.reason).toBe("mismatch");
    expect(e.details?.snapshot_hash).not.toBe(seen.snapshot_hash);
    expect(e.details?.snapshot?.waivers.active).toHaveLength(1);
    // the fresh snapshot primed the GET cache: the recorder re-reads the same hash and can retry
    const fresh = await dataOf<SnapData>(await getSnap(projectId, "fs"));
    expect(fresh.snapshot_hash).toBe(e.details?.snapshot_hash ?? "");
    const retry = await postProject(projectId, {
      gate: "fs",
      decision: "go",
      rationale: S.GENUINE,
      snapshot_hash: fresh.snapshot_hash,
      acknowledgements: ackAll(fresh.snapshot),
    });
    expect(retry.status).toBe(201);
  });

  test("acknowledgement reasons use the ack profile (422 rationale_insufficient) and unknown keys are rejected", async () => {
    setFlags("enforce", ...SNAP);
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const view = await dataOf<SnapData>(await getSnap(projectId, "fs"));
    const weak = ackAll(view.snapshot).map((a) => ({ ...a, reason: "ok" }));
    const w = await postProject(projectId, {
      gate: "fs",
      decision: "go",
      rationale: S.GENUINE,
      snapshot_hash: view.snapshot_hash,
      acknowledgements: weak,
    });
    expect(w.status).toBe(422);
    const we = await errOf(w);
    expect(we.code).toBe("rationale_insufficient");
    expect(we.details).toMatchObject({ field: "acknowledgements", profile: "ack" });
    const extra = [...ackAll(view.snapshot), { key: "kill:nope:nothing", kind: "kill_unassessed", reason: REASON }];
    const u = await postProject(projectId, {
      gate: "fs",
      decision: "go",
      rationale: S.GENUINE,
      snapshot_hash: view.snapshot_hash,
      acknowledgements: extra,
    });
    expect(u.status).toBe(422);
    expect((await errOf(u)).details?.unknown).toEqual(["kill:nope:nothing"]);
    const malformed = await postProject(projectId, {
      gate: "fs",
      decision: "go",
      rationale: S.GENUINE,
      snapshot_hash: view.snapshot_hash,
      acknowledgements: [{ key: 1 }],
    });
    expect(malformed.status).toBe(400);
  });

  test("HOLD and KILL need no hash and no acknowledgements and still store a snapshot", async () => {
    setFlags("enforce", ...SNAP);
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const hold = await postProject(projectId, {
      gate: "fs",
      decision: "hold",
      rationale: "x",
      missing_artifacts: ["Business case adoption"],
    });
    expect(hold.status).toBe(201);
    const kill = await postProject(projectId, {
      gate: "fs",
      decision: "kill",
      rationale: "x",
      learning_capture: "lesson",
    });
    expect(kill.status).toBe(201);
    for (const r of [await dataOf<{ id?: string }>(hold), await dataOf<{ id?: string }>(kill)]) void r;
    const rows = db
      .query(
        "SELECT d.decision, s.snapshot_hash, s.acknowledgements_json, s.submitted_hash, s.eval_run_id FROM gate_decision d JOIN gate_decision_snapshot s ON s.decision_id = d.id WHERE d.entity_id = ? ORDER BY d.decided_at, d.id",
      )
      .all(projectId) as Array<{
      decision: string;
      snapshot_hash: string;
      acknowledgements_json: string;
      submitted_hash: string | null;
      eval_run_id: string | null;
    }>;
    expect(rows.map((r) => r.decision)).toEqual(["hold", "kill"]);
    for (const r of rows) {
      expect(r.snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.acknowledgements_json).toBe("[]");
      expect(r.submitted_hash).toBeNull();
      expect(r.eval_run_id).toBeTruthy();
    }
  });

  test("off: the legacy path is untouched - no snapshot, no evaluation run, no ledger", async () => {
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const res = await postProject(projectId, { gate: "fs", decision: "go", rationale: "ok" });
    expect(res.status).toBe(201);
    expect((await dataOf<{ snapshot_hash: string | null }>(res)).snapshot_hash).toBeNull();
    expect(
      count(
        "SELECT COUNT(*) c FROM gate_decision_snapshot s JOIN gate_decision d ON d.id = s.decision_id WHERE d.entity_id = ?",
        projectId,
      ),
    ).toBe(0);
    expect(evalRuns(projectId)).toHaveLength(0);
  });

  test("shadow: recorded and not blocked; the would-blocks are audited (snapshot_stale, ack_required) and the snapshot is stored", async () => {
    setFlags("shadow", ...SNAP);
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const res = await postProject(projectId, { gate: "fs", decision: "go", rationale: S.GENUINE });
    expect(res.status).toBe(201);
    const id = (await dataOf<{ id: string }>(res)).id;
    const target = `project:${projectId}:fs`;
    for (const code of ["snapshot_stale", "ack_required"]) {
      expect(
        db
          .query("SELECT 1 FROM audit_log WHERE action = ? AND target = ?")
          .all(`gate_integrity.would_block:${code}`, target),
      ).toHaveLength(1);
    }
    const snap = db
      .query("SELECT submitted_hash, acknowledgements_json FROM gate_decision_snapshot WHERE decision_id = ?")
      .get(id) as { submitted_hash: string | null; acknowledgements_json: string } | null;
    expect(snap).toEqual({ submitted_hash: null, acknowledgements_json: "[]" });
  });
});

describe("POST gate-decisions - kill binding (HB) and the Group IC override", () => {
  async function icProject(): Promise<{ projectId: string; keys: string[] }> {
    const { projectId } = S.seedReadyProject(db, ANALYST);
    S.insertGate(db, "project", projectId, "fs", "go");
    S.insertGate(db, "project", projectId, "dd", "go");
    db.run("INSERT INTO analysis_task (id, project_id, deliverable_type, reviewed_by) VALUES (?,?,?,NULL)", [
      ulid(),
      projectId,
      "dd_report",
    ]);
    // ADR-0196: a convened (confirmed-minutes) committee session so the GO is not refused
    // by the unrelated `committee_session_missing` hard block under test here.
    S.seedCommitteeSession(db, projectId, ANALYST);
    const view = await dataOf<SnapData>(await getSnap(projectId, "entity_ic"));
    return { projectId, keys: view.snapshot.hard_blocks[0].keys as string[] };
  }
  const entityIc = (projectId: string, extra: Record<string, unknown> = {}) =>
    postProject(projectId, {
      gate: "entity_ic",
      decision: "go",
      rationale: "Entity IC reviewed the package and agrees to proceed.",
      gap_rationale: "Known gaps are accepted with a follow-up plan.",
      ...extra,
    });
  const override = (projectId: string, key: string, by: string) => {
    const [procedure, criterion] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    const id = ulid();
    db.run(
      "INSERT INTO kill_criteria_override (id, entity_type, entity_id, procedure_key, criterion_id, reason, issued_by, issued_at) VALUES (?,?,?,?,?,?,?,?)",
      [`ov-${id}`, "project", projectId, procedure, criterion, "Group IC accepted this exception", by, S.NOW],
    );
    return `ov-${id}`;
  };

  test("enforce: a triggered halt criterion without an override is 409 kill_binding_unoverridden listing the keys; HOLD and KILL are never blocked", async () => {
    setFlags("enforce", "kill_binding");
    const { projectId, keys } = await icProject();
    expect(keys).toContain("entity-ic-review:analysis_task_reviewed_by_null_on_required_deliverable");
    const res = await entityIc(projectId);
    expect(res.status).toBe(409);
    const e = await errOf(res);
    expect(e.code).toBe("kill_binding_unoverridden");
    expect(e.details?.keys).toEqual(keys);
    expect(count("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ? AND gate = 'entity_ic'", projectId)).toBe(0);
    const hold = await postProject(projectId, {
      gate: "entity_ic",
      decision: "hold",
      rationale: "x",
      missing_artifacts: ["unreviewed deliverable"],
    });
    expect(hold.status).toBe(201);
  });

  test("an active Group IC override lifts the block; the issuer cannot use their own override on their own decision", async () => {
    setFlags("enforce", "kill_binding");
    const { projectId, keys } = await icProject();
    const own = keys.map((k) => override(projectId, k, ANALYST));
    const selfIssued = await entityIc(projectId);
    expect(selfIssued.status).toBe(409);
    expect((await errOf(selfIssued)).details?.self_issued).toEqual(keys);
    for (const id of own)
      db.run("UPDATE kill_criteria_override SET revoked_at = ?, revoked_by = ? WHERE id = ?", [S.NOW, "admin", id]);
    const ids = keys.map((k) => override(projectId, k, OTHER));
    const ok = await entityIc(projectId, { kill_override_id: ids[0] });
    expect(ok.status).toBe(201);
    // a kill_override_id that is not an active override of THIS entity is a 400, whatever the mode
    expect((await entityIc(projectId, { kill_override_id: "nope" })).status).toBe(400);
  });

  test("with snapshot_ack on, an overridden halt becomes an ACK item of kind kill_override", async () => {
    setFlags("enforce", ...SNAP);
    const { projectId, keys } = await icProject();
    keys.forEach((k) => {
      override(projectId, k, OTHER);
    });
    clearSnapshotCache();
    const view = await dataOf<SnapData>(await getSnap(projectId, "entity_ic"));
    expect(view.snapshot.hard_blocks).toEqual([]);
    const overridden = view.snapshot.required_acks.filter((a) => a.kind === "kill_override").map((a) => a.key);
    expect(overridden).toEqual(keys);
    const miss = await entityIc(projectId, { snapshot_hash: view.snapshot_hash });
    expect(miss.status).toBe(422);
    expect((await errOf(miss)).details?.missing).toEqual(view.snapshot.required_acks.map((a) => a.key));
    const ok = await entityIc(projectId, {
      snapshot_hash: view.snapshot_hash,
      acknowledgements: ackAll(view.snapshot),
    });
    expect(ok.status).toBe(201);
  });

  test("one reason may cover several unassessed items of the same procedure; one stored entry per item", async () => {
    setFlags("enforce", ...SNAP);
    const { projectId, keys } = await icProject();
    keys.forEach((k) => {
      override(projectId, k, OTHER);
    });
    clearSnapshotCache();
    const view = await dataOf<SnapData>(await getSnap(projectId, "entity_ic"));
    const byProc = new Map<string, string[]>();
    for (const a of view.snapshot.required_acks) {
      if (a.kind === "kill_unassessed" && a.procedure !== undefined) {
        const existing = byProc.get(a.procedure) ?? [];
        byProc.set(a.procedure, [...existing, a.key]);
      }
    }
    const group = [...byProc.values()].find((ks) => ks.length >= 2);
    expect(group).toBeDefined();
    const acks = ackAll(view.snapshot).filter((a) => !group?.includes(a.key));
    acks.push({ key: group?.[0] ?? "", kind: "kill_unassessed", reason: REASON, covers: group?.slice(1) });
    const res = await entityIc(projectId, { snapshot_hash: view.snapshot_hash, acknowledgements: acks });
    expect(res.status).toBe(201);
    const id = (await dataOf<{ id: string }>(res)).id;
    const row = db.query("SELECT acknowledgements_json FROM gate_decision_snapshot WHERE decision_id = ?").get(id) as {
      acknowledgements_json: string;
    } | null;
    const stored = JSON.parse(row?.acknowledgements_json ?? "[]") as Array<{ key: string; reason: string }>;
    expect(stored.map((a) => a.key).sort()).toEqual(view.snapshot.required_acks.map((a) => a.key).sort());
    expect(group?.every((k) => stored.find((a) => a.key === k)?.reason === REASON)).toBe(true);
  });
});

describe("brief x gate integrity (D3 / D9)", () => {
  const postBrief = (url: string, gate: string, c = cookie) =>
    nextRequest(url, { method: "POST", headers: { cookie: c }, body: JSON.stringify({ gate }) });

  test("project brief: one gate_integrity_eval run with kill_criteria_evaluation rows, a kill block, a brief record and a brief_id", async () => {
    setFlags("shadow", ...SNAP);
    const { projectId } = readyAtDd();
    const res = await postBrief(`/api/projects/${projectId}/gate-brief`, "dd");
    expect(res.status).toBe(200);
    const d = await dataOf<{ brief_id: string; kill: { evaluated: number }; manifest: string }>(res);
    expect(d.brief_id).toBeTruthy();
    expect(d.kill.evaluated).toBeGreaterThan(0);
    expect(d.manifest).toContain("Kill criteria evaluation (deterministic)");
    const runs = evalRuns(projectId, "brief");
    expect(runs).toHaveLength(1);
    expect(runs[0].label).toBe("gate_integrity_eval:brief:dd");
    expect(count("SELECT COUNT(*) c FROM kill_criteria_evaluation WHERE run_id = ?", runs[0].id)).toBe(
      d.kill.evaluated,
    );
    expect(
      (
        db.query("SELECT evaluated_by FROM kill_criteria_evaluation WHERE run_id = ? LIMIT 1").get(runs[0].id) as {
          evaluated_by: string;
        } | null
      )?.evaluated_by,
    ).toBe(`gate-brief:${ANALYST}`);
    const rec = db.query("SELECT * FROM gate_brief_record WHERE id = ?").get(d.brief_id) as {
      entity_type: string;
      entity_id: string;
      gate: string;
      generated_by: string;
      eval_run_id: string | null;
      source: string;
    } | null;
    expect(rec).toMatchObject({
      entity_type: "project",
      entity_id: projectId,
      gate: "dd",
      generated_by: ANALYST,
      eval_run_id: runs[0].id,
      source: "synthesis",
    });
    // each brief is its own evaluation event: a second brief opens a second run, never a unique-key collision
    expect((await postBrief(`/api/projects/${projectId}/gate-brief`, "dd")).status).toBe(200);
    expect(evalRuns(projectId, "brief")).toHaveLength(2);
  });

  test("flags off: the brief is the legacy brief (no kill block, no evaluation run) but still records its recommendation", async () => {
    const { projectId } = readyAtDd();
    const d = await dataOf<{ brief_id: string; kill: unknown; manifest: string }>(
      await postBrief(`/api/projects/${projectId}/gate-brief`, "dd"),
    );
    expect(d.kill).toBeNull();
    expect(d.manifest).not.toContain("Kill criteria evaluation (deterministic)");
    expect(evalRuns(projectId)).toHaveLength(0);
    expect(d.brief_id).toBeTruthy();
  });

  test("opportunity brief: a kill block from the opportunity-scoped source, no ledger rows, a brief record", async () => {
    setFlags("shadow", ...SNAP);
    const o = S.insertOpportunity(db, "greenfield", ANALYST);
    const before = count("SELECT COUNT(*) c FROM kill_criteria_evaluation");
    const d = await dataOf<{ brief_id: string; kill: { not_reached: unknown[]; eval_run_id: string | null } }>(
      await postBrief(`/api/opportunities/${o}/gate-brief`, "screening"),
    );
    expect(d.kill.not_reached.length).toBeGreaterThan(0);
    expect(d.kill.eval_run_id).toBeNull();
    expect(count("SELECT COUNT(*) c FROM kill_criteria_evaluation")).toBe(before);
    expect(db.query("SELECT entity_type, gate FROM gate_brief_record WHERE id = ?").get(d.brief_id)).toEqual({
      entity_type: "opportunity",
      gate: "screening",
    });
  });

  test("divergence (D9): a GO against a different AI recommendation needs divergence_reason; HOLD never does; the pair is stored on the decision", async () => {
    setFlags("enforce", "divergence");
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const mk = (recommended: string, gate = "fs") => {
      const id = ulid();
      db.run(
        "INSERT INTO gate_brief_record (id, entity_type, entity_id, gate, recommended, confidence, source, generated_by, generated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [id, "project", projectId, gate, recommended, "high", "llm", ANALYST, new Date().toISOString()],
      );
      return id;
    };
    const briefId = mk("hold");
    const none = await postProject(projectId, { gate: "fs", decision: "go", rationale: S.GENUINE, brief_id: briefId });
    expect(none.status).toBe(422);
    expect((await errOf(none)).code).toBe("divergence_reason_required");
    const weak = await postProject(projectId, {
      gate: "fs",
      decision: "go",
      rationale: S.GENUINE,
      brief_id: briefId,
      divergence_reason: "ok",
    });
    expect(weak.status).toBe(422);
    expect((await errOf(weak)).details).toMatchObject({ field: "divergence_reason" });
    expect(
      (await postProject(projectId, { gate: "fs", decision: "go", rationale: S.GENUINE, brief_id: "no-such-brief" }))
        .status,
    ).toBe(400);
    const good = await postProject(projectId, {
      gate: "fs",
      decision: "go",
      rationale: S.GENUINE,
      brief_id: briefId,
      divergence_reason: "The AI weighted the permit timeline; the signed incentive letter removes that risk.",
    });
    expect(good.status).toBe(201);
    const row = db
      .query("SELECT ai_recommended_decision, ai_brief_id, divergence_reason FROM gate_decision WHERE id = ?")
      .get((await dataOf<{ id: string }>(good)).id) as {
      ai_recommended_decision: string;
      ai_brief_id: string;
      divergence_reason: string;
    } | null;
    expect(row).toEqual({
      ai_recommended_decision: "hold",
      ai_brief_id: briefId,
      divergence_reason: "The AI weighted the permit timeline; the signed incentive letter removes that risk.",
    });
    // a recommendation that agrees, or a decision that is not a GO, needs nothing
    expect(
      (await postProject(projectId, { gate: "dd", decision: "go", rationale: S.GENUINE_2, brief_id: mk("go", "dd") }))
        .status,
    ).toBe(201);
    const holdWithDiv = await postProject(projectId, {
      gate: "dd",
      decision: "hold",
      rationale: "x",
      missing_artifacts: ["DD report"],
      brief_id: mk("go", "dd"),
    });
    expect(holdWithDiv.status).toBe(201);
  });
});

describe("recordGateDecisionRow - opportunity carrier and atomicity", () => {
  const { recordGateDecisionRow, parseDecisionExtras } =
    require("../../app/web-next/lib/gate-decision-contract.ts") as typeof import("../../app/web-next/lib/gate-decision-contract.ts");
  const extrasOf = (body: Record<string, unknown>) => {
    const p = parseDecisionExtras(body);
    if (!p.ok) throw new Error("bad extras");
    return p.extras;
  };
  const rec = (o: string, decision: "go" | "hold" | "kill", body: Record<string, unknown> = {}, gate = "screening") =>
    recordGateDecisionRow(db, {
      entityType: "opportunity",
      entityId: o,
      gate,
      decision,
      storedRationale: S.GENUINE,
      missingArtifactsJson: decision === "hold" ? '["x"]' : null,
      actor: ANALYST,
      gateEvaluationId: null,
      learningCapture: decision === "kill" ? "lesson" : null,
      judgementConfirmationsJson: null,
      extras: extrasOf(body),
      now: new Date().toISOString(),
    });

  test("opportunity: a Screening GO needs no acknowledgement for not-reached criteria (ADR-0193), outcomes are stored in snapshot_json only", async () => {
    setFlags("enforce", ...SNAP);
    const o = S.insertOpportunity(db, "greenfield", ANALYST);
    const view = await dataOf<SnapData>(await getOppSnap(o, "screening"));
    const before = count("SELECT COUNT(*) c FROM kill_criteria_evaluation");
    expect(view.snapshot.required_acks).toEqual([]);
    const ok = rec(o, "go", { snapshot_hash: view.snapshot_hash });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const row = db
        .query("SELECT snapshot_json, eval_run_id FROM gate_decision_snapshot WHERE decision_id = ?")
        .get(ok.id) as { snapshot_json: string; eval_run_id: string | null } | null;
      expect(row).not.toBeNull();
      if (!row) return;
      expect(row.eval_run_id).toBeNull();
      const stored = JSON.parse(row.snapshot_json) as GateSnapshot;
      expect(stored.kill.unassessed).toEqual([]);
      expect(stored.kill.not_reached.map((n) => n.key)).toEqual(view.snapshot.kill.not_reached.map((n) => n.key));
    }
    expect(count("SELECT COUNT(*) c FROM kill_criteria_evaluation")).toBe(before);
  });

  test("opportunity: a triggered halt (no viable target) blocks GO with kill_binding_unoverridden but HOLD and KILL still store a snapshot", () => {
    setFlags("enforce", ...SNAP);
    const b = S.insertOpportunity(db, "brownfield", ANALYST);
    db.run(
      "INSERT INTO brownfield_target (id, opportunity_id, company_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      [ulid(), b, "T1", "excluded", S.NOW, S.NOW],
    );
    const go = rec(b, "go");
    expect(go.ok).toBe(false);
    if (!go.ok) expect(go.failure.code).toBe("kill_binding_unoverridden");
    const hold = rec(b, "hold");
    const kill = rec(b, "kill");
    expect(hold.ok && kill.ok).toBe(true);
    if (hold.ok)
      expect(db.query("SELECT COUNT(*) c FROM gate_decision_snapshot WHERE decision_id = ?").get(hold.id)).toEqual({
        c: 1,
      });
  });

  test("atomicity (fault injection): a failing snapshot insert unwinds the decision, the evaluation run, the ledger and the audit rows", async () => {
    setFlags("enforce", ...SNAP);
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const marks = {
      decisions: count("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ?", projectId),
      runs: count("SELECT COUNT(*) c FROM run WHERE project_id = ?", projectId),
      audits: count(
        "SELECT COUNT(*) c FROM audit_log WHERE action = 'gate_decision.record' AND target LIKE ?",
        `${projectId}:%`,
      ),
    };
    db.run(
      "CREATE TRIGGER trg_fault_inject BEFORE INSERT ON gate_decision_snapshot BEGIN SELECT RAISE(ABORT, 'injected fault'); END",
    );
    try {
      const res = await postProject(projectId, {
        gate: "fs",
        decision: "hold",
        rationale: "x",
        missing_artifacts: ["Business case adoption"],
      });
      expect(res.status).toBe(500);
      expect((await errOf(res)).code).toBe("internal_error");
      expect(count("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ?", projectId)).toBe(marks.decisions);
      expect(count("SELECT COUNT(*) c FROM run WHERE project_id = ?", projectId)).toBe(marks.runs);
      expect(count("SELECT COUNT(*) c FROM kill_criteria_evaluation WHERE project_id = ?", projectId)).toBe(0);
      expect(
        count(
          "SELECT COUNT(*) c FROM audit_log WHERE action = 'gate_decision.record' AND target LIKE ?",
          `${projectId}:%`,
        ),
      ).toBe(marks.audits);

      // shadow degrades: recording is never broken by a snapshot fault - the legacy write happens and the fault is audited
      setFlags("shadow", ...SNAP);
      const shadow = await postProject(projectId, {
        gate: "fs",
        decision: "hold",
        rationale: "x",
        missing_artifacts: ["Business case adoption"],
      });
      expect(shadow.status).toBe(201);
      expect(count("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ?", projectId)).toBe(marks.decisions + 1);
      expect(
        db
          .query("SELECT 1 FROM audit_log WHERE action = 'gate_integrity.would_block:snapshot_error' AND target = ?")
          .all(`project:${projectId}:fs`),
      ).toHaveLength(1);
    } finally {
      db.run("DROP TRIGGER trg_fault_inject");
    }
  });
});

describe("evaluation runs stay out of the run lineage", () => {
  test("createRun's default source skips gate_integrity_eval runs, and the S12/greenfield 'latest live run' readers skip them", async () => {
    const { createRun } = await import("../../db/lib/versioning.ts");
    const { createGateEvalRun } = await import("../../db/repositories/gate-snapshot.repository.ts");
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const first = createRun(db, {
      projectId,
      createdBy: ANALYST,
      overrides: { discount_rate: 0.1 },
      now: "2026-10-27T10:00:00.000Z",
    });
    const evalRunId = createGateEvalRun(db, {
      projectId,
      gate: "fs",
      event: "decision",
      actor: ANALYST,
      now: "2026-10-27T10:05:00.000Z",
    });
    const second = createRun(db, { projectId, createdBy: ANALYST, now: "2026-10-27T10:10:00.000Z" });
    // lineage came from the real run, not from the (input-less) evaluation run
    expect(db.query("SELECT assumption_key, value FROM run_input WHERE run_id = ?").all(second.run_id)).toEqual([
      { assumption_key: "discount_rate", value: 0.1 },
    ]);
    expect(first.run_id).not.toBe(second.run_id);
    // the "latest live run" readers filter superseded_by IS NULL: an evaluation run is superseded by itself
    const live = db
      .query(
        "SELECT id FROM run WHERE project_id = ? AND superseded_by IS NULL ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .get(projectId) as { id: string };
    expect(live.id).not.toBe(evalRunId);
  });
});

describe("data-architect follow-ups", () => {
  test("watch-run anchors on the latest real run, not on a gate_integrity_eval run", async () => {
    const { createGateEvalRun } = await import("../../db/repositories/gate-snapshot.repository.ts");
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const real = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [
      real,
      projectId,
      "real",
      "h",
      ANALYST,
      "2026-10-27T10:00:00.000Z",
    ]);
    createGateEvalRun(db, {
      projectId,
      gate: "fs",
      event: "decision",
      actor: ANALYST,
      now: "2026-10-27T11:00:00.000Z",
    });
    const src = await Bun.file(join(PROJECT_ROOT, "scripts/co-newbiz/watch-run.ts")).text();
    const sql = /"(SELECT id FROM run WHERE project_id = \? AND [^"]*LIMIT 1)"/.exec(src)?.[1];
    if (!sql) throw new Error("watch-run.ts query source not found");
    expect((db.query(sql).get(projectId) as { id: string }).id).toBe(real);
  });

  test("db-integrity --fix never deletes a gate decision once the 0175 delete guard exists: orphans are reported, none removed", async () => {
    const { deleteOrphanGateDecisions, findGateDecisionReferenceIssues } = await import(
      "../../scripts/co-newbiz/db-integrity.ts"
    );
    const { insertGateSnapshot } = await import("../../db/repositories/gate-snapshot.repository.ts");
    const kept = S.insertGate(db, "opportunity", "missing-opp-1", "screening", "go");
    const plain = S.insertGate(db, "opportunity", "missing-opp-2", "screening", "go");
    insertGateSnapshot(db, {
      decisionId: kept,
      schemaVersion: 1,
      snapshotJson: "{}",
      snapshotHash: "h",
      submittedHash: null,
      acknowledgements: [],
      computedAt: S.NOW,
      engineVersionsJson: "{}",
      evalRunId: null,
      briefId: null,
    });
    expect(findGateDecisionReferenceIssues(db).map((i) => i.id)).toEqual(expect.arrayContaining([kept, plain]));
    expect(deleteOrphanGateDecisions(db)).toBe(0);
    expect(db.query("SELECT 1 FROM gate_decision WHERE id = ?").get(kept)).toBeTruthy();
    expect(db.query("SELECT 1 FROM gate_decision WHERE id = ?").get(plain)).toBeTruthy();
    // still reported as issues (the plain-delete behaviour stays covered by db-integrity.test.ts on a guard-free fixture)
    expect(findGateDecisionReferenceIssues(db).map((i) => i.id)).toEqual(expect.arrayContaining([kept, plain]));
  });
});
