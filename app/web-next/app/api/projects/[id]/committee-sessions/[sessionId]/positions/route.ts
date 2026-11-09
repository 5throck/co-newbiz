// Human-member position submission for a project-scoped committee session
// (ADR-0196 Phase E). The submitter's app_user id comes from the
// authenticated session — never from the body.
import { committeeSessionForProject } from "../../../../../../../lib/committee-session.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { CommitteeError, submitHumanPosition } from "../../../../../../../lib/committee-session.ts";

const RECOMMENDATIONS = new Set(["go", "hold", "kill"]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  {
    const denied = requireBusinessActor(ctx, "write", {
      viewerMessage: "Committee position submission requires the analyst role or higher.",
    });
    if (denied) return denied;
  }
  const { id, sessionId } = await params;
  const db = getDb();
  if (!committeeSessionForProject(id, sessionId)) return notFound();
  if (!visibleProject(ctx, id, { includeClosed: true })) return notFound();
  const body = (await request.json().catch(() => null)) as {
    seat?: string;
    positionMd?: string;
    confidence?: number;
    recommendation?: string;
    vetoDissent?: boolean;
    criteriaScores?: Record<string, number>;
  } | null;
  const positionMd = body?.positionMd?.trim();
  if (!positionMd) return badRequest("invalid_request", "positionMd (position statement) is required.");
  if (body?.recommendation !== undefined && !RECOMMENDATIONS.has(body.recommendation)) {
    return badRequest("invalid_request", "recommendation must be one of: go | hold | kill.");
  }
  const confidence = body?.confidence;
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 100)) {
    return badRequest("invalid_request", "confidence must be a number between 0 and 100.");
  }
  // ADR-0104 quantitative scorecard — optional, but when present all five
  // criteria must be integers 1-3 (partial scorecards break the aggregate).
  const CRITERIA = [
    "control_need",
    "capability_criticality",
    "market_uncertainty",
    "integration_capacity",
    "speed_to_capability",
  ] as const;
  let criteriaScores: Record<string, number> | undefined;
  if (body?.criteriaScores !== undefined) {
    const raw = body.criteriaScores;
    if (typeof raw !== "object" || raw === null) {
      return badRequest("invalid_request", "criteriaScores must be an object over the 5 criteria.");
    }
    const missing = CRITERIA.filter((c) => !(c in raw));
    if (missing.length) {
      return badRequest("invalid_request", `criteriaScores requires all 5 criteria — missing: ${missing.join(", ")}`);
    }
    criteriaScores = {};
    for (const c of CRITERIA) {
      const v = Number((raw as Record<string, unknown>)[c]);
      if (!Number.isInteger(v) || v < 1 || v > 3) {
        return badRequest("invalid_request", `${c} score must be an integer between 1 and 3.`);
      }
      criteriaScores[c] = v;
    }
  }
  try {
    const result = submitHumanPosition({
      sessionId,
      humanUserId: ctx.userId, // from the session — never the request body
      seat: body?.seat?.trim() || undefined,
      positionMd,
      confidence,
      recommendation: body?.recommendation as "go" | "hold" | "kill" | undefined,
      vetoDissent: body?.vetoDissent === true,
      criteriaScores,
    });
    appendAudit(db, {
      actor: ctx.userId,
      action: "committee_position.submit",
      target: `${sessionId}:${result.positionId}`,
      now: new Date().toISOString(),
    });
    return ok(result, 201);
  } catch (err) {
    if (err instanceof CommitteeError) {
      if (err.code === "not_found") return notFound();
      // Speaking as another member's seat is a forbidden identity claim; a
      // repeat position in the same round is a conflict, not a bad request.
      if (err.code === "seat_not_assignable") return forbidden(err.code, err.message);
      if (err.code === "duplicate_position") return fail(409, err.code, err.message);
      return badRequest(err.code, err.message);
    }
    return badRequest("submit_failed", err instanceof Error ? err.message : String(err));
  }
}
