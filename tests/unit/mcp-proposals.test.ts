// @version 1.0.0
/**
 * Wave M PR M-2 (ADR-0154 §5) — proposal-only decisions. Exercises the real
 * route handlers (OAuth, /api/mcp, /api/proposals, the confirm routes) against
 * a migrated test DB:
 *   - propose_* tools write only decision_proposal; the decision tables keep
 *     their row counts until a human confirms,
 *   - confirm runs the existing decision route as the human (decided_by),
 *   - expired / foreign / stale-nonce / bearer / agent-identity / viewer
 *     confirmations are rejected,
 *   - MCP elicitation only points to the page.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { RestPort } from "../../mcp/co-newbiz/shared/rest-port.ts";
import type { Envelope } from "../../mcp/co-newbiz/shared/rest-client.ts";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-mcp-proposals.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
const ORIGIN = "http://localhost:7749";
process.env.CO_NEWBIZ_PUBLIC_ORIGIN = ORIGIN;
const RESOURCE = `${ORIGIN}/api/mcp`;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { createUser, approveUser, authenticate: login } = await import("../../db/lib/accounts.ts");
const { issueApiToken } = await import("../../db/lib/api-tokens.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { AGENT_KEYS } = await import("../../app/web-next/lib/agent-registry.generated.ts");
const registerRoute = await import("../../app/web-next/app/api/oauth/register/route.ts");
const authorizeRoute = await import("../../app/web-next/app/api/oauth/authorize/route.ts");
const tokenRoute = await import("../../app/web-next/app/api/oauth/token/route.ts");
const mcpRoute = await import("../../app/web-next/app/api/mcp/route.ts");
const proposalsRoute = await import("../../app/web-next/app/api/proposals/route.ts");
const proposalRoute = await import("../../app/web-next/app/api/proposals/[id]/route.ts");
const confirmRoute = await import("../../app/web-next/app/api/proposals/[id]/confirm/route.ts");
const rejectRoute = await import("../../app/web-next/app/api/proposals/[id]/reject/route.ts");
const { resetMcpSessionsForTest } = await import("../../app/web-next/lib/mcp/http-server.ts");

const NOW = new Date().toISOString();
const REDIRECT = "http://127.0.0.1:33418/callback";
const AGENT_ID = [...AGENT_KEYS][0];
const sessions: Record<string, string> = {};
let clientId = "";
let oppId = "";
let projectId = "";

const DECISION_TABLES = ["gate_decision", "route_decision", "venture_transition_decision", "closure_record"] as const;
const count = (table: string): number => (db.query(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
const decisionCounts = () => Object.fromEntries(DECISION_TABLES.map((t) => [t, count(t)])) as Record<(typeof DECISION_TABLES)[number], number>;
const humanFinalCount = () => (db.query("SELECT COUNT(*) AS c FROM review_stage WHERE stage = 'human_final'").get() as { c: number }).c;

beforeAll(async () => {
  for (const [userId, role] of [["alice", "analyst"], ["bob", "viewer"], ["carol", "analyst"], ["dave", "admin"], [AGENT_ID, "analyst"]] as const) {
    await createUser(db, { userId, role, password: `pw-${userId}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  for (const userId of ["alice", "bob", "carol", "dave", AGENT_ID]) {
    const r = await login(db, { userId, password: `pw-${userId}-12345`, now: NOW });
    if (!r.ok) throw new Error(`login failed for ${userId}`);
    sessions[userId] = r.session.token;
  }
  const reg = await registerRoute.POST(
    new Request(`${ORIGIN}/api/oauth/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Proposal Connector", redirect_uris: [REDIRECT] }),
    }),
  );
  clientId = ((await reg.json()) as { client_id: string }).client_id;

  oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [oppId, "Proposal opp", "selected", "alice", NOW]);
  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, "NP-M2-T", NOW]);
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [projectId, "alice", "lead", "test", NOW, "m2 test"]);
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [projectId, "bob", "member", "test", NOW, "m2 test"]);
});

afterAll(() => {
  resetMcpSessionsForTest();
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

// ── helpers ─────────────────────────────────────────────────────────────

function cookieHeaders(userId: string): Record<string, string> {
  return { "Content-Type": "application/json", cookie: `co_newbiz_session=${sessions[userId]}; co_newbiz_csrf=csrf-test`, "x-csrf-token": "csrf-test" };
}

async function getCode(userId: string, scope: string, challenge: string): Promise<string> {
  const res = await authorizeRoute.POST(
    new Request(`${ORIGIN}/api/oauth/authorize`, {
      method: "POST", headers: cookieHeaders(userId),
      body: JSON.stringify({
        decision: "approve", response_type: "code", client_id: clientId, redirect_uri: REDIRECT, scope, state: "s",
        code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE,
      }),
    }),
  );
  expect(res.status).toBe(200);
  const redirect = new URL(((await res.json()) as { data: { redirect_to: string } }).data.redirect_to);
  return redirect.searchParams.get("code") ?? "";
}

async function issueAccess(userId: string, scope: string): Promise<string> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const code = await getCode(userId, scope, challenge);
  const res = await tokenRoute.POST(
    new Request(`${ORIGIN}/api/oauth/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier, resource: RESOURCE }).toString(),
    }),
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

let rpcId = 0;
function mcpRequest(token: string, body: unknown, sessionId?: string): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18", Authorization: `Bearer ${token}`,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  return new Request(RESOURCE, { method: "POST", headers, body: JSON.stringify(body) });
}

async function readRpc(res: Response): Promise<{ result?: Record<string, unknown> }> {
  const text = await res.text();
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const line = text.split("\n").find((l) => l.startsWith("data: ") && l.length > 6);
    return JSON.parse((line ?? "data: {}").slice(6));
  }
  return JSON.parse(text);
}

async function openSession(token: string): Promise<string> {
  const res = await mcpRoute.POST(mcpRequest(token, { jsonrpc: "2.0", id: ++rpcId, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }));
  const sid = res.headers.get("mcp-session-id") ?? "";
  await readRpc(res);
  await mcpRoute.POST(mcpRequest(token, { jsonrpc: "2.0", method: "notifications/initialized" }, sid));
  return sid;
}

// The server caps sessions per user, so each (user, scope) pair opens one session.
const sessionCache = new Map<string, { access: string; sid: string }>();
async function mcpSession(userId: string, scope: string): Promise<{ access: string; sid: string }> {
  const key = `${userId}|${scope}`;
  const hit = sessionCache.get(key);
  if (hit) return hit;
  const access = await issueAccess(userId, scope);
  const created = { access, sid: await openSession(access) };
  sessionCache.set(key, created);
  return created;
}

async function callMcpTool(token: string, sid: string, name: string, args: unknown): Promise<{ isError: boolean; text: string }> {
  const res = await mcpRoute.POST(mcpRequest(token, { jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }, sid));
  const body = await readRpc(res);
  const result = body.result as { content: Array<{ text: string }>; isError?: boolean };
  return { isError: result.isError === true, text: result.content[0].text };
}

interface ProposeResult { data: { proposal_id: string; confirm_url: string; status: string }; error: { code: string; message: string } | null }

async function propose(access: string, sid: string, name: string, args: unknown): Promise<ProposeResult> {
  const r = await callMcpTool(access, sid, name, args);
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text) as ProposeResult;
}

const confirmReq = (id: string, userId: string, method: "GET" | "POST", body?: unknown, extra: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/proposals/${id}/confirm`, {
    method, headers: { ...cookieHeaders(userId), ...extra }, body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function loadConfirm(id: string, userId: string): Promise<{ status: number; nonce: string | null; proposal: { status: string } | null }> {
  const res = await confirmRoute.GET(confirmReq(id, userId, "GET"), params(id));
  const body = (await res.json()) as { data: { confirm_nonce: string | null; proposal: { status: string } } | null };
  return { status: res.status, nonce: body.data?.confirm_nonce ?? null, proposal: body.data?.proposal ?? null };
}

const rowOf = (id: string) => db.query("SELECT * FROM decision_proposal WHERE id = ?").get(id) as Record<string, string | null>;

const GATE_ARGS = { entityId: "", gate: "screening", decision: "go", rationale: "Clears the knock-out set." };

// ── propose_* writes only decision_proposal ─────────────────────────────

describe("propose tools create proposals only", () => {
  test("every propose kind leaves the decision tables untouched", async () => {
    const { access, sid } = await mcpSession("alice", "read propose");
    const before = decisionCounts();
    const humanBefore = humanFinalCount();
    const created: Array<{ name: string; args: Record<string, unknown> }> = [
      { name: "propose_gate_decision", args: { ...GATE_ARGS, entityId: oppId } },
      { name: "propose_gate_decision", args: { entityId: projectId, gate: "fs", decision: "hold", rationale: "Needs a case.", missing_artifacts: ["Business Case"] } },
      { name: "propose_route_decision", args: { opportunityId: oppId, track: "greenfield", rationale: "No incumbent.", intent: "integration", scores: ["control_need", "capability_criticality", "market_uncertainty", "integration_capacity", "speed_to_capability"].map((c) => ({ criterion: c, score: 2, evidence_note: "n" })) } },
      { name: "propose_case_adoption", args: { projectId, model_id: "M1", rationale: "Best NPV." } },
      { name: "propose_target_selection", args: { projectId, target_id: "T1", rationale: "Highest fit." } },
      { name: "propose_transition_decision", args: { projectId, decision: "next_tranche_released", rationale: "On plan.", tranche_condition: "KPIs met" } },
      { name: "propose_approval", args: { projectId, subject: "charter_baseline", rationale: "Baseline reviewed." } },
      { name: "propose_approval", args: { projectId, subject: "dd_checklist_judgment", details: { checklist_id: "chk-x", item_id: "i1", status: "met" }, rationale: "Evidence attached." } },
      { name: "propose_approval", args: { projectId, subject: "four_axis_completion", details: { hypothesis_id: "h1", artifact_ref: "a1" }, rationale: "Four axes done." } },
    ];
    const kinds: string[] = [];
    for (const c of created) {
      const r = await propose(access, sid, c.name, c.args);
      expect(r.error).toBeNull();
      expect(r.data.status).toBe("pending");
      expect(r.data.confirm_url).toBe(`${ORIGIN}/proposals/${r.data.proposal_id}/confirm`);
      kinds.push(rowOf(r.data.proposal_id).kind as string);
    }
    expect(kinds).toEqual(["gate_decision", "gate_decision", "route_decision", "case_adoption", "target_selection", "transition_decision", "approval", "approval", "approval"]);
    expect(decisionCounts()).toEqual(before);
    expect(humanFinalCount()).toBe(humanBefore);
    const row = rowOf((await propose(access, sid, "propose_gate_decision", { ...GATE_ARGS, entityId: oppId, gate: "pre_fs" })).data.proposal_id);
    expect(row.proposed_by_user_id).toBe("alice");
    expect(row.via_client_id).toBe(clientId);
    expect(row.status).toBe("pending");
    expect(Date.parse(row.expires_at as string) - Date.parse(row.created_at as string)).toBe(72 * 3600 * 1000);
  });

  test("a propose-only token proposes but cannot call write tools; a write-only token cannot propose", async () => {
    const { access: proposeOnly, sid: sid } = await mcpSession("alice", "propose");
    await propose(proposeOnly, sid, "propose_gate_decision", { ...GATE_ARGS, entityId: oppId });
    const w = await callMcpTool(proposeOnly, sid, "create_opportunity", { name: "should not exist" });
    expect(w.isError).toBe(true);
    expect(w.text).toContain("insufficient_scope");
    expect(db.query("SELECT COUNT(*) AS c FROM opportunity WHERE name = 'should not exist'").get()).toEqual({ c: 0 });

    const { access: writeOnly, sid: sid2 } = await mcpSession("alice", "read write");
    const p = await callMcpTool(writeOnly, sid2, "propose_gate_decision", { ...GATE_ARGS, entityId: oppId });
    expect(p.isError).toBe(true);
    expect(p.text).toContain("insufficient_scope");
  });

  test("an invalid payload is refused before any row is written", async () => {
    const { access, sid } = await mcpSession("alice", "read propose");
    const before = count("decision_proposal");
    const hold = await callMcpTool(access, sid, "propose_gate_decision", { ...GATE_ARGS, entityId: oppId, decision: "hold" });
    expect(JSON.parse(hold.text).error.code).toBe("invalid_payload");
    const kill = await callMcpTool(access, sid, "propose_gate_decision", { ...GATE_ARGS, entityId: oppId, decision: "kill" });
    expect(JSON.parse(kill.text).error.code).toBe("invalid_payload");
    const missing = await callMcpTool(access, sid, "propose_gate_decision", { ...GATE_ARGS, entityId: "no-such-opportunity" });
    expect(JSON.parse(missing.text).error.code).toBe("not_found");
    expect(count("decision_proposal")).toBe(before);
  });

  test("the deprecated aliases create proposals over HTTP too (no direct-write exception)", async () => {
    const { access, sid } = await mcpSession("alice", "read propose");
    const before = decisionCounts();
    const r = await propose(access, sid, "record_gate_decision", { opportunityId: oppId, gate: "screening", decision: "go", rationale: "alias" });
    expect(r.data.status).toBe("pending");
    expect((r as unknown as { deprecation: { replacement: string } }).deprecation.replacement).toBe("propose_gate_decision");
    expect(decisionCounts()).toEqual(before);
  });

  test("a project the proposer cannot see is not found, and a viewer cannot propose", async () => {
    const { access: carol, sid: sid } = await mcpSession("carol", "read propose");
    const r = await callMcpTool(carol, sid, "propose_case_adoption", { projectId, model_id: "M1", rationale: "x" });
    expect(JSON.parse(r.text).error.code).toBe("not_found");
    const bobRes = await proposalsRoute.POST(
      new Request(`${ORIGIN}/api/proposals`, { method: "POST", headers: cookieHeaders("bob"), body: JSON.stringify({ kind: "case_adoption", entity_id: projectId, payload: { model_id: "M" }, rationale: "r" }) }),
      {},
    );
    expect(bobRes.status).toBe(403);
  });
});

// ── the human confirms ──────────────────────────────────────────────────

describe("confirmation executes as the human", () => {
  async function fresh(args: Record<string, unknown> = {}): Promise<string> {
    const { access, sid } = await mcpSession("alice", "read propose");
    return (await propose(access, sid, "propose_gate_decision", { ...GATE_ARGS, entityId: oppId, ...args })).data.proposal_id;
  }

  test("confirming runs the gate-decision route in the human session; decided_by is the human", async () => {
    const id = await fresh();
    const before = decisionCounts();
    expect(decisionCounts()).toEqual(before);
    const view = await loadConfirm(id, "carol"); // another analyst who can see the opportunity decides
    expect(view.status).toBe(200);
    expect(view.nonce).toBeTruthy();
    const res = await confirmRoute.POST(confirmReq(id, "carol", "POST", { nonce: view.nonce }), params(id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string; resulting_record_id: string } };
    expect(body.data.status).toBe("confirmed");
    expect(count("gate_decision")).toBe(before.gate_decision + 1);
    const gate = db.query("SELECT decided_by, gate, decision, rationale FROM gate_decision WHERE id = ?").get(body.data.resulting_record_id) as { decided_by: string; gate: string; decision: string };
    expect(gate.decided_by).toBe("carol");
    expect(gate).toMatchObject({ gate: "screening", decision: "go" });
    const row = rowOf(id);
    expect(row).toMatchObject({ status: "confirmed", confirmed_by_user_id: "carol", resulting_record_id: body.data.resulting_record_id, proposed_by_user_id: "alice" });
  });

  test("the nonce is single use and required", async () => {
    const id = await fresh();
    const noNonce = await confirmRoute.POST(confirmReq(id, "alice", "POST", {}), params(id));
    expect(noNonce.status).toBe(400);
    const wrong = await confirmRoute.POST(confirmReq(id, "alice", "POST", { nonce: "forged" }), params(id));
    expect(wrong.status).toBe(409);
    const view = await loadConfirm(id, "alice");
    const ok = await confirmRoute.POST(confirmReq(id, "alice", "POST", { nonce: view.nonce }), params(id));
    expect(ok.status).toBe(200);
    const replay = await confirmRoute.POST(confirmReq(id, "alice", "POST", { nonce: view.nonce }), params(id));
    expect(replay.status).toBe(409);
    expect(((await replay.json()) as { error: { code: string } }).error.code).toBe("proposal_confirmed");
  });

  test("an edited payload is validated, executed, and kept next to the proposed one (show-diff)", async () => {
    const id = await fresh();
    const view = await loadConfirm(id, "alice");
    const bad = await confirmRoute.POST(confirmReq(id, "alice", "POST", { nonce: view.nonce, payload: { gate: "screening", decision: "hold", rationale: "x" } }), params(id));
    expect(bad.status).toBe(400); // hold without missing_artifacts
    const moved = await confirmRoute.POST(confirmReq(id, "alice", "POST", { nonce: view.nonce, payload: { gate: "fs", decision: "go", rationale: "x" } }), params(id));
    expect(moved.status).toBe(400); // different carrier
    const edited = { ...JSON.parse(rowOf(id).payload_json as string), rationale: "Edited by the human." };
    const res = await confirmRoute.POST(confirmReq(id, "alice", "POST", { nonce: view.nonce, payload: edited }), params(id));
    expect(res.status).toBe(200);
    const row = rowOf(id);
    expect(JSON.parse(row.payload_json as string).rationale).toBe("Clears the knock-out set.");
    expect(JSON.parse(row.confirmed_payload_json as string).rationale).toBe("Edited by the human.");
    const gate = db.query("SELECT rationale FROM gate_decision WHERE id = ?").get(row.resulting_record_id) as { rationale: string };
    expect(gate.rationale).toBe("Edited by the human.");
  });

  test("when the decision route refuses, the proposal stays pending and nothing is decided", async () => {
    const { access, sid } = await mcpSession("alice", "read propose");
    // No charter was built for this bare project, so the existing route answers 400.
    const id = (await propose(access, sid, "propose_approval", { projectId, subject: "charter_baseline", rationale: "r" })).data.proposal_id;
    const view = await loadConfirm(id, "alice");
    const res = await confirmRoute.POST(confirmReq(id, "alice", "POST", { nonce: view.nonce }), params(id));
    expect(res.status).toBe(400);
    expect(rowOf(id).status).toBe("pending");
    expect(rowOf(id).confirmed_by_user_id).toBeNull();
  });

  test("a confirmer without decision authority is refused (the route's 403), and nothing is recorded", async () => {
    const id = await fresh({ entityId: projectId, gate: "fs", decision: "go" });
    const before = decisionCounts();
    const asBob = await confirmRoute.GET(confirmReq(id, "bob", "GET"), params(id));
    expect(asBob.status).toBe(403); // viewer, even as a project member
    const post = await confirmRoute.POST(confirmReq(id, "bob", "POST", { nonce: "x" }), params(id));
    expect(post.status).toBe(403);
    expect(decisionCounts()).toEqual(before);
    expect(rowOf(id).status).toBe("pending");
  });

  test("reject records no decision and ends the proposal", async () => {
    const id = await fresh();
    const before = decisionCounts();
    const res = await rejectRoute.POST(new Request(`${ORIGIN}/api/proposals/${id}/reject`, { method: "POST", headers: cookieHeaders("alice"), body: "{}" }), params(id));
    expect(res.status).toBe(200);
    expect(rowOf(id).status).toBe("rejected");
    expect(decisionCounts()).toEqual(before);
    const view = await loadConfirm(id, "alice");
    expect(view.nonce).toBeNull();
    const again = await confirmRoute.POST(confirmReq(id, "alice", "POST", { nonce: "x" }), params(id));
    expect(again.status).toBe(409);
  });

  test("a newer proposal from the same proposer supersedes the older one", async () => {
    const first = await fresh({ decision: "go" });
    const second = await fresh({ decision: "go", rationale: "Second look." });
    expect(rowOf(first).status).toBe("superseded");
    expect(rowOf(second).status).toBe("pending");
  });
});

// ── rejections ──────────────────────────────────────────────────────────

describe("expired, foreign, bearer, and agent confirmations are rejected", () => {
  async function fresh(): Promise<string> {
    const { access, sid } = await mcpSession("alice", "read propose");
    return (await propose(access, sid, "propose_case_adoption", { projectId, model_id: "M9", rationale: "r" })).data.proposal_id;
  }

  test("an expired proposal cannot be confirmed and gets no nonce", async () => {
    const id = await fresh();
    db.run("UPDATE decision_proposal SET expires_at = ? WHERE id = ?", [new Date(Date.now() - 1000).toISOString(), id]);
    const view = await loadConfirm(id, "alice");
    expect(view.proposal?.status).toBe("expired");
    expect(view.nonce).toBeNull();
    const res = await confirmRoute.POST(confirmReq(id, "alice", "POST", { nonce: "x" }), params(id));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("proposal_expired");
  });

  test("a foreign proposal is invisible to a non-member (404) and closed to an admin (403)", async () => {
    const id = await fresh();
    expect((await confirmRoute.GET(confirmReq(id, "carol", "GET"), params(id))).status).toBe(404);
    expect((await confirmRoute.GET(confirmReq(id, "dave", "GET"), params(id))).status).toBe(403);
    expect((await confirmRoute.POST(confirmReq(id, "carol", "POST", { nonce: "x" }), params(id))).status).toBe(404);
    const status = await proposalRoute.GET(new Request(`${ORIGIN}/api/proposals/${id}`, { headers: cookieHeaders("carol") }), params(id));
    expect(status.status).toBe(404);
    expect(rowOf(id).status).toBe("pending");
  });

  test("a bearer token — personal or OAuth — can never confirm", async () => {
    const id = await fresh();
    const view = await loadConfirm(id, "alice");
    const before = decisionCounts();
    const personal = issueApiToken(db, { userId: "alice", label: "stdio", scopes: ["read", "write"], now: NOW }).token;
    const viaPersonal = await confirmRoute.POST(
      new Request(`${ORIGIN}/api/proposals/${id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${personal}` }, body: JSON.stringify({ nonce: view.nonce }) }),
      params(id),
    );
    expect(viaPersonal.status).toBe(403);
    expect(((await viaPersonal.json()) as { error: { code: string } }).error.code).toBe("session_required");
    const oauth = await issueAccess("alice", "read write propose");
    const viaOauth = await confirmRoute.POST(
      new Request(`${ORIGIN}/api/proposals/${id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${oauth}` }, body: JSON.stringify({ nonce: view.nonce }) }),
      params(id),
    );
    expect([401, 403]).toContain(viaOauth.status);
    const viaGet = await confirmRoute.GET(new Request(`${ORIGIN}/api/proposals/${id}/confirm`, { headers: { Authorization: `Bearer ${personal}` } }), params(id));
    expect(viaGet.status).toBe(403);
    expect(decisionCounts()).toEqual(before);
    expect(rowOf(id).status).toBe("pending");
  });

  test("an agent identity cannot confirm even with a valid session", async () => {
    const id = await fresh();
    const res = await confirmRoute.GET(confirmReq(id, AGENT_ID, "GET"), params(id));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("agent_forbidden");
    const post = await confirmRoute.POST(confirmReq(id, AGENT_ID, "POST", { nonce: "x" }), params(id));
    expect(post.status).toBe(403);
  });

  test("cookie confirmation still needs the CSRF pair", async () => {
    const id = await fresh();
    const view = await loadConfirm(id, "alice");
    const res = await confirmRoute.POST(
      new Request(`${ORIGIN}/api/proposals/${id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json", cookie: `co_newbiz_session=${sessions.alice}` }, body: JSON.stringify({ nonce: view.nonce }) }),
      params(id),
    );
    expect(res.status).toBe(403);
    expect(rowOf(id).status).toBe("pending");
  });
});

// ── proposal status and listing ─────────────────────────────────────────

describe("status tools", () => {
  test("get_proposal_status and list_my_proposals work over MCP and never expose another user's proposals", async () => {
    const { access: alice, sid: sid } = await mcpSession("alice", "read propose");
    const made = await propose(alice, sid, "propose_gate_decision", { ...GATE_ARGS, entityId: oppId, gate: "target_screening" });
    const status = await callMcpTool(alice, sid, "get_proposal_status", { proposalId: made.data.proposal_id });
    expect(JSON.parse(status.text).data.status).toBe("pending");
    const list = JSON.parse((await callMcpTool(alice, sid, "list_my_proposals", { status: "pending" })).text) as { data: Array<{ proposed_by_user_id: string }> };
    expect(list.data.length).toBeGreaterThan(0);
    expect(list.data.every((p) => p.proposed_by_user_id === "alice")).toBe(true);
    const { access: carol, sid: csid } = await mcpSession("carol", "read");
    const other = await callMcpTool(carol, csid, "list_my_proposals", {});
    expect((JSON.parse(other.text) as { data: unknown[] }).data).toEqual([]);
  });
});

// ── elicitation points to the page, nothing more ────────────────────────

describe("MCP elicitation", () => {
  test("a client that supports elicitation is pointed at the confirm URL; its answer decides nothing", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { ElicitRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
    const { buildMcpServer } = await import("../../mcp/co-newbiz/registry.ts");

    const posts: string[] = [];
    const empty = async <T,>(): Promise<Envelope<T>> => ({ data: null as T, meta: {}, error: null });
    const port: RestPort = {
      get: empty,
      put: empty,
      patch: empty,
      delete: empty,
      post: async <T,>(path: string): Promise<Envelope<T>> => {
        posts.push(path);
        return { data: { proposal_id: "PRP1", confirm_url: `${ORIGIN}/proposals/PRP1/confirm`, status: "pending" } as T, meta: {}, error: null };
      },
    };
    const server = buildMcpServer({ transport: "http", resolveContext: () => ({ port, scopes: ["read", "propose"] }) });
    const client = new Client({ name: "elicit-test", version: "0" }, { capabilities: { elicitation: { url: {} } } });
    const seen: Array<Record<string, unknown>> = [];
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      seen.push(request.params as Record<string, unknown>);
      return { action: "accept" };
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);

    const before = decisionCounts();
    const result = await client.callTool({ name: "propose_gate_decision", arguments: { ...GATE_ARGS, entityId: "o1" } });
    expect(result.isError).not.toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toHaveLength(1);
    expect(seen[0].mode).toBe("url");
    expect(seen[0].url).toBe(`${ORIGIN}/proposals/PRP1/confirm`);
    expect(String(seen[0].message)).toContain("Nothing is decided yet");
    // The accepted elicitation reply made no further call: the only route hit is the proposal POST.
    expect(posts).toEqual(["/api/proposals"]);
    expect(decisionCounts()).toEqual(before);
    await client.close();
  });
});
