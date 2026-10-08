// Shared request handling for the review routes (projects + opportunities).
// Boundary #1: every review runs with the CALLING user's permissions and is
// attributed to them (requested_by); no service account exists.
import { authenticate, requireBusinessActor, type AuthContext } from "../auth.ts";
import { badRequest, notFound, ok, forbidden } from "../envelope.ts";
import { getDb } from "../../../../db/client.ts";
import { visibleProject } from "../project-visibility.ts";
import { getReviewView, runAiFirst, runReview } from "./engine.ts";
import { gateEntityType, isReviewGate, REVIEW_GATES, type ReviewGate } from "./gate-artifacts.ts";
import type { ReviewEntityType } from "../../../../db/repositories/review.repository.ts";
import type { Ai2ndDeps } from "./ai-second.ts";
import { defaultAi2ndDeps } from "./ai-second.ts";

export type ReviewAction = "view" | "ai-1st" | "ai-2nd";

function parseGate(raw: unknown, entityType: ReviewEntityType): { gate: ReviewGate } | { response: Response } {
  const gate = typeof raw === "string" ? raw.replace(/^gate:/, "") : "";
  if (!isReviewGate(gate)) {
    return { response: badRequest("invalid_request", `gate must be one of ${REVIEW_GATES.join("|")}.`) };
  }
  if (gateEntityType(gate) !== entityType) {
    return {
      response: badRequest(
        "invalid_request",
        `gate '${gate}' belongs to the ${gateEntityType(gate)} carrier, not the ${entityType}.`,
      ),
    };
  }
  return { gate };
}

function authorize(
  request: Request,
  entityType: ReviewEntityType,
  entityId: string,
  mode: "read" | "write",
): { ctx: AuthContext } | { response: Response } {
  const auth = authenticate(request);
  if (!auth.ok) return { response: auth.response };
  const ctx = auth.auth;
  if (entityType === "project") {
    if (mode === "write" && ctx.role === "viewer")
      return { response: forbidden("role_required", "AI 검토 요청은 analyst 역할 이상이어야 합니다.") };
    if (!visibleProject(ctx, entityId, { includeClosed: true })) return { response: notFound() };
  } else {
    const denied = requireBusinessActor(ctx, mode, { viewerMessage: "AI 검토 요청은 analyst 역할 이상이어야 합니다." });
    if (denied) return { response: denied };
    if (!getDb().query("SELECT id FROM opportunity WHERE id = ?").get(entityId)) return { response: notFound() };
  }
  return { ctx };
}

export async function handleReview(
  request: Request,
  entityType: ReviewEntityType,
  entityId: string,
  action: ReviewAction,
  deps: Ai2ndDeps = defaultAi2ndDeps,
): Promise<Response> {
  const authz = authorize(request, entityType, entityId, action === "view" ? "read" : "write");
  if ("response" in authz) return authz.response;

  let rawGate: unknown;
  if (action === "view") {
    const url = new URL(request.url);
    rawGate = url.searchParams.get("gate") ?? url.searchParams.get("artifact");
  } else {
    const body = (await request.json().catch(() => null)) as { gate?: string; artifactKey?: string } | null;
    rawGate = body?.gate ?? body?.artifactKey;
  }
  const parsed = parseGate(rawGate, entityType);
  if ("response" in parsed) return parsed.response;
  const { gate } = parsed;

  if (action === "ai-1st") {
    runAiFirst({ gate, entityId, userId: authz.ctx.userId });
  } else if (action === "ai-2nd") {
    await runReview({ gate, entityId, userId: authz.ctx.userId }, deps);
  }
  return ok(getReviewView(gate, entityId));
}
