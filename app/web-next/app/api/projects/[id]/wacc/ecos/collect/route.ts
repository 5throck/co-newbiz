// POST/GET /api/projects/[id]/wacc/ecos/collect — in-app ECOS collection for the WACC reference values
// (risk-free rate and credit spread, which GET .../wacc/suggestions reports as missing until the ECOS
// series are collected). Same model as .../wacc/beta-series/collect: POST starts the collection in-process
// (fetchSource over the two series the reference reads, last 12 months — the library behind
// `fetch --source ecos`) and answers 202 {run_id, status: "running"}; GET returns the latest run for
// polling. ECOS series are market-common, so the run slot and the status are global (409 already_running
// for a second request while one runs; GET shows the latest run to every member).
//
// Authorization: the calling user's own permissions — analyst with project visibility (viewer 403
// role_required; admin / non-member / closed project 404); GET = project visibility only. Audited:
// wacc_ecos.collect_requested, actor = the calling user (ADR-0012). Errors: 409 already_running,
// 503 ecos_api_key_missing. A failure inside the run lands on the run (status "failed"), not an HTTP error.
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { fail, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";
import { latestEcosCollectionRun, startEcosCollection } from "../../../../../../../lib/beta-collection-runner.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  return ok({ project_id: id, run: latestEcosCollectionRun(getDb()) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") {
    return forbidden("role_required", "Collecting ECOS rates requires the analyst role or higher.");
  }
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();

  const db = getDb();
  const started = startEcosCollection(db, { projectId: id, actor: auth.auth.userId });
  switch (started.kind) {
    case "missing_api_key":
      return fail(
        503,
        "ecos_api_key_missing",
        "ECOS_API_KEY is not configured on the server, so ECOS rates cannot be collected.",
      );
    case "already_running":
      return fail(409, "already_running", "An ECOS collection is already running.", { run_id: started.runId });
    case "started": {
      appendAudit(db, {
        actor: auth.auth.userId,
        action: "wacc_ecos.collect_requested",
        target: id,
        now: started.startedAt,
      });
      return ok({ project_id: id, run_id: started.runId, status: "running", started_at: started.startedAt }, 202);
    }
  }
}
