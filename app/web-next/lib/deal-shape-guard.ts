// Write guard for the opportunity-scope deal-shape evaluation (owner decision 2026-11-08: the screen moved from S4 to S7;
// design 2026-11-08-deal-shape-to-s7-design section 5). The evaluation is brownfield-only and is recorded once the S7 target
// screening is open, so a write is refused (409 deal_shape_not_open) while the opportunity has not reached S7, or when its
// CURRENT route decision (is_current = 1, ADR-0135) is not brownfield. Reads stay open: the viable count is what kill
// criterion #9 evaluates at target_screening and a recorded history must stay visible.
//
// This is the single enforcement point for every write path: the web panel and the MCP record_deal_shape_evaluation tool
// both reach the REST route (ADR-0011), and only the route calls the repository.
import { getCurrentRouteDecision } from "../../../db/repositories/route-decision.repository.ts";
import { evaluateProcess, type ProcessEvaluation } from "./process-flow.ts";

/** The one error code the REST route and the UI contract use; `details.reason` carries which rule refused the write. */
export const DEAL_SHAPE_NOT_OPEN = "deal_shape_not_open";
export type DealShapeNotOpenReason = "track_not_brownfield" | "stage_not_reached";

/**
 * The process-engine reader the stage rule uses. Exported as a mutable object ONLY as a test seam: reaching S7 needs S1-S6 complete
 * (a full seeded chain), so REST tests that exercise the write path itself stub it, while the guard's own tests use the real engine.
 */
export const dealShapeGuardDeps: {
  evaluate: (entity: { type: "opportunity"; id: string }) => Pick<ProcessEvaluation, "terminated" | "stages">;
} = {
  evaluate: (entity) => evaluateProcess(entity),
};

export interface DealShapeGuardRefusal {
  reason: DealShapeNotOpenReason;
  message: string;
}

/** null = the write is allowed. Track first (a greenfield opportunity can never record, whatever its stage), then stage. */
export function dealShapeWriteGuard(opportunityId: string): DealShapeGuardRefusal | null {
  const current = getCurrentRouteDecision(opportunityId);
  if (current && current.track !== "brownfield") {
    return {
      reason: "track_not_brownfield",
      message:
        "A deal-shape evaluation is recorded only for a brownfield opportunity; this opportunity's current route decision is greenfield.",
    };
  }
  const evaluation = dealShapeGuardDeps.evaluate({ type: "opportunity", id: opportunityId });
  // A killed process reads every stage `terminated`: the stage cannot be told apart, so the track rule above is the only guard there.
  if (evaluation.terminated) return null;
  const s7 = evaluation.stages.find((s) => s.id === "S7");
  if (!s7 || (s7.status !== "current" && s7.status !== "complete")) {
    return {
      reason: "stage_not_reached",
      message:
        "A deal-shape evaluation is recorded at S7 target screening: the opportunity has not reached S7 yet (it needs a brownfield route decision and a completed S6 Long List).",
    };
  }
  return null;
}
