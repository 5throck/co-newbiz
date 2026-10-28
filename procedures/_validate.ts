#!/usr/bin/env bun
// @version 1.9.0
/**
 * Procedure Schema Validator — co-newbiz
 *
 * Validates every procedures/**\/schema.yaml against the contract in
 * procedures/_template/README.md, and enforces the procedure/skill authority
 * split (design v1.0 section 6.8): a skill file must not restate gate steps
 * that belong in a procedure.
 *
 * Since 1.1.0 it also runs a cross-file pass (walkAllSteps): every shared
 * procedure is resolved through proc-resolve.ts against every applicable
 * region/entity layer combination, and every merged step's
 * agent_key/skill_key is checked for referential integrity against the real
 * agents/ and skills/ trees. Warn-level only — the skills tree may
 * legitimately not have every referenced skill yet. Warnings are now ALWAYS
 * printed (meeting 2026-08-22 finding F11 — they were previously swallowed
 * unless --verbose); --verbose is still accepted as a no-op for backwards
 * compatibility. Exit code is unchanged: 1 only on errors, never on warnings.
 *
 * Since 1.2.0 (design of record 2026-08-22, Decision 8 / PR-3) it also runs
 * a kill-criteria registry pass against procedures/_kill-criteria/:
 *   (a) every YAML-declared criterion must have a registry entry (error);
 *   (b) every registry entry with predicate null warns "declared-but-inert";
 *   (c) enabled:true without policy_id AND thresholds_source is an error
 *       (anti-tamper — mirrors rag_rule's CHECK, meeting 2026-08-22
 *       classification-practice #6c);
 *   (d) a registry entry no YAML declares is an error (orphan);
 *   (e) --strict fails when the executable count drops below the checked-in
 *       baseline in procedures/_kill-criteria/_baseline.json (risk-officer
 *       F7 — never auto-lowers; re-baseline consciously in the same change).
 *
 * Since 1.3.0 (design of record 2026-08-22, Decision 7 / PR-5a) it also runs
 * a structured applies_when pass: every applies_when (procedure-level and
 * step-level) across all YAMLs must parse via PredicateSchema
 * (db/lib/predicate.ts) — free text is an ERROR, not a warning — and every
 * var_key it references must exist in the evidence_var seed list read
 * statically from db/migrations/0014_routing_vars.sql (no database
 * dependency in the validator).
 *
 * Since 1.4.0 (design of record 2026-08-22, PR-8 — skill graph hardening):
 *   (a) output_type closed vocabulary — every non-placeholder steps[].output_type
 *       in every schema.yaml must be a key of procedures/_output-types.yaml
 *       (error); a registry entry no step anywhere produces is dead vocabulary
 *       (warn). Placeholder values are skipped here — validateSchema already
 *       warns about those (duplicate-signal principle).
 *   (b) ADR-0053 human-role registry — agent_key values listed in
 *       procedures/_human-roles.yaml are exempt from the missing-agents-file
 *       warn in checkStepReferences/walkAllSteps (the missing file is the
 *       point: the key names a person-role). Unreadable registry ⇒ error +
 *       empty set (mirrors loadSeedSet — the check degrades loudly).
 *   (c) ADR-0053 authority marker — a step's decision_authority, when
 *       present, must be the literal string "human" (error otherwise — one
 *       marker, one spelling). Which steps may lawfully carry the marker
 *       (human-role keys and recorder-pattern agents, per ADR-0053) is
 *       checked by scripts/co-newbiz/graph-map.ts --check, which sees the
 *       registry-consistency direction that per-file validation cannot.
 *
 * Since 1.8.0 (ADR-0187 P1, finding M2): rule `activity-agent-in-procedure`
 * — every flow.spec activity's agent must hold >=1 agent_key step in each
 * procedure it lists (scripts/co-newbiz/process-ssot-check.ts). WARN-only in
 * P1; ERROR since 1.9.0 (ADR-0187 P2) — the ADR-backed lead-only pairs live in
 * that script's ACTIVITY_AGENT_ALLOWLIST.
 *
 * Usage:
 *   bun procedures/_validate.ts
 *   bun procedures/_validate.ts --strict    (also gate the executable-ratio baseline)
 *   bun procedures/_validate.ts --verbose   (no-op; warnings always print)
 *
 * Since 1.6.0 (ADR-0097 §4) it also runs a committee-registry pass against
 * procedures/_committees.yaml — the steering-committee registry as
 * governance data:
 *   (a) members[].key existence: `agent` keys must resolve to
 *       agents/<key>.md; `human_role` keys must be listed in
 *       procedures/_human-roles.yaml (the same two registries every other
 *       pass already consults);
 *   (b) a committee WITHOUT a risk-officer membership is an ERROR — the
 *       mandatory red-team seat is a committee contract term (ADR-0097 §2),
 *       not a configuration choice; removing it requires a new ADR;
 *   (c) decision_modes_allowed values must stay within the closed enum
 *       human_only | agent_team | hybrid;
 *   (d) rounds >= 1 (integer); chair must resolve like a member key.
 */

import * as yaml from "js-yaml";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { resolveProcedure } from "../scripts/co-newbiz/proc-resolve.ts";
import { parsePredicate } from "../db/lib/predicate.ts";
import { collectPredicateVars } from "../db/lib/applies-when.ts";

const ROOT = resolve(import.meta.dirname);
const PROJECT_ROOT = resolve(ROOT, "..");
const SKILLS_DIR = join(PROJECT_ROOT, "skills");
const ROUTING_VARS_MIGRATION = join(PROJECT_ROOT, "db", "migrations", "0014_routing_vars.sql");
/** ADR-0160 addendum: the routing-var seeds added by 0136 (project.sub_track, project.site_required). */
const ROUTING_VARS_MIGRATIONS = [ROUTING_VARS_MIGRATION, join(PROJECT_ROOT, "db", "migrations", "0136_greenfield_subtrack_vars.sql"), join(PROJECT_ROOT, "db", "migrations", "0142_establishment_mode.sql")];
const HUMAN_ROLES_FILE = join(ROOT, "_human-roles.yaml");
const OUTPUT_TYPES_FILE = join(ROOT, "_output-types.yaml");
const COMMITTEES_FILE = join(ROOT, "_committees.yaml");
const STAGE_ALIASES_FILE = join(ROOT, "..", "process", "stage-aliases.yaml");
const STAGES_FILE = join(ROOT, "..", "process", "stages.yaml");

interface Issue {
  file: string;
  message: string;
  severity: "error" | "warn";
}

async function findSchemaFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "_template") continue; // template is a reference, not a real procedure
      out.push(...(await findSchemaFiles(full)));
    } else if (entry.isFile() && entry.name === "schema.yaml") {
      out.push(full);
    }
  }
  return out;
}

/**
 * All step objects a doc declares, wherever they live: top-level steps[],
 * overrides.add_steps[].step, overrides.replace_steps[].step (both use the
 * singular `step` key — same shapes proc-resolve.ts merges). PR-8: the
 * closed-vocabulary/authority-marker/usage passes must see layer files'
 * nested steps too, not just top-level ones.
 */
function declaredSteps(p: Record<string, unknown>): { label: string; step: Record<string, unknown> }[] {
  const out: { label: string; step: Record<string, unknown> }[] = [];
  if (Array.isArray(p.steps)) {
    for (const [i, step] of (p.steps as unknown[]).entries()) {
      if (typeof step === "object" && step !== null) {
        out.push({ label: `steps[${i}]`, step: step as Record<string, unknown> });
      }
    }
  }
  const overrides = p.overrides;
  if (typeof overrides === "object" && overrides !== null) {
    const o = overrides as Record<string, unknown>;
    const nested: [string, unknown[]][] = [
      ["add_steps", o.add_steps],
      ["replace_steps", o.replace_steps],
    ];
    for (const [kind, list] of nested) {
      if (!Array.isArray(list)) continue;
      for (const [j, entry] of list.entries()) {
        if (typeof entry !== "object" || entry === null) continue;
        const s = (entry as Record<string, unknown>).step;
        if (typeof s === "object" && s !== null) {
          out.push({ label: `overrides.${kind}[${j}].step`, step: s as Record<string, unknown> });
        }
      }
    }
  }
  return out;
}

function validateSchema(file: string, doc: unknown, outputTypes: Set<string>): Issue[] {
  const issues: Issue[] = [];
  if (typeof doc !== "object" || doc === null) {
    return [{ file, message: "Document is not a YAML mapping", severity: "error" }];
  }
  const p = doc as Record<string, unknown>;

  for (const field of ["procedure_id", "scope", "title", "status", "applicability", "owner_agent", "legal_basis"]) {
    if (p[field] === undefined) {
      issues.push({ file, message: `Missing required field '${field}'`, severity: "error" });
    }
  }

  const scope = p.scope as string | undefined;
  if (scope && !["shared", "entity", "region", "group"].includes(scope)) {
    issues.push({ file, message: `Invalid scope '${scope}'`, severity: "error" });
  }

  const hasSteps = Array.isArray(p.steps) && (p.steps as unknown[]).length > 0;
  const hasReferences = Array.isArray(p.references) && (p.references as unknown[]).length > 0;

  if (scope === "shared") {
    if (!hasSteps) {
      issues.push({ file, message: "scope=shared procedure must declare 'steps' directly", severity: "error" });
    }
  } else if (scope === "entity" || scope === "region") {
    if (!hasReferences && !hasSteps) {
      issues.push({
        file,
        message: "scope=entity/region procedure must declare either 'references' (preferred) or its own 'steps'",
        severity: "error",
      });
    }
    // ADR-0020's "never a full duplicate" rule: a layer file declaring its own
    // complete steps array instead of referencing the shared baseline would be
    // a wholesale duplicate that silently drifts. Not an error (a genuinely
    // standalone layer procedure could exist one day), but always surfaced.
    if (!hasReferences && hasSteps) {
      issues.push({
        file,
        message: "scope=entity/region declares its own 'steps' without 'references' — prefer the shared baseline reference + overrides model (ADR-0020); verify this is not a full duplicate",
        severity: "warn",
      });
    }
    // Rule: an entity/region procedure with `overrides` must also have `references` —
    // overrides with no reference target is meaningless.
    if (p.overrides !== undefined && !hasReferences) {
      issues.push({ file, message: "'overrides' present without 'references' — nothing to override", severity: "error" });
    }
  }

  if (Array.isArray(p.legal_basis) && p.legal_basis.length === 0) {
    issues.push({ file, message: "'legal_basis' is empty — at least one real reference is required", severity: "error" });
  }

  // PR-8: declaredSteps() also descends into overrides.add_steps[].step and
  // overrides.replace_steps[].step — layer files' steps get the same
  // placeholder / output_type / decision_authority checks as top-level ones.
  for (const { label, step: s } of declaredSteps(p)) {
    for (const f of ["agent_key", "skill_key", "output_type"]) {
      if (typeof s[f] !== "string" || (s[f] as string).trim() === "" || s[f] === "TODO") {
        issues.push({ file, message: `${label}.${f} is missing or a placeholder`, severity: "warn" });
      }
    }
    // PR-8 closed vocabulary: a non-placeholder output_type must be a key of
    // procedures/_output-types.yaml — an unregistered deliverable type is a
    // contract nobody recognizes (typo, drift, or an undeclared new
    // deliverable). Placeholders are skipped here; the warn above already
    // covers them (duplicate-signal principle).
    const ot = s.output_type;
    if (typeof ot === "string" && ot.trim() !== "" && ot !== "TODO" && !outputTypes.has(ot)) {
      issues.push({
        file,
        message: `${label}.output_type '${ot}' is not registered in procedures/_output-types.yaml — add the registry entry in the same change`,
        severity: "error",
      });
    }
    // ADR-0053: the authority marker has exactly one legal value. Which
    // steps may lawfully carry it is graph-map's registry-consistency
    // check, not this per-file one.
    if (s.decision_authority !== undefined && s.decision_authority !== "human") {
      issues.push({
        file,
        message: `${label}.decision_authority must be the literal 'human' (got ${JSON.stringify(s.decision_authority)}) — see ADR-0053`,
        severity: "error",
      });
    }
  }

  return issues;
}

/**
 * Lint check for the procedure/skill authority split (design section 6.8).
 * A skill file restating numbered gate steps alongside approver/gate keywords
 * is a governance violation, not a style issue.
 */
async function lintSkillsForGateSteps(): Promise<Issue[]> {
  const issues: Issue[] = [];
  let skillFiles: string[] = [];
  try {
    skillFiles = await findSkillFiles(SKILLS_DIR);
  } catch {
    return issues; // skills/ may not exist yet this early in Stage 2
  }

  const numberedStepPattern = /^\s*\d+\.\s+.+/m;
  const gateKeywordPattern = /\b(approver|gate|Entity IC|Group IC|Screening|Pre-FS)\b/i;

  for (const file of skillFiles) {
    const content = await readFile(file, "utf-8");
    if (numberedStepPattern.test(content) && gateKeywordPattern.test(content)) {
      issues.push({
        file,
        message: "Skill file contains numbered steps alongside gate/approver keywords — verify it references a procedure key rather than restating gate steps (design section 6.8)",
        severity: "warn",
      });
    }
  }
  return issues;
}

async function findSkillFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await findSkillFiles(full)));
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      out.push(full);
    }
  }
  return out;
}

/** Shared procedures = directories under procedures/_shared/ holding a schema.yaml. */
async function discoverSharedProcedures(): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(ROOT, "_shared"), { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(ROOT, "_shared", entry.name, "schema.yaml"))) {
      out.push(entry.name);
    }
  }
  return out.sort();
}

/** Region/entity layer codes, discovered dynamically — never hardcode "EU"/"ent-a". */
async function discoverLayerCodes(kind: "regions" | "entities"): Promise<string[]> {
  try {
    return (await readdir(join(ROOT, kind), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return []; // procedures/regions/ or procedures/entities/ does not exist yet
  }
}

interface LayerCombo {
  label: string; // e.g. "shared+region:EU+entity:ent-a"
  opts: { region?: string; entity?: string };
}

/**
 * The base shared-only combo plus one combo per non-empty subset of the
 * layers that actually have an override doc for this procedure. For a
 * procedure with both an EU and an ent-a override doc that yields 4
 * resolutions: shared, shared+region:EU, shared+entity:ent-a,
 * shared+region:EU+entity:ent-a.
 */
function combosFor(name: string, regions: string[], entities: string[]): LayerCombo[] {
  const layers: { kind: "region" | "entity"; code: string }[] = [
    ...regions
      .filter((r) => existsSync(join(ROOT, "regions", r, name, "schema.yaml")))
      .map((r) => ({ kind: "region" as const, code: r })),
    ...entities
      .filter((e) => existsSync(join(ROOT, "entities", e, name, "schema.yaml")))
      .map((e) => ({ kind: "entity" as const, code: e })),
  ];
  const combos: LayerCombo[] = [{ label: "shared", opts: {} }];
  for (let mask = 1; mask < 2 ** layers.length; mask++) {
    const opts: { region?: string; entity?: string } = {};
    const parts: string[] = ["shared"];
    for (let i = 0; i < layers.length; i++) {
      if (mask & (1 << i)) {
        opts[layers[i].kind] = layers[i].code;
        parts.push(`${layers[i].kind}:${layers[i].code}`);
      }
    }
    combos.push({ label: parts.join("+"), opts });
  }
  return combos;
}

/**
 * Referential integrity for one merged (or standalone) step list. Placeholder
 * values ("TODO", empty, non-string) are skipped here — validateSchema
 * already warns about those on the raw doc, so flagging them again as
 * "file does not exist" would be a duplicate signal.
 *
 * ADR-0053: agent_key values in the human-role registry are exempt from the
 * missing-agents-file warn — the key names a person-role, and no
 * agents/<key>.md may exist for it.
 */
function checkStepReferences(label: string, steps: unknown[], humanRoles: Set<string>): Issue[] {
  const issues: Issue[] = [];
  for (const step of steps) {
    if (typeof step !== "object" || step === null) continue;
    const s = step as Record<string, unknown>;
    const agentKey = s.agent_key;
    if (
      typeof agentKey === "string" &&
      agentKey.trim() !== "" &&
      agentKey !== "TODO" &&
      !humanRoles.has(agentKey) &&
      !existsSync(join(PROJECT_ROOT, "agents", `${agentKey}.md`))
    ) {
      issues.push({
        file: label,
        message: `step ${s.id} agent_key '${agentKey}' has no agents/${agentKey}.md`,
        severity: "warn",
      });
    }
    const skillKey = s.skill_key;
    if (
      typeof skillKey === "string" &&
      skillKey.trim() !== "" &&
      skillKey !== "TODO" &&
      !existsSync(join(SKILLS_DIR, skillKey, "SKILL.md"))
    ) {
      issues.push({
        file: label,
        message: `step ${s.id} skill_key '${skillKey}' has no skills/${skillKey}/SKILL.md`,
        severity: "warn",
      });
    }
  }
  return issues;
}

/**
 * checkActivitySkillAlignment — WARN-only (ADR-0185 F-14, audit policy 5.3-2).
 * A procedure step's skill_key should appear in the `skills:` of at least one
 * flow.spec activity that hosts the procedure; otherwise the spec's activity
 * skill list has drifted from the procedure it dispatches. Warn, never error:
 * procedure schemas govern their own steps (AGENTS.md section 7), so this only
 * surfaces the drift for a recorded reconciliation. Steps with no skill_key,
 * TODO placeholders and procedures hosted by no activity are skipped.
 */
/**
 * F-14 cross-cutting exceptions (flow.spec v2.12.0, follow-up batch design A).
 * Rule: a skill is exempt only if it is cross-cutting and not the hosting
 * activity's primary method. Enumerated, never wildcarded.
 *  - stage-gate-governance: the closing "assemble gate proposal / Kill Criteria
 *    check" step of ~14 procedures; gate mechanics belong to the stage gate
 *    itself (flow.spec gates), not to any one activity's method list.
 */
export const F14_CROSS_CUTTING_SKILLS: ReadonlySet<string> = new Set(["stage-gate-governance"]);

export async function checkActivitySkillAlignment(): Promise<Issue[]> {
  const issues: Issue[] = [];
  const specFile = join(PROJECT_ROOT, "process", "flow.spec.yaml");
  if (!existsSync(specFile)) return issues;
  const spec = yaml.load(await readFile(specFile, "utf8")) as {
    stages?: { id: string; activities?: { id: string; skills?: string[]; procedure?: string[] }[] }[];
  };
  const hosted = new Map<string, Set<string>>();
  for (const st of spec.stages ?? []) {
    for (const a of st.activities ?? []) {
      for (const proc of a.procedure ?? []) {
        const set = hosted.get(proc) ?? new Set<string>();
        for (const sk of a.skills ?? []) set.add(sk);
        hosted.set(proc, set);
      }
    }
  }
  for (const [proc, skills] of hosted) {
    const schemaFile = join(ROOT, "_shared", proc, "schema.yaml");
    if (!existsSync(schemaFile)) continue;
    const doc = yaml.load(await readFile(schemaFile, "utf8")) as { steps?: { id: unknown; skill_key?: unknown }[] };
    for (const st of doc.steps ?? []) {
      const sk = st.skill_key;
      if (typeof sk !== "string" || sk.trim() === "" || sk === "TODO") continue;
      if (F14_CROSS_CUTTING_SKILLS.has(sk)) continue;
      if (!skills.has(sk)) {
        issues.push({
          file: schemaFile,
          message: `step ${String(st.id)} skill_key '${sk}' is not in the skills: of any flow.spec activity hosting '${proc}' — reconcile the activity skills list (ADR-0185 F-14)`,
          severity: "warn",
        });
      }
    }
  }
  return issues;
}

/**
 * walkAllSteps — the cross-file pass (PR-0 of the 2026-08-22 RAG
 * formalization design, meeting finding F11's companion). Per-file
 * validation above checks each schema.yaml in isolation; this pass resolves
 * the MERGED step list for every shared procedure × every applicable
 * region/entity layer combination via proc-resolve.ts (which handles
 * add_steps incl. the after:0 sentinel, replace_steps, and thresholds) and
 * checks every merged step against the real agents/ and skills/ trees.
 * A resolve failure is a warn, never a crash.
 */
async function walkAllSteps(humanRoles: Set<string>): Promise<Issue[]> {
  const issues: Issue[] = [];
  const sharedProcedures = await discoverSharedProcedures();
  const regions = await discoverLayerCodes("regions");
  const entities = await discoverLayerCodes("entities");

  for (const name of sharedProcedures) {
    for (const combo of combosFor(name, regions, entities)) {
      let steps: unknown[];
      try {
        steps = resolveProcedure(name, combo.opts).steps;
      } catch (e) {
        issues.push({
          file: `${name} @ ${combo.label}`,
          message: `resolveProcedure failed: ${(e as Error).message}`,
          severity: "warn",
        });
        continue;
      }
      issues.push(...checkStepReferences(`${name} @ ${combo.label}`, steps, humanRoles));
    }
  }
  return issues;
}

// ── Structured applies_when pass (design of record 2026-08-22, Decision 7 / PR-5a) ──

/**
 * Extract the evidence_var seed list from the migration SQL, statically —
 * the validator must not depend on a database. Approach (documented per the
 * PR-5a spec): take the INSERT INTO evidence_var statement, then each
 * tuple's first quoted literal (the var_key column is first in the column
 * list; the column list itself contains no quoted literals, so the
 * `\(\s*'([^']+)'` tuple-shape match cannot pick up anything else).
 * Exported for tests/unit/applies-when.test.ts.
 */
export function seededVarKeys(sql: string): Set<string> {
  const keys = new Set<string>();
  const block = sql.match(/INSERT\s+INTO\s+evidence_var[\s\S]*?;/i);
  if (!block) return keys;
  for (const tuple of block[0].matchAll(/\(\s*'([^']+)'/g)) {
    keys.add(tuple[1]);
  }
  return keys;
}

/**
 * Validate one applies_when value (already loaded from YAML). Free text is
 * an ERROR — a prose sentence can never be evaluated, so it is the exact
 * silent-skip vector this pass exists to close. An unparsable AST and a
 * var_key outside the 0014 seed list are errors for the same reason: the
 * predicate would evaluate UNASSESSED forever with no surfaced defect.
 * Exported for tests/unit/applies-when.test.ts.
 */
export function checkAppliesWhen(file: string, where: string, appliesWhen: unknown, seeded: Set<string>): Issue[] {
  if (typeof appliesWhen === "string") {
    return [
      {
        file,
        message: `${where}: applies_when is free text ('${appliesWhen.slice(0, 60)}${appliesWhen.length > 60 ? "…" : ""}') — must be a structured predicate AST per PredicateSchema (db/lib/predicate.ts), design Decision 7 / PR-5a`,
        severity: "error",
      },
    ];
  }
  let pred;
  try {
    pred = parsePredicate(appliesWhen);
  } catch (e) {
    return [{ file, message: `${where}: applies_when does not parse as a predicate AST — ${(e as Error).message}`, severity: "error" }];
  }
  const issues: Issue[] = [];
  for (const varKey of collectPredicateVars(pred)) {
    if (!seeded.has(varKey)) {
      issues.push({
        file,
        message: `${where}: applies_when references var_key '${varKey}' — not seeded in the routing-var migrations (0014, 0136) (the registry is the only legal var vocabulary)`,
        severity: "error",
      });
    }
  }
  return issues;
}

/** Load the seed set once per run; a missing/unreadable migration file is itself an error. */
async function loadSeedSet(): Promise<{ seeded: Set<string>; error: Issue | null }> {
  try {
    const seeded = new Set<string>();
    for (const file of ROUTING_VARS_MIGRATIONS) {
      for (const key of seededVarKeys(await readFile(file, "utf-8"))) seeded.add(key);
    }
    return { seeded, error: null };
  } catch (e) {
    return {
      seeded: new Set<string>(),
      error: {
        file: ROUTING_VARS_MIGRATION,
        message: `cannot read the evidence_var seed migration — applies_when var_key checks skipped blind: ${(e as Error).message}`,
        severity: "error",
      },
    };
  }
}

// ── Human-role registry + output_type vocabulary (design of record 2026-08-22, PR-8 / ADR-0053) ──

/**
 * Load the human-role registry once per run. Unreadable ⇒ error + empty set,
 * mirroring loadSeedSet: with an empty set no key earns the exemption, so the
 * missing-agent warn fires for entity-ic-reviewer — the check degrades
 * loudly, never silently.
 */
async function loadHumanRoles(): Promise<{ roles: Set<string>; error: Issue | null }> {
  try {
    const doc = yaml.load(await readFile(HUMAN_ROLES_FILE, "utf-8"), { schema: yaml.JSON_SCHEMA }) as
      | { human_roles?: Record<string, unknown> }
      | null;
    return { roles: new Set(Object.keys(doc?.human_roles ?? {})), error: null };
  } catch (e) {
    return {
      roles: new Set<string>(),
      error: {
        file: HUMAN_ROLES_FILE,
        message: `cannot read the human-role registry — the agent_key exemption check ran blind: ${(e as Error).message}`,
        severity: "error",
      },
    };
  }
}

/**
 * Load the output_type vocabulary once per run. Unreadable ⇒ error + empty
 * set, in which case every non-placeholder output_type errors — fail-closed:
 * a vocabulary gate that silently passes on a broken registry is no gate.
 */
async function loadOutputTypes(): Promise<{ types: Set<string>; error: Issue | null }> {
  try {
    const doc = yaml.load(await readFile(OUTPUT_TYPES_FILE, "utf-8"), { schema: yaml.JSON_SCHEMA }) as
      | { output_types?: Record<string, unknown> }
      | null;
    return { types: new Set(Object.keys(doc?.output_types ?? {})), error: null };
  } catch (e) {
    return {
      types: new Set<string>(),
      error: {
        file: OUTPUT_TYPES_FILE,
        message: `cannot read the output_type registry — every non-placeholder output_type below will be flagged until it is fixed: ${(e as Error).message}`,
        severity: "error",
      },
    };
  }
}

// ── Stage aliases registry pass (ADR-0083) ──────────────────────────────────

/**
 * Load the stage-aliases registry once per run. Unreadable ⇒ error + empty map
 * (mirrors loadHumanRoles): with an empty map no gate earns validation, so
 * the coverage check (SA-2) fires for every gate value — the check degrades
 * loudly, never silently.
 */
async function loadStageAliases(): Promise<{
  aliases: Map<string, { stage: string; note?: string; reference?: string }>;
  stages: Set<string>;
  error: Issue | null;
}> {
  try {
    if (!existsSync(STAGE_ALIASES_FILE)) {
      return {
        aliases: new Map(),
        stages: new Set(),
        error: {
          file: STAGE_ALIASES_FILE,
          message: `process/stage-aliases.yaml not found — stage alias checks skipped blind`,
          severity: "error",
        },
      };
    }
    const doc = yaml.load(await readFile(STAGE_ALIASES_FILE, "utf-8"), { schema: yaml.JSON_SCHEMA }) as {
      schema_version?: unknown;
      variant?: unknown;
      aliases?: Record<string, unknown>;
    } | null;

    // SA-1: registry loads, schema_version + variant correct
    if (!doc || typeof doc !== "object") {
      return {
        aliases: new Map(),
        stages: new Set(),
        error: { file: STAGE_ALIASES_FILE, message: `Document is not a YAML mapping`, severity: "error" },
      };
    }
    if (doc.schema_version !== "1.0") {
      return {
        aliases: new Map(),
        stages: new Set(),
        error: {
          file: STAGE_ALIASES_FILE,
          message: `schema_version must be "1.0" (got ${JSON.stringify(doc.schema_version)})`,
          severity: "error",
        },
      };
    }
    if (doc.variant !== "co-newbiz") {
      return {
        aliases: new Map(),
        stages: new Set(),
        error: {
          file: STAGE_ALIASES_FILE,
          message: `variant must be "co-newbiz" (got ${JSON.stringify(doc.variant)})`,
          severity: "error",
        },
      };
    }

    const aliases = new Map<string, { stage: string; note?: string; reference?: string }>();
    if (typeof doc.aliases === "object" && doc.aliases !== null) {
      for (const [gate, raw] of Object.entries(doc.aliases)) {
        if (typeof raw !== "object" || raw === null) continue;
        const alias = raw as Record<string, unknown>;
        const stage = alias.stage;
        if (typeof stage !== "string") continue;
        aliases.set(gate.trim(), {
          stage,
          note: typeof alias.note === "string" ? alias.note : undefined,
          reference: typeof alias.reference === "string" ? alias.reference : undefined,
        });
      }
    }

    // Also load stages to validate against (for SA-3)
    let stages = new Set<string>();
    if (existsSync(STAGES_FILE)) {
      try {
        const stagesDoc = yaml.load(await readFile(STAGES_FILE, "utf-8"), { schema: yaml.JSON_SCHEMA }) as {
          stages?: Array<{ id?: unknown }>;
        } | null;
        if (stagesDoc && Array.isArray(stagesDoc.stages)) {
          for (const s of stagesDoc.stages) {
            if (typeof s === "object" && s !== null && typeof (s as Record<string, unknown>).id === "string") {
              stages.add((s as Record<string, unknown>).id as string);
            }
          }
        }
      } catch {
        // If stages.yaml is unreadable, SA-3 will catch it; don't fail here
      }
    }

    return { aliases, stages, error: null };
  } catch (e) {
    return {
      aliases: new Map(),
      stages: new Set(),
      error: {
        file: STAGE_ALIASES_FILE,
        message: `cannot read the stage-aliases registry: ${(e as Error).message}`,
        severity: "error",
      },
    };
  }
}

/**
 * Validate stage aliases. Static pass after all procedures are loaded.
 * Returns SA-2, SA-3, SA-4, SA-5 issues.
 * Exported for tests/unit/stage-aliases-registry.test.ts.
 */
export function validateStageAliases(
  declaredGates: Map<string, string>, // gate value -> file
  aliases: Map<string, { stage: string; note?: string; reference?: string }>,
  stages: Set<string>
): Issue[] {
  const issues: Issue[] = [];

  // SA-2: every gate: value used in procedures has a matching alias entry
  // (skip _template/schema.yaml's TODO sentinel)
  for (const [gate, file] of declaredGates) {
    if (gate === "TODO") continue; // Template sentinel, skip per design §6.1
    if (!aliases.has(gate)) {
      issues.push({
        file,
        message: `gate '${gate}' is not listed in process/stage-aliases.yaml — add the alias entry in the same change`,
        severity: "error",
      });
    }
  }

  // SA-3: every alias's .stage must be an id declared in process/stages.yaml
  // (ADR-0149: gate-axis ids come from the declared set, whatever their
  // prefix — G1-G8 today; never a hard-coded pattern over the prefix).
  for (const [gate, alias] of aliases) {
    const stageId = alias.stage;
    if (!stages.has(stageId)) {
      issues.push({
        file: STAGE_ALIASES_FILE,
        message: `alias '${gate}' names stage '${stageId}' which is not declared in process/stages.yaml`,
        severity: "error",
      });
    }
  }

  // SA-5: every declared stage id must be referenced by at least one alias
  // (fail-closed in both directions, per the stage-aliases.yaml header).
  for (const stageId of stages) {
    if (![...aliases.values()].some((a) => a.stage === stageId)) {
      issues.push({
        file: STAGES_FILE,
        message: `stage '${stageId}' is declared in process/stages.yaml but referenced by no alias in process/stage-aliases.yaml`,
        severity: "error",
      });
    }
  }

  // SA-4: every alias key is used by at least one procedure (warning, not error)
  const usedGates = new Set(declaredGates.keys());
  usedGates.delete("TODO"); // Skip template sentinel
  for (const gate of aliases.keys()) {
    if (!usedGates.has(gate)) {
      issues.push({
        file: STAGE_ALIASES_FILE,
        message: `alias '${gate}' is unused by any procedure — remove it or confirm it is reserved`,
        severity: "warn",
      });
    }
  }

  return issues;
}

// ── Committee registry pass (ADR-0097 §2/§4) ────────────────────────────────

const DECISION_MODES = new Set(["human_only", "agent_team", "hybrid"]);
/** The red-team seat every committee must carry (ADR-0097 §2). */
const MANDATORY_RED_TEAM_KEY = "risk-officer";

export interface CommitteeMemberDef {
  type: unknown;
  key: unknown;
  applies_when?: unknown;
  veto_dissent?: unknown;
}
export interface CommitteeDef {
  applies_to: unknown;
  description?: unknown;
  chair: unknown;
  rounds: unknown;
  decision_modes_allowed: unknown;
  members: unknown;
}

/**
 * Resolve one member/chair key against the two registries: an `agent` key
 * must name agents/<key>.md; a `human_role` key must be listed in
 * _human-roles.yaml. Exported for tests/unit/committee-boundary.test.ts.
 */
export function checkCommitteeKey(file: string, where: string, type: unknown, key: unknown, humanRoles: Set<string>): Issue | null {
  if (typeof key !== "string" || key.trim() === "") {
    return { file, message: `${where}: member key is missing or empty`, severity: "error" };
  }
  if (type === "agent") {
    if (!existsSync(join(PROJECT_ROOT, "agents", `${key}.md`))) {
      return { file, message: `${where}: agent key '${key}' has no agents/${key}.md`, severity: "error" };
    }
    return null;
  }
  if (type === "human_role") {
    if (!humanRoles.has(key)) {
      return { file, message: `${where}: human_role key '${key}' is not listed in procedures/_human-roles.yaml — add the registry entry in the same change`, severity: "error" };
    }
    return null;
  }
  return { file, message: `${where}: member type must be 'agent' or 'human_role' (got ${JSON.stringify(type)})`, severity: "error" };
}

/**
 * Validate the whole _committees.yaml document. Static — mirrors the
 * kill-criteria pass in shape (load once, loud, error-vs-warn discipline).
 * Exported for tests/unit/committee-boundary.test.ts.
 */
export function validateCommitteeRegistry(doc: unknown, humanRoles: Set<string>): { issues: Issue[]; committeeCount: number } {
  const issues: Issue[] = [];
  const file = COMMITTEES_FILE;
  if (typeof doc !== "object" || doc === null) {
    return { issues: [{ file, message: "Document is not a YAML mapping", severity: "error" }], committeeCount: 0 };
  }
  const committees = (doc as { committees?: unknown }).committees;
  if (typeof committees !== "object" || committees === null || Object.keys(committees as object).length === 0) {
    return { issues: [{ file, message: "'committees' mapping is missing or empty — the registry is the single inventory", severity: "error" }], committeeCount: 0 };
  }

  for (const [key, raw] of Object.entries(committees as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) {
      issues.push({ file, message: `committee '${key}' is not a YAML mapping`, severity: "error" });
      continue;
    }
    const c = raw as CommitteeDef;
    const where = `committee '${key}'`;
    if (typeof c.applies_to !== "string" || c.applies_to.trim() === "") {
      issues.push({ file, message: `${where}: missing required field 'applies_to' (stage/gate scope)`, severity: "error" });
    }

    // (d) rounds >= 1.
    if (typeof c.rounds !== "number" || !Number.isInteger(c.rounds) || c.rounds < 1) {
      issues.push({ file, message: `${where}: 'rounds' must be an integer >= 1 (got ${JSON.stringify(c.rounds)})`, severity: "error" });
    }

    // (c) decision_modes_allowed closed enum.
    if (!Array.isArray(c.decision_modes_allowed) || (c.decision_modes_allowed as unknown[]).length === 0) {
      issues.push({ file, message: `${where}: 'decision_modes_allowed' must be a non-empty list`, severity: "error" });
    } else {
      for (const mode of c.decision_modes_allowed as unknown[]) {
        if (typeof mode !== "string" || !DECISION_MODES.has(mode)) {
          issues.push({ file, message: `${where}: decision mode ${JSON.stringify(mode)} is outside the closed enum human_only | agent_team | hybrid`, severity: "error" });
        }
      }
    }

    // Chair — recorder-pattern synthesizer (ADR-0053); resolves like a member key.
    const chairIssue = checkCommitteeKey(file, `${where} chair`, "agent", c.chair, humanRoles);
    if (chairIssue) issues.push(chairIssue);

    // (a) member key existence + (b) mandatory red-team seat.
    if (!Array.isArray(c.members) || (c.members as unknown[]).length === 0) {
      issues.push({ file, message: `${where}: 'members' must be a non-empty list`, severity: "error" });
      continue;
    }
    let hasRedTeam = false;
    for (const [i, rawMember] of (c.members as unknown[]).entries()) {
      if (typeof rawMember !== "object" || rawMember === null) {
        issues.push({ file, message: `${where}: members[${i}] is not a mapping`, severity: "error" });
        continue;
      }
      const m = rawMember as CommitteeMemberDef;
      const issue = checkCommitteeKey(file, `${where} members[${i}]`, m.type, m.key, humanRoles);
      if (issue) {
        issues.push(issue);
        continue;
      }
      if (m.key === MANDATORY_RED_TEAM_KEY) {
        hasRedTeam = true;
        if (m.veto_dissent !== true) {
          // The verbatim-dissent contract rides on this flag (ADR-0097 §2);
          // a red-team seat without it is a silent downgrade.
          issues.push({ file, message: `${where}: the risk-officer (red team) seat must set veto_dissent: true — the verbatim-dissent contract depends on it`, severity: "error" });
        }
      } else if (m.veto_dissent === true) {
        issues.push({ file, message: `${where}: members[${i}] ('${String(m.key)}') carries veto_dissent but is not the red-team seat — veto_dissent belongs to risk-officer only`, severity: "error" });
      }
    }
    if (!hasRedTeam) {
      issues.push({
        file,
        message: `${where}: no risk-officer membership — the red-team seat is MANDATORY on every committee (ADR-0097 §2); removing it requires a new ADR, not a config edit`,
        severity: "error",
      });
    }
  }

  return { issues, committeeCount: Object.keys(committees as object).length };
}

/** Load the committee registry once per run. Unreadable ⇒ error + 0 committees. */
async function loadCommittees(): Promise<{ doc: unknown; error: Issue | null }> {
  try {
    return { doc: yaml.load(await readFile(COMMITTEES_FILE, "utf-8"), { schema: yaml.JSON_SCHEMA }), error: null };
  } catch (e) {
    return { doc: null, error: { file: COMMITTEES_FILE, message: `cannot read the committee registry: ${(e as Error).message}`, severity: "error" } };
  }
}

// ── Kill-criteria registry pass (design of record 2026-08-22, Decision 8) ──

const KILL_CRITERIA_DIR = join(ROOT, "_kill-criteria");
const BASELINE_FILE = join(KILL_CRITERIA_DIR, "_baseline.json");

/** One declared criterion, keyed `${procedure}::${condition}` across passes. */
interface DeclaredCriterion {
  procedure: string;
  condition: string;
  file: string;
}

interface RegistryEntry {
  procedure: string;
  criterion_id: string;
  predicate: unknown;
  enabled: unknown;
  policy_id: unknown;
  thresholds_source: unknown;
}

interface KillCriteriaStats {
  declaredCount: number;
  entryCount: number;
  executable: number;
}

/**
 * Cross-checks the procedures/_kill-criteria/ registry against what the
 * schema.yaml files actually declare. JSON has no CHECK constraints, so this
 * pass is where the rag_rule-style anti-tamper gate lives for the registry:
 * enabled:true requires policy_id AND thresholds_source (check c). With
 * --strict, an executable-count drop below the checked-in baseline is an
 * error (check e, risk-officer F7) — the baseline never auto-lowers.
 */
async function validateKillCriteria(
  declared: Map<string, DeclaredCriterion>,
  strict: boolean
): Promise<{ issues: Issue[]; stats: KillCriteriaStats }> {
  const issues: Issue[] = [];
  const entries: { entry: RegistryEntry; file: string }[] = [];

  let files: string[] = [];
  try {
    files = (await readdir(KILL_CRITERIA_DIR)).filter(
      (f) => f.endsWith(".json") && f !== "_baseline.json"
    );
  } catch {
    issues.push({
      file: KILL_CRITERIA_DIR,
      message: "kill-criteria registry directory missing — expected procedures/_kill-criteria/ (design Decision 8)",
      severity: "error",
    });
    return { issues, stats: { declaredCount: declared.size, entryCount: 0, executable: 0 } };
  }

  for (const f of files) {
    const file = join(KILL_CRITERIA_DIR, f);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file, "utf-8"));
    } catch (e) {
      issues.push({ file, message: `JSON parse error: ${(e as Error).message}`, severity: "error" });
      continue;
    }
    const entry = raw as RegistryEntry;
    if (
      typeof entry.procedure !== "string" ||
      typeof entry.criterion_id !== "string" ||
      entry.predicate === undefined ||
      entry.enabled === undefined
    ) {
      issues.push({
        file,
        message: "registry entry missing required fields (procedure, criterion_id, predicate, enabled) — see procedures/_kill-criteria/README.md",
        severity: "error",
      });
      continue;
    }
    entries.push({ entry, file });
  }

  // (a) coverage: every declared criterion must have a registry entry.
  const registered = new Set(entries.map(({ entry }) => `${entry.procedure}::${entry.criterion_id}`));
  for (const d of declared.values()) {
    if (!registered.has(`${d.procedure}::${d.condition}`)) {
      issues.push({
        file: d.file,
        message: `kill criterion '${d.condition}' has no registry entry — expected procedures/_kill-criteria/${d.procedure}__${d.condition}.json (the registry is the single inventory)`,
        severity: "error",
      });
    }
  }

  const executable = entries.filter(({ entry }) => entry.predicate !== null).length;

  for (const { entry, file } of entries) {
    const key = `${entry.procedure}::${entry.criterion_id}`;

    // (d) orphan: a registry entry no YAML declares.
    if (!declared.has(key)) {
      issues.push({
        file,
        message: `orphan registry entry — no schema.yaml declares kill criterion '${entry.criterion_id}' for procedure '${entry.procedure}'`,
        severity: "error",
      });
    }

    // (b) inert: declared but not executable — visible every run, by design.
    if (entry.predicate === null) {
      issues.push({
        file,
        message: `declared-but-inert: '${entry.criterion_id}' has no executable predicate (design Decision 8 — set thresholds before adding one)`,
        severity: "warn",
      });
    }

    // (c) anti-tamper: enabling requires both governance anchors (meeting
    // 2026-08-22 classification-practice #6c — same gate as rag_rule).
    if (entry.enabled === true) {
      const missing: string[] = [];
      if (typeof entry.policy_id !== "string" || entry.policy_id.trim() === "") missing.push("policy_id");
      if (typeof entry.thresholds_source !== "string" || entry.thresholds_source.trim() === "") missing.push("thresholds_source");
      if (missing.length > 0) {
        issues.push({
          file,
          message: `anti-tamper violation: enabled=true without ${missing.join(" and ")} — enabling a kill criterion requires its governance anchor (mirrors rag_rule CHECK, migration 0012)`,
          severity: "error",
        });
      }
    }
  }

  // (e) --strict: executable count must not regress below the baseline.
  if (strict) {
    let baseline: number | null = null;
    try {
      baseline = (JSON.parse(await readFile(BASELINE_FILE, "utf-8")) as { executable_count: number }).executable_count;
    } catch {
      issues.push({
        file: BASELINE_FILE,
        message: "--strict requires a readable {\"executable_count\": N} baseline",
        severity: "error",
      });
    }
    if (baseline !== null) {
      if (executable < baseline) {
        issues.push({
          file: BASELINE_FILE,
          message: `executable kill criteria regressed: ${executable} < baseline ${baseline}. If the drop is a conscious decision, re-baseline by editing _baseline.json IN THE SAME CHANGE (never auto-lowered) — otherwise restore the predicates`,
          severity: "error",
        });
      } else if (executable > baseline) {
        console.log(
          `ℹ️ executable kill criteria rose to ${executable} (baseline ${baseline}) — bump _baseline.json in the same change so regressions stay gated.`
        );
      }
    }
  }

  return { issues, stats: { declaredCount: declared.size, entryCount: entries.length, executable } };
}

async function main() {
  const files = await findSchemaFiles(ROOT);
  if (files.length === 0) {
    console.error("No procedures/**/schema.yaml files found.");
    process.exit(1);
  }

  const allIssues: Issue[] = [];
  const standaloneStepDocs: { label: string; steps: unknown[] }[] = [];
  const declaredKillCriteria = new Map<string, DeclaredCriterion>();
  const declaredGates = new Map<string, string>(); // gate value -> file path

  // PR-5a: load the var_key vocabulary once — every applies_when below is
  // checked against it in the same pass that parses it.
  const { seeded, error: seedError } = await loadSeedSet();
  if (seedError) allIssues.push(seedError);

  // PR-8 / ADR-0053: load the human-role registry and the output_type
  // vocabulary once — threaded into every pass below.
  const { roles: humanRoles, error: humanRolesError } = await loadHumanRoles();
  if (humanRolesError) allIssues.push(humanRolesError);
  const { types: outputTypes, error: outputTypesError } = await loadOutputTypes();
  if (outputTypesError) allIssues.push(outputTypesError);
  const usedOutputTypes = new Set<string>();

  // ADR-0083: load the stage-aliases registry and stages list once.
  const { aliases: stageAliases, stages: stageIds, error: stageAliasesError } = await loadStageAliases();
  if (stageAliasesError) allIssues.push(stageAliasesError);

  for (const file of files) {
    const raw = await readFile(file, "utf-8");
    let doc: unknown;
    try {
      doc = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
    } catch (e) {
      allIssues.push({ file, message: `YAML parse error: ${(e as Error).message}`, severity: "error" });
      continue;
    }
    allIssues.push(...validateSchema(file, doc, outputTypes));

    const p = doc as Record<string, unknown>;

    // ADR-0083: collect gate values for stage-alias validation (SA-2)
    const gate = p.gate;
    if (typeof gate === "string" && gate.trim() !== "") {
      // Trim whitespace and use the normalized scalar (js-yaml already strips comments)
      declaredGates.set(gate.trim(), file);
    }

    // Structured applies_when pass (Decision 7 / PR-5a) — procedure-level and
    // step-level, on the raw per-file docs (merge never invents predicates,
    // so the per-file pass covers every layer file too).
    if (p.applies_when !== undefined) {
      allIssues.push(...checkAppliesWhen(file, "procedure-level", p.applies_when, seeded));
    }
    for (const { label, step: s } of declaredSteps(p)) {
      if (s.applies_when !== undefined) {
        const where = `${label}${s.id !== undefined ? ` (id ${String(s.id)})` : ""}`;
        allIssues.push(...checkAppliesWhen(file, where, s.applies_when, seeded));
      }
      // Track real (non-placeholder) output_type usage for the dead-vocabulary warn.
      const ot = s.output_type;
      if (typeof ot === "string" && ot.trim() !== "" && ot !== "TODO") usedOutputTypes.add(ot);
    }

    // Collect declared kill criteria for the registry pass. The procedure
    // namespace is the schema.yaml's parent directory name (identical for
    // _shared/<name>/ and regions|entities/<code>/<name>/), matching how
    // proc-resolve merges kill_criteria: they belong to the procedure.
    if (Array.isArray(p.kill_criteria)) {
      const procedure = basename(dirname(file));
      for (const kc of p.kill_criteria as unknown[]) {
        if (typeof kc !== "object" || kc === null) continue;
        const condition = (kc as Record<string, unknown>).condition;
        if (typeof condition !== "string" || condition.trim() === "") {
          allIssues.push({ file, message: "kill_criteria item without a non-empty 'condition'", severity: "error" });
          continue;
        }
        const key = `${procedure}::${condition}`;
        if (!declaredKillCriteria.has(key)) {
          declaredKillCriteria.set(key, { procedure, condition, file });
        }
      }
    }

    // Standalone-scope docs (scope: entity/region) that declare their own
    // steps get the same referential-integrity check as merged combos.
    if ((p.scope === "entity" || p.scope === "region") && Array.isArray(p.steps) && p.steps.length > 0) {
      standaloneStepDocs.push({ label: `${p.procedure_id ?? file} @ standalone`, steps: p.steps });
    }
  }

  // PR-8 dead-vocabulary pass: a registry entry no schema.yaml produces is
  // visible every run — wire it up or remove it consciously.
  for (const key of outputTypes) {
    if (!usedOutputTypes.has(key)) {
      allIssues.push({
        file: OUTPUT_TYPES_FILE,
        message: `unused output_type registry entry '${key}' — no step in any schema.yaml produces it (dead vocabulary; wire it up or remove it in a conscious change)`,
        severity: "warn",
      });
    }
  }

  allIssues.push(...(await walkAllSteps(humanRoles)));
  allIssues.push(...(await checkActivitySkillAlignment()));
  // ADR-0187 P2 (M2): blocking rule activity-agent-in-procedure.
  {
    const { checkActivityAgentInProcedure, loadFlowSpec, loadProcedures } = await import("../scripts/co-newbiz/process-ssot-check.ts");
    for (const f of checkActivityAgentInProcedure(loadFlowSpec(PROJECT_ROOT), loadProcedures(PROJECT_ROOT))) {
      allIssues.push({ file: join(PROJECT_ROOT, "process", "flow.spec.yaml"), message: `activity-agent-in-procedure: ${f.message}`, severity: "error" });
    }
  }
  for (const d of standaloneStepDocs) {
    allIssues.push(...checkStepReferences(d.label, d.steps, humanRoles));
  }

  allIssues.push(...(await lintSkillsForGateSteps()));

  // ADR-0083: stage-aliases registry pass — SA-2, SA-3, SA-4 (SA-1 already
  // checked in loadStageAliases).
  allIssues.push(...validateStageAliases(declaredGates, stageAliases, stageIds));

  // ADR-0097 §4: committee registry pass — every pass above shares the
  // human-role set, so it is loaded before this point.
  const { doc: committeesDoc, error: committeesError } = await loadCommittees();
  if (committeesError) allIssues.push(committeesError);
  const committeePass = validateCommitteeRegistry(committeesDoc, humanRoles);
  allIssues.push(...committeePass.issues);

  const { issues: killCriteriaIssues, stats: killCriteriaStats } = await validateKillCriteria(
    declaredKillCriteria,
    process.argv.includes("--strict")
  );
  allIssues.push(...killCriteriaIssues);

  const errors = allIssues.filter((i) => i.severity === "error");
  const warnings = allIssues.filter((i) => i.severity === "warn");

  // F11 fix: warnings are always printed — no VERBOSE gate, no
  // errors-present gate. Silent warnings are swallowed findings.
  for (const i of allIssues) {
    console.log(`[${i.severity === "error" ? "ERROR" : "WARN"}] ${i.file} — ${i.message}`);
  }

  console.log(`\nProcedure validation: ${files.length} procedure(s), ${errors.length} error(s), ${warnings.length} warning(s).`);
  console.log(
    `kill-criteria: ${killCriteriaStats.declaredCount} declared / ${killCriteriaStats.executable} executable (registry)`
  );
  console.log(`output_types: ${usedOutputTypes.size} used / ${outputTypes.size} registered (vocabulary)`);
  console.log(`committees: ${committeePass.committeeCount} registered (ADR-0097)`);
  if (errors.length > 0) {
    console.error("❌ Procedure validation failed.");
    process.exit(1);
  }
  console.log("✅ Procedure validation passed.");
}

// Guarded so tests can import the pass functions without running the CLI
// (same pattern as db/migrate.ts).
if (import.meta.main) main();
