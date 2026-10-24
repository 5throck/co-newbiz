// @version 1.0.0
/**
 * ADR-0171 slice 2: Brown Field S7 per-target required-capability judgements.
 * Covers migration 0145 (schema, rollback note), the repository (scope, save, confirm, human-only),
 * two-hash staleness (only the affected target is invalidated, history kept, confirmation cleared),
 * audit rows (calling user, surface, target_id), criteria reconcile + detection (idempotent, retire
 * marker, nothing person-entered dropped) and the warning-only S7 readiness.
 * ASCII-only source: Korean strings are written as \u escapes.
 */
import { test, expect, beforeAll, describe } from "bun:test";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-bf-capability-judgement.sqlite");
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
const crit = await import("../../app/web-next/lib/brownfield-eval-criteria.ts");
const bf = await import("../../app/web-next/lib/brownfield-capability-judgement.ts");
const { isHumanOnly, InProcessRestPort } = await import("../../app/web-next/lib/mcp/in-process-port.ts");

const NOW = "2026-10-15T09:00:00Z";
const json = JSON.stringify;
const req = (path: string, init?: RequestInit) => nextRequest(path, init);
const read = (p: string) => readFileSync(join(PROJECT_ROOT, p), "utf-8");

const LEAD = "bf-lead";
let cookie = "";
let oppId = "";
let t1 = "";
let t2 = "";
let tPending = "";

const rowsS3 = () => [
  { id: "a", capability: "Precision machining", source: "manual", requiredNote: "tolerance 5um", held: { status: "none" }, requiredLevel: "advanced", currentLevel: "basic" },
  { id: "b", capability: "Quality certification", source: "manual", requiredNote: "", held: { status: "partial" }, requiredLevel: "working", currentLevel: "basic" },
];
const writeS3 = (rows: unknown[]) => db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows, updatedAt: NOW }), oppId]);
const s3Stored = () => (JSON.parse((db.query("SELECT capability_gap_json j FROM opportunity WHERE id = ?").get(oppId) as { j: string }).j) as { rows: any[] }).rows;

const url = (t: string) => `/api/brownfield/targets/${t}/capability-judgements`;
const get = async (t: string) => ((await (await req(url(t), { headers: { cookie } })).json()) as { data: any }).data;
const put = (t: string, rows: unknown[]) => req(url(t), { method: "PUT", headers: { cookie }, body: json({ rows }) });
const confirm = (t: string, body: unknown = {}) => req(`${url(t)}/confirm`, { method: "POST", headers: { cookie }, body: json(body) });
const audits = (action: string) => db.query("SELECT actor_user_id a, target FROM audit_log WHERE action = ? ORDER BY created_at, id").all(action) as Array<{ a: string; target: string }>;
const critOf = (rowId: string) => db.query("SELECT * FROM brownfield_eval_criterion WHERE opportunity_id = ? AND seed_ref = ?").get(oppId, rowId) as any;
const setVerdict = (t: string, rowId: string, status: string, note = "") =>
  req(`/api/brownfield/${oppId}/targets/${t}/eval-state/${critOf(rowId).id}`, { method: "PUT", headers: { cookie }, body: json({ status, note }) });
const storedRows = (t: string) => db.query("SELECT * FROM brownfield_target_capability_judgement WHERE brownfield_target_id = ?").all(t) as any[];
const judgePatch = (view: any, id: string, over: Record<string, unknown> = {}) => ({
  id, s3Hash: view.rows.find((r: any) => r.id === id).s3_hash, resolution: "hire", expectedLevel: "hired team runs it", grade: "medium", rationale: "can recruit", closingCostKrwM: 200, monthsToAttain: 6, category: "labor", ...over,
});

beforeAll(async () => {
  await createUser(db, { userId: LEAD, role: "analyst", password: `pw-${LEAD}-12345`, createdBy: "test", now: NOW });
  approveUser(db, { userId: LEAD, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const login = await req("/api/auth/login", { method: "POST", body: json({ userId: LEAD, password: `pw-${LEAD}-12345` }) });
  cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
  oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "bf opp", "industry", "selected", LEAD, NOW]);
  writeS3(rowsS3());
  const mk = (name: string, status: string, rank: number | null) => {
    const id = ulid();
    db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [id, oppId, name, status, rank, NOW, NOW]);
    return id;
  };
  t1 = mk("Target One", "shortlisted", 1);
  t2 = mk("Target Two", "shortlisted", 2);
  tPending = mk("Target Pending", "pending", null);
  crit.listOrSeedCriteria(oppId, LEAD, db); // first (lazy) seed, as the S7 page does
});

describe("migration 0145", () => {
  const file = readdirSync(join(PROJECT_ROOT, "db/migrations")).find((f) => f.startsWith("0145_"))!;
  const sql = readFileSync(join(PROJECT_ROOT, "db/migrations", file), "utf-8");
  test("file is additive, reversible and carries a rollback note", () => {
    expect(file).toBe("0145_brownfield_target_capability_judgement.sql");
    expect(sql).toContain("@reversible: true");
    expect(sql).toContain("ROLLBACK-SQL-BEGIN");
    expect(sql).toContain("DROP TABLE brownfield_target_capability_judgement");
    expect(sql).not.toMatch(/\bDROP TABLE (?!brownfield_target_capability_judgement)/);
  });
  test("schema: table columns, unique (target, row), index, retire columns", () => {
    const cols = (db.query("PRAGMA table_info(brownfield_target_capability_judgement)").all() as Array<{ name: string; notnull: number }>).map((c) => c.name);
    expect(cols).toEqual(["id", "brownfield_target_id", "capability_row_id", "criterion_id", "judgement_json", "eval_basis_hash", "created_by", "created_at", "updated_by", "updated_at"]);
    const idx = db.query("PRAGMA index_list(brownfield_target_capability_judgement)").all() as Array<{ name: string; unique: number }>;
    expect(idx.some((i) => i.unique === 1)).toBe(true);
    expect(idx.some((i) => i.name === "idx_bf_target_cap_judgement_target")).toBe(true);
    const crit2 = (db.query("PRAGMA table_info(brownfield_eval_criterion)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(crit2).toContain("retired_at");
    expect(crit2).toContain("retired_reason");
    const fk = db.query("PRAGMA foreign_key_list(brownfield_target_capability_judgement)").all() as Array<{ table: string }>;
    expect(fk.map((f) => f.table).sort()).toEqual(["brownfield_eval_criterion", "brownfield_target"]);
  });
  test("unique (target, capability_row_id) is enforced", () => {
    const ins = () => db.run("INSERT INTO brownfield_target_capability_judgement (id, brownfield_target_id, capability_row_id, judgement_json, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), tPending, "dup", "{}", "u", NOW, "u", NOW]);
    ins();
    expect(ins).toThrow();
    db.run("DELETE FROM brownfield_target_capability_judgement WHERE brownfield_target_id = ?", [tPending]);
  });
});

describe("scope, save and confirm", () => {
  test("only shortlisted targets are in scope: a pending target gets 409 target_not_in_scope (GET, PUT, confirm)", async () => {
    for (const r of [await req(url(tPending), { headers: { cookie } }), await put(tPending, [{ id: "a", grade: "medium" }]), await confirm(tPending)]) {
      expect(r.status).toBe(409);
      expect(((await r.json()) as any).error.code).toBe("target_not_in_scope");
    }
    expect((await req(url("nope"), { headers: { cookie } })).status).toBe(404);
  });

  test("GET lists every S3 row with its seeded criterion and no judgement", async () => {
    const v = await get(t1);
    expect(v.surface).toBe("S7");
    expect(v.rows.map((r: any) => r.id)).toEqual(["a", "b"]);
    expect(v.rows.every((r: any) => r.reconciled === true && r.grade === null && r.stale === false)).toBe(true);
    expect(v.reconcile.inSync).toBe(true);
    expect(v.rows[0].s3_hash).toMatch(/^v2:[0-9a-f]{16}\|e1:[0-9a-f]{16}$/);
  });

  test("PUT saves a draft for one target only; basis hashes are stamped server-side; audit has user, surface, target_id", async () => {
    const v = await get(t1);
    const res = await put(t1, [judgePatch(v, "a", { basisHash: "forged" })]);
    expect(res.status).toBe(200);
    const body = ((await res.json()) as any).data;
    expect(body.changed).toBe(1);
    const a = body.rows.find((r: any) => r.id === "a");
    expect(a).toMatchObject({ grade: "medium", resolution: "hire", confirmed_at: null, drafted_by: "human", stale: false });
    const row = storedRows(t1).find((r) => r.capability_row_id === "a");
    const att = JSON.parse(row.judgement_json).attainability;
    expect(att.basisHash).toMatch(/^v2:/);
    expect(att.basisHash).not.toBe("forged");
    expect(row.eval_basis_hash).toMatch(/^e1:/);
    expect(row.criterion_id).toBe(critOf("a").id);
    expect(storedRows(t2)).toHaveLength(0); // other target untouched
    expect(s3Stored().find((r) => r.id === "a").attainability).toBeUndefined(); // S3 register is not written
    const ev = audits("capability_attainability.save");
    expect(ev.at(-1)).toEqual({ a: LEAD, target: `${oppId}#capability@ui:surface=S7:target_id=${t1}` });
  });

  test("S3-owned fields and bad input are rejected with the Green Field error codes", async () => {
    const v = await get(t1);
    const own = await put(t1, [{ id: "a", capability: "x" }]);
    expect(own.status).toBe(400);
    expect(((await own.json()) as any).error.code).toBe("s3_owned_field");
    const noRationale = await put(t1, [{ id: "b", s3Hash: v.rows[1].s3_hash, grade: "high" }]);
    expect(((await noRationale.json()) as any).error.code).toBe("rationale_required");
    const unknown = await put(t1, [{ id: "zzz", grade: "medium" }]);
    expect(((await unknown.json()) as any).error.code).toBe("unknown_row");
  });

  test("confirm is human-only: a bearer/MCP caller gets 403 human_only and nothing changes; the registry lists the route", async () => {
    expect(isHumanOnly("POST", `/api/brownfield/targets/${t1}/capability-judgements/confirm`, {})).toBe(true);
    const port = new InProcessRestPort({ userId: LEAD, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" });
    expect((await port.post(`${url(t1)}/confirm`, {})).error?.code).toBe("human_only");
    expect(JSON.parse(storedRows(t1).find((r) => r.capability_row_id === "a").judgement_json).attainability.confirmedAt).toBeNull();
  });

  test("a person confirms; audit carries the user, surface and target_id; the other target stays unconfirmed", async () => {
    const res = await confirm(t1);
    expect(res.status).toBe(200);
    const body = ((await res.json()) as any).data;
    expect(body.confirmed).toBe(1);
    expect(body.rows.find((r: any) => r.id === "a")).toMatchObject({ confirmed_by: LEAD });
    expect(audits("capability_attainability.confirm").at(-1)).toEqual({ a: LEAD, target: `${oppId}#capability@ui:surface=S7:target_id=${t1}` });
    // confirming again has nothing to confirm
    expect((await confirm(t1)).status).toBe(409);
  });

  test("a 'resolution' needs an 'expected level' to confirm (record completeness, same as S5)", async () => {
    const v = await get(t1);
    await put(t1, [judgePatch(v, "b", { expectedLevel: "" })]);
    const r = await confirm(t1, { row_ids: ["b"] });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error.code).toBe("expected_level_required");
    const v2 = await get(t1);
    await put(t1, [judgePatch(v2, "b")]);
    expect((await confirm(t1, { row_ids: ["b"] })).status).toBe(200);
  });
});

describe("two-hash staleness invalidates only the affected target", () => {
  test("seed a second target judgement, confirmed", async () => {
    const v = await get(t2);
    expect((await put(t2, [judgePatch(v, "a", { resolution: "build", expectedLevel: "in-house line", rationale: "own capex", category: "capex" })])).status).toBe(200);
    expect((await confirm(t2)).status).toBe(200);
  });

  test("changing target one's verdict for the seeded criterion stales ONLY target one: history kept, confirmation cleared, audited", async () => {
    expect((await setVerdict(t1, "a", "partial", "visited plant")).status).toBe(200);
    const v1 = await get(t1);
    const a1 = v1.rows.find((r: any) => r.id === "a");
    expect(a1).toMatchObject({ stale: true, stale_reasons: ["eval"], confirmed_at: null, confirmed_by: null, grade: "medium", history_count: 1 });
    expect(a1.prior).toMatchObject({ reason: "eval_changed", confirmedBy: LEAD, grade: "medium" });
    expect(v1.rows.find((r: any) => r.id === "b").stale).toBe(false); // other row of the same target untouched
    expect(v1.summary.stale).toBe(1);
    expect(v1.summary.bannerReasons).toContain("stale");
    const v2 = await get(t2);
    expect(v2.rows.find((r: any) => r.id === "a")).toMatchObject({ stale: false, confirmed_by: LEAD });
    const stored = JSON.parse(storedRows(t1).find((r) => r.capability_row_id === "a").judgement_json).attainability;
    expect(stored.confirmedAt).toBeNull();
    expect(stored.staleSince).toBeTruthy();
    expect(stored.grade).toBe("medium"); // prior values stay as pre-fill
    expect(stored.history).toHaveLength(1);
    const ev = audits("capability_attainability.invalidate").at(-1)!;
    expect(ev.a).toBe(LEAD);
    expect(ev.target).toBe(`${oppId}#capability-stale@surface=S7:target_id=${t1}:rows=a`);
    // idempotent: another verdict write does not add a second history entry while still stale
    expect((await setVerdict(t1, "a", "fail", "second look")).status).toBe(200);
    expect(JSON.parse(storedRows(t1).find((r) => r.capability_row_id === "a").judgement_json).attainability.history).toHaveLength(1);
  });

  test("a stale row cannot be confirmed without a fresh save; the fresh save re-stamps both bases and unlocks it", async () => {
    const r = await confirm(t1, { row_ids: ["a"] });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error.code).toBe("stale_requires_rejudge");
    const v = await get(t1);
    expect((await put(t1, [judgePatch(v, "a")])).status).toBe(200);
    const after = await get(t1);
    expect(after.rows.find((x: any) => x.id === "a")).toMatchObject({ stale: false, confirmed_at: null });
    expect((await confirm(t1, { row_ids: ["a"] })).status).toBe(200);
    expect((await get(t1)).rows.find((x: any) => x.id === "a").confirmed_by).toBe(LEAD);
  });

  test("a client holding an outdated evaluation-state token cannot hide a newer verdict: the row stays stale", async () => {
    const v = await get(t1);
    const token = judgePatch(v, "a").s3Hash as string;
    expect((await setVerdict(t1, "a", "pass", "now fine")).status).toBe(200);
    expect((await put(t1, [{ ...judgePatch(v, "a", { rationale: "saved on old screen" }), s3Hash: token }])).status).toBe(200);
    expect((await get(t1)).rows.find((x: any) => x.id === "a")).toMatchObject({ stale: true, stale_reasons: ["eval"] });
    const v2 = await get(t1);
    await put(t1, [judgePatch(v2, "a")]);
    expect((await get(t1)).rows.find((x: any) => x.id === "a").stale).toBe(false);
  });

  test("an S3 definition change makes the judgement stale (derived on read) and the next S7 write materialises history under the caller", async () => {
    const v = await get(t2);
    const before = (await get(t2)).rows.find((x: any) => x.id === "a");
    expect(before.stale).toBe(false);
    writeS3(s3Stored().map((r) => (r.id === "a" ? { ...r, requiredLevel: "expert" } : r)));
    const stale = (await get(t2)).rows.find((x: any) => x.id === "a");
    expect(stale).toMatchObject({ stale: true, stale_reasons: ["s3"], confirmed_at: null });
    expect(stale.s3_changes).toEqual([{ field: "requiredLevel", label: "\ud544\uc694 \uc218\uc900", before: "advanced", after: "expert" }]);
    // no history yet (derived only); a write to this target materialises it
    expect(JSON.parse(storedRows(t2).find((r) => r.capability_row_id === "a").judgement_json).attainability.history ?? []).toHaveLength(0);
    expect((await put(t2, [{ id: "b", s3Hash: v.rows[1].s3_hash, grade: "medium", rationale: "ok" }])).status).toBe(200);
    const att = JSON.parse(storedRows(t2).find((r) => r.capability_row_id === "a").judgement_json).attainability;
    expect(att.history).toHaveLength(1);
    expect(att.history[0].reason).toBe("s3_changed");
    expect(audits("capability_attainability.invalidate").at(-1)!.target).toBe(`${oppId}#capability-stale@surface=S7:target_id=${t2}:rows=a`);
    writeS3(s3Stored().map((r) => (r.id === "a" ? { ...r, requiredLevel: "advanced" } : r)));
  });
});

describe("criteria reconcile + detection", () => {
  test("a later S3 row is detected, shown as unreconciled, cannot be judged, then reconcile seeds it", async () => {
    writeS3([...s3Stored(), { id: "c", capability: "Clean room operation", source: "manual", requiredNote: "", held: { status: "none" }, requiredLevel: "", currentLevel: "" }]);
    const plan = crit.detectCriteriaReconcile(oppId, db);
    expect(plan.inSync).toBe(false);
    expect(plan.missing).toEqual([{ rowId: "c", capability: "Clean room operation" }]);
    const v = await get(t1);
    expect(v.reconcile.missing).toHaveLength(1);
    expect(v.rows.find((r: any) => r.id === "c")).toMatchObject({ reconciled: false, criterion_id: null });
    const res = await put(t1, [{ id: "c", s3Hash: v.rows[2].s3_hash, grade: "medium" }]);
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("criteria_not_reconciled");
    // the technical catalog is unchanged until a person reconciles
    expect(crit.listOrSeedCriteria(oppId, LEAD, db).filter((c) => c.category === "technical")).toHaveLength(2);

    const rec = await req(`/api/brownfield/${oppId}/eval-criteria/reconcile`, { method: "POST", headers: { cookie }, body: json({}) });
    expect(rec.status).toBe(200);
    expect(((await rec.json()) as any).data).toMatchObject({ added: 1, retired: 0, relabeled: 0, reinstated: 0 });
    const tech = crit.listOrSeedCriteria(oppId, LEAD, db).filter((c) => c.category === "technical");
    expect(tech.map((c) => c.seed_ref).sort()).toEqual(["a", "b", "c"]);
    expect(audits("brownfield_eval_criteria.reconcile").at(-1)).toMatchObject({ a: LEAD });
    expect(audits("brownfield_eval_criteria.reconcile").at(-1)!.target).toContain("surface=S7:added=1");
    expect((await get(t1)).rows.find((r: any) => r.id === "c").reconciled).toBe(true);
  });

  test("reconcile is idempotent: a second run changes nothing and writes no audit", async () => {
    const n = audits("brownfield_eval_criteria.reconcile").length;
    expect(crit.reconcileCriteria(oppId, LEAD, db)).toEqual({ added: 0, retired: 0, relabeled: 0, reinstated: 0 });
    expect(audits("brownfield_eval_criteria.reconcile")).toHaveLength(n);
    expect(crit.detectCriteriaReconcile(oppId, db).inSync).toBe(true);
  });

  test("a removed S3 row retires its criterion (marker), keeps evaluation records and the target's judgement, never deletes person-entered data", async () => {
    // person-entered data on row b: a weight, a verdict and a judgement on target one
    db.run("UPDATE brownfield_eval_criterion SET weight = 37 WHERE id = ?", [critOf("b").id]);
    expect((await setVerdict(t1, "b", "pass", "kept note")).status).toBe(200);
    const v = await get(t1);
    await put(t1, [judgePatch(v, "b")]);
    const stateBefore = db.query("SELECT COUNT(*) c FROM brownfield_target_eval_state WHERE criterion_id = ?").get(critOf("b").id) as { c: number };
    writeS3(s3Stored().filter((r) => r.id !== "b"));

    const plan = crit.detectCriteriaReconcile(oppId, db);
    expect(plan.retire).toEqual([expect.objectContaining({ seedRef: "b", assessedTargets: 1 })]);
    expect((await req(`/api/brownfield/${oppId}/eval-criteria/reconcile`, { method: "POST", headers: { cookie }, body: json({}) })).status).toBe(200);

    const c = critOf("b");
    expect(c.retired_at).toBeTruthy();
    expect(c.retired_reason).toBe("s3_row_removed");
    expect(c.deleted_at).toBeNull();
    expect(c.weight).toBe(37);
    expect((db.query("SELECT COUNT(*) c FROM brownfield_target_eval_state WHERE criterion_id = ?").get(c.id) as { c: number }).c).toBe(stateBefore.c);
    expect(crit.listOrSeedCriteria(oppId, LEAD, db).some((x) => x.seed_ref === "b")).toBe(false); // excluded from catalog and scores
    const view = await get(t1);
    expect(view.rows.map((r: any) => r.id)).toEqual(["a", "c"]);
    expect(view.removed_capabilities.map((x: any) => x.rowId)).toEqual(["b"]); // judgement history survives
    expect(storedRows(t1).some((r) => r.capability_row_id === "b")).toBe(true);
    // a retired criterion can no longer be edited through the verdict route
    expect((await req(`/api/brownfield/${oppId}/targets/${t1}/eval-state/${c.id}`, { method: "PUT", headers: { cookie }, body: json({ status: "fail" }) })).status).toBe(404);
  });

  test("a renamed S3 row relabels the seeded criterion; a returning row reinstates it; weights stay", async () => {
    writeS3(s3Stored().map((r) => (r.id === "a" ? { ...r, capability: "Precision machining (CNC)" } : r)));
    expect(crit.detectCriteriaReconcile(oppId, db).relabel).toEqual([expect.objectContaining({ from: "Precision machining", to: "Precision machining (CNC)" })]);
    crit.reconcileCriteria(oppId, LEAD, db);
    expect(critOf("a").label).toBe("Precision machining (CNC)");
    writeS3([...s3Stored(), { id: "b", capability: "Quality certification", source: "manual", requiredNote: "", held: { status: "partial" }, requiredLevel: "working", currentLevel: "basic" }]);
    expect(crit.detectCriteriaReconcile(oppId, db).reinstate).toHaveLength(1);
    crit.reconcileCriteria(oppId, LEAD, db);
    expect(critOf("b").retired_at).toBeNull();
    expect(critOf("b").weight).toBe(37);
    expect(crit.detectCriteriaReconcile(oppId, db).inSync).toBe(true);
  });

  test("reconcile and detection need analyst+ / read; unknown opportunity is 404", async () => {
    expect((await req(`/api/brownfield/nope/eval-criteria/reconcile`, { method: "POST", headers: { cookie }, body: json({}) })).status).toBe(404);
    expect((await req(`/api/brownfield/${oppId}/eval-criteria/reconcile`)).status).toBe(401);
    const g = (await (await req(`/api/brownfield/${oppId}/eval-criteria/reconcile`, { headers: { cookie } })).json()) as any;
    expect(g.data.inSync).toBe(true);
  });
});

describe("S7 readiness (2026-10-20 decider) — the readiness route/notice are retired with the S7 check", () => {
  test("the readiness route and the ShortlistSection notice no longer exist; the lib helper stays as read-only legacy", () => {
    expect(existsSync(join(PROJECT_ROOT, "app/web-next/app/api/brownfield/[oppId]/capability-readiness/route.ts"))).toBe(false);
    expect(existsSync(join(PROJECT_ROOT, "app/web-next/components/stages/brownfield/CapabilityReadinessNotice.tsx"))).toBe(false);
    expect(read("app/web-next/components/stages/brownfield/ShortlistSection.tsx")).not.toContain("CapabilityReadinessNotice");
    expect(read("app/web-next/lib/brownfield-capability-judgement.ts")).toContain("export function capabilityReadiness");
  });

  test("source: readiness and promotion code never read judgements as a gate or a cap", () => {
    const repo = read("db/repositories/project.repository.ts");
    expect(repo).not.toContain("brownfield_target_capability_judgement");
    const gate = read("app/web-next/app/api/opportunities/[id]/gate-decisions/route.ts");
    expect(gate).not.toContain("capability-judgement");
    const lib = read("app/web-next/lib/brownfield-capability-judgement.ts");
    expect(lib).toContain("\uac8c\uc774\ud2b8\ub098 \ub4f1\uae09\uc744 \ub9c9\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4");
  });
});

describe("deleting a target and the S8 bridge", () => {
  test("deleting a target removes its judgements (no FK error); other targets keep theirs", async () => {
    const extra = ulid();
    db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [extra, oppId, "Target Extra", "shortlisted", 9, NOW, NOW]);
    const v = await get(extra);
    await put(extra, [judgePatch(v, "a")]);
    expect(storedRows(extra)).toHaveLength(1);
    const del = await req(`/api/brownfield/targets/${extra}`, { method: "DELETE", headers: { cookie } });
    expect(del.status).toBe(200);
    expect(storedRows(extra)).toHaveLength(0);
    expect(storedRows(t1).length).toBeGreaterThan(0);
  });

  test("target detail carries the reconcile detection for the eval tab", async () => {
    const d = (await (await req(`/api/brownfield/targets/${t1}`, { headers: { cookie } })).json()) as any;
    expect(d.data.reconcile.inSync).toBe(true);
    expect(d.data.evalItems.filter((i: any) => i.category === "technical" && i.source === "seeded").map((i: any) => i.seed_ref ?? i.label)).toBeDefined();
  });

  test("UI source (2026-10-20 decider): the S7 per-target capability check is retired — no component, not mounted; S8 panel has no inputs and points at S9", () => {
    expect(existsSync(join(PROJECT_ROOT, "app/web-next/components/brownfield-target/TargetCapabilityCheck.tsx"))).toBe(false);
    expect(read("app/web-next/components/brownfield-target/TargetEvalTab.tsx")).not.toContain("TargetCapabilityCheck");
    const s8 = read("app/web-next/components/stages/CapabilityAttainabilityPanel.tsx");
    expect(s8).not.toContain("CapabilityJudgementEditor");
    expect(s8).not.toContain("<input");
    expect(s8).toContain('t("judgedInS7")');
    expect(read("app/web-next/components/stages/brownfield/ShortlistSection.tsx")).not.toContain("CapabilityReadinessNotice"); // retired 2026-10-20
  });
});
