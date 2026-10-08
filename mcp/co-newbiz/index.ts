#!/usr/bin/env bun
// @version 2.0.0
/**
 * co-newbiz MCP server (stdio) — docs/architecture/mcp-integration.md.
 *
 * Calls the REST API exclusively (ADR-0011, FR-SYS-01) — see
 * shared/rest-client.ts's header for the non-negotiable rule this file
 * never violates: no bun:sqlite, no db/client.ts, no db/repositories or
 * db/lib import anywhere under mcp/co-newbiz/.
 *
 * ADR-0154 (Wave M, M-1): tool definitions live in ./registry.ts, shared
 * with the remote Streamable HTTP transport at app/web-next/app/api/mcp.
 * This entry point wires the registry to the stdio transport through the
 * HttpRestPort (personal API token). The stdio tool list is unchanged.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createLogger } from "./shared/logger.ts";
import { httpRestPort } from "./shared/rest-client.ts";
import type { ToolDefinition } from "./shared/types.ts";
import { buildMcpServer, callTool, toolsFor, toToolDefinition } from "./registry.ts";

const log = createLogger("co-newbiz-mcp");

export const TOOLS: ToolDefinition[] = toolsFor("stdio").map(toToolDefinition);

export function buildServer(): Server {
  return buildMcpServer({
    transport: "stdio",
    resolveContext: () => ({ port: httpRestPort }),
    log: (m) => log.info(m),
  });
}

/** Run one stdio tool against the REST API (used by tests and the server). */
export async function dispatch(name: string, args: Record<string, unknown>): Promise<unknown> {
  return callTool("stdio", { port: httpRestPort }, name, args);
}

if (import.meta.main) {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("co-newbiz MCP server started");
}
