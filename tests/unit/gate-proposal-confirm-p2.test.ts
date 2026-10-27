// @version 1.0.0
/**
 * ADR-0186 design 3.10 - propose then confirm. A gate-decision PROPOSAL carries no snapshot hash and no
 * acknowledgements (an agent cannot pre-acknowledge); the human confirm step shows a FRESH snapshot (confirm GET) and
 * the confirm POST carries the hash and the human's acknowledgements, which the gate route re-checks.
 */
import { test, expect, beforeAll, afterAll, afterEach, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-gate-proposal-confirm-p2.sqlite");
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
const { validatePayload, HUMAN_ONLY_GATE_FIELDS } = await import("../../app/web-next/lib/proposals.ts");
const S = await import("./_gate-integrity-support.ts");

const ANALYST = "p2c-analyst";
let cookie = "";

const flagNames = GATE_INTEGRITY_FAMILIES.map(gateIntegrityEnvName);
afterEach(() => {
  for (const n of flagNames) delete process.env[n];
  clearSnapshotCache();
});
const enforceAll = () => { for (const f of ["snapshot_ack", "kill_binding", "divergence"] as const) process.env[gateIntegrityEnvName(f)] = "enforce"; };

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-p2c-analyst-123", createdBy: "test", now: S.NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: S.NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: ANALYST, password: "pw-p2c-analyst-123" }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

const call = (path: string, method: string, body?: unknown) => nextRequest(path, { method, headers: { cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
const dataOf = async <T = any>(res: Response) => ((await res.json()) as { data: T }).data;
const errOf = async (res: Response) => ((await res.json()) as { error: { code: string; details?: Record<string, any> } }).error;
const count = (sql: string, ...args: unknown[]) => (db.query(sql).get(...(args as any[])) as { c: number }).c;
const REASON = "이 항목은 위험을 인지했으며 후속 조치 일정을 확인한 뒤 진행함";

async function propose(entityId: string, payload: Record<string, unknown>) {
  return call("/api/proposals", "POST", { kind: "gate_decision", entity_id: entityId, payload, rationale: String(payload.rationale ?? "draft") });
}

describe("validatePayload - human-only fields", () => {
  const base = { gate: "fs", decision: "go", rationale: S.GENUINE };
  test.each([...HUMAN_ONLY_GATE_FIELDS] as string[])("a gate proposal carrying %s is rejected with human_fields_not_proposable", (field: string) => {
    const r = validatePayload("gate_decision", { ...base, [field]: field === "acknowledgements" ? [{ key: "k", reason: "r" }] : "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("human_fields_not_proposable");
      expect(r.message).toContain(field);
    }
  });
  test("brief_id is proposable; an unknown field is still a plain invalid payload; other kinds are untouched", () => {
    expect(validatePayload("gate_decision", { ...base, brief_id: "01ABC" }).ok).toBe(true);
    const unknown = validatePayload("gate_decision", { ...base, surprise: 1 });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.code).toBeUndefined();
    expect(validatePayload("case_adoption", { model_id: "m" }).ok).toBe(true);
  });
});

describe("POST /api/proposals", () => {
  test("a proposal that smuggles a hash or acknowledgements is 400 human_fields_not_proposable and writes nothing", async () => {
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const before = count("SELECT COUNT(*) c FROM decision_proposal");
    const res = await propose(projectId, { gate: "fs", decision: "go", rationale: S.GENUINE, acknowledgements: [{ key: "rag:absent", reason: REASON }], snapshot_hash: "abc" });
    expect(res.status).toBe(400);
    expect((await errOf(res)).code).toBe("human_fields_not_proposable");
    expect(count("SELECT COUNT(*) c FROM decision_proposal")).toBe(before);
    const ok = await propose(projectId, { gate: "fs", decision: "go", rationale: S.GENUINE, brief_id: "01BRIEF" });
    expect(ok.status).toBe(201);
  });
});

describe("confirm GET / POST", () => {
  test("GET returns a fresh snapshot with the nonce; POST without the hash is 409 snapshot_stale and the proposal stays pending", async () => {
    enforceAll();
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const pid = (await dataOf<any>(await propose(projectId, { gate: "fs", decision: "go", rationale: S.GENUINE }))).proposal_id as string;
    const view = await dataOf<any>(await call(`/api/proposals/${pid}/confirm`, "GET"));
    expect(view.confirm_nonce).toBeTruthy();
    expect(view.gate_snapshot.gate).toBe("fs");
    expect(view.gate_snapshot.snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
    const keys = view.gate_snapshot.snapshot.required_acks.map((a: any) => a.key);
    expect(keys.length).toBeGreaterThan(0);

    const noHash = await call(`/api/proposals/${pid}/confirm`, "POST", { nonce: view.confirm_nonce });
    expect(noHash.status).toBe(409);
    expect((await errOf(noHash)).code).toBe("snapshot_stale");
    expect(count("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ?", projectId)).toBe(0);
    expect(db.query("SELECT status FROM decision_proposal WHERE id = ?").get(pid)).toEqual({ status: "pending" });

    // reload the confirmation view (new nonce, fresh snapshot), then acknowledge
    const again = await dataOf<any>(await call(`/api/proposals/${pid}/confirm`, "GET"));
    const missing = await call(`/api/proposals/${pid}/confirm`, "POST", { nonce: again.confirm_nonce, snapshot_hash: again.gate_snapshot.snapshot_hash });
    expect(missing.status).toBe(422);
    expect((await errOf(missing)).details!.missing).toEqual(keys);
    const third = await dataOf<any>(await call(`/api/proposals/${pid}/confirm`, "GET"));
    const acks = third.gate_snapshot.snapshot.required_acks.map((a: any) => ({ key: a.key, kind: a.kind, reason: REASON }));
    const done = await call(`/api/proposals/${pid}/confirm`, "POST", { nonce: third.confirm_nonce, snapshot_hash: third.gate_snapshot.snapshot_hash, acknowledgements: acks });
    expect(done.status).toBe(200);
    const confirmed = await dataOf<any>(done);
    expect(confirmed.status).toBe("confirmed");
    const row = db.query("SELECT d.decided_by, s.snapshot_hash, s.acknowledgements_json, s.submitted_hash FROM gate_decision d JOIN gate_decision_snapshot s ON s.decision_id = d.id WHERE d.id = ?").get(confirmed.resulting_record_id) as any;
    expect(row.decided_by).toBe(ANALYST);
    expect(row.snapshot_hash).toBe(third.gate_snapshot.snapshot_hash);
    expect(row.submitted_hash).toBe(row.snapshot_hash);
    expect(JSON.parse(row.acknowledgements_json).map((a: any) => a.key)).toEqual(keys);
  });

  test("a stale hash at confirm is 409 snapshot_stale carrying the fresh snapshot; reload and retry succeeds", async () => {
    enforceAll();
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const pid = (await dataOf<any>(await propose(projectId, { gate: "fs", decision: "go", rationale: S.GENUINE }))).proposal_id as string;
    const view = await dataOf<any>(await call(`/api/proposals/${pid}/confirm`, "GET"));
    const gov = S.insertGovernanceDoc(db);
    db.run(
      "INSERT INTO waiver (id, project_id, governance_doc_id, clause_ref, reason, requested_by, approver_role, approved_by, approved_at, expires_at, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'active',?)",
      [ulid(), projectId, gov, "chk z-1", "test", ANALYST, "entity-ic-reviewer", "someone-else", S.NOW, "2099-01-01T00:00:00Z", S.NOW],
    );
    const acks = view.gate_snapshot.snapshot.required_acks.map((a: any) => ({ key: a.key, kind: a.kind, reason: REASON }));
    const stale = await call(`/api/proposals/${pid}/confirm`, "POST", { nonce: view.confirm_nonce, snapshot_hash: view.gate_snapshot.snapshot_hash, acknowledgements: acks });
    expect(stale.status).toBe(409);
    const e = await errOf(stale);
    expect(e.code).toBe("snapshot_stale");
    expect(e.details!.snapshot.waivers.active).toHaveLength(1);
    const fresh = await dataOf<any>(await call(`/api/proposals/${pid}/confirm`, "GET"));
    expect(fresh.gate_snapshot.snapshot_hash).toBe(e.details!.snapshot_hash);
    const retry = await call(`/api/proposals/${pid}/confirm`, "POST", { nonce: fresh.confirm_nonce, snapshot_hash: fresh.gate_snapshot.snapshot_hash, acknowledgements: acks });
    expect(retry.status).toBe(200);
  });

  test("the human's edit at confirm cannot smuggle the human-only fields inside payload; other kinds refuse them at top level", async () => {
    const { projectId } = S.seedReadyProject(db, ANALYST);
    const pid = (await dataOf<any>(await propose(projectId, { gate: "fs", decision: "go", rationale: S.GENUINE }))).proposal_id as string;
    const view = await dataOf<any>(await call(`/api/proposals/${pid}/confirm`, "GET"));
    const smuggled = await call(`/api/proposals/${pid}/confirm`, "POST", { nonce: view.confirm_nonce, payload: { gate: "fs", decision: "go", rationale: S.GENUINE, acknowledgements: [] } });
    expect(smuggled.status).toBe(400);
    expect((await errOf(smuggled)).code).toBe("human_fields_not_proposable");

    const sel = await call("/api/proposals", "POST", { kind: "case_adoption", entity_id: projectId, payload: { model_id: "m1" }, rationale: "adopt the base case" });
    expect(sel.status).toBe(201);
    const spid = (await dataOf<any>(sel)).proposal_id as string;
    const sview = await dataOf<any>(await call(`/api/proposals/${spid}/confirm`, "GET"));
    expect(sview.gate_snapshot).toBeNull();
    const bad = await call(`/api/proposals/${spid}/confirm`, "POST", { nonce: sview.confirm_nonce, snapshot_hash: "x" });
    expect(bad.status).toBe(400);
  });

  test("flags off: confirm still works with only the nonce (legacy), and the opportunity carrier also gets a snapshot view", async () => {
    const o = S.insertOpportunity(db, "greenfield", ANALYST);
    db.run("UPDATE opportunity SET created_at = ?, market_size_krw_m = 1000, growth_rate = 0.05, value_chain_node = 'node', attractiveness_score = 60, synergy_score = 60, rationale = 'fit' WHERE id = ?", ["2026-01-01T00:00:00.000Z", o]);
    const pid = (await dataOf<any>(await propose(o, { gate: "screening", decision: "hold", rationale: S.GENUINE, missing_artifacts: ["market sizing"] }))).proposal_id as string;
    const view = await dataOf<any>(await call(`/api/proposals/${pid}/confirm`, "GET"));
    expect(view.gate_snapshot.snapshot.entity).toEqual({ type: "opportunity", id: o });
    const done = await call(`/api/proposals/${pid}/confirm`, "POST", { nonce: view.confirm_nonce });
    expect(done.status).toBe(200);
  });
});
