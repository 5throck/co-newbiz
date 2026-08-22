// @version 1.1.0
/**
 * Six-validator applicability registry — DATA, not code branches (PR-5c
 * spec constraint 7; design of record Decisions 5d/5g, ADR-0048 §1).
 *
 * One row per Brown Field DD validator (brownfield-dd steps 6-11), carrying
 * a typed `applies_when` predicate over the PR-5a routing vars
 * (project.case_type / project.origin / project.technology_track — the
 * 0014-seeded keys). The registry is the single source of truth for which
 * validators a classification makes applicable; the completeness engine
 * (db/lib/validator-completeness.ts) reads it, the not_applicable writer
 * (db/repositories/compliance.repository.ts) reads it, and NOTHING branches
 * on classification values in code.
 *
 * STAGE 2 FORM (PR-5c spec §5 two-stage discipline — the ACTIVE form): the
 * four skip-capable rows carry their real classification-conditional
 * predicates (ADR-0048 seed set), written as NEGATED skip conditions:
 *   antitrust            skip only greenfield+internal (no market combination)
 *   hr-comp / customer /
 *   incentive            skip only greenfield+internal (no acquired workforce/
 *                        customers/contracts)
 *   contingent-liability skip only greenfield+internal+track=none (an R&BD
 *                        track keeps in-bound license / Partner-IP exposure)
 *   certification        applies in EVERY cell (k=0 stays — something must
 *                        always be sellable/permittable; PR-10 kept
 *                        certification last for a reason)
 * The typical M&A cell (brownfield + external + any track) is ALL SIX —
 * the ADR-0037 default that must survive every edge case. (Stage 1 shipped
 * every row unconditional — the pure ADR-0037 behavior — so a reviewer
 * bisecting the PR never lands on a half-wired registry.)
 *
 * FAIL-CLOSED NOTE: the stage-2 predicates are written as negated skip
 * conditions (none_of [all_of [...]]) precisely so that UNASSESSED or
 * corrupt classification values evaluate to applies=true (Kleene: unassessed
 * child -> unassessed none_of -> evaluateAppliesWhen fail-closed APPLIES;
 * unknown enum value -> false leaf -> none_of TRUE -> APPLIES). A skip
 * always rests on affirmatively assessed routing values.
 *
 * rationale is English by design: the Korean sentence a human signs is
 * renderKo(applies_when) (the sanctioned governance artifact, PR-5a);
 * this text is the registry-author's justification riding alongside it.
 */

import { evaluateAppliesWhen, type ApplicabilityDecision } from "./applies-when.ts";
import type { LabelFn, Predicate, VarLookup } from "./predicate.ts";

/** The six no-waiver M&A validators (brownfield-dd steps 6-11, in fixed order). */
export type MaValidatorKey =
  | "antitrust"
  | "hr-comp"
  | "customer"
  | "incentive"
  | "contingent-liability"
  | "certification";

/** One registry row — the applicability of one validator, as data. */
export interface MaValidatorApplicability {
  key: MaValidatorKey;
  procedure: "shared-brownfield-dd";
  /** The brownfield-dd step that runs this validator (content untouched, PR-5c constraint 8). */
  step: 6 | 7 | 8 | 9 | 10 | 11;
  /** Typed predicate over the 0014-seeded routing vars; evaluated via PR-5a's engine. */
  applies_when: Predicate;
  /** English justification, carried into the rendered skip sentence (renderKo supplies the Korean). */
  rationale: string;
}

/**
 * The unconditional predicate encoding: `at_least 0 of` a routing leaf
 * evaluates TRUE for every input — including unassessed and corrupt values
 * — which is "applicable under every classification". Used by certification
 * permanently (it applies in EVERY cell — something must always be
 * sellable/permittable; PR-10 kept certification last for a reason).
 */
function unconditional(): Predicate {
  return {
    op: "at_least",
    k: 0,
    of: [{ op: "in", var: "project.case_type", values: ["greenfield", "brownfield"] }],
  };
}

/**
 * The negated-skip-condition form (the fail-closed encoding): `none_of
 * [all_of [conditions]]` means "skip only when EVERY condition is
 * affirmatively assessed true". Unassessed routing values -> UNASSESSED ->
 * evaluateAppliesWhen maps fail-closed to APPLIES; an unknown enum value ->
 * FALSE leaf -> none_of TRUE -> APPLIES. A skip always rests on affirmatively
 * assessed classification values, never on absence or corruption.
 */
function skipOnly(...conditions: Predicate[]): Predicate {
  return { op: "none_of", of: [{ op: "all_of", of: conditions }] };
}

const GREENFIELD = (): Predicate => ({ op: "cmp", var: "project.case_type", cmp: "eq", value: "greenfield" });
const INTERNAL = (): Predicate => ({ op: "cmp", var: "project.origin", cmp: "eq", value: "internal" });
const TRACK_NONE = (): Predicate => ({ op: "cmp", var: "project.technology_track", cmp: "eq", value: "none" });

export const MA_VALIDATOR_APPLICABILITY: readonly MaValidatorApplicability[] = [
  {
    key: "antitrust",
    procedure: "shared-brownfield-dd",
    step: 6,
    applies_when: skipOnly(GREENFIELD(), INTERNAL()),
    rationale:
      "Applies unless case_type=greenfield AND origin=internal — a pure internal venture has no market-combination exposure (ADR-0048 seed set). Note: the PR-5a fact var (target.has_external_market_presence) still gates the SCREENING HHI pre-screen independently; this row is the DD validator.",
  },
  {
    key: "hr-comp",
    procedure: "shared-brownfield-dd",
    step: 7,
    applies_when: skipOnly(GREENFIELD(), INTERNAL()),
    rationale:
      "Brownfield always; greenfield external/hybrid/joint apply; greenfield internal skips — no acquired workforce means no CoC-trigger compensation or harmonization exposure (ADR-0048 seed set).",
  },
  {
    key: "customer",
    procedure: "shared-brownfield-dd",
    step: 8,
    applies_when: skipOnly(GREENFIELD(), INTERNAL()),
    rationale:
      "Brownfield always; greenfield external/hybrid/joint apply; greenfield internal skips — no acquired customer or supplier contracts means no change-of-control clause surface (ADR-0048 seed set).",
  },
  {
    key: "incentive",
    procedure: "shared-brownfield-dd",
    step: 9,
    applies_when: skipOnly(GREENFIELD(), INTERNAL()),
    rationale:
      "Brownfield always; greenfield external/hybrid/joint apply; greenfield internal skips — no acquired incentive arrangements means no clawback exposure on relocation/restructuring (ADR-0048 seed set).",
  },
  {
    key: "contingent-liability",
    procedure: "shared-brownfield-dd",
    step: 10,
    applies_when: skipOnly(GREENFIELD(), INTERNAL(), TRACK_NONE()),
    rationale:
      "Brownfield always; greenfield external/hybrid/joint apply; greenfield internal skips EXCEPT technology_track=rbd — in-bound license and Partner-IP encumbrances keep the validator applicable (ADR-0048 seed set).",
  },
  {
    key: "certification",
    procedure: "shared-brownfield-dd",
    step: 11,
    applies_when: unconditional(),
    rationale:
      "Applies in EVERY cell — something must always be sellable/permittable; PR-10 kept certification LAST among the validators for a reason (a non-transferable certification strips the acquisition premium). No skip condition exists by design (ADR-0048 seed set).",
  },
];

/** The rule_key convention for the six validators' compliance_check rows. */
export function maValidatorRuleKey(key: MaValidatorKey): string {
  return `ma-validator-${key}`;
}

/**
 * Evaluate every registry row against one project's routing lookup — pure
 * (the caller supplies the VarLookup, exactly like evaluateAppliesWhen).
 * Returns decisions keyed by validator, in fixed registry order elsewhere.
 */
export function resolveValidatorApplicability(
  lookup: VarLookup,
  opts: { labels?: LabelFn; now?: Date } = {}
): Map<MaValidatorKey, ApplicabilityDecision> {
  const out = new Map<MaValidatorKey, ApplicabilityDecision>();
  for (const row of MA_VALIDATOR_APPLICABILITY) {
    out.set(
      row.key,
      evaluateAppliesWhen({ procedure: row.procedure, step: row.step }, row.applies_when, lookup, opts),
    );
  }
  return out;
}
