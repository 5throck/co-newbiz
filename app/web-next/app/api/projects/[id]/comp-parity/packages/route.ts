import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { route } from "../../../../../../lib/route.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

// POST /api/projects/[id]/comp-parity/packages — management incentive package
// person entry (hr-integration-agent; brownfield-dd step 7, ma-04~06). Until
// 2026-10-21 management_package rows were batch-fed only, so the S9 보상 step
// could not be completed from the workspace. Executive refs only, never names
// (SEC-05: the 0033 CHECK accepts e.g. CEO-01 / CFO-02); money in integer KRW.
// Analyst+, audited; members only (FR-SEC-01).
const EXECUTIVE_REF = /^[A-Z][A-Z0-9_]*-\d{2}$/;
const FLIGHT_RISK = new Set(["low", "medium", "high"]);

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Recording executive comp packages requires the analyst role or higher." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  const executiveRef = typeof body?.executive_ref === "string" ? body.executive_ref.trim().toUpperCase() : "";
  if (!EXECUTIVE_REF.test(executiveRef)) return badRequest("invalid_request", "executive_ref must be an anonymous reference (e.g. CEO-01, CFO-02) — real names are never recorded (SEC-05).");
  const roleTitle = typeof body?.role_title === "string" ? body.role_title.trim() : "";
  if (!roleTitle) return badRequest("invalid_request", "role_title is required.");
  const basePay = Number(body?.base_pay);
  if (!Number.isInteger(basePay) || basePay <= 0) return badRequest("invalid_request", "base_pay must be a positive integer (KRW).");
  const cocTrigger = body?.coc_trigger === true ? 1 : 0;
  const optionalInt = (k: string): number | null | undefined => {
    const v = body?.[k];
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  };
  const cocPayout = optionalInt("coc_payout_estimate");
  if (cocPayout === undefined) return badRequest("invalid_request", "coc_payout_estimate must be an integer >= 0 (KRW).");
  if (cocTrigger === 1 && cocPayout === null) return badRequest("invalid_request", "A coc_trigger requires coc_payout_estimate — ma-04.");
  const nonCompete = optionalInt("non_compete_months");
  if (nonCompete === undefined) return badRequest("invalid_request", "non_compete_months must be an integer >= 0.");
  const retention = optionalInt("retention_plan_cost");
  if (retention === undefined) return badRequest("invalid_request", "retention_plan_cost must be an integer >= 0 (KRW).");
  const acceleratedVesting = body?.accelerated_vesting === true ? 1 : 0;
  const enforceableRaw = body?.non_compete_enforceable;
  const enforceable = enforceableRaw === undefined || enforceableRaw === null ? null : enforceableRaw === true ? 1 : 0;
  const flightRisk = typeof body?.flight_risk === "string" && body.flight_risk ? body.flight_risk : null;
  if (flightRisk !== null && !FLIGHT_RISK.has(flightRisk)) return badRequest("invalid_request", "flight_risk must be one of: low | medium | high.");
  const valueImpactRaw = body?.value_impact;
  const valueImpact = valueImpactRaw === undefined || valueImpactRaw === null || valueImpactRaw === "" ? null : Number(valueImpactRaw);
  if (valueImpact !== null && !Number.isInteger(valueImpact)) return badRequest("invalid_request", "value_impact must be an integer (KRW millions).");
  const evidenceRef = typeof body?.evidence_ref === "string" ? body.evidence_ref.trim() || null : null;

  const db = getDb();
  const now = new Date().toISOString();
  const rowId = ulid();
  db.run(
    `INSERT INTO management_package
       (id, project_id, executive_ref, role_title, base_pay, coc_trigger, coc_payout_estimate, accelerated_vesting,
        non_compete_months, non_compete_enforceable, retention_plan_cost, flight_risk, value_impact, evidence_ref)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [rowId, id, executiveRef, roleTitle, basePay, cocTrigger, cocPayout, acceleratedVesting, nonCompete, enforceable, retention, flightRisk, valueImpact, evidenceRef],
  );
  appendAudit(db, { actor: auth.auth.userId, action: "management_package.recorded", target: `${id}:${rowId}:${executiveRef}`, now });
  return ok({ id: rowId, executive_ref: executiveRef, coc_trigger: cocTrigger === 1 }, 201);
});
