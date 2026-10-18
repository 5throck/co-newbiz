// @version 1.0.0
/**
 * ADR-0173 slice 1 (Proposed): S5 capability closing cost lines and milestone candidates.
 * Pure derivation (confirmed / draft / stale, default reflection, category mapping, unit
 * conversion, double-count heuristics, totals), server-side save validation (amount recomputed,
 * tampering rejected), persistence round trip, promotion copy (exact 백만원, unreflected skipped),
 * milestone candidates and the S5 UI structure. Temp DB only; no browser was used.
 */
import { test, expect, beforeAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-capability-cost-lines.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const cg = await import("../../app/web-next/lib/capability-gap.ts");
const cl = await import("../../app/web-next/lib/capability-cost-lines.ts");
const att = await import("../../app/web-next/lib/capability-attainability.ts");

const NOW = new Date().toISOString();
const json = JSON.stringify;
const req = (path: string, init?: RequestInit) => nextRequest(path, init);
const WEB = join(PROJECT_ROOT, "app/web-next");

// ── helpers for pure tests ──────────────────────────────────────────────────
const src = (o: Partial<import("../../app/web-next/lib/capability-cost-lines.ts").CostSourceRow> = {}) => ({
  id: "k1", capability: "정밀 가공", resolution: "build" as const, closing_cost_krw_m: 3000, months_to_attain: 12, grade: "high",
  confirmed_at: NOW as string | null, stale: false, ...o,
});

describe("units and category mapping", () => {
  test("백만원 to 억 display (2 decimals) keeps the exact value", () => {
    expect(cl.eokOf(3000)).toBe(30);
    expect(cl.eokOf(1234)).toBe(12.34);
    expect(cl.eokOf(333)).toBe(3.33);
    expect(cl.eokOf(1)).toBe(0.01);
    expect(cl.formatEok(1234)).toBe("12.34억");
    expect(cl.exactEokOf(333)).toBeCloseTo(3.33, 12);
    expect(cl.exactEokOf(333) * 100).toBeCloseTo(333, 9);
  });
  test("category suggestion by 해소 방식", () => {
    expect(cl.suggestCategory("build")).toEqual({ category: "capex", alternative: "labor", hint: null });
    expect(cl.suggestCategory("hire").category).toBe("labor");
    expect(cl.suggestCategory("partner").category).toBe("opex");
    expect(cl.suggestCategory("invest").category).toBe("capex");
    const unset = cl.suggestCategory(null);
    expect(unset.category).toBe("capex");
    expect(unset.hint).toContain("확인 필요");
  });
});

describe("derived lines: confirmed vs draft vs stale", () => {
  test("only cost > 0 rows are listed; confirmed non-stale is reflectable and pre-checked", () => {
    const v = cl.deriveCapabilityCostLines([src(), src({ id: "k0", closing_cost_krw_m: 0 }), src({ id: "kn", closing_cost_krw_m: null })], []);
    expect(v.lines.map((l) => l.capabilityKey)).toEqual(["k1"]);
    const l = v.lines[0];
    expect(l).toMatchObject({ state: "reflectable", stateLabel: "반영 가능", reflected: true, persisted: false, disabledReason: null, amountEok: 30, category: "capex", needsRejudge: false });
    expect(v.totals).toMatchObject({ capabilityKrwM: 3000, reflectedKrwM: 3000, reflectedCount: 1 });
  });
  test("draft (unconfirmed) is 참고(미반영), not checked, checkbox disabled with a reason", () => {
    const l = cl.deriveCapabilityCostLines([src({ confirmed_at: null })], []).lines[0];
    expect(l).toMatchObject({ state: "reference", stateLabel: "참고(미반영)", reflected: false });
    expect(l.disabledReason).toContain("확정");
  });
  test("stale judgement is 참고(미반영) with the re-judge reason", () => {
    const l = cl.deriveCapabilityCostLines([src({ stale: true, confirmed_at: null })], []).lines[0];
    expect(l.state).toBe("reference");
    expect(l.reflected).toBe(false);
    expect(l.disabledReason).toContain("재판정");
  });
  test("a stored explicit un-check is remembered even when the judgement is confirmed", () => {
    const l = cl.deriveCapabilityCostLines([src()], [{ source: "capability", capabilityKey: "k1", reflected: false, category: "opex", amount: 30 }]).lines[0];
    expect(l.reflected).toBe(false);
    expect(l.persisted).toBe(true);
    expect(l.category).toBe("opex");
  });
  test("a reflected line whose judgement went stale stays reflected and is flagged (OD-7), checkbox stays usable", () => {
    const v = cl.deriveCapabilityCostLines([src({ stale: true, confirmed_at: null })], [{ source: "capability", capabilityKey: "k1", reflected: true, category: "capex", amount: 30, basisHash: "c1:old" }]);
    expect(v.lines[0]).toMatchObject({ reflected: true, needsRejudge: true, disabledReason: null });
    expect(v.totals.needsRejudgeCount).toBe(1);
    expect(v.totals.reflectedKrwM).toBe(3000);
  });
  test("the amount follows the judgement and shows the previous amount once", () => {
    const row = src({ closing_cost_krw_m: 4000 });
    const l = cl.deriveCapabilityCostLines([row], [{ source: "capability", capabilityKey: "k1", reflected: true, category: "capex", amount: 30, basisHash: cl.costBasisHash(src()) }]).lines[0];
    expect(l.amountEok).toBe(40);
    expect(l.amountChanged).toBe(true);
    expect(l.previousAmountEok).toBe(30);
    expect(l.needsRejudge).toBe(true); // basis changed
  });
  test("orphans: deleted capability and zero-cost capability", () => {
    const v = cl.deriveCapabilityCostLines([src({ id: "z", closing_cost_krw_m: 0 })], [
      { source: "capability", capabilityKey: "gone", reflected: true, line: "옛 역량 역량 해소" },
      { source: "capability", capabilityKey: "z", reflected: true, line: "z" },
    ]);
    expect(v.orphans.map((o) => [o.capabilityKey, o.reason])).toEqual([["gone", "deleted"], ["z", "no_cost"]]);
  });
  test("basis hash changes with cost, months, resolution, grade and confirmation", () => {
    const base = cl.costBasisHash(src());
    for (const o of [{ closing_cost_krw_m: 1 }, { months_to_attain: 1 }, { resolution: "hire" as const }, { grade: "low" }, { confirmed_at: null }]) expect(cl.costBasisHash(src(o))).not.toBe(base);
    expect(cl.costBasisHash(src({ confirmed_at: "other-time" }))).toBe(base);
  });
});

describe("selection overlay and payload", () => {
  const view = cl.deriveCapabilityCostLines([src(), src({ id: "k2", capability: "채용", confirmed_at: null })], []);
  test("default-checked row is in the payload; reference row is not; explicit uncheck is remembered", () => {
    expect(cl.selectionPayload(cl.applySelection(view, {}), {}).map((p) => [p.capabilityKey, p.reflected])).toEqual([["k1", true]]);
    const sel = { k1: { reflected: false } };
    expect(cl.selectionPayload(cl.applySelection(view, sel), sel).map((p) => [p.capabilityKey, p.reflected])).toEqual([["k1", false]]);
    const cat = { k1: { category: "labor" as const } };
    expect(cl.applySelection(view, cat)[0].category).toBe("labor");
  });
});

describe("double-count heuristics (OD-6)", () => {
  test("containment either way, after normalising", () => {
    expect(cl.isLikelyDuplicate("정밀 가공", { line: "정밀가공 설비 투자" })).toBe(true);
    expect(cl.isLikelyDuplicate("정밀 가공 설비", { line: "정밀 가공" })).toBe(true);
    expect(cl.isLikelyDuplicate("Quality Cert", { line: "quality-cert (인증)" })).toBe(true);
  });
  test("token overlap >= 60%", () => {
    expect(cl.isLikelyDuplicate("해외 영업 인력 확보", { line: "영업 인력 해외 채용 비용" })).toBe(true); // 3 of 4 tokens
    expect(cl.isLikelyDuplicate("해외 영업 인력 확보", { line: "해외 물류 창고 임차" })).toBe(false); // 1 of 4
  });
  test("note names the capability", () => {
    expect(cl.isLikelyDuplicate("정밀 가공", { line: "초기 투자", note: "정밀 가공 라인 구축 포함" })).toBe(true);
    expect(cl.isLikelyDuplicate("정밀 가공", { line: "초기 투자", note: "일반 비고" })).toBe(false);
  });
  test("unrelated and too-short names do not match", () => {
    expect(cl.isLikelyDuplicate("정밀 가공", { line: "마케팅 비용" })).toBe(false);
    expect(cl.isLikelyDuplicate("가", { line: "가나다 비용" })).toBe(false);
  });
  test("warnings name both lines, skip capability entries, honour dismissals", () => {
    const l = [{ capabilityKey: "k1", name: "정밀 가공" }];
    const manual = [{ line: "정밀 가공 설비" }, { line: "정밀 가공 설비", dupDismissed: ["k1"] }, { line: "정밀 가공", source: "capability" }, { line: "임대료" }];
    const w = cl.findDuplicateWarnings(l, manual);
    expect(w).toEqual([{ capabilityKey: "k1", capabilityName: "정밀 가공", manualIndex: 0, manualLine: "정밀 가공 설비" }]);
  });
});

describe("totals", () => {
  test("capability, reflected, manual (annualised, confirmed units only, revenue and gov_rnd excluded) and grand total", () => {
    const view = cl.deriveCapabilityCostLines([src(), src({ id: "k2", capability: "채용", closing_cost_krw_m: 1234, confirmed_at: null })], []);
    const conf = { amountUnit: "krw_m" as const, amountUnitConfirmed: true };
    const t = cl.investmentTotals(view, new Set(["k1"]), [
      { category: "capex", amount: 500, currency: "KRW", period: "lumpsum", ...conf },
      { category: "opex", amount: 100, currency: "KRW", period: "monthly", ...conf },
      { category: "revenue", amount: 99, currency: "KRW", period: "yearly", ...conf },
      { category: "gov_rnd", amount: 7, currency: "KRW", period: "yearly", ...conf },
      { category: "capex", amount: 100, currency: "USD", period: "lumpsum", ...conf },
      { category: "opex", amount: 5, currency: "KRW", period: "yearly" }, // unconfirmed unit — excluded
    ]);
    expect(t).toMatchObject({
      capabilityKrwM: 4234, reflectedKrwM: 3000, manualKrwM: 6500, grandKrwM: 9500,
      manualLumpsumKrwM: 500, manualRecurringKrwM: 6000,
      manualExcludedNonKrw: 1, manualExcludedNeedsConfirm: 1,
      capabilityEok: 42.34, reflectedEok: 30, manualEok: 65, grandEok: 95, reflectedCount: 1,
    });
  });
});

describe("recurring cadence counts for every active year (monthly x12 x years)", () => {
  const view = { lines: [], orphans: [], totals: { capabilityKrwM: 0, reflectedKrwM: 0, reflectedCount: 0, needsRejudgeCount: 0 } } as any;
  const ln = (o: Record<string, unknown>) => ({ line: "x", category: "opex", amount: 10, amountUnit: "krw_m", amountUnitConfirmed: true, amountKrwM: 10, currency: "KRW", ...o }) as any;
  test("monthly opex over 3 years = 36 x A in totals, summary schedule, total and chart data", () => {
    const lines = [ln({ period: "monthly", startYear: 1, endYear: 3 })];
    const t = cl.investmentTotals(view, new Set(), lines, null, 3);
    expect(t.manualRecurringKrwM).toBe(360);
    expect(t.grandKrwM).toBe(360);
    const s = cl.buildInvestmentSummary(lines, [], 3, new Set());
    expect(s.schedule.map((r: any) => r.opex)).toEqual([120, 120, 120]);
    expect(s.totalKrwM).toBe(360);
    expect(s.totalKrwM).toBe(t.grandKrwM);
    expect(cl.buildInvestmentChartData(s).totalKrwM).toBe(360);
  });
  test("start/end window and horizon clamp apply to totals the same way as the summary", () => {
    const lines = [ln({ period: "monthly", startYear: 2, endYear: 9 })];
    const t = cl.investmentTotals(view, new Set(), lines, null, 3);
    expect(t.manualKrwM).toBe(240);
    expect(cl.buildInvestmentSummary(lines, [], 3, new Set()).totalKrwM).toBe(240);
  });
  test("one-off is unchanged and annual counts once per active year", () => {
    const lines = [ln({ period: "lumpsum", startYear: 2 }), ln({ period: "yearly", startYear: 1, endYear: 3 }), ln({ period: "quarterly" })];
    const t = cl.investmentTotals(view, new Set(), lines, null, 3);
    expect(t.manualLumpsumKrwM).toBe(10);
    expect(t.manualRecurringKrwM).toBe(30 + 120);
    expect(t.grandKrwM).toBe(160);
    expect(cl.buildInvestmentSummary(lines, [], 3, new Set()).totalKrwM).toBe(160);
  });
});

describe("server-side normalisation of posted lines", () => {
  const rows = [src(), src({ id: "k2", capability: "채용", resolution: "hire", closing_cost_krw_m: 800, confirmed_at: null })];
  const actor = { userId: "u1", at: NOW };
  const norm = (incoming: unknown, previous: unknown = null) => cl.normalizeBusinessCaseLines(incoming, rows, previous, actor);
  test("client amount is ignored when absent and rejected when different", () => {
    const ok = norm([{ source: "capability", capabilityKey: "k1", reflected: true, category: "capex" }]);
    expect(ok.ok && ok.lines[0]).toMatchObject({ line: "정밀 가공 역량 해소", amount: 3000, amountUnit: "krw_m", currency: "KRW", period: "lumpsum", source: "capability", capabilityKey: "k1", reflected: true, costKrwM: 3000, reflectedBy: "u1" });
    const exact = norm([{ source: "capability", capabilityKey: "k1", reflected: true, category: "capex", amount: 30 }]);
    expect(exact.ok).toBe(true);
    const bad = norm([{ source: "capability", capabilityKey: "k1", reflected: true, category: "capex", amount: 1 }]);
    expect(bad.ok === false && bad.error.code).toBe("amount_mismatch");
    const nan = norm([{ source: "capability", capabilityKey: "k1", reflected: true, amount: "30" }]);
    expect(nan.ok === false && nan.error.code).toBe("amount_mismatch");
  });
  test("unknown key, duplicate key, zero cost, invalid category, draft reflect are rejected", () => {
    expect((norm([{ source: "capability", capabilityKey: "nope", reflected: true }]) as any).error.code).toBe("unknown_capability");
    expect((norm([{ source: "capability", capabilityKey: "k1", reflected: true }, { source: "capability", capabilityKey: "k1", reflected: false }]) as any).error.code).toBe("unknown_capability");
    const zero = cl.normalizeBusinessCaseLines([{ source: "capability", capabilityKey: "k1", reflected: true }], [src({ closing_cost_krw_m: 0 })], null, actor);
    expect((zero as any).error.code).toBe("no_cost");
    expect((norm([{ source: "capability", capabilityKey: "k1", reflected: true, category: "revenue" }]) as any).error.code).toBe("invalid_category");
    expect((norm([{ source: "capability", capabilityKey: "k2", reflected: true }]) as any).error.code).toBe("not_reflectable");
    expect(norm([{ source: "capability", capabilityKey: "k2", reflected: false }]).ok).toBe(true); // an un-reflected draft entry is fine
  });
  test("a previously reflected stale line may stay reflected; reflect/unreflect/amount-followed events", () => {
    const staleRows = [src({ stale: true, confirmed_at: null, closing_cost_krw_m: 4000 })];
    const prev = [{ source: "capability", capabilityKey: "k1", reflected: true, category: "capex", amount: 30, reflectedBy: "old", reflectedAt: "t0" }];
    const r = cl.normalizeBusinessCaseLines([{ source: "capability", capabilityKey: "k1", reflected: true }], staleRows, prev, actor);
    expect(r.ok && r.lines[0]).toMatchObject({ amount: 4000, amountUnit: "krw_m", reflectedBy: "old", reflectedAt: "t0" });
    expect(r.ok && r.events.map((e) => e.action)).toEqual(["capability_cost.amount_followed"]);
    const un = cl.normalizeBusinessCaseLines([{ source: "capability", capabilityKey: "k1", reflected: false }], staleRows, prev, actor);
    expect(un.ok && un.events.map((e) => e.action)).toEqual(["capability_cost.unreflect"]);
    const re = norm([{ source: "capability", capabilityKey: "k1", reflected: true }]);
    expect(re.ok && re.events.map((e) => e.action)).toEqual(["capability_cost.reflect"]);
  });
  test("manual lines pass through without silent conversion; unknown units are rejected; dismissals are audited", () => {
    const r = norm([{ line: "임대료", category: "opex", amount: 2, period: "yearly", currency: "KRW", reflected: true, basisHash: "x", dupDismissed: ["k1"] }]);
    expect(r.ok && r.lines[0]).toEqual({ line: "임대료", category: "opex", amount: 2, amountUnit: undefined, amountUnitConfirmed: false, amountKrwM: null, period: "yearly", currency: "KRW", dupDismissed: ["k1"] });
    const bad = norm([{ line: "x", category: "opex", amount: 1, amountUnit: "yard", currency: "KRW", period: "yearly" }]);
    expect(bad.ok === false && bad.error.code).toBe("invalid_amount_unit");
    expect(r.ok && r.events.map((e) => e.action)).toEqual(["capability_cost.dup_dismissed"]);
    expect((norm("x") as any).error.code).toBe("invalid_request");
  });
});

describe("promotion split", () => {
  test("reflected:false skipped, reflected become exact 백만원, orphans skipped, stale flagged, manual untouched", () => {
    const rows = [src({ closing_cost_krw_m: 333 }), src({ id: "k2", capability: "채용", resolution: "hire", closing_cost_krw_m: 800, stale: true, confirmed_at: null })];
    const s = cl.splitForPromotion([
      { line: "수동", category: "opex", amount: 1, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly" },
      { line: "미확인", category: "opex", amount: 1 }, // legacy unit-less: skipped as unit_unconfirmed
      { source: "capability", capabilityKey: "k1", reflected: true, category: "capex", basisHash: cl.costBasisHash(rows[0]) },
      { source: "capability", capabilityKey: "k2", reflected: true, category: "labor", basisHash: "old" },
      { source: "capability", capabilityKey: "k3", reflected: true, category: "capex" },
      { source: "capability", capabilityKey: "k1x", reflected: false, category: "capex" },
    ], rows);
    expect(s.manual).toHaveLength(1);
    expect(s.skippedManual).toEqual([{ line: "미확인", reason: "unit_unconfirmed" }]);
    expect(s.skipped).toEqual(["k3"]);
    expect(s.capability[0]).toMatchObject({ krwM: 333, category: "capex", name: "정밀 가공 역량 해소" });
    expect(s.capability[0].note).toContain("역량 해소 비용");
    expect(s.capability[0].note).not.toContain("재판정");
    expect(s.capability[1].note).toContain("재판정 필요");
  });
  test("horizon from plan_meta (7) or default 5; capability startYear = override else OD-6 default", () => {
    const rows = [src({ months_to_attain: 30 })]; // ceil(30/12) = 3 — the OD-6 default
    const withMeta = cl.splitForPromotion([
      { source: "plan_meta", horizonYears: 7 },
      { source: "capability", capabilityKey: "k1", reflected: true, category: "capex", basisHash: cl.costBasisHash(rows[0]) },
    ], rows);
    expect(withMeta.horizon).toBe(7);
    expect(withMeta.manual).toHaveLength(0); // the meta entry never becomes a manual line
    expect(withMeta.capability[0].startYear).toBe(3);
    const overridden = cl.splitForPromotion([
      { source: "capability", capabilityKey: "k1", reflected: true, category: "capex", basisHash: cl.costBasisHash(rows[0]), startYear: 5 },
    ], rows);
    expect(overridden.horizon).toBe(5); // no meta -> default
    expect(overridden.capability[0].startYear).toBe(5);
    const unknownMonths = cl.splitForPromotion(
      [{ source: "capability", capabilityKey: "k1", reflected: true, category: "capex", basisHash: cl.costBasisHash(rows[0]) }],
      [src({ months_to_attain: null })],
    );
    expect(unknownMonths.capability[0].startYear).toBe(1);
  });
  test("manual lines keep their spending window; lumpsum endYear = startYear; invalid meta horizon falls back to 5", () => {
    const s = cl.splitForPromotion([
      { source: "plan_meta", horizonYears: 99 }, // out of bounds -> ignored by readers
      { line: "반복", category: "opex", amount: 1, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly", startYear: 2, endYear: 4 },
      { line: "일시", category: "capex", amount: 5, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "lumpsum", startYear: 3 },
    ], []);
    expect(s.horizon).toBe(5);
    const [recurring, lump] = s.manual as Array<{ line: string; startYear?: number; endYear?: number }>;
    expect(recurring).toMatchObject({ line: "반복", startYear: 2, endYear: 4 });
    expect(lump).toMatchObject({ line: "일시", startYear: 3 });
    expect(lump.endYear).toBeUndefined(); // unset — the promotion insert derives end_year = start_year for lump sums
  });
});

// ── DB-backed: routes, persistence, promotion, milestones ───────────────────
const LEAD = "ccl-lead";
const VIEWER = "ccl-viewer";
let leadCookie = "";
let viewerCookie = "";
let oppId = "";
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: json({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
const gfUrl = (id = oppId) => `/api/greenfield/${id}`;
const attUrl = (id = oppId) => `/api/opportunities/${id}/capability-attainability`;
const getGf = async (id = oppId) => ((await (await req(gfUrl(id), { headers: { cookie: leadCookie } })).json()) as any).data;
const postGf = (body: unknown, id = oppId, cookie = leadCookie) => req(gfUrl(id), { method: "POST", headers: { cookie }, body: json(body) });
const putAtt = (rows: unknown[], id = oppId) => req(attUrl(id), { method: "PUT", headers: { cookie: leadCookie }, body: json({ rows }) });
const confirmAtt = (id = oppId) => req(`${attUrl(id)}/confirm`, { method: "POST", headers: { cookie: leadCookie }, body: json({}) });
const storedLines = (id = oppId) => JSON.parse((db.query("SELECT business_case_lines_json j FROM greenfield_assessment WHERE opportunity_id = ?").get(id) as { j: string }).j) as any[];
const storedRows = (id = oppId) => cg.parseGapRegister((db.query("SELECT capability_gap_json j FROM opportunity WHERE id = ?").get(id) as { j: string }).j).rows;

function makeOpp(name: string, rows: unknown[]): string {
  const id = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [id, name, "산업", "selected", LEAD, NOW]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), id, "greenfield", "test", "대안 검토", LEAD, NOW]);
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [ulid(), id, "직접 진출", "M&A 대안", "test", LEAD, NOW, NOW],
  );
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows, updatedAt: NOW }), id]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", id, gate, "go", "t", LEAD, NOW]);
  }
  return id;
}
const gapRows = () => [
  { id: "r1", capability: "정밀 가공", source: "manual", held: { status: "none" }, requiredLevel: "숙련", currentLevel: "" },
  { id: "r2", capability: "품질 인증", source: "manual", held: { status: "none" }, requiredLevel: "실무", currentLevel: "" },
  { id: "r3", capability: "영업 인력", source: "manual", held: { status: "none" }, requiredLevel: "실무", currentLevel: "" },
];

beforeAll(async () => {
  for (const [id, role] of [[LEAD, "analyst"], [VIEWER, "viewer"]] as const) {
    await createUser(db, { userId: id, role, password: `pw-${id}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: id, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  leadCookie = await loginCookie(LEAD, `pw-${LEAD}-12345`);
  viewerCookie = await loginCookie(VIEWER, `pw-${VIEWER}-12345`);
  oppId = makeOpp("cost 기회", gapRows());
});

describe("routes: derived view, save, tamper rejection, round trip", () => {
  test("judgements: r1 confirmed (3000), r2 draft (1234), r3 no cost; GET derives the lines without storing anything", async () => {
    const res = await putAtt([
      { id: "r1", resolution: "build", expectedLevel: "자체 라인 가동", closingCostKrwM: 3000, monthsToAttain: 12, grade: "medium", category: "capex" },
      { id: "r3", resolution: "hire", expectedLevel: "팀 구성", monthsToAttain: 6, grade: "medium" },
    ]);
    expect(res.status).toBe(200);
    expect((await confirmAtt()).status).toBe(200);
    expect((await putAtt([{ id: "r2", resolution: "partner", expectedLevel: "제휴", closingCostKrwM: 1234, monthsToAttain: 9, grade: "medium" }])).status).toBe(200);
    const d = await getGf();
    const byKey = Object.fromEntries(d.capability_cost_lines.lines.map((l: any) => [l.capabilityKey, l]));
    expect(Object.keys(byKey).sort()).toEqual(["r1", "r2"]);
    expect(byKey.r1).toMatchObject({ state: "reflectable", reflected: true, amountEok: 30, category: "capex", resolutionLabel: "직접 구축" });
    expect(byKey.r2).toMatchObject({ state: "reference", reflected: false, amountEok: 12.34, category: "opex" });
    expect(d.assessment.business_case_lines).toBeNull(); // nothing stored yet
  });

  test("save reflects r1; the stored entry is server-built; amount, hash, user are stamped", async () => {
    const res = await postGf({ business_case_lines: [
      { line: "초기 인건비", category: "labor", amount: 3, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly" },
      { source: "capability", capabilityKey: "r1", reflected: true, category: "capex", line: "임의 이름", amount: 30 },
    ] });
    expect(res.status).toBe(200);
    const lines = storedLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ line: "초기 인건비", category: "labor", amount: 3, amountUnit: "krw_m", amountUnitConfirmed: true, amountKrwM: 3, currency: "KRW", period: "yearly" });
    expect(lines[1]).toMatchObject({ line: "정밀 가공 역량 해소", source: "capability", capabilityKey: "r1", reflected: true, amount: 3000, amountUnit: "krw_m", currency: "KRW", period: "lumpsum", costKrwM: 3000, reflectedBy: LEAD });
    expect(lines[1].basisHash).toMatch(/^c2:/);
    const audit = db.query("SELECT action FROM audit_log WHERE action LIKE 'capability_cost.%' ORDER BY created_at").all() as Array<{ action: string }>;
    expect(audit.map((a) => a.action)).toContain("capability_cost.reflect");
    const d = await getGf();
    expect(d.capability_cost_lines.lines.find((l: any) => l.capabilityKey === "r1")).toMatchObject({ reflected: true, persisted: true, needsRejudge: false });
    expect(d.capability_cost_lines.totals.reflectedKrwM).toBe(3000);
  });

  test("tampered amount, unknown key, draft reflect, bad category and viewer writes are rejected", async () => {
    const code = async (lines: unknown[], cookie = leadCookie) => { const r = await postGf({ business_case_lines: lines }, oppId, cookie); return { status: r.status, code: ((await r.json()) as any).error?.code }; };
    expect(await code([{ source: "capability", capabilityKey: "r1", reflected: true, amount: 1 }])).toEqual({ status: 400, code: "amount_mismatch" });
    expect(await code([{ source: "capability", capabilityKey: "zzz", reflected: true }])).toEqual({ status: 400, code: "unknown_capability" });
    expect(await code([{ source: "capability", capabilityKey: "r3", reflected: false }])).toEqual({ status: 400, code: "no_cost" });
    expect(await code([{ source: "capability", capabilityKey: "r2", reflected: true }])).toEqual({ status: 400, code: "not_reflectable" });
    expect(await code([{ source: "capability", capabilityKey: "r1", reflected: true, category: "gov_rnd" }])).toEqual({ status: 400, code: "invalid_category" });
    expect((await code([], viewerCookie)).status).toBe(403);
    expect(storedLines()).toHaveLength(2); // unchanged by the rejected saves
  });

  test("the amount follows a changed judgement; a stale reflected line stays reflected and flagged", async () => {
    expect((await putAtt([{ id: "r1", closingCostKrwM: 4000 }])).status).toBe(200);
    let d = await getGf();
    let l = d.capability_cost_lines.lines.find((x: any) => x.capabilityKey === "r1");
    expect(l).toMatchObject({ amountEok: 40, amountChanged: true, previousAmountEok: 30, reflected: true, needsRejudge: true, state: "reference" });
    expect(l.disabledReason).toBeNull(); // already reflected, so it can still be un-checked
    // the old amount is now a mismatch; the new one saves and is audited as followed
    const old = await postGf({ business_case_lines: [{ source: "capability", capabilityKey: "r1", reflected: true, amount: 30 }] });
    expect(old.status).toBe(400);
    expect((await postGf({ business_case_lines: [{ source: "capability", capabilityKey: "r1", reflected: true }] })).status).toBe(200);
    expect(storedLines()[0]).toMatchObject({ amount: 4000, amountUnit: "krw_m", costKrwM: 4000 });
    expect((db.query("SELECT count(*) c FROM audit_log WHERE action = 'capability_cost.amount_followed'").get() as { c: number }).c).toBe(1);
    // an S3 change makes the judgement stale: stays reflected, flagged
    const s3 = ((await (await req(`/api/opportunities/${oppId}/capability-gap`, { headers: { cookie: leadCookie } })).json()) as any).data.rows;
    const edited = s3.map((x: any) => (x.id === "r1" ? { ...x, requiredNote: "S3에서 요건 변경" } : x));
    expect((await req(`/api/opportunities/${oppId}/capability-gap`, { method: "PUT", headers: { cookie: leadCookie }, body: json({ rows: edited }) })).status).toBe(200);
    d = await getGf();
    l = d.capability_cost_lines.lines.find((x: any) => x.capabilityKey === "r1");
    expect(l).toMatchObject({ reflected: true, stale: true, needsRejudge: true });
    expect(d.capability_cost_lines.totals.needsRejudgeCount).toBe(1);
  });

  test("un-checking stores reflected:false (remembered); manual-only saves keep working", async () => {
    expect((await postGf({ business_case_lines: [{ source: "capability", capabilityKey: "r1", reflected: false }] })).status).toBe(200);
    expect(storedLines()).toHaveLength(1);
    expect(storedLines()[0]).toMatchObject({ capabilityKey: "r1", reflected: false });
    expect((await getGf()).capability_cost_lines.lines.find((x: any) => x.capabilityKey === "r1").reflected).toBe(false);
    expect((await postGf({ entry_strategy: "다시 저장" })).status).toBe(200); // lines omitted: stored value kept
    expect(storedLines()).toHaveLength(1);
    expect((await db.query("SELECT count(*) c FROM audit_log WHERE action = 'capability_cost.unreflect'").get() as { c: number }).c).toBe(1);
  });
});

describe("promotion copy", () => {
  test("reflected capability lines are exact 백만원 lump sums in year 1; unreflected skipped; manual lines behave as before", () => {
    const id = makeOpp("promo 기회", gapRows());
    // confirmed judgements straight into the register (hash stamped by the confirm path elsewhere; here: no basisHash = not stale)
    const rows = gapRows().map((r, i) => ({
      ...r,
      resolution: i === 0 ? "build" : "hire",
      attainability: { closingCostKrwM: [333, 800, 0][i], monthsToAttain: 6, grade: "medium", rationale: "", evidence: [], draftedBy: "human", confirmedBy: LEAD, confirmedAt: NOW },
    }));
    db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows, updatedAt: NOW }), id]);
    db.run("UPDATE greenfield_assessment SET business_case_lines_json = ? WHERE opportunity_id = ?", [json([
      { line: "생산설비", category: "capex", amount: 1200, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "lumpsum" },
      { line: "라이선스", category: "opex", amount: 200, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "monthly" },
      { line: "단위 미확인 항목", category: "opex", amount: 5, currency: "KRW", period: "yearly" }, // legacy — not copied
      { line: "정밀 가공 역량 해소", source: "capability", capabilityKey: "r1", reflected: true, category: "capex", amount: 3.33, currency: "KRW", period: "lumpsum" },
      { line: "품질 인증 역량 해소", source: "capability", capabilityKey: "r2", reflected: false, category: "opex", amount: 8, currency: "KRW", period: "lumpsum" },
      { line: "삭제된", source: "capability", capabilityKey: "gone", reflected: true, category: "opex", amount: 9, currency: "KRW", period: "lumpsum" },
    ]), id]);
    const p = promoteOpportunity(id, { promotedBy: LEAD, needToKnowBasis: "ccl test" });
    const model = db.query("SELECT id FROM business_case_model WHERE project_id = ?").get(p.project.id) as { id: string };
    const lines = db.query("SELECT category, name, annual_amount_krw_m a, start_year, note FROM business_case_line WHERE model_id = ? ORDER BY name").all(model.id) as any[];
    const by = Object.fromEntries(lines.map((l) => [l.name, l]));
    expect(Object.keys(by).sort()).toEqual(["라이선스", "생산설비", "정밀 가공 역량 해소"].sort());
    expect(by["생산설비"].a).toBe(1200);
    expect(by["라이선스"].a).toBe(2400);
    expect(by["정밀 가공 역량 해소"]).toMatchObject({ a: 333, start_year: 1, category: "capex" }); // exact, not 3.33 x 100
    expect(by["정밀 가공 역량 해소"].note).toContain("역량 해소 비용");
    expect(by["정밀 가공 역량 해소"].note).toContain("일시불 총액");
    expect((db.query("SELECT count(*) c FROM audit_log WHERE action = 'capability_cost.promotion_skipped'").get() as { c: number }).c).toBe(1);
    expect((db.query("SELECT count(*) c FROM audit_log WHERE action = 'greenfield_cost.promotion_skipped' AND target LIKE '%unit_unconfirmed%'").get() as { c: number }).c).toBe(1);
  });

  test("a model is still created when only reflected capability lines exist", () => {
    const id = makeOpp("promo2 기회", gapRows());
    const rows = gapRows().map((r) => ({ ...r, resolution: "partner", attainability: { closingCostKrwM: 500, monthsToAttain: null, grade: "medium", rationale: "", evidence: [], draftedBy: "human", confirmedBy: LEAD, confirmedAt: NOW } }));
    db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows, updatedAt: NOW }), id]);
    db.run("UPDATE greenfield_assessment SET business_case_lines_json = ? WHERE opportunity_id = ?", [json([{ source: "capability", capabilityKey: "r2", reflected: true, category: "opex", amount: 5 }]), id]);
    const p = promoteOpportunity(id, { promotedBy: LEAD, needToKnowBasis: "ccl test" });
    const n = db.query("SELECT count(*) c FROM business_case_line l JOIN business_case_model m ON m.id = l.model_id WHERE m.project_id = ?").get(p.project.id) as { c: number };
    expect(n.c).toBe(1);
  });
});

describe("milestone candidates", () => {
  test("derived from the judgement (name, months, resolution, hash) and stored on the S3 row by the S5 save", () => {
    const r1 = storedRows().find((x) => x.id === "r1")!;
    expect(r1.attainability?.milestoneCandidate).toMatchObject({ name: "정밀 가공 해소", months: 12, resolution: "build", rowId: "r1" });
    expect(r1.attainability?.milestoneCandidate?.derivedFromHash).toBe(cl.milestoneDerivedHash(r1, 12));
    expect(storedRows().find((x) => x.id === "r2")!.attainability?.milestoneCandidate).toMatchObject({ name: "품질 인증 해소", months: 9, resolution: "partner" });
  });
  test("a client-supplied candidate is not read (S5 PUT patches ignore unknown keys)", async () => {
    expect((await putAtt([{ id: "r3", milestoneCandidate: { name: "위조", months: 1, rowId: "r3" }, monthsToAttain: 6, resolution: "hire" }])).status).toBe(200);
    expect(storedRows().find((x) => x.id === "r3")!.attainability?.milestoneCandidate).toMatchObject({ name: "영업 인력 해소", months: 6 });
  });
  test("a changed judgement updates the candidate; clearing months removes it", async () => {
    expect((await putAtt([{ id: "r2", monthsToAttain: 15 }])).status).toBe(200);
    expect(storedRows().find((x) => x.id === "r2")!.attainability?.milestoneCandidate).toMatchObject({ months: 15 });
    expect((await putAtt([{ id: "r2", monthsToAttain: null }])).status).toBe(200);
    expect(storedRows().find((x) => x.id === "r2")!.attainability?.milestoneCandidate).toBeUndefined();
  });
  test("read views expose milestone_candidate; a stale judgement keeps its candidate flagged", async () => {
    const d = await getGf();
    const names = d.milestone_candidates.map((m: any) => m.name).sort();
    expect(names).toEqual(["영업 인력 해소", "정밀 가공 해소"]);
    const r1 = d.milestone_candidates.find((m: any) => m.rowId === "r1");
    expect(r1).toMatchObject({ months: 12, stale: true, stored: true, outdated: false }); // r1 went stale in the cost test
    const view = ((await (await req(attUrl(), { headers: { cookie: leadCookie } })).json()) as any).data;
    expect(view.rows.find((r: any) => r.id === "r3").milestone_candidate).toMatchObject({ name: "영업 인력 해소", months: 6, stale: false });
    expect(view.rows.find((r: any) => r.id === "r2").milestone_candidate).toBeNull();
  });
  test("legacy row without a stored candidate gets a live (not stored) one", () => {
    const [row] = cg.normalizeGapRows([{ id: "L", capability: "레거시", resolution: "invest", attainability: { monthsToAttain: 4, grade: "medium", rationale: "" } }]);
    expect(row.attainability?.milestoneCandidate).toBeUndefined();
    expect(att.rowView(row).milestone_candidate).toMatchObject({ name: "레거시 해소", months: 4, stored: false });
  });
  test("normalize round-trips the candidate and drops malformed ones", () => {
    const [ok] = cg.normalizeGapRows([{ capability: "c", attainability: { grade: "medium", milestoneCandidate: { name: "c 해소", months: 3, resolution: "hire", rowId: "x", derivedFromHash: "h" } } }]);
    expect(ok.attainability?.milestoneCandidate).toEqual({ name: "c 해소", months: 3, resolution: "hire", rowId: "x", derivedFromHash: "h" });
    const [bad] = cg.normalizeGapRows([{ capability: "c", attainability: { grade: "medium", milestoneCandidate: { name: "", months: 0 } } }]);
    expect(bad.attainability?.milestoneCandidate).toBeUndefined();
  });
});

describe("S5 UI structure", () => {
  const stage = readFileSync(join(WEB, "components/stages/GreenfieldStage.tsx"), "utf8");
  const block = readFileSync(join(WEB, "components/stages/CapabilityCostBlock.tsx"), "utf8");
  test("the derived block sits below the unified item table (decider: AI reco, table, capability costs, summary last) inside the investment tab and the payload carries only the person's choices", () => {
    const sec = stage.indexOf("투자비 항목 (S8 사업성 분석 입력)");
    expect(sec).toBeGreaterThan(0);
    expect(stage.indexOf("data-testid=\"invest-summary\"")).toBeGreaterThan(stage.indexOf("<CapabilityCostBlock"));
    expect(stage.indexOf("<CapabilityCostBlock", sec)).toBeGreaterThan(sec);
    expect(stage.indexOf("<CapabilityCostBlock")).toBeGreaterThan(stage.indexOf("unifiedRows.map"));
    expect(stage).toContain("selectionPayload(capLines, capSel)");
    expect(stage).toContain("onRowsChange={setAttRows}");
  });
  test("block copy: titles, checkbox label, status chips, disabled reason wiring, totals, warning, candidates", () => {
    for (const s of ["역량 해소 비용 (S5 판정에서 연동)", "투자비에 반영", "재판정 필요", "수동 항목 유지", "투자비 검토 합계", "역량 해소 비용 합계", "반영 합계", "수동 입력 합계", "달성 기간", "해소 방식"]) expect(block + readFileSync(join(WEB, "lib/capability-cost-lines.ts"), "utf8")).toContain(s);
    expect(block).toContain("aria-describedby");
    expect(block).toContain("MILESTONE_BLOCK_TITLE");
    expect(cl.MILESTONE_BLOCK_TITLE).toBe("마일스톤 후보 (사후관리 연동 예정)");
    expect(cl.MILESTONE_START_NOTE).toContain("S11 기준선");
    expect(cl.CAPABILITY_BLOCK_TITLE).toBe("역량 해소 비용 (S5 판정에서 연동)");
  });
  test("rendered markup: read-only lines, disabled checkbox with reason, flags, totals, warning, candidate list", async () => {
    const { renderToStaticMarkup } = await import("../../app/web-next/node_modules/react-dom/server.js");
    const { createElement } = await import("../../app/web-next/node_modules/react/index.js");
    const { CapabilityCostBlock } = await import("../../app/web-next/components/stages/CapabilityCostBlock.tsx");
    const view = cl.deriveCapabilityCostLines([src(), src({ id: "k2", capability: "채용", resolution: "hire", closing_cost_krw_m: 1234, confirmed_at: null })], []);
    const lines = cl.applySelection(view, {});
    const totals = cl.investmentTotals(view, new Set(["k1"]), [{ category: "capex", amount: 5, currency: "KRW", period: "lumpsum" }]); // unconfirmed unit: excluded
    const warnings = cl.findDuplicateWarnings(lines.filter((l) => l.reflected), [{ line: "정밀 가공 설비" }]);
    const html = renderToStaticMarkup(createElement(CapabilityCostBlock, {
      lines, orphans: [], totals, warnings, canAct: true,
      candidates: [{ name: "정밀 가공 해소", months: 12, resolution: "build", rowId: "k1", derivedFromHash: "h", stale: true, outdated: false, stored: true }],
      onToggle: () => {}, onCategory: () => {}, onDismiss: () => {},
    }));
    expect(html).toContain("역량 해소 비용 (S5 판정에서 연동)");
    expect(html).toContain("3,000백만원");
    expect(html).toContain("1,234백만원");
    expect(html).toContain("금액 (단위: 백만원)");
    expect(html).toContain("반영 가능");
    expect(html).toContain("참고(미반영)");
    const input = (name: string) => html.match(new RegExp(`<input[^>]*aria-label="${name} 투자비에 반영"[^>]*>`))![0];
    expect(input("채용")).toContain("disabled");
    expect(input("채용")).toContain("aria-describedby");
    expect(input("정밀 가공")).not.toContain("disabled");
    expect(input("정밀 가공")).toContain("checked");
    expect(html).toContain("확정");
    expect(html).toContain("투자비 검토 합계");
    expect(html).toContain("3,000백만원"); // grand = capability only; the unconfirmed manual line is excluded
    expect(html).toContain("확인 필요 1건 제외");
    expect(html).toContain("중복 가능성");
    expect(html).toContain("수동 항목 유지");
    expect(html).toContain("마일스톤 후보 (사후관리 연동 예정)");
    expect(html).toContain("12개월");
    expect(html).toContain("S11 기준선");
    // read-only: no amount input in the block
    expect(html).not.toContain('type="number"');
  });
});

describe("unified investment item list", () => {
  const view = cl.deriveCapabilityCostLines([src({ id: "k1" }), src({ id: "k2", capability: "인증", closing_cost_krw_m: 500, confirmed_at: null })], [
    { source: "capability", capabilityKey: "k1", reflected: true, category: "capex", amount: 3000, amountUnit: "krw_m", basisHash: "x" },
  ]);
  const manual = [{ line: "설비", category: "capex", amount: 100, amountUnit: "krw_m", amountUnitConfirmed: true, amountKrwM: 100, currency: "KRW", period: "lumpsum" }];
  test("reflected capability lines follow manual lines with name, note and footer sum equal to investmentTotals", () => {
    const capLines = cl.applySelection(view, {});
    const states = cl.lineSaveStates(capLines, [{ source: "capability", capabilityKey: "k1", reflected: true, category: "capex" }], {});
    const rows = cl.unifiedInvestmentRows(manual, capLines, {}, states);
    expect(rows.map((r) => r.kind)).toEqual(["manual", "capability"]);
    const cap = rows[1] as Extract<(typeof rows)[number], { kind: "capability" }>;
    expect(cap.name).toBe("정밀 가공 (역량 해소)");
    expect(cap.note).toBe("S5 판정에서 연동 · 해소 방식 직접 구축 · 기간 12개월");
    expect(cap.saveState).toBe("saved");
    const totals = cl.investmentTotals(view, new Set(capLines.filter((l) => l.reflected).map((l) => l.capabilityKey)), manual);
    expect(cl.unifiedFooter(rows, totals).text).toBe(`항목 2건 · 합계 ${cl.formatKrwM(totals.grandKrwM)}`);
    expect(totals.grandKrwM).toBe(3100);
  });
  test("unchecked saved line stays listed as pending removal and is not counted; unreflected lines are absent", () => {
    const sel = { k1: { reflected: false } };
    const rows = cl.unifiedInvestmentRows([], cl.applySelection(view, sel), sel);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { pendingRemoval: boolean }).pendingRemoval).toBe(true);
    expect(cl.unifiedFooter(rows, { grandKrwM: 0 }).count).toBe(0);
  });
  test("stale reflected line keeps the rejudge flag", () => {
    const v = cl.deriveCapabilityCostLines([src({ id: "k1", stale: true, confirmed_at: null })], [{ source: "capability", capabilityKey: "k1", reflected: true, basisHash: "x" }]);
    const rows = cl.unifiedInvestmentRows([], cl.applySelection(v, {}), {});
    expect((rows[0] as { needsRejudge: boolean }).needsRejudge).toBe(true);
  });
  test("GreenfieldStage renders the unified list with chips, actions and footer; counter counts reflected lines", () => {
    const stage = readFileSync(join(WEB, "components/stages/GreenfieldStage.tsx"), "utf8");
    for (const s of ["unifiedInvestmentRows", "역량 해소 연동", "판정 보기", "반영 해제", "저장 전", "재판정 필요", "invest-item-footer", "역량 해소 비용에서 반영한 항목은 이 목록에 포함됩니다", "reflectedLines.length > 0"]) expect(stage).toContain(s);
  });
});


describe("judgement-owned category and spend years (ADR-0173 amendment 2026-10-15)", () => {
  test("category precedence: judgement > stored overlay > 해소 방식 suggestion; the hint shows only when the judgement is silent", () => {
    const judged = cl.deriveCapabilityCostLines([src({ category: "labor" })], [{ source: "capability", capabilityKey: "k1", reflected: true, category: "opex", amount: 30 }]).lines[0];
    expect(judged).toMatchObject({ category: "labor", judgementCategory: "labor", categoryHint: null });
    const fromOverlay = cl.deriveCapabilityCostLines([src()], [{ source: "capability", capabilityKey: "k1", reflected: true, category: "opex", amount: 30 }]).lines[0];
    // the stored overlay answers the category for now, but the hint stays until the judgement itself carries one
    expect(fromOverlay).toMatchObject({ category: "opex", judgementCategory: null });
    expect(fromOverlay.categoryHint).toContain("분류 미입력");
    const guessed = cl.deriveCapabilityCostLines([src()], []).lines[0];
    expect(guessed).toMatchObject({ category: "capex", judgementCategory: null });
    expect(guessed.categoryHint).toContain("분류 미입력");
    const noResolution = cl.deriveCapabilityCostLines([src({ resolution: null })], []).lines[0];
    expect(noResolution.categoryHint).toContain("확인 필요");
  });
  test("endYear: a 12-month spend starting Y1 ends Y1; 18 months ends Y2; unset months end the start year", () => {
    expect(cl.capabilityEndYearOf(1, 12)).toBe(1);
    expect(cl.capabilityEndYearOf(1, 18)).toBe(2);
    expect(cl.capabilityEndYearOf(2, 36)).toBe(4);
    expect(cl.capabilityEndYearOf(1, null)).toBe(1);
    expect(cl.capabilityEndYearOf(1, 0)).toBe(1);
    // derive: 18개월 defaults to start year 2, so the spend ends year 3
    expect(cl.deriveCapabilityCostLines([src({ months_to_attain: 18 })], []).lines[0]).toMatchObject({ defaultStartYear: 2, endYear: 3 });
  });
  test("basis hash: c2 covers the category; a legacy c1 hash of the same basis still matches (no false 재판정 필요)", () => {
    const row = src({ category: "labor" });
    const c2 = cl.costBasisHash(row);
    expect(c2.startsWith("c2:")).toBe(true);
    expect(cl.basisHashMatches(c2, row)).toBe(true);
    expect(cl.basisHashMatches(c2, src({ category: "opex" }))).toBe(false);
    // a legacy hash, recomputed the pre-amendment way, still matches the same basis
    const legacy = `c1:${new Bun.CryptoHasher("sha256").update(JSON.stringify({ cost: row.closing_cost_krw_m, months: row.months_to_attain, resolution: row.resolution, grade: row.grade, confirmed: row.confirmed_at !== null })).digest("hex").slice(0, 16)}`;
    expect(cl.basisHashMatches(legacy, row)).toBe(true);
    const kept = cl.deriveCapabilityCostLines([row], [{ source: "capability", capabilityKey: "k1", reflected: true, category: "labor", amount: 30, basisHash: legacy }]).lines[0];
    expect(kept.needsRejudge).toBe(false);
    const flagged = cl.deriveCapabilityCostLines([row], [{ source: "capability", capabilityKey: "k1", reflected: true, category: "labor", amount: 30, basisHash: "c1:stale" }]).lines[0];
    expect(flagged.needsRejudge).toBe(true);
  });
});

describe("linked-line cadence and re-reflect listing (2026-10-18 decider asks)", () => {
  const crows = [src(), src({ id: "k2", capability: "채용", resolution: "hire", closing_cost_krw_m: 800, confirmed_at: null })];
  const actor = { userId: "u1", at: NOW };

  test("capabilityYearVector: 일시불 = 총액 at startYear; 연간 = 연간 금액 from startYear through the horizon", () => {
    const lump = cl.capabilityYearVector({ startYear: 2, period: "lumpsum", costKrwM: 100 }, 5);
    expect(lump).toEqual([0, 100, 0, 0, 0]);
    const yearly = cl.capabilityYearVector({ startYear: 2, period: "yearly", costKrwM: 100 }, 5);
    expect(yearly).toEqual([0, 100, 100, 100, 100]);
  });

  test("investmentTotals spreads a yearly linked line and counts it as recurring", () => {
    const stored = [{ line: "A 역량 해소", category: "opex", amount: 100, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly", note: "n", source: "capability", capabilityKey: "k1", reflected: true, basisHash: cl.costBasisHash(crows[0]), costKrwM: 100 }];
    const view = cl.deriveCapabilityCostLines(crows, stored);
    // The linked amount follows the JUDGEMENT (3000/년) — 연간 주기면 그 금액이 검토 기간까지 반복된다.
    const summary = cl.buildInvestmentSummary([], view.lines, 5, new Set(["k1"]));
    expect(summary.schedule.map((r: { opex: number }) => r.opex)).toEqual([3000, 3000, 3000, 3000, 3000]);
    expect(summary.annualRecurringKrwM).toBeGreaterThanOrEqual(3000);
  });

  test("a saved-unreflected linked row stays listed (savedUnreflected) so a 다시 반영 is possible in place", () => {
    const stored = [{ line: "A 역량 해소", category: "opex", amount: 100, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "lumpsum", note: "n", source: "capability", capabilityKey: "k1", reflected: false, basisHash: cl.costBasisHash(crows[0]), costKrwM: 100 }];
    const view = cl.deriveCapabilityCostLines(crows, stored);
    const rowsOut = cl.unifiedInvestmentRows([], view.lines, {});
    const unreflected = rowsOut.find((r) => r.kind === "capability" && r.capabilityKey === "k1");
    expect(unreflected).toBeDefined();
    expect((unreflected as { savedUnreflected?: boolean }).savedUnreflected).toBe(true);
    // The real save path overlays the selection first (applySelection), then reflects the payload.
    const overlaid = cl.applySelection(view, { k1: { reflected: true } });
    const payload = cl.selectionPayload(overlaid, { k1: { reflected: true } });
    expect(payload.find((p) => p.capabilityKey === "k1")?.reflected).toBe(true);
    expect(payload.find((p) => p.capabilityKey === "k1")?.period).toBe("lumpsum");
  });

  test("the server rejects an unknown cadence and stores 연간 when valid", () => {
    const bad = cl.normalizeBusinessCaseLines(
      [{ source: "capability", capabilityKey: "k1", reflected: true, category: "opex", amount: 3000, amountUnit: "krw_m", amountUnitConfirmed: true, period: "monthly" }],
      crows, null, actor,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("invalid_request");
    const good = cl.normalizeBusinessCaseLines(
      [{ source: "capability", capabilityKey: "k1", reflected: true, category: "opex", amount: 3000, amountUnit: "krw_m", amountUnitConfirmed: true, period: "yearly" }],
      crows, null, actor,
    );
    expect(good.ok).toBe(true);
    if (good.ok) {
      const entry = good.lines.find((l) => (l as { source?: string }).source === "capability") as { period?: string };
      expect(entry.period).toBe("yearly");
      expect((entry as { amount?: number }).amount).toBe(3000);
    }
  });
});

describe("FX conversion for foreign investment lines (2026-10-18 decider ask)", () => {
  test("manualLineInKrw converts fx_m at the person-set rate; no rate = unchanged (환율 미반영)", () => {
    const rates = { USD: 1350 };
    const usd = { line: "부품 허브", category: "opex", amount: 200, amountUnit: "fx_m", amountUnitConfirmed: true, currency: "USD", period: "monthly" };
    const converted = cl.manualLineInKrw(usd, rates);
    expect(converted.amount).toBe(270000); // 200 × 1,350 = 백만원
    expect(converted.currency).toBe("KRW");
    expect(converted.amountUnit).toBe("krw_m");
    // Without a rate the line passes through untouched (excluded downstream).
    expect(cl.manualLineInKrw(usd, undefined)).toBe(usd);
    expect(cl.manualLineInKrw(usd, { EUR: 1500 })).toBe(usd);
    // KRW lines are never touched.
    const krw = { line: "x", currency: "KRW", amount: 5, amountUnit: "krw_m" };
    expect(cl.manualLineInKrw(krw, rates)).toBe(krw);
  });

  test("converted lines enter the totals: a USD opex line counts in the schedule at the FX rate", () => {
    const usd = { line: "부품 허브", category: "opex", amount: 1, amountUnit: "fx_m", amountUnitConfirmed: true, currency: "USD", period: "yearly", startYear: 1, endYear: 5 };
    const converted = cl.convertManualLinesToKrw([usd], { USD: 1350 });
    expect(converted[0].amount).toBe(1350);
    // The schedule lives on buildInvestmentSummary (investmentTotals carries the head counts).
    const summary = cl.buildInvestmentSummary(converted, [], 5, new Set());
    expect(summary.schedule.map((r: { opex: number }) => r.opex)).toEqual([1350, 1350, 1350, 1350, 1350]);
    expect(summary.excludedNonKrw).toBe(0);
  });

  test("promotion converts foreign lines when a rate exists and still skips without one", () => {
    const crows = [src()];
    const fx = { USD: 1350 };
    const foreign = { line: "부품 허브", category: "opex", amount: 1, amountUnit: "fx_m", amountUnitConfirmed: true, currency: "USD", period: "monthly" };
    const withRate = cl.splitForPromotion([foreign], crows, fx);
    expect(withRate.skippedManual).toHaveLength(0);
    expect(withRate.manual[0]).toMatchObject({ currency: "KRW", amount: 1350 });
    const noRate = cl.splitForPromotion([foreign], crows, undefined);
    expect(noRate.skippedManual).toEqual([{ line: "부품 허브", reason: "currency_non_krw" }]);
  });
});
