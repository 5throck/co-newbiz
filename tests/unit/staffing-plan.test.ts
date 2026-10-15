// @version 1.0.0
/**
 * ADR-0175 slice 1 — S5 인력 운영 계획: validation, cost math, exclusion flags, totals/summary
 * integration (no double count), duplicate guard, meta round trip, route partial saves, viewer
 * masking, audit without salary values, PII scrub. Temp DB, no LLM, nothing exercised in a browser.
 */
import { test, expect, describe, beforeAll } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(ROOT, "db/data/test-staffing-plan.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const sp = await import("../../app/web-next/lib/staffing-plan.ts");
const cl = await import("../../app/web-next/lib/capability-cost-lines.ts");

const NOW = new Date().toISOString();
const json = JSON.stringify;
const WEB = join(ROOT, "app/web-next");
const row = (o: Record<string, unknown> = {}) => ({ id: "r1", roleFamily: "생산", grade: "과장", headcountByYear: [10, 10, 10], avgAnnualBaseSalaryKrwM: 60, salaryIncreaseRatePct: 0, onCostRatePct: 20, ...o });
const plan = (rows: unknown[], o: Record<string, unknown> = {}) => ({ source: "staffing_plan", rows, ...o });
const norm = (p: unknown, h = 3) => sp.normalizeStaffingPlanEntry(p, h);
const okPlan = (rows: unknown[], h = 3, o: Record<string, unknown> = {}) => { const v = norm(plan(rows, o), h); if (!v.ok) throw new Error(v.message); return v.entry; };

describe("validation table", () => {
  const bad: Array<[string, unknown[], Record<string, unknown>, RegExp]> = [
    ["empty roleFamily", [row({ roleFamily: "  " })], {}, /직무군/],
    ["empty grade", [row({ grade: "" })], {}, /직급/],
    ["negative headcount", [row({ headcountByYear: [-1, 0, 0] })], {}, /인원/],
    ["headcount > 100000", [row({ headcountByYear: [100001] })], {}, /인원/],
    ["more year columns than horizon", [row({ headcountByYear: [1, 1, 1, 1] })], {}, /연도 열/],
    ["salary > 10000", [row({ avgAnnualBaseSalaryKrwM: 10001 })], {}, /평균 연봉/],
    ["negative salary", [row({ avgAnnualBaseSalaryKrwM: -1 })], {}, /평균 연봉/],
    ["increase > 100", [row({ salaryIncreaseRatePct: 101 })], {}, /인상률/],
    ["on-cost > 100", [row({ onCostRatePct: 101 })], {}, /가산율/],
    ["bad quarter", [row({ hireStartQuarter: "2027-5" })], {}, /YYYY-Qn/],
    ["negative recruiting", [row({ recruitingOneOffKrwM: -1 })], {}, /채용 일회비/],
    ["start year out of horizon", [row()], { startYear: 4 }, /시작 연차/],
    ["end before start", [row()], { startYear: 3, endYear: 2 }, /종료 연차/],
    ["attrition > 100", [row()], { attritionBackfillPct: 101 }, /이탈 보충률/],
    ["non-object row", ["x"], {}, /형식/],
  ];
  for (const [name, rows, o, re] of bad) test(`rejects ${name}`, () => { const v = norm(plan(rows, o)); expect(v.ok).toBe(false); if (!v.ok) expect(v.message).toMatch(re); });
  test("rejects more than 100 rows", () => { expect(norm(plan(Array.from({ length: 101 }, (_, i) => row({ id: `x${i}` })))).ok).toBe(false); });
  test("integers: decimals round, headcount is zero-padded to the horizon", () => {
    const e = okPlan([row({ headcountByYear: [2.4], avgAnnualBaseSalaryKrwM: 59.6 })]);
    expect(e.rows[0].headcountByYear).toEqual([2, 0, 0]);
    expect(e.rows[0].avgAnnualBaseSalaryKrwM).toBe(60);
  });
  test("blank salary/on-cost stay null (no default on-cost rate)", () => {
    const e = okPlan([row({ avgAnnualBaseSalaryKrwM: undefined, onCostRatePct: "" })]);
    expect(e.rows[0].avgAnnualBaseSalaryKrwM).toBeNull();
    expect(e.rows[0].onCostRatePct).toBeNull();
  });
  test("PII scrub: control characters/newlines removed, 60-char cap; the schema has no name field", () => {
    const e = okPlan([row({ roleFamily: "생산\n팀\u0000", grade: "가".repeat(80), name: "홍길동", employeeName: "김철수" })]);
    expect(e.rows[0].roleFamily).toBe("생산 팀");
    expect(e.rows[0].grade).toHaveLength(60);
    expect(JSON.stringify(e)).not.toContain("홍길동");
    expect(JSON.stringify(e)).not.toContain("김철수");
  });
});

describe("cost math", () => {
  test("headcount x salary x (1+inc)^(y-1) x (1+on-cost), 2-decimal rounding", () => {
    const e = okPlan([row({ headcountByYear: [10, 10, 10], avgAnnualBaseSalaryKrwM: 60, salaryIncreaseRatePct: 5, onCostRatePct: 20 })]);
    const v = sp.staffingPlanView(e, 3);
    expect(v.costByYear).toEqual([720, 756, 793.8]);
    expect(v.totalKrwM).toBe(2269.8);
    expect(v.headcountByYear).toEqual([10, 10, 10]);
    expect(v.avgHeadcount).toBe(10);
  });
  test("compounding rounds per cell, not on the total", () => {
    const e = okPlan([row({ headcountByYear: [3, 3, 3], avgAnnualBaseSalaryKrwM: 33, salaryIncreaseRatePct: 3, onCostRatePct: 17 })]);
    const v = sp.staffingPlanView(e, 3);
    expect(v.costByYear).toEqual([115.83, 119.3, 122.88]);
  });
  test("window limits the costed years", () => {
    const e = okPlan([row()], 3, { startYear: 2, endYear: 2 });
    expect(sp.staffingPlanView(e, 3).costByYear).toEqual([0, 720, 0]);
  });
  test("row without salary or on-cost is excluded and flagged, never costed at zero", () => {
    const e = okPlan([row({ id: "a" }), row({ id: "b", avgAnnualBaseSalaryKrwM: null }), row({ id: "c", onCostRatePct: null })]);
    const v = sp.staffingPlanView(e, 3);
    expect(v.totalKrwM).toBe(2160); // only row a: 10 x 60 x 1.2 x 3
    expect(v.rows[1].costByYear).toEqual([null, null, null]);
    expect(v.rows[1].flags).toContain(sp.FLAG_NO_SALARY);
    expect(v.rows[2].flags).toContain(sp.FLAG_NO_ONCOST);
    expect(v.needSalaryCount).toBe(1);
    expect(v.needOnCostCount).toBe(1);
    expect(v.needConfirmCount).toBe(2);
    expect(v.headcountByYear).toEqual([30, 30, 30]); // headcount still counted
  });
  test("recruiting one-offs land in the plan start year", () => {
    const e = okPlan([row({ recruitingOneOffKrwM: 40 })], 3, { startYear: 2 });
    const vec = sp.staffingSummaryVector(e, 3);
    expect(vec.recruitingByYear).toEqual([0, 40, 0]);
  });
});

describe("totals and summary integration", () => {
  const view = { lines: [], orphans: [], totals: { capabilityKrwM: 0, reflectedKrwM: 0, reflectedCount: 0, needsRejudgeCount: 0 } } as any;
  const manualLabor = { line: "본사 파견 인력", category: "labor", amount: 100, amountUnit: "krw_m", amountUnitConfirmed: true, amountKrwM: 100, currency: "KRW", period: "lumpsum" };
  test("staffing labor adds to grand total once; manual lines are untouched", () => {
    const e = okPlan([row({ recruitingOneOffKrwM: 10 })]);
    const without = cl.investmentTotals(view, new Set(), [manualLabor]);
    const withS = cl.investmentTotals(view, new Set(), [manualLabor], e, 3);
    expect(without.grandKrwM).toBe(100);
    expect(withS.manualKrwM).toBe(100);
    expect(withS.staffingKrwM).toBe(2170); // 2160 labor + 10 recruiting
    expect(withS.grandKrwM).toBe(2270);
    expect(withS.staffingNeedConfirmCount).toBe(0);
  });
  test("summary: per-year labor follows the ramp, labor category total = manual + staffing, no double count", () => {
    const e = okPlan([row({ headcountByYear: [5, 10, 10], salaryIncreaseRatePct: 0 })]);
    const s = cl.buildInvestmentSummary([manualLabor], [], 3, new Set(), e);
    expect(s.schedule.map((x) => x.labor)).toEqual([100 + 360, 720, 720]);
    expect(s.byCategory.find((c) => c.category === "labor")!.totalKrwM).toBe(100 + 1800);
    expect(s.staffingLaborKrwM).toBe(1800);
    expect(s.totalKrwM).toBe(1900);
    const none = cl.buildInvestmentSummary([manualLabor], [], 3, new Set());
    expect(none.staffingLaborKrwM).toBe(0);
    expect(none.totalKrwM).toBe(100);
  });
  test("excluded rows reach the summary as a confirm count, not as zero cost", () => {
    const e = okPlan([row({ onCostRatePct: null })]);
    const s = cl.buildInvestmentSummary([], [], 3, new Set(), e);
    expect(s.totalKrwM).toBe(0);
    expect(s.staffingNeedConfirmCount).toBe(1);
  });
});

describe("duplicate guard", () => {
  const rows = okPlan([row({ roleFamily: "품질 관리" })]).rows;
  test("manual labor line overlapping the role family warns; dismissal by staffing:<rowId> silences it", () => {
    const m = [{ line: "품질 관리 인력 인건비", category: "labor" }];
    expect(sp.findStaffingDuplicateWarnings(rows, m)).toHaveLength(1);
    expect(sp.findStaffingDuplicateWarnings(rows, [{ ...m[0], dupDismissed: ["staffing:r1"] }])).toHaveLength(0);
  });
  test("token overlap >= 60% warns; unrelated and non-labor lines do not", () => {
    expect(sp.isLikelyStaffingDuplicate("품질 관리 팀", { line: "관리 팀 급여" })).toBe(true);
    expect(sp.findStaffingDuplicateWarnings(rows, [{ line: "설비 구입", category: "labor" }])).toHaveLength(0);
    expect(sp.findStaffingDuplicateWarnings(rows, [{ line: "품질 관리 장비", category: "capex" }])).toHaveLength(0);
  });
});

describe("meta entry in stored lines (pure normalizer)", () => {
  const actor = { userId: "u", at: NOW };
  const manual = { line: "임대료", category: "opex", amount: 5, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly" };
  test("kept once, stamped, never turned into a manual line", () => {
    const r = cl.normalizeBusinessCaseLines([{ source: "plan_meta", horizonYears: 3 }, plan([row()]), plan([row({ id: "dup" })]), manual], [], null, actor);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines.filter(sp.isStaffingPlanEntry)).toHaveLength(1);
    expect(r.lines.find(sp.isStaffingPlanEntry)).toMatchObject({ updatedBy: "u", updatedAt: NOW });
    expect(r.lines).toHaveLength(3);
  });
  test("an invalid row fails the whole save with a precise message", () => {
    const r = cl.normalizeBusinessCaseLines([{ source: "plan_meta", horizonYears: 3 }, plan([row({ grade: "" })])], [], null, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error.code).toBe("invalid_request"); expect(r.error.message).toContain("1번째 행: 직급"); }
  });
  test("lines without the plan keep the stored one; an explicit empty-rows save clears it", () => {
    const stored = [{ source: "plan_meta", horizonYears: 3 }, { ...okPlan([row()]), updatedAt: NOW, updatedBy: "u" }, manual];
    const keep = cl.normalizeBusinessCaseLines([{ source: "plan_meta", horizonYears: 3 }, manual], [], stored, actor);
    expect(keep.ok && keep.lines.some(sp.isStaffingPlanEntry)).toBe(true);
    const clear = cl.normalizeBusinessCaseLines([{ source: "plan_meta", horizonYears: 3 }, plan([]), manual], [], stored, actor);
    expect(clear.ok && (clear.lines.find(sp.isStaffingPlanEntry) as any).rows).toEqual([]);
  });
  test("promotion split ignores the staffing entry (S8 hand-off is slice 2)", () => {
    const sp1 = cl.splitForPromotion([{ source: "plan_meta", horizonYears: 3 }, okPlan([row()]), { ...manual }], []);
    expect(sp1.manual).toHaveLength(1);
  });
});

describe("routes: partial saves, masking, audit", () => {
  const LEAD = "staff-lead";
  const VIEW = "staff-viewer";
  let lead = "";
  let viewer = "";
  let oppId = "";
  const login = async (u: string) => ((await nextRequest("/api/auth/login", { method: "POST", body: json({ userId: u, password: `pw-${u}-12345` }) })).headers.getSetCookie()[0] ?? "").split(";")[0];
  const post = (body: unknown, cookie = lead) => nextRequest(`/api/greenfield/${oppId}`, { method: "POST", headers: { cookie }, body: json(body) });
  const get = async (cookie = lead) => ((await (await nextRequest(`/api/greenfield/${oppId}`, { headers: { cookie } })).json()) as any).data;
  const stored = (): any[] => JSON.parse((db.query("SELECT business_case_lines_json j FROM greenfield_assessment WHERE opportunity_id = ?").get(oppId) as { j: string }).j);
  const META = { source: "plan_meta", horizonYears: 3 };
  const manual = { line: "임대료", category: "opex", amount: 5, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly" };

  beforeAll(async () => {
    for (const [u, role] of [[LEAD, "analyst"], [VIEW, "viewer"]] as const) {
      await createUser(db, { userId: u, role, password: `pw-${u}-12345`, createdBy: "test", now: NOW });
      approveUser(db, { userId: u, approvedBy: "test", now: NOW });
    }
    db.run("UPDATE app_user SET must_change_password = 0");
    lead = await login(LEAD);
    viewer = await login(VIEW);
    oppId = ulid();
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "인력 계획 기회", "산업", "selected", LEAD, NOW]);
    db.run("INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, rationale, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [ulid(), oppId, "[진출방식] build*\n근거", "test", LEAD, NOW, NOW]);
  });

  test("staffing save stores the entry, returns it with a server view, and audits without salary values", async () => {
    const res = await post({ business_case_lines: [META, plan([row({ avgAnnualBaseSalaryKrwM: 777, onCostRatePct: 33, salarySource: "내부 추정" })], { startYear: 1, endYear: 3 }), manual] });
    expect(res.status).toBe(200);
    const lines = stored();
    expect(lines.filter(sp.isStaffingPlanEntry)).toHaveLength(1);
    expect(lines.find(sp.isStaffingPlanEntry)).toMatchObject({ updatedBy: LEAD });
    const d = await get();
    expect(d.staffing_plan_masked).toBe(false);
    expect(d.staffing_plan_view.totalKrwM).toBe(Math.round(10 * 777 * 1.33 * 3 * 100) / 100);
    const audit = db.query("SELECT actor_user_id AS actor, action, target FROM audit_log WHERE action = 'staffing_plan.updated'").all() as Array<{ actor: string; target: string }>;
    expect(audit).toHaveLength(1);
    expect(audit[0].actor).toBe(LEAD);
    for (const v of ["777", "33", "내부 추정"]) expect(audit[0].target).not.toContain(v);
  });

  test("lines-only POST without the plan keeps it; unchanged plan re-save writes no second audit event", async () => {
    expect((await post({ business_case_lines: [META, manual] })).status).toBe(200);
    expect(stored().filter(sp.isStaffingPlanEntry)).toHaveLength(1);
    const kept = stored().find(sp.isStaffingPlanEntry);
    expect((await post({ business_case_lines: [META, plan(kept.rows, { startYear: 1, endYear: 3 }), manual] })).status).toBe(200);
    expect((db.query("SELECT COUNT(*) n FROM audit_log WHERE action = 'staffing_plan.updated'").get() as { n: number }).n).toBe(1);
  });

  test("a staffing change keeps the manual lines and entry_strategy; a changed plan audits again", async () => {
    const kept = stored().find(sp.isStaffingPlanEntry);
    const rows = [...kept.rows, row({ id: "r2", roleFamily: "영업", grade: "사원", headcountByYear: [2, 2, 2] })];
    expect((await post({ business_case_lines: [META, plan(rows, { startYear: 1, endYear: 3 }), manual] })).status).toBe(200);
    expect(stored().filter((l) => !sp.isStaffingPlanEntry(l) && l.source !== "plan_meta")).toHaveLength(1);
    expect((db.query("SELECT entry_strategy e FROM greenfield_assessment WHERE opportunity_id = ?").get(oppId) as { e: string }).e).toContain("build");
    expect((db.query("SELECT COUNT(*) n FROM audit_log WHERE action = 'staffing_plan.updated'").get() as { n: number }).n).toBe(2);
  });

  test("invalid rows are a 400 with the precise message; nothing is stored", async () => {
    const before = JSON.stringify(stored());
    const res = await post({ business_case_lines: [META, plan([row({ avgAnnualBaseSalaryKrwM: 20000 })])] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toContain("1번째 행: 평균 연봉");
    expect(JSON.stringify(stored())).toBe(before);
  });

  test("viewer GET: salary/on-cost values removed, masked flag set, headcount and the cost strip remain; viewer POST is refused", async () => {
    const d = await get(viewer);
    expect(d.staffing_plan_masked).toBe(true);
    const entry = d.assessment.business_case_lines.find(sp.isStaffingPlanEntry);
    expect(entry.masked).toBe(true);
    for (const r of entry.rows) {
      expect(r.avgAnnualBaseSalaryKrwM).toBeNull();
      expect(r.onCostRatePct).toBeNull();
      expect(r.salarySource).toBeNull();
      expect(r.headcountByYear.length).toBe(3);
    }
    expect(JSON.stringify(d)).not.toContain("777");
    expect(d.staffing_plan_view.totalKrwM).toBeGreaterThan(0);
    expect((await post({ business_case_lines: [META, plan([])] }, viewer)).status).toBe(403);
  });
});

describe("S5 UI structure (source)", () => {
  const stage = readFileSync(join(WEB, "components/stages/GreenfieldStage.tsx"), "utf8");
  const sec = readFileSync(join(WEB, "components/stages/StaffingPlanSection.tsx"), "utf8");
  test("section sits above the item list and rides the existing save button", () => {
    expect(stage.indexOf("<StaffingPlanSection")).toBeGreaterThan(0);
    expect(stage.indexOf("<StaffingPlanSection")).toBeLessThan(stage.indexOf("unifiedRows.map"));
    expect(stage).toContain("staffingPayload()");
    expect(stage).toContain("!isStaffingPlanEntry(l)");
    expect(stage).toContain("투자비 항목 저장");
  });
  test("grid, + 행 추가, delete, canAct gating and the masked cell", () => {
    for (const s of ["인력 운영 계획", "+ 행 추가", "평균 연봉(백만원)", "가산율(%)", "채용 일회비", "확인 필요", "연평균 인원", "staffing-masked-cell", "열람 권한 없음", "aria-expanded"]) expect(sec).toContain(s);
    expect(sec).toContain("disabled={disabled}");
    expect(sec).toContain("masked ? mask");
  });
});
