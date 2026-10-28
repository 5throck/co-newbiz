#!/usr/bin/env bun
// @version 2.0.0
/**
 * Process SSOT validators (ADR-0187 phase P1, design
 * docs/designs/2026-10-27-process-ssot-decision-evidence-design.md section 4.6).
 *
 * One script, eight named checks (the design names one file per validator;
 * they share every loader, so they live together and keep the design names as
 * check ids):
 *
 *   check-engine-spec-parity      H8    engine missing-artifact labels <-> flow.spec requiredArtifacts
 *   check-checklist-consumers     H9    every checklist with mandatory items has a producer step and a gate consumer
 *   activity-agent-in-procedure   M2    flow.spec activity.agent holds >=1 agent_key step in each listed procedure
 *   check-kill-registry-parity    M4    neb-policy section 4 keys / registry keys / flow.spec killCriteriaRegistry
 *   check-stage-inputs            M9    S3-S12 inputs declare the S2 entry market
 *   check-review-coverage         M7/M8 stage outputs in the review registry; author-domain pairs resolved by a matrix
 *   check-s12-coverage            M17   each classification cell matches >=1 S12 activity
 *   check-stages-derived          M3    process/stages.yaml equals the gate-order projection of flow.spec
 *
 * Mode (since 2.0.0, ADR-0187 phase P2): the checks in BLOCKING_CHECKS print
 * as ERROR and exit 1 - each reached zero findings, or every remaining pair is
 * an explicit allowlist entry below with its ADR / reason. The two checks the
 * design closes later stay report-only (WARN, exit 0): check-engine-spec-parity
 * (exact-string parity until P3 stable blocker keys) and check-review-coverage
 * (the cross-validation matrix is P4). `--strict` additionally exits 1 on a WARN
 * finding. `--check <id>` runs one check; `--json` prints the machine-readable
 * report.
 *
 * Every check is a pure function over plain inputs (tests/unit/
 * process-ssot-check.test.ts feeds failing and clean fixtures); `runAll()`
 * reads the real tree. No engine behavior, no database.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load as yamlLoad } from "js-yaml";
import { evaluatePredicate, type Predicate, type VarSnapshot } from "../../packages/core-scoring/src/predicate.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── Shared types ─────────────────────────────────────────────────────────────

export const CHECK_IDS = [
  "check-engine-spec-parity",
  "check-checklist-consumers",
  "activity-agent-in-procedure",
  "check-kill-registry-parity",
  "check-stage-inputs",
  "check-review-coverage",
  "check-s12-coverage",
  "check-stages-derived",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

/**
 * Checks that fail the audit (P2). The other two stay WARN by design section 5:
 * engine-spec parity closes with P3 stable keys, review coverage with the P4
 * matrix.
 */
export const BLOCKING_CHECKS: ReadonlySet<CheckId> = new Set<CheckId>([
  "check-checklist-consumers",
  "activity-agent-in-procedure",
  "check-kill-registry-parity",
  "check-stage-inputs",
  "check-s12-coverage",
  "check-stages-derived",
]);

export const isBlocking = (f: Finding): boolean => BLOCKING_CHECKS.has(f.check);

export interface Finding {
  check: CheckId;
  message: string;
}

export interface SpecActivity {
  id: string;
  agent: string;
  procedure?: string[];
  /** procedure -> step ids the activity runs, where it runs only part of a procedure (flow.spec 2.15.0). */
  procedureSteps?: Record<string, Array<string | number>>;
}
export interface SpecStage {
  id: string;
  inputs?: string[];
  outputs?: string[];
  activities?: SpecActivity[];
  requiredArtifacts?: string[];
  completionCriteria?: string[];
  killCriteriaRegistry?: string[];
}
export interface SpecGate {
  id: string;
  name?: string;
  killCriteriaRegistry?: string[];
}
export interface FlowSpec {
  gates?: SpecGate[];
  stages?: SpecStage[];
}
export interface ProcedureStep {
  id: string;
  agent_key?: string;
  applies_when?: Predicate;
  /** The serialized step, searched for checklist citations. */
  text: string;
}
export interface Procedure {
  name: string;
  applies_when?: Predicate;
  steps: ProcedureStep[];
}

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

// ── 1. Engine <-> spec parity (H8) ───────────────────────────────────────────

export interface EngineStageBlockers {
  /** Literal labels pushed into `missing` by the stage predicate. */
  labels: string[];
  /** Count of `missing.push(...)` calls with no string literal (spread / computed). */
  dynamic: number;
}

/**
 * Extract, per stage id, the literal missing-artifact labels of the stage
 * completion predicates in app/web-next/lib/process-flow.ts. A predicate is a
 * registry entry `  S<n>: (` up to the next entry or the registry's `};`.
 * Blocker ids are still Korean strings (stable keys are P3), so the label is
 * the key compared against flow.spec requiredArtifacts.
 */
export function extractEngineBlockers(source: string): Map<string, EngineStageBlockers> {
  const out = new Map<string, EngineStageBlockers>();
  let current: string | null = null;
  for (const line of source.split("\n")) {
    const head = line.match(/^ {2}(S\d+): \(/);
    if (head) {
      current = head[1];
      if (!out.has(current)) out.set(current, { labels: [], dynamic: 0 });
      continue;
    }
    if (/^};/.test(line)) {
      current = null;
      continue;
    }
    if (!current) continue;
    const entry = out.get(current) as EngineStageBlockers;
    for (const call of line.matchAll(/missing\.push\(([^;]*)\)/g)) {
      const literals = [...call[1].matchAll(/"((?:[^"\\]|\\.)*)"|`([^`$]*)`/g)].map((m) => norm(m[1] ?? m[2] ?? ""));
      if (literals.length === 0) entry.dynamic++;
      for (const l of literals) if (l && !entry.labels.includes(l)) entry.labels.push(l);
    }
  }
  return out;
}

export function checkEngineSpecParity(spec: FlowSpec, engine: Map<string, EngineStageBlockers>): Finding[] {
  const check: CheckId = "check-engine-spec-parity";
  const findings: Finding[] = [];
  for (const stage of spec.stages ?? []) {
    const declared = new Set((stage.requiredArtifacts ?? []).map(norm));
    const eng = engine.get(stage.id) ?? { labels: [], dynamic: 0 };
    for (const label of eng.labels) {
      if (!declared.has(label)) {
        findings.push({
          check,
          message: `${stage.id}: engine blocker "${label}" is not a flow.spec requiredArtifact (undeclared blocker)`,
        });
      }
    }
    const enforced = new Set(eng.labels);
    for (const art of declared) {
      if (!enforced.has(art)) {
        findings.push({
          check,
          message: `${stage.id}: flow.spec requiredArtifact "${art}" has no engine blocker with the same key (declared, not enforced)`,
        });
      }
    }
    if (eng.dynamic > 0) {
      findings.push({
        check,
        message: `${stage.id}: ${eng.dynamic} engine missing.push call(s) carry no literal key (computed labels cannot be matched until P3 stable keys)`,
      });
    }
  }
  return findings;
}

// ── 2. Checklist consumers (H9) ──────────────────────────────────────────────

export interface ChecklistInfo {
  stem: string;
  docId: string;
  hasMandatory: boolean;
}

/**
 * Declared gate consumers the heuristic cannot see because they live in a
 * module it excludes (lib/library.ts is excluded as the library projection
 * reader). Each entry is VERIFIED, not trusted: the named module must contain
 * the named symbol and the checklist id, or the declaration itself is a
 * finding.
 */
export const CHECKLIST_DECLARED_CONSUMERS: ReadonlyArray<{
  /** The literal the module uses: the governance_doc_id or the `chk-<stem>` library id. */
  docId: string;
  module: string;
  symbol: string;
  gate: string;
}> = [
  // DD_WORKSPACE_CHECKLISTS is the DD gate's seven-domain workspace list: the
  // DD completion summary (lib/dd-checklist-tailor.ts ddCompletionSummary)
  // counts its mandatory items and the S9 blocker / IC step read that count.
  ...[
    "chk-financial-dd-checklist",
    "chk-legal-dd-checklist",
    "chk-hr-dd-checklist",
    "chk-market-dd-checklist",
    "chk-financing-plan-checklist",
  ].map(
    (docId) => ({ docId, module: "app/web-next/lib/library.ts", symbol: "DD_WORKSPACE_CHECKLISTS", gate: "dd" }),
  ),
];

/**
 * Justified exemptions (ADR-0187 P2): mandatory checklists whose gate consumer
 * is a human judgement today, with the reason and the record that backs it.
 * An exemption silences only the named side (producer or consumer).
 */
export const CHECKLIST_EXEMPTIONS: ReadonlyArray<{ docId: string; side: "producer" | "consumer"; reason: string }> = [
  {
    docId: "chk-strategic-fit",
    side: "consumer",
    reason:
      "ADR-0134 removed the standalone fit-verdict UI (the machine consumer) as a duplicate layer; the knock-out rubric is judged into the S3 requiredArtifact '전략적 적합성 판단' (rationale + deterministic recommendation, lib/opportunity-screening.ts) and the human Screening gate record (boundary #2).",
  },
  {
    docId: "chk-site-selection",
    side: "consumer",
    reason:
      "Produced by greenfield-dd step 1-3 and judged by the reviewers inside the technical-dd workspace tab (GF_SITE_CHECKLISTS scopes tdd-01/tdd-02); a machine gate consumer of its own is engine work - ADR-0187 P3 (stable blocker keys), deferred.",
  },
  {
    docId: "chk-greenfield-feasibility",
    side: "consumer",
    reason:
      "Produced by greenfield-screening steps 3/4 and greenfield-pre-fs steps 2/4 (gf-01..gf-07, gf-12); judged by the Screening / Pre-FS gate reviewers. A machine gate consumer is engine work - ADR-0187 P3 (stable blocker keys), deferred.",
  },
];

/**
 * Producer = a step of a procedure hosted by a flow.spec activity whose text
 * cites `checklists/<stem>.yaml`. Consumer = a runtime module (non-generated,
 * not the library projection reader, not a translation table) that names the
 * checklist stem or governance_doc_id, or a verified CHECKLIST_DECLARED_CONSUMERS
 * entry. CHECKLIST_EXEMPTIONS silence one side with a recorded reason.
 */
export function checkChecklistConsumers(
  checklists: ChecklistInfo[],
  hostedProcedures: Procedure[],
  runtimeSources: Map<string, string>,
  declared: {
    consumers: typeof CHECKLIST_DECLARED_CONSUMERS;
    exemptions: typeof CHECKLIST_EXEMPTIONS;
    /** module path -> source, for verifying declared consumers. */
    moduleSource: (module: string) => string | undefined;
  } = { consumers: [], exemptions: [], moduleSource: () => undefined },
): Finding[] {
  const check: CheckId = "check-checklist-consumers";
  const findings: Finding[] = [];
  for (const d of declared.consumers) {
    const src = declared.moduleSource(d.module);
    if (!src || !src.includes(d.symbol) || !src.includes(`"${d.docId}"`))
      findings.push({
        check,
        message: `declared consumer of ${d.docId} does not hold: ${d.module} must define ${d.symbol} naming "${d.docId}"`,
      });
  }
  const exempt = (docId: string, side: "producer" | "consumer") =>
    declared.exemptions.some((e) => e.docId === docId && e.side === side);
  for (const c of checklists) {
    if (!c.hasMandatory) continue;
    const path = `checklists/${c.stem}.yaml`;
    const producers = exempt(c.docId, "producer")
      ? [true]
      : hostedProcedures.filter((p) => p.steps.some((s) => s.text.includes(path)));
    const ids = [c.stem, c.docId, `chk-${c.stem}`].filter(Boolean).join("|");
    const idRe = new RegExp(`(^|[^a-z0-9-])(${ids})([^a-z0-9-]|$)`);
    const consumers = [...runtimeSources.values()].filter((src) => idRe.test(src));
    const declaredHit =
      exempt(c.docId, "consumer") ||
      declared.consumers.some(
        (d) =>
          (d.docId === c.docId || d.docId === `chk-${c.stem}`) &&
          declared.moduleSource(d.module)?.includes(`"${d.docId}"`),
      );
    if (declaredHit) consumers.push("declared");
    if (producers.length === 0)
      findings.push({
        check,
        message: `${c.stem} (${c.docId}): no producer - no step of a flow.spec-hosted procedure cites ${path}`,
      });
    if (consumers.length === 0)
      findings.push({
        check,
        message: `${c.stem} (${c.docId}): no gate consumer - no runtime module reads it (projection/translation files excluded)`,
      });
  }
  return findings;
}

// ── 3. activity.agent in procedure agent_keys (M2) ───────────────────────────

/**
 * Lead-only activities sanctioned to hold no procedure step, each with its ADR
 * reference (ADR-0187 P2). Only `pm` activities qualify: pm is the PM Gateway
 * orchestrator and gate assembler, never a specialist agent_key in a
 * procedure step, and every decision these activities assemble is a human
 * record (boundary #2, ADR-0053). Every other P1 pair was reconciled by adding
 * a step or correcting the activity's procedure list (flow.spec 2.15.0).
 */
const PM_ASSEMBLER = (activity: string, procedure: string, adr: string) => ({ activity, procedure, adr });
export const ACTIVITY_AGENT_ALLOWLIST: ReadonlyArray<{ activity: string; procedure: string; adr: string }> = [
  ...["greenfield-pre-fs", "brownfield-pre-fs", "deal-shape-chain"].map((p) =>
    PM_ASSEMBLER(
      "route-strategy",
      p,
      "ADR-0185 F-12 (pm leads as gateway assembler through the s4.route_recommendation prompt; the route is the human route_decision)",
    ),
  ),
  ...["greenfield-pre-fs", "brownfield-pre-fs", "deal-shape-chain"].map((p) =>
    PM_ASSEMBLER(
      "route-advisory",
      p,
      "ADR-0104 decision 3 (deterministic track advisory, lib/track-advisory.ts; a recommendation only, the route is the human route_decision)",
    ),
  ),
  PM_ASSEMBLER(
    "target-selection",
    "brownfield-fs-comparative",
    "ADR-0185 section 1.6 (pm assembles the fs-gate proposal; step 2 belongs to the person-role target-selector, ADR-0053)",
  ),
  ...["entity-ic-review", "group-investment-review"].map((p) =>
    PM_ASSEMBLER(
      "ic-preparation",
      p,
      "ADR-0104 decision 1 (committee minutes and scorecard assembled for the IC; the decision steps belong to entity-ic-reviewer / group-ic-reviewer, ADR-0053)",
    ),
  ),
  PM_ASSEMBLER(
    "charter-baseline",
    "entity-ic-review",
    "ADR-0104 decision 2 (project charter assembled from S1-S7 outputs as an IC input; changes are append-only)",
  ),
];

export function checkActivityAgentInProcedure(spec: FlowSpec, procedures: Map<string, Procedure>): Finding[] {
  const check: CheckId = "activity-agent-in-procedure";
  const findings: Finding[] = [];
  for (const stage of spec.stages ?? []) {
    for (const a of stage.activities ?? []) {
      for (const procName of a.procedure ?? []) {
        if (ACTIVITY_AGENT_ALLOWLIST.some((x) => x.activity === a.id && x.procedure === procName)) continue;
        const proc = procedures.get(procName);
        if (!proc) {
          findings.push({
            check,
            message: `${stage.id}/${a.id}: procedure '${procName}' not found under procedures/_shared/`,
          });
          continue;
        }
        if (!proc.steps.some((s) => s.agent_key === a.agent)) {
          findings.push({
            check,
            message: `${stage.id}/${a.id}: agent '${a.agent}' holds no step in procedure '${procName}'`,
          });
        }
      }
    }
  }
  return findings;
}

// ── 4. Kill-criteria registry parity (M4) ────────────────────────────────────

const KEY_RE = /`([a-z0-9-]+__[a-z0-9_]+)`/g;

/** Backticked registry keys cited in a policy's section 4 (heading `## 4.` to the next `## `). */
export function policySectionKeys(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^## 4[.\s]/.test(l));
  if (start < 0) return [];
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  const keys = new Set<string>();
  for (const m of lines.slice(start, end).join("\n").matchAll(KEY_RE)) keys.add(m[1]);
  return [...keys].sort();
}

/** Section-4 table rows (`| n | ...`) that declare a criterion with "no registry entry". */
export function policyGapRows(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^## 4[.\s]/.test(l));
  if (start < 0) return [];
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return lines
    .slice(start, end)
    .filter((l) => /^\|\s*\d+\s*\|/.test(l) && /no registry entry/i.test(l))
    .map((l) => `row ${l.split("|")[1].trim()}`);
}

export function specKillKeys(spec: FlowSpec): string[] {
  const keys = new Set<string>();
  for (const g of spec.gates ?? []) for (const k of g.killCriteriaRegistry ?? []) keys.add(k);
  for (const s of spec.stages ?? []) for (const k of s.killCriteriaRegistry ?? []) keys.add(k);
  return [...keys].sort();
}

export function checkKillRegistryParity(input: {
  registryKeys: string[];
  specKeys: string[];
  policyKeys: string[];
  policyKoKeys?: string[];
  /** Section-4 table rows that say a criterion has no registry entry yet. */
  policyGapRows?: string[];
}): Finding[] {
  const check: CheckId = "check-kill-registry-parity";
  const findings: Finding[] = [];
  const reg = new Set(input.registryKeys);
  const spec = new Set(input.specKeys);
  for (const k of input.specKeys)
    if (!reg.has(k))
      findings.push({ check, message: `flow.spec killCriteriaRegistry cites '${k}', which has no registry entry` });
  for (const k of input.registryKeys)
    if (!spec.has(k))
      findings.push({
        check,
        message: `registry entry '${k}' binds at no flow.spec gate or stage (killCriteriaRegistry)`,
      });
  for (const k of input.policyKeys) {
    if (!reg.has(k))
      findings.push({ check, message: `neb-policy section 4 cites '${k}', which has no registry entry` });
    else if (!spec.has(k))
      findings.push({ check, message: `neb-policy section 4 cites '${k}', which flow.spec binds at no gate` });
  }
  for (const row of input.policyGapRows ?? [])
    findings.push({ check, message: `neb-policy section 4 row states a criterion with no registry entry: ${row}` });
  if (input.policyKoKeys) {
    const en = new Set(input.policyKeys);
    const ko = new Set(input.policyKoKeys);
    for (const k of input.policyKeys)
      if (!ko.has(k)) findings.push({ check, message: `neb-policy_ko section 4 is missing '${k}' (en/ko drift)` });
    for (const k of input.policyKoKeys)
      if (!en.has(k))
        findings.push({
          check,
          message: `neb-policy_ko section 4 cites '${k}', absent from the English policy (en/ko drift)`,
        });
  }
  return findings;
}

// ── 5. S2 entry-market input (M9) ────────────────────────────────────────────

/** flow.spec input wording for the S2 entry market (S3 onward). */
export const ENTRY_MARKET_MARKER = "진입시장";
const ENTRY_MARKET_STAGES = ["S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12"];

export function checkStageInputs(spec: FlowSpec): Finding[] {
  const check: CheckId = "check-stage-inputs";
  const findings: Finding[] = [];
  for (const id of ENTRY_MARKET_STAGES) {
    const stage = (spec.stages ?? []).find((s) => s.id === id);
    if (!stage) {
      findings.push({ check, message: `${id}: stage missing from flow.spec` });
      continue;
    }
    if (!(stage.inputs ?? []).some((i) => i.includes(ENTRY_MARKET_MARKER))) {
      findings.push({ check, message: `${id}: inputs do not declare the S2 entry market` });
    }
  }
  return findings;
}

// ── 6. Review coverage (M7/M8) ───────────────────────────────────────────────

export interface ReviewCoverageInput {
  spec: FlowSpec;
  /** agent key -> review domain (agents/*.md `domain:`). */
  agentDomains: Map<string, string>;
  /** Gates the review runtime covers (gate-artifacts.ts REVIEW_GATES). */
  reviewGates: string[];
  /** Gates named as a review exception in neb-policy section 2.7. */
  namedExceptions: string[];
  /** Parsed process/cross-validation-matrix.yaml entries, or null when the file is absent (P4). */
  matrix: Array<{ stage?: string; author_domain: string; reviewer: string }> | null;
}

/**
 * Reports the current state; the matrix file itself lands in P4. The review
 * registry is derived from requiredArtifacts (lib/review/stage-artifacts.ts),
 * so a stage output that is not also a requiredArtifact is never reviewed.
 */
export function checkReviewCoverage(input: ReviewCoverageInput): Finding[] {
  const check: CheckId = "check-review-coverage";
  const findings: Finding[] = [];
  for (const stage of input.spec.stages ?? []) {
    const registry = new Set((stage.requiredArtifacts ?? []).map(norm));
    for (const out of stage.outputs ?? []) {
      if (!registry.has(norm(out)))
        findings.push({
          check,
          message: `${stage.id}: output "${norm(out)}" is not in the review registry (not a requiredArtifact - skips AI-2nd)`,
        });
    }
  }
  for (const g of input.spec.gates ?? []) {
    if (!input.reviewGates.includes(g.id) && !input.namedExceptions.includes(g.id)) {
      findings.push({
        check,
        message: `gate '${g.id}' is neither covered by the review runtime nor a named policy exception`,
      });
    }
  }
  for (const stage of input.spec.stages ?? []) {
    const domains = new Set<string>();
    for (const a of stage.activities ?? []) {
      const d = input.agentDomains.get(a.agent);
      if (d) domains.add(d);
      else findings.push({ check, message: `${stage.id}/${a.id}: author agent '${a.agent}' has no review domain` });
    }
    for (const d of [...domains].sort()) {
      const hit = input.matrix?.some((m) => m.author_domain === d && (!m.stage || m.stage === stage.id));
      if (!hit) {
        findings.push({
          check,
          message: `${stage.id}: author domain '${d}' resolves by DEFAULT_REVIEWER_DOMAIN fallback (${input.matrix ? "no matrix entry" : "matrix file absent - P4"})`,
        });
      }
    }
  }
  return findings;
}

// ── 7. S12 coverage per classification cell (M17) ────────────────────────────

export interface ClassificationCell {
  case_type: string;
  origin: string;
  sub_track: string;
}

export const ORIGINS = ["internal", "external", "hybrid", "joint"];
export const BROWNFIELD_SUB_TRACKS = [
  "m_and_a",
  "jv",
  "strategic_investment",
  "minority_investment",
  "partnership",
  "rbd",
  "corporate_venture",
];
export const GREENFIELD_SUB_TRACKS = ["none", "existing_business_rbd", "intra_venture"];

/** The ADR-0047 case_type x origin cells crossed with the route sub-tracks (lib/*-subtrack.ts). */
export function classificationCells(): ClassificationCell[] {
  const cells: ClassificationCell[] = [];
  for (const origin of ORIGINS) {
    for (const sub_track of GREENFIELD_SUB_TRACKS) cells.push({ case_type: "greenfield", origin, sub_track });
    for (const sub_track of BROWNFIELD_SUB_TRACKS) cells.push({ case_type: "brownfield", origin, sub_track });
  }
  return cells;
}

/**
 * Activity -> step scope where an S12 activity runs part of a broader
 * procedure: read from the activity's flow.spec `procedureSteps` (2.15.0,
 * integration-monitoring = pmi step 6, partnership-monitoring = jv-lifecycle
 * step 2). No scope declared = the whole procedure.
 */
export function activityStepScope(a: SpecActivity, procedure: string): string[] | undefined {
  const s = a.procedureSteps?.[procedure];
  return s ? s.map(String) : undefined;
}

function cellLookup(cell: ClassificationCell) {
  const vars: Record<string, string> = {
    "project.case_type": cell.case_type,
    "project.origin": cell.origin,
    "project.sub_track": cell.sub_track,
  };
  return (k: string): VarSnapshot | undefined => (k in vars ? { status: "present", value: vars[k] } : undefined);
}

export function procedureMatches(proc: Procedure, cell: ClassificationCell, stepScope?: string[]): boolean {
  const lookup = cellLookup(cell);
  if (proc.applies_when && evaluatePredicate(proc.applies_when, lookup) !== "true") return false;
  const steps = stepScope ? proc.steps.filter((s) => stepScope.includes(String(s.id))) : proc.steps;
  return steps.some((s) => !s.applies_when || evaluatePredicate(s.applies_when, lookup) === "true");
}

export function checkS12Coverage(
  spec: FlowSpec,
  procedures: Map<string, Procedure>,
  cells: ClassificationCell[] = classificationCells(),
): Finding[] {
  const check: CheckId = "check-s12-coverage";
  const s12 = (spec.stages ?? []).find((s) => s.id === "S12");
  const findings: Finding[] = [];
  for (const cell of cells) {
    const hit = (s12?.activities ?? []).some((a) =>
      (a.procedure ?? []).some((p) => {
        const proc = procedures.get(p);
        return proc ? procedureMatches(proc, cell, activityStepScope(a, p)) : false;
      }),
    );
    if (!hit)
      findings.push({
        check,
        message: `cell (${cell.case_type}, ${cell.origin}, ${cell.sub_track}) matches no S12 activity`,
      });
  }
  return findings;
}

// ── 8. stages.yaml derived from flow.spec (M3) ───────────────────────────────

export interface StagesYamlEntry {
  id: string;
  title: string;
  order: number;
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/**
 * Projection: flow.spec gate order, then post_close, mapped to G-ids through
 * process/stage-aliases.yaml (alias title slug == gate id). Compares id, title
 * and order; prose fields (purpose, criteria) are not projected.
 */
export function checkStagesDerived(
  spec: FlowSpec,
  aliases: Record<string, { stage: string }>,
  stagesYaml: StagesYamlEntry[],
): Finding[] {
  const check: CheckId = "check-stages-derived";
  const findings: Finding[] = [];
  const bySlug = new Map(Object.entries(aliases).map(([title, a]) => [slug(title), { title, stage: a.stage }]));
  const projected: StagesYamlEntry[] = [];
  for (const id of [...(spec.gates ?? []).map((g) => g.id), "post_close"]) {
    const alias = bySlug.get(id);
    if (!alias) {
      findings.push({ check, message: `gate '${id}' has no stage-aliases.yaml entry` });
      continue;
    }
    projected.push({
      id: alias.stage,
      title: alias.title === "post_close" ? "Post-Close" : alias.title,
      order: projected.length + 1,
    });
  }
  const actual = new Map(stagesYaml.map((s) => [s.id, s]));
  for (const p of projected) {
    const a = actual.get(p.id);
    if (!a) findings.push({ check, message: `${p.id} (${p.title}) missing from stages.yaml` });
    else {
      if (a.order !== p.order)
        findings.push({ check, message: `${p.id} (${p.title}): order ${a.order} != projected ${p.order}` });
      if (a.title !== p.title)
        findings.push({ check, message: `${p.id}: title "${a.title}" != projected "${p.title}"` });
    }
  }
  for (const s of stagesYaml)
    if (!projected.some((p) => p.id === s.id))
      findings.push({ check, message: `${s.id} (${s.title}) is in stages.yaml but not in the flow.spec projection` });
  return findings;
}

// ── Repository loaders ───────────────────────────────────────────────────────

const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

export function loadProcedures(root = ROOT): Map<string, Procedure> {
  const out = new Map<string, Procedure>();
  const dir = join(root, "procedures", "_shared");
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, "schema.yaml");
    if (!existsSync(file)) continue;
    const doc = yamlLoad(readFileSync(file, "utf8")) as {
      applies_when?: Predicate;
      steps?: Array<Record<string, unknown>>;
    };
    out.set(name, {
      name,
      applies_when: doc.applies_when,
      steps: (doc.steps ?? []).map((s) => ({
        id: String(s.id),
        agent_key: typeof s.agent_key === "string" ? s.agent_key : undefined,
        applies_when: s.applies_when as Predicate | undefined,
        text: JSON.stringify(s),
      })),
    });
  }
  return out;
}

export function loadFlowSpec(root = ROOT): FlowSpec {
  return yamlLoad(readFileSync(join(root, "process", "flow.spec.yaml"), "utf8")) as FlowSpec;
}

function agentDomains(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(join(ROOT, "agents"))) {
    if (!f.endsWith(".md")) continue;
    const m = read(join("agents", f)).match(/^domain:\s*([a-z_]+)/m);
    if (m && !m[1].startsWith("_")) out.set(basename(f, ".md"), m[1]);
  }
  return out;
}

function runtimeSources(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (rel: string) => {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const r = join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else if (/\.ts$/.test(e.name) && !/\.generated\.ts$|\.test\.ts$|-ko\.ts$|^library\.ts$/.test(e.name))
        out.set(r, read(r));
    }
  };
  walk("app/web-next/lib");
  walk("db/lib");
  return out;
}

export function runAll(only?: CheckId): Finding[] {
  const spec = loadFlowSpec();
  const procedures = loadProcedures();
  const hostedNames = new Set(
    (spec.stages ?? []).flatMap((s) => (s.activities ?? []).flatMap((a) => a.procedure ?? [])),
  );
  const want = (id: CheckId) => !only || only === id;
  const findings: Finding[] = [];

  if (want("check-engine-spec-parity")) {
    findings.push(...checkEngineSpecParity(spec, extractEngineBlockers(read("app/web-next/lib/process-flow.ts"))));
  }
  if (want("check-checklist-consumers")) {
    const checklists: ChecklistInfo[] = readdirSync(join(ROOT, "checklists"))
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => {
        const doc = yamlLoad(read(join("checklists", f))) as {
          governance_doc_id?: string;
          items?: Array<{ mandatory?: boolean }>;
        };
        return {
          stem: basename(f, ".yaml"),
          docId: doc.governance_doc_id ?? "",
          hasMandatory: (doc.items ?? []).some((i) => i.mandatory === true),
        };
      });
    const hosted = [...procedures.values()].filter((p) => hostedNames.has(p.name));
    findings.push(
      ...checkChecklistConsumers(checklists, hosted, runtimeSources(), {
        consumers: CHECKLIST_DECLARED_CONSUMERS,
        exemptions: CHECKLIST_EXEMPTIONS,
        moduleSource: (m) => (existsSync(join(ROOT, m)) ? read(m) : undefined),
      }),
    );
  }
  if (want("activity-agent-in-procedure")) findings.push(...checkActivityAgentInProcedure(spec, procedures));
  if (want("check-kill-registry-parity")) {
    const registryKeys = readdirSync(join(ROOT, "procedures", "_kill-criteria"))
      .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
      .map((f) => basename(f, ".json"))
      .sort();
    const koPath = join(ROOT, "policies", "group", "neb-policy_ko.md");
    findings.push(
      ...checkKillRegistryParity({
        registryKeys,
        specKeys: specKillKeys(spec),
        policyKeys: policySectionKeys(read("policies/group/neb-policy.md")),
        policyGapRows: policyGapRows(read("policies/group/neb-policy.md")),
        policyKoKeys: existsSync(koPath) ? policySectionKeys(readFileSync(koPath, "utf8")) : undefined,
      }),
    );
  }
  if (want("check-stage-inputs")) findings.push(...checkStageInputs(spec));
  if (want("check-review-coverage")) {
    const ga = read("app/web-next/lib/review/gate-artifacts.ts");
    const m = ga.match(/REVIEW_GATES = \[([^\]]*)\]/);
    const reviewGates = m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : [];
    const matrixPath = join(ROOT, "process", "cross-validation-matrix.yaml");
    const matrix = existsSync(matrixPath)
      ? (((yamlLoad(readFileSync(matrixPath, "utf8")) as { entries?: unknown[] }).entries ??
          []) as ReviewCoverageInput["matrix"])
      : null;
    findings.push(
      ...checkReviewCoverage({
        spec,
        agentDomains: agentDomains(),
        reviewGates,
        namedExceptions: ["target_screening"],
        matrix,
      }),
    );
  }
  if (want("check-s12-coverage")) findings.push(...checkS12Coverage(spec, procedures));
  if (want("check-stages-derived")) {
    const aliases = (yamlLoad(read("process/stage-aliases.yaml")) as { aliases: Record<string, { stage: string }> })
      .aliases;
    const stages = (yamlLoad(read("process/stages.yaml")) as { stages: StagesYamlEntry[] }).stages;
    findings.push(...checkStagesDerived(spec, aliases, stages));
  }
  return findings;
}

export function summarize(findings: Finding[]): Record<CheckId, number> {
  const counts = Object.fromEntries(CHECK_IDS.map((c) => [c, 0])) as Record<CheckId, number>;
  for (const f of findings) counts[f.check]++;
  return counts;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--check");
  const only = i >= 0 ? (args[i + 1] as CheckId) : undefined;
  if (only && !CHECK_IDS.includes(only)) {
    console.error(`unknown check '${only}' - one of: ${CHECK_IDS.join(", ")}`);
    process.exit(2);
  }
  const findings = runAll(only);
  if (args.includes("--json")) {
    console.log(JSON.stringify({ counts: summarize(findings), findings }, null, 2));
  } else {
    for (const f of findings) console.log(`[${isBlocking(f) ? "ERROR" : "WARN"}] ${f.check}: ${f.message}`);
    const counts = summarize(findings);
    console.log("\nProcess SSOT validators (ADR-0187 P2 - ERROR checks block, WARN checks report):");
    for (const c of CHECK_IDS)
      if (!only || only === c) console.log(`  ${c.padEnd(30)} ${String(counts[c]).padStart(3)}  ${BLOCKING_CHECKS.has(c) ? "blocking" : "report-only"}`);
  }
  const blocking = findings.some(isBlocking);
  process.exit(blocking || (args.includes("--strict") && findings.length > 0) ? 1 : 0);
}
