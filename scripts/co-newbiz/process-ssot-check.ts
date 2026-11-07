#!/usr/bin/env bun
// @version 4.1.0
/**
 * Process SSOT validators (ADR-0187 phase P1, design
 * docs/designs/2026-10-27-process-ssot-decision-evidence-design.md section 4.6).
 *
 * One script, eight named checks (the design names one file per validator;
 * they share every loader, so they live together and keep the design names as
 * check ids):
 *
 *   check-engine-spec-parity      H8    engine blocker keys <-> flow.spec blockers (requiredArtifacts / completionCriteria coverage)
 *   check-checklist-consumers     H9    every checklist with mandatory items has a producer step and a gate consumer
 *   activity-agent-in-procedure   M2    flow.spec activity.agent holds >=1 agent_key step in each listed procedure
 *   check-kill-registry-parity    M4    neb-policy section 4 keys / registry keys / flow.spec killCriteriaRegistry
 *   check-stage-inputs            M9    S3-S12 inputs declare the S2 entry market
 *   check-review-coverage         M7/M8 stage outputs in the review registry; author-domain pairs resolved by a matrix
 *   check-s12-coverage            M17   each classification cell matches >=1 S12 activity
 *   check-stages-derived          M3    process/stages.yaml equals the gate-order projection of flow.spec
 *
 * Mode (since 2.0.0, ADR-0187 phase P2; engine parity since 3.0.0, phase P3): the
 * checks in BLOCKING_CHECKS print as ERROR and exit 1 - each reached zero
 * findings, or every remaining pair is an explicit allowlist entry below with its
 * ADR / reason. check-engine-spec-parity compares stable blocker KEYS (lib/
 * process-blocker-keys.ts <-> flow.spec `blockers:`), not Korean strings. The one
 * check the design closed last, check-review-coverage (P4, reads
 * process/cross-validation-matrix.yaml), is blocking too, so every check blocks.
 * `--strict` additionally exits 1 on a WARN finding (none remain). `--check <id>` runs one check; `--json` prints the machine-readable
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
import { checkReevaluateBinding, flowShapeFromSpec } from "../../packages/core-scoring/src/kill-criteria.ts";
import { BLOCKER_LABELS } from "../../app/web-next/lib/process-blocker-keys.ts";

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
 * Checks that fail the audit (P2, P3, P4): all eight. check-review-coverage was
 * the last report-only check; it closes with the P4 cross-validation matrix.
 */
export const BLOCKING_CHECKS: ReadonlySet<CheckId> = new Set<CheckId>([
  "check-engine-spec-parity",
  "check-checklist-consumers",
  "activity-agent-in-procedure",
  "check-kill-registry-parity",
  "check-stage-inputs",
  "check-review-coverage",
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
  /** ADR-0187 P3: stable engine blocker keys and the artifacts / criteria (0-based indices) each covers. */
  blockers?: Array<{ key: string; artifacts?: number[]; criteria?: number[] }>;
  /** requiredArtifacts indices the engine deliberately does not block on. */
  nonBlockingArtifacts?: number[];
  killCriteriaRegistry?: string[];
  /** Gates this stage hosts (ADR-0193 reads them to bind `reevaluate_at` to a stage). */
  gates?: string[];
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
  /** Stable blocker keys (`blocker("s3.x")`) the engine emits for the stage. */
  keys: string[];
  /** missing.push calls / `missing: [...]` entries that bypass blocker() (raw labels, computed text). */
  raw: number;
}

/**
 * Extract, per stage id, the stable blocker keys the engine emits. Since ADR-0187
 * P3 every `missing` entry is produced through `blocker("<key>")`
 * (app/web-next/lib/process-blocker-keys.ts), and a key's prefix is its stage,
 * so the scan covers every engine module (process-flow.ts and the modules its
 * predicates delegate to) without tracking registry boundaries. A
 * `missing.push(` argument or `missing: [` literal that is neither a blocker()
 * call nor a spread of another producer's `.missing` counts as a raw entry.
 */
export function extractEngineBlockers(sources: string | string[]): Map<string, EngineStageBlockers> {
  const out = new Map<string, EngineStageBlockers>();
  const entry = (stage: string): EngineStageBlockers => {
    if (!out.has(stage)) out.set(stage, { keys: [], raw: 0 });
    return out.get(stage) as EngineStageBlockers;
  };
  for (const source of Array.isArray(sources) ? sources : [sources]) {
    // `blocker("s3.x")` calls, and `blockerKey: "s4.x"` table entries (modules that
    // resolve the key at runtime, e.g. lib/checklist-gate-consumers.ts).
    for (const m of source.matchAll(/\bblocker\(\s*"(s\d+)\.([a-z0-9_]+)"\s*\)|\bblockerKey:\s*"(s\d+)\.([a-z0-9_]+)"/g)) {
      const stagePart = m[1] ?? m[3];
      const namePart = m[2] ?? m[4];
      const e = entry(stagePart.toUpperCase());
      const key = `${stagePart}.${namePart}`;
      if (!e.keys.includes(key)) e.keys.push(key);
    }
    const unattributed = entry("?");
    for (const call of source.matchAll(/missing\.push\(([^;]*)\)/g)) {
      const arg = call[1];
      if (/\bblocker\(/.test(arg) || /^\s*\.\.\.[\w.]+\.missing\s*$/.test(arg)) continue;
      unattributed.raw++;
    }
    for (const lit of source.matchAll(/\bmissing:\s*\[([^\]]*)\]/g)) {
      const body = lit[1].trim();
      if (body === "" || /^\.\.\.[\w.]+$/.test(body)) continue;
      if (!/\bblocker\(/.test(body)) unattributed.raw++;
    }
  }
  return out;
}

export interface BlockerKeyRegistry {
  /** Keys defined in process-blocker-keys.ts. */
  keys: ReadonlySet<string>;
}

/**
 * Parity (H8): per stage, the engine's blocker keys equal the keys the stage's
 * flow.spec `blockers:` declares; every declared key is in the registry; every
 * registry key is used by the engine; every `blockers` cover reference points at
 * an existing requiredArtifact / completionCriterion; every requiredArtifact is
 * covered by a key or listed in `nonBlockingArtifacts`.
 */
export function checkEngineSpecParity(
  spec: FlowSpec,
  engine: Map<string, EngineStageBlockers>,
  registry: BlockerKeyRegistry = { keys: new Set([...engine.values()].flatMap((e) => e.keys)) },
): Finding[] {
  const check: CheckId = "check-engine-spec-parity";
  const findings: Finding[] = [];
  const allEngineKeys = new Set([...engine.values()].flatMap((e) => e.keys));
  for (const stage of spec.stages ?? []) {
    const declared = stage.blockers ?? [];
    const declaredKeys = declared.map((b) => b.key);
    const engineKeys = engine.get(stage.id)?.keys ?? [];
    for (const k of engineKeys) {
      if (!declaredKeys.includes(k)) {
        findings.push({ check, message: `${stage.id}: engine blocker key "${k}" is not declared in flow.spec blockers (undeclared blocker)` });
      }
    }
    for (const k of declaredKeys) {
      if (!engineKeys.includes(k)) {
        findings.push({ check, message: `${stage.id}: flow.spec blocker key "${k}" is not emitted by the engine (declared, not enforced)` });
      }
      if (!registry.keys.has(k)) {
        findings.push({ check, message: `${stage.id}: flow.spec blocker key "${k}" is not defined in process-blocker-keys.ts` });
      }
      if (!k.toLowerCase().startsWith(`${stage.id.toLowerCase()}.`)) {
        findings.push({ check, message: `${stage.id}: blocker key "${k}" does not carry the stage prefix "${stage.id.toLowerCase()}."` });
      }
    }
    const dupes = declaredKeys.filter((k, i) => declaredKeys.indexOf(k) !== i);
    for (const k of new Set(dupes)) findings.push({ check, message: `${stage.id}: blocker key "${k}" is declared more than once` });
    const nArt = (stage.requiredArtifacts ?? []).length;
    const nCrit = (stage.completionCriteria ?? []).length;
    const covered = new Set<number>();
    for (const b of declared) {
      for (const i of b.artifacts ?? []) {
        if (!Number.isInteger(i) || i < 0 || i >= nArt)
          findings.push({ check, message: `${stage.id}: blocker "${b.key}" covers requiredArtifacts[${i}] which does not exist (${nArt} listed)` });
        else covered.add(i);
      }
      for (const i of b.criteria ?? []) {
        if (!Number.isInteger(i) || i < 0 || i >= nCrit)
          findings.push({ check, message: `${stage.id}: blocker "${b.key}" covers completionCriteria[${i}] which does not exist (${nCrit} listed)` });
      }
    }
    const nonBlocking = new Set(stage.nonBlockingArtifacts ?? []);
    for (let i = 0; i < nArt; i++) {
      if (!covered.has(i) && !nonBlocking.has(i)) {
        findings.push({
          check,
          message: `${stage.id}: requiredArtifact[${i}] "${norm((stage.requiredArtifacts as string[])[i]).slice(0, 60)}" is covered by no blocker key and not listed in nonBlockingArtifacts (declared, not enforced)`,
        });
      }
    }
    for (const i of nonBlocking) {
      if (covered.has(i)) findings.push({ check, message: `${stage.id}: requiredArtifact[${i}] is both covered by a blocker key and listed in nonBlockingArtifacts` });
    }
  }
  for (const k of registry.keys) {
    if (!allEngineKeys.has(k)) findings.push({ check, message: `${k}: key is defined in process-blocker-keys.ts but no engine predicate emits it (dead key)` });
  }
  const raw = engine.get("?")?.raw ?? 0;
  if (raw > 0) {
    findings.push({ check, message: `${raw} engine missing entr${raw === 1 ? "y" : "ies"} bypass blocker() (raw label or computed text) - every missing entry must carry a stable key` });
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
  /**
   * ADR-0193: per registry key, its declared stage scoping, checked against flow.spec -
   * `reevaluate_at` names a gate that exists and whose stage is not earlier than `evaluable_from`.
   * Omitted by callers that predate the field (the registry validator reports missing fields).
   */
  registryScoping?: Array<{ key: string; evaluable_from?: string; reevaluate_at?: string }>;
  spec?: FlowSpec;
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
  if (input.registryScoping && input.spec) {
    const flow = flowShapeFromSpec(input.spec);
    for (const r of input.registryScoping) {
      if (!r.evaluable_from || !r.reevaluate_at) {
        findings.push({ check, message: `registry entry '${r.key}' lacks evaluable_from / reevaluate_at (ADR-0193)` });
        continue;
      }
      for (const problem of checkReevaluateBinding(r, flow)) findings.push({ check, message: `registry entry '${r.key}': ${problem} (ADR-0193)` });
    }
  }
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

export interface MatrixOutputEntry {
  match: string;
  artifact_type?: string;
  review?: string;
  covered_by?: string;
  reason?: string;
}
/** process/cross-validation-matrix.yaml, as parsed (ADR-0187 P4). */
export interface ReviewMatrixDoc {
  reviewer_domains?: Record<string, string>;
  fallback?: Record<string, string>;
  agent_exemptions?: Array<{ agent: string; reason?: string }>;
  gate_exceptions?: Array<{ gate: string; reason?: string }>;
  artifact_types?: Record<string, { reviewers?: Record<string, string> }>;
  stages?: Record<
    string,
    {
      default_type?: string;
      required?: Array<{ match: string; artifact_type: string }>;
      outputs?: MatrixOutputEntry[];
    }
  >;
}

export interface ReviewCoverageInput {
  spec: FlowSpec;
  /** agent key -> review domain (agents/*.md `domain:`). */
  agentDomains: Map<string, string>;
  /** Gates the review runtime covers (gate-artifacts.ts REVIEW_GATES). */
  reviewGates: string[];
  /** Gates named as a review exception in neb-policy section 2.7. */
  namedExceptions: string[];
  /** Parsed process/cross-validation-matrix.yaml, or null when absent. */
  matrix: ReviewMatrixDoc | null;
}

const startsEither = (a: string, b: string): boolean => {
  const x = norm(a);
  const y = norm(b);
  return x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x));
};

/**
 * M7/M8. Every stage output is either a requiredArtifact (reviewed by the
 * runtime registry, lib/review/stage-artifacts.ts), or is listed in the
 * matrix stage registry as covered_by a requiredArtifact / exempt with a
 * reason; every gate is reviewed or a named exception; every authoring agent
 * has a review domain or an explicit exemption; every (artifact type x author
 * domain) pair a stage uses resolves in the matrix, and the matrix is
 * self-consistent with the roster and the labelled fallback.
 */
export function checkReviewCoverage(input: ReviewCoverageInput): Finding[] {
  const check: CheckId = "check-review-coverage";
  const findings: Finding[] = [];
  const m = input.matrix;
  if (!m) {
    return [{ check, message: "process/cross-validation-matrix.yaml is absent" }];
  }
  const exempt = new Set((m.agent_exemptions ?? []).map((e) => e.agent));
  const types = m.artifact_types ?? {};

  // Matrix self-consistency: reviewers' domains match the roster, fallback is cross-domain.
  for (const [agent, dom] of Object.entries(m.reviewer_domains ?? {})) {
    const actual = input.agentDomains.get(agent);
    if (actual !== dom) findings.push({ check, message: `matrix reviewer '${agent}' declares domain '${dom}' but the roster says '${actual ?? "none"}'` });
  }
  for (const [dom, lead] of Object.entries(m.fallback ?? {})) {
    const leadDom = m.reviewer_domains?.[lead];
    if (!leadDom || leadDom === dom) findings.push({ check, message: `fallback for author domain '${dom}' is '${lead}', which is not a cross-domain reviewer` });
  }
  for (const [type, def] of Object.entries(types)) {
    for (const [dom, reviewer] of Object.entries(def.reviewers ?? {})) {
      if (!(reviewer in (m.reviewer_domains ?? {})))
        findings.push({ check, message: `artifact type '${type}' x '${dom}': reviewer '${reviewer}' has no reviewer_domains entry` });
    }
  }

  for (const stage of input.spec.stages ?? []) {
    const reqs = (stage.requiredArtifacts ?? []).map(norm);
    const ms = m.stages?.[stage.id];
    if (!ms) findings.push({ check, message: `${stage.id}: no stage entry in the matrix (artifact typing and output registry)` });
    for (const out of stage.outputs ?? []) {
      if (reqs.some((r) => startsEither(out, r))) continue;
      const entry = ms?.outputs?.find((o) => norm(out).startsWith(norm(o.match)));
      if (!entry) {
        findings.push({ check, message: `${stage.id}: output "${norm(out).slice(0, 60)}" is not in the review registry (not a requiredArtifact and no matrix entry - skips AI-2nd)` });
      } else if (entry.review === "covered_by") {
        if (!entry.covered_by || !reqs.some((r) => r.startsWith(norm(entry.covered_by!))))
          findings.push({ check, message: `${stage.id}: output "${entry.match}" is covered_by '${entry.covered_by ?? ""}', which is not a requiredArtifact of the stage` });
      } else if (entry.review === "exempt") {
        if (!entry.reason?.trim()) findings.push({ check, message: `${stage.id}: output "${entry.match}" is exempt without a reason` });
      } else {
        findings.push({ check, message: `${stage.id}: output "${entry.match}" has review '${entry.review ?? ""}' (expected covered_by or exempt)` });
      }
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
      if (exempt.has(a.agent)) continue;
      const d = input.agentDomains.get(a.agent);
      if (d && ["functional", "technical", "industry", "region"].includes(d)) domains.add(d);
      else findings.push({ check, message: `${stage.id}/${a.id}: author agent '${a.agent}' has no review domain and no matrix exemption` });
    }
    const ms = m.stages?.[stage.id];
    const usedTypes = new Set<string>(ms?.default_type ? [ms.default_type] : []);
    for (const r of ms?.required ?? []) usedTypes.add(r.artifact_type);
    for (const o of ms?.outputs ?? []) if (o.artifact_type) usedTypes.add(o.artifact_type);
    for (const t of [...usedTypes].sort()) {
      if (!types[t]) {
        findings.push({ check, message: `${stage.id}: artifact type '${t}' is not defined in the matrix` });
        continue;
      }
      for (const d of [...domains].sort()) {
        if (!types[t].reviewers?.[d])
          findings.push({ check, message: `${stage.id}: no matrix entry for artifact type '${t}' x author domain '${d}'` });
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
    const engineSources = [...runtimeSources().entries()]
      .filter(([path, src]) => !path.endsWith("process-blocker-keys.ts") && (path.endsWith("lib/process-flow.ts") || /\bblocker\(\s*"s\d+\.|\bblockerKey:\s*"s\d+\./.test(src)))
      .map(([, src]) => src);
    findings.push(
      ...checkEngineSpecParity(spec, extractEngineBlockers(engineSources), { keys: new Set(Object.keys(BLOCKER_LABELS)) }),
    );
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
    const registryScoping = registryKeys.map((key) => {
      const e = JSON.parse(readFileSync(join(ROOT, "procedures", "_kill-criteria", `${key}.json`), "utf8")) as { evaluable_from?: string; reevaluate_at?: string };
      return { key, evaluable_from: e.evaluable_from, reevaluate_at: e.reevaluate_at };
    });
    findings.push(
      ...checkKillRegistryParity({
        registryScoping,
        spec,
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
    const matrix = existsSync(matrixPath) ? (yamlLoad(readFileSync(matrixPath, "utf8")) as ReviewMatrixDoc) : null;
    // A matrix gate exception counts only while neb-policy still names it (section 2.7).
    const policy = read("policies/group/neb-policy.md");
    const namedExceptions = (matrix?.gate_exceptions ?? [])
      .map((e) => e.gate)
      .filter((g) => policy.includes(g));
    findings.push(
      ...checkReviewCoverage({
        spec,
        agentDomains: agentDomains(),
        reviewGates,
        namedExceptions,
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
    console.log("\nProcess SSOT validators (ADR-0187 P4 - ERROR checks block, WARN checks report):");
    for (const c of CHECK_IDS)
      if (!only || only === c) console.log(`  ${c.padEnd(30)} ${String(counts[c]).padStart(3)}  ${BLOCKING_CHECKS.has(c) ? "blocking" : "report-only"}`);
  }
  const blocking = findings.some(isBlocking);
  process.exit(blocking || (args.includes("--strict") && findings.length > 0) ? 1 : 0);
}
