import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { REPO_ROOT, startApp, type TestApp } from "./_support/harness.ts";
import { launchBrowser, loginThroughUi, visit, axeScan, formatAxe, type AxeResult, type Session } from "./_support/browser.ts";
import { BROWNFIELD, seedBrownfieldDeal } from "./_support/deals.ts";
import { see } from "./_support/ui.ts";
import type { Browser } from "./_support/playwright.ts";

let app: TestApp;
let browser: Browser;
let s: Session;
let client: Client;
const P = BROWNFIELD.projectId;
const axe: AxeResult[] = [];
let proposalId = "";
let confirmUrl = "";

beforeAll(async () => {
  app = await startApp("mcp-proposal", { seed: ({ dbPath, analystId }) => { seedBrownfieldDeal(dbPath, analystId); } });
  browser = await launchBrowser();
  s = await loginThroughUi(browser, app);
}, 120_000);
afterAll(async () => {
  await client?.close().catch(() => undefined);
  await browser?.close();
  await app?.stop();
});

describe("MCP decision proposal confirmed on /proposals/{id}/confirm", () => {
  test("an agent proposes an entity_ic GO through the real MCP stdio server; nothing is decided yet", async () => {
    // The person issues the agent's token from their own session (agents have no accounts of their own).
    const csrf = (await s.context.cookies(app.baseUrl)).find((c) => c.name === "co_newbiz_csrf")?.value ?? "";
    const issued = await s.context.request.post(`${app.baseUrl}/api/tokens`, {
      data: { label: "e2e-agent", scopes: ["read", "write"] },
      headers: { "x-csrf-token": csrf, origin: app.baseUrl },
    });
    expect(issued.status()).toBe(201);
    const token = ((await issued.json()) as { data: { token: string } }).data.token;

    client = new Client({ name: "e2e-agent", version: "1.0.0" }, { capabilities: {} });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["run", `${REPO_ROOT}/mcp/co-newbiz/index.ts`],
        env: { CO_NEWBIZ_API_BASE_URL: app.baseUrl, CO_NEWBIZ_API_TOKEN: token, PATH: process.env.PATH ?? "" },
      }),
    );
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toContain("propose_gate_decision");
    expect(tools).not.toContain("record_gate_decision_confirmed");

    const result = await client.callTool({
      name: "propose_gate_decision",
      arguments: { entityId: P, gate: "entity_ic", decision: "go", rationale: "Entity IC 제안: DD와 투자구조가 승인 기준을 충족함", gap_rationale: "E2E: 미충족 산출물을 인지하고 예외로 진행함", evidence_refs: ["dd:summary"] },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const body = JSON.parse(text) as { data: { proposal_id: string; status: string; confirm_url: string } };
    expect(body.data.status).toBe("pending");
    proposalId = body.data.proposal_id;
    confirmUrl = body.data.confirm_url;
    expect(confirmUrl).toContain(`/proposals/${proposalId}/confirm`);

    const decided = app.readDb((d) => d.query("SELECT COUNT(*) c FROM gate_decision WHERE gate='entity_ic'").get()) as { c: number };
    expect(decided.c).toBe(0);
  }, 90_000);

  test("the proposal waits in the person's decision inbox", async () => {
    await visit(s.page, app, "/inbox");
    await see(s.page, "결정 대기함");
    axe.push(await axeScan(s.page, "inbox"));
  }, 60_000);

  test("the person reviews and confirms it in their own web session", async () => {
    await visit(s.page, app, `/proposals/${proposalId}/confirm`);
    await see(s.page, /확인 대기/);
    axe.push(await axeScan(s.page, "proposal confirm page"));
    const confirmResponse = s.page.waitForResponse((r) => /\/confirm$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
    await s.page.getByRole("button", { name: /결정 확정/ }).first().click();
    const res = await confirmResponse;
    expect(res.status()).toBeLessThan(300);
    await see(s.page, /확정됨|결정이 기록되었습니다/);

    const gate = app.readDb((d) => d.query("SELECT decision, decided_by FROM gate_decision WHERE gate='entity_ic'").get()) as { decision: string; decided_by: string };
    expect(gate).toEqual({ decision: "go", decided_by: "analyst" });
    const proposal = app.readDb((d) => d.query("SELECT status, confirmed_by_user_id, resulting_record_id FROM decision_proposal WHERE id=?").get(proposalId)) as { status: string; confirmed_by_user_id: string; resulting_record_id: string | null };
    expect(proposal.status).toBe("confirmed");
    expect(proposal.confirmed_by_user_id).toBe("analyst");
    expect(proposal.resulting_record_id).toBeTruthy();
  }, 60_000);

  test("connected apps screen renders", async () => {
    await visit(s.page, app, "/settings/connected-apps");
    await see(s.page, "연결된 앱");
    axe.push(await axeScan(s.page, "connected apps"));
  }, 60_000);

  test("axe: inbox, confirm page and connected apps have no serious or critical violations", () => {
    console.log(formatAxe(axe));
    expect(axe.flatMap((r) => r.blocking)).toEqual([]);
  });
});
