import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

// GET /api/projects/[id]/comp-parity — aggregate-only pay parity + management
// incentive package (hr-integration-agent). Executive refs only, never names
// (SEC-05). B9.
// POST — 2026-10-19 decider: the Wave 0 read-only scaffold had NO writer, so the
// page could never hold real data. Analyst+ person entry for comp_benchmark rows
// (job family × grade medians), audited; management packages stay batch-fed.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();
  const parity = db.query(
    `SELECT job_family, grade, headcount, target_median, acquirer_median, gap_pct, annual_cost_delta
     FROM comp_benchmark WHERE project_id = ? ORDER BY job_family`,
  ).all(id);
  const packages = db.query(
    `SELECT id, executive_ref, role_title, base_pay, coc_trigger, coc_payout_estimate,
            accelerated_vesting, non_compete_months, flight_risk, value_impact
     FROM management_package WHERE project_id = ? ORDER BY executive_ref`,
  ).all(id);
  return ok({ parity, management_packages: packages }, 200, { parity: parity.length, packages: packages.length });
}


export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Recording pay-parity data requires the analyst role or higher." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    job_family?: unknown; grade?: unknown; headcount?: unknown; target_median?: unknown; acquirer_median?: unknown;
  } | null;
  const jobFamily = typeof body?.job_family === "string" ? body.job_family.trim() : "";
  const grade = typeof body?.grade === "string" ? body.grade.trim() : "";
  const headcount = Number(body?.headcount);
  const targetMedian = Number(body?.target_median);
  const acquirerMedian = Number(body?.acquirer_median);
  if (!jobFamily) return badRequest("invalid_request", "job_family is required.");
  // k-익명성 ≥3 (스키마 CHECK) — 5인 미만 집계 억제 원칙의 스키마 수준 강제.
  if (!grade) return badRequest("invalid_request", "grade is required.");
  if (!Number.isInteger(headcount) || headcount < 3) return badRequest("invalid_request", "headcount must satisfy k-anonymity (at least 3).");
  if (!Number.isInteger(targetMedian) || targetMedian <= 0) return badRequest("invalid_request", "target_median must be a positive integer (KRW).");
  if (!Number.isInteger(acquirerMedian) || acquirerMedian <= 0) return badRequest("invalid_request", "acquirer_median must be a positive integer (KRW).");
  const db = getDb();
  const now = new Date().toISOString();
  const rowId = ulid();
  const gapPct = acquirerMedian > 0 ? Math.round(((acquirerMedian - targetMedian) / acquirerMedian) * 100) / 100 : 0;
  const annualCostDelta = Math.round((acquirerMedian - targetMedian) * headcount);
  db.run(
    `INSERT INTO comp_benchmark (id, project_id, job_family, grade, headcount, target_median, acquirer_median, gap_pct, annual_cost_delta, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [rowId, id, jobFamily, grade, headcount, targetMedian, acquirerMedian, gapPct, annualCostDelta, now],
  );
  appendAudit(db, { actor: auth.auth.userId, action: "comp_benchmark.recorded", target: `${id}:${rowId}:${jobFamily}`, now });
  return ok({ id: rowId, gap_pct: gapPct, annual_cost_delta: annualCostDelta }, 201);
}