// @version 1.1.0
/**
 * Response envelope — docs/api-spec.md §9.
 *
 * Every API response is { data, meta: { as_of, ... }, error } — the UI and
 * MCP layer consume one shape everywhere. Numeric figures carry their
 * provenance in `meta` (assumption key, as_of, source, anchor_ref) so source
 * tooltips are never hand-typed in the client (FR-SYS-03).
 */

import type { Context } from "hono";

export type EnvelopeStatus = 200 | 201 | 400 | 401 | 403 | 404 | 409 | 423 | 500;

export interface ErrorBody {
  code: string;
  message: string;
}

export function ok<T>(c: Context, data: T, status: EnvelopeStatus = 200, meta: Record<string, unknown> = {}) {
  return c.json({ data, meta: { as_of: new Date().toISOString(), ...meta }, error: null }, status);
}

/**
 * FR-SYS-03 provenance fields a route may attach to `meta` — only where the
 * route can derive them from the rows it actually returns. Absent stays
 * absent: no placeholder values for fields a row does not carry, and a
 * multi-row response whose rows carry differing provenance keeps it per-row
 * (the payload rows already carry their own columns) instead of collapsing
 * it into one fabricated meta entry.
 */
export interface Provenance {
  assumption_key?: string;
  source?: string;
  anchor_ref?: string;
  run_id?: string;
}

/**
 * Normalize row columns into provenance meta: null/undefined/blank values
 * are dropped, so callers pass nullable columns straight through and a
 * missing anchor stays an omitted field rather than a literal null (the
 * client's provenanceOf() picks exactly these keys out of meta).
 */
export function provenance(fields: { [K in keyof Provenance]: string | null | undefined }): Provenance {
  const out: Provenance = {};
  for (const [key, value] of Object.entries(fields) as [keyof Provenance, string | null | undefined][]) {
    if (typeof value === "string" && value.trim() !== "") out[key] = value;
  }
  return out;
}

export function fail(c: Context, status: EnvelopeStatus, code: string, message: string) {
  return c.json({ data: null, meta: { as_of: new Date().toISOString() }, error: { code, message } satisfies ErrorBody }, status);
}

export const unauthorized = (c: Context, code: string, message: string) => fail(c, 401, code, message);
export const forbidden = (c: Context, code: string, message: string) => fail(c, 403, code, message);
export const notFound = (c: Context, message = "Not found.") => fail(c, 404, "not_found", message);
export const badRequest = (c: Context, code: string, message: string) => fail(c, 400, code, message);
