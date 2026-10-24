// Shared request handling for the review routes (projects + opportunities).
// Boundary #1: every review runs with the CALLING user's permissions and is
// attributed to them (requested_by); no service account exists.
import { authenticate, requireBusinessActor, type AuthContext } from "../auth.ts";
import { badRequest, notFound, ok, forbidden } from "../envelope.ts";
import { getDb } from "../../../../db/client.ts";
import { visibleProject } from "../project-visibility.ts";
import { getArtifactReviewView, resolveArtifact, runAiFirst, runReview } from "./engine.ts";
import { gateEntityType, isReviewGate, REVIEW_GATES, type ReviewGate } from "./gate-artifacts.ts";
import { buildStageArtifact, parseStageArtifactKey, stageArtifactDef } from "./stage-artifacts.ts";
import type { ReviewEntityType } from "../../../../db/repositories/review.repository.ts";
import type { Ai2ndDeps } from "./ai-second.ts";
import { defaultAi2ndDeps } from "./ai-second.ts";

export type ReviewAction = "view" | "ai-1st" | "ai-2nd";

type ParsedTarget = { gate: ReviewGate } | { artifactKey: string } | { response: Response };

function parseTarget(raw: unknown, entityType: ReviewEntityType): ParsedTarget {
  // Stage-artifact keys (stage:S#:N, rollout F-3/F-4) are matched against the
  // registry and its carrier — a project route cannot review an S1 artifact.
  if (typeof raw === "string" && raw.startsWith("stage:")) {
    const parsed = parseStageArtifactKey(raw);
    const def = parsed ? stageArtifactDef(parsed.stageId, parsed.index) : null;
    if (!def) {
      return { response: badRequest("invalid_request", `unknown stage artifact key '${raw}'.`) };
    }
    if (def.entityType !== entityType) {
      return {
        response: badRequest(
          "invalid_request",
          `artifact '${raw}' belongs to the ${def.entityType} carrier, not the ${entityType}.`,
        ),
      };
    }
    return { artifactKey: raw };
  }
  const gate = typeof raw === "string" ? raw.replace(/^gate:/, "") : "";
  if (!isReviewGate(gate)) {
    return { response: badRequest("invalid_request", `gate must be one of ${REVIEW_GATES.join("|")} or a stage:S#:N key.`) };
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
      return { response: forbidden("role_required", "AI review requests require the analyst role or higher.") };
    if (!visibleProject(ctx, entityId, { includeClosed: true })) return { response: notFound() };
  } else {
    const denied = requireBusinessActor(ctx, mode, { viewerMessage: "AI review requests requires the analyst role or higher." });
    if (denied) return { response: denied };
    if (!getDb().query("SELECT id FROM opportunity WHERE id = ?").get(entityId)) return { response: notFound() };
  }
  return { ctx };
}

function buildStageArtifactFromKey(key: string, entityId: string) {
  const parsed = parseStageArtifactKey(key)!;
  return buildStageArtifact(parsed.stageId, parsed.index, entityId);
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

  let rawTarget: unknown;
  if (action === "view") {
    const url = new URL(request.url);
    rawTarget = url.searchParams.get("gate") ?? url.searchParams.get("artifact");
  } else {
    const body = (await request.json().catch(() => null)) as { gate?: string; artifactKey?: string; artifact?: string } | null;
    rawTarget = body?.gate ?? body?.artifact ?? body?.artifactKey;
  }
  const parsed = parseTarget(rawTarget, entityType);
  if ("response" in parsed) return parsed.response;

  const artifact = "gate" in parsed ? undefined : buildStageArtifactFromKey(parsed.artifactKey, entityId);
  const target = "gate" in parsed ? { gate: parsed.gate, entityId, userId: authz.ctx.userId } : { artifact, entityId, userId: authz.ctx.userId };

  if (action === "ai-1st") {
    runAiFirst(target);
  } else if (action === "ai-2nd") {
    await runReview(target, deps);
  }
  return ok(getArtifactReviewView(resolveArtifact(target)));
}
