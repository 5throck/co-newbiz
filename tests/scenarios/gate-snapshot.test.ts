// ADR-0186 P2 in the PRODUCTION bundle. The harness inherits the test runner's environment (NODE_ENV=test), so the
// families default to `off`; this file opts the three P2 families into `shadow` explicitly before the server starts: the gate brief and the gate decision evaluate kill criteria through the Next server bundle (registry
// directory resolution, evaluator, ledger), persist the snapshot, and a shadow-mode fault would surface as an audited
// `snapshot_error` - which must NOT happen on the happy path. A GO without a hash is recorded (shadow never blocks)
// and audited as a would-block.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp, type TestApp } from "./_support/harness.ts";
import { launchBrowser, loginThroughUi, type Session } from "./_support/browser.ts";
import { BROWNFIELD, seedBrownfieldDeal } from "./_support/deals.ts";
import type { Browser } from "./_support/playwright.ts";

for (const family of ["SNAPSHOT_ACK", "KILL_BINDING", "DIVERGENCE"]) process.env[`CO_NEWBIZ_GATE_INTEGRITY_${family}`] = "shadow";

let app: TestApp;
let browser: Browser;
let s: Session;
const P = BROWNFIELD.projectId;

beforeAll(async () => {
  app = await startApp("gate-snapshot", { seed: ({ dbPath, analystId }) => { seedBrownfieldDeal(dbPath, analystId); } });
  browser = await launchBrowser();
  s = await loginThroughUi(browser, app);
}, 120_000);
afterAll(async () => {
  await browser?.close();
  await app?.stop();
  for (const family of ["SNAPSHOT_ACK", "KILL_BINDING", "DIVERGENCE"]) delete process.env[`CO_NEWBIZ_GATE_INTEGRITY_${family}`];
});

async function api(method: "GET" | "POST", path: string, data?: unknown) {
  const csrf = (await s.context.cookies(app.baseUrl)).find((c) => c.name === "co_newbiz_csrf")?.value ?? "";
  const headers = { "x-csrf-token": csrf, origin: app.baseUrl };
  const res = method === "GET" ? await s.context.request.get(`${app.baseUrl}${path}`, { headers }) : await s.context.request.post(`${app.baseUrl}${path}`, { headers, data });
  return { status: res.status(), body: (await res.json()) as { data: any; error: { code: string; details?: any } | null } };
}

describe("gate integrity P2 - shadow mode on the production bundle", () => {
  test("brief -> snapshot -> HOLD -> GO: ledger, brief record and snapshots are written, nothing blocks, no snapshot_error", async () => {
    const brief = await api("POST", `/api/projects/${P}/gate-brief`, { gate: "dd" });
    expect(brief.status).toBe(200);
    expect(brief.body.data.brief_id).toBeTruthy();
    if (!brief.body.data.kill) console.log(app.log().split("\n").filter((l) => /gate-brief|kill|error/i.test(l)).slice(-12).join("\n"));
    expect(brief.body.data.kill.evaluated).toBeGreaterThan(0);

    const snap = await api("GET", `/api/projects/${P}/gate-snapshot?gate=dd`);
    expect(snap.status).toBe(200);
    expect(snap.body.data.snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.body.data.snapshot.validators).not.toBeNull(); // brownfield dd: six-validator completeness is part of the snapshot

    const hold = await api("POST", `/api/projects/${P}/gate-decisions`, { gate: "dd", decision: "hold", rationale: "DD 검토 진행 중이라 보류함", missing_artifacts: ["DD 보고서"] });
    expect(hold.status).toBe(201);
    expect(hold.body.data.snapshot_hash).toMatch(/^[0-9a-f]{64}$/);

    const go = await api("POST", `/api/projects/${P}/gate-decisions`, { gate: "fs", decision: "go", rationale: "채택 사례의 NPV/BEP가 투자 기준을 충족함" });
    expect(go.status).toBe(201);

    const q = <T,>(sql: string, ...args: unknown[]) => app.readDb((d) => d.query(sql).get(...(args as any[])) as T);
    expect(q<{ c: number }>("SELECT COUNT(*) c FROM run WHERE project_id = ? AND label LIKE 'gate_integrity_eval:brief:%'", P).c).toBe(1);
    expect(q<{ c: number }>("SELECT COUNT(*) c FROM run WHERE project_id = ? AND label LIKE 'gate_integrity_eval:decision:%'", P).c).toBe(2);
    expect(q<{ c: number }>("SELECT COUNT(*) c FROM kill_criteria_evaluation WHERE project_id = ?", P).c).toBeGreaterThan(0);
    expect(q<{ c: number }>("SELECT COUNT(*) c FROM gate_decision_snapshot s JOIN gate_decision d ON d.id = s.decision_id WHERE d.entity_id = ?", P).c).toBe(2);
    expect(q<{ c: number }>("SELECT COUNT(*) c FROM gate_brief_record WHERE entity_id = ?", P).c).toBe(1);
    expect(q<{ c: number }>("SELECT COUNT(*) c FROM audit_log WHERE action = 'gate_integrity.would_block:snapshot_error'").c).toBe(0);
    // shadow: the GO had no hash and no acknowledgements - recorded anyway, audited as would-blocks
    expect(q<{ c: number }>("SELECT COUNT(*) c FROM audit_log WHERE action = 'gate_integrity.would_block:snapshot_stale' AND target = ?", `project:${P}:fs`).c).toBe(1);
  }, 120_000);
});
