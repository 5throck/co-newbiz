// Human-final review rows (ADR-0153 §4.3). Written ONLY as a side effect of a
// human decision POST (gate decision / S12 transition decision); there is no
// route or engine path that creates one on its own. The row carries the
// human's decision word as `result` and the AI-declared items that were still
// unverified when they decided — so the audit trail shows what the human
// decided despite, not an implied approval.
//
// Failure isolation: the review runtime must never block or alter the human's
// decision, so both helpers swallow (and log) their own errors.
import { getDb } from "../../../../db/client.ts";
import { findReview, insertHumanFinal, type ReviewItem } from "../../../../db/repositories/review.repository.ts";
import { AGENT_KEYS as AGENT_IDS } from "../agent-registry.generated.ts";
import { buildGateArtifact, isReviewGate, type GateArtifact, type ReviewGate } from "./gate-artifacts.ts";

/** Capture the artifact exactly as the human saw it — call BEFORE the decision insert. */
export function captureReviewSnapshot(gate: string, entityId: string): GateArtifact | null {
  if (!isReviewGate(gate)) return null;
  try {
    return buildGateArtifact(gate as ReviewGate, entityId);
  } catch (err) {
    console.error("[review] snapshot failed; human decision proceeds without a human_final row:", err);
    return null;
  }
}

export function recordHumanFinalReview(snapshot: GateArtifact | null, userId: string, result: string): void {
  if (!snapshot) return;
  try {
    const db = getDb();
    const first = findReview(
      "ai_1st",
      snapshot.entityType,
      snapshot.entityId,
      snapshot.artifactKey,
      snapshot.contentHash,
      db,
    );
    const second = findReview(
      "ai_2nd",
      snapshot.entityType,
      snapshot.entityId,
      snapshot.artifactKey,
      snapshot.contentHash,
      db,
    );
    const unverified: ReviewItem[] = [];
    for (const row of [first, second]) {
      if (row) unverified.push(...(JSON.parse(row.unverified_items_json) as ReviewItem[]));
    }
    if (!second) {
      unverified.push({
        claim: "AI 2nd cross-domain review",
        reason: "no AI 2nd review existed for this artifact when the human decided",
      });
    }
    insertHumanFinal({
      artifactKey: snapshot.artifactKey,
      entityType: snapshot.entityType,
      entityId: snapshot.entityId,
      stageId: snapshot.stageId,
      contentHash: snapshot.contentHash,
      reviewerUser: userId,
      result,
      unverifiedItems: unverified,
      reviewedRefs: { ai_1st_id: first?.id ?? null, ai_2nd_id: second?.id ?? null, content_hash: snapshot.contentHash },
      agentIds: AGENT_IDS,
      db,
    });
  } catch (err) {
    console.error("[review] human_final write failed (decision already recorded):", err);
  }
}
