// GO-side integrity checks shared by both gate-decision routes (ADR-0186 P1).
// Families: ladder (D7) and rationale (D2). HOLD and KILL never reach here.
// Each check runs through applyFamily so off / shadow / enforce behave the
// same on the opportunity and project carriers.
import { getDb } from "../../../db/client.ts";
import { applyFamily, type IntegrityContext, type IntegrityFailure } from "./gate-integrity.ts";
import { ladderBlock } from "./gate-ladder.ts";
import { IC_STEP_LABEL } from "./gate-sequence-view.ts";
import { parseRationale } from "./ic-gap-override.ts";
import { validateRationale, type RationaleProfile } from "./rationale-check.ts";

function ladderFailure(ctx: IntegrityContext): IntegrityFailure | null {
  const block = ladderBlock(ctx.entityType, ctx.entityId, ctx.gate);
  if (!block) return null;
  const label = IC_STEP_LABEL[block.blocker as keyof typeof IC_STEP_LABEL] ?? block.blocker;
  return {
    status: 409,
    code: "ladder_prerequisite_missing",
    message: `GO is not allowed - an effective GO at the ${label} (${block.blocker}) gate must precede the ${ctx.gate} decision. HOLD or KILL can be recorded at any time.`,
    details: { blocker: block.blocker, carrier: block.blockerCarrier },
  };
}

/** Rationales recorded on OTHER gates of the same entity (human part only), for the duplicate rule. */
function otherGateRationales(ctx: IntegrityContext): string[] {
  const rows = getDb()
    .query("SELECT rationale FROM gate_decision WHERE entity_type = ? AND entity_id = ? AND gate != ?")
    .all(ctx.entityType, ctx.entityId, ctx.gate) as Array<{ rationale: string }>;
  return rows.map((r) => parseRationale(r.rationale).rationale);
}

function rationaleFailure(ctx: IntegrityContext, field: string, text: string, profile: RationaleProfile, withDuplicates: boolean): IntegrityFailure | null {
  const result = validateRationale(text, profile, withDuplicates ? { otherRationales: otherGateRationales(ctx) } : {});
  if (result.ok) return null;
  return {
    status: 422,
    code: "rationale_insufficient",
    message: `The ${field} does not meet the minimum substance profile (${result.reason}); write the actual reasoning in your own words.`,
    details: { field, reason: result.reason, profile },
  };
}

export function goLadderCheck(ctx: IntegrityContext): Response | null {
  return applyFamily("ladder", ctx, () => ladderFailure(ctx));
}

/** Decision rationale (decision profile, with the cross-gate duplicate rule) and, when present, the gap rationale. */
export function goRationaleCheck(ctx: IntegrityContext, rationale: string, gapRationale?: string | null): Response | null {
  return (
    applyFamily("rationale", ctx, () => rationaleFailure(ctx, "rationale", rationale, "decision", true)) ??
    (gapRationale ? applyFamily("rationale", ctx, () => rationaleFailure(ctx, "gap_rationale", gapRationale, "decision", false)) : null)
  );
}
