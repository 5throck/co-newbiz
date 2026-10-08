// @version 1.0.0
/**
 * Tool-definition kit shared by registry.ts and the stage tool modules
 * (ADR-0154 §1/§4, Wave M M-2). Kept apart from registry.ts so the tool
 * modules can build RegistryTool entries without importing the registry that
 * imports them.
 */

import { z } from "zod";
import type { RestPort } from "./shared/rest-port.ts";
import type { ToolDefinition } from "./shared/types.ts";
import { MCPValidationError } from "./shared/errors.ts";

export type ToolScope = "read" | "write" | "propose";
export type ToolKind = "read" | "write" | "generate" | "review" | "propose";
export type McpTransportKind = "stdio" | "http";

export interface ToolContext {
  port: RestPort;
  /**
   * Granted OAuth scopes. `undefined` on stdio: the personal token's scopes
   * are enforced by the REST layer only. On HTTP the registry checks them
   * per tool before any route runs, and the route checks again.
   */
  scopes?: readonly string[];
}

export class MCPScopeError extends Error {
  readonly code = "insufficient_scope";
  constructor(message: string) {
    super(message);
    this.name = "MCPScopeError";
  }
}

export interface RegistryTool {
  name: string;
  description: string;
  scope: ToolScope;
  kind: ToolKind;
  /** flow.spec activity ids this tool serves (coverage script input). */
  stageActivities: readonly string[];
  /** flow.spec requiredArtifacts keys (`stage:S#:N`, 1-based) this tool serves. */
  stageArtifacts: readonly string[];
  /**
   * "METHOD /api/path/{param}" for every REST route the tool calls. The
   * coverage script checks these against the human-only route list, and the
   * unit tests check each resolves in the in-process route table.
   */
  routes: readonly string[];
  /**
   * Human-only body values this tool refuses on a mixed route, formatted
   * "METHOD /path#field=value|value" (the coverage script cross-checks the
   * exclusion list against it).
   */
  blockedBodyValues?: readonly string[];
  /** Deprecated alias of a propose_* tool (same behavior, plus a notice). */
  deprecated?: boolean;
  inputSchema: ToolDefinition["inputSchema"];
  run(ctx: ToolContext, rawArgs: unknown): Promise<unknown>;
}

export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => {
      const key = i.path.map(String).join(".") || "arguments";
      return i.code === "invalid_type" || i.code === "too_small" ? `${key} is required.` : `${key}: ${i.message}`;
    })
    .join(" ");
}

export function defineTool<S extends z.ZodType>(
  def: Omit<RegistryTool, "run" | "stageArtifacts" | "routes"> & {
    stageArtifacts?: readonly string[];
    routes?: readonly string[];
    blockedBodyValues?: readonly string[];
    args: S;
    handler: (ctx: ToolContext, input: z.output<S>) => Promise<unknown>;
  },
): RegistryTool {
  const { args, handler, stageArtifacts, routes, blockedBodyValues, ...meta } = def;
  return {
    ...meta,
    ...(blockedBodyValues ? { blockedBodyValues } : {}),
    stageArtifacts: stageArtifacts ?? [],
    routes: routes ?? [],
    run: async (ctx, rawArgs) => {
      const parsed = args.safeParse(rawArgs ?? {});
      if (!parsed.success) throw new MCPValidationError(formatIssues(parsed.error));
      return handler(ctx, parsed.data);
    },
  };
}

export const requiredString = z.string().refine((s) => s.trim().length > 0);
export const optString = z.string().optional();
