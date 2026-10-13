// @version 1.1.0
/**
 * applies_when routing resolver + evaluation — design of record
 * docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md,
 * Decision 5e (fact-based antitrust gating, reversal #6) and Decision 7
 * (applies_when reuses the predicate language). PR-5a.
 *
 * Two deliberately separate pieces, mirroring predicate.ts's purity split:
 *   - evaluateAppliesWhen  PURE — predicate + VarLookup in, decision out.
 *     Never touches the database, exactly like evaluatePredicate.
 *   - resolveRoutingVars   THE DB READER — exactly two hand-written query
 *     families (constraint: no dynamic SQL identifier interpolation anywhere,
 *     schema findings F-7/F-8). Returns a VarLookup serving ONLY the routing
 *     var_keys seeded by db/migrations/0014_routing_vars.sql and
 *     0136_greenfield_subtrack_vars.sql (four families); every other
 *     key resolves to undefined (= missing).
 *
 * FAIL-CLOSED SEMANTICS (spec constraint 2, the bug class this redesign
 * kills): a Kleene UNASSESSED result means the step APPLIES, with an
 * applied-by-default note in the record — never a silent skip on missing
 * evidence. The ONE deliberate exception direction is documented on
 * entity-establishment-execution's own predicate (an is_null guard makes
 * unassessed origin evaluate FALSE there), because firing a post-approval
 * execution procedure for an unclassified project is wrong in the other
 * direction; its companion kill criterion (origin_classification_missing_
 * at_entity_ic_exit, action: halt) catches the unclassified state, so that
 * skip is never silent either.
 *
 * NEEDS-JUDGEMENT MARKING (Decision 7, legal's comment): a skip whose
 * predicate reads project.origin AND the project is classified internal
 * carries the review model's needs-judgement vocabulary in both rendered
 * reasons — until PR-9 lands the internal-pathway content (법인설립/IP양도/
 * TUPE) the honest record is "아직 판단 안 됨", not "적용안됨". Fact-driven
 * skips (e.g. HHI on a reviewed false assertion) rest on affirmatively
 * assessed input and take no marker.
 *
 * No persistence here — callers receive decisions; PR-5c wires the
 * compliance_check 'not_applicable' writes (Decision 5d).
 */

import type { Database } from "bun:sqlite";
import { getDb } from "../client.ts";
import { evaluatePredicate, renderKo, type LabelFn, type Predicate, type VarLookup, type VarSnapshot } from "./predicate.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The outcome of one applies_when evaluation — PR-5c persists this shape. */
export interface ApplicabilityDecision {
  procedure: string;
  /** Step id, or null for a procedure-level gate (e.g. entity-establishment-execution). */
  step: number | string | null;
  applies: boolean;
  basis: "predicate-true" | "predicate-false" | "unassessed-fail-closed";
  /** renderKo output (governance artifact) — plus the applied-by-default note when basis is fail-closed. */
  rendered_reason_ko: string;
  /** English mirror of the rendered predicate (var_key + operator vocabulary). */
  rendered_reason_en: string;
  /** ISO-8601, caller-injectable for deterministic tests. */
  evaluated_at: string;
}

/** The routing var_keys seeded by db/migrations/0014_routing_vars.sql. */
export const ROUTING_VAR_KEYS = {
  caseType: "project.case_type",
  origin: "project.origin",
  technologyTrack: "project.technology_track",
  externalMarketPresence: "target.has_external_market_presence",
  /** 0136 (ADR-0160 addendum) — column var off the current route_decision. */
  subTrack: "project.sub_track",
  /** 0136 (ADR-0160 addendum) — asserted var, live AND reviewed only. */
  siteRequired: "project.site_required",
  /** 0142 (ADR-0167) — column var off md_project.establishment_mode; NULL = not chosen => missing. */
  establishmentMode: "project.establishment_mode",
} as const;

/**
 * Value project.sub_track resolves to when the current route_decision row
 * exists but carries no sub_track — the plain new-site greenfield case. A
 * decided "no sub-track" is a fact (present), not missing evidence.
 */
export const SUB_TRACK_NONE = "none";

// ---------------------------------------------------------------------------
// Routing resolver — the ONLY database touch in this module
// ---------------------------------------------------------------------------

/**
 * Family (a) — classification. The live project_case_classification row
 * (partial unique live index from migration 0013 guarantees at most one).
 * No live row => all three classification vars stay missing (UNASSESSED),
 * which evaluateAppliesThen maps fail-closed.
 */
const SQL_LIVE_CLASSIFICATION =
  "SELECT case_type, origin, technology_track FROM project_case_classification WHERE project_id = ? AND superseded_by IS NULL";

/**
 * Family (b) — asserted fact. The live AND reviewed dimension_input row for
 * the single asserted routing var (Decision 3: an assertion drives routing
 * only after cross-domain review). reviewed_by IS NULL or no live row =>
 * missing => UNASSESSED => fail-closed. The var_key is a migration-seeded
 * literal in the query text on purpose — this is a per-family hand-written
 * query, not a template; PR-6 generalizes the asserted family when the
 * scoring vars land.
 */
const SQL_LIVE_REVIEWED_FACT =
  "SELECT value_kind, value_text FROM dimension_input WHERE project_id = ? AND var_key = 'target.has_external_market_presence' AND superseded_by IS NULL AND reviewed_by IS NOT NULL";

/**
 * Family (a') — route (0136). The current route_decision row of the project's
 * source opportunity. No current row => project.sub_track stays missing
 * (UNASSESSED, fail-closed).
 */
const SQL_CURRENT_ROUTE =
  "SELECT r.sub_track FROM route_decision r JOIN md_project m ON m.source_opportunity_id = r.opportunity_id WHERE m.id = ? AND r.is_current = 1";

/** Family (b') — the live AND reviewed project.site_required assertion (0136). */
const SQL_LIVE_REVIEWED_SITE =
  "SELECT value_kind, value_text FROM dimension_input WHERE project_id = ? AND var_key = 'project.site_required' AND superseded_by IS NULL AND reviewed_by IS NOT NULL";

/** Family (a'') — establishment mode (0142). NULL column => the var stays missing (UNASSESSED). */
const SQL_ESTABLISHMENT_MODE = "SELECT establishment_mode FROM md_project WHERE id = ?";

interface ClassificationRow {
  case_type: string;
  origin: string;
  technology_track: string;
}

interface FactRow {
  value_kind: string;
  value_text: string | null;
}

/**
 * Build the routing VarLookup for one project. Static SQL, two families,
 * parameter binding only — no identifier interpolation (constraint 5).
 * The returned lookup serves ONLY the 0014-seeded routing keys; a
 * dimension_input row hijacking a project.* key is invisible here because
 * family (a) is the sole source for classification vars (asserted by test).
 */
export function resolveRoutingVars(projectId: string, db: Database = getDb()): VarLookup {
  const snapshots: Record<string, VarSnapshot> = {};

  const classification = db.query(SQL_LIVE_CLASSIFICATION).get(projectId) as ClassificationRow | undefined;
  if (classification) {
    snapshots[ROUTING_VAR_KEYS.caseType] = { status: "present", value: classification.case_type };
    snapshots[ROUTING_VAR_KEYS.origin] = { status: "present", value: classification.origin };
    snapshots[ROUTING_VAR_KEYS.technologyTrack] = { status: "present", value: classification.technology_track };
  }

  const fact = db.query(SQL_LIVE_REVIEWED_FACT).get(projectId) as FactRow | undefined;
  // value_text domain for bool rows is not CHECK-constrained by 0013 — an
  // unrecognized payload is a write defect, treated as missing (fail-closed)
  // rather than guessed.
  if (fact && fact.value_kind === "bool" && (fact.value_text === "true" || fact.value_text === "false")) {
    snapshots[ROUTING_VAR_KEYS.externalMarketPresence] = { status: "present", value: fact.value_text === "true" };
  }

  const route = db.query(SQL_CURRENT_ROUTE).get(projectId) as { sub_track: string | null } | undefined;
  if (route) {
    snapshots[ROUTING_VAR_KEYS.subTrack] = { status: "present", value: route.sub_track ?? SUB_TRACK_NONE };
  }

  const site = db.query(SQL_LIVE_REVIEWED_SITE).get(projectId) as FactRow | undefined;
  if (site && site.value_kind === "bool" && (site.value_text === "true" || site.value_text === "false")) {
    snapshots[ROUTING_VAR_KEYS.siteRequired] = { status: "present", value: site.value_text === "true" };
  }

  const mode = db.query(SQL_ESTABLISHMENT_MODE).get(projectId) as { establishment_mode: string | null } | undefined;
  if (mode?.establishment_mode) {
    snapshots[ROUTING_VAR_KEYS.establishmentMode] = { status: "present", value: mode.establishment_mode };
  }

  return (varKey: string) => snapshots[varKey];
}

// ---------------------------------------------------------------------------
// Evaluation — pure (predicate.ts discipline)
// ---------------------------------------------------------------------------

/**
 * Collect every var_key referenced by a predicate AST — the validator pass
 * (procedures/_validate.ts) uses this to check applies_when against the
 * 0014 seed list, and PR-5c will reuse it for not_applicable writes.
 */
export function collectPredicateVars(pred: Predicate, out: Set<string> = new Set()): Set<string> {
  switch (pred.op) {
    case "all_of":
    case "any_of":
    case "none_of":
    case "at_least":
      for (const child of pred.of) collectPredicateVars(child, out);
      break;
    case "cmp":
    case "in":
    case "is_null":
    case "count":
      out.add(pred.var);
      break;
  }
  return out;
}

const CMP_EN: Record<"lt" | "lte" | "gt" | "gte" | "eq" | "neq", string> = {
  lt: "<",
  lte: "<=",
  gt: ">",
  gte: ">=",
  eq: "=",
  neq: "!=",
};

function fmtScalarEn(v: number | string | boolean): string {
  return typeof v === "string" ? `'${v}'` : String(v);
}

function leafTextEn(pred: Predicate): string {
  switch (pred.op) {
    case "cmp":
      return `${pred.var} ${CMP_EN[pred.cmp]} ${fmtScalarEn(pred.value)}${pred.unit ? ` ${pred.unit}` : ""}`;
    case "in":
      return `${pred.var} in [${pred.values.map(fmtScalarEn).join(", ")}]`;
    case "is_null":
      return `${pred.var} is null`;
    case "count":
      return `count(${pred.var}) ${CMP_EN[pred.cmp]} ${pred.value}`;
  }
  throw new Error(`leafTextEn: non-leaf op ${(pred as { op: string }).op}`);
}

function compositeHeaderEn(pred: Predicate & { op: "all_of" | "any_of" | "none_of" | "at_least" }): string {
  switch (pred.op) {
    case "all_of":
      return "all of:";
    case "any_of":
      return "any of:";
    case "none_of":
      return "none of:";
    case "at_least":
      return `at least ${pred.k} of:`;
  }
}

function renderLinesEn(pred: Predicate, depth: number, out: string[]): void {
  const indent = "  ".repeat(depth);
  if (pred.op === "all_of" || pred.op === "any_of" || pred.op === "none_of" || pred.op === "at_least") {
    out.push(`${indent}${compositeHeaderEn(pred)}`);
    for (const child of pred.of) renderLinesEn(child, depth + 1, out);
    return;
  }
  out.push(`${indent}- ${leafTextEn(pred)}`);
}

/**
 * English mirror of renderKo. The registry has label_ko only (row data for
 * the Korean governance artifact), so the English rendering uses the
 * var_key itself as the subject — an identifier, not a translation.
 */
export function renderEn(pred: Predicate): string {
  const out: string[] = [];
  renderLinesEn(pred, 0, out);
  return out.join("\n");
}

/** Fail-closed note appended to BOTH language renderings (spec constraint 2). */
const NOTE_KO = "(기본 적용 — 라우팅 변수 미평가)";
const NOTE_EN = "(applied-by-default — routing var unassessed)";

/**
 * Needs-judgement note (Decision 7, legal's comment) appended to BOTH
 * renderings of an origin-driven skip on an internal-origin project. The
 * review model's third vocabulary slot — until PR-9 fills the internal
 * pathway, "not yet judged" is the honest record, not "not applicable".
 */
const NEEDS_JUDGEMENT_KO =
  "(needs-judgement: 아직 판단 안 됨 — 내부기원 스킵은 PR-9가 전용 경로 내용을 채우기 전까지 '적용안됨'이 아니다)";
const NEEDS_JUDGEMENT_EN =
  "(needs-judgement: not yet judged — an internal-origin skip is not 'not applicable' until PR-9 lands the internal-pathway content)";

/**
 * Map the Kleene result to an applicability decision:
 *   TRUE       -> applies (basis predicate-true)
 *   FALSE      -> skip, reason = rendered predicate (basis predicate-false);
 *                 an origin-driven skip on an internal-origin project also
 *                 carries the needs-judgement note (Decision 7)
 *   UNASSESSED -> APPLIES with the applied-by-default note (basis
 *                 unassessed-fail-closed) — the constraint-2 rule; a silent
 *                 skip on missing evidence is the bug class this exists to kill.
 */
export function evaluateAppliesWhen(
  ctx: { procedure: string; step?: number | string | null },
  predicate: Predicate,
  lookup: VarLookup,
  opts: { labels?: LabelFn; now?: Date } = {}
): ApplicabilityDecision {
  const labels: LabelFn = opts.labels ?? ((varKey: string) => ({ label: varKey }));
  const ko = renderKo(predicate, labels);
  const en = renderEn(predicate);
  const evaluatedAt = (opts.now ?? new Date()).toISOString();
  const base = { procedure: ctx.procedure, step: ctx.step ?? null, evaluated_at: evaluatedAt };

  switch (evaluatePredicate(predicate, lookup)) {
    case "true":
      return { ...base, applies: true, basis: "predicate-true", rendered_reason_ko: ko, rendered_reason_en: en };
    case "false": {
      // Decision 7: an origin-driven skip on an INTERNAL-origin project is
      // marked needs-judgement. Detection is deterministic and narrow — the
      // predicate must actually read project.origin (a fact-driven skip on
      // the same project takes no marker) and the resolved value must be the
      // classified internal label.
      const originSnapshot = lookup(ROUTING_VAR_KEYS.origin);
      const internalOriginSkip =
        collectPredicateVars(predicate).has(ROUTING_VAR_KEYS.origin) &&
        originSnapshot?.status === "present" &&
        originSnapshot.value === "internal";
      return {
        ...base,
        applies: false,
        basis: "predicate-false",
        rendered_reason_ko: internalOriginSkip ? `${ko}\n${NEEDS_JUDGEMENT_KO}` : ko,
        rendered_reason_en: internalOriginSkip ? `${en}\n${NEEDS_JUDGEMENT_EN}` : en,
      };
    }
    case "unassessed":
      return {
        ...base,
        applies: true,
        basis: "unassessed-fail-closed",
        rendered_reason_ko: `${ko}\n${NOTE_KO}`,
        rendered_reason_en: `${en}\n${NOTE_EN}`,
      };
  }
}
