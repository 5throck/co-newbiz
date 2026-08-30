// Route decision on the opportunity path — S4 before a project exists
// (route_decision.project_id stays NULL until promote).
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { listRouteDecisions, recordRouteDecision } from "../../../../../lib/route-decision.ts";

const TRACKS = new Set(["greenfield", "brownfield"]);
const SUB_TRACKS = new Set(["existing_business_rbd", "intra_venture"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const exists = getDb().query("SELECT id FROM opportunity WHERE id = ?").get(id);
  if (!exists) return notFound();
  return ok(listRouteDecisions({ opportunityId: id }), 200, { count: 0 });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Route decisions are recorded by analysts.");
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    track?: string; sub_track?: string; rationale?: string;
    alternatives_considered?: string; decision_factors?: Record<string, unknown>;
  } | null;
  if (!body?.track || !TRACKS.has(body.track) || !body?.rationale?.trim()) {
    return badRequest("invalid_request", "track (greenfield|brownfield) and rationale are required.");
  }
  if (body.sub_track && !SUB_TRACKS.has(body.sub_track)) {
    return badRequest("invalid_request", "sub_track must be existing_business_rbd | intra_venture (greenfield only).");
  }
  if (body.sub_track && body.track !== "greenfield") {
    return badRequest("invalid_request", "sub_track applies only to the greenfield track.");
  }
  const exists = getDb().query("SELECT id FROM opportunity WHERE id = ?").get(id);
  if (!exists) return notFound();
  const row = recordRouteDecision({
    opportunityId: id,
    projectId: null,
    track: body.track as "greenfield" | "brownfield",
    subTrack: (body.sub_track ?? null) as "existing_business_rbd" | "intra_venture" | null,
    rationale: body.rationale.trim(),
    alternativesConsidered: body.alternatives_considered ?? null,
    decisionFactors: body.decision_factors ?? null,
    actor: ctx.userId,
  });
  return ok(row, 201);
}
