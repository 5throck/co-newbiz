#!/usr/bin/env bun
// @version 1.0.0
/**
 * co-newbiz MCP server — docs/mcp-integration.md (Wave 5.7A).
 *
 * Calls the REST API exclusively (ADR-0011, FR-SYS-01) — see
 * shared/rest-client.ts's header for the non-negotiable rule this file
 * never violates: no bun:sqlite, no db/client.ts, no db/repositories or
 * db/lib import anywhere under mcp/co-newbiz/.
 *
 * Wave 5.7A scope: only tools with a real REST endpoint behind them
 * (api-spec §2/§3/§5/§7, the surface Wave 5.6A actually built). Deferred
 * to a later sub-PR, same reasoning as 5.6A/5.6B's own deferrals — the
 * backing engines run through the CLI today, not a REST endpoint:
 * search_series/get_observations, list_data_changes,
 * get_financial_analysis/get_peer_benchmark/get_projection,
 * get_assumptions/set_assumption✱, get_proxy_chain/calibrate_chain✱,
 * compare_runs, get_value_chain_linkage, get_antitrust_assessment,
 * get_customer_risk, get_incentive_exposure, get_compensation_gap,
 * get_liability_exposure, compare_sites, list_partner_candidates,
 * list_regulatory_requirements/get_permit_path, list_dd_findings,
 * get_rbd_source_profile, run_model✱, run_simulation✱, add_dd_finding✱,
 * generate_report✱, export_report.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createLogger } from "./shared/logger.ts";
import { MCPValidationError } from "./shared/errors.ts";
import type { ToolDefinition } from "./shared/types.ts";
import { listProjects, getProjectStatus } from "./tools/projects.ts";
import {
  getRagAssessment,
  getApprovalChain,
  getComplianceStatus,
  listWaivers,
  searchInterpretations,
  getProcedure,
} from "./tools/governance.ts";
import { lookupTerm } from "./tools/glossary.ts";
import { listNotifications, manageWatch, type WatchRuleInput } from "./tools/monitoring.ts";

const log = createLogger("co-newbiz-mcp");

export const TOOLS: ToolDefinition[] = [
  {
    name: "list_projects",
    description: "Membership-filtered project list. MNPI-flagged projects are excluded by default.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_project_status",
    description: "Project detail plus its current RAG dimension breakdown.",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "get_rag_assessment",
    description: "Full six-dimension RAG breakdown with rationale for a project.",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "get_approval_chain",
    description: "Entity/Group IC approval-chain status for a project.",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "get_compliance_status",
    description: "Gate-blocking compliance-check status for a project.",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "list_waivers",
    description: "Active and expired governance waivers for a project.",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "search_interpretations",
    description: "Search the governance interpretation registry.",
    inputSchema: {
      type: "object",
      properties: { doc: { type: "string" }, clause: { type: "string" }, q: { type: "string" } },
    },
  },
  {
    name: "get_procedure",
    description: "Merged shared/region/entity procedure result (proc:resolve equivalent), with per-step source attribution.",
    inputSchema: {
      type: "object",
      properties: { procedure: { type: "string" }, entity: { type: "string" }, region: { type: "string" } },
      required: ["procedure"],
    },
  },
  {
    name: "lookup_term",
    description: "Glossary term lookup — the same source that backs the web UI's tooltip.",
    inputSchema: { type: "object", properties: { term: { type: "string" } }, required: ["term"] },
  },
  {
    name: "list_notifications",
    description: "The caller's pending and recent notifications.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "manage_watch",
    description: "Create or delete a monitoring subscription on a project (write-scoped token required).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "delete"] },
        projectId: { type: "string", description: "Required for action=create." },
        watchId: { type: "string", description: "Required for action=delete." },
        rules: {
          type: "array",
          description: "Optional watch rules for action=create.",
          items: {
            type: "object",
            properties: {
              trigger_type: { type: "string" },
              threshold: { type: "number" },
              cooldown_hours: { type: "number" },
              channel: { type: "string" },
            },
            required: ["trigger_type", "channel"],
          },
        },
      },
      required: ["action"],
    },
  },
];

export function buildServer(): Server {
  const server = new Server({ name: "co-newbiz-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    log.info(`Tool called: ${name}`);
    try {
      const result = await dispatch(name, (args ?? {}) as Record<string, unknown>);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      log.error(`Tool ${name} failed: ${err}`);
      return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  });

  return server;
}

export async function dispatch(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "list_projects":
      return listProjects();
    case "get_project_status":
      requireString(args, "projectId");
      return getProjectStatus(args.projectId as string);
    case "get_rag_assessment":
      requireString(args, "projectId");
      return getRagAssessment(args.projectId as string);
    case "get_approval_chain":
      requireString(args, "projectId");
      return getApprovalChain(args.projectId as string);
    case "get_compliance_status":
      requireString(args, "projectId");
      return getComplianceStatus(args.projectId as string);
    case "list_waivers":
      requireString(args, "projectId");
      return listWaivers(args.projectId as string);
    case "search_interpretations":
      return searchInterpretations({
        doc: args.doc as string | undefined,
        clause: args.clause as string | undefined,
        q: args.q as string | undefined,
      });
    case "get_procedure":
      requireString(args, "procedure");
      return getProcedure(args.procedure as string, args.entity as string | undefined, args.region as string | undefined);
    case "lookup_term":
      requireString(args, "term");
      return lookupTerm(args.term as string);
    case "list_notifications":
      return listNotifications();
    case "manage_watch": {
      const action = args.action;
      if (action !== "create" && action !== "delete") {
        throw new MCPValidationError("action must be 'create' or 'delete'.");
      }
      return manageWatch(action, {
        projectId: args.projectId as string | undefined,
        watchId: args.watchId as string | undefined,
        rules: args.rules as WatchRuleInput[] | undefined,
      });
    }
    default:
      throw new MCPValidationError(`Unknown tool: ${name}`);
  }
}

function requireString(args: Record<string, unknown>, key: string): void {
  if (typeof args[key] !== "string" || !(args[key] as string).trim()) {
    throw new MCPValidationError(`${key} is required.`);
  }
}

if (import.meta.main) {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("co-newbiz MCP server started");
}
