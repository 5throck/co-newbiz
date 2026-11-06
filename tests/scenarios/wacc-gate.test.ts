// ADR-0186 P4 in the PRODUCTION bundle: family `wacc` = enforce. The Green Field deal is seeded WITHOUT a confirmed discount
// rate (waccConfirmed:false). The fs GO is refused with 409 wacc_unconfirmed (details: subject, missing[]) - HOLD is not -
// S8 reads incomplete, every WACC-dependent read carries wacc_status = provisional; a person then confirms the WACC
// application subject, the WACC and the hurdle IRR through the WACC session route, the block lifts, the labels flip to
// confirmed and the fs GO is recorded. Other scenarios run with the flag at its default (off) and a confirmed fixture.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp, type TestApp } from "./_support/harness.ts";
import { launchBrowser, loginThroughUi, type Session } from "./_support/browser.ts";
import { GREENFIELD, seedGreenfieldDeal } from "./_support/deals.ts";
import { confirmSynergy } from "./_support/ui.ts";
import type { Browser } from "./_support/playwright.ts";

process.env.CO_NEWBIZ_GATE_INTEGRITY_WACC = "enforce";

let app: TestApp;
let browser: Browser;
let s: Session;
const P = GREENFIELD.projectId;
const RATIONALE = "채택 사례의 NPV와 BEP가 투자 기준을 충족하고 할인율을 확정했으므로 진행함";

beforeAll(async () => {
  app = await startApp("wacc-gate", {
    seed: async ({ dbPath, analystId }) => {
      await seedGreenfieldDeal(dbPath, analystId, { waccConfirmed: false });
    },
  });
  browser = await launchBrowser();
  s = await loginThroughUi(browser, app);
  // ADR-0192: the fs GO here must fail ONLY on the wacc family, so the S3 fit
  // judgement has to be legitimately complete — confirm the synergy
  // recommendation through the endpoint, the way a person does.
  await confirmSynergy(app, s, GREENFIELD.opportunityId);
}, 180_000);
afterAll(async () => {
  await browser?.close();
  await app?.stop();
  delete process.env.CO_NEWBIZ_GATE_INTEGRITY_WACC;
});

type Json = { data: any; error: { code: string; details?: any } | null };
async function api(method: "GET" | "POST", path: string, data?: unknown): Promise<{ status: number; body: Json }> {
  const csrf = (await s.context.cookies(app.baseUrl)).find((c) => c.name === "co_newbiz_csrf")?.value ?? "";
  const headers = { "x-csrf-token": csrf, origin: app.baseUrl };
  const res =
    method === "GET"
      ? await s.context.request.get(`${app.baseUrl}${path}`, { headers })
      : await s.context.request.post(`${app.baseUrl}${path}`, { headers, data });
  return { status: res.status(), body: (await res.json()) as Json };
}
const fsRows = () =>
  app.readDb(
    (d) =>
      (d.query("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ? AND gate = 'fs'").get(P) as { c: number }).c,
  );

describe("wacc family = enforce on the production bundle", () => {
  test("before confirmation: S8 incomplete, fs GO is 409 wacc_unconfirmed, HOLD is recorded, reads are provisional", async () => {
    const process_ = await api("GET", `/api/projects/${P}/process`);
    expect(process_.status).toBe(200);
    expect(JSON.stringify(process_.body.data)).toContain("not human-confirmed");

    const go = await api("POST", `/api/projects/${P}/gate-decisions`, {
      gate: "fs",
      decision: "go",
      rationale: RATIONALE,
    });
    expect(go.status).toBe(409);
    expect(go.body.error?.code).toBe("wacc_unconfirmed");
    expect(go.body.error?.details).toMatchObject({ subject: null, missing: ["wacc_subject", "wacc", "hurdle_irr"] });
    expect(fsRows()).toBe(0);

    const hold = await api("POST", `/api/projects/${P}/gate-decisions`, {
      gate: "fs",
      decision: "hold",
      rationale: "할인율 확정 전이라 보류함",
      missing_artifacts: ["WACC 확정"],
    });
    expect(hold.status).toBe(201);

    const bc = await api("GET", `/api/projects/${P}/business-case`);
    expect(bc.body.data.wacc_status).toMatchObject({ status: "provisional", reason: "wacc_unconfirmed" });
    const snap = await api("GET", `/api/projects/${P}/gate-snapshot?gate=fs`);
    expect(snap.body.data.snapshot.hard_blocks).toContainEqual({
      code: "wacc_unconfirmed",
      keys: ["hurdle_irr", "wacc", "wacc_subject"],
      enforced: true,
    });
  }, 120_000);

  test("after the person confirms subject, WACC and hurdle: labels flip, the block lifts, the fs GO is recorded", async () => {
    const session = await api("POST", `/api/projects/${P}/wacc`, {
      wacc: 0.09,
      hurdle_irr: 0.12,
      mode: "direct",
      rationale: "그룹 기준 WACC와 허들 확정",
      subject: "promoter",
      subject_rationale: "신설 법인을 모기업이 직접 수행하므로 모기업 자본비용을 적용함",
    });
    expect(session.status, JSON.stringify(session.body)).toBe(201);

    const bc = await api("GET", `/api/projects/${P}/business-case`);
    expect(bc.body.data.wacc_status).toEqual({
      status: "confirmed",
      reason: null,
      missing: [],
      subject: "promoter",
      scope: "project",
      warnings: [],
    });
    const pkg = await api("GET", `/api/projects/${P}/ic-package`);
    expect(pkg.body.data.wacc_status.status).toBe("confirmed");

    const go = await api("POST", `/api/projects/${P}/gate-decisions`, {
      gate: "fs",
      decision: "go",
      rationale: RATIONALE,
    });
    expect(go.status, JSON.stringify(go.body)).toBe(201);
    expect(fsRows()).toBe(2);
  }, 120_000);
});
