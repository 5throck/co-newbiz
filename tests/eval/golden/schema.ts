/**
 * Golden dataset schema — single source for the file format of
 * tests/eval/golden/cases/*.yaml and fixtures/*.input.json.
 * Design of record: docs/designs/2026-10-08-wave-b-ai-eval-design.md §3.
 */
import { z } from "zod";

export const Grade = z.enum(["green", "amber", "red", "not_graded"]);
export const Stage = z.enum(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12"]);
export const Gate = z.enum(["screening", "pre_fs", "fs", "dd", "entity_ic", "group_ic"]);

/** Citation to an exact section heading of a pilot doc (heading text without the leading #'s). */
export const Citation = z.object({
  doc: z.string().regex(/^docs\/pilots\/pilot-0\d\d-[a-z0-9-]+\.md$/),
  section: z.string().min(1),
});

/**
 * Which facts the expectation is evaluated against.
 * - pre_decision: inputs_ref only (leakage-linted; eligible for outcome calibration).
 * - post_decision: post_decision_inputs_ref (may contain the regulator's decision; never used for calibration).
 */
export const InputBasis = z.enum(["pre_decision", "post_decision"]);

const base = {
  stage: Stage,
  gate: Gate,
  input_basis: InputBasis.default("pre_decision"),
  citation: z.array(Citation).min(1),
  note: z.string().optional(),
};

const AntitrustFlags = z.object({
  ...base,
  function: z.literal("antitrust_flags"),
  expected: z
    .object({
      filing_required: z.boolean().optional(),
      jurisdictions: z.array(z.string()).optional(),
      multi_jurisdiction: z.boolean().optional(),
      combination_type: z.enum(["horizontal", "vertical", "conglomerate", "common_control"]).optional(),
      product_overlap: z.boolean().optional(),
      hhi_flag: z.enum(["high", "moderate", "low", "none"]).optional(),
      certain_block: z.boolean().optional(),
      relevant_markets: z.array(z.string()).optional(),
    })
    .strict(),
});

const RagDimensions = z.object({
  ...base,
  function: z.literal("rag_dimensions"),
  tolerance: z.enum(["exact", "one_grade"]).default("exact"),
  expected: z
    .object({
      financial: Grade,
      market: Grade,
      data_confidence: Grade,
      regulatory_permit: Grade,
      technical_execution: Grade,
      risk: Grade,
    })
    .partial()
    .strict()
    .refine((o) => Object.keys(o).length > 0, "at least one dimension"),
});

const RagOverall = z.object({
  ...base,
  function: z.literal("rag_overall"),
  expected: z.object({ overall: Grade, complete: z.boolean() }).strict(),
});

const KillCriteria = z.object({
  ...base,
  function: z.literal("kill_criteria"),
  expected: z
    .object({
      hits: z.array(z.string()),
      /** Conditions the facts cannot evaluate; the system must not report them as "not hit". */
      not_evaluable: z.array(z.string()).optional(),
    })
    .strict(),
});

const ConfidenceCap = z.object({
  ...base,
  function: z.literal("confidence_cap"),
  expected: z
    .object({ cap_applies: z.boolean(), data_confidence: Grade })
    .strict(),
});

const DdTailoring = z.object({
  ...base,
  function: z.literal("dd_tailoring"),
  expected: z
    .object({
      checklist: z.string(),
      required_items: z.array(z.string().regex(/^(ma|rbd)-\d\d$/)).min(1),
      /** Items the tailorer may drop, but only with a stated reason. */
      droppable_with_reason: z.array(z.string().regex(/^(ma|rbd)-\d\d$/)).optional(),
    })
    .strict(),
});

const ReviewFindings = z.object({
  ...base,
  function: z.literal("review_findings"),
  expected: z
    .object({
      must_raise: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(1),
      must_declare_could_not_verify: z.boolean().default(true),
    })
    .strict(),
});

export const Expectation = z.discriminatedUnion("function", [
  AntitrustFlags,
  RagDimensions,
  RagOverall,
  KillCriteria,
  ConfidenceCap,
  DdTailoring,
  ReviewFindings,
]);

export const PublicOutcome = z
  .object({
    kind: z.enum(["conditional_approval", "prohibition", "closed", "suspended"]),
    authority: z.string().optional(),
    decision_date: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
    known: z.literal(true),
    /** Design §7: favourable = closed or approved (incl. conditional); unfavourable = prohibited, abandoned, suspended. */
    favourable: z.boolean(),
    citation: z.array(Citation).min(1),
  })
  .strict();

export const GoldenCase = z
  .object({
    case_id: z.string().regex(/^pilot-0\d\d$/),
    golden_version: z.string().regex(/^\d+\.\d+\.\d+$/),
    source_doc: z.string(),
    deal_type: z.enum(["brownfield", "greenfield", "intra_group_restructuring", "group_capital_allocation"]),
    case_subtype: z.enum(["rbd"]).optional(),
    /** Present only for the outcome-labelled set (design §3.3). Absent = excluded from outcome calibration. */
    public_outcome: PublicOutcome.optional(),
    decision_date: z.string().optional(),
    inputs_ref: z.string().regex(/^fixtures\/pilot-0\d\d\.input\.json$/),
    post_decision_inputs_ref: z.string().regex(/^fixtures\/pilot-0\d\d\.post-decision\.json$/).optional(),
    expectations: z.array(Expectation).min(1),
  })
  .strict()
  .superRefine((c, ctx) => {
    c.expectations.forEach((e, i) => {
      if (e.input_basis === "post_decision" && !c.post_decision_inputs_ref) {
        ctx.addIssue({ code: "custom", path: ["expectations", i], message: "post_decision expectation needs post_decision_inputs_ref" });
      }
    });
  });

/** Pre-decision fixture: facts dated before the decision only. */
export const InputFixture = z
  .object({
    case_id: z.string(),
    as_of: z.string(),
    facts: z.record(z.string(), z.unknown()),
    sources: z.array(Citation).min(1),
  })
  .strict();

/**
 * Leakage lint (design §9): none of these may appear (case-insensitive, word-prefix match)
 * anywhere in a pre-decision fixture. Post-decision fixtures are exempt.
 */
export const LEAKAGE_KEYWORDS = [
  "approv", "prohibit", "block", "clear", "suspend", "closed", "closing",
  "complet", "divest", "remed", "condition", "withdr", "terminat", "abandon", "reject",
] as const;

export function findLeakage(json: unknown): string[] {
  const text = JSON.stringify(json).toLowerCase();
  return LEAKAGE_KEYWORDS.filter((k) => new RegExp(`\\b${k}`).test(text));
}

export type GoldenCase = z.infer<typeof GoldenCase>;
export type Expectation = z.infer<typeof Expectation>;
