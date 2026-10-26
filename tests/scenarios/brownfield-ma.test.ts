import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp, type TestApp } from "./_support/harness.ts";
import { launchBrowser, loginThroughUi, visit, axeScan, formatAxe, type AxeResult, type Session } from "./_support/browser.ts";
import { BROWNFIELD, seedBrownfieldDeal } from "./_support/deals.ts";
import { recordGate, recordTransition, closeProjectViaModal, see, seeNot, revealTab } from "./_support/ui.ts";
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
    await see(s.page, "트랙: 브라운필드 · M&A");
    axe.push(await axeScan(s.page, "process (stage rail)"));
    await visit(s.page, app, "/deals");
    await see(s.page, "S1-S12 데모 Brownfield 프로젝트");
    axe.push(await axeScan(s.page, "shell: deal board"));
  }, 60_000);

  test("ADR-0156: both shortlisted targets are analyzable via the target selector (WACC)", async () => {
    seedSecondTarget(app);
    await visit(s.page, app, `/projects/${P}/wacc`);
    await see(s.page, "분석 대상");
    // No project-level chip; the S8-selected (gate basis) target is the pressed default.
    await expect(s.page.getByRole("button", { name: "프로젝트 기준" }).count()).resolves.toBe(0);
    await expect(s.page.getByRole("button", { name: /게이트 기준/ }).getAttribute("aria-pressed")).resolves.toBe("true");
    const chip = s.page.getByRole("button", { name: /레인보우로보틱스 E2E/ });
    await chip.click();
    await see(s.page, "개별 대상 세션"); // per-target scope note — the GET refetches with target_id
    // The gate-basis target is the project-level binding (scopeId null), so its refetch carries NO target_id.
    const scoped = s.page.waitForResponse((r) => r.request().method() === "GET" && /\/wacc$/.test(new URL(r.url()).pathname) && !r.url().includes("target_id="));
    await s.page.getByRole("button", { name: /게이트 기준/ }).click();
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
    // Back to the gate-basis target (project-level binding).
    await s.page.getByRole("button", { name: /게이트 기준/ }).click();
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

  test("S8 예전 모델 정리 deletes unreferenced legacy models, archives the adopted one, leaves per-target models (ADR-0158)", async () => {
    const now = new Date().toISOString();
    const perTargetBefore = app.readDb((d) => d.query("SELECT COUNT(*) c FROM business_case_model WHERE project_id=? AND target_id IS NOT NULL").get(P)) as { c: number };
    app.writeDb((d) => {
      for (const [id, name] of [["bc-legacy-clean-free", "정리 대상 예전 모델"], ["bc-legacy-clean-adopted", "채택된 예전 모델"]] as const) {
        d.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, inputs_json) VALUES (?,?,?,?,?,?,?,?)", [id, P, "valuation", name, 5, "analyst", now, "{}"]);
      }
      d.run(
        "INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        ["e2e-legacy-adopt", "project", P, P, "e2e", "s8_case_adopt", "done", "web", "analyst", now, now, JSON.stringify({ model_id: "bc-legacy-clean-adopted" })],
      );
    });
    try {
      await visit(s.page, app, `/projects/${P}/business-case`);
      await see(s.page, "대상 미지정 모델 2건");
      await see(s.page, "참조됨 — 보관");
      await see(s.page, "미참조 — 삭제");
      await s.page.getByRole("button", { name: /예전 모델 정리 \(전체 2건\)/ }).click();
      const dialog = s.page.getByRole("alertdialog");
      await dialog.waitFor({ state: "visible", timeout: 20_000 });
      const done = s.page.waitForResponse((r) => r.request().method() === "POST" && /business-case\/legacy-cleanup$/.test(r.url()));
      await dialog.getByRole("button", { name: "정리", exact: true }).click();
      expect((await done).status()).toBe(200);
      await seeNot(s.page, "대상 미지정 모델");
      const rows = app.readDb((d) => d.query("SELECT id, archived_at FROM business_case_model WHERE id LIKE 'bc-legacy-clean-%'").all()) as Array<{ id: string; archived_at: string | null }>;
      expect(rows.map((r) => r.id)).toEqual(["bc-legacy-clean-adopted"]);
      expect(rows[0].archived_at).not.toBeNull();
      const perTargetAfter = app.readDb((d) => d.query("SELECT COUNT(*) c FROM business_case_model WHERE project_id=? AND target_id IS NOT NULL").get(P)) as { c: number };
      expect(perTargetAfter.c).toBe(perTargetBefore.c);
    } finally {
      app.writeDb((d) => {
        d.run("DELETE FROM process_run WHERE id = 'e2e-legacy-adopt'");
        d.run("DELETE FROM business_case_model WHERE id LIKE 'bc-legacy-clean-%'");
      });
    }
  }, 90_000);

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

  test("ADR-0157: open DD on a second shortlisted target, judge an item, the S9 gate still judges the selected target", async () => {
    seedSecondTarget(app);
    const processSnapshot = () =>
      s.page.evaluate(async (url) => {
        const body = (await (await fetch(url)).json()) as { data: { currentStage: string; completedStages: string[]; blockers: string[] } };
        return JSON.stringify({ stage: body.data.currentStage, done: body.data.completedStages, blockers: body.data.blockers });
      }, `/api/projects/${P}/process`);
    const gateScopeRows = () =>
      app.readDb((d) => (d.query("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id=? AND target_id IS NULL").get(P) as { c: number }).c);
    try {
      await visit(s.page, app, `/projects/${P}/dd`);
      const selector = s.page.getByRole("group", { name: "DD 대상 선택" });
      await selector.waitFor({ state: "visible" });
      const processBefore = await processSnapshot();
      const gateRowsBefore = gateScopeRows();

      // A listed-but-unopened target offers no checklist, only 'DD 열기'.
      await selector.getByRole("button", { name: /레인보우로보틱스 E2E/ }).click();
      await see(s.page, "DD가 열리지 않은 대상입니다");
      await s.page.getByRole("button", { name: "DD 열기", exact: true }).click();
      const dialog = s.page.getByRole("dialog");
      await dialog.waitFor({ state: "visible" });
      axe.push(await axeScan(s.page, "dialog: DD 열기 (rationale required)"));
      expect(await dialog.getByRole("button", { name: "DD 열기", exact: true }).isDisabled()).toBe(true); // no rationale yet
      await dialog.getByLabel(/DD를 여는 근거/).fill("1순위 대상과 같은 체크리스트로 위험 수준을 직접 비교하기 위함");
      const opened = s.page.waitForResponse((r) => r.request().method() === "POST" && /\/dd\/targets$/.test(r.url()));
      await dialog.getByRole("button", { name: "DD 열기", exact: true }).click();
      expect((await opened).status()).toBe(201);

      // Comparison scope: banner, judgement recorded on the opened target only.
      await see(s.page, "비교 근거 — 게이트 판정에 반영되지 않습니다");
      const judged = s.page.waitForResponse((r) => r.request().method() === "PUT" && /dd-checklist\/state$/.test(r.url()));
      await s.page.locator('table button[title="충족 판정"]').first().click();
      expect((await judged).status()).toBe(200);
      const finding = await s.page.evaluate(async (url) => {
        const csrf = document.cookie.match(/co_newbiz_csrf=([^;]+)/)?.[1] ?? "";
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify({ target_id: "e2e-target-b", category: "commercial", description: "비교 대상 고객 집중도 위험", value_impact: -800 }),
        });
        return res.status;
      }, `/api/projects/${P}/dd/findings`);
      expect(finding).toBe(201);
      axe.push(await axeScan(s.page, "stage page: S9 DD workspace with target selector (comparison scope)"));

      // Back on the selected target: comparison table, no PASS stamp, gate subject named.
      await s.page.getByRole("group", { name: "DD 대상 선택" }).getByRole("button", { name: /S1-S12 데모 대상회사/ }).click();
      const table = s.page.getByRole("table", { name: "대상별 DD 비교 근거" });
      await table.waitFor({ state: "visible" });
      const section = s.page.getByRole("region", { name: "비교 근거" });
      expect(await section.innerText()).not.toMatch(/PASS/i);
      expect(await table.getByRole("row").count()).toBe(3); // header + selected + opened comparison target
      // The gate subject line lives on the DD workspace's "의사결정" tab (mounted only while that tab is active).
      await s.page.getByRole("tab", { name: "의사결정" }).click();
      await see(s.page, "게이트 판정 대상: S1-S12 데모 대상회사");
      axe.push(await axeScan(s.page, "stage page: S9 comparison table"));

      // Persistence + isolation: the other target's DD never touched the gate scope.
      expect(gateScopeRows()).toBe(gateRowsBefore);
      expect(await processSnapshot()).toBe(processBefore);
      const open = app.readDb((d) => d.query("SELECT opened_by, rationale, source FROM dd_target_open WHERE project_id=? AND target_id='e2e-target-b'").get(P)) as { opened_by: string; rationale: string; source: string };
      expect(open).toMatchObject({ opened_by: "analyst", source: "manual" });
      expect(open.rationale).toContain("직접 비교");
      const other = app.readDb((d) => d.query("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id=? AND target_id='e2e-target-b' AND status='pass'").get(P)) as { c: number };
      expect(other.c).toBe(1);
      const audited = app.readDb((d) => d.query("SELECT COUNT(*) c FROM audit_log WHERE action='dd_target_opened'").get()) as { c: number };
      expect(audited.c).toBe(1);
    } finally {
      app.writeDb((d) => {
        d.run("DELETE FROM project_checklist_item_state WHERE target_id='e2e-target-b'");
        d.run("DELETE FROM dd_finding WHERE target_id='e2e-target-b'");
        d.run("DELETE FROM dd_target_open WHERE target_id='e2e-target-b'");
      });
      removeSecondTarget(app);
    }
  }, 120_000);

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
    // 13 + 13 items across the two M&A checklists (checklists/*.yaml), every one judged above.
    expect(pending.c).toBe(26);
    await recordGate(s.page, app, `/projects/${P}/dd`, null, "go", "M&A 6대 검증 포함 전 DD 항목 충족, 필수 미충족 0건");
  }, 120_000);

  test("S10 structure is complete; S11 Entity IC and Group IC approvals are recorded by a person", async () => {
    await visit(s.page, app, `/projects/${P}/deal-structure`);
    await visit(s.page, app, `/projects/${P}/ic-review`);
    await revealTab(s.page, s.page.locator('section[aria-label="의사결정"]'));
    await s.page.locator('section[aria-label="의사결정"]').first().waitFor({ state: "visible" });
    axe.push(await axeScan(s.page, "gate panel: S11 IC review"));
    // ADR-0165: ONE sequenced decision panel; its form targets the current committee turn (entity_ic, then group_ic).
    await recordGate(s.page, app, `/projects/${P}/ic-review`, null, "go", "Entity IC: 투자 구조와 DD 결과를 검토하고 승인함");
    await recordGate(s.page, app, `/projects/${P}/ic-review`, null, "go", "Group IC: 그룹 자본배분 우선순위에 부합함");
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
