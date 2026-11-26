// POST/GET /api/projects/[id]/wacc/credit-rating/collect — in-app collection of the subject company's DISCLOSED
// credit rating from DART (ADR-0208 slice 2). The business report is a multi-megabyte document, so the
// suggestions GET never fetches it: it reads the cache this route fills.
//
// Same model as .../wacc/ecos/collect and .../wacc/beta-series/collect: POST records a job_run row and answers
// 202 {run_id, status: "running"}; the collection (latest business report -> section parse, plus the OpenDART
// debt-securities registrations) runs in-process; GET returns the project's latest run for polling, after which the
// client reloads GET .../wacc/suggestions. `?target_id=` collects for a shortlisted target's company (ADR-0156),
// like the suggestions route; without it the project's bound subject company is used.
//
// Authorization: the calling user's own permissions — analyst with project visibility (viewer 403 role_required;
// admin / non-member / closed project 404); GET = project visibility only. Audited:
// wacc_credit_rating.collect_requested, actor = the calling user (ADR-0012). Errors: 400 no_subject_company /
// no_dart_corp_code, 409 already_running, 503 dart_api_key_missing. A failure inside the run lands on the run
// (status "failed"), not an HTTP error.
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { listProjectAnalysisTargets } from "../../../../../../../../../db/lib/wacc.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import {
  latestCreditRatingCollectionRun,
  startCreditRatingCollection,
} from "../../../../../../../lib/credit-rating-collection-runner.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  return ok({ project_id: id, run: latestCreditRatingCollectionRun(getDb(), id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") {
    return forbidden("role_required", "Collecting credit ratings requires the analyst role or higher.");
  }
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();

  const db = getDb();
  const targetId = new URL(request.url).searchParams.get("target_id");
  let companyId =
    (db.query("SELECT company_id FROM md_project WHERE id = ?").get(id) as { company_id: string | null } | undefined)
      ?.company_id ?? null;
  if (targetId) {
    const t = listProjectAnalysisTargets(db, id).find((x) => x.targetId === targetId);
    if (!t?.companyId) {
      return badRequest("invalid_request", "target_id must be a shortlisted target (a company that can be analyzed).");
    }
    companyId = t.companyId;
  }

  const started = startCreditRatingCollection(db, { projectId: id, companyId, actor: auth.auth.userId });
  switch (started.kind) {
    case "invalid":
      if (started.code === "no_company") {
        return fail(400, "no_subject_company", "No subject company is set, so the credit rating cannot be collected.");
      }
      return fail(
        400,
        "no_dart_corp_code",
        "The subject company has no DART corp code, so its disclosed credit rating cannot be collected.",
      );
    case "missing_api_key":
      return fail(
        503,
        "dart_api_key_missing",
        "DART_API_KEY is not configured on the server, so credit ratings cannot be collected.",
      );
    case "already_running":
      return fail(409, "already_running", "A credit rating collection is already running for this company.", {
        run_id: started.runId,
      });
    case "started": {
      appendAudit(db, {
        actor: auth.auth.userId,
        action: "wacc_credit_rating.collect_requested",
        target: id,
        now: started.startedAt,
      });
      return ok({ project_id: id, run_id: started.runId, status: "running", started_at: started.startedAt }, 202);
    }
  }
}
