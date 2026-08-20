// @version 1.0.0
/**
 * REST client — the ONLY way this server touches co-newbiz data
 * (ADR-0011, FR-SYS-01, mcp-integration.md §1). No file in mcp/co-newbiz/**
 * imports bun:sqlite, db/client.ts, or any db/repositories|lib module — every
 * permission check, audit-log entry, and mnpi_flag exclusion happens once,
 * at the REST layer, so no AI client can shortcut around it.
 *
 * mcp-integration.md §5: a persistent 4xx (e.g. a 403 membership/MNPI
 * denial) is a terminal, meaningful response — never retried. Only network
 * failures and 5xx are retried, and never for a write (POST/PUT/DELETE),
 * since retrying a mutation risks a duplicate side effect.
 */

import { RateLimiter } from "./rate-limiter.ts";
import { MCPConfigError, MCPNetworkError } from "./errors.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("co-newbiz-mcp");

export interface Envelope<T> {
  data: T;
  meta: Record<string, unknown>;
  error: { code: string; message: string } | null;
}

function requireToken(): string {
  const token = process.env.CO_NEWBIZ_API_TOKEN;
  if (!token) {
    throw new MCPConfigError(
      "CO_NEWBIZ_API_TOKEN is not set. Issue one via POST /api/tokens while logged in to the web app, then set it in this MCP server's environment (docs/mcp-integration.md §2).",
    );
  }
  return token;
}

function baseUrl(): string {
  return process.env.CO_NEWBIZ_API_BASE_URL ?? "http://localhost:8787";
}

// Read tools get a larger budget than write tools per mcp-integration §5.
const readLimiter = new RateLimiter(60, 60_000);
const writeLimiter = new RateLimiter(10, 60_000);

async function call<T>(path: string, init: RequestInit, limiter: RateLimiter): Promise<Envelope<T>> {
  await limiter.acquireToken();
  const isWrite = (init.method ?? "GET") !== "GET";
  const maxAttempts = isWrite ? 1 : 3;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(`${baseUrl()}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${requireToken()}`, ...(init.headers ?? {}) },
      });
      const body = (await res.json()) as Envelope<T>;
      if (!res.ok && res.status >= 500 && attempt < maxAttempts - 1) {
        log.warn(`${path} returned ${res.status}, retrying (attempt ${attempt + 1}/${maxAttempts})`);
        await new Promise((r) => setTimeout(r, 2 ** attempt * 300));
        continue;
      }
      // A 2xx envelope or a terminal 4xx envelope — both are meaningful,
      // typed responses. Never throw for these; the caller reads .error.
      return body;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 300));
        continue;
      }
    }
  }
  throw new MCPNetworkError(`Request to ${path} failed after retries: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

export const rest = {
  get: <T>(path: string) => call<T>(path, { method: "GET" }, readLimiter),
  post: <T>(path: string, body?: unknown) => call<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }, writeLimiter),
  delete: <T>(path: string) => call<T>(path, { method: "DELETE" }, writeLimiter),
};
