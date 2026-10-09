import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp, type TestApp } from "./_support/harness.ts";
import { launchBrowser, loginThroughUi, visit, axeScan, formatAxe, type AxeResult, type Session } from "./_support/browser.ts";
import { BROWNFIELD, seedBrownfieldDeal } from "./_support/deals.ts";
import { recordGate, recordTransition, closeProjectViaModal, see, seeNot } from "./_support/ui.ts";
import type { Browser } from "./_support/playwright.ts";

let app: TestApp;
let browser: Browser;
let s: Session;
const P = BROWNFIELD.projectId;
const O = BROWNFIELD.opportunityId;
const axe: AxeResult[] = [];

beforeAll(async () => {
  app = await startApp("brownfield-ma", { seed: ({ dbPath, analystId }) => { seedBrownfieldDeal(dbPath, analystId, { subTrackDd: false }); } });
  browser = await launchBrowser();
  s = await loginThroughUi(browser, app);
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});


/** ADR-0156 E2E fixture: a second shortlisted target with its own md_company
 *  and two years of fact_financial rows, so the target selector has a real
 *  choice and the per-target financial view has data to render. */
function seedSecondTarget(app: TestApp): void {
  app.writeDb((d) => {
    const now = new Date().toISOString();
    d.run(
      "INSERT OR IGNORE INTO md_company (id, dart_corp_code, name_ko, name_en, created_at) VALUES ('e2e-target-b-company', 'DEMO0002', '레인보우로보틱스 E2E', 'Rainbow Robotics E2E', ?)",
      [now],
    );
    d.run(
      `INSERT OR REPLACE INTO brownfield_target
       (id, opportunity_id, company_name, dart_corp_code, universe_note, status, rank, created_at, updated_at, discovery_source)
       VALUES ('e2e-target-b', '${O}', '레인보우로보틱스 E2E', 'DEMO0002', 'E2E selector fixture', 'shortlisted', 2, ?, ?, 'manual')`,
      [now, now],
    );
    for (const [pid, fy] of [["e2e-tb-py", 2023], ["e2e-tb-ly", 2024]] as const) {
      d.run("INSERT OR IGNORE INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?, 'annual', ?, ?, ?, ?)", [pid, `${fy}-01-01`, `${fy}-12-31`, fy, now]);
    }
    const rows: Array<[string, string, number]> = [
      ["01J8MDACC0REVENUE0000000000", "e2e-tb-py", 410_000_000_000],
      ["01J8MDACC0OPERATING0000000000", "e2e-tb-py", 20_000_000_000],
      ["01J8MDACC0PROFITLOSS000000000", "e2e-tb-py", 15_000_000_000],
      ["01J8MDACC0LIABILITIES00000000", "e2e-tb-py", 300_000_000_000],
      ["01J8MDACC0EQUITY000000000000", "e2e-tb-py", 500_000_000_000],
      ["01J8MDACC0REVENUE0000000000", "e2e-tb-ly", 500_000_000_000],
      ["01J8MDACC0OPERATING0000000000", "e2e-tb-ly", 30_000_000_000],
      ["01J8MDACC0PROFITLOSS000000000", "e2e-tb-ly", 22_000_000_000],
      ["01J8MDACC0LIABILITIES00000000", "e2e-tb-ly", 320_000_000_000],
      ["01J8MDACC0EQUITY000000000000", "e2e-tb-ly", 540_000_000_000],
    ];
    for (const [accountId, periodId, value] of rows) {
      d.run(
        "INSERT OR IGNORE INTO fact_financial (id, company_id, period_id, account_id, value, revision_no, created_at) VALUES (?, 'e2e-target-b-company', ?, ?, ?, 0, ?)",
        [`e2e-tb-${periodId}-${accountId}`, periodId, accountId, value, now],
      );
    }
  });
}

/** Remove the ADR-0156 fixture so the later gate prerequisites (S7 screening
 *  of every shortlisted target) run against the original single-target deal. */
function removeSecondTarget(app: TestApp): void {
  app.writeDb((d) => {
    d.run("DELETE FROM brownfield_target WHERE id = 'e2e-target-b'");
  });
}

describe("brownfield M&A S1 to S12", () => {
  test("S1-S10 evidence is complete; S11 is the current stage", async () => {
    await visit(s.page, app, `/projects/${P}/process`);
    await see(s.page, /현재 S9/);
    await see(s.page, "트랙: brownfield / m_and_a");
    axe.push(await axeScan(s.page, "process (stage rail)"));
    await visit(s.page, app, "/deals");
    await see(s.page, "S1-S12 데모 Brownfield 프로젝트");
    axe.push(await axeScan(s.page, "shell: deal board"));
  }, 60_000);

  test("ADR-0156: both shortlisted targets are analyzable via the target selector (WACC)", async () => {
    seedSecondTarget(app);
    await visit(s.page, app, `/projects/${P}/wacc`);
    await see(s.page, "분석 대상");
    const chip = s.page.getByRole("button", { name: /레인보우로보틱스 E2E/ });
    await chip.click();
    await see(s.page, "개별 대상 세션"); // per-target scope note — the GET refetches with target_id
    const scoped = s.page.waitForResponse((r) => r.request().method() === "GET" && /target_id=/.test(r.url()));
    await s.page.getByRole("button", { name: "프로젝트 기준" }).click();
    await scoped;
    await seeNot(s.page, "개별 대상 세션");
    axe.push(await axeScan(s.page, "wacc target selector"));
  }, 60_000);

  test("ADR-0156: financial-analysis shows the per-target company metrics", async () => {
    await visit(s.page, app, `/projects/${P}/financial-analysis`);
    await see(s.page, "분석 대상");
    await s.page.getByRole("button", { name: /레인보우로보틱스 E2E/ }).click();
    await see(s.page, "레인보우로보틱스 E2E");
    await see(s.page, "매출액 (최근 연도)"); // metrics card rendered from fact_financial
    await see(s.page, "개별 대상 보기는 읽기 전용입니다");
    // Back to the project-level binding (게이트 기준).
    await s.page.getByRole("button", { name: "프로젝트 기준" }).click();
    await see(s.page, "S1-S12 데모 대상회사");
    removeSecondTarget(app);
  }, 60_000);

  test("S7 target screening gate GO", async () => {
    await recordGate(s.page, app, `/deals/${O}/s7`, null, "go", "Short List 1순위 후보가 knock-out 기준을 통과함");
    const row = app.readDb((d) => d.query("SELECT decision, decided_by FROM gate_decision WHERE gate='target_screening'").get()) as { decision: string; decided_by: string };
    expect(row.decision).toBe("go");
    expect(row.decided_by).toBe("analyst");
  }, 60_000);

  test("S8 shows the legacy unassigned-model notice (R2-E item 1)", async () => {
    // A pre-ADR-0143 brownfield carries business_case_model rows with target_id
    // NULL; the stage must say so instead of a bare "Business Case가 필요합니다".
    app.writeDb((d) =>
      d.run(
        "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, inputs_json) VALUES (?,?,?,?,?,?,?,?)",
        ["bc-legacy-e2e", P, "valuation", "ADR-0143 이전 레거시 모델", 5, "analyst", new Date().toISOString(), "{}"],
      ),
    );
    try {
      await visit(s.page, app, `/projects/${P}/business-case`);
      await see(s.page, "대상 미지정 모델 1건");
      await see(s.page, "재생성이 필요합니다");
    } finally {
      app.writeDb((d) => d.run("DELETE FROM business_case_model WHERE id = 'bc-legacy-e2e'"));
    }
  }, 60_000);

  test("S8 대상별 재생성 bypasses the already-run guard and creates per-target models (R2-F)", async () => {
    // Legacy NULL-target model + a DONE s8_business_case_generation run: the
    // idempotency guard used to return that run and the regeneration button
    // was a silent no-op. regenerate:true must start a NEW run whose models
    // carry variant=market_forward and a non-null target_id.
    app.writeDb((d) => {
      d.run(
        "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, inputs_json) VALUES (?,?,?,?,?,?,?,?)",
        ["bc-legacy-e2e-rg", P, "valuation", "ADR-0143 이전 레거시 모델", 5, "analyst", new Date().toISOString(), "{}"],
      );
      d.run(
        "INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        ["e2e-s8-gen-done", "project", P, P, "e2e", "s8_business_case_generation", "done", "web", "analyst", new Date().toISOString(), new Date().toISOString(), "{}"],
      );
    });
    try {
      await visit(s.page, app, `/projects/${P}/business-case`);
      await see(s.page, "대상별 재생성");
      const done = s.page.waitForResponse((r) => r.request().method() === "POST" && /business-case\/generate$/.test(r.url()));
      await s.page.locator("button", { hasText: "대상별 재생성" }).first().click();
      const res = await done;
      expect(res.status()).toBe(201);
      // New run recorded, not the pre-existing done run.
      const run = app.readDb((d) =>
        d.query("SELECT id FROM process_run WHERE project_id=? AND stage='s8_business_case_generation' AND id != 'e2e-s8-gen-done' ORDER BY started_at DESC LIMIT 1").get(P),
      ) as { id: string } | undefined;
      expect(run?.id).toBeTruthy();
      // New per-target market_forward models exist (seeded demo model + new ones).
      const perTarget = app.readDb((d) =>
        d.query("SELECT COUNT(*) c FROM business_case_model WHERE project_id=? AND target_id IS NOT NULL AND variant='market_forward'").get(P),
      ) as { c: number };
      expect(perTarget.c).toBeGreaterThanOrEqual(2);
      // The UI refetches and shows the refreshed per-target case list.
      await see(s.page, "시장 기반");
    } finally {
      app.writeDb((d) => {
        d.run("DELETE FROM business_case_model WHERE id = 'bc-legacy-e2e-rg'");
        d.run("DELETE FROM agent_run WHERE process_run_id IN (SELECT id FROM process_run WHERE project_id=? AND stage='s8_business_case_generation')", [P]);
        d.run("DELETE FROM activity_run WHERE process_run_id IN (SELECT id FROM process_run WHERE project_id=? AND stage='s8_business_case_generation')", [P]);
        d.run("DELETE FROM process_run WHERE project_id=? AND stage='s8_business_case_generation'", [P]);
      });
    }
  }, 180_000);

  test("S8 FS gate GO", async () => {
    await recordGate(s.page, app, `/projects/${P}/business-case`, null, "go", "채택 사례의 NPV/BEP가 투자 기준을 충족함");
  }, 60_000);

  test("S9 judge the M&A sub-track checklists in the DD workspace, then DD gate GO", async () => {
    await visit(s.page, app, `/projects/${P}/dd`);
    for (const tab of ["M&A 6대 검증", "M&A 특수 주제"]) {
      await s.page.locator("button", { hasText: tab }).first().click();
      const buttons = s.page.locator('table button[title="충족 판정"]');
      await buttons.first().waitFor({ state: "visible" });
      const n = await buttons.count();
      for (let i = 0; i < n; i++) {
        const done = s.page.waitForResponse((r) => r.request().method() !== "GET" && /checklist/.test(r.url()));
        await buttons.nth(i).click();
        await done;
      }
    }
    await s.page.reload();
    await s.page.locator('table button[title="충족 판정"]').first().waitFor({ state: "visible" });
    axe.push(await axeScan(s.page, "stage page: S9 DD workspace"));
    const pending = app.readDb((d) => d.query("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id=? AND checklist_id IN ('chk-brownfield-feasibility-checklist','chk-ma-special-topics-checklist') AND status='pass'").get(P)) as { c: number };
    expect(pending.c).toBe(25);
    await recordGate(s.page, app, `/projects/${P}/dd`, null, "go", "M&A 6대 검증 포함 전 DD 항목 충족, 필수 미충족 0건");
  }, 120_000);

  test("S10 structure is complete; S11 Entity IC and Group IC approvals are recorded by a person", async () => {
    await visit(s.page, app, `/projects/${P}/deal-structure`);
    await visit(s.page, app, `/projects/${P}/ic-review`);
    await s.page.locator('section[aria-label="의사결정"]').first().waitFor({ state: "visible" });
    axe.push(await axeScan(s.page, "gate panel: S11 IC review"));
    await recordGate(s.page, app, `/projects/${P}/ic-review`, null, "go", "Entity IC: 투자 구조와 DD 결과를 검토하고 승인함", { panelIndex: 0 });
    await recordGate(s.page, app, `/projects/${P}/ic-review`, null, "go", "Group IC: 그룹 자본배분 우선순위에 부합함", { panelIndex: 1 });
    const gates = app.readDb((d) => d.query("SELECT gate, decision, decided_by FROM gate_decision WHERE entity_id=? AND gate IN ('entity_ic','group_ic') ORDER BY gate").all(P)) as Array<{ gate: string; decision: string; decided_by: string }>;
    expect(gates.map((g) => `${g.gate}:${g.decision}:${g.decided_by}`)).toEqual(["entity_ic:go:analyst", "group_ic:go:analyst"]);
    await visit(s.page, app, `/projects/${P}/process`);
    await see(s.page, /현재 S12/);
  }, 120_000);

  test("S12 divest decision with its divest plan, then typed closure: divested", async () => {
    await recordTransition(s.page, app, P, "reduce_or_divest", "분기 심의: 시너지 미달로 지분을 축소·매각하기로 함", { record: "12개월 내 지분 단계 매각, 매수 후보 3곳 접촉" });
    await closeProjectViaModal(s.page, app, P, "매각/청산", "S12 심의 결과에 따른 매각 완료 처리");
    const closure = app.readDb((d) => d.query("SELECT closure_type, basis_table, closed_by FROM closure_record WHERE entity_id=?").get(P)) as { closure_type: string; basis_table: string; closed_by: string };
    expect(closure.closure_type).toBe("divested");
    expect(closure.basis_table).toBe("venture_transition_decision");
    expect(closure.closed_by).toBe("analyst");
    const project = app.readDb((d) => d.query("SELECT status, closure_type FROM md_project WHERE id=?").get(P)) as { status: string; closure_type: string };
    expect(project).toEqual({ status: "closed", closure_type: "divested" });
  }, 120_000);

  test("axe: shell, stage page and gate panel have no serious or critical violations", () => {
    console.log(formatAxe(axe));
    expect(axe.flatMap((r) => r.blocking)).toEqual([]);
  });
});
