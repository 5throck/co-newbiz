#!/usr/bin/env bun
// @version 1.5.0
/**
 * co-newbiz MCP server — docs/mcp-integration.md.
 *
 * Calls the REST API exclusively (ADR-0011, FR-SYS-01) — see
 * shared/rest-client.ts's header for the non-negotiable rule this file
 * never violates: no bun:sqlite, no db/client.ts, no db/repositories or
 * db/lib import anywhere under mcp/co-newbiz/.
 *
 * ADR-0094 surface alignment: every tool whose backing REST endpoint lived
 * under the deleted /api/projects/** tree (plus the deleted /api/assumptions,
 * /api/runs, /api/simulations and /api/watch surfaces) was removed rather
 * than left advertising dead endpoints — same discipline as the
 * run_stage_agents deferral note in tools/process.ts. The surviving catalog
 * is the live surface: analysis reads (/api/series, /api/data-changes),
 * glossary/procedure/interpretation lookups, notifications, and the
 * opportunity-keyed S1-S7 process tools (/api/opportunities/**).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createLogger } from "./shared/logger.ts";
import { MCPValidationError } from "./shared/errors.ts";
import type { ToolDefinition } from "./shared/types.ts";
import {
  searchInterpretations,
  getProcedure,
} from "./tools/governance.ts";
import { lookupTerm } from "./tools/glossary.ts";
import { listNotifications } from "./tools/monitoring.ts";
import {
  getObservations,
  listDataChanges,
  searchSeries,
} from "./tools/analysis.ts";
import {
  listOpportunities, createOpportunity,
  getProcessEvaluation, listGateDecisions, recordGateDecision,
  createRouteDecision,
} from "./tools/process.ts";
import { listCommitteeSessions, getCommitteeSession } from "./tools/committee.ts";
import { getProjectIcPackage } from "./tools/ic-package.ts";
import { getPortfolioScorecard } from "./tools/portfolio-scorecard.ts";

const log = createLogger("co-newbiz-mcp");

export const TOOLS: ToolDefinition[] = [
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
    name: "search_series",
    description: "Distinct market/industry series catalog derived from fact_market_observation, with observation counts and period coverage.",
    inputSchema: {
      type: "object",
      properties: { q: { type: "string", description: "Optional substring filter on series_id." } },
    },
  },
  {
    name: "get_observations",
    description: "Observations for one series — latest revision per period by default; every revision row with all_revisions.",
    inputSchema: {
      type: "object",
      properties: {
        seriesId: { type: "string" },
        period_id: { type: "string", description: "Optional narrow to one period." },
        all_revisions: { type: "boolean", description: "Return every revision row, not just the latest per period." },
      },
      required: ["seriesId"],
    },
  },
  {
    name: "list_data_changes",
    description: "data_change_log scan — new/revised/deleted detections, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        series_id: { type: "string" },
        limit: { type: "number", description: "1-500, default 100." },
      },
    },
  },
  {
    name: "list_opportunities",
    description: "Opportunity funnel registry (S2) — status/project_id filters.",
    inputSchema: { type: "object", properties: { status: { type: "string", enum: ["identified", "assessed", "selected", "dropped"] }, project_id: { type: "string" } } },
  },
  {
    name: "create_opportunity",
    description: "Register an opportunity (S2) — analyst+; audited.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, market_scope: { type: "string" }, value_chain_node: { type: "string" }, market_size_krw_m: { type: "number" }, growth_rate: { type: "number" }, attractiveness_score: { type: "integer" }, synergy_score: { type: "integer" }, rationale: { type: "string" } }, required: ["name"] },
  },
  {
    name: "get_process_evaluation",
    description: "Derived process state (S1-S7) — currentStage, completedStages, gateStatus, requiredArtifacts. Never persisted.",
    inputSchema: { type: "object", properties: { opportunityId: { type: "string" } }, required: ["opportunityId"] },
  },
  {
    name: "get_gate_decisions",
    description: "Gate decision records (GO/HOLD/KILL) for an opportunity.",
    inputSchema: { type: "object", properties: { opportunityId: { type: "string" } }, required: ["opportunityId"] },
  },
  {
    name: "record_gate_decision",
    description: "Record a gate decision — HOLD requires missing_artifacts. Analyst+; audited.",
    inputSchema: { type: "object", properties: { opportunityId: { type: "string" }, gate: { type: "string", enum: ["screening","pre_fs","fs","dd","entity_ic","group_ic"] }, decision: { type: "string", enum: ["go","hold","kill"] }, rationale: { type: "string" }, missing_artifacts: { type: "array", items: { type: "string" } } }, required: ["opportunityId", "gate", "decision", "rationale"] },
  },
  {
    name: "create_route_decision",
    description: "Record a route decision (S4) — greenfield/brownfield + sub_track + rationale. Analyst+; audited.",
    inputSchema: { type: "object", properties: { opportunityId: { type: "string" }, track: { type: "string", enum: ["greenfield","brownfield"] }, sub_track: { type: "string", enum: ["existing_business_rbd","intra_venture"] }, rationale: { type: "string" } }, required: ["opportunityId", "track", "rationale"] },
  },
  {
    name: "list_committee_sessions",
    description: "List steering-committee deliberation sessions for an opportunity (ADR-0097).",
    inputSchema: { type: "object", properties: { opportunityId: { type: "string" } }, required: ["opportunityId"] },
  },
  {
    name: "get_committee_session",
    description: "Full committee-session transcript — per-round positions, chair PROPOSAL, verbatim dissent. Read-only.",
    inputSchema: { type: "object", properties: { opportunityId: { type: "string" }, sessionId: { type: "string" } }, required: ["opportunityId", "sessionId"] },
  },
  {
    name: "get_project_ic_package",
    description: "S10 IC package (read-only) — adopted business case + simulations, DD completion, AI-proposed RAG grade (labeled a proposal), entity_ic/group_ic gate history, establishment progress.",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "get_portfolio_scorecard",
    description: "S11 portfolio scorecard (read-only) — quarterly rollup (financial/strategic sections, class rollup, insufficient_evidence), per-cycle trend, and venture-portfolio-IC transition-decision history. The transition-decision POST is deliberately not MCP-exposed (ADR-0101 §5).",
    inputSchema: { type: "object", properties: { projectId: { type: "string" }, reviewCycle: { type: "string", description: "YYYY-Qn — optional explicit review cycle; defaults to the latest" } }, required: ["projectId"] },
  },
];

export function buildServer(): Server {
  const server = new Server({ name: "co-newbiz-mcp", version: "1.8.0" }, { capabilities: { tools: {} } });

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
    case "search_series":
      return searchSeries(args.q as string | undefined);
    case "get_observations":
      requireString(args, "seriesId");
      return getObservations(args.seriesId as string, {
        period_id: args.period_id as string | undefined,
        all_revisions: args.all_revisions === true,
      });
    case "list_data_changes":
      return listDataChanges({
        series_id: args.series_id as string | undefined,
        limit: args.limit as number | undefined,
      });
    case "list_opportunities":
      return listOpportunities(args.status as string | undefined);
    case "create_opportunity": {
      requireString(args, "name");
      return createOpportunity(args as unknown as Parameters<typeof createOpportunity>[0]);
    }
    case "get_process_evaluation":
      requireString(args, "opportunityId");
      return getProcessEvaluation(args.opportunityId as string);
    case "get_gate_decisions":
      requireString(args, "opportunityId");
      return listGateDecisions(args.opportunityId as string);
    case "record_gate_decision": {
      requireString(args, "opportunityId");
      requireString(args, "gate");
      requireString(args, "decision");
      requireString(args, "rationale");
      return recordGateDecision(args.opportunityId as string, {
        gate: args.gate as string, decision: args.decision as string,
        rationale: args.rationale as string,
        missing_artifacts: args.missing_artifacts as string[] | undefined,
      });
    }
    case "create_route_decision": {
      requireString(args, "opportunityId");
      requireString(args, "track");
      requireString(args, "rationale");
      return createRouteDecision(args.opportunityId as string, {
        track: args.track as string, sub_track: args.sub_track as string | undefined,
        rationale: args.rationale as string,
        alternatives_considered: args.alternatives_considered as string | undefined,
      });
    }
    case "list_committee_sessions": {
      requireString(args, "opportunityId");
      return listCommitteeSessions(args.opportunityId as string);
    }
    case "get_committee_session": {
      requireString(args, "opportunityId");
      requireString(args, "sessionId");
      return getCommitteeSession(args.opportunityId as string, args.sessionId as string);
    }
    case "get_project_ic_package": {
      requireString(args, "projectId");
      return getProjectIcPackage(args.projectId as string);
    }
    case "get_portfolio_scorecard": {
      requireString(args, "projectId");
      return getPortfolioScorecard(args.projectId as string, args.reviewCycle as string | undefined);
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
