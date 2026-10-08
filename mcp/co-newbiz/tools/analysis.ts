// @version 1.4.0
/**
 * Market data read tools — mcp-integration.md §3. Thin REST wrappers over
 * /api/series and /api/data-changes: the membership gate and the audit log
 * all live in the REST layer — this file only relays, per ADR-0011.
 *
 * ADR-0094: get_assumptions / set_assumption / compare_runs / run_simulation
 * were removed — their backing surfaces (/api/assumptions, /api/runs,
 * /api/simulations) were deleted with the project-keyed REST tree.
 */

import type { RestPort } from "../shared/rest-port.ts";

export async function searchSeries(port: RestPort, q?: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const qs = params.toString();
  return port.get(`/api/series${qs ? `?${qs}` : ""}`);
}

export async function getObservations(port: RestPort, seriesId: string, opts: { period_id?: string; all_revisions?: boolean } = {}) {
  const params = new URLSearchParams();
  if (opts.period_id) params.set("period_id", opts.period_id);
  if (opts.all_revisions) params.set("all_revisions", "1");
  const qs = params.toString();
  return port.get(`/api/series/${encodeURIComponent(seriesId)}/observations${qs ? `?${qs}` : ""}`);
}

export async function listDataChanges(port: RestPort, opts: { series_id?: string; limit?: number } = {}) {
  const params = new URLSearchParams();
  if (opts.series_id) params.set("series_id", opts.series_id);
  if (typeof opts.limit === "number") params.set("limit", String(opts.limit));
  const qs = params.toString();
  return port.get(`/api/data-changes${qs ? `?${qs}` : ""}`);
}
