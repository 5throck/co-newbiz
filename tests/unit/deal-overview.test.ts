import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { buildDealOverview, isArtifactDone } from "../../app/web-next/lib/deal-overview.ts";
import { displayOrNotRecorded, localizeRequirement, NOT_RECORDED_LABEL } from "../../app/web-next/lib/labels.ts";

const proc = (o: Partial<Parameters<typeof buildDealOverview>[2]> = {}) => ({
  currentStage: null, blockers: [], requiredArtifacts: [], track: null, ...o,
});

describe("displayOrNotRecorded / localizeRequirement", () => {
  test("null, undefined, blank -> not recorded; 0 is a value", () => {
    for (const v of [null, undefined, "", "  "]) expect(displayOrNotRecorded(v)).toEqual({ text: NOT_RECORDED_LABEL, empty: true });
    expect(displayOrNotRecorded(0)).toEqual({ text: "0", empty: false });
    expect(displayOrNotRecorded(72)).toEqual({ text: "72", empty: false });
  });
  test("no raw (snake_case) token survives", () => {
    expect(localizeRequirement("기회 선택(selected)이 필요합니다")).toBe("기회 선택이 필요합니다");
    expect(localizeRequirement("기회 선택(selected)")).not.toMatch(/\([a-z_]+\)/);
  });
});

describe("buildDealOverview", () => {
  test("H3: all stages complete -> last stage, not the status-convention fallback; no next action", () => {
    const stages = ["S1","S2","S3","S4","S5","S8","S9","S10","S11","S12"].map((id) => ({ id, status: id === "S5" ? "skipped" : "complete" }));
    const o = buildDealOverview("D1", { status: "selected", attractiveness_score: 1, synergy_score: 1 }, proc({ track: "brownfield", stages }));
    expect(o.currentStage?.id).toBe("S12");
    expect(o.nextAction).toBeNull();
    expect(o.statusText).toBe("pages.dealOverview.journeyFinished");
  });
  test("H3: a project-evaluated promoted deal builds gate links on the project carrier", () => {
    const o = buildDealOverview("OPP1", { status: "selected", attractiveness_score: 1, synergy_score: 1 },
      proc({ currentStage: "S8", track: "greenfield", requiredArtifacts: [], blockers: [], gateStatus: {}, carrier: { type: "project", id: "PRJ1" } }));
    expect(o.currentStage?.id).toBe("S8");
    expect(o.nextAction?.href).toContain("PRJ1");
  });
  test.each([["identified", "S2"], ["assessed", "S3"], ["selected", "S4"]])("status %s -> %s", (status, stage) => {
    const o = buildDealOverview("D1", { status, attractiveness_score: null, synergy_score: null }, proc({ requiredArtifacts: ["X"], blockers: ["X"] }));
    expect(o.currentStage?.id).toBe(stage);
    expect(o.nextAction?.href).toBe(`/deals/D1/${stage.toLowerCase()}`);
    expect(o.flow.current).toBe(o.currentStage?.name ?? null);
    expect(o.flow.previous).not.toBeNull();
  });
  test("null values render as not recorded; synergy note only when unconfirmed value", () => {
    const o = buildDealOverview("D1", { status: "assessed", attractiveness_score: null, synergy_score: null }, proc());
    expect(o.facts.filter((f) => ["attractiveness", "synergy", "track"].includes(f.key)).every((f) => f.value.empty)).toBe(true);
    const o2 = buildDealOverview("D1", { status: "assessed", attractiveness_score: 72, synergy_score: 60 }, proc({ track: "greenfield" }));
    expect(o2.facts.find((f) => f.key === "synergy")?.note).not.toBeNull();
    expect(o2.facts.find((f) => f.key === "track")?.value.empty).toBe(false);
    const o3 = buildDealOverview("D1", { status: "assessed", attractiveness_score: 72, synergy_score: 60, synergy_score_confirmed_at: "x" }, proc());
    expect(o3.facts.find((f) => f.key === "synergy")?.note).toBeNull();
  });
  test("artifact in blockers is not done; unmatched blockers listed separately", () => {
    const o = buildDealOverview("D1", { status: "selected", attractiveness_score: 1, synergy_score: 1 },
      proc({ requiredArtifacts: ["기회 선택(selected)", "A"], blockers: ["기회 선택(selected)이 필요합니다 — x", "other blocker"] }));
    expect(o.completion).toEqual([{ label: "기회 선택", done: false, isNext: true }, { label: "A", done: true, isNext: false }]);
    expect(o.completionCounts).toEqual({ done: 1, total: 2 });
    expect(o.otherBlockers).toEqual(["other blocker"]);
    expect(isArtifactDone("A", [])).toBe(true);
  });
  test("terminated -> no primary action, status text", () => {
    const o = buildDealOverview("D1", { status: "assessed", attractiveness_score: null, synergy_score: null }, proc({ terminated: true }));
    expect(o.nextAction).toBeNull();
    expect(o.statusText).not.toBeNull();
  });
  test("hold mapping uses gateHoldHref; gate chips labelled", () => {
    const o = buildDealOverview("D1", { status: "assessed", attractiveness_score: null, synergy_score: null },
      proc({ gateStatus: { screening: "hold" } }), [{ entityType: "opportunity", entityId: "D1", gate: "screening" }]);
    // F9 query contract: S3 opens its 의사결정 tab on ?tab=decision.
    expect(o.holds[0]!.href).toBe("/deals/D1/s3?tab=decision");
    expect(o.gates[0]).toMatchObject({ gate: "screening", decision: "hold" });
  });
  test("pre_fs links split by track: brownfield resolves on the S4 committee tab, greenfield on S5 (T-20261022-002)", () => {
    const bfHold = [{ entityType: "opportunity" as const, entityId: "D1", gate: "pre_fs" }];
    const bf = buildDealOverview("D1", { status: "assessed", attractiveness_score: null, synergy_score: null },
      proc({ track: "brownfield", gateStatus: { pre_fs: "hold" } }), bfHold);
    expect(bf.holds[0]!.href).toBe("/deals/D1/s4?tab=committee");
    expect(bf.nextAction).toMatchObject({ type: "resolve_hold", href: "/deals/D1/s4?tab=committee" });
    const gf = buildDealOverview("D1", { status: "assessed", attractiveness_score: null, synergy_score: null },
      proc({ track: "greenfield", gateStatus: { pre_fs: "hold" } }), bfHold);
    // F9 query contract: S5 opens its 검토·확정 tab on ?tab=review.
    expect(gf.holds[0]!.href).toBe("/deals/D1/s5?tab=review");
    // Unknown track keeps the historical S5 destination (same review-tab contract).
    const unknown = buildDealOverview("D1", { status: "assessed", attractiveness_score: null, synergy_score: null },
      proc({ gateStatus: { pre_fs: "hold" } }), bfHold);
    expect(unknown.holds[0]!.href).toBe("/deals/D1/s5?tab=review");
  });
  test("carrierScopeFinished -> the next action is PROMOTION, not the S8 artifact/fs-gate state (journey F2)", () => {
    // The engine's opportunity-branch currentStage reads S8 for a finished but
    // un-promoted carrier and reports S8's own artifacts as missing — neither is
    // the user's job before promotion.
    const procDone = {
      currentStage: "S8", blockers: [], track: "greenfield" as const,
      requiredArtifacts: ["Business Case(비용·수익 라인 또는 밸류에이션 — brownfield는 대상별)"], carrierScopeFinished: true,
    };
    const gf = buildDealOverview("D1", { status: "selected", attractiveness_score: null, synergy_score: null }, procDone);
    expect(gf.nextAction).toMatchObject({ type: "advance_stage", subject: "프로젝트로 추진", href: "/deals/D1/s5" });
    const bf = buildDealOverview("D1", { status: "selected", attractiveness_score: null, synergy_score: null },
      { ...procDone, track: "brownfield" as const });
    expect(bf.nextAction).toMatchObject({ type: "advance_stage", href: "/deals/D1/s7" });
    // Without the marker the old behavior is untouched (fs gate request).
    const notDone = buildDealOverview("D1", { status: "selected", attractiveness_score: null, synergy_score: null },
      { currentStage: "S8", blockers: [], track: "greenfield" as const, requiredArtifacts: [] });
    expect(notDone.nextAction).toMatchObject({ type: "request_gate_decision" });
    expect(notDone.nextAction!.href).toBe("/deals/D1/s8");
  });
});

describe("buildDealOverview data contract (refinement Row 1)", () => {
  const NOW = Date.parse("2026-10-11T00:00:00Z");
  const opp = (o = {}) => ({ name: "Opp", status: "assessed", attractiveness_score: null, synergy_score: null, ...o });

  test("identity: project name wins over opportunity name; status label and stage", () => {
    const a = buildDealOverview("D1", opp(), proc());
    expect(a.identity).toEqual({ name: "Opp", statusLabel: "평가", stage: { id: "S3", name: "시너지·전략적 적합성" }, terminated: false });
    expect(buildDealOverview("P1", opp(), proc({ projectName: "Proj" })).identity.name).toBe("Proj");
    expect(buildDealOverview("D1", opp({ name: null }), proc()).identity.name).toBe("기록 없음");
  });
  test("nextAction: record_artifact names the first open artifact", () => {
    const o = buildDealOverview("D1", opp(), proc({ requiredArtifacts: ["A", "B"], blockers: ["B 필요"] }));
    expect(o.nextAction).toMatchObject({ type: "record_artifact", subject: "B", href: "/deals/D1/s3", reason: { type: "artifact_missing", done: 1, total: 2 } });
  });
  test("nextAction: gate decision when all artifacts done; advance when the stage has no open gate", () => {
    const g = buildDealOverview("D1", opp(), proc({ requiredArtifacts: ["A"] }));
    // F9 query contract: the screening decision surface is S3's 의사결정 tab.
    expect(g.nextAction).toMatchObject({ type: "request_gate_decision", href: "/deals/D1/s3?tab=decision", reason: { type: "gate_pending", gate: "screening" } });
    const adv = buildDealOverview("D1", opp(), proc({ requiredArtifacts: ["A"], gateStatus: { screening: "go" }, nextStage: "S4" }));
    expect(adv.nextAction).toMatchObject({ type: "advance_stage", subject: "진출방식 결정", href: "/deals/D1/s4" });
  });
  test("nextAction: hold takes priority and carries age in days", () => {
    const o = buildDealOverview("D1", opp(), proc({ gateStatus: { screening: "hold" } }),
      [{ entityType: "opportunity", entityId: "D1", gate: "screening", decidedAt: "2026-10-01T00:00:00Z" }], NOW);
    expect(o.nextAction).toMatchObject({ type: "resolve_hold", reason: { type: "hold", gate: "screening", ageDays: 10 } });
    expect(o.holds[0]).toMatchObject({ heldSince: "2026-10-01T00:00:00Z", ageDays: 10 });
    expect(buildDealOverview("D1", opp(), proc(), [{ entityType: "opportunity", entityId: "D1", gate: "screening" }]).holds[0]).toMatchObject({ heldSince: null, ageDays: null });
  });
  test("facts: pending before the recording stage, missing links to it, none gate links to decision screen", () => {
    const s2 = buildDealOverview("D1", opp({ status: "identified" }), proc());
    const by = (o: typeof s2, k: string) => o.facts.find((f) => f.key === k)!;
    expect(by(s2, "attractiveness")).toMatchObject({ state: "missing", href: "/deals/D1/s2" });
    expect(by(s2, "synergy")).toMatchObject({ state: "pending", applicableFromStage: "S3" });
    expect(by(s2, "track")).toMatchObject({ state: "pending", applicableFromStage: "S4" });
    expect(by(s2, "gate")).toMatchObject({ state: "none", href: "/deals/D1/s3?tab=decision" });
    const s4 = buildDealOverview("D1", opp({ status: "selected", attractiveness_score: 5 }), proc());
    expect(by(s4, "attractiveness").state).toBe("value");
    expect(by(s4, "track")).toMatchObject({ state: "missing", href: "/deals/D1/s4" });
    expect(s2.nextGate).toMatchObject({ gate: "screening", href: "/deals/D1/s3?tab=decision" });
  });
  test("project fact only when a linked project id exists", () => {
    expect(buildDealOverview("D1", opp(), proc()).facts.some((f) => f.key === "project")).toBe(false);
    expect(buildDealOverview("D1", opp(), proc({ projectId: "P1" })).facts.find((f) => f.key === "project")).toMatchObject({ href: "/deals/P1", state: "value" });
  });
  test("flow entries carry artifacts from process stages, [] otherwise", () => {
    const o = buildDealOverview("D1", opp(), proc({ stages: [{ id: "S2", requiredArtifacts: ["기회 등록(x)"] }, { id: "S4", requiredArtifacts: ["트랙 결정"] }] }));
    expect(o.flow.previous).toEqual({ id: "S2", name: "기회 발굴", artifacts: ["기회 등록"] });
    expect(o.flow.next).toEqual({ id: "S4", name: "진출방식 결정", artifacts: ["트랙 결정"] });
    expect(buildDealOverview("D1", opp(), proc()).flow.next?.artifacts).toEqual([]);
  });
});

const DB = "db/data/test-synergy-opp-filter.sqlite";
process.env.CO_NEWBIZ_DB_PATH = DB;
for (const s of ["", "-wal", "-shm"]) if (existsSync(DB + s)) rmSync(DB + s);
const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

describe("GET /api/synergy/analyses?opportunityId=", () => {
  const NOW = "2026-09-10T00:00:00Z";
  let cookie = ""; let oppA = ""; let oppB = ""; let synA = "";
  beforeAll(async () => {
    resetDb(); runMigrations(DB);
    const db = getDb(DB);
    await createUser(db, { userId: "syn-flt", role: "analyst", password: "pw-syn-flt-12345", createdBy: "test", now: NOW });
    approveUser(db, { userId: "syn-flt", approvedBy: "test", now: NOW });
    db.run("UPDATE app_user SET must_change_password = 0");
    const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: "syn-flt", password: "pw-syn-flt-12345" }) });
    cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
    oppA = ulid(); oppB = ulid(); synA = ulid();
    for (const id of [oppA, oppB]) db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [id, "o" + id, "assessed", "test", NOW]);
    db.run("INSERT INTO synergy_analysis (id, company_id, status, current_step, created_by, created_at, opportunity_id) VALUES (?,?,?,?,?,?,?)", [synA, "md-synergy-registry-sentinel", "completed", 3, "test", NOW, oppA]);
    db.run("INSERT INTO synergy_analysis (id, company_id, status, current_step, created_by, created_at) VALUES (?,?,?,?,?,?)", [ulid(), "md-synergy-registry-sentinel", "completed", 3, "test", NOW]);
  });
  afterAll(() => { resetDb(); for (const s of ["", "-wal", "-shm"]) if (existsSync(DB + s)) rmSync(DB + s); });
  const list = async (q = "") => ((await (await nextRequest(`/api/synergy/analyses${q}`, { headers: { cookie } })).json()) as { data: { analyses: Array<{ id: string }> } }).data.analyses;

  test("match, no match, unknown/malformed id, unfiltered unchanged", async () => {
    expect((await list(`?opportunityId=${oppA}`)).map((a) => a.id)).toEqual([synA]);
    expect(await list(`?opportunityId=${oppB}`)).toEqual([]);
    expect(await list("?opportunityId=NOPE")).toEqual([]);
    expect(await list("?opportunityId=%27%20OR%201%3D1")).toEqual([]);
    expect((await list()).length).toBe(2);
  });
});
