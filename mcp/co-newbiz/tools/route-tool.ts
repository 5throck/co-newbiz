// @version 1.0.0
/**
 * routeTool — builds a RegistryTool that is a thin wrapper over exactly one
 * REST route through the RestPort (ADR-0154 §4/§5, design §5.1). The tool
 * carries no business validation: path ids are the only required inputs, the
 * payload travels as an opaque `body` object, and the route (its Zod/hand
 * validation, role checks, audit, MNPI exclusion) stays the single authority.
 *
 * `blockBody` is an INPUT ALLOWLIST, not validation: it refuses body values
 * that would execute a human-only action through a route that mixes agent-safe
 * and human-only actions (deal-structure `complete_four_axis`).
 */

import { z } from "zod";
import { MCPValidationError } from "../shared/errors.ts";
import { defineTool, requiredString, type RegistryTool, type ToolKind } from "../define.ts";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteToolSpec {
  name: string;
  description: string;
  kind: ToolKind;
  method: HttpMethod;
  /** REST path with `{param}` placeholders, e.g. /api/projects/{projectId}/wacc */
  path: string;
  activities?: readonly string[];
  artifacts?: readonly string[];
  /** Whether the route takes a JSON body, and whether it is mandatory. */
  body?: "required" | "optional";
  /** Hint shown in the body property description (field names the route reads). */
  bodyHint?: string;
  /** GET only: accept an optional `query` object of simple filters. */
  query?: boolean;
  /** Refuse these values of a body field (human-only actions of a mixed route). */
  blockBody?: { field: string; values: readonly string[] };
}

const PLACEHOLDER = /\{(\w+)\}/g;

export function routeTool(spec: RouteToolSpec): RegistryTool {
  const ids = [...spec.path.matchAll(PLACEHOLDER)].map((m) => m[1]);
  const shape: Record<string, z.ZodType> = {};
  const properties: Record<string, unknown> = {};
  for (const id of ids) {
    shape[id] = requiredString;
    properties[id] = { type: "string" };
  }
  if (spec.body) {
    const record = z.record(z.string(), z.unknown());
    shape.body = spec.body === "required" ? record : record.optional();
    properties.body = {
      type: "object",
      description: spec.bodyHint ?? "JSON body forwarded to the REST route unchanged; the route validates it.",
    };
  }
  if (spec.query) {
    shape.query = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional();
    properties.query = { type: "object", description: "Optional query-string filters." };
  }
  const required = [...ids, ...(spec.body === "required" ? ["body"] : [])];
  const args = z.object(shape);
  const scope = spec.kind === "read" ? "read" : spec.kind === "propose" ? "propose" : "write";
  const block = spec.blockBody;

  return defineTool({
    name: spec.name,
    description: spec.description,
    scope,
    kind: spec.kind,
    stageActivities: spec.activities ?? [],
    stageArtifacts: spec.artifacts ?? [],
    routes: [`${spec.method} ${spec.path}`],
    blockedBodyValues: block ? [`${spec.method} ${spec.path}#${block.field}=${block.values.join("|")}`] : undefined,
    inputSchema: { type: "object", properties, required },
    args,
    handler: async (ctx, input: Record<string, unknown>) => {
      const path = spec.path.replace(PLACEHOLDER, (_m, key: string) => encodeURIComponent(String(input[key])));
      const body = input.body as Record<string, unknown> | undefined;
      if (block && body && typeof body[block.field] === "string" && block.values.includes(body[block.field] as string)) {
        throw new MCPValidationError(
          `body.${block.field}='${String(body[block.field])}' is a human-only action and is not available over MCP; a person performs it in the web app.`,
        );
      }
      const query = input.query as Record<string, string | number | boolean> | undefined;
      const qs = query && Object.keys(query).length > 0
        ? `?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()}`
        : "";
      switch (spec.method) {
        case "GET":
          return ctx.port.get(`${path}${qs}`);
        case "DELETE":
          return ctx.port.delete(path);
        case "POST":
          return ctx.port.post(path, body);
        case "PUT":
          return ctx.port.put(path, body);
        case "PATCH":
          return ctx.port.patch(path, body);
      }
    },
  });
}
