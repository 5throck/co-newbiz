// POST/GET /api/projects/[id]/wacc/beta-series/collect — in-app KRX beta collection ("수집 실행").
//
// POST starts the collection (the same flow as `bun scripts/co-newbiz/beta-series.ts --project <id>`,
// run in-process by lib/beta-collection-runner.ts) and answers 202 {run_id, status: "running"} at once; a
// cold run takes minutes (hundreds of paced KRX calls), so the client polls GET until the run leaves
// "running". GET returns the project's latest run ({run: null} when none ever ran).
//
// Authorization: the calling user's own permissions — no service account. POST = authenticated analyst
// with project visibility (viewer -> 403 role_required; admin / non-member / closed project -> 404, the
// same rule as the WACC input session POST). GET = project visibility only (includeClosed, like the
// beta-series GET). Audited: beta_series.collect_requested, actor = the calling user (ADR-0012).
//
// Errors: 400 no_subject_company (nothing to collect), 409 already_running (this project) /
// collection_busy (another project's run holds the shared KRX run state), 503 krx_api_key_missing.
// A failure inside the run is not an HTTP error — it lands on the run (status "failed", error text).
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { fail, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";
import { latestBetaCollectionRun, startBetaCollection } from "../../../../../../../lib/beta-collection-runner.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  return ok({ project_id: id, run: latestBetaCollectionRun(getDb(), id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") {
    return forbidden("role_required", "Collecting beta series requires the analyst role or higher.");
  }
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();

  const db = getDb();
  const started = startBetaCollection(db, { projectId: id, actor: auth.auth.userId });
  switch (started.kind) {
    case "missing_api_key":
      return fail(
        503,
        "krx_api_key_missing",
        "KRX_API_KEY is not configured on the server, so beta series cannot be collected.",
      );
    case "invalid":
      if (started.code === "project_not_found") return notFound();
      return fail(400, "no_subject_company", "No subject company is set, so the beta series cannot be collected.");
    case "already_running":
      return fail(409, "already_running", "A beta collection is already running for this project.", {
        run_id: started.runId,
      });
    case "busy":
      return fail(
        409,
        "collection_busy",
        "Another project's beta collection is running — try again when it finishes.",
        {
          run_id: started.runId,
        },
      );
    case "started": {
      appendAudit(db, {
        actor: auth.auth.userId,
        action: "beta_series.collect_requested",
        target: id,
        now: started.startedAt,
      });
      return ok({ project_id: id, run_id: started.runId, status: "running", started_at: started.startedAt }, 202);
    }
  }
}
