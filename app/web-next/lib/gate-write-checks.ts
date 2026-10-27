// GO-side integrity checks shared by both gate-decision routes (ADR-0186 P1).
// Families: ladder (D7) and rationale (D2). HOLD and KILL never reach here.
// Each check runs through applyFamily so off / shadow / enforce behave the
// same on the opportunity and project carriers.
import { getDb } from "../../../db/client.ts";
import { evaluateValidatorCompleteness } from "../../../db/lib/validator-completeness.ts";
import { resolveTrack } from "./project-track.ts";
import { applyFamily, recordWouldBlock, type IntegrityContext, type IntegrityFailure } from "./gate-integrity.ts";
import { gateIntegrityMode } from "./gate-integrity-flags.ts";
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
  const denied = applyFamily("ladder", ctx, () => ladderFailure(ctx));
  // ADR-0186 D6, family `maker_checker` in shadow: the recorded-but-uncountersigned predecessor counts as GO today;
  // audit the would-block (de-duplicated per entity, gate, code, day) so the flip to enforce is informed.
  if (!denied && ctx.entityType === "project" && gateIntegrityMode("maker_checker") === "shadow" && gateIntegrityMode("ladder") !== "off") {
    if (ladderBlock(ctx.entityType, ctx.entityId, ctx.gate, { strict: true })) recordWouldBlock(getDb(), ctx, "countersign_pending");
  }
  return denied;
}

/** Decision rationale (decision profile, with the cross-gate duplicate rule) and, when present, the gap rationale. */
export function goRationaleCheck(ctx: IntegrityContext, rationale: string, gapRationale?: string | null): Response | null {
  return (
    applyFamily("rationale", ctx, () => rationaleFailure(ctx, "rationale", rationale, "decision", true)) ??
    (gapRationale ? applyFamily("rationale", ctx, () => rationaleFailure(ctx, "gap_rationale", gapRationale, "decision", false)) : null)
  );
}

/**
 * ADR-0186 D4 (family `validators`): the brownfield dd / entity_ic / group_ic GO needs every applicable core validator
 * recorded (neb-policy 2.3, no waiver path). Run BEFORE the stage-prerequisite gaps so the specific code
 * (409 validators_incomplete) is the answer: with bf-01 derived, an incomplete validator set also keeps S9 incomplete,
 * and the generic gap list would otherwise mask the reason. The decision write re-checks it inside its transaction.
 */
export function goValidatorsCheck(ctx: IntegrityContext): Response | null {
  if (ctx.entityType !== "project" || !VALIDATOR_GO_GATES.has(ctx.gate)) return null;
  return applyFamily("validators", ctx, () => {
    const db = getDb();
    if (resolveTrack(ctx.entityId, db).track !== "brownfield") return null;
    const missing = [...evaluateValidatorCompleteness(ctx.entityId, null, db).halt.missing].sort() as string[];
    if (missing.length === 0) return null;
    return {
      status: 409,
      code: "validators_incomplete",
      message: `GO is not allowed - the required M&A validator(s) ${missing.join(", ")} are not recorded (neb-policy 2.3; no waiver path). HOLD or KILL can be recorded at any time.`,
      details: { missing },
    };
  });
}
const VALIDATOR_GO_GATES: ReadonlySet<string> = new Set(["dd", "entity_ic", "group_ic"]);
