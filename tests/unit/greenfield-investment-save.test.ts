// @version 1.0.0
/**
 * S5 투자비 검토 요건 — unified investment item table (one data-table grid shared by manual and
 * capability rows) and the section's own explicit save ("투자비 항목 저장"): the save button POSTs
 * ONLY business_case_lines (manual lines as held + capability selections via selectionPayload),
 * so entry_strategy and stored capability reflections survive. Temp DB, fake LLM (provider=none),
 * no browser was used.
 */
import { test, expect, describe, beforeAll } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(ROOT, "db/data/test-greenfield-investment-save.sqlite");
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
const cl = await import("../../app/web-next/lib/capability-cost-lines.ts");
// i18n (design 2026-10-23-i18n-ui-adoption): S5 stage copy resolves through the
// catalog — wording pins below assert the key call site in the component source
// and the ko master catalog value (the original Korean label).
const koCatalog = await import("../../app/web-next/locales/ko.json");
const koOf = (key: string): string =>
  key.split(".").reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), koCatalog) as string;

const NOW = new Date().toISOString();
const json = JSON.stringify;
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stage = () => read("app/web-next/components/stages/GreenfieldStage.tsx");
const req = (path: string, init?: RequestInit) => nextRequest(path, init);
const WEB = join(ROOT, "app/web-next");

const LEAD = "inv-save-lead";
let cookie = "";
let oppId = "";

const stored = () => db.query("SELECT entry_strategy e, business_case_lines_json j FROM greenfield_assessment WHERE opportunity_id = ?").get(oppId) as { e: string; j: string };

beforeAll(async () => {
  for (const [u, role] of [[LEAD, "analyst"]] as const) {
    await createUser(db, { userId: u, role, password: `pw-${u}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: u, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await req("/api/auth/login", { method: "POST", body: json({ userId: LEAD, password: `pw-${LEAD}-12345` }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
  oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "투자비 저장 기회", "산업", "selected", LEAD, NOW]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), oppId, "greenfield", "test", "대안 검토", LEAD, NOW]);
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [ulid(), oppId, "[진출방식] build*\n직접 구축 근거", "M&A 대안", "test", LEAD, NOW, NOW],
  );
  // One confirmed judgement with a closing cost, so the capability entry the save button re-sends is valid.
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows: [{
    id: "r1", capability: "정밀 가공", source: "manual", held: { status: "none" }, requiredLevel: "숙련", currentLevel: "",
    resolution: "hire",
    attainability: { closingCostKrwM: 500, monthsToAttain: 6, grade: "medium", rationale: "", evidence: [], draftedBy: "human", confirmedBy: LEAD, confirmedAt: NOW },
  }], updatedAt: NOW }), oppId]);
});

const post = (body: unknown) => req(`/api/greenfield/${oppId}`, { method: "POST", headers: { cookie }, body: json(body) });
const getLines = (): any[] => JSON.parse(stored().j);

describe("route: lines-only POST preserves the other stored fields", () => {
  test("seed: a reflected capability entry with a person stamp exists", () => {
    db.run("UPDATE greenfield_assessment SET business_case_lines_json = ? WHERE opportunity_id = ?", [json([
      { source: "plan_meta", horizonYears: 5 },
      { line: "생산설비", category: "capex", amount: 1200, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "lumpsum" },
      { line: "정밀 가공 역량 해소", source: "capability", capabilityKey: "r1", reflected: true, category: "labor", amount: 500, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "lumpsum", reflectedBy: LEAD, reflectedAt: NOW },
    ]), oppId]);
    const lines = getLines();
    expect(lines.filter((l) => l.source === "capability")).toHaveLength(1);
  });
  test("lines-only POST (manual as held + capability selections): entry_strategy kept, reflection kept", async () => {
    const capEntry = getLines().find((l) => l.source === "capability");
    // The save button's exact payload shape: plan_meta + manual lines as held + selectionPayload entries.
    const payload = [
      { source: "plan_meta", horizonYears: 5 },
      { line: "생산설비", category: "capex", amount: 1500, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "lumpsum" },
      { source: "capability", capabilityKey: "r1", reflected: true, category: "labor", amount: 500, amountUnit: "krw_m", amountUnitConfirmed: true },
    ];
    void capEntry;
    expect((await post({ business_case_lines: payload })).status).toBe(200);
    const s = stored();
    expect(s.e).toBe("[진출방식] build*\n직접 구축 근거"); // entry_strategy omitted -> kept
    const lines = getLines();
    const cap = lines.find((l) => l.source === "capability");
    expect(cap).toMatchObject({ capabilityKey: "r1", reflected: true, amount: 500, category: "labor" });
    expect(cap.reflectedBy).toBe(LEAD); // reflection stamp preserved on a re-save
    expect(cap.reflectedAt).toBe(NOW);
    expect(lines.filter((l) => !l.source)).toHaveLength(1); // manual line saved as edited
    expect(lines.find((l) => !l.source).amount).toBe(1500);
  });
  test("selectionPayload includes persisted lines so a lines-only save never drops stored reflections", () => {
    const lines = cl.applySelection(cl.deriveCapabilityCostLines([{
      id: "r1", capability: "정밀 가공", resolution: "hire", category: null, closing_cost_krw_m: 500, months_to_attain: 6, grade: "high",
      confirmed_at: NOW, stale: false, period: null,
    }], getLines().filter((l) => l.source === "capability")), {});
    const sel = cl.selectionPayload(lines, {});
    expect(sel).toHaveLength(1);
    expect(sel[0]).toMatchObject({ capabilityKey: "r1", reflected: true, amount: 500 });
  });
});

describe("UI structure: one grid, shared columns, chips in-row, own save button", () => {
  test("unified list is a single data-table grid with the shared column order", () => {
    const s = stage();
    const scope = s.slice(s.indexOf('data-testid="invest-item-list"'), s.indexOf('data-testid="invest-item-footer"'));
    expect(s).toContain('<table className="data-table table-fixed-pct tmin-80 invest-item-table" aria-label={t("investmentItemList")} data-testid="invest-item-list">');
    expect(koOf("stages.s5.stage.investmentItemList")).toBe("투자비 항목 목록");
    expect(s).toContain('<ColGroup widths={INVEST_ITEM_COL_PCT} />');
    expect(s).toContain('<div className="table-scroll mb-1">');
    // Shared column order: header cells reference catalog keys in the pinned order…
    const head = scope.slice(scope.indexOf("<thead>"), scope.indexOf("</thead>"));
    for (const cell of ['<th scope="col">{tc("itemName")}</th>', '<th scope="col">{tc("source")}</th>', '<th scope="col">{tc("classification")}</th>', '<th scope="col">{t("amountAnnualizedOrPeriodTotal")}</th>', '<th scope="col">{tc("unit")}</th>', '<th scope="col">{tc("currency")}</th>', '<th scope="col">{tc("cycle")}</th>', '<th scope="col">{t("startAndEndYears")}</th>', '<th scope="col">{tc("notes")}</th>', '<th scope="col">{tc("actions")}</th>']) {
      expect(head).toContain(cell);
    }
    // …and each key resolves to the original Korean label in the ko catalog.
    for (const [key, label] of [
      ["common.itemName", "항목명"], ["common.source", "출처"], ["common.classification", "분류"],
      ["stages.s5.stage.amountAnnualizedOrPeriodTotal", "금액 (연 환산·기간 총액, 백만원)"],
      ["common.unit", "단위"], ["common.currency", "통화"], ["common.cycle", "주기"],
      ["stages.s5.stage.startAndEndYears", "시작·종료 연차"], ["common.notes", "비고"], ["common.actions", "작업"],
    ] as const) {
      expect(koOf(key)).toBe(label);
    }
    // Both row kinds share the same <tr>/<td> grid.
    expect(scope).toContain('data-testid={`invest-manual-row-${i}`}');
    expect(scope).toContain('data-testid={`invest-cap-row-${row.capabilityKey}`}');
    expect(scope).toContain("<tr key={`c${row.capabilityKey}`}");
    expect(scope).toContain("<tr key={`m${i}`}");
    expect(scope).not.toContain("invest-item-list\">\n          {unifiedRows.map"); // no <ul> remnants
    expect(scope).not.toContain("<ul className=\"list-none p-0 m-0 mb-1\"");
  });
  test("capability row: read-only slots, editable 분류/집행 연차, chips, 판정 보기 and 반영 해제 in 작업", () => {
    const scope = stage().slice(stage().indexOf('data-testid="invest-item-list"'), stage().indexOf('data-testid="invest-item-footer"'));
    expect(scope).toContain('<option value="krw_m">{tc("krwMillionUnit")}</option>');
    expect(koOf("common.krwMillionUnit")).toBe("백만원");
    expect(scope).toContain("{CURRENCY_LABEL(tr).KRW}</option>");
    // 2026-10-18: the linked row's period select now carries the full vocabulary (map-rendered).
    expect(scope).toContain("(Object.keys(PERIOD_LABEL) as BcPeriod[]).map((p2) =>");
    expect(scope).toContain('{t("viewJudgement")}</a>');
    expect(koOf("stages.s5.stage.viewJudgement")).toBe("판정 보기");
    expect(scope).toContain('{t("unreflect2")}</button>');
    expect(koOf("stages.s5.stage.unreflect2")).toBe("반영 해제");
    expect(scope).toContain('{tc("rejudgeNeeded")}</span>');
    expect(koOf("common.rejudgeNeeded")).toBe("재판정 필요");
    expect(scope).toContain('{t("reflectedSaved")}</span>');
    expect(koOf("stages.s5.stage.reflectedSaved")).toBe("반영됨 · 저장됨");
  });
  test("manual row: editable slots, per-row saved chips, delete only here", () => {
    const scope = stage().slice(stage().indexOf('data-testid="invest-item-list"'), stage().indexOf('data-testid="invest-item-footer"'));
    for (const aria of ['aria-label={tc("itemName")}', 'aria-label={tc("classification")}', 'aria-label={tc("amount")}', 'aria-label={t("amountUnit2")}', 'aria-label={t("baseCurrency2")}', 'aria-label={t("amountBasisRecurringCycleOr")}', 'aria-label={tc("notes")}']) {
      expect(scope).toContain(aria);
    }
    expect(scope).toContain('data-testid={`invest-confirm-chip-${i}`}');
    expect(scope).toContain('{t("manual")}</span>');
    expect(koOf("stages.s5.stage.manual")).toBe("수동");
    expect(scope).toContain('{tc("unsaved")}</span>');
    expect(koOf("common.unsaved")).toBe("저장 전");
    expect(scope).toContain('{t("saved")}</span>');
    expect(koOf("stages.s5.stage.saved")).toBe("저장됨");
    expect(scope).not.toContain("invest-unit-text-");
    expect(scope).not.toContain("단위 확인 필요");
    expect(scope).not.toContain("invest-unit-marker-");
    // 2026-10-22 표 감사 수선: 일반 "항목 삭제" 라벨은 행 특정 라벨로 대체되었다
    // (어느 행의 삭제인지 스크린리더가 알 수 있게) — 제네릭 라벨의 재유입을 막는다.
    expect(scope).not.toContain('aria-label="항목 삭제"');
    expect(scope).toContain('t("deleteP1", { p1: l.line || tc("items") })');
    expect(koOf("stages.s5.stage.deleteP1")).toBe("{p1} 삭제");
    expect(koOf("common.items")).toBe("항목");
    // Delete button appears only in the manual branch.
    const capPart = scope.slice(scope.indexOf("invest-cap-row-"), scope.indexOf("invest-manual-row-"));
    expect(capPart).not.toContain("항목 삭제");
  });
});

describe("save button wiring: lines-only payload, dirty tracking, success note", () => {
  test("section header carries the explicit save button, clean-state hint and helper line", () => {
    const s = stage();
    expect(s).toContain('linesSaveButton(t("saveInvestmentItems"))');
    expect(koOf("stages.s5.stage.saveInvestmentItems")).toBe("투자비 항목 저장");
    expect(s).toContain('t("noChangesToSave2")');
    expect(koOf("stages.s5.stage.noChangesToSave2")).toBe("저장할 변경 없음");
    expect(s).toContain('t("afterChangingItemsPressSave")');
    expect(koOf("stages.s5.stage.afterChangingItemsPressSave")).toBe("항목 변경 후 투자비 항목 저장을 누르세요");
    expect(s).toContain("data-testid=\"invest-item-save-actions\"");
    expect(s).toContain("data-testid=\"invest-item-dirty-chip\"");
    expect(s).toContain("data-testid=\"invest-item-note\"");
    expect(s).toContain("data-testid=\"invest-item-error\"");
    expect(s).toContain("btn-primary btn-sm\" : \"btn-ghost btn-sm\"");
  });
  test("save handler POSTs only business_case_lines (manual + selectionPayload + start-year overrides); amount_mismatch falls back to a reload", () => {
    const s = stage();
    expect(s).toContain("async function saveInvestmentLines()");
    expect(s).toContain("reflectionBody(bcLines, capLines, capSel)");
    expect(s).toContain("api.post(`/api/greenfield/${selected.opportunity.id}`, {");
    expect(s).toContain("business_case_lines: [metaEntry(), ...body.business_case_lines.map");
    expect(s).toContain("amount_mismatch");
    expect(s).toContain('setLinesNote(t("p1ItemSSavedTotal", { p1: savedCount, p2: formatKrwM(invTotals.grandKrwM) }))');
    expect(koOf("stages.s5.stage.p1ItemSSavedTotal")).toBe("{p1}건 저장 · 합계 {p2}");
    expect(s).toContain("investDirty ||");
  });
  test("dirty tracking: manual snapshot comparison plus reflectDirty feeds investDirty", () => {
    const s = stage();
    expect(s).toContain("const manualDirty = useMemo(() => JSON.stringify(bcLines) !== JSON.stringify(savedManualLines)");
    // 2026-10-18: startYearDirty (the 판정 dialog 시작 연차 override) joins the dirty set.
    expect(s).toContain("const investDirty = manualDirty || reflectDirty || staffDirty || simOvDirty || startYearDirty;"); // ADR-0175 slice 1 adds the staffing plan; ADR-0176 adds the sim overrides
    expect(s).toContain("const manualRowDirty = useCallback");
    expect(s).toContain("setSavedManualLines(manual);");
  });
  test("the whole-assessment save paths are untouched", () => {
    const s = stage();
    expect(s).toContain('label={t("evaluationRecordConfirmedByA2")}');
    expect(koOf("stages.s5.stage.evaluationRecordConfirmedByA2")).toBe("평가 기록 (사람이 확정)");
    expect(s).toContain('>{tc("save")}</button>');
    expect(koOf("common.save")).toBe("저장");
    // reflect button label comes from CapabilityCostBlock
    const block = read("app/web-next/components/stages/CapabilityCostBlock.tsx");
    expect(block).toContain('t("reflectTheSelectedCostsInto")');
    expect(koOf("stages.s5.capabilityCost.reflectTheSelectedCostsInto")).toBe("선택한 비용을 투자비에 반영");
  });
});

describe("footer and totals unchanged", () => {
  test("unifiedFooter format is exactly as before", () => {
    expect(cl.unifiedFooter([{ kind: "manual", manualIndex: 0 }], { grandKrwM: 1234 }).text).toBe("항목 1건 · 합계 1,234백만원");
    expect(cl.unifiedFooter([], { grandKrwM: 0 }).count).toBe(0);
  });
  test("unified rows: manual rows first in held order, reflected capability rows after, unreflected excluded", () => {
    const rows = cl.unifiedInvestmentRows([{}, {}, {}], [], {}, {});
    expect(rows).toEqual([{ kind: "manual", manualIndex: 0 }, { kind: "manual", manualIndex: 1 }, { kind: "manual", manualIndex: 2 }]);
  });
});
