// Server-side gate ladder rule — ADR-0186 D7 / design 3.7.
//
// One rule (gateSequenceBlocker over ladderFor) applied on both gate-decision
// carriers. A GO at gate G needs an effective GO at the preceding gate of the
// track ladder; the project `fs` gate additionally needs the source
// opportunity's last ladder gate (pre_fs greenfield, target_screening
// brownfield). HOLD and KILL are never checked by the callers.
//
// "Effective" = the latest non-stale decision per gate is GO AND, for an entity_ic / group_ic GO recorded under
// the maker/checker contract, a different authorized user countersigned it (ADR-0186 D6, db/lib/gate-effective.ts;
// strict only when family maker_checker = enforce, otherwise the recorded GO counts and the would-be difference is
// audited in shadow). Legacy rows (no snapshot row, recorded before this ADR) count as effective, so
// grandfathering never breaks a chain. Stale decisions are already excluded by latestGateDecisions
// (gate_decision_stale).
import { getDb } from "../../../db/client.ts";
import { latestGateDecisions, latestRouteDecision } from "./process-flow.ts";
import { resolveTrack } from "./project-track.ts";
import { gateSequenceBlocker, ladderFor, lastOpportunityGate, projectLadderSegment, gateState, type LadderTrack } from "./gate-sequence-view.ts";

const OPPORTUNITY_GATES = new Set(["screening", "pre_fs", "target_screening"]);

function latestList(entityType: "opportunity" | "project", id: string, strict?: boolean): Array<{ gate: string; decision: string | null }> {
  return [...latestGateDecisions(entityType, id, { strict })].map(([gate, v]) => ({ gate, decision: v.decision as string | null }));
}

export interface LadderBlock {
  /** The gate whose effective GO is missing. */
  blocker: string;
  /** "opportunity" when the missing predecessor lives on the source opportunity. */
  blockerCarrier: "opportunity" | "project";
}

/** The missing predecessor GO for a GO at `gate`, or null when the gate is open. */
export function ladderBlock(entityType: "opportunity" | "project", entityId: string, gate: string, opts: { strict?: boolean } = {}): LadderBlock | null {
  if (entityType === "opportunity") {
    const track = (latestRouteDecision(entityId)?.track ?? null) as LadderTrack | null;
    const ladder = ladderFor(track).filter((g) => OPPORTUNITY_GATES.has(g));
    const blocker = gateSequenceBlocker(ladder, gate, latestList("opportunity", entityId, opts.strict));
    return blocker ? { blocker, blockerCarrier: "opportunity" } : null;
  }
  const db = getDb();
  const track = resolveTrack(entityId, db).track as LadderTrack | null;
  const own = gateSequenceBlocker(projectLadderSegment(track), gate, latestList("project", entityId, opts.strict));
  if (own) return { blocker: own, blockerCarrier: "project" };
  if (gate === "fs") {
    const src = (db.query("SELECT source_opportunity_id FROM md_project WHERE id = ?").get(entityId) as { source_opportunity_id: string | null } | null)?.source_opportunity_id;
    if (src) {
      const last = lastOpportunityGate(track);
      if (gateState(latestList("opportunity", src), last) !== "go") return { blocker: last, blockerCarrier: "opportunity" };
    }
  }
  return null;
}
