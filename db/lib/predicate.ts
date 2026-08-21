// @version 1.0.0
/**
 * Typed JSON predicate AST — Kleene 3-valued evaluation, zod validation, and
 * Korean governance rendering. ADR-0046 §1-§2 (docs/adr/
 * 0046-typed-json-predicate-ast-and-evidence-variable-registry.md),
 * design 결정 1 (docs/designs/2026-08-22-rag-formalization-and-case-
 * classification-design.md §3).
 *
 * PR-1 scope: the EVALUATION INTERFACE only. This module never reads the
 * database — variable values arrive via the `VarLookup` resolver, whose
 * PR-2 implementation will be backed by the `project_variable_snapshot`
 * table. Keeping the engine pure is what makes the per-operator truth-table
 * matrix in tests/unit/predicate.test.ts an acceptance condition rather
 * than incidental coverage (ADR-0046 §2, final paragraph).
 *
 * The Kleene truth tables in ADR-0046 §2 are NORMATIVE — every row asserted
 * there has a verbatim test. The two failure directions are both wrong:
 * permissive reproduces the false-pass this work stream exists to prevent;
 * conservative makes every rule UNASSESSED forever and kills the feature.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Scalar = number | string | boolean;

/** ADR-0046 §2 — the three-valued evaluation result. */
export type TriState = "true" | "false" | "unassessed";

/**
 * ADR-0046 §1 / design 결정 1 — the AST, verbatim. The same grammar serves
 * `rag_rule.condition_expr`, `applies_when`, and the kill-criteria registry.
 */
export type Predicate =
  | { op: "all_of" | "any_of" | "none_of"; of: Predicate[] }
  | { op: "at_least"; k: number; of: Predicate[] }
  | { op: "cmp"; var: string; cmp: "lt" | "lte" | "gt" | "gte" | "eq" | "neq"; value: Scalar; unit?: string }
  | { op: "in"; var: string; values: Scalar[] }
  | { op: "is_null"; var: string }
  | { op: "count"; var: string; cmp: "lt" | "lte" | "gt" | "gte" | "eq"; value: number };

/**
 * One variable's resolved state for a single (run, project) — the in-code
 * mirror of the `project_variable_snapshot` table landing in PR-2
 * (ADR-0046 §5). `status` is the three-way fact the ADR insists on keeping
 * distinct: `missing` and `stale` answer different governance questions.
 * `value` is only meaningful when `status === "present"`.
 */
export interface VarSnapshot {
  status: "present" | "missing" | "stale";
  value?: Scalar;
}

/**
 * Resolver contract. Returning `undefined` means "no snapshot row for this
 * variable", treated as `status: "missing"` — a variable that never
 * resolved is missing, which is a different fact from stale.
 */
export type VarLookup = (varKey: string) => VarSnapshot | undefined;

// ---------------------------------------------------------------------------
// IEEE-754 quantization (parity with financialBand)
// ---------------------------------------------------------------------------

/**
 * Quantize a number to 1e-6 before comparison. This is the same guard
 * `financialBand` (db/lib/rag-engine.ts) applies to the IRR margin:
 * (0.12 - 0.10) * 100 === 1.9999999999999836 in IEEE-754, so a rule saying
 * "IRR margin >= 2pp" must NOT fail on a mathematically-exactly-2pp input.
 * Both sides of every numeric comparison (cmp, in-membership, count) pass
 * through here so a predicate rule and financialBand render the same
 * verdict on the same numbers — that parity is asserted in the unit tests.
 * Strings and booleans use strict equality; no quantization applies.
 */
const QUANT = 1e6;
export function quantize(v: number): number {
  return Math.round(v * QUANT) / QUANT;
}

/** Type-aware scalar equality: quantized for numbers, strict otherwise. */
function scalarEquals(a: Scalar, b: Scalar): boolean {
  if (typeof a === "number" && typeof b === "number") return quantize(a) === quantize(b);
  return a === b;
}

const NUM_CMP: Record<"lt" | "lte" | "gt" | "gte" | "eq" | "neq", (a: number, b: number) => boolean> = {
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
};

// ---------------------------------------------------------------------------
// Evaluation — Kleene 3-valued (ADR-0046 §2 truth tables are normative)
// ---------------------------------------------------------------------------

function kleeneAnd(a: TriState, b: TriState): TriState {
  return a === "true" && b === "true"
    ? "true"
    : a === "false" || b === "false"
      ? "false" // FALSE dominates conjunction
      : "unassessed"; // at least one unassessed, none false
}

function kleeneOr(a: TriState, b: TriState): TriState {
  return (a === "true" || b === "true") ? "true" // TRUE dominates disjunction
    : (a === "false" && b === "false") ? "false"
    : "unassessed";
}

/**
 * Evaluate a predicate against a snapshot resolver. Composite operators
 * follow the Kleene tables; leaf operators return UNASSESSED unless their
 * variable's snapshot `status === "present"`. `is_null` is the ONE
 * exception (ADR-0046 §2): it is evaluated against `status` itself — it is
 * the operator deliberately written against absent values.
 *
 * Degenerate cases (defensive — PredicateSchema rejects empty `of` arrays
 * at write time, so these arise only from hand-built in-memory trees):
 *   all_of([])    = TRUE   (vacuous conjunction, standard Kleene)
 *   any_of([])    = FALSE  (vacuous disjunction)
 *   none_of([])   = TRUE   (= NOT any_of([]) = NOT FALSE)
 *   at_least(k<=0, …) = TRUE (threshold trivially met)
 */
export function evaluatePredicate(pred: Predicate, lookup: VarLookup): TriState {
  switch (pred.op) {
    case "all_of":
      // FALSE dominates; else any UNASSESSED is decisive (ADR rows 5-6).
      return pred.of.map((c) => evaluatePredicate(c, lookup)).reduce(kleeneAnd, "true" as TriState);
    case "any_of":
      // TRUE dominates (ADR row 1); else any UNASSESSED is decisive (row 2).
      return pred.of.map((c) => evaluatePredicate(c, lookup)).reduce(kleeneOr, "false" as TriState);
    case "none_of": {
      // Symmetric to all_of under negation (ADR rows 7-8): one TRUE child
      // forces FALSE; with no TRUE child an UNASSESSED child is decisive.
      // The negation scope is the WHOLE list, never each item.
      let result: TriState = "true";
      for (const child of pred.of) {
        const v = evaluatePredicate(child, lookup);
        if (v === "true") return "false";
        if (v === "unassessed") result = "unassessed";
      }
      return result;
    }
    case "at_least": {
      // Count trues (t) and unassesseds (u) over the children:
      //   t >= k        -> TRUE   (threshold met without missing values — ADR row 3)
      //   t + u < k     -> FALSE  (even if every unassessed became true, k is unreachable)
      //   otherwise     -> UNASSESSED (the missing values are decisive — ADR row 4)
      if (pred.k <= 0) return "true";
      let t = 0;
      let u = 0;
      for (const child of pred.of) {
        const v = evaluatePredicate(child, lookup);
        if (v === "true") t++;
        else if (v === "unassessed") u++;
      }
      if (t >= pred.k) return "true";
      if (t + u < pred.k) return "false";
      return "unassessed";
    }
    case "cmp":
      return evalCmp(pred, lookup);
    case "in":
      return evalIn(pred, lookup);
    case "is_null":
      return evalIsNull(pred, lookup);
    case "count":
      return evalCount(pred, lookup);
  }
}

function snapshotOf(varKey: string, lookup: VarLookup): VarSnapshot {
  // Resolver returning undefined = no snapshot row = missing (see VarLookup).
  return lookup(varKey) ?? { status: "missing" };
}

function evalCmp(pred: Predicate & { op: "cmp" }, lookup: VarLookup): TriState {
  const snap = snapshotOf(pred.var, lookup);
  if (snap.status !== "present") return "unassessed";
  if (snap.value === undefined || snap.value === null) return "unassessed"; // present-but-empty payload: not comparable
  // A type-mismatched rule (e.g. value: 2 against a string payload) is a
  // rule-authoring defect, not a runtime crash — UNASSESSED surfaces it.
  if (typeof snap.value !== typeof pred.value) return "unassessed";
  if (typeof snap.value === "number" && typeof pred.value === "number") {
    return NUM_CMP[pred.cmp](quantize(snap.value), quantize(pred.value)) ? "true" : "false";
  }
  // String/boolean scalars: strict equality semantics only (no quantization,
  // no coercion). Ordering comparators (lt/gt/…) are not defined for
  // non-numeric scalars — UNASSESSED flags the defect rather than silently
  // running a meaningless JS relational compare on strings.
  if (pred.cmp === "eq") return snap.value === pred.value ? "true" : "false";
  if (pred.cmp === "neq") return snap.value !== pred.value ? "true" : "false";
  return "unassessed";
}

function evalIn(pred: Predicate & { op: "in" }, lookup: VarLookup): TriState {
  const snap = snapshotOf(pred.var, lookup);
  if (snap.status !== "present") return "unassessed";
  if (snap.value === undefined || snap.value === null) return "unassessed";
  // If no candidate shares the payload's type, the rule cannot meaningfully
  // apply to this variable (same authoring defect as cmp type mismatch).
  if (!pred.values.some((v) => typeof v === typeof snap.value)) return "unassessed";
  return pred.values.some((v) => scalarEquals(v, snap.value as Scalar)) ? "true" : "false";
}

/**
 * ADR-0046 §2: is_null "is evaluated against `status`, not against a NULL
 * payload" — TRUE for missing/stale (the variable is effectively absent),
 * FALSE for present, regardless of payload. A `present` snapshot with an
 * absent payload is a PR-2 loader defect; is_null does not paper over it
 * (every other operator returns UNASSESSED on it, so no rule can be
 * satisfied and the defect surfaces instead of silently passing).
 */
function evalIsNull(pred: Predicate & { op: "is_null" }, lookup: VarLookup): TriState {
  const snap = snapshotOf(pred.var, lookup);
  return snap.status === "present" ? "false" : "true";
}

function evalCount(pred: Predicate & { op: "count" }, lookup: VarLookup): TriState {
  const snap = snapshotOf(pred.var, lookup);
  if (snap.status !== "present") return "unassessed";
  if (typeof snap.value !== "number") return "unassessed"; // count expects a number payload
  return NUM_CMP[pred.cmp](quantize(snap.value), quantize(pred.value)) ? "true" : "false";
}

// ---------------------------------------------------------------------------
// zod validation — the single gate every rule / applies_when / kill-criterion
// passes through (ADR-0046 Consequences; zod promoted to a direct dependency)
// ---------------------------------------------------------------------------

const ScalarSchema = z.union([z.number(), z.string(), z.boolean()]);

/**
 * Validates the Predicate AST. Strict objects (unknown keys rejected) so a
 * smuggled field cannot ride through storage into evaluation. Note the
 * schema REJECTS empty `of` arrays and empty `in.values` — the evaluator's
 * degenerate empty-list handling is defensive only, never an authoring path.
 */
export const PredicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.strictObject({ op: z.literal("all_of"), of: z.array(PredicateSchema).min(1) }),
    z.strictObject({ op: z.literal("any_of"), of: z.array(PredicateSchema).min(1) }),
    z.strictObject({ op: z.literal("none_of"), of: z.array(PredicateSchema).min(1) }),
    z.strictObject({
      op: z.literal("at_least"),
      k: z.number().int().min(0), // negative k is meaningless; 0 is the degenerate-TRUE threshold
      of: z.array(PredicateSchema).min(1),
    }),
    z.strictObject({
      op: z.literal("cmp"),
      var: z.string().min(1),
      cmp: z.enum(["lt", "lte", "gt", "gte", "eq", "neq"]),
      value: ScalarSchema,
      unit: z.string().min(1).optional(),
    }),
    z.strictObject({ op: z.literal("in"), var: z.string().min(1), values: z.array(ScalarSchema).min(1) }),
    z.strictObject({ op: z.literal("is_null"), var: z.string().min(1) }),
    z.strictObject({
      op: z.literal("count"),
      var: z.string().min(1),
      cmp: z.enum(["lt", "lte", "gt", "gte", "eq"]),
      value: z.number(),
    }),
  ]),
);

/**
 * Parse + validate an untrusted input (e.g. `rag_rule.condition_expr` JSON)
 * into a Predicate. Throws a descriptive error listing every issue path —
 * rule authoring feedback, not a raw zod stack.
 */
export function parsePredicate(input: unknown): Predicate {
  const result = PredicateSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid predicate AST: ${issues}`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Korean governance rendering (renderKo) — ADR-0046 Consequences: this is a
// GOVERNANCE DELIVERABLE, the sentence a human reviewer signs against.
// ---------------------------------------------------------------------------

/** Registry-facing label + unit for a var_key (PR-2: evidence_var table). */
export interface VarLabel {
  label: string;
  unit?: string;
}
export type LabelFn = (varKey: string) => VarLabel;

/**
 * True when the word's final character is a Hangul syllable carrying a
 * final jamo (받침): syllables U+AC00..U+D7A3 decompose as
 * (code - 0xAC00) = 21*28*initial + 28*medial + final, so
 * (code - 0xAC00) % 28 > 0 detects a final consonant. Non-Hangul-final
 * words (numerals, Latin) return false and take the vowel variant — a
 * documented approximation of the reading-based standard rule.
 */
export function hasBatchim(word: string): boolean {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 > 0;
}

/**
 * Korean particle (조사) chosen by the presence of a final jamo on the
 * preceding word: 받침 있음 -> 이/은/을/과, 받침 없음 -> 가/는/를/와.
 * Correct selection here is a requirement, not polish (design 결정 1,
 * schema finding F-17b) — the rendered sentence is signed by a human.
 */
export function particle(subject: string, kind: "iGa" | "eunNeun" | "eulReul" | "waGwa"): string {
  const b = hasBatchim(subject);
  switch (kind) {
    case "iGa":
      return b ? "이" : "가";
    case "eunNeun":
      return b ? "은" : "는";
    case "eulReul":
      return b ? "을" : "를";
    case "waGwa":
      return b ? "과" : "와";
  }
}

const CMP_KO: Record<"lt" | "lte" | "gt" | "gte" | "eq" | "neq", string> = {
  lt: "미만",
  lte: "이하",
  gt: "초과",
  gte: "이상",
  eq: "같음",
  neq: "같지 않음",
};

function fmtScalar(v: Scalar): string {
  if (typeof v === "boolean") return v ? "참" : "거짓";
  return String(v);
}

function unitSuffix(pred: { unit?: string }, labels: LabelFn, varKey: string): string {
  // A rule-authored unit on the AST node wins over the registry label's —
  // the rule text must match what the reviewer reads in the rule document.
  return pred.unit ?? labels(varKey).unit ?? "";
}

function leafText(pred: Predicate, labels: LabelFn): string {
  switch (pred.op) {
    case "cmp": {
      const { label } = labels(pred.var);
      const unit = unitSuffix(pred, labels, pred.var);
      // Inequality words follow the value ("시장 성장률 10% 이상") — the
      // natural Korean order a reviewer reads; equality uses the 와/과
      // particle on the value ("시장 성장률이 10%와 같음").
      if (pred.cmp === "eq" || pred.cmp === "neq") {
        return `${label}${particle(label, "iGa")} ${fmtScalar(pred.value)}${unit}${particle(`${fmtScalar(pred.value)}${unit}`, "waGwa")} ${CMP_KO[pred.cmp]}`;
      }
      return `${label} ${fmtScalar(pred.value)}${unit} ${CMP_KO[pred.cmp]}`;
    }
    case "in": {
      const { label } = labels(pred.var);
      return `${label}${particle(label, "iGa")} ${pred.values.map(fmtScalar).join(", ")} 중 하나`;
    }
    case "is_null": {
      const { label } = labels(pred.var);
      return `${label}값 없음`;
    }
    case "count": {
      const { label } = labels(pred.var);
      const subject = `${label} 개수`;
      return `${subject}${particle(subject, "iGa")} ${fmtScalar(pred.value)} ${CMP_KO[pred.cmp]}`;
    }
  }
  // Unreachable when called from renderLines (composites take the header
  // branch) — the guard keeps leafText total for direct callers.
  throw new Error(`leafText: non-leaf op ${(pred as { op: string }).op}`);
}

function compositeHeader(pred: Predicate & { op: "all_of" | "any_of" | "none_of" | "at_least" }): string {
  switch (pred.op) {
    case "all_of":
      return "다음을 모두 충족";
    case "any_of":
      return "다음 중 하나 이상 충족";
    case "none_of":
      // "다음 중 어느 것도" — the negation scope is the WHOLE list
      // ("none of the following"), not each item individually.
      return "다음 중 어느 것도 해당하지 않음";
    case "at_least":
      return `다음 중 ${pred.k}개 이상 충족`;
  }
}

function renderLines(pred: Predicate, labels: LabelFn, depth: number, out: string[]): void {
  const indent = "  ".repeat(depth);
  if (pred.op === "all_of" || pred.op === "any_of" || pred.op === "none_of" || pred.op === "at_least") {
    out.push(`${indent}${compositeHeader(pred)}:`);
    for (const child of pred.of) renderLines(child, labels, depth + 1, out);
    return;
  }
  out.push(`${indent}· ${leafText(pred, labels)}`);
}

/**
 * Render a predicate as the Korean sentence a human reviewer signs against
 * (governance artifact — readability over brevity). Composite operators
 * render as a header line plus indented "· " sub-lists; nesting depth is
 * preserved so every branch is visible — no branch is silently folded away.
 */
export function renderKo(pred: Predicate, labels: LabelFn): string {
  const out: string[] = [];
  renderLines(pred, labels, 0, out);
  return out.join("\n");
}
