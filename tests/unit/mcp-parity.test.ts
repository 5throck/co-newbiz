// @version 1.0.0
/**
 * Wave M PR M-3 (ADR-0154, design §8) — REST/MCP parity.
 *
 * One Green Field and one Brown Field S1→S12 scenario run twice on identical
 * fixtures: (a) direct REST route calls as the human, (b) an in-memory MCP
 * client on the shared registry + InProcessRestPort as an OAuth-delegated
 * agent, where every propose_* call is followed by the human's confirmation
 * through the confirm route (cookie session, never the token).
 *
 * Fixture scope: the S1-S11 evidence rows (market sizing, business case, DD
 * judgments, scorecard, ...) come from the seed-s1-s12-demo helper and are
 * identical on both paths. What differs between the two paths is exactly what
 * the MCP surface touches: the seven gate decisions and the S12 transition
 * decision are NOT seeded and are recorded through the path under test; the
 * typed closure is recorded by the human on both paths (no tool can close).
 * evaluateProcess is compared after every step and at the end.
 *
 * Each (track, path) run uses its own scratch database, one after another,
 * because the DB handle is a process-wide singleton.
 */

import { test, expect, describe, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const ORIGIN = "http://localhost:7750";
process.env.CO_NEWBIZ_PUBLIC_ORIGIN = ORIGIN;
const HUMAN = "parity-human";
const HUMAN_PW = "pw-parity-human-12345";
const REDIRECT = "http://127.0.0.1:33419/callback";

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { seedS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");
const { currentReviewCycle } = await import("../../app/web-next/lib/portfolio.ts");
const { buildMcpServer } = await import("../../mcp/co-newbiz/registry.ts");
const { InProcessRestPort } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const registerRoute = await import("../../app/web-next/app/api/oauth/register/route.ts");

type Track = "greenfield" | "brownfield";
type Path = "rest" | "mcp";
type Db = ReturnType<typeof getDb>;

interface Ids { oppId: string; projectId: string }
interface StepResult { step: string; opportunity: unknown; project: unknown }
interface RunResult {
  trace: StepResult[];
  gates: Array<{ entity_type: string; gate: string; decision: string; decided_by: string }>;
  transition: { decision: string; decided_by: string } | null;
  closure: { closure_type: string; closed_by: string } | null;
  proposalsConfirmedBy: string[];
  /** MCP only: facts observed while the agent was acting. */
  mcp?: { toolNames: string[]; pendingLeftDecisionsUntouched: boolean; closeRefused: unknown; closedRowsAfterAttempt: number; projectStatusAfterAttempt: string };
}

const dbPaths: string[] = [];
afterAll(() => {
  resetDb();
  for (const p of dbPaths) for (const s of ["", "-wal", "-shm"]) if (existsSync(p + s)) rmSync(p + s);
});

// ── fixtures ────────────────────────────────────────────────────────────

function count(db: Db, sql: string, ...args: unknown[]): number {
  return (db.query(sql).get(...args) as { c: number }).c;
}

/** Brown Field = the seed as is; Green Field = the same chain re-shaped to the own-build track. */
function seedDeal(db: Db, track: Track, dbPath: string): Ids {
  const ids = seedS1ToS12Demo(dbPath);
  const { oppId, projectId } = { oppId: ids.opportunityId, projectId: ids.projectId };

  // The decisions under test are recorded through the path being exercised.
  db.run("DROP TRIGGER IF EXISTS trg_gate_decision_no_delete"); // fixture cleanup only (ADR-0186 H1 guard)
  db.run("DELETE FROM gate_decision");
  db.run("DELETE FROM venture_transition_decision");
  db.run("UPDATE md_project SET current_stage_gate = NULL WHERE id = ?", [projectId]);

  if (track === "greenfield") {
    db.run("UPDATE md_project SET track = 'greenfield', origin = 'internal', establishment_mode = 'new_entity', project_name = 'Parity Green Field' WHERE id = ?", [projectId]);
    db.run("UPDATE route_decision SET track = 'greenfield', sub_track = NULL, rationale = ? WHERE opportunity_id = ?", ["No suitable target: build on our own.", oppId]);
    db.run("UPDATE business_case_model SET target_id = NULL WHERE project_id = ?", [projectId]);
    db.run("DELETE FROM process_run WHERE stage IN ('s8_target_select', 's11_pmi_kickoff') AND project_id = ?", [projectId]);
    db.run("DELETE FROM brownfield_target_evidence");
    db.run("DELETE FROM brownfield_target");
    db.run("DELETE FROM project_checklist_item_state WHERE checklist_id IN ('chk-brownfield-feasibility-checklist', 'chk-ma-special-topics-checklist') AND project_id = ?", [projectId]);
    db.run(
      `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, created_by, created_at, updated_at)
       VALUES ('parity-gf-assessment', ?, 'build', 'Partner and acquire were compared and set aside.', 'parity-seed', ?, ?)`,
      [oppId, new Date().toISOString(), new Date().toISOString()],
    );
    for (let step = 1; step <= 5; step++) {
      db.run(
        `INSERT INTO entity_establishment_step (id, opportunity_id, project_id, step_no, status, origin, owner, updated_at)
         VALUES (?, ?, ?, ?, 'done', 'internal', 'parity-seed', ?)`,
        [`parity-est-${step}`, oppId, projectId, step, new Date().toISOString()],
      );
    }
  }
  return { oppId, projectId };
}

async function bootDb(label: string): Promise<{ db: Db; dbPath: string; cookie: string }> {
  const dbPath = join(PROJECT_ROOT, `db/data/test-mcp-parity-${label}.sqlite`);
  dbPaths.push(dbPath);
  for (const s of ["", "-wal", "-shm"]) if (existsSync(dbPath + s)) rmSync(dbPath + s);
  process.env.CO_NEWBIZ_DB_PATH = dbPath;
  resetDb();
  runMigrations(dbPath);
  const db = getDb(dbPath);
  const now = new Date().toISOString();
  await createUser(db, { userId: HUMAN, role: "analyst", password: HUMAN_PW, createdBy: "test", now });
  approveUser(db, { userId: HUMAN, approvedBy: "test", now });
  db.run("UPDATE app_user SET must_change_password = 0");
  const login = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: HUMAN, password: HUMAN_PW }) });
  const cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
  expect(cookie).toContain("co_newbiz_session=");
  return { db, dbPath, cookie };
}

function grantHuman(db: Db, projectId: string): void {
  db.run(
    "INSERT OR IGNORE INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
    [projectId, HUMAN, "lead", "test", new Date().toISOString(), "parity test"],
  );
}

// ── normalisation ───────────────────────────────────────────────────────

const TS = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const ULID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;
/** Round-trip through JSON with timestamps and generated ids masked (design §8.4: ignore ids and timestamps). */
function scrub(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value).replace(TS, "<ts>").replace(ULID, "<id>"));
}

function snapshot(step: string, ids: Ids): StepResult {
  return {
    step,
    opportunity: scrub(evaluateProcess({ type: "opportunity", id: ids.oppId })),
    project: scrub(evaluateProcess({ type: "project", id: ids.projectId })),
  };
}

// ── the scenario ────────────────────────────────────────────────────────

const GATE_STEPS = (ids: Ids, track: Track): Array<{ entityType: "opportunity" | "project"; entityId: string; gate: string }> => [
  { entityType: "opportunity", entityId: ids.oppId, gate: "screening" },
  { entityType: "opportunity", entityId: ids.oppId, gate: "pre_fs" },
  ...(track === "brownfield" ? [{ entityType: "opportunity" as const, entityId: ids.oppId, gate: "target_screening" }] : []),
  { entityType: "project", entityId: ids.projectId, gate: "fs" },
  { entityType: "project", entityId: ids.projectId, gate: "dd" },
  { entityType: "project", entityId: ids.projectId, gate: "entity_ic" },
  { entityType: "project", entityId: ids.projectId, gate: "group_ic" },
];

const rationale = (gate: string) => `Parity scenario: the ${gate} gate criteria are met.`;
/** R2-E: an IC GO over open gaps needs a gap_rationale (server-enforced on the REST path). */
const gapRationale = (gate: string) =>
  gate === "entity_ic" || gate === "group_ic" ? "Parity scenario: the committee accepts the open gaps with this rationale." : undefined;
const transitionBody = () => ({
  review_cycle: currentReviewCycle(),
  decision: "graduate_to_core",
  rationale: "Parity scenario: hand the venture over to the core business.",
  core_handoff: "Operate in the business unit; end the separate tranche funding.",
});
const closeBody = () => ({ closureType: "graduated_to_core", closureReason: "Parity scenario: S12 complete and handed over." });

function gatePath(entityType: string, entityId: string): string {
  return `/api/${entityType === "opportunity" ? "opportunities" : "projects"}/${entityId}/gate-decisions`;
}

async function json(res: Response): Promise<{ status: number; body: { data: any; error: { code: string; message: string } | null } }> {
  return { status: res.status, body: await res.json() };
}

async function runScenario(track: Track, path: Path): Promise<RunResult> {
  const { db, dbPath, cookie } = await bootDb(`${track}-${path}`);
  const ids = seedDeal(db, track, dbPath);
  grantHuman(db, ids.projectId);
  const trace: StepResult[] = [snapshot("seeded", ids)];
  const confirmedBy: string[] = [];
  const human = { headers: { cookie } };

  // REST path: the human calls the decision routes directly.
  const restDecide = async (g: ReturnType<typeof GATE_STEPS>[number]) => {
    const r = await json(await nextRequest(gatePath(g.entityType, g.entityId), { method: "POST", ...human, body: JSON.stringify({ gate: g.gate, decision: "go", rationale: rationale(g.gate), gap_rationale: gapRationale(g.gate) }) }));
    expect(r.status, `${g.gate}: ${JSON.stringify(r.body.error)}`).toBe(201);
  };
  const restTransition = async () => {
    const r = await json(await nextRequest(`/api/projects/${ids.projectId}/transition-decision`, { method: "POST", ...human, body: JSON.stringify(transitionBody()) }));
    expect(r.status, JSON.stringify(r.body.error)).toBe(201);
  };

  // MCP path: an OAuth-delegated agent proposes, the human confirms in the web session.
  let client: Client | null = null;
  let toolNames: string[] = [];
  const pendingLeftDecisionsUntouched = { value: true };
  const decisionRows = () => count(db, "SELECT COUNT(*) AS c FROM gate_decision") + count(db, "SELECT COUNT(*) AS c FROM venture_transition_decision");
  if (path === "mcp") {
    const reg = await registerRoute.POST(
      new Request(`${ORIGIN}/api/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Parity Connector", redirect_uris: [REDIRECT] }) }),
    );
    const clientId = ((await reg.json()) as { client_id: string }).client_id;
    const principal = { userId: HUMAN, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "parity-token", clientId };
    const server = buildMcpServer({ transport: "http", resolveContext: () => ({ port: new InProcessRestPort(principal), scopes: principal.scopes }) });
    client = new Client({ name: "parity", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    toolNames = (await client.listTools()).tools.map((t) => t.name);
  }

  const callTool = async (name: string, args: Record<string, unknown>) => {
    const res = await client!.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    expect(res.isError, text).not.toBe(true);
    return JSON.parse(text) as { data: { proposal_id: string; confirm_url: string; status: string }; error: { code: string } | null };
  };
  /** The human opens the confirm page (nonce is served only to the cookie session), then confirms. */
  const humanConfirm = async (proposalId: string) => {
    const view = await json(await nextRequest(`/api/proposals/${proposalId}/confirm`, { method: "GET", ...human }));
    expect(view.status).toBe(200);
    const confirmed = await json(await nextRequest(`/api/proposals/${proposalId}/confirm`, { method: "POST", ...human, body: JSON.stringify({ nonce: view.body.data.confirm_nonce }) }));
    expect(confirmed.status, JSON.stringify(confirmed.body.error)).toBe(200);
    expect(confirmed.body.data.status).toBe("confirmed");
    confirmedBy.push(String((db.query("SELECT confirmed_by_user_id AS u FROM decision_proposal WHERE id = ?").get(proposalId) as { u: string }).u));
  };
  const proposeThenConfirm = async (name: string, args: Record<string, unknown>) => {
    const before = decisionRows();
    const made = await callTool(name, args);
    expect(made.error).toBeNull();
    expect(made.data.status).toBe("pending");
    // Proposed, not decided: nothing was recorded until the human confirms.
    if (decisionRows() !== before) pendingLeftDecisionsUntouched.value = false;
    await humanConfirm(made.data.proposal_id);
    expect(decisionRows()).toBe(before + 1);
  };

  for (const g of GATE_STEPS(ids, track)) {
    if (path === "rest") await restDecide(g);
    else await proposeThenConfirm("propose_gate_decision", { entityId: g.entityId, gate: g.gate, decision: "go", rationale: rationale(g.gate), gap_rationale: gapRationale(g.gate) });
    trace.push(snapshot(`gate:${g.gate}`, ids));
  }

  // ADR-0161: the greenfield execution baseline is human-only on BOTH paths (no MCP tool may confirm it).
  if (track === "greenfield") {
    { const base = `/api/projects/${ids.projectId}/execution-baseline`;
      const entries = { permit_milestones: [{ name: "건축허가", issuer: "시청", target_date: "2027-03-01" }], hiring_plan: [{ role_family: "생산", quarter: "2027-Q1", headcount: 10 }], kpi_targets: [{ metric_key: "revenue_vs_case", target_value: 100, due: "2028-Q4" }] };
      expect((await nextRequest(base, { method: "POST", headers: human.headers, body: JSON.stringify({ action: "record_entries", entries }) })).status).toBe(201);
      const first = await nextRequest(base, { method: "POST", headers: human.headers, body: JSON.stringify({ action: "confirm", rationale: "Parity scenario: the baseline is confirmed by the human." }) });
      let st = first.status;
      if (st === 409) {
        const open = ((await first.json()) as { meta: { open_findings: Array<{ code: string }> } }).meta.open_findings;
        st = (await nextRequest(base, { method: "POST", headers: human.headers, body: JSON.stringify({ action: "confirm", rationale: "Parity scenario: the baseline is confirmed by the human.", acknowledged_findings: open.map((f) => ({ code: f.code, rationale: "테스트 픽스처: 확인" })) }) })).status;
      }
      expect(st).toBe(201); }
  }

  if (path === "rest") await restTransition();
  else await proposeThenConfirm("propose_transition_decision", { projectId: ids.projectId, decision: "graduate_to_core", rationale: transitionBody().rationale, core_handoff: transitionBody().core_handoff });
  trace.push(snapshot("transition", ids));

  // The MCP surface has no way to close: try it, then the human closes on both paths.
  let closeRefused: unknown = null;
  let closedRowsAfterAttempt = 0;
  let projectStatusAfterAttempt = "";
  if (path === "mcp") {
    const port = new InProcessRestPort({ userId: HUMAN, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "parity-token", clientId: "parity" });
    closeRefused = await port.post(`/api/projects/${ids.projectId}/close`, closeBody());
    closedRowsAfterAttempt = count(db, "SELECT COUNT(*) AS c FROM closure_record");
    projectStatusAfterAttempt = String((db.query("SELECT status FROM md_project WHERE id = ?").get(ids.projectId) as { status: string }).status);
    const viaTool = await client!.callTool({ name: "close_project", arguments: closeBody() });
    expect(viaTool.isError).toBe(true);
  }
  const closed = await json(await nextRequest(`/api/projects/${ids.projectId}/close`, { method: "POST", ...human, body: JSON.stringify(closeBody()) }));
  expect(closed.status, JSON.stringify(closed.body.error)).toBe(200);
  trace.push(snapshot("closed", ids));
  await client?.close();

  return {
    trace,
    gates: db.query("SELECT entity_type, gate, decision, decided_by FROM gate_decision ORDER BY entity_type DESC, gate").all() as RunResult["gates"],
    transition: (db.query("SELECT decision, decided_by FROM venture_transition_decision").get() as RunResult["transition"]) ?? null,
    closure: (db.query("SELECT closure_type, closed_by FROM closure_record").get() as RunResult["closure"]) ?? null,
    proposalsConfirmedBy: confirmedBy,
    ...(path === "mcp" ? { mcp: { toolNames, pendingLeftDecisionsUntouched: pendingLeftDecisionsUntouched.value, closeRefused, closedRowsAfterAttempt, projectStatusAfterAttempt } } : {}),
  };
}

// ── the tests ───────────────────────────────────────────────────────────

describe.each<Track>(["brownfield", "greenfield"])("%s S1→S12 parity", (track) => {
  let rest!: RunResult;
  let mcp!: RunResult;

  test("both paths run the scenario", async () => {
    rest = await runScenario(track, "rest");
    mcp = await runScenario(track, "mcp");
    expect(rest.trace.map((s) => s.step)).toEqual(mcp.trace.map((s) => s.step));
  }, 120_000);

  test("evaluateProcess is equal at every step boundary", () => {
    for (let i = 0; i < rest.trace.length; i++) {
      expect(mcp.trace[i].opportunity, `opportunity after ${rest.trace[i].step}`).toEqual(rest.trace[i].opportunity);
      expect(mcp.trace[i].project, `project after ${rest.trace[i].step}`).toEqual(rest.trace[i].project);
    }
  });

  test("both reach S12 complete and a typed closure", () => {
    for (const run of [rest, mcp]) {
      const last = run.trace[run.trace.length - 1].project as { completedStages: string[]; currentStage: string | null };
      expect(last.completedStages).toContain("S12");
      expect(last.currentStage).toBeNull();
      expect(run.closure).toEqual({ closure_type: "graduated_to_core", closed_by: HUMAN });
    }
    // The state before the final decisions is genuinely incomplete, so the equality above is not vacuous.
    const afterGates = rest.trace.find((s) => s.step === "gate:group_ic")!.project as { completedStages: string[] };
    expect(afterGates.completedStages).not.toContain("S12");
    const seeded = rest.trace[0].project as { completedStages: string[] };
    expect(seeded.completedStages).not.toContain("S11");
  });

  test("the recorded decisions are the same, and every decider is the human", () => {
    expect(mcp.gates).toEqual(rest.gates);
    expect(mcp.gates.every((g) => g.decided_by === HUMAN)).toBe(true);
    expect(mcp.transition).toEqual(rest.transition);
    // The transition ledger pins decided_by to the human role string; the agent id never appears.
    expect(mcp.transition?.decided_by).toBe("venture-portfolio-ic");
    expect(mcp.proposalsConfirmedBy.length).toBe(mcp.gates.length + 1);
    expect(mcp.proposalsConfirmedBy.every((u) => u === HUMAN)).toBe(true);
    expect(mcp.closure?.closed_by).toBe(HUMAN);
  });

  test("the MCP path cannot close and cannot decide without the human confirm", () => {
    const m = mcp.mcp!;
    expect(m.toolNames.some((n) => /clos|archive/i.test(n))).toBe(false);
    expect(m.pendingLeftDecisionsUntouched).toBe(true);
    expect(JSON.stringify(m.closeRefused)).toMatch(/not_found|human_only/);
    expect(m.closedRowsAfterAttempt).toBe(0);
    expect(m.projectStatusAfterAttempt).not.toBe("closed");
  });
});
