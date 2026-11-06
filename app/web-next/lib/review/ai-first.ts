// AI 1st stage — deterministic, NO LLM (ADR-0153 §4.3). Re-uses the process
// engine's completion predicates (lib/process-flow) over the gate artifact and
// sorts the outcome into the three buckets:
//   verified          — the stage's completion predicate is satisfied
//   could_not_verify  — missing / incomplete / locked structure (structural),
//                       (stages the entity has not reached yet are listed too,
//                       as non-structural scope:"not_reached" items),
//                       plus a standing note that content accuracy was not
//                       examined, so this list is never empty
//   needs_judgement   — substance of completed artifacts and the gate verdict
// It never produces a pass/score and never touches a decision table.
// Every item also carries a locale `key` (+ params) from the review-item key
// catalog (review-item-keys.ts); the English claim/reason stay canonical for
// audit and MCP (Fix 3, design 2026-11-06 PR3).
import type { ReviewBuckets, ReviewItem } from "../../../../db/repositories/review.repository.ts";
import type { ReviewArtifact } from "./stage-artifacts.ts";
import { cleanList, joinBlockers } from "./review-display.ts";
import { REVIEW_ITEM_KEYS } from "./review-item-keys.ts";

export function runAiFirstChecks(artifact: ReviewArtifact): ReviewBuckets {
  const verified: ReviewItem[] = [];
  const could: ReviewItem[] = [];
  const judge: ReviewItem[] = [];

  for (const s of artifact.stages) {
    const ref = `stage:${s.id}`;
    const stageParams = { stageId: s.id, stageName: s.name };
    if (s.status === "complete") {
      verified.push({
        claim: `Stage ${s.id} (${s.name}) completion predicate is satisfied`,
        reason:
          "Deterministic check of the stage completion predicate (lib/process-flow); it proves the records exist, not that they are right.",
        evidence_ref: ref,
        key: REVIEW_ITEM_KEYS.ai1StageComplete,
        params: stageParams,
      });
      if (s.required_artifacts.length > 0) {
        judge.push({
          claim: `Substance of ${s.id} artifacts: ${s.required_artifacts.join("; ")}`,
          reason: "Existence is checked deterministically; adequacy of the content needs reviewer judgement.",
          evidence_ref: ref,
          key: REVIEW_ITEM_KEYS.ai1StageSubstance,
          params: { ...stageParams, artifacts: s.required_artifacts.join("; ") },
        });
      }
    } else if (s.status === "skipped") {
      verified.push({
        claim: `Stage ${s.id} (${s.name}) does not apply to this track`,
        reason: "Track applicability from process/flow.spec.yaml.",
        evidence_ref: ref,
        key: REVIEW_ITEM_KEYS.ai1StageSkipped,
        params: stageParams,
      });
    } else if (s.status === "terminated") {
      could.push({
        claim: `Stage ${s.id} (${s.name}) was not evaluated`,
        reason: "The entity was terminated by a recorded KILL.",
        evidence_ref: ref,
        structural: true,
        key: REVIEW_ITEM_KEYS.ai1StageTerminated,
        params: stageParams,
      });
    } else if (s.status === "current") {
      const missingNames = cleanList(s.missing_artifacts);
      const missing = missingNames.length > 0 ? ` Missing: ${missingNames.join("; ")}.` : "";
      could.push({
        claim: `Stage ${s.id} (${s.name}) is incomplete`,
        reason: `${joinBlockers(s.blockers) || "Completion predicate not satisfied."}${missing}`,
        evidence_ref: ref,
        structural: true,
        key: REVIEW_ITEM_KEYS.ai1StageIncomplete,
        params: {
          ...stageParams,
          blockers: joinBlockers(s.blockers) || "Completion predicate not satisfied.",
          missing: missingNames.join("; "),
        },
      });
    } else if (s.not_reached) {
      // Informational: the entity has not reached this stage yet. Declared (the
      // reviewer must still see what was not checked) but not a defect, so it
      // is non-structural and never blocks AI 2nd.
      could.push({
        claim: `Stage ${s.id} (${s.name}) has not been reached yet`,
        reason: "The entity is still at an earlier stage, so this stage's artifacts were not checked.",
        evidence_ref: ref,
        structural: false,
        scope: "not_reached",
        key: REVIEW_ITEM_KEYS.ai1StageNotReached,
        params: stageParams,
      });
    } else {
      could.push({
        claim: `Stage ${s.id} (${s.name}) is locked behind an incomplete predecessor`,
        reason: "Sequential entry criteria are not met, so its artifacts were not checked.",
        evidence_ref: ref,
        structural: true,
        key: REVIEW_ITEM_KEYS.ai1StageLocked,
        params: stageParams,
      });
    }
  }

  judge.push(
    "gate" in artifact
      ? {
          claim: `The ${artifact.gate} gate verdict (go / hold / kill)`,
          reason:
            "Gate approval and the investment decision belong to humans; this review only reports evidence and gaps.",
          key: REVIEW_ITEM_KEYS.ai1GateVerdict,
          params: { gate: artifact.gate },
        }
      : {
          claim: `The acceptance of stage ${artifact.stageId} artifact "${artifact.artifactName}"`,
          reason:
            "Gate approval and the investment decision belong to humans; this review only reports evidence and gaps.",
          key: REVIEW_ITEM_KEYS.ai1StageAcceptance,
          params: { stageId: artifact.stageId, artifactName: artifact.artifactName },
        },
  );
  could.push({
    claim: "Accuracy, sourcing and internal consistency of artifact content",
    reason: "AI 1st is a structural completeness check; it did not read or validate the content of any record.",
    key: REVIEW_ITEM_KEYS.ai1ContentAccuracy,
  });

  return { verified, could_not_verify: could, needs_judgement: judge };
}

export const hasStructuralGaps = (b: ReviewBuckets): boolean => b.could_not_verify.some((i) => i.structural === true);
