#!/usr/bin/env bun
// @version 1.2.0
/**
 * co-newbiz MCP server — docs/mcp-integration.md (Waves 5.7A/5.7B/engine-1).
 *
 * Calls the REST API exclusively (ADR-0011, FR-SYS-01) — see
 * shared/rest-client.ts's header for the non-negotiable rule this file
 * never violates: no bun:sqlite, no db/client.ts, no db/repositories or
 * db/lib import anywhere under mcp/co-newbiz/.
 *
 * Wave 5.7A shipped the tools behind the Wave 5.6A REST surface. Wave
 * 5.7B added every catalog tool whose backing endpoint is a plain
 * membership-filtered table read: tools/analysis.ts (search_series,
 * get_observations, list_data_changes, get_assumptions, set_assumption✱)
 * and tools/deal-review.ts (list_dd_findings, get_rbd_source_profile,
 * add_dd_finding✱, get_antitrust_assessment, get_incentive_exposure,
 * get_liability_exposure, compare_sites, list_partner_candidates,
 * list_regulatory_requirements, get_permit_path, get_value_chain_linkage).
 * The engine-1 wave added compare_runs (tools/analysis.ts) over the
 * runs REST surface. Still deferred — the backing engines run through
 * the CLI today, not a REST endpoint, and need an async job surface, not
 * a synchronous handler: get_financial_analysis, get_peer_benchmark,
 * get_projection, get_proxy_chain, calibrate_chain✱, get_customer_risk,
 * get_compensation_gap, run_model✱, run_simulation✱, generate_report✱,
 * export_report.
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
import {
  compareRuns,
  getAssumptions,
  getObservations,
  listDataChanges,
  searchSeries,
  setAssumption,
} from "./tools/analysis.ts";
import {
  addDdFinding,
  compareSites,
  getAntitrustAssessment,
  getIncentiveExposure,
  getLiabilityExposure,
  getPermitPath,
  getRbdSourceProfile,
  getValueChainLinkage,
  listDdFindings,
  listPartnerCandidates,
  listRegulatoryRequirements,
} from "./tools/deal-review.ts";

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
    name: "get_assumptions",
    description: "Assumption registry read, filterable by run and/or assumption key.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" }, key: { type: "string", description: "assumption_key." } },
    },
  },
  {
    name: "set_assumption",
    description: "Write an assumption entry (write-scoped token required). kind='assumed' requires a non-empty rationale — rejected server-side otherwise.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        assumption_key: { type: "string" },
        kind: { type: "string", enum: ["live", "user", "derived", "assumed"] },
        value: { type: "number" },
        as_of: { type: "string", description: "ISO-8601 date." },
        rationale: { type: "string", description: "Mandatory when kind='assumed' (FR-DATA-07)." },
        anchor_ref: { type: "string" },
        ttl_days: { type: "number" },
      },
      required: ["run_id", "assumption_key", "kind", "value", "as_of"],
    },
  },
  {
    name: "compare_runs",
    description: "Variable-level bridge between two runs of one project — changed/added/removed per assumption_key plus both input hashes (NPV-level decomposition deferred until the valuation engine exists).",
    inputSchema: {
      type: "object",
      properties: {
        runA: { type: "string", description: "Base run id." },
        runB: { type: "string", description: "Comparison run id." },
      },
      required: ["runA", "runB"],
    },
  },
  {
    name: "list_dd_findings",
    description: "DD findings for a project, optionally filtered by category (e.g. 'rbd').",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, category: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "get_rbd_source_profile",
    description: "R&BD source profile — category='rbd' findings reshaped to rbd_source / TRL / IP / commercialization-path / originator-relationship fields.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "add_dd_finding",
    description: "Add a DD finding with value_impact (write-scoped token required). category='rbd' requires rbd_source.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        category: { type: "string" },
        description: { type: "string" },
        value_impact: { type: "number" },
        assumption_key: { type: "string" },
        evidence_ref: { type: "string" },
        trl_grade: { type: "string" },
        ip_ownership_status: { type: "string" },
        commercialization_path: { type: "string" },
        parent_relationship_json: { type: "string" },
        rbd_source: { type: "string", enum: ["internal_only", "accelerator_partnered", "external_technology_acquisition"] },
      },
      required: ["projectId", "category", "description"],
    },
  },
  {
    name: "get_antitrust_assessment",
    description: "Antitrust findings for a project — market definition, HHI before/after, remedy type, discharge status.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "get_incentive_exposure",
    description: "Incentive records for a project, both directions (prospective/granted), with clawback exposure.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "get_liability_exposure",
    description: "Combined liability exposure — debt instruments, contingent liabilities, and the latest simulation's covenant tests.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "compare_sites",
    description: "Site-candidate comparison table, ranked order first, unranked candidates last.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "list_partner_candidates",
    description: "Partner-candidate screening rows for a project.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "list_regulatory_requirements",
    description: "Flat permit and certification lists (parallel structures, never merged — a permit lets you operate, a certification lets you sell).",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "get_permit_path",
    description: "Permit/certification DAG with edges and the statutory-days critical path (include_dag view).",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "get_value_chain_linkage",
    description: "Value-chain linkage rows with industry names on both ends (separate from proxy chains — ADR-0025).",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
];

export function buildServer(): Server {
  const server = new Server({ name: "co-newbiz-mcp", version: "1.2.0" }, { capabilities: { tools: {} } });

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
    case "get_assumptions":
      return getAssumptions({
        run_id: args.run_id as string | undefined,
        key: args.key as string | undefined,
      });
    case "set_assumption": {
      requireString(args, "run_id");
      requireString(args, "assumption_key");
      requireString(args, "kind");
      requireString(args, "as_of");
      if (typeof args.value !== "number") {
        throw new MCPValidationError("value must be a number.");
      }
      return setAssumption({
        run_id: args.run_id as string,
        assumption_key: args.assumption_key as string,
        kind: args.kind as "live" | "user" | "derived" | "assumed",
        value: args.value,
        as_of: args.as_of as string,
        rationale: args.rationale as string | undefined,
        anchor_ref: args.anchor_ref as string | undefined,
        ttl_days: args.ttl_days as number | undefined,
      });
    }
    case "compare_runs":
      requireString(args, "runA");
      requireString(args, "runB");
      return compareRuns(args.runA as string, args.runB as string);
    case "list_dd_findings":
      requireString(args, "projectId");
      return listDdFindings(args.projectId as string, args.category as string | undefined);
    case "get_rbd_source_profile":
      requireString(args, "projectId");
      return getRbdSourceProfile(args.projectId as string);
    case "add_dd_finding": {
      requireString(args, "projectId");
      requireString(args, "category");
      requireString(args, "description");
      return addDdFinding(args.projectId as string, {
        category: args.category as string,
        description: args.description as string,
        value_impact: args.value_impact as number | undefined,
        assumption_key: args.assumption_key as string | undefined,
        evidence_ref: args.evidence_ref as string | undefined,
        trl_grade: args.trl_grade as string | undefined,
        ip_ownership_status: args.ip_ownership_status as string | undefined,
        commercialization_path: args.commercialization_path as string | undefined,
        parent_relationship_json: args.parent_relationship_json as string | undefined,
        rbd_source: args.rbd_source as string | undefined,
      });
    }
    case "get_antitrust_assessment":
      requireString(args, "projectId");
      return getAntitrustAssessment(args.projectId as string);
    case "get_incentive_exposure":
      requireString(args, "projectId");
      return getIncentiveExposure(args.projectId as string);
    case "get_liability_exposure":
      requireString(args, "projectId");
      return getLiabilityExposure(args.projectId as string);
    case "compare_sites":
      requireString(args, "projectId");
      return compareSites(args.projectId as string);
    case "list_partner_candidates":
      requireString(args, "projectId");
      return listPartnerCandidates(args.projectId as string);
    case "list_regulatory_requirements":
      requireString(args, "projectId");
      return listRegulatoryRequirements(args.projectId as string);
    case "get_permit_path":
      requireString(args, "projectId");
      return getPermitPath(args.projectId as string);
    case "get_value_chain_linkage":
      requireString(args, "projectId");
      return getValueChainLinkage(args.projectId as string);
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
