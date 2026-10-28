// @version 1.0.0
// ADR-0187 P3 (finding H9): machine gate consumers for chk-legal-regulatory (Screening),
// chk-greenfield-feasibility and chk-site-selection (Pre-FS) - the record, the
// compliance-engine requirement semantics, the off/shadow/enforce rollout, the S4 / S5
// engine blockers and the REST route.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { load as parseYaml } from "js-yaml";

const TEST_DB_PATH = "db/data/test-checklist-gate-consumers.sqlite";
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
const { AGENT_KEYS } = await import("../../app/web-next/lib/agent-registry.generated.ts");
const c = await import("../../app/web-next/lib/checklist-gate-consumers.ts");
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");
const { blocker } = await import("../../app/web-next/lib/process-blocker-keys.ts");
const { seedGreenfieldS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");

const NOW = new Date().toISOString();
const OLD = "2026-10-01T00:00:00.000Z";
const ANALYST = "chk_analyst";
const VIEWER = "chk_viewer";
let cookie = "";
let viewerCookie = "";

const yamlItems = (stem: string) =>
  (parseYaml(readFileSync(`checklists/${stem}.yaml`, "utf8")) as { items: Array<{ id: string; mandatory: boolean }> }).items;
const STEMS: Record<string, string> = {
  "chk-legal-regulatory": "legal-regulatory-checklist",
  "chk-greenfield-feasibility": "greenfield-feasibility-checklist",
  "chk-site-selection": "site-selection-checklist",
};
const passAll = (docId: string) => c.checklistItems(docId).map((i) => ({ id: i.id, result: "pass" }));
const mandatoryPass = (docId: string) => c.checklistItems(docId).filter((i) => i.mandatory).map((i) => ({ id: i.id, result: "pass" }));

async function login(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
function opportunity(createdAt = NOW): string {
  const id = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [id, `opp ${id}`, "t", "selected", ANALYST, createdAt]);
  return id;
}
const withMode = <T>(mode: string | undefined, fn: () => T): T => {
  const prev = process.env[c.CHECKLIST_CONSUMER_ENV];
  if (mode === undefined) delete process.env[c.CHECKLIST_CONSUMER_ENV];
  else process.env[c.CHECKLIST_CONSUMER_ENV] = mode;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[c.CHECKLIST_CONSUMER_ENV];
    else process.env[c.CHECKLIST_CONSUMER_ENV] = prev;
  }
};

beforeAll(async () => {
  for (const [id, role, pw] of [[ANALYST, "analyst", "pw-chk-analyst-1"], [VIEWER, "viewer", "pw-chk-viewer-1"]] as const) {
    await createUser(db, { userId: id, role, password: pw, createdBy: "test", now: NOW });
    approveUser(db, { userId: id, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await login(ANALYST, "pw-chk-analyst-1");
  viewerCookie = await login(VIEWER, "pw-chk-viewer-1");
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("definitions", () => {
  test("each consumer's items are the checklist YAML's (library projection in sync) and each has mandatory items", () => {
    for (const def of c.GATE_CHECKLISTS) {
      const fromYaml = yamlItems(STEMS[def.docId]!);
      expect(c.checklistItems(def.docId).map((i) => [i.id, i.mandatory])).toEqual(fromYaml.map((i) => [i.id, i.mandatory]));
      expect(fromYaml.some((i) => i.mandatory)).toBe(true);
    }
  });
  test("gates and blocker keys", () => {
    expect(c.GATE_CHECKLISTS.map((d) => [d.docId, d.gate, d.stage, d.blockerKey])).toEqual([
      ["chk-legal-regulatory", "screening", "S4", "s4.legal_regulatory_screening"],
      ["chk-greenfield-feasibility", "pre_fs", "S5", "s5.greenfield_feasibility_checklist"],
      ["chk-site-selection", "pre_fs", "S5", "s5.site_selection_checklist"],
    ]);
  });
});

describe("compliance-engine semantics", () => {
  test("a mandatory item that is not satisfied is blocked; a recommended one never blocks (reason_required)", () => {
    const docId = "chk-legal-regulatory";
    const lr06 = c.checklistItems(docId).find((i) => !i.mandatory)!; // lr-06 is recommended
    const record = { id: "r", docId, recordedBy: "x", recordedAt: NOW, items: Object.fromEntries(mandatoryPass(docId).map((i) => [i.id, { result: "pass" as const, note: "" }])) };
    const ok = c.evaluateRequirements(c.gateRequirements(docId, record));
    expect(ok.pass).toBe(true);
    expect(ok.rows.find((r) => r.ruleKey === `${docId}:${lr06.id}`)?.result).toBe("reason_required");
    const broken = { ...record, items: { ...record.items, "lr-01": { result: "fail" as const, note: "" } } };
    const bad = c.evaluateRequirements(c.gateRequirements(docId, broken));
    expect(bad.pass).toBe(false);
    expect(bad.rows.find((r) => r.ruleKey === `${docId}:lr-01`)?.result).toBe("blocked");
    expect(c.evaluateRequirements(c.gateRequirements(docId, null)).pass).toBe(false); // nothing recorded
  });
  test("not_applicable satisfies an item only with a written reason", () => {
    const docId = "chk-site-selection";
    const items = Object.fromEntries(c.checklistItems(docId).map((i) => [i.id, { result: "not_applicable" as const, note: "기존 부지 증설 — 부지 선정 대상 아님" }]));
    expect(c.evaluateRequirements(c.gateRequirements(docId, { id: "r", docId, recordedBy: "x", recordedAt: NOW, items })).pass).toBe(true);
    const short = { ...items, "ss-01": { result: "not_applicable" as const, note: "n/a" } };
    expect(c.evaluateRequirements(c.gateRequirements(docId, { id: "r", docId, recordedBy: "x", recordedAt: NOW, items: short })).pass).toBe(false);
  });
});

describe("record", () => {
  test("validation: unknown checklist / item / result, short N/A reason, duplicates, empty, agent persona", () => {
    const o = opportunity();
    const base = { opportunityId: o, recordedBy: ANALYST };
    expect(() => c.recordChecklistScreening(db, { ...base, docId: "chk-nope", items: [{ id: "x", result: "pass" }] })).toThrow(/checklist must be one of/);
    expect(() => c.recordChecklistScreening(db, { ...base, docId: "chk-legal-regulatory", items: [] })).toThrow(/non-empty/);
    expect(() => c.recordChecklistScreening(db, { ...base, docId: "chk-legal-regulatory", items: [{ id: "zz-99", result: "pass" }] })).toThrow(/not an item/);
    expect(() => c.recordChecklistScreening(db, { ...base, docId: "chk-legal-regulatory", items: [{ id: "lr-01", result: "maybe" }] })).toThrow(/result must be one of/);
    expect(() => c.recordChecklistScreening(db, { ...base, docId: "chk-legal-regulatory", items: [{ id: "lr-01", result: "not_applicable", note: "short" }] })).toThrow(/written reason/);
    expect(() => c.recordChecklistScreening(db, { ...base, docId: "chk-legal-regulatory", items: [{ id: "lr-01", result: "pass" }, { id: "lr-01", result: "pass" }] })).toThrow(/more than once/);
    const agent = [...AGENT_KEYS][0]!;
    expect(() => c.recordChecklistScreening(db, { ...base, recordedBy: agent, docId: "chk-legal-regulatory", items: [{ id: "lr-01", result: "pass" }] })).toThrow(/Only a person/);
  });
  test("append-only: the latest record is the record of record, history stays", () => {
    const o = opportunity();
    c.recordChecklistScreening(db, { opportunityId: o, docId: "chk-legal-regulatory", items: [{ id: "lr-01", result: "fail", note: "미해결" }], recordedBy: ANALYST, now: "2026-10-29T00:00:00.000Z" });
    c.recordChecklistScreening(db, { opportunityId: o, docId: "chk-legal-regulatory", items: passAll("chk-legal-regulatory"), recordedBy: ANALYST, now: "2026-10-29T01:00:00.000Z" });
    expect(c.latestChecklistRecord(db, o, "chk-legal-regulatory")!.items["lr-01"]!.result).toBe("pass");
    expect((db.query("SELECT COUNT(*) c FROM process_run WHERE entity_type='opportunity' AND entity_id=? AND stage='s4_legal_regulatory_screen'").get(o) as { c: number }).c).toBe(2);
    expect(c.checklistGateState(db, o, "chk-legal-regulatory")).toMatchObject({ recorded: true, pass: true, blockedItems: [] });
  });
});

describe("rollout mode and stage contribution", () => {
  test("mode parsing and defaults (production shadow, elsewhere off)", () => {
    expect(c.checklistConsumerMode({})).toBe("off");
    expect(c.checklistConsumerMode({ NODE_ENV: "production" })).toBe("shadow");
    expect(c.checklistConsumerMode({ CO_NEWBIZ_CHECKLIST_CONSUMERS: "ENFORCE" })).toBe("enforce");
    expect(c.checklistConsumerMode({ CO_NEWBIZ_CHECKLIST_CONSUMERS: "bogus", NODE_ENV: "production" })).toBe("shadow");
  });
  test("off: nothing; shadow: advisory text only (never missing); enforce: blocks with the stable label", () => {
    const o = opportunity();
    const opp = { id: o, created_at: NOW };
    expect(c.checklistStageBlockers(db, opp, "S4", null, "off")).toEqual({ blockers: [], missing: [] });
    const shadow = c.checklistStageBlockers(db, opp, "S4", null, "shadow");
    expect(shadow.missing).toEqual([]);
    expect(shadow.blockers[0]).toContain("[권고·shadow]");
    const enforce = c.checklistStageBlockers(db, opp, "S4", null, "enforce");
    expect(enforce.missing).toEqual([blocker("s4.legal_regulatory_screening")]);
    expect(enforce.blockers[0]).toContain("chk-legal-regulatory");
    expect(enforce.blockers[0]).toContain("판정 기록이 없습니다");
  });
  test("S5 applies to greenfield only; S4 applies to both tracks", () => {
    const opp = { id: opportunity(), created_at: NOW };
    expect(c.checklistStageBlockers(db, opp, "S5", "brownfield", "enforce")).toEqual({ blockers: [], missing: [] });
    expect(c.checklistStageBlockers(db, opp, "S5", "greenfield", "enforce").missing).toEqual([
      blocker("s5.greenfield_feasibility_checklist"),
      blocker("s5.site_selection_checklist"),
    ]);
    expect(c.checklistStageBlockers(db, opp, "S4", "brownfield", "enforce").missing).toEqual([blocker("s4.legal_regulatory_screening")]);
  });
  test("an opportunity created before the P3 date is exempt (ADR-0151 precedent)", () => {
    expect(c.checklistStageBlockers(db, { id: opportunity(OLD), created_at: OLD }, "S4", null, "enforce")).toEqual({ blockers: [], missing: [] });
  });
  test("a failed mandatory item keeps the blocker and names the items", () => {
    const o = opportunity();
    c.recordChecklistScreening(db, { opportunityId: o, docId: "chk-legal-regulatory", items: [{ id: "lr-01", result: "fail", note: "x" }, ...mandatoryPass("chk-legal-regulatory").slice(1)], recordedBy: ANALYST });
    const r = c.checklistStageBlockers(db, { id: o, created_at: NOW }, "S4", null, "enforce");
    expect(r.blockers[0]).toContain("필수 항목 미충족 1건 (lr-01)");
  });
});

describe("engine integration (S4 Screening gate, S5 Pre-FS gate)", () => {
  test("flag off (default): the engine ignores the checklists; enforce: S4 then S5 need the records", async () => {
    const gf = await seedGreenfieldS1ToS12Demo();
    const opp = { type: "opportunity" as const, id: gf.opportunityId };
    withMode("off", () => {
      expect(evaluateProcess(opp).completedStages).toEqual(expect.arrayContaining(["S4", "S5"]));
    });
    withMode("enforce", () => {
      const ev = evaluateProcess(opp);
      expect(ev.currentStage).toBe("S4");
      expect(ev.requiredArtifacts).toContain(blocker("s4.legal_regulatory_screening"));
    });
    c.recordChecklistScreening(db, { opportunityId: gf.opportunityId, docId: "chk-legal-regulatory", items: mandatoryPass("chk-legal-regulatory"), recordedBy: ANALYST });
    withMode("enforce", () => {
      const ev = evaluateProcess(opp);
      expect(ev.completedStages).toContain("S4");
      expect(ev.currentStage).toBe("S5");
      expect(ev.requiredArtifacts).toEqual([blocker("s5.greenfield_feasibility_checklist"), blocker("s5.site_selection_checklist")]);
    });
    for (const docId of ["chk-greenfield-feasibility", "chk-site-selection"]) {
      c.recordChecklistScreening(db, { opportunityId: gf.opportunityId, docId, items: mandatoryPass(docId), recordedBy: ANALYST });
    }
    withMode("enforce", () => {
      expect(evaluateProcess(opp).completedStages).toEqual(expect.arrayContaining(["S4", "S5"]));
    });
  });
});

describe("REST route /api/opportunities/{id}/checklist-screening", () => {
  const url = (id: string) => `/api/opportunities/${id}/checklist-screening`;
  test("auth and role: anonymous 401, viewer 403, unknown opportunity 404", async () => {
    const o = opportunity();
    expect((await nextRequest(url(o), { method: "GET" })).status).toBe(401);
    expect((await nextRequest(url(o), { method: "POST", headers: { cookie: viewerCookie }, body: JSON.stringify({}) })).status).toBe(403);
    expect((await nextRequest(url("nope"), { method: "GET", headers: { cookie } })).status).toBe(404);
    expect((await nextRequest(url("nope"), { method: "POST", headers: { cookie }, body: JSON.stringify({}) })).status).toBe(404);
  });
  test("POST records (201, audited), GET returns items, record and state; bad input 400", async () => {
    const o = opportunity();
    const bad = await nextRequest(url(o), { method: "POST", headers: { cookie }, body: JSON.stringify({ checklist: "chk-legal-regulatory", items: [{ id: "lr-01", result: "not_applicable" }] }) });
    expect(bad.status).toBe(400);
    const res = await nextRequest(url(o), { method: "POST", headers: { cookie }, body: JSON.stringify({ checklist: "chk-legal-regulatory", items: mandatoryPass("chk-legal-regulatory") }) });
    expect(res.status).toBe(201);
    const data = ((await res.json()) as { data: { record: { items: Record<string, unknown> }; state: { pass: boolean } } }).data;
    expect(data.state.pass).toBe(true);
    expect(Object.keys(data.record.items).length).toBe(mandatoryPass("chk-legal-regulatory").length);
    expect((db.query("SELECT COUNT(*) c FROM audit_log WHERE action = 'checklist_screening.record' AND target LIKE ?").get(`${o}:%`) as { c: number }).c).toBe(1);
    const got = (await (await nextRequest(url(o), { method: "GET", headers: { cookie } })).json()) as { data: { mode: string; checklists: Array<{ checklist: string; record: unknown; items: unknown[] }> } };
    expect(got.data.checklists.map((x) => x.checklist)).toEqual(["chk-legal-regulatory", "chk-greenfield-feasibility", "chk-site-selection"]);
    expect(got.data.checklists[0]!.record).not.toBeNull();
    expect(got.data.checklists[1]!.record).toBeNull();
    expect(got.data.checklists[2]!.items.length).toBeGreaterThan(0);
  });
});
