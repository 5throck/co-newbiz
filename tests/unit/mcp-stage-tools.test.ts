// @version 1.0.0
/**
 * Wave M PR M-2 (ADR-0154) — the S1-S12 tool set, its coverage gate, and the
 * human-only boundary. No database: the registry is inspected statically and
 * driven through recording RestPorts.
 */

import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RestPort } from "../../mcp/co-newbiz/shared/rest-port.ts";
import type { Envelope } from "../../mcp/co-newbiz/shared/rest-client.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");
const { REGISTRY, callTool, toolsFor } = await import("../../mcp/co-newbiz/registry.ts");
const { MCPScopeError } = await import("../../mcp/co-newbiz/define.ts");
const { runCoverage } = await import("../../scripts/co-newbiz/mcp-coverage.ts");
const { HUMAN_ONLY_ROUTES, ROUTE_TABLE, InProcessRestPort, isHumanOnly, matchRoute } = await import("../../app/web-next/lib/mcp/in-process-port.ts");

type Call = { method: string; path: string; body: unknown };

function recorder(): { port: RestPort; calls: Call[] } {
  const calls: Call[] = [];
  const reply = async <T,>(method: string, path: string, body?: unknown): Promise<Envelope<T>> => {
    calls.push({ method, path, body });
    return { data: { proposal_id: "P1", confirm_url: "/proposals/P1/confirm", status: "pending" } as T, meta: {}, error: null };
  };
  return {
    calls,
    port: {
      get: (p) => reply("GET", p),
      post: (p, b) => reply("POST", p, b),
      put: (p, b) => reply("PUT", p, b),
      patch: (p, b) => reply("PATCH", p, b),
      delete: (p) => reply("DELETE", p),
    },
  };
}

describe("coverage gate", () => {
  test("mcp-coverage passes: every activity and artifact has a tool, no exclusion gained one", async () => {
    const report = await runCoverage();
    expect(report.errors).toEqual([]);
    // Pinned on purpose: flow.spec v2.10.0 has 47 activities (v2.8.0: 45 — four
    // new S9 activities, ADR-0161 S12 follow-ups; v2.9.0: entry-market-sizing,
    // ADR-0180; v2.10.0: S9 capability-dd, human-only — design
    // 2026-10-19-brownfield-capability-dd, excluded in mcp-coverage.exclusions.yaml).
    // Artifacts 34: v2.9.0 added the S2 required artifact 진입시장 산정
    // (stage:S2:2, read via get_entry_market_derivation).
    expect(report.activities).toBe(47);
    expect(report.artifacts).toBe(34);
  });

  test("the coverage script fails when a human-only route gains a tool (self-test)", async () => {
    const { REGISTRY: live } = await import("../../mcp/co-newbiz/registry.ts");
    const target = live.find((t) => t.name === "get_charter");
    expect(target).toBeDefined();
    const original = target?.routes;
    // The registry array is readonly but its entries are plain objects; mutate
    // one temporarily to prove the gate trips, then restore it.
    (target as { routes: readonly string[] }).routes = ["POST /api/projects/{projectId}/close"];
    try {
      const report = await runCoverage();
      expect(report.errors.some((e) => e.includes("human-only route 'POST /api/projects/{}/close'"))).toBe(true);
    } finally {
      (target as { routes: readonly string[] }).routes = original ?? [];
    }
  });

  test("closure and PMI kickoff have no tool, no route, and no table entry", () => {
    for (const tool of REGISTRY) {
      expect(tool.name).not.toMatch(/close|kickoff/);
      for (const route of tool.routes) expect(route).not.toMatch(/\/close|\/pmi\/kickoff|\/confirm|\/reject/);
    }
    for (const entry of ROUTE_TABLE) expect(entry.pattern).not.toMatch(/\/close|\/pmi\/kickoff|\/confirm|\/reject/);
  });

  test("the in-process route guard refuses every human-only mutation", async () => {
    const port = new InProcessRestPort({ userId: "alice", role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" });
    for (const rule of HUMAN_ONLY_ROUTES) {
      const path = rule.pattern.replace(/:\w+/g, "x1");
      const body = rule.bodyField ? { [rule.bodyField.field]: rule.bodyField.value } : {};
      const call = rule.method === "POST" ? port.post(path, body) : rule.method === "PUT" ? port.put(path, body) : rule.method === "PATCH" ? port.patch(path, body) : port.delete(path);
      const res = await call;
      expect(res.error?.code, `${rule.method} ${rule.pattern}`).toBe("human_only");
    }
    expect(isHumanOnly("POST", "/api/projects/p1/deal-structure", { action: "hypothesize" })).toBe(false);
    expect(isHumanOnly("POST", "/api/projects/p1/deal-structure", { action: "complete_four_axis" })).toBe(true);
  });

  test("every tool route resolves in the in-process table and its module exports the method", async () => {
    for (const tool of REGISTRY) {
      for (const route of tool.routes) {
        const [method, template] = route.split(" ");
        const matched = matchRoute(template.replace(/\{\w+\}/g, "x1"));
        expect(matched, `${tool.name}: ${route}`).not.toBeNull();
        const mod = (await matched?.entry.load()) as Record<string, unknown>;
        expect(typeof mod[method], `${tool.name}: ${route} has no ${method} handler`).toBe("function");
      }
    }
  });
});

describe("registry shape", () => {
  test("tool names are unique, scopes match kinds, and stdio equals HTTP", () => {
    const names = REGISTRY.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(toolsFor("stdio").map((t) => t.name)).toEqual(toolsFor("http").map((t) => t.name));
    for (const t of REGISTRY) {
      const expected = t.kind === "read" ? "read" : t.kind === "propose" ? "propose" : "write";
      expect(t.scope, t.name).toBe(expected);
    }
  });

  test("all six decision kinds, the establishment-mode proposal plus the two deprecated aliases are propose tools that only POST /api/proposals", () => {
    const propose = REGISTRY.filter((t) => t.kind === "propose").map((t) => t.name).sort();
    expect(propose).toEqual([
      "create_route_decision", "propose_approval", "propose_case_adoption", "propose_establishment_mode", "propose_gate_decision",
      "propose_route_decision", "propose_target_selection", "propose_transition_decision", "record_gate_decision",
    ]);
    for (const name of propose) {
      expect(REGISTRY.find((t) => t.name === name)?.routes).toEqual(["POST /api/proposals"]);
    }
    expect(REGISTRY.filter((t) => t.deprecated).map((t) => t.name).sort()).toEqual(["create_route_decision", "record_gate_decision"]);
  });

  test("scope enforcement per tool: under-scoped calls are refused before any route runs", async () => {
    const { port, calls } = recorder();
    for (const tool of REGISTRY) {
      for (const scopes of [["read"], ["write"], ["propose"], ["read", "write"], ["read", "propose"]] as const) {
        const granted: readonly string[] = scopes;
        const allowed = granted.includes(tool.scope);
        const callsBefore = calls.length;
        let refused = false;
        try {
          await callTool("http", { port, scopes }, tool.name, {});
        } catch (err) {
          refused = err instanceof MCPScopeError;
        }
        expect(refused, `${tool.name} with [${scopes.join(",")}]`).toBe(!allowed);
        if (!allowed) expect(calls.length, `${tool.name} reached a route while under-scoped`).toBe(callsBefore);
      }
    }
  });

  test("write scope implies neither read nor propose, and propose implies neither", async () => {
    const { port } = recorder();
    await expect(callTool("http", { port, scopes: ["write"] }, "get_opportunity", { opportunityId: "o1" })).rejects.toBeInstanceOf(MCPScopeError);
    await expect(callTool("http", { port, scopes: ["write"] }, "propose_case_adoption", { projectId: "p", model_id: "m", rationale: "r" })).rejects.toBeInstanceOf(MCPScopeError);
    await expect(callTool("http", { port, scopes: ["propose"] }, "create_opportunity", { name: "x" })).rejects.toBeInstanceOf(MCPScopeError);
  });
});

describe("thin wrappers", () => {
  test("a route tool forwards ids, body, and query to exactly one route", async () => {
    const { port, calls } = recorder();
    await callTool("stdio", { port }, "record_candidate_screening", {
      opportunityId: "o 1", targetId: "t1", criterionId: "c1", body: { status: "met" },
    });
    await callTool("stdio", { port }, "list_market_analyses", { query: { limit: 5, q: "a b" } });
    expect(calls).toEqual([
      { method: "PUT", path: "/api/brownfield/o%201/targets/t1/eval-state/c1", body: { status: "met" } },
      { method: "GET", path: "/api/market-overview/analyses?limit=5&q=a+b", body: undefined },
    ]);
  });

  test("record_deal_structure refuses the human-only four-axis completion", async () => {
    const { port, calls } = recorder();
    await expect(
      callTool("stdio", { port }, "record_deal_structure", { projectId: "p1", body: { action: "complete_four_axis", hypothesis_id: "h", artifact_ref: "a" } }),
    ).rejects.toThrow(/human-only/);
    expect(calls).toEqual([]);
    await callTool("stdio", { port }, "record_deal_structure", { projectId: "p1", body: { action: "hypothesize" } });
    expect(calls).toHaveLength(1);
  });

  test("record_establishment refuses done (ADR-0165) but records in_progress / halted / escalated", async () => {
    const { port, calls } = recorder();
    await expect(
      callTool("stdio", { port }, "record_establishment", { projectId: "p1", body: { step_no: 1, status: "done", origin: "internal", note: "n" } }),
    ).rejects.toThrow(/human-only/);
    expect(calls).toEqual([]);
    for (const status of ["in_progress", "halted", "escalated"]) {
      await callTool("stdio", { port }, "record_establishment", { projectId: "p1", body: { step_no: 1, status, origin: "internal" } });
    }
    expect(calls).toHaveLength(3);
    expect(isHumanOnly("PUT", "/api/projects/p1/establishment/assignee", {})).toBe(true);
    expect(isHumanOnly("POST", "/api/projects/p1/establishment/reopen", {})).toBe(true);
  });

  test("propose tools call POST /api/proposals with the right kind and never a decision route", async () => {
    const { port, calls } = recorder();
    await callTool("stdio", { port }, "propose_gate_decision", { entityId: "o1", gate: "screening", decision: "go", rationale: "r" });
    await callTool("stdio", { port }, "propose_case_adoption", { projectId: "p1", model_id: "m1", rationale: "r" });
    await callTool("stdio", { port }, "propose_approval", { projectId: "p1", subject: "charter_baseline", rationale: "r" });
    const aliased = (await callTool("stdio", { port }, "record_gate_decision", { opportunityId: "o1", gate: "screening", decision: "go", rationale: "r" })) as { deprecation: { replacement: string } };
    expect(aliased.deprecation.replacement).toBe("propose_gate_decision");
    expect(calls.every((c) => c.method === "POST" && c.path === "/api/proposals")).toBe(true);
    expect(calls.map((c) => (c.body as { kind: string }).kind)).toEqual(["gate_decision", "case_adoption", "approval", "gate_decision"]);
  });
});

describe("import graph — propose paths cannot reach a decision writer (ADR-0153 pattern)", () => {
  const DECISION_TABLES = /(INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+(gate_decision|route_decision\w*|venture_transition_decision|closure_record|approval\w*|review_stage)\b/i;
  const FORBIDDEN_IMPORT = /(gate-decisions|route-decision|transition-decision|business-case\/adopt|target-selection|charter\/confirm|closure|pmi-kickoff|human-final|review\.repository)/;
  const FILES = [
    "db/repositories/decision-proposal.repository.ts",
    "app/web-next/app/api/proposals/route.ts",
    "app/web-next/app/api/proposals/[id]/route.ts",
    "app/web-next/app/api/proposals/[id]/reject/route.ts",
    "mcp/co-newbiz/tools/decision-tools.ts",
    "mcp/co-newbiz/tools/route-tool.ts",
  ];

  test("proposal creation, status, reject, and the propose tools import no decision writer and write no decision table", () => {
    for (const file of FILES) {
      const src = readFileSync(join(ROOT, file), "utf8");
      const imports = [...src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of imports) expect(spec, `${file} imports ${spec}`).not.toMatch(FORBIDDEN_IMPORT);
      expect(src, file).not.toMatch(DECISION_TABLES);
    }
  });
});
