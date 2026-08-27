// Phase 2 port of app/server/envelope.ts (ADR-0069/0070) — same
// { data, meta, error } contract, NextResponse instead of Hono's c.json.
// Kept as a near-literal port rather than a rewrite: the MCP layer and any
// future web client consume this exact shape, and re-deriving it would risk
// a silent drift from docs/api-spec.md §9.

import { NextResponse } from "next/server";

export type EnvelopeStatus = 200 | 201 | 400 | 401 | 403 | 404 | 409 | 423 | 429 | 500;

export interface ErrorBody {
  code: string;
  message: string;
}

export function ok<T>(data: T, status: EnvelopeStatus = 200, meta: Record<string, unknown> = {}) {
  return NextResponse.json({ data, meta: { as_of: new Date().toISOString(), ...meta }, error: null }, { status });
}

export interface Provenance {
  [key: string]: string | undefined;
  assumption_key?: string;
  source?: string;
  anchor_ref?: string;
  run_id?: string;
}

export function provenance(fields: { [K in keyof Provenance]: string | null | undefined }): Provenance {
  const out: Provenance = {};
  for (const [key, value] of Object.entries(fields) as [keyof Provenance, string | null | undefined][]) {
    if (typeof value === "string" && value.trim() !== "") out[key] = value;
  }
  return out;
}

export function fail(status: EnvelopeStatus, code: string, message: string) {
  return NextResponse.json(
    { data: null, meta: { as_of: new Date().toISOString() }, error: { code, message } satisfies ErrorBody },
    { status },
  );
}

export const unauthorized = (code: string, message: string) => fail(401, code, message);
export const forbidden = (code: string, message: string) => fail(403, code, message);
export const notFound = (message = "Not found.") => fail(404, "not_found", message);
export const badRequest = (code: string, message: string) => fail(400, code, message);
