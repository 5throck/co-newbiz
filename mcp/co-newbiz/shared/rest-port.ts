// @version 1.1.0
/**
 * RestPort — the transport-neutral seam between MCP tool handlers and the
 * co-newbiz REST API (ADR-0154 §1, design 2026-10-08-wave-m-mcp-parity §3.1).
 *
 * Two implementations exist and both run the SAME route handler code:
 *  - HttpRestPort (shared/rest-client.ts): stdio, bearer personal token.
 *  - InProcessRestPort (app/web-next/lib/mcp/in-process-port.ts): /api/mcp,
 *    invokes the Next.js route handlers directly as the delegated principal.
 *
 * Tool handlers only ever see this interface, so no business validation can
 * live in a tool (ADR-0011): permission checks, audit, and MNPI exclusion
 * stay at the REST layer.
 */
import type { Envelope } from "./rest-client.ts";

export interface RestPort {
  get<T = unknown>(path: string): Promise<Envelope<T>>;
  post<T = unknown>(path: string, body?: unknown): Promise<Envelope<T>>;
  put<T = unknown>(path: string, body?: unknown): Promise<Envelope<T>>;
  patch<T = unknown>(path: string, body?: unknown): Promise<Envelope<T>>;
  delete<T = unknown>(path: string): Promise<Envelope<T>>;
}
