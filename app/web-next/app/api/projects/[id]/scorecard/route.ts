// Port of app/server/scorecard.ts GET /api/projects/:id/scorecard
import { getProjectIfVisible } from "../../../../../../../db/repositories/project.repository.ts";
import { getVentureScorecard } from "../../../../../../../db/repositories/venture-scorecard.repository.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";

const REVIEW_CYCLE_RE = /^\d{4}-Q[1-4]$/;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id: projectId } = await params;
  const url = new URL(request.url);
  const raw = (url.searchParams.get("review_cycle") ?? "").trim();
  if (raw !== "" && !REVIEW_CYCLE_RE.test(raw)) {
    return badRequest("invalid_review_cycle", `review_cycle '${raw}' must match YYYY-Q[1-4] (e.g. '2026-Q3') — the shared JV-monitor + portfolio cadence axis.`);
  }
  const cycle = raw === "" ? undefined : raw;

  if (!getProjectIfVisible(ctx.userId, projectId, {})) return notFound();

  const rows = getVentureScorecard({ projectId, reviewCycle: cycle, actor: ctx.userId });
  return ok(rows, 200, { project_id: projectId, review_cycle: rows[0]?.review_cycle ?? cycle ?? null, count: rows.length });
}
