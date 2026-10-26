// @version 1.0.0
/**
 * ADR-0186 P1 D5 - `na` on a MANDATORY DD checklist item: reason required (waiver family),
 * substance profile (rationale family), second-person confirmation (confirm-na route, cookie
 * session + grant), and the completion count (unconfirmed mandatory na = pending under enforce).
 */
import { test, expect, beforeAll, afterAll, afterEach, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-na-confirmation.sqlite");
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
const { issueHumanRoleGrant } = await import("../../db/lib/human-roles.ts");
const { gateIntegrityEnvName, GATE_INTEGRITY_FAMILIES } = await import("../../app/web-next/lib/gate-integrity-flags.ts");
const { resetRateLimits } = await import("../../app/web-next/lib/gate-integrity.ts");
const { ddCompletionSummary, isMandatoryChecklistItem } = await import("../../app/web-next/lib/dd-checklist-tailor.ts");
const { getChecklistItems } = await import("../../app/web-next/lib/library.ts");
const S = await import("./_gate-integrity-support.ts");

const MAKER = "na-maker";
const CHECKER = "na-checker";
const NOGRANT = "na-nogrant";
const cookies: Record<string, string> = {};
let projectId = "";

const CHECKLIST = "chk-deal-shape-presigning-checklist"; // not a greenfield workspace checklist, so the sub-track na rule stays out of the way
const FIN = "chk-financial-dd-checklist"; // counted by the completion summary
const items = getChecklistItems(CHECKLIST) ?? [];
const MANDATORY = items.filter((i) => i.mandatory).map((i) => i.id);
const OPTIONAL = items.find((i) => !i.mandatory)?.id ?? null;
if (!OPTIONAL) throw new Error("fixture checklist needs an optional item");
const MANDATORY_FIN = (getChecklistItems("chk-financial-dd-checklist") ?? []).filter((i) => i.mandatory).map((i) => i.id);
const GOOD_NOTE = "대상 회사는 지주회사로 연결 재무제표만 존재하여 이 항목은 적용되지 않음";

const flagNames = GATE_INTEGRITY_FAMILIES.map(gateIntegrityEnvName);
afterEach(() => { for (const n of flagNames) delete process.env[n]; resetRateLimits(); });

async function login(userId: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password: `pw-${userId}-12345` }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
beforeAll(async () => {
  for (const u of [MAKER, CHECKER, NOGRANT]) {
    await createUser(db, { userId: u, role: "analyst", password: `pw-${u}-12345`, createdBy: "test", now: S.NOW });
    approveUser(db, { userId: u, approvedBy: "test", now: S.NOW });
  }
  await createUser(db, { userId: "na-admin", role: "admin", password: "pw-na-admin-12345", createdBy: "test", now: S.NOW });
  approveUser(db, { userId: "na-admin", approvedBy: "test", now: S.NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  for (const u of [MAKER, CHECKER, NOGRANT]) cookies[u] = await login(u);
  projectId = S.seedReadyProject(db, MAKER).projectId;
  for (const u of [CHECKER, NOGRANT]) db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [projectId, u, "lead", "test", S.NOW, "na test"]);
  issueHumanRoleGrant(db, { userId: CHECKER, roleKey: "entity-ic-reviewer", grantedBy: "na-admin", now: S.NOW });
  // The maker is also a grant holder, to prove that holding the grant does not let them confirm their own na.
  issueHumanRoleGrant(db, { userId: MAKER, roleKey: "group-ic-reviewer", grantedBy: "na-admin", now: S.NOW });
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

let mi = 0;
const nextMandatory = () => {
  const id = MANDATORY[mi++];
  if (!id) throw new Error("mandatory pool exhausted");
  return id;
};
const putState = (itemId: string, body: Record<string, unknown>, who = MAKER, checklist = CHECKLIST) =>
  nextRequest(`/api/projects/${projectId}/dd-checklist/state`, { method: "PUT", headers: { cookie: cookies[who] }, body: JSON.stringify({ checklist_id: checklist, item_id: itemId, ...body }) });
const confirm = (itemId: string, who: string, init: RequestInit = {}, extra: Record<string, unknown> = {}, checklist = CHECKLIST) =>
  nextRequest(`/api/projects/${projectId}/dd-checklist/state/confirm-na`, { method: "POST", headers: { cookie: cookies[who] }, body: JSON.stringify({ checklist_id: checklist, item_id: itemId, ...extra }), ...init });
const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const stateRow = (itemId: string) => db.query("SELECT status, note, assessed_by, na_confirmed_by, na_confirmed_at FROM project_checklist_item_state WHERE project_id = ? AND checklist_id = ? AND item_id = ?").get(projectId, CHECKLIST, itemId) as { status: string; note: string | null; assessed_by: string; na_confirmed_by: string | null; na_confirmed_at: string | null } | null;

describe("na on a mandatory item - recording", () => {
  test("the fixture checklist has mandatory and optional items", () => {
    expect(MANDATORY.length).toBeGreaterThan(5);
    expect(isMandatoryChecklistItem(CHECKLIST, MANDATORY[0])).toBe(true);
    expect(OPTIONAL).not.toBeNull();
  });

  test("off: legacy - na without a note records", async () => {
    const it = nextMandatory();
    expect((await putState(it, { status: "na" })).status).toBe(200);
    expect(stateRow(it)!.status).toBe("na");
  });

  test("enforce: no note -> 400 na_reason_required; a thin note -> 422 (rationale family); a real reason records", async () => {
    process.env[gateIntegrityEnvName("waiver")] = "enforce";
    process.env[gateIntegrityEnvName("rationale")] = "enforce";
    const it = nextMandatory();
    const none = await putState(it, { status: "na" });
    expect(none.status).toBe(400);
    expect(await errCode(none)).toBe("na_reason_required");
    const thin = await putState(it, { status: "na", note: "해당 없음" });
    expect(thin.status).toBe(422);
    expect(await errCode(thin)).toBe("rationale_insufficient");
    expect(stateRow(it)).toBeNull(); // nothing was written
    const good = await putState(it, { status: "na", note: GOOD_NOTE });
    expect(good.status).toBe(200);
    expect(stateRow(it)).toMatchObject({ status: "na", note: GOOD_NOTE, na_confirmed_by: null });
  });

  test("enforce: an optional item's na needs no reason; pass/fail on a mandatory item is not touched", async () => {
    process.env[gateIntegrityEnvName("waiver")] = "enforce";
    if (OPTIONAL) expect((await putState(OPTIONAL, { status: "na" })).status).toBe(200);
    expect((await putState(nextMandatory(), { status: "fail" })).status).toBe(200);
  });

  test("shadow: records, and the missing reason is a would-block row", async () => {
    process.env[gateIntegrityEnvName("waiver")] = "shadow";
    const it = nextMandatory();
    expect((await putState(it, { status: "na" })).status).toBe(200);
    expect(db.query("SELECT COUNT(*) c FROM audit_log WHERE action = 'gate_integrity.would_block:na_reason_required'").get().c).toBeGreaterThanOrEqual(1);
  });
});

describe("second-person confirmation", () => {
  async function markNa(): Promise<string> {
    const it = nextMandatory();
    expect((await putState(it, { status: "na", note: GOOD_NOTE })).status).toBe(200);
    return it;
  }

  test("a different grant holder confirms; the confirmation is recorded and audited", async () => {
    const it = await markNa();
    const res = await confirm(it, CHECKER);
    expect(res.status).toBe(200);
    expect(stateRow(it)).toMatchObject({ na_confirmed_by: CHECKER });
    expect(stateRow(it)!.na_confirmed_at).not.toBeNull();
    expect(db.query("SELECT COUNT(*) c FROM audit_log WHERE action = 'dd_checklist.na_confirm' AND target = ?").get(`${projectId}:${CHECKLIST}:${it}`)).toEqual({ c: 1 });
    expect((await confirm(it, CHECKER)).status).toBe(409); // already confirmed
  });

  test("the person who marked na cannot confirm it, even holding a grant", async () => {
    const it = await markNa();
    const res = await confirm(it, MAKER);
    expect(res.status).toBe(403);
    expect(await errCode(res)).toBe("confirmer_must_differ");
    expect(stateRow(it)!.na_confirmed_by).toBeNull();
  });

  test("no grant -> 403 human_role_required (deny-by-default)", async () => {
    const it = await markNa();
    const res = await confirm(it, NOGRANT);
    expect(res.status).toBe(403);
    expect(await errCode(res)).toBe("human_role_required");
  });

  test("bearer tokens cannot confirm (403 human_only), even for a grant holder", async () => {
    const it = await markNa();
    const { token } = issueApiToken(db, { userId: CHECKER, label: "na-test", scopes: ["read", "write"], now: S.NOW });
    const res = await nextRequest(`/api/projects/${projectId}/dd-checklist/state/confirm-na`, {
      method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ checklist_id: CHECKLIST, item_id: it }),
    });
    expect(res.status).toBe(403);
    expect(await errCode(res)).toBe("human_only");
  });

  test("only an na row can be confirmed, only on a mandatory item; unknown rows are 404", async () => {
    const passItem = nextMandatory();
    db.run("INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, assessed_by, assessed_at) VALUES (?,?,?,?,?,?,?)", [`pass-${passItem}`, projectId, CHECKLIST, passItem, "pass", MAKER, S.NOW]);
    expect((await confirm(passItem, CHECKER)).status).toBe(409); // status pass
    if (OPTIONAL) {
      expect((await putState(OPTIONAL, { status: "na" })).status).toBe(200);
      const res = await confirm(OPTIONAL, CHECKER);
      expect(res.status).toBe(409);
      expect(await errCode(res)).toBe("confirmation_not_required");
    }
    expect((await confirm("no-such-item", CHECKER)).status).toBe(404);
    expect((await confirm(passItem, NOGRANT, {}, {})).status).toBe(403);
  });

  test("re-assessing the row clears the confirmation (a changed judgement never inherits a confirmer)", async () => {
    const it = await markNa();
    expect((await confirm(it, CHECKER)).status).toBe(200);
    expect((await putState(it, { status: "na", note: GOOD_NOTE })).status).toBe(200);
    expect(stateRow(it)!.na_confirmed_by).toBeNull();
    expect(stateRow(it)!.na_confirmed_at).toBeNull();
  });
});

describe("completion count", () => {
  test("enforce: an unconfirmed mandatory na counts as pending; confirming removes it; off/shadow keep the old count", async () => {
    const p2 = S.seedReadyProject(db, MAKER).projectId; // its own project: no other unconfirmed na rows
    db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [p2, CHECKER, "lead", "test", S.NOW, "na test"]);
    const base = ddCompletionSummary(p2).pending;
    // Under the greenfield work scope some items are out of scope (never counted); probe for a judgeable mandatory item.
    process.env[gateIntegrityEnvName("waiver")] = "enforce";
    let it: string | null = null;
    for (const cand of MANDATORY_FIN) {
      db.run("UPDATE project_checklist_item_state SET status = 'na' WHERE project_id = ? AND checklist_id = ? AND item_id = ?", [p2, FIN, cand]);
      if (ddCompletionSummary(p2).pending > base) { it = cand; break; }
      db.run("UPDATE project_checklist_item_state SET status = 'pass' WHERE project_id = ? AND checklist_id = ? AND item_id = ?", [p2, FIN, cand]);
    }
    expect(it).not.toBeNull();
    db.run("UPDATE project_checklist_item_state SET status = 'pass' WHERE project_id = ? AND checklist_id = ? AND item_id = ?", [p2, FIN, it]);
    delete process.env[gateIntegrityEnvName("waiver")];

    const put = (status: string) => nextRequest(`/api/projects/${p2}/dd-checklist/state`, { method: "PUT", headers: { cookie: cookies[MAKER] }, body: JSON.stringify({ checklist_id: FIN, item_id: it, status, note: GOOD_NOTE }) });
    expect((await put("na")).status).toBe(200);
    expect(ddCompletionSummary(p2).pending).toBe(base); // off
    process.env[gateIntegrityEnvName("waiver")] = "shadow";
    expect(ddCompletionSummary(p2).pending).toBe(base);
    process.env[gateIntegrityEnvName("waiver")] = "enforce";
    expect(ddCompletionSummary(p2).pending).toBe(base + 1);
    const res = await nextRequest(`/api/projects/${p2}/dd-checklist/state/confirm-na`, { method: "POST", headers: { cookie: cookies[CHECKER] }, body: JSON.stringify({ checklist_id: FIN, item_id: it }) });
    expect(res.status).toBe(200);
    expect(ddCompletionSummary(p2).pending).toBe(base);
  });
});

describe("item validation precedes integrity logic", () => {
  test("shadow: 1,000 fake checklist / custom ids are 404 and write no audit rows", async () => {
    process.env[gateIntegrityEnvName("waiver")] = "shadow";
    process.env[gateIntegrityEnvName("rationale")] = "shadow";
    const before = (db.query("SELECT COUNT(*) c FROM audit_log WHERE action LIKE 'gate_integrity.would_block:%'").get() as { c: number }).c;
    for (let i = 0; i < 1000; i++) {
      const checklist = i % 2 ? `custom:fake${i}` : CHECKLIST;
      const res = await putState(`fake-${i}`, { status: "na" }, MAKER, checklist);
      if (i < 20) expect(res.status).toBe(404);
    }
    const after = (db.query("SELECT COUNT(*) c FROM audit_log WHERE action LIKE 'gate_integrity.would_block:%'").get() as { c: number }).c;
    expect(after - before).toBe(0);
  });
});
