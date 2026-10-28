// Pre-IC permit / incentive capture (ADR-0187 D4, finding H11, migration 0182).
// GET — the project's pre-IC captures (stage_captured S5 | S8) and whether the
// latest S11 execution baseline already links each one. POST — capture one
// candidate: {kind: "permit" | "incentive", stage: "S8" | "S5", ...}. Permits
// and certifications stay separate (boundary 5): certifications keep their own
// register (/permits kind=certification). analyst+, need-to-know
// (visibleProject + MNPI insider check), person-attributed and audited
// (permit.pre_ic_captured / incentive.pre_ic_captured). Greenfield only (the
// S11 execution-baseline scope); an incentive candidate requires type and clawback_rule (no defaults).
import { getDb } from "../../../../../../../db/client.ts";
import { requireInsiderIfMnpi } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { latestExecutionBaseline, EMPTY_ENTRIES } from "../../../../../lib/greenfield-execution.ts";
import {
  captureFailure,
  captureIncentiveCandidate,
  capturePermitCandidate,
  listPreIcCaptures,
  preIcLinkStatus,
} from "../../../../../lib/pre-ic-capture.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true })) return notFound();
  const db = getDb();
  try {
    requireInsiderIfMnpi(db, id, auth.auth.userId);
  } catch (e) {
    return forbidden("insider_required", (e as Error).message);
  }
  const captures = listPreIcCaptures(id, db);
  const links = preIcLinkStatus(id, latestExecutionBaseline(id, db)?.entries ?? EMPTY_ENTRIES, db);
  return ok({ ...captures, s11_links: links }, 200, { permits: captures.permits.length, incentives: captures.incentives.length, unlinked: links.unlinked });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Capturing pre-IC permits/incentives requires the analyst role or higher." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const db = getDb();
  try {
    requireInsiderIfMnpi(db, id, auth.auth.userId);
  } catch (e) {
    return forbidden("insider_required", (e as Error).message);
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return badRequest("invalid_request", "A JSON body is required.");
  const actor = auth.auth.userId;
  const r =
    body.kind === "permit"
      ? capturePermitCandidate({ projectId: id, stage: body.stage, name: body.name, agency: body.agency, statutory_days: body.statutory_days, actor }, db)
      : body.kind === "incentive"
        ? captureIncentiveCandidate(
            {
              projectId: id, stage: body.stage, program_name: body.program_name, type: body.type, grantor: body.grantor,
              npv_value: body.npv_value, clawback_rule: body.clawback_rule, application_deadline: body.application_deadline,
              construction_deadline: body.construction_deadline, evidence_ref: body.evidence_ref, actor,
            },
            db,
          )
        : null;
  if (!r) return badRequest("kind_required", "kind must be permit or incentive (certifications are registered separately, boundary 5).");
  if (!r.ok) return captureFailure(r);
  return ok({ id: r.id, kind: body.kind }, 201);
}
