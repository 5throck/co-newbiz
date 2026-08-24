// @version 1.3.0
/**
 * Wave 5.7A MCP server tests — docs/mcp-integration.md. Runs the real Hono
 * app (Bun.serve on an ephemeral port) and calls the MCP server's own
 * dispatch() against it over real HTTP with real Bearer tokens — not
 * mocked handlers. A separate describe verifies the actual stdio JSON-RPC
 * transport once, since dispatch() alone doesn't exercise the SDK wiring.
 * Wave 5.7B added the analysis/deal-review suites; the engine-1 wave
 * added compare_runs; engine-2 added run_simulation (real engine spawn,
 * REST-side — see db/lib/simulation.ts).
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
    expect(TOOLS.length).toBe(48); // 29 (through engine-2) + 8 Class C evidence surfaces + 6 ADR-0067 market surfaces
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

describe("Wave 5.7B — analysis and deal-review tools", () => {
  const SERIES_ID = "TEST.SHIP.CGT";
  let runId: string;

  beforeAll(() => {
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
    runId = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [runId, projectId, "5.7B test", "cafebabe", "alice", NOW]);
    db.run(
      "INSERT INTO dd_finding (id, project_id, category, description, trl_grade, parent_relationship_json, rbd_source, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), projectId, "rbd", "Crankshaft coating process", "TRL6", '{"parent":"HD"}', "internal_only", NOW],
    );
    const permitA = ulid();
    const permitB = ulid();
    for (const [id, days] of [[permitA, 30], [permitB, 60]] as const) {
      db.run("INSERT INTO permit (id, project_id, name, agency, statutory_days, status) VALUES (?,?,?,?,?,?)", [id, projectId, "Permit", "MOIS", days, "not_started"]);
    }
    db.run("INSERT INTO permit_edge (from_permit_id, to_permit_id) VALUES (?,?)", [permitA, permitB]);
  });

  test("search_series / get_observations / list_data_changes / get_assumptions respond", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
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
    const assumptions = (await dispatch("get_assumptions", { run_id: runId })) as { data: unknown[] };
    expect(Array.isArray(assumptions.data)).toBe(true);
  });

  test("set_assumption writes with a write-scoped token", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("set_assumption", {
      run_id: runId,
      assumption_key: "test.wacc",
      kind: "assumed",
      value: 0.08,
      as_of: "2026-08-21",
      rationale: "pilot anchor",
    })) as { data: { id: string } };
    expect(typeof result.data.id).toBe("string");
  });

  test("set_assumption relays insufficient_scope for a read-scoped token", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = readToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("set_assumption", {
      run_id: runId,
      assumption_key: "x",
      kind: "live",
      value: 1,
      as_of: "2026-08-21",
    })) as { error: { code: string } | null };
    expect(result.error?.code).toBe("insufficient_scope");
  });

  test("get_rbd_source_profile reshapes rbd findings into the R&BD field set", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const findings = (await dispatch("list_dd_findings", { projectId })) as { data: unknown[] };
    expect(findings.data.length).toBeGreaterThan(0);
    const profile = (await dispatch("get_rbd_source_profile", { projectId })) as {
      data: { rbd_source: string; trl_grade: string; parent_relationship: unknown }[];
    };
    expect(profile.data[0].rbd_source).toBe("internal_only");
    expect(profile.data[0].trl_grade).toBe("TRL6");
    expect(profile.data[0].parent_relationship).toEqual({ parent: "HD" });
  });

  test("add_dd_finding writes with a write-scoped token", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("add_dd_finding", {
      projectId,
      category: "commercial",
      description: "Customer concentration 42%",
      value_impact: -1.2,
    })) as { data: { id: string } };
    expect(typeof result.data.id).toBe("string");
  });

  test("add_dd_finding relays insufficient_scope for a read-scoped token", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = readToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("add_dd_finding", { projectId, category: "commercial", description: "x" })) as {
      error: { code: string } | null;
    };
    expect(result.error?.code).toBe("insufficient_scope");
  });

  test("deal-review read tools respond for a member", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    for (const tool of [
      "get_antitrust_assessment",
      "get_incentive_exposure",
      "get_liability_exposure",
      "compare_sites",
      "list_partner_candidates",
      "list_regulatory_requirements",
      "get_value_chain_linkage",
    ]) {
      const result = (await dispatch(tool, { projectId })) as { error: { code: string } | null };
      expect(result.error).toBeNull();
    }
  });

  test("get_permit_path returns the dag shape with the critical path", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("get_permit_path", { projectId })) as {
      data: { permits: unknown[]; dag: { permit_critical_path: string[] } };
    };
    expect(result.data.permits.length).toBeGreaterThan(0);
    expect(result.data.dag.permit_critical_path).toHaveLength(2);
  });

  test("a non-member relays the REST 404 for the new project-scoped tools", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = readToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("get_antitrust_assessment", { projectId })) as { error: { code: string } | null };
    expect(result.error?.code).toBe("not_found");
  });

  test("dispatch rejects a missing seriesId before any REST call", async () => {
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    await expect(dispatch("get_observations", {})).rejects.toThrow(/seriesId/);
  });
});

describe("Wave engine-1 — compare_runs", () => {
  let runA: string;
  let runB: string;

  beforeAll(() => {
    runA = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [runA, projectId, "engine-1 A", "hash-a", "alice", NOW]);
    db.run("INSERT INTO run_input (run_id, assumption_key, value) VALUES (?,?,?)", [runA, "x", 1]);
    db.run("INSERT INTO run_input (run_id, assumption_key, value) VALUES (?,?,?)", [runA, "y", 2]);
    runB = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [runB, projectId, "engine-1 B", "hash-b", "alice", NOW]);
    db.run("INSERT INTO run_input (run_id, assumption_key, value) VALUES (?,?,?)", [runB, "x", 1.5]);
    db.run("INSERT INTO run_input (run_id, assumption_key, value) VALUES (?,?,?)", [runB, "z", 3]);
  });

  test("compare_runs returns the variable-level bridge for a member", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("compare_runs", { runA, runB })) as {
      data: { changed: { key: string; from: number; to: number; delta: number }[]; added: { key: string }[]; removed: { key: string }[] };
    };
    expect(result.data.changed).toEqual([{ key: "x", from: 1, to: 1.5, delta: 0.5 }]);
    expect(result.data.added).toEqual([{ key: "z", value: 3 }]);
    expect(result.data.removed).toEqual([{ key: "y", value: 2 }]);
  });

  test("a non-member relays the REST 404", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = readToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("compare_runs", { runA, runB })) as { error: { code: string } | null };
    expect(result.error?.code).toBe("not_found");
  });

  test("a missing runA rejects before any REST call", async () => {
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    await expect(dispatch("compare_runs", { runB })).rejects.toThrow(/runA/);
  });
});

describe("Wave engine-2 — run_simulation", () => {
  let simRunId: string;

  beforeAll(() => {
    simRunId = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [simRunId, projectId, "engine-2 sim", "hash-sim", "alice", NOW]);
    for (const [key, value] of [
      ["sim.discount_rate", 0.1],
      ["sim.cf1", 100],
      ["sim.cf2", 110],
      ["sim.cf3", 120],
      ["sim.cf4", 130],
      ["sim.cf5", 140],
    ] as const) {
      db.run("INSERT INTO run_input (run_id, assumption_key, value) VALUES (?,?,?)", [simRunId, key, value]);
    }
  });

  test("run_simulation returns the seeded quantile summary for a member", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = writeToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("run_simulation", { run_id: simRunId, seed: 42, iterations: 500 })) as {
      data: { simulation_id: string; seed: number; p05: number; p50: number; p95: number; contingent_liability_count: number };
    };
    expect(result.data.simulation_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(result.data.seed).toBe(42);
    expect(result.data.contingent_liability_count).toBe(0); // no CL rows on this project
    // With zero liabilities the distribution collapses onto the base NPV.
    expect(result.data.p05).toBe(result.data.p50);
    expect(result.data.p50).toBe(result.data.p95);
  });

  test("a read-scoped token is refused with insufficient_scope, never silently ignored", async () => {
    process.env.CO_NEWBIZ_API_TOKEN = readToken;
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const result = (await dispatch("run_simulation", { run_id: simRunId, seed: 1, iterations: 10 })) as { error: { code: string } | null };
    expect(result.error?.code).toBe("insufficient_scope");
  });

  test("a missing run_id rejects before any REST call", async () => {
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    await expect(dispatch("run_simulation", {})).rejects.toThrow(/run_id/);
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
      expect(tools.tools.length).toBeGreaterThanOrEqual(29);

      const result = await client.callTool({ name: "list_projects", arguments: {} });
      const content = (result.content as { type: string; text: string }[])[0];
      const parsed = JSON.parse(content.text) as { data: { id: string }[] };
      expect(parsed.data.some((p) => p.id === projectId)).toBe(true);
    } finally {
      await client.close();
    }
  }, 15_000);
});
