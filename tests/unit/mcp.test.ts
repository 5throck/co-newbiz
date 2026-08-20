// @version 1.0.0
/**
 * Wave 5.7A MCP server tests — docs/mcp-integration.md. Runs the real Hono
 * app (Bun.serve on an ephemeral port) and calls the MCP server's own
 * dispatch() against it over real HTTP with real Bearer tokens — not
 * mocked handlers. A separate describe verifies the actual stdio JSON-RPC
 * transport once, since dispatch() alone doesn't exercise the SDK wiring.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "bun";

const TEST_DB_PATH = "db/data/test-mcp.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { buildApp } = await import("../../app/server/index.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { grantProjectMembership } = await import("../../db/lib/access-control.ts");
const { issueApiToken } = await import("../../db/lib/api-tokens.ts");
const { createProject } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

const NOW = new Date().toISOString();
let server: Server;
let projectId: string;
let readToken: string;
let writeToken: string;

beforeAll(async () => {
  const app = buildApp();
  server = Bun.serve({ port: 0, fetch: app.fetch });
  process.env.CO_NEWBIZ_API_BASE_URL = `http://localhost:${server.port}`;

  await createUser(db, { userId: "alice", role: "analyst", password: "pw-alice-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "alice", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "bob", role: "analyst", password: "pw-bob-123456", createdBy: "test", now: NOW });
  approveUser(db, { userId: "bob", approvedBy: "test", now: NOW });

  readToken = issueApiToken(db, { userId: "bob", label: "mcp-read", scopes: ["read"], now: NOW }).token;
  writeToken = issueApiToken(db, { userId: "alice", label: "mcp-write", scopes: ["read", "write"], now: NOW }).token;

  const project = createProject("NP-2026-701");
  projectId = project.id;
  grantProjectMembership(db, { projectId, userId: "alice", projectRole: "lead", grantedBy: "alice", needToKnowBasis: "test", now: NOW });

  const runId = ulid();
  db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [runId, projectId, "test v1", "deadbeef", "alice", NOW]);
  db.run(
    "INSERT INTO rag_assessment (id, run_id, project_id, dimension, grade, rationale, assessed_at) VALUES (?,?,?,?,?,?,?)",
    [ulid(), runId, projectId, "financial", "green", "IRR clears hurdle by 3.1%p", NOW],
  );
});

afterAll(async () => {
  server.stop(true);
  resetDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
      return;
    } catch {
      await Bun.sleep(50 * (attempt + 1));
    }
  }
});

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walkTs(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("ADR-0011 — no direct DB access from the MCP server (FR-SYS-01)", () => {
  test("no file under mcp/co-newbiz imports bun:sqlite or a db module", () => {
    const forbidden = /^\s*import\b.*(bun:sqlite|db\/client|db\/repositories|db\/lib)/m;
    const offenders = walkTs("mcp/co-newbiz").filter((f) => forbidden.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("tool catalog", () => {
  test("every registered tool has a name and an object input schema", async () => {
    const { TOOLS } = await import("../../mcp/co-newbiz/index.ts");
    expect(TOOLS.length).toBeGreaterThanOrEqual(11);
    for (const tool of TOOLS) {
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});

describe("read tools (deny-by-default relayed from REST)", () => {
  test("list_projects excludes projects the caller isn't a member of", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = readToken; // bob — not a member
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("list_projects", {})) as { data: unknown[] };
    expect(result.data).toHaveLength(0);
  });

  test("list_projects returns the lead's own project", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken; // alice — lead
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("list_projects", {})) as { data: { id: string }[] };
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe(projectId);
  });

  test("get_project_status combines project detail and RAG dimensions", async () => {
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("get_project_status", { projectId })) as {
      project: { data: unknown };
      rag: { data: { dimensions: unknown[] } };
    };
    expect(result.project.data).not.toBeNull();
    expect(result.rag.data.dimensions).toHaveLength(1);
  });

  test("get_rag_assessment carries the mandatory rationale", async () => {
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("get_rag_assessment", { projectId })) as { data: { dimensions: { rationale: string }[] } };
    expect(result.data.dimensions[0].rationale).toContain("IRR");
  });

  test("a non-member gets the REST 404 unchanged — existence stays protected", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = readToken; // bob — not a member
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("get_rag_assessment", { projectId })) as { error: { code: string } | null };
    expect(result.error?.code).toBe("not_found");
  });

  test("lookup_term resolves a registered glossary term", async () => {
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("lookup_term", { term: "WACC" })) as { data: { ko: string } };
    expect(result.data.ko.length).toBeGreaterThan(0);
  });

  test("get_procedure resolves a real shared procedure", async () => {
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("get_procedure", { procedure: "brownfield-screening" })) as { data: { steps: unknown[] } };
    expect(result.data.steps.length).toBeGreaterThan(0);
  });

  test("get_approval_chain / get_compliance_status / list_waivers / search_interpretations / list_notifications all respond", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    for (const [tool, args] of [
      ["get_approval_chain", { projectId }],
      ["get_compliance_status", { projectId }],
      ["list_waivers", { projectId }],
      ["search_interpretations", {}],
      ["list_notifications", {}],
    ] as const) {
      const result = (await dispatch(tool, args)) as { data: unknown[] };
      expect(Array.isArray(result.data)).toBe(true);
    }
  });
});

describe("manage_watch — scope-gated write tool", () => {
  let watchId: string;

  test("write scope can create a watch", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("manage_watch", {
      action: "create",
      projectId,
      rules: [{ trigger_type: "rag_downgrade", channel: "in_app" }],
    })) as { data: { id: string } };
    expect(typeof result.data.id).toBe("string");
    watchId = result.data.id;
  });

  test("a read-scoped token is refused with insufficient_scope, never silently ignored", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = readToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("manage_watch", { action: "create", projectId })) as { error: { code: string } | null };
    expect(result.error?.code).toBe("insufficient_scope");
  });

  test("write scope can delete its own watch", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("manage_watch", { action: "delete", watchId })) as { data: { ok: boolean } };
    expect(result.data.ok).toBe(true);
  });
});

describe("input validation", () => {
  test("a missing required argument throws before any REST call", async () => {
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    await expect(dispatch("get_rag_assessment", {})).rejects.toThrow(/projectId/);
  });

  test("an unknown tool name throws", async () => {
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    await expect(dispatch("no_such_tool", {})).rejects.toThrow(/Unknown tool/);
  });
});

describe("real stdio JSON-RPC transport (not just dispatch())", () => {
  test("a real MCP Client over StdioClientTransport can list tools and call one", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["run", "mcp/co-newbiz/index.ts"],
      env: {
        CO_NEWBIZ_API_BASE_URL: process.env.CO_NEWBIZ_API_BASE_URL ?? "",
        CO_NEWBIZ_API_TOKEN: writeToken,
      },
    });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.length).toBeGreaterThanOrEqual(11);

      const result = await client.callTool({ name: "list_projects", arguments: {} });
      const content = (result.content as { type: string; text: string }[])[0];
      const parsed = JSON.parse(content.text) as { data: { id: string }[] };
      expect(parsed.data.some((p) => p.id === projectId)).toBe(true);
    } finally {
      await client.close();
    }
  }, 15_000);
});
