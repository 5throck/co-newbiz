// POST/GET /api/projects/[id]/wacc/kofia/collect — in-app collection of KOFIA grade-by-rating corporate bond yields
// (ADR-0208 slice 4): the valuation-firm average 3y yields of AAA..BBB- plus the same-date KTB 3y, stored as day-grain
// observations; the credit-spread map then uses the direct grade yield (spread_basis "kofia_grade") instead of the ECOS
// interpolation.
//
// GATED. Automated collection stays OFF unless CO_NEWBIZ_KOFIA_COLLECT is "on", pending KOFIA's written confirmation
// that it is permitted (ADR-0208, runbook beta-series-collection). Switch off: POST answers 503 kofia_collect_disabled
// (nothing is fetched, no job_run row, no audit row); GET still answers the latest run (null) with `enabled: false`.
//
// READ-MOSTLY (scheduled collection, scripts/co-newbiz/jobs/collect/kofia.ts keeps the store current): a POST while the
// stored data is up to date fetches nothing and answers 200 {status: "up_to_date", latest_date, expected_date, run_id: null}
// (no job_run, no audit row); a stale store is collected by any analyst. There is no force flag: admins cannot reach project
// routes (FR-SEC-03), so an admin forces a re-collect with "run now" of the scheduled job collect.kofia (admin schedule page).
// GET adds `status`: the latest stored day, whether it is up to date, and the next scheduled run (stored schedule row).
//
// Same model as .../wacc/ecos/collect: POST records a job_run row and answers 202 {run_id, status: "running"}; the run
// executes in-process; GET returns the latest run for polling. Market-common data, so the run slot and status are GLOBAL
// (409 already_running). Authorization: analyst with project visibility (viewer 403 role_required; admin / non-member /
// closed project 404); GET = project visibility only. Audited: wacc_kofia.collect_requested (ADR-0012).
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { fail, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { kofiaCollectStatus } from "../../../../../../../lib/kofia-collect-status.ts";
import { kofiaCollectEnabled } from "../../../../../../../lib/kofia-collector.ts";
import { latestKofiaCollectionRun, startKofiaCollection } from "../../../../../../../lib/kofia-collection-runner.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();
  return ok({
    project_id: id,
    enabled: kofiaCollectEnabled(),
    run: latestKofiaCollectionRun(db),
    status: kofiaCollectStatus(db),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") {
    return forbidden("role_required", "Collecting KOFIA grade yields requires the analyst role or higher.");
  }
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();

  const db = getDb();
  const started = startKofiaCollection(db, { projectId: id, actor: auth.auth.userId });
  switch (started.kind) {
    case "up_to_date":
      return ok({
        project_id: id,
        status: "up_to_date",
        run_id: null,
        latest_date: started.latestDate,
        expected_date: started.expectedDate,
      });
    case "disabled":
      return fail(
        503,
        "kofia_collect_disabled",
        "Automated KOFIA collection is switched off (CO_NEWBIZ_KOFIA_COLLECT is not 'on'); it stays off until KOFIA confirms in writing that it is permitted.",
      );
    case "already_running":
      return fail(409, "already_running", "A KOFIA collection is already running.", { run_id: started.runId });
    case "started": {
      appendAudit(db, {
        actor: auth.auth.userId,
        action: "wacc_kofia.collect_requested",
        target: id,
        now: started.startedAt,
      });
      return ok({ project_id: id, run_id: started.runId, status: "running", started_at: started.startedAt }, 202);
    }
  }
}
