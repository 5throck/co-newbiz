// @version 1.0.0
/**
 * ADR-0186 P5 (backend part 1): divergence on every decision, the demo seed through the contract (O-5), the
 * re-confirmation requirement (O-6, migration 0179) and the read-only shadow review report.
 */
import { test, expect, beforeAll, afterAll, afterEach, describe } from "bun:test";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-gate-integrity-p5.sqlite");
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
const { resetRateLimits } = await import("../../app/web-next/lib/gate-integrity.ts");
const { recordGateDecisionRow } = await import("../../app/web-next/lib/gate-decision-contract.ts");
const { countersignDecision } = await import("../../app/web-next/lib/gate-countersign.ts");

const { recordWaccSession, setProjectWaccSubject } = await import("../../db/lib/wacc.ts");
const { reconfirmStatus, createRequirement, ReconfirmError } = await import("../../app/web-next/lib/reconfirm.ts");
const { runReconfirmRequirement } = await import("../../scripts/co-newbiz/reconfirm-requirement.ts");
const { buildShadowReport, renderHuman } = await import("../../scripts/co-newbiz/gate-integrity-shadow-report.ts");
const { appendAudit } = await import("../../db/lib/access-control.ts");
const S = await import("./_gate-integrity-support.ts");

const ADMIN = "p5-admin";
const MAKER = "p5-maker";
const CHECKER = "p5-checker"; // entity-ic-reviewer
const GROUP = "p5-group"; // group-ic-reviewer
const PLAIN = "p5-plain"; // member, no grant
const cookies: Record<string, string> = {};
const flagNames = GATE_INTEGRITY_FAMILIES.map(gateIntegrityEnvName);

afterEach(() => {
  for (const n of flagNames) delete process.env[n];
  clearSnapshotCache();
  resetRateLimits();
});

async function login(userId: string, role: "analyst" | "admin"): Promise<string> {
  await createUser(db, { userId, role, password: `pw-${userId}-123456`, createdBy: "test", now: S.NOW });
  approveUser(db, { userId, approvedBy: "test", now: S.NOW });
  db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = ?", [userId]);
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password: `pw-${userId}-123456` }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  for (const [u, r] of [[ADMIN, "admin"], [MAKER, "analyst"], [CHECKER, "analyst"], [GROUP, "analyst"], [PLAIN, "analyst"]] as const) cookies[u] = await login(u, r);
  await S.grantRole(db, CHECKER, "entity-ic-reviewer", ADMIN);
  await S.grantRole(db, GROUP, "group-ic-reviewer", ADMIN);
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

const dataOf = async <T = any>(res: Response) => ((await res.json()) as { data: T; meta: Record<string, any> }).data;
const metaOf = async (res: Response) => ((await res.json()) as { meta: Record<string, any> }).meta;
const errOf = async (res: Response) => ((await res.json()) as { error: { code: string; details?: Record<string, any> } }).error;
const count = (sql: string, ...args: unknown[]) => (db.query(sql).get(...(args as any[])) as { c: number }).c;
const post = (path: string, body: Record<string, unknown>, who: string) => nextRequest(path, { method: "POST", headers: { cookie: cookies[who] }, body: JSON.stringify(body) });
const get = (path: string, who: string) => nextRequest(path, { headers: { cookie: cookies[who] } });
const REASON = "법인과 그룹의 심의 기록을 확인했고 재확인 항목이 모두 충족되었음을 확인함";
const NOW_ISO = () => new Date().toISOString();

function brief(projectId: string, gate: string, recommended: string): string {
  const id = ulid();
  db.run("INSERT INTO gate_brief_record (id, entity_type, entity_id, gate, recommended, confidence, source, generated_by, generated_at) VALUES (?,?,?,?,?,?,?,?,?)", [id, "project", projectId, gate, recommended, "high", "synthesis", MAKER, NOW_ISO()]);
  return id;
}

// ── 1. divergence is stored on every decision, HOLD / KILL never need a reason ───────────────────────────────
describe("divergence (D9) on every decision", () => {
  test("GO / HOLD / KILL against a different recommendation: the pair is stored, the reason is optional for HOLD and KILL, histories expose it", async () => {
    process.env[gateIntegrityEnvName("divergence")] = "enforce";
    const { projectId } = S.seedReadyProject(db, MAKER);
    S.addMember(db, projectId, MAKER, "lead");
    const hold = await post(`/api/projects/${projectId}/gate-decisions`, { gate: "fs", decision: "hold", rationale: "보완 자료 대기", missing_artifacts: ["재무 모델 검증"], brief_id: brief(projectId, "fs", "go") }, MAKER);
    expect(hold.status).toBe(201);
    const kill = await post(`/api/projects/${projectId}/gate-decisions`, { gate: "fs", decision: "kill", rationale: "수익성이 기준에 못 미침", learning_capture: "수요 추정을 단일 출처에 의존했다", brief_id: brief(projectId, "fs", "go"), divergence_reason: "AI는 진행을 권고했으나 허들 미달이 확인됨" }, MAKER);
    expect(kill.status).toBe(201);
    const killNoReason = await post(`/api/projects/${projectId}/gate-decisions`, { gate: "fs", decision: "kill", rationale: "다시 검토한 결과 중단", learning_capture: "허들 가정을 먼저 확정해야 한다", brief_id: brief(projectId, "fs", "go") }, MAKER);
    expect(killNoReason.status).toBe(201);
    const hist = (await dataOf<any>(await get(`/api/projects/${projectId}/gate-decisions`, MAKER))).history as any[];
    const rows = hist.filter((h) => h.gate === "fs");
    expect(rows.map((r) => r.decision).sort()).toEqual(["hold", "kill", "kill"]);
    for (const r of rows) expect(r.ai_recommended_decision).toBe("go");
    expect(rows.find((r) => r.decision === "hold").divergence_reason).toBeNull();
    const killReasons = rows.filter((r) => r.decision === "kill").map((r) => r.divergence_reason);
    expect(killReasons).toContain(null);
    expect(killReasons).toContain("AI는 진행을 권고했으나 허들 미달이 확인됨");
    // a GO against the recommendation is still blocked without a reason (the family blocks GO only)
    const fresh = S.seedReadyProject(db, MAKER).projectId;
    S.addMember(db, fresh, MAKER, "lead");
    const go = await post(`/api/projects/${fresh}/gate-decisions`, { gate: "fs", decision: "go", rationale: S.GENUINE, brief_id: brief(fresh, "fs", "hold") }, MAKER);
    expect(go.status).toBe(422);
    expect((await errOf(go)).code).toBe("divergence_reason_required");
  });

  test("a decision with no brief stores no recommendation (nothing required)", async () => {
    process.env[gateIntegrityEnvName("divergence")] = "enforce";
    const { projectId } = S.seedReadyProject(db, MAKER);
    S.addMember(db, projectId, MAKER, "lead");
    const r = await post(`/api/projects/${projectId}/gate-decisions`, { gate: "fs", decision: "go", rationale: S.GENUINE }, MAKER);
    expect([201, 409]).toContain(r.status); // other contract rules may apply; divergence must not
    if (r.status === 409) expect((await errOf(r)).code).not.toBe("divergence_reason_required");
  });
});

// ── 3. re-confirmation requirement ────────────────────────────────────────────────────────────────────────────
describe("re-confirmation requirement (O-6, migration 0179)", () => {
  function legacyProject(): string {
    const r = S.seedIcReadyProject(db, MAKER);
    for (const u of [MAKER, CHECKER, GROUP, PLAIN]) S.addMember(db, r.projectId, u, u === MAKER ? "lead" : "member");
    return r.projectId;
  }
  const legacyGo = (pid: string, gate: string, decision: "go" | "hold" | "kill" = "go") =>
    recordGateDecisionRow(db, {
      entityType: "project", entityId: pid, gate, decision, storedRationale: S.IC_RATIONALE,
      missingArtifactsJson: decision === "hold" ? JSON.stringify(["x"]) : null, actor: MAKER, gateEvaluationId: null,
      learningCapture: decision === "kill" ? "lessons captured for the next round" : null, judgementConfirmationsJson: null, extras: null, now: NOW_ISO(),
    });

  test("opening: admin only, cookie session, one open requirement per project, validated items, audited", async () => {
    const pid = legacyProject();
    expect((await post(`/api/projects/${pid}/reconfirm`, { reason: REASON }, MAKER)).status).toBe(403);
    expect((await post(`/api/projects/${pid}/reconfirm`, { reason: "" }, ADMIN)).status).toBe(400);
    expect((await post(`/api/projects/${pid}/reconfirm`, { reason: REASON, items: ["nope"] }, ADMIN)).status).toBe(400);
    expect((await post(`/api/projects/PRJ-NOPE/reconfirm`, { reason: REASON }, ADMIN)).status).toBe(404);
    const ok = await post(`/api/projects/${pid}/reconfirm`, { reason: REASON }, ADMIN);
    expect(ok.status).toBe(201);
    expect((await dataOf<any>(ok)).items).toEqual(["wacc_confirmed", "ic_countersign", "na_review"]);
    expect((await post(`/api/projects/${pid}/reconfirm`, { reason: REASON }, ADMIN)).status).toBe(409);
    expect(count("SELECT COUNT(*) c FROM audit_log WHERE action = 'reconfirm.create' AND target LIKE ?", `${pid}:%`)).toBe(1);
    const st = await dataOf<any>(await get(`/api/projects/${pid}/reconfirm`, PLAIN));
    expect(st).toMatchObject({ open: true, unmet: ["wacc_confirmed", "ic_countersign"], clearable: false });
    expect((await dataOf<any>(await get(`/api/projects/${legacyProject()}/reconfirm`, PLAIN))).open).toBe(false);
  });

  test("while open: a new GO and a case adoption are 409 reconfirmation_required (flags off), HOLD / KILL are not; view, brief and IC package warn", async () => {
    const pid = legacyProject();
    createRequirement(db, { projectId: pid, items: ["wacc_confirmed", "ic_countersign", "na_review"], reason: REASON, by: ADMIN, now: NOW_ISO() });
    const fsBefore = count("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ? AND gate = 'fs'", pid);
    const blocked = await post(`/api/projects/${pid}/gate-decisions`, { gate: "fs", decision: "go", rationale: S.GENUINE }, MAKER);
    expect(blocked.status).toBe(409);
    const err = await errOf(blocked);
    expect(err.code).toBe("reconfirmation_required");
    expect(err.details?.unmet).toEqual(["wacc_confirmed", "ic_countersign"]);
    expect(count("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ? AND gate = 'fs'", pid)).toBe(fsBefore);
    expect((await post(`/api/projects/${pid}/gate-decisions`, { gate: "fs", decision: "hold", rationale: "보완 자료 대기", missing_artifacts: ["재무 모델"] }, MAKER)).status).toBe(201);
    const adopt = await post(`/api/projects/${pid}/business-case/adopt`, { model_id: "whatever" }, MAKER);
    expect(adopt.status).toBe(409);
    expect((await errOf(adopt)).code).toBe("reconfirmation_required");
    // warnings, never refusals
    const view = await get(`/api/projects/${pid}/gate-decisions`, MAKER);
    expect(view.status).toBe(200);
    expect((await metaOf(view)).reconfirmation).toMatchObject({ code: "reconfirmation_required", unmet: ["wacc_confirmed", "ic_countersign"] });
    const brief = await post(`/api/projects/${pid}/gate-brief`, { gate: "fs" }, MAKER);
    expect(brief.status).toBe(200);
    expect((await dataOf<any>(brief)).reconfirmation).toMatchObject({ code: "reconfirmation_required" });
    const pkg = await get(`/api/projects/${pid}/ic-package`, MAKER);
    expect(pkg.status).toBe(200);
    expect((await dataOf<any>(pkg)).reconfirmation).toMatchObject({ code: "reconfirmation_required" });
    // a project without a requirement is untouched
    const other = legacyProject();
    expect((await post(`/api/projects/${other}/gate-decisions`, { gate: "fs", decision: "go", rationale: S.GENUINE }, MAKER)).status).not.toBe(409);
  });

  test("items show satisfied from the data; an IC-gate GO passes when only ic_countersign is unmet (the re-decision the countersign needs)", () => {
    const pid = legacyProject();
    createRequirement(db, { projectId: pid, items: ["wacc_confirmed", "ic_countersign", "na_review"], reason: REASON, by: ADMIN, now: NOW_ISO() });
    expect(legacyGo(pid, "entity_ic").ok).toBe(false); // wacc still unconfirmed
    setProjectWaccSubject(db, pid, "project_newco", "프로젝트 신설 법인 기준으로 확정", MAKER);
    recordWaccSession(db, { projectId: pid, wacc: 0.09, hurdleIrr: 0.12, rationale: "사람이 확정", actor: MAKER, now: NOW_ISO() });
    expect(reconfirmStatus(db, pid)!.unmet).toEqual(["ic_countersign"]);
    expect(legacyGo(pid, "fs").ok).toBe(false); // not an IC gate: still blocked
    expect(legacyGo(pid, "entity_ic", "hold").ok).toBe(true); // HOLD never blocked
    const r = legacyGo(pid, "entity_ic");
    expect(r.ok).toBe(true);
  });

  test("clearing: grant holder only, never the IC recorder, only when every item is satisfied, with an audited reason; no other path clears", async () => {
    const pid = legacyProject();
    createRequirement(db, { projectId: pid, items: ["wacc_confirmed", "ic_countersign", "na_review"], reason: REASON, by: ADMIN, now: NOW_ISO() });
    setProjectWaccSubject(db, pid, "project_newco", "프로젝트 신설 법인 기준으로 확정", MAKER);
    recordWaccSession(db, { projectId: pid, wacc: 0.09, hurdleIrr: 0.12, rationale: "사람이 확정", actor: MAKER, now: NOW_ISO() });
    const decision = legacyGo(pid, "entity_ic");
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    const clear = (who: string, reason = REASON) => post(`/api/projects/${pid}/reconfirm/clear`, { reason }, who);
    expect((await clear(PLAIN)).status).toBe(403); // no grant
    expect((await errOf(await clear(PLAIN))).code).toBe("human_role_required");
    const unmet = await clear(CHECKER);
    expect(unmet.status).toBe(409);
    expect((await errOf(unmet)).code).toBe("reconfirm_items_unmet");
    // countersign by a different grant holder satisfies the item
    const cs = countersignDecision(db, { projectId: pid, decisionId: decision.id, checkerId: CHECKER, decision: "approved", reason: "법인 심의 기록과 근거를 확인하고 승인함", conditions: [], now: NOW_ISO() });
    expect(cs.ok).toBe(true);
    expect(reconfirmStatus(db, pid)!).toMatchObject({ unmet: [], clearable: true });
    // the IC recorder cannot clear even with a grant
    await S.grantRole(db, MAKER, "entity-ic-reviewer", ADMIN);
    const mk = await clear(MAKER);
    expect(mk.status).toBe(403);
    expect((await errOf(mk)).code).toBe("reconfirm_clearer_is_maker");
    expect((await clear(CHECKER, "ok")).status).toBe(422); // weak reason
    expect(count("SELECT COUNT(*) c FROM audit_log WHERE action LIKE 'reconfirm.clear.refused:%'")).toBeGreaterThanOrEqual(2);
    const done = await clear(CHECKER);
    expect(done.status).toBe(201);
    expect(count("SELECT COUNT(*) c FROM audit_log WHERE action = 'reconfirm.clear' AND actor_user_id = ?", CHECKER)).toBe(1);
    expect((await dataOf<any>(await get(`/api/projects/${pid}/reconfirm`, MAKER))).open).toBe(false);
    expect((await clear(CHECKER)).status).toBe(409);
    expect((await errOf(await clear(CHECKER))).code).toBe("reconfirm_not_open");
    // a cleared row is immutable and never deleted; a new GO is no longer refused for this reason
    expect(() => db.run("DELETE FROM project_reconfirm_requirement WHERE project_id = ?", [pid])).toThrow();
    expect(() => db.run("UPDATE project_reconfirm_requirement SET clear_reason = 'x' WHERE project_id = ?", [pid])).toThrow();
    expect(legacyGo(pid, "group_ic").ok).toBe(true);
  });

  test("an unconfirmed mandatory na row keeps na_review unmet until a second person confirms it", () => {
    const pid = legacyProject();
    const row = db.query("SELECT id FROM project_checklist_item_state WHERE project_id = ? AND checklist_id = 'chk-commercial-dd-checklist' LIMIT 1").get(pid) as { id: string };
    db.run("UPDATE project_checklist_item_state SET status = 'na', na_confirmed_by = NULL WHERE id = ?", [row.id]);
    createRequirement(db, { projectId: pid, items: ["na_review"], reason: REASON, by: ADMIN, now: NOW_ISO() });
    expect(reconfirmStatus(db, pid)!.unmet).toEqual(["na_review"]);
    db.run("UPDATE project_checklist_item_state SET na_confirmed_by = ?, na_confirmed_at = ? WHERE id = ?", [CHECKER, NOW_ISO(), row.id]);
    expect(reconfirmStatus(db, pid)!.unmet).toEqual([]);
  });

  test("the library and the script share the rules; the script is a dry run unless --apply and needs an administrator", () => {
    const pid = legacyProject();
    expect(() => createRequirement(db, { projectId: pid, items: [], reason: REASON, by: ADMIN, now: NOW_ISO() })).toThrow(ReconfirmError);
    expect(runReconfirmRequirement({ dbPath: TEST_DB_PATH, project: pid, by: MAKER, apply: true }).applied).toBe(false); // not an admin
    const dry = runReconfirmRequirement({ dbPath: TEST_DB_PATH, project: pid, by: ADMIN, apply: false });
    expect(dry.applied).toBe(false);
    expect(dry.message).toContain("dry run");
    expect(reconfirmStatus(db, pid)).toBeNull();
    const done = runReconfirmRequirement({ dbPath: TEST_DB_PATH, project: pid, by: ADMIN, apply: true });
    expect(done.applied).toBe(true);
    expect(reconfirmStatus(db, pid)?.unmet.length).toBeGreaterThan(0);
    expect(runReconfirmRequirement({ dbPath: TEST_DB_PATH, project: pid, by: ADMIN, apply: true }).applied).toBe(false); // already open
    expect(runReconfirmRequirement({ dbPath: TEST_DB_PATH, project: "PRJ-NOPE", by: ADMIN, apply: true }).message).toContain("not found");
  });
});

// ── 4. shadow review report ───────────────────────────────────────────────────────────────────────────────────
describe("shadow review report", () => {
  test("summarises would-block and refusal rows per family / code / day / entity and reports readiness; read-only", async () => {
    const t = (day: string) => `${day}T10:00:00.000Z`;
    appendAudit(db, { actor: MAKER, action: "gate_integrity.would_block:ack_required", target: "project:PRJ-AAA:dd", now: t("2026-10-20") });
    appendAudit(db, { actor: MAKER, action: "gate_integrity.would_block:ack_required", target: "project:PRJ-AAA:dd", now: t("2026-10-21") });
    appendAudit(db, { actor: MAKER, action: "gate_integrity.would_block:wacc_unconfirmed", target: "project:PRJ-BBB:fs", now: t("2026-10-21") });
    appendAudit(db, { actor: PLAIN, action: "gate_decision.countersign.refused:checker_must_differ", target: "PRJ-AAA:entity_ic:dec1", now: t("2026-10-21") });
    appendAudit(db, { actor: PLAIN, action: "gate_integrity.would_block:ack_required", target: "project:PRJ-OUT:dd", now: t("2026-09-01") }); // outside the window
    // legacy unconfirmed mandatory na on a fresh project
    const pid = S.seedIcReadyProject(db, MAKER).projectId;
    const naRow = db.query("SELECT id FROM project_checklist_item_state WHERE project_id = ? AND checklist_id = 'chk-technical-dd-checklist' LIMIT 1").get(pid) as { id: string };
    db.run("UPDATE project_checklist_item_state SET status = 'na', na_confirmed_by = NULL WHERE id = ?", [naRow.id]);
    const before = count("SELECT COUNT(*) c FROM audit_log");
    const ro = new (await import("bun:sqlite")).Database(TEST_DB_PATH, { readonly: true });
    const report = buildShadowReport(ro, { from: "2026-10-15T00:00:00.000Z", to: "2026-10-22T00:00:00.000Z" });
    ro.close();
    expect(report.totals).toEqual({ would_block: 3, refused: 1 });
    const fam = Object.fromEntries(report.by_family.map((f) => [f.family, f]));
    expect(fam.snapshot_ack.codes).toEqual({ ack_required: 2 });
    expect(fam.wacc.would_block).toBe(1);
    expect(fam.maker_checker.refused).toBe(0 + 1 - 0); // checker_must_differ
    expect(report.by_day.map((d) => d.day)).toEqual(["2026-10-20", "2026-10-21"]);
    expect(report.rows.find((r) => r.code === "ack_required" && r.day === "2026-10-21")).toMatchObject({ entity: "project:PRJ-AAA:dd", actor: MAKER, count: 1 });
    expect(report.readiness.grant_holders!["entity-ic-reviewer"]).toContain(CHECKER);
    expect(report.readiness.second_grant_holder_ready).toBe(true);
    expect(report.readiness.legacy_unconfirmed_mandatory_na!.rows).toBeGreaterThanOrEqual(1);
    expect(report.readiness.legacy_unconfirmed_mandatory_na!.projects.some((p) => p.project_id === pid)).toBe(true);
    expect(renderHuman(report)).toContain("Gate-integrity shadow report");
    expect(count("SELECT COUNT(*) c FROM audit_log")).toBe(before); // read-only: no audit rows appended
    // CLI: --json and the human output
    const proc = Bun.spawnSync(["bun", join(PROJECT_ROOT, "scripts/co-newbiz/gate-integrity-shadow-report.ts"), "--db-path", TEST_DB_PATH, "--from", "2026-10-15T00:00:00.000Z", "--to", "2026-10-22T00:00:00.000Z", "--json"], { env: { ...process.env } });
    expect(proc.exitCode).toBe(0);
    expect(JSON.parse(proc.stdout.toString()).totals).toEqual({ would_block: 3, refused: 1 });
    const human = Bun.spawnSync(["bun", join(PROJECT_ROOT, "scripts/co-newbiz/gate-integrity-shadow-report.ts"), "--db-path", TEST_DB_PATH, "--days", "400"], { env: { ...process.env } });
    expect(human.stdout.toString()).toContain("Readiness");
  });
});
