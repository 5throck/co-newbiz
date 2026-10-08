// AI 1st stage — deterministic, NO LLM (ADR-0153 §4.3). Re-uses the process
// engine's completion predicates (lib/process-flow) over the gate artifact and
// sorts the outcome into the three buckets:
//   verified          — the stage's completion predicate is satisfied
//   could_not_verify  — missing / incomplete / locked structure (structural),
//                       plus a standing note that content accuracy was not
//                       examined, so this list is never empty
//   needs_judgement   — substance of completed artifacts and the gate verdict
// It never produces a pass/score and never touches a decision table.
import type { ReviewBuckets, ReviewItem } from "../../../../db/repositories/review.repository.ts";
import type { ReviewArtifact } from "./stage-artifacts.ts";

export function runAiFirstChecks(artifact: ReviewArtifact): ReviewBuckets {
  const verified: ReviewItem[] = [];
  const could: ReviewItem[] = [];
  const judge: ReviewItem[] = [];

  for (const s of artifact.stages) {
    const ref = `stage:${s.id}`;
    if (s.status === "complete") {
      verified.push({
        claim: `Stage ${s.id} (${s.name}) completion predicate is satisfied`,
        reason:
          "Deterministic check of the stage completion predicate (lib/process-flow); it proves the records exist, not that they are right.",
        evidence_ref: ref,
      });
      if (s.required_artifacts.length > 0) {
        judge.push({
          claim: `Substance of ${s.id} artifacts: ${s.required_artifacts.join("; ")}`,
          reason: "Existence is checked deterministically; adequacy of the content needs reviewer judgement.",
          evidence_ref: ref,
        });
      }
    } else if (s.status === "skipped") {
      verified.push({
        claim: `Stage ${s.id} (${s.name}) does not apply to this track`,
        reason: "Track applicability from process/flow.spec.yaml.",
        evidence_ref: ref,
      });
    } else if (s.status === "terminated") {
      could.push({
        claim: `Stage ${s.id} (${s.name}) was not evaluated`,
        reason: "The entity was terminated by a recorded KILL.",
        evidence_ref: ref,
        structural: true,
      });
    } else if (s.status === "current") {
      const missing = s.missing_artifacts.length > 0 ? ` Missing: ${s.missing_artifacts.join("; ")}.` : "";
      could.push({
        claim: `Stage ${s.id} (${s.name}) is incomplete`,
        reason: `${s.blockers.join(" / ") || "Completion predicate not satisfied."}${missing}`,
        evidence_ref: ref,
        structural: true,
      });
    } else {
      could.push({
        claim: `Stage ${s.id} (${s.name}) is locked behind an incomplete predecessor`,
        reason: "Sequential entry criteria are not met, so its artifacts were not checked.",
        evidence_ref: ref,
        structural: true,
      });
    }
  }

  judge.push({
    claim:
      "gate" in artifact
        ? `The ${artifact.gate} gate verdict (go / hold / kill)`
        : `The acceptance of stage ${artifact.stageId} artifact "${artifact.artifactName}"`,
    reason: "Gate approval and the investment decision belong to humans; this review only reports evidence and gaps.",
  });
  could.push({
    claim: "Accuracy, sourcing and internal consistency of artifact content",
    reason: "AI 1st is a structural completeness check; it did not read or validate the content of any record.",
  });

  return { verified, could_not_verify: could, needs_judgement: judge };
}

export const hasStructuralGaps = (b: ReviewBuckets): boolean => b.could_not_verify.some((i) => i.structural === true);
