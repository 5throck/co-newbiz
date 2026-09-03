// @version 1.4.0
/**
 * MCP server tests — docs/mcp-integration.md. Runs a real HTTP server
 * (Bun.serve on an ephemeral port dispatching to app/web-next's Route
 * Handlers) and calls the MCP server's own dispatch() against it over real
 * HTTP with real Bearer tokens — not mocked handlers. A separate describe
 * verifies the actual stdio JSON-RPC transport once, since dispatch() alone
 * doesn't exercise the SDK wiring.
 *
 * ADR-0094: all tool suites over the deleted project-keyed REST tree
 * (/api/projects/**, /api/assumptions, /api/runs, /api/simulations,
 * /api/watch) were removed together with the tools themselves. What remains
 * is the live surface: analysis reads, glossary/procedure/interpretation
 * lookups, notifications, and the opportunity-keyed process tools.
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

// ADR-0069/0070 Phase 6 test port: nextFetch dispatches to app/web-next's
// Route Handlers. See tests/unit/helpers/next-route-dispatch.ts.
const { nextFetch } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { issueApiToken } = await import("../../db/lib/api-tokens.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

const NOW = new Date().toISOString();
let server: Server;
let readToken: string;
let writeToken: string;

beforeAll(async () => {
  server = Bun.serve({ port: 0, fetch: nextFetch });
  process.env.CO_NEWBIZ_API_BASE_URL = `http://localhost:${server.port}`;

  await createUser(db, { userId: "alice", role: "analyst", password: "pw-alice-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "alice", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "bob", role: "viewer", password: "pw-bob-123456", createdBy: "test", now: NOW });
  approveUser(db, { userId: "bob", approvedBy: "test", now: NOW });
  // createUser flags must_change_password=1; clear it so the seeded API
  // tokens exercise the relay paths, not the change-password gate.
  db.run("UPDATE app_user SET must_change_password = 0");

  readToken = issueApiToken(db, { userId: "bob", label: "mcp-read", scopes: ["read"], now: NOW }).token;
  writeToken = issueApiToken(db, { userId: "alice", label: "mcp-write", scopes: ["read", "write"], now: NOW }).token;
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
    // ADR-0094 surface alignment: the project-keyed tool suites were removed
    // with their REST routes; the live catalog is 16 tools — the read
    // lookups + notifications + the opportunity-keyed process suite + the
    // ADR-0097 committee read-only pair.
    expect(TOOLS.length).toBe(16);
    for (const tool of TOOLS) {
      expect(tool.name.length).toBeGreaterThan(0);
      // MCP tool names must be plain identifiers — no decoration characters
      // (a ✱ write-marker suffix once leaked into the advertised names).
      expect(tool.name).toMatch(/^[a-z0-9_]+$/);
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  test("every TOOLS entry has a dispatch case (no advertised-but-uncallable tool)", async () => {
    const source = readFileSync("mcp/co-newbiz/index.ts", "utf8");
    const { TOOLS } = await import("../../mcp/co-newbiz/index.ts");
    for (const tool of TOOLS) {
      expect(source).toContain(`case "${tool.name}"`);
    }
  });
});

describe("read tools (relayed from REST)", () => {
  test("lookup_term resolves a registered glossary term", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("lookup_term", { term: "WACC" })) as { data: { ko: string } };
    expect(result.data.ko.length).toBeGreaterThan(0);
  });

  test("get_procedure resolves a real shared procedure", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("get_procedure", { procedure: "brownfield-screening" })) as { data: { steps: unknown[] } };
    expect(result.data.steps.length).toBeGreaterThan(0);
  });

  test("search_interpretations and list_notifications respond with arrays", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const interpretations = (await dispatch("search_interpretations", {})) as { data: unknown[] };
    expect(Array.isArray(interpretations.data)).toBe(true);
    const notifications = (await dispatch("list_notifications", {})) as { data: unknown[] };
    expect(Array.isArray(notifications.data)).toBe(true);
  });

  test("search_series / get_observations / list_data_changes respond", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
    const SERIES_ID = "TEST.SHIP.CGT";
    const unitId = ulid();
    const sourceId = ulid();
    db.run("INSERT INTO md_unit (id, code, dimension, si_coefficient, created_at) VALUES (?,?,?,?,?)", [unitId, "TEST.UNIT", "dimensionless", 1, NOW]);
    db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [sourceId, "TESTSRC", "A", NOW]);
    db.run("INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)", ["2025", "year", "2025-01-01", "2025-12-31", 2025, NOW]);
    for (const [revisionNo, value] of [[1, 100.0], [2, 110.0]] as const) {
      db.run(
        "INSERT INTO fact_market_observation (series_id, period_id, revision_no, value, unit_id, source_id, content_hash, fetched_at) VALUES (?,?,?,?,?,?,?,?)",
        [SERIES_ID, "2025", revisionNo, value, unitId, sourceId, `hash-${revisionNo}`, NOW],
      );
    }

    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const series = (await dispatch("search_series", {})) as { data: unknown[] };
    expect(series.data.length).toBeGreaterThan(0);
    const latest = (await dispatch("get_observations", { seriesId: SERIES_ID })) as { data: { revision_no: number }[] };
    expect(latest.data).toHaveLength(1);
    expect(latest.data[0].revision_no).toBe(2);
    const all = (await dispatch("get_observations", { seriesId: SERIES_ID, all_revisions: true })) as { data: unknown[] };
    expect(all.data).toHaveLength(2);
    const changes = (await dispatch("list_data_changes", {})) as { data: unknown[] };
    expect(Array.isArray(changes.data)).toBe(true);
  });

  test("dispatch rejects a missing seriesId before any REST call", async () => {
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    await expect(dispatch("get_observations", {})).rejects.toThrow(/seriesId/);
  });
});

describe("opportunity-keyed process tools (ADR-0094)", () => {
  let opportunityId: string;

  test("list_opportunities starts empty and create_opportunity registers one (analyst token)", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const empty = (await dispatch("list_opportunities", {})) as { data: unknown[] };
    expect(empty.data).toHaveLength(0);

    const created = (await dispatch("create_opportunity", { name: "Marine crankshaft JV", status: "selected" })) as {
      data: { id: string; name: string; status: string };
    };
    expect(created.data.name).toBe("Marine crankshaft JV");
    expect(created.data.status).toBe("selected");
    opportunityId = created.data.id;

    const listed = (await dispatch("list_opportunities", {})) as { data: { id: string }[] };
    expect(listed.data.some((o) => o.id === opportunityId)).toBe(true);
  });

  test("create_opportunity relays the REST 403 insufficient_scope for a read-scoped token", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = readToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("create_opportunity", { name: "scope probe" })) as { error: { code: string } | null };
    expect(result.error?.code).toBe("insufficient_scope");
  });

  test("get_process_evaluation / get_gate_decisions respond for the opportunity", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const process_ = (await dispatch("get_process_evaluation", { opportunityId })) as {
      data: { currentStage: string | null; stages: unknown[] } | null;
    };
    expect(process_.data).not.toBeNull();
    expect(process_.data!.stages.length).toBeGreaterThan(0);
    // Route shape: { latest (per-gate rollup), history (full audit trail) }.
    const decisions = (await dispatch("get_gate_decisions", { opportunityId })) as {
      data: { latest: unknown[]; history: unknown[] };
    };
    expect(Array.isArray(decisions.data.latest)).toBe(true);
    expect(Array.isArray(decisions.data.history)).toBe(true);
  });

  test("record_gate_decision lands and is read back; missing opportunityId rejects before any REST call", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const recorded = (await dispatch("record_gate_decision", {
      opportunityId,
      gate: "screening",
      decision: "go",
      rationale: "clears knock-out set",
    })) as { data: unknown; error: { code: string } | null };
    expect(recorded.error).toBeNull();

    const decisions = (await dispatch("get_gate_decisions", { opportunityId })) as {
      data: { latest: { gate: string; decision: string }[]; history: { decision: string }[] };
    };
    expect(decisions.data.latest.some((d) => d.gate === "screening" && d.decision === "go")).toBe(true);
    expect(decisions.data.history.some((d) => d.decision === "go")).toBe(true);

    await expect(dispatch("record_gate_decision", { gate: "screening", decision: "go", rationale: "x" })).rejects.toThrow(/opportunityId/);
  });

  test("create_route_decision lands for the opportunity", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("create_route_decision", {
      opportunityId,
      track: "greenfield",
      rationale: "no acquireable incumbent",
    })) as { error: { code: string } | null };
    expect(result.error).toBeNull();
  });
});

describe("input validation", () => {
  test("a missing required argument throws before any REST call", async () => {
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    await expect(dispatch("lookup_term", {})).rejects.toThrow(/term/);
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
      expect(tools.tools.length).toBeGreaterThanOrEqual(13);
      const names = tools.tools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length); // no duplicate tool names
      for (const name of names) expect(name).toMatch(/^[a-z0-9_]+$/);

      const result = await client.callTool({ name: "list_opportunities", arguments: {} });
      const content = (result.content as { type: string; text: string }[])[0];
      const parsed = JSON.parse(content.text) as { data: unknown[] };
      expect(Array.isArray(parsed.data)).toBe(true);
    } finally {
      await client.close();
    }
  }, 15_000);
});
