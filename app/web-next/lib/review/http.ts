// Shared request handling for the review routes (projects + opportunities).
// Boundary #1: every review runs with the CALLING user's permissions and is
// attributed to them (requested_by); no service account exists.
import { authenticate, requireBusinessActor, type AuthContext } from "../auth.ts";
import { badRequest, notFound, ok, forbidden } from "../envelope.ts";
import { getDb } from "../../../../db/client.ts";
import { visibleProject } from "../project-visibility.ts";
import { getArtifactReviewView, resolveArtifact, runAiFirst, runReview } from "./engine.ts";
import {
  buildGateArtifact,
  gateEntityType,
  gateStageIds,
  isReviewGate,
  REVIEW_GATES,
  type ReviewGate,
} from "./gate-artifacts.ts";
import { buildStageArtifact, parseStageArtifactKey, stageArtifactDef, type ReviewArtifact } from "./stage-artifacts.ts";
import type { StageId } from "../process-flow.ts";
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
    return {
      response: badRequest("invalid_request", `gate must be one of ${REVIEW_GATES.join("|")} or a stage:S#:N key.`),
    };
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

/**
 * Optional carrier stage of a gate-level request (the stage screen asking for
 * the gate review, e.g. the S3 screen asking for `screening`). It scopes the
 * stages AFTER the carrier out of the review (buildGateArtifact). Stage
 * artifacts already cover a single stage, so it only applies to gate targets.
 */
function parseCarrierStage(raw: unknown, gate: ReviewGate): { stage?: StageId } | { response: Response } {
  if (raw === undefined || raw === null || raw === "") return {};
  const m = typeof raw === "string" ? /^S([1-9]|1[0-2])$/.exec(raw) : null;
  if (!m || !gateStageIds(gate).includes(raw as StageId)) {
    return {
      response: badRequest(
        "invalid_request",
        `carrierStage must be one of the stages feeding the '${gate}' gate (${gateStageIds(gate).join("|")}).`,
      ),
    };
  }
  return { stage: raw as StageId };
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
    const denied = requireBusinessActor(ctx, mode, {
      viewerMessage: "AI review requests requires the analyst role or higher.",
    });
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
  let rawCarrier: unknown;
  let locale: string | undefined;
  if (action === "view") {
    const url = new URL(request.url);
    rawTarget = url.searchParams.get("gate") ?? url.searchParams.get("artifact");
    rawCarrier = url.searchParams.get("carrier_stage");
  } else {
    const body = (await request.json().catch(() => null)) as {
      gate?: string;
      artifactKey?: string;
      artifact?: string;
      carrierStage?: unknown;
      locale?: unknown;
    } | null;
    rawTarget = body?.gate ?? body?.artifact ?? body?.artifactKey;
    rawCarrier = body?.carrierStage;
    // Advisory only: a malformed locale never 4xx's — it is ignored and the
    // prompt stays English (stored claim/reason text is the audit record).
    if (typeof body?.locale === "string" && /^[a-z]{2}(-[A-Z]{2})?$/.test(body.locale)) {
      locale = body.locale;
    }
  }
  const parsed = parseTarget(rawTarget, entityType);
  if ("response" in parsed) return parsed.response;

  let artifact: ReviewArtifact | undefined;
  if ("gate" in parsed) {
    const carrier = parseCarrierStage(rawCarrier, parsed.gate);
    if ("response" in carrier) return carrier.response;
    // A stage carrier scopes later stages out; no carrier = full gate span.
    if (carrier.stage) artifact = buildGateArtifact(parsed.gate, entityId, { carrierStage: carrier.stage });
  } else {
    artifact = buildStageArtifactFromKey(parsed.artifactKey, entityId);
  }
  const target =
    "gate" in parsed && !artifact
      ? { gate: parsed.gate, entityId, userId: authz.ctx.userId, locale }
      : { artifact, entityId, userId: authz.ctx.userId, locale };

  if (action === "ai-1st") {
    runAiFirst(target);
  } else if (action === "ai-2nd") {
    await runReview(target, deps);
  }
  return ok(getArtifactReviewView(resolveArtifact(target)));
}
