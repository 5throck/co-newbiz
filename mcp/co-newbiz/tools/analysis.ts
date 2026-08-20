// @version 1.0.0
/**
 * Market/assumption tools — mcp-integration.md §3. Thin REST wrappers over
 * app/server/analysis.ts (Wave 5.7B): the membership gate, the FR-DATA-07
 * rationale rule, and the audit log all live in the REST layer — this file
 * only relays, per ADR-0011. set_assumption (✱ write) follows the
 * manage_watch pattern: required fields are checked here so a malformed
 * call fails before any REST round-trip, scope enforcement stays REST-side.
 */

import { rest } from "../shared/rest-client.ts";

export async function searchSeries(q?: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const qs = params.toString();
  return rest.get(`/api/series${qs ? `?${qs}` : ""}`);
}

export async function getObservations(seriesId: string, opts: { period_id?: string; all_revisions?: boolean } = {}) {
  const params = new URLSearchParams();
  if (opts.period_id) params.set("period_id", opts.period_id);
  if (opts.all_revisions) params.set("all_revisions", "1");
  const qs = params.toString();
  return rest.get(`/api/series/${encodeURIComponent(seriesId)}/observations${qs ? `?${qs}` : ""}`);
}

export async function listDataChanges(opts: { series_id?: string; limit?: number } = {}) {
  const params = new URLSearchParams();
  if (opts.series_id) params.set("series_id", opts.series_id);
  if (typeof opts.limit === "number") params.set("limit", String(opts.limit));
  const qs = params.toString();
  return rest.get(`/api/data-changes${qs ? `?${qs}` : ""}`);
}

export async function getAssumptions(opts: { run_id?: string; key?: string } = {}) {
  const params = new URLSearchParams();
  if (opts.run_id) params.set("run_id", opts.run_id);
  if (opts.key) params.set("key", opts.key);
  const qs = params.toString();
  return rest.get(`/api/assumptions${qs ? `?${qs}` : ""}`);
}

export interface SetAssumptionInput {
  run_id: string;
  assumption_key: string;
  kind: "live" | "user" | "derived" | "assumed";
  value: number;
  as_of: string;
  rationale?: string;
  anchor_ref?: string;
  ttl_days?: number;
}

/**
 * ✱ write — needs the token's write scope. kind='assumed' without a
 * non-empty rationale is rejected by the REST layer (FR-DATA-07), and the
 * DB CHECK behind it — this tool never relaxes either.
 */
export async function setAssumption(input: SetAssumptionInput) {
  if (!input.run_id?.trim()) throw new Error("run_id is required.");
  if (!input.assumption_key?.trim()) throw new Error("assumption_key is required.");
  return rest.post("/api/assumptions", input);
}
