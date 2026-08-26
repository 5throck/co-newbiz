// Port of app/server/scorecard.ts GET /api/portfolio-scorecard
import { getDb } from "../../../../../db/client.ts";
import { logDataAccess } from "../../../../../db/lib/access-control.ts";
import { listVisibleProjects } from "../../../../../db/repositories/project.repository.ts";
import { getPortfolioRollup } from "../../../../../db/repositories/venture-scorecard.repository.ts";
import { authenticate } from "../../../lib/auth.ts";
import { badRequest, ok } from "../../../lib/envelope.ts";

const REVIEW_CYCLE_RE = /^\d{4}-Q[1-4]$/;

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const url = new URL(request.url);
  const raw = (url.searchParams.get("review_cycle") ?? "").trim();
  if (raw !== "" && !REVIEW_CYCLE_RE.test(raw)) {
    return badRequest("invalid_review_cycle", `review_cycle '${raw}' must match YYYY-Q[1-4] (e.g. '2026-Q3') — the shared JV-monitor + portfolio cadence axis.`);
  }
  const cycle = raw === "" ? undefined : raw;

  const visible = listVisibleProjects(ctx.userId, {});
  const rollup = getPortfolioRollup({ reviewCycle: cycle, projectIds: visible.map((p) => p.id) });
  const resolved = rollup.review_cycle;

  const db = getDb();
  const projectsWithRowsTotal = resolved
    ? (db.query("SELECT COUNT(DISTINCT project_id) AS n FROM venture_scorecard WHERE review_cycle = ?").get(resolved) as { n: number }).n
    : 0;
  const visibleWithRows = new Set([...rollup.financial, ...rollup.strategic].map((r) => r.project_id)).size;
  const projectsExcluded = Math.max(0, projectsWithRowsTotal - visibleWithRows);

  logDataAccess(db, {
    userId: ctx.userId,
    tableKey: "venture_scorecard",
    recordRef: `portfolio:${resolved ?? "*"}`,
    action: "read",
    at: new Date().toISOString(),
  });

  return ok(rollup, 200, {
    scope: "membership-filtered",
    projects_visible: visible.length,
    projects_with_rows_total: projectsWithRowsTotal,
    scope_incomplete: projectsExcluded > 0,
    projects_excluded: projectsExcluded,
    review_cycle: resolved,
    review_cycles_available: rollup.provenance.review_cycles_available,
  });
}
