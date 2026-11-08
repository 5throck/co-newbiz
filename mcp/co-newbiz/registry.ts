// @version 2.0.0
/**
 * Shared MCP tool registry — ADR-0154 §1, design 2026-10-08-wave-m-mcp-parity §3.1.
 *
 * One registry serves both transports: stdio (index.ts, HttpRestPort with a
 * personal token) and Streamable HTTP (app/web-next/app/api/mcp, the
 * InProcessRestPort acting as the OAuth-delegated human). Tools are thin
 * wrappers over REST routes through a RestPort (ADR-0011): no business
 * validation, permission check, or DB access lives here.
 *
 * Boundary #2 (ADR-0154 §5, M-2): no tool records a decision. Gate, route,
 * case-adoption, target-selection, transition and approval tools only create a
 * decision_proposal (tools/decision-tools.ts); a human confirms it on the web
 * confirm page. The deprecated direct-record aliases were removed
 * (review 2026-10-26 L2). Closure and PMI
 * kickoff have no tool at all (mcp-coverage.exclusions.yaml).
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { ToolDefinition } from "./shared/types.ts";
import { MCPValidationError } from "./shared/errors.ts";
import {
  MCPScopeError,
  defineTool,
  optString,
  requiredString,
  type McpTransportKind,
  type RegistryTool,
  type ToolContext,
  type ToolScope,
} from "./define.ts";
import { STAGE_TOOLS } from "./tools/stage-tools.ts";
import { DECISION_TOOLS } from "./tools/decision-tools.ts";
import { searchInterpretations, getProcedure } from "./tools/governance.ts";
import { lookupTerm, listGlossary } from "./tools/glossary.ts";
import { STAGE_IDS, flowspecIndex, getStageSpec, promptName, renderStageGuide } from "./stage-guides.ts";
import { listNotifications } from "./tools/monitoring.ts";
import { getPipelineStatus } from "./tools/pipeline.ts";
import { getObservations, listDataChanges, searchSeries } from "./tools/analysis.ts";
import { listOpportunities, createOpportunity, getProcessEvaluation, listGateDecisions } from "./tools/process.ts";
import { listCommitteeSessions, getCommitteeSession } from "./tools/committee.ts";
import { getProjectIcPackage } from "./tools/ic-package.ts";
import { getPortfolioScorecard } from "./tools/portfolio-scorecard.ts";
import { getProjectDdWorkspace } from "./tools/dd-checklist.ts";

const BASE_TOOLS: readonly RegistryTool[] = [
  defineTool({
    name: "search_interpretations",
    description: "Search the governance interpretation registry.",
    scope: "read",
    kind: "read",
    stageActivities: [],
    inputSchema: {
      type: "object",
      properties: { doc: { type: "string" }, clause: { type: "string" }, q: { type: "string" } },
    },
    args: z.object({ doc: optString, clause: optString, q: optString }),
    handler: (ctx, a) => searchInterpretations(ctx.port, a),
  }),
  defineTool({
    name: "get_procedure",
    description:
      "Merged shared/region/entity procedure result (proc:resolve equivalent), with per-step source attribution.",
    scope: "read",
    kind: "read",
    stageActivities: [],
    inputSchema: {
      type: "object",
      properties: { procedure: { type: "string" }, entity: { type: "string" }, region: { type: "string" } },
      required: ["procedure"],
    },
    args: z.object({ procedure: requiredString, entity: optString, region: optString }),
    handler: (ctx, a) => getProcedure(ctx.port, a.procedure, a.entity, a.region),
  }),
  defineTool({
    name: "lookup_term",
    description: "Glossary term lookup — the same source that backs the web UI's tooltip.",
    scope: "read",
    kind: "read",
    stageActivities: [],
    inputSchema: { type: "object", properties: { term: { type: "string" } }, required: ["term"] },
    args: z.object({ term: requiredString }),
    handler: (ctx, a) => lookupTerm(ctx.port, a.term),
  }),
  defineTool({
    name: "list_notifications",
    description: "The caller's pending and recent notifications.",
    scope: "read",
    kind: "read",
    stageActivities: [],
    inputSchema: { type: "object", properties: {} },
    args: z.object({}),
    handler: (ctx) => listNotifications(ctx.port),
  }),
  defineTool({
    name: "get_pipeline_status",
    description:
      "Pipeline status for an opportunity (read-only, ADR-0102) — active run status, current stage, paused reason, and deep link to the pending human action screen.",
    scope: "read",
    kind: "read",
    stageActivities: [],
    inputSchema: { type: "object", properties: { opportunityId: { type: "string" } }, required: ["opportunityId"] },
    args: z.object({ opportunityId: requiredString }),
    handler: (ctx, a) => getPipelineStatus(ctx.port, a.opportunityId),
  }),
  defineTool({
    name: "search_series",
    description:
      "Distinct market/industry series catalog derived from fact_market_observation, with observation counts and period coverage.",
    scope: "read",
    kind: "read",
    stageActivities: ["market-research"],
    inputSchema: {
      type: "object",
      properties: { q: { type: "string", description: "Optional substring filter on series_id." } },
    },
    args: z.object({ q: optString }),
    handler: (ctx, a) => searchSeries(ctx.port, a.q),
  }),
  defineTool({
    name: "get_observations",
    description:
      "Observations for one series — latest revision per period by default; every revision row with all_revisions.",
    scope: "read",
    kind: "read",
    stageActivities: ["market-research"],
    inputSchema: {
      type: "object",
      properties: {
        seriesId: { type: "string" },
        period_id: { type: "string", description: "Optional narrow to one period." },
        all_revisions: { type: "boolean", description: "Return every revision row, not just the latest per period." },
      },
      required: ["seriesId"],
    },
    args: z.object({ seriesId: requiredString, period_id: optString, all_revisions: z.boolean().optional() }),
    handler: (ctx, a) =>
      getObservations(ctx.port, a.seriesId, { period_id: a.period_id, all_revisions: a.all_revisions === true }),
  }),
  defineTool({
    name: "list_data_changes",
    description: "data_change_log scan — new/revised/deleted detections, newest first.",
    scope: "read",
    kind: "read",
    stageActivities: [],
    inputSchema: {
      type: "object",
      properties: { series_id: { type: "string" }, limit: { type: "number", description: "1-500, default 100." } },
    },
    args: z.object({ series_id: optString, limit: z.number().optional() }),
    handler: (ctx, a) => listDataChanges(ctx.port, a),
  }),
  defineTool({
    name: "list_opportunities",
    description: "Opportunity funnel registry (S2) — status/project_id filters.",
    scope: "read",
    kind: "read",
    stageActivities: ["opportunity-discovery"],
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["identified", "assessed", "selected", "dropped"] },
        project_id: { type: "string" },
      },
    },
    args: z.object({ status: optString, project_id: optString }),
    handler: (ctx, a) => listOpportunities(ctx.port, a.status),
  }),
  defineTool({
    name: "create_opportunity",
    description: "Register an opportunity (S2) — analyst+; audited.",
    scope: "write",
    kind: "write",
    stageActivities: ["opportunity-discovery"],
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        market_scope: { type: "string" },
        value_chain_node: { type: "string" },
        market_size_krw_m: { type: "number" },
        growth_rate: { type: "number" },
        attractiveness_score: { type: "integer" },
        synergy_score: { type: "integer" },
        rationale: { type: "string" },
      },
      required: ["name"],
    },
    args: z.object({
      name: requiredString,
      market_scope: optString,
      value_chain_node: optString,
      market_size_krw_m: z.number().optional(),
      growth_rate: z.number().optional(),
      attractiveness_score: z.number().optional(),
      synergy_score: z.number().optional(),
      status: optString,
      rationale: optString,
    }),
    handler: (ctx, a) => createOpportunity(ctx.port, a),
  }),
  defineTool({
    name: "get_process_evaluation",
    description:
      "Derived process state (S1-S11) — currentStage, completedStages, gateStatus, requiredArtifacts. Never persisted.",
    scope: "read",
    kind: "read",
    stageActivities: [],
    inputSchema: { type: "object", properties: { opportunityId: { type: "string" } }, required: ["opportunityId"] },
    args: z.object({ opportunityId: requiredString }),
    handler: (ctx, a) => getProcessEvaluation(ctx.port, a.opportunityId),
  }),
  defineTool({
    name: "get_gate_decisions",
    description: "Gate decision records (GO/HOLD/KILL) for an opportunity.",
    scope: "read",
    kind: "read",
    stageActivities: [],
    inputSchema: { type: "object", properties: { opportunityId: { type: "string" } }, required: ["opportunityId"] },
    args: z.object({ opportunityId: requiredString }),
    handler: (ctx, a) => listGateDecisions(ctx.port, a.opportunityId),
  }),
  defineTool({
    name: "list_committee_sessions",
    description: "List steering-committee deliberation sessions for an opportunity (ADR-0097).",
    scope: "read",
    kind: "read",
    stageActivities: [],
    inputSchema: { type: "object", properties: { opportunityId: { type: "string" } }, required: ["opportunityId"] },
    args: z.object({ opportunityId: requiredString }),
    handler: (ctx, a) => listCommitteeSessions(ctx.port, a.opportunityId),
  }),
  defineTool({
    name: "get_committee_session",
    description:
      "Full committee-session transcript — per-round positions, chair agenda (proposal), AI-drafted minutes draft (minutes_draft in meta), chair PROPOSAL, verbatim dissent. Read-only (ADR-0196).",
    scope: "read",
    kind: "read",
    stageActivities: [],
    inputSchema: {
      type: "object",
      properties: { opportunityId: { type: "string" }, sessionId: { type: "string" } },
      required: ["opportunityId", "sessionId"],
    },
    args: z.object({ opportunityId: requiredString, sessionId: requiredString }),
    handler: (ctx, a) => getCommitteeSession(ctx.port, a.opportunityId, a.sessionId),
  }),
  defineTool({
    name: "get_project_ic_package",
    description:
      "S10 IC package (read-only) — adopted business case + simulations, DD completion, AI-proposed RAG grade (labeled a proposal), entity_ic/group_ic gate history, establishment progress.",
    // greenfield-execution-baseline (ADR-0161): read context for the S11 baseline drafts; the step-6 confirmation stays human-only.
    scope: "read",
    kind: "read",
    stageActivities: ["ic-preparation", "greenfield-execution-baseline"],
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
    args: z.object({ projectId: requiredString }),
    handler: (ctx, a) => getProjectIcPackage(ctx.port, a.projectId),
  }),
  defineTool({
    name: "get_portfolio_scorecard",
    description:
      "S11 portfolio scorecard (read-only) — quarterly rollup (financial/strategic sections, class rollup, insufficient_evidence), per-cycle trend, and venture-portfolio-IC transition-decision history. The transition-decision POST is deliberately not MCP-exposed (ADR-0101 §5).",
    scope: "read",
    kind: "read",
    stageActivities: [],
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        reviewCycle: {
          type: "string",
          description: "YYYY-Qn — optional explicit review cycle; defaults to the latest",
        },
      },
      required: ["projectId"],
    },
    args: z.object({ projectId: requiredString, reviewCycle: optString }),
    handler: (ctx, a) => getPortfolioScorecard(ctx.port, a.projectId, a.reviewCycle),
  }),
  defineTool({
    name: "get_project_dd_workspace",
    description:
      "S9 tailored DD workspace (S1-S11 chain) — standard checklist items with live judgment state, custom items with provenance, findings, the completion summary, and targets[] (comparison table source). Default scope is the selected target the gate judges; optional target_id reads an opened comparison target. Read-only; tailoring review and opening DD on another target are web-first human decisions.",
    // flow.spec v2.7.0 (ADR-0160 addendum c): the workspace renders all seven
    // ADR-0148 domains, so the four added S9 activities read through it too.
    scope: "read",
    kind: "read",
    stageActivities: [
      "commercial-dd",
      "technical-dd",
      "legal-dd",
      "financial-dd",
      "hr-dd",
      "market-dd",
      "financing-dd",
    ],
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ULID (promoted at S8)." },
        target_id: {
          type: "string",
          description:
            "Optional (ADR-0157): an OPENED comparison target. Omitted = the selected target the dd gate judges. Opening DD is a human act; this tool never opens it.",
        },
      },
      required: ["projectId"],
    },
    args: z.object({ projectId: requiredString, target_id: optString }),
    handler: (ctx, a) => getProjectDdWorkspace(ctx.port, a.projectId, a.target_id),
  }),
];

/** REST routes (and stage coverage) of the 17 original read/write tools, kept beside them rather than repeated per entry. */
const BASE_META: Record<string, { routes: string[]; activities?: string[]; artifacts?: string[] }> = {
  search_interpretations: { routes: ["GET /api/interpretations"] },
  get_procedure: { routes: ["GET /api/procedures/resolve"] },
  lookup_term: { routes: ["GET /api/glossary/{term}"] },
  list_notifications: { routes: ["GET /api/notifications"] },
  get_pipeline_status: { routes: ["GET /api/opportunities/{opportunityId}/pipeline/status"] },
  search_series: { routes: ["GET /api/series"] },
  get_observations: { routes: ["GET /api/series/{seriesId}/observations"] },
  list_data_changes: { routes: ["GET /api/data-changes"] },
  list_opportunities: { routes: ["GET /api/opportunities"] },
  create_opportunity: { routes: ["POST /api/opportunities"], artifacts: ["stage:S2:1"] },
  get_process_evaluation: { routes: ["GET /api/opportunities/{opportunityId}/process"] },
  get_gate_decisions: { routes: ["GET /api/opportunities/{opportunityId}/gate-decisions"] },
  list_committee_sessions: { routes: ["GET /api/opportunities/{opportunityId}/committee-sessions"] },
  get_committee_session: { routes: ["GET /api/opportunities/{opportunityId}/committee-sessions/{sessionId}"] },
  get_project_ic_package: { routes: ["GET /api/projects/{projectId}/ic-package"], artifacts: ["stage:S11:1"] },
  get_portfolio_scorecard: {
    routes: ["GET /api/projects/{projectId}/scorecard"],
    activities: ["portfolio-monitoring", "integration-monitoring", "partnership-monitoring"],
    artifacts: ["stage:S12:1", "stage:S12:4"],
  },
  get_project_dd_workspace: { routes: ["GET /api/projects/{projectId}/dd"] },
};

function withMeta(tool: RegistryTool): RegistryTool {
  const meta = BASE_META[tool.name];
  if (!meta) throw new Error(`BASE_META is missing an entry for ${tool.name}`);
  return {
    ...tool,
    routes: meta.routes,
    stageActivities: [...tool.stageActivities, ...(meta.activities ?? [])],
    stageArtifacts: meta.artifacts ?? [],
  };
}

export const REGISTRY: readonly RegistryTool[] = [...BASE_TOOLS.map(withMeta), ...STAGE_TOOLS, ...DECISION_TOOLS];

/** Tools advertised on a transport. Both transports advertise the same set (structural parity). */
export function toolsFor(_transport: McpTransportKind): RegistryTool[] {
  return [...REGISTRY];
}

export function toToolDefinition(t: RegistryTool): ToolDefinition {
  return { name: t.name, description: t.description, inputSchema: t.inputSchema };
}

/** Look up and run a tool with per-tool scope enforcement (when scopes are known). */
export async function callTool(
  transport: McpTransportKind,
  ctx: ToolContext,
  name: string,
  args: unknown,
): Promise<unknown> {
  const tool = toolsFor(transport).find((t) => t.name === name);
  if (!tool) throw new MCPValidationError(`Unknown tool: ${name}`);
  if (ctx.scopes && !ctx.scopes.includes(tool.scope)) {
    throw new MCPScopeError(`Tool '${name}' needs the '${tool.scope}' scope; this token does not carry it.`);
  }
  return tool.run(ctx, args);
}

/** SHA-256 of the canonical JSON arguments — audit stores this, never the arguments (ADR-0154 audit rule). */
export function hashArgs(args: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(args ?? {}))
    .digest("hex");
}

export interface ToolCallRecord {
  name: string;
  scope: ToolScope | null;
  ok: boolean;
  errorCode: string | null;
  argsHash: string;
  authInfo?: AuthInfo;
}

export interface BuildServerOptions {
  transport: McpTransportKind;
  resolveContext: (extra: { authInfo?: AuthInfo }) => ToolContext;
  onToolCall?: (record: ToolCallRecord) => void;
  log?: (message: string) => void;
}

export { MCPScopeError };
export type { RegistryTool, ToolContext, ToolScope, McpTransportKind };

export function buildMcpServer(opts: BuildServerOptions): Server {
  const server = new Server(
    { name: "co-newbiz-mcp", version: "1.9.0" },
    { capabilities: { tools: {}, prompts: {}, resources: {} } },
  );
  const tools = toolsFor(opts.transport);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(toToolDefinition) }));

  registerPromptsAndResources(server, tools, opts);

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const argsHash = hashArgs(args);
    const scope = tools.find((t) => t.name === name)?.scope ?? null;
    opts.log?.(`Tool called: ${name}`);
    try {
      const ctx = opts.resolveContext({ authInfo: extra.authInfo });
      const result = await callTool(opts.transport, ctx, name, args ?? {});
      const envelopeError = readEnvelopeError(result);
      const tool = tools.find((t) => t.name === name);
      if (tool?.kind === "propose" && envelopeError === null) pointToConfirmPage(server, tool, result, opts.log);
      opts.onToolCall?.({
        name,
        scope,
        ok: envelopeError === null,
        errorCode: envelopeError,
        argsHash,
        authInfo: extra.authInfo,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const code =
        err instanceof MCPScopeError
          ? err.code
          : err instanceof MCPValidationError
            ? "invalid_arguments"
            : "tool_error";
      opts.onToolCall?.({ name, scope, ok: false, errorCode: code, argsHash, authInfo: extra.authInfo });
      opts.log?.(`Tool ${name} failed: ${code}`);
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error (${code}): ${message}` }], isError: true };
    }
  });

  return server;
}

const JSON_MIME = "application/json";

/**
 * Prompts (stage_guide_s1..s12) and resources (glossary://, flowspec://),
 * design §7. Registered for every transport from the same code, so both
 * advertise the same set. Prompts are static text generated from the flow
 * spec; resources read through the same RestPort as the lookup_term tool, so
 * they carry the caller's permissions (and, on HTTP, need the read scope).
 */
function registerPromptsAndResources(server: Server, tools: readonly RegistryTool[], opts: BuildServerOptions): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: STAGE_IDS.map((id) => {
      const spec = getStageSpec(id);
      return {
        name: promptName(id),
        description: `Work guide for ${id} ${spec?.name ?? ""}: objective, activities, artifacts, gates and the tools that serve them.`,
      };
    }),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const stage = STAGE_IDS.map((id) => getStageSpec(id)).find((s) => s && promptName(s.id) === request.params.name);
    if (!stage) throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${request.params.name}`);
    return {
      description: `${stage.id} ${stage.name}`,
      messages: [{ role: "user" as const, content: { type: "text" as const, text: renderStageGuide(stage, tools) } }],
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: "glossary://index",
        name: "Glossary index",
        description: "Every glossary term key with its Korean and English names.",
        mimeType: JSON_MIME,
      },
      {
        uri: "flowspec://index",
        name: "Flow spec index",
        description: "Spec version and the S1-S12 stage list.",
        mimeType: JSON_MIME,
      },
    ],
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [
      {
        uriTemplate: "glossary://term/{key}",
        name: "Glossary term",
        description: "One glossary term (same source as lookup_term).",
        mimeType: JSON_MIME,
      },
      {
        uriTemplate: "flowspec://stage/{id}",
        name: "Flow spec stage",
        description: "Read-only slice of process/flow.spec.yaml for one stage (S1-S12).",
        mimeType: JSON_MIME,
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
    const uri = request.params.uri;
    const asJson = (value: unknown) => ({
      contents: [{ uri, mimeType: JSON_MIME, text: JSON.stringify(value, null, 2) }],
    });

    if (uri === "flowspec://index") return asJson(flowspecIndex());
    const stageMatch = /^flowspec:\/\/stage\/([^/]+)$/.exec(uri);
    if (stageMatch) {
      const stage = getStageSpec(decodeURIComponent(stageMatch[1]));
      if (!stage) throw new McpError(ErrorCode.InvalidParams, `Unknown stage in ${uri}`);
      return asJson(stage);
    }

    const termMatch = /^glossary:\/\/term\/([^/]+)$/.exec(uri);
    if (uri === "glossary://index" || termMatch) {
      const ctx = opts.resolveContext({ authInfo: extra.authInfo });
      if (ctx.scopes && !ctx.scopes.includes("read")) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          "Reading glossary resources needs the 'read' scope; this token does not carry it.",
        );
      }
      return asJson(
        termMatch ? await lookupTerm(ctx.port, decodeURIComponent(termMatch[1])) : await listGlossary(ctx.port),
      );
    }
    throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${uri}`);
  });
}

/**
 * MCP elicitation, design §6.3 step 2: when the client supports it, ALSO ask
 * the client to show the confirm link. The answer is ignored on purpose — an
 * elicitation reply comes through the agent's client and cannot prove a human
 * web session, so it can never confirm (let alone execute) a decision. Best
 * effort and non-blocking: a client that cannot elicit just gets the URL in
 * the tool result.
 */
function pointToConfirmPage(
  server: Server,
  tool: RegistryTool,
  result: unknown,
  log?: (message: string) => void,
): void {
  const data = (result as { data?: { proposal_id?: unknown; confirm_url?: unknown } } | null)?.data;
  const url = typeof data?.confirm_url === "string" ? data.confirm_url : null;
  const proposalId = typeof data?.proposal_id === "string" ? data.proposal_id : null;
  if (!url || !proposalId || !/^https?:\/\//.test(url)) return;
  const caps = server.getClientCapabilities();
  if (!caps?.elicitation) return;
  const message = `${tool.name} recorded a decision proposal. Nothing is decided yet: open ${url} in your logged-in co-newbiz session to review it and confirm or reject it.`;
  const request = caps.elicitation.url
    ? server.elicitInput({ mode: "url", message, elicitationId: proposalId, url }, { timeout: 60_000 })
    : server.elicitInput({ message, requestedSchema: { type: "object", properties: {} } }, { timeout: 60_000 });
  request.catch((err: unknown) =>
    log?.(`Elicitation for ${tool.name} not delivered: ${err instanceof Error ? err.message : String(err)}`),
  );
}

function readEnvelopeError(result: unknown): string | null {
  if (result && typeof result === "object" && "error" in result) {
    const e = (result as { error: unknown }).error;
    if (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string") {
      return (e as { code: string }).code;
    }
  }
  return null;
}
