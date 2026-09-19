// @version 1.2.0
/**
 * graph:map — procedure→agent/skill graph mapping over the MERGED procedure
 * space. Walks every shared procedure × every applicable region/entity layer
 * combination, resolves each combo through proc-resolve.ts (add_steps incl.
 * the after:0 sentinel, replace_steps, thresholds), and reports which agents
 * and skills the procedure graph actually depends on.
 *
 * The layer discovery is intentionally self-contained rather than imported
 * from procedures/_validate.ts: _validate.ts runs main() at module load (no
 * import.meta.main guard), so importing it would execute the whole
 * validation pass as a side effect. A shared helper module would be a third
 * file for ~30 lines of discovery code.
 *
 * v1.1.0 (design of record 2026-08-22, plan row PR-8 — skill graph
 * hardening): three new passes, all gating --check —
 *   (a) HUMAN-ROLE REGISTRY (ADR-0053): agent_key values listed in
 *       procedures/_human-roles.yaml name human roles, not AI agents — they
 *       are exempt from the agents/<key>.md existence check (the missing file
 *       is the point), and conversely a registry key used on a step WITHOUT
 *       `decision_authority: human` is an error (a human role appearing as an
 *       unmarked executor is a modeling defect). Resolves the standing
 *       entity-ic-reviewer finding.
 *   (b) SKILL GRAPH METADATA: SKILL.md frontmatter gains four optional
 *       metadata fields — procedure_keys (the inverse graph edge),
 *       requires_skills, related_skills, requires_tools. Unknown keys in any
 *       list are errors; see checkSkillGraph.
 *   (c) BIDIRECTIONAL CONTRACT: every merged (procedure → skill) edge must
 *       be acknowledged by the skill's metadata.procedure_keys — the graph
 *       edge and the skill's self-description must not drift apart.
 *
 * Usage:
 *   bun scripts/co-newbiz/graph-map.ts          # human-readable summary
 *   bun scripts/co-newbiz/graph-map.ts --json   # full mapping as JSON
 *   bun scripts/co-newbiz/graph-map.ts --check  # referential-integrity gate
 *                                              # (exit 1 when any merged step
 *                                              # references a missing
 *                                              # agents/<key>.md or
 *                                              # skills/<key>/SKILL.md, or
 *                                              # any graph/metadata error)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import * as yaml from "js-yaml";
import { resolveProcedure } from "./proc-resolve.ts";

const PROJECT_ROOT = resolvePath(import.meta.dirname, "..", "..");
const PROCEDURES_ROOT = join(PROJECT_ROOT, "procedures");
const AGENTS_DIR = join(PROJECT_ROOT, "agents");
const SKILLS_DIR = join(PROJECT_ROOT, "skills");
const HUMAN_ROLES_FILE = join(PROCEDURES_ROOT, "_human-roles.yaml");
const GRAPH_JSON_FILE = join(PROJECT_ROOT, "docs", "graph", "graph.json");

/**
 * Read the human-role registry statically (ADR-0053). Unreadable or missing
 * registry ⇒ empty set ⇒ no exemptions ⇒ the missing-agent check fails
 * loudly. Fail-closed on purpose: the registry is the anti-gaming surface for
 * the decision_authority skip.
 */
export function loadHumanRoles(): Set<string> {
  try {
    const doc = yaml.load(readFileSync(HUMAN_ROLES_FILE, "utf-8"), { schema: yaml.JSON_SCHEMA }) as
      | { human_roles?: Record<string, unknown> }
      | null;
    return new Set(Object.keys(doc?.human_roles ?? {}));
  } catch {
    return new Set();
  }
}

/** Shared procedures = directories under procedures/_shared/ holding a schema.yaml. */
function discoverSharedProcedures(): string[] {
  return readdirSync(join(PROCEDURES_ROOT, "_shared"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(PROCEDURES_ROOT, "_shared", e.name, "schema.yaml")))
    .map((e) => e.name)
    .sort();
}

/** Region/entity layer codes, discovered dynamically — never hardcode "EU"/"ent-a". */
function discoverLayerCodes(kind: "regions" | "entities"): string[] {
  try {
    return readdirSync(join(PROCEDURES_ROOT, kind), { withFileTypes: true })
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
      .filter((r) => existsSync(join(PROCEDURES_ROOT, "regions", r, name, "schema.yaml")))
      .map((r) => ({ kind: "region" as const, code: r })),
    ...entities
      .filter((e) => existsSync(join(PROCEDURES_ROOT, "entities", e, name, "schema.yaml")))
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

interface MappedStep {
  id: number | string;
  gate: string;
  agent_key: string;
  /** ADR-0053 marker: the step's output binds on human authority. Only legal value: "human". */
  decision_authority?: "human";
  skill_key: string;
  output_type: string;
  source: string;
}

interface MappedCombo {
  procedure: string;
  combo: string;
  layers_applied: string[];
  steps: MappedStep[];
}

export interface GraphMap {
  generated_from: { procedures: number; combos: number };
  procedures: MappedCombo[];
  missing: { agents: string[]; skills: string[] };
  /** v1.1.0: human-role consistency + skill-graph metadata + bidirectional-contract errors. */
  errors: string[];
}

/**
 * proc-resolve's Step interface does not declare ADR-0053's optional field,
 * but the merge spreads unknown YAML fields through — read it defensively.
 */
function decisionAuthorityOf(step: { agent_key: string } & Record<string, unknown>): "human" | undefined {
  return step.decision_authority === "human" ? "human" : undefined;
}

export function buildGraphMap(): GraphMap {
  const sharedProcedures = discoverSharedProcedures();
  const regions = discoverLayerCodes("regions");
  const entities = discoverLayerCodes("entities");
  const humanRoles = loadHumanRoles();
  const errors: string[] = [];

  const procedures: MappedCombo[] = [];
  const agentKeys = new Set<string>();
  const skillKeys = new Set<string>();

  for (const name of sharedProcedures) {
    for (const combo of combosFor(name, regions, entities)) {
      let result;
      try {
        result = resolveProcedure(name, combo.opts);
      } catch (e) {
        // Same policy as _validate.ts's walkAllSteps: a resolve failure is a
        // warn on stderr, never a crash of the whole mapping.
        console.error(`[warn] ${name} @ ${combo.label}: resolveProcedure failed: ${(e as Error).message}`);
        continue;
      }
      procedures.push({
        procedure: name,
        combo: combo.label,
        layers_applied: result.layersApplied,
        steps: result.steps.map((s) => {
          const step = s as unknown as Record<string, unknown> & { id: number | string; gate: string; agent_key: string; skill_key: string; output_type: string };
          return {
            id: step.id,
            gate: step.gate,
            agent_key: step.agent_key,
            decision_authority: decisionAuthorityOf(step as never),
            skill_key: step.skill_key,
            output_type: step.output_type,
            source: step._source ?? "shared",
          };
        }),
      });
      for (const s of result.steps) {
        if (typeof s.agent_key === "string" && s.agent_key.trim() !== "") agentKeys.add(s.agent_key);
        if (typeof s.skill_key === "string" && s.skill_key.trim() !== "") skillKeys.add(s.skill_key);
        // ADR-0053 consistency: a registry key used WITHOUT the marking.
        if (humanRoles.has(s.agent_key) && (s as Record<string, unknown>).decision_authority !== "human") {
          errors.push(
            `${name} @ ${combo.label} step ${s.id}: agent_key '${s.agent_key}' is a registered human role (procedures/_human-roles.yaml) but the step lacks decision_authority: human`
          );
        }
      }
    }
  }

  // ADR-0053 registry integrity: a human-role key must never ALSO have an
  // agents/<key>.md — the role would silently become an agent again, and the
  // missing file (the point of the exemption) would stop being missing.
  for (const role of humanRoles) {
    if (existsSync(join(AGENTS_DIR, `${role}.md`))) {
      errors.push(
        `human role '${role}' must not have an agents/${role}.md — remove the file or the registry entry (procedures/_human-roles.yaml, ADR-0053)`
      );
    }
  }

  const map: GraphMap = {
    generated_from: { procedures: sharedProcedures.length, combos: procedures.length },
    procedures,
    missing: {
      // Human-role registry keys are exempt by design (ADR-0053): no
      // agents/<key>.md may exist for a human role.
      agents: [...agentKeys].filter((k) => !humanRoles.has(k) && !existsSync(join(AGENTS_DIR, `${k}.md`))).sort(),
      skills: [...skillKeys].filter((k) => !existsSync(join(SKILLS_DIR, k, "SKILL.md"))).sort(),
    },
    errors,
  };
  map.errors.push(...checkSkillGraph(map));
  return map;
}

// ── Skill graph metadata pass (PR-8: metadata fields + bidirectional contract) ──

/** The four optional SKILL.md frontmatter fields under `metadata:` (PR-8). */
export type SkillGraphField = "procedure_keys" | "requires_skills" | "related_skills" | "requires_tools";

/**
 * Extract one metadata field as a string list. Absent/null ⇒ [] (the fields
 * are optional). Present-but-malformed ⇒ one error, treated as empty — the
 * field must be a list of non-empty strings.
 */
function stringList(meta: Record<string, unknown>, field: SkillGraphField, skill: string, errors: string[]): string[] {
  const v = meta[field];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || (x as string).trim() === "")) {
    errors.push(`skill '${skill}': metadata.${field} must be a list of non-empty strings`);
    return [];
  }
  return v as string[];
}

/** Parse a SKILL.md's frontmatter block; null when absent or unparsable. */
export function parseSkillFrontmatter(content: string): Record<string, unknown> | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("---", 3);
  if (end === -1) return null;
  try {
    return yaml.load(content.slice(3, end), { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Pure: one skill's declared graph metadata against the known universes.
 * Exported for tests/unit/skill-graph.test.ts.
 */
export function checkSkillMetadata(
  skill: string,
  meta: Record<string, unknown>,
  knownProcedures: Set<string>,
  knownSkills: Set<string>
): string[] {
  const errors: string[] = [];
  for (const key of stringList(meta, "procedure_keys", skill, errors)) {
    if (!knownProcedures.has(key)) {
      errors.push(`skill '${skill}': metadata.procedure_keys entry '${key}' is not a shared procedure directory`);
    }
  }
  for (const field of ["requires_skills", "related_skills"] as const) {
    for (const key of stringList(meta, field, skill, errors)) {
      if (!knownSkills.has(key)) {
        errors.push(`skill '${skill}': metadata.${field} entry '${key}' has no skills/${key}/SKILL.md`);
      }
    }
  }
  stringList(meta, "requires_tools", skill, errors); // shape check only — tools have no closed registry
  return errors;
}

/**
 * The full skill-graph pass over the live trees: declared metadata validity
 * (checkSkillMetadata per skill) + the bidirectional contract — every merged
 * (procedure → skill) edge must appear in the skill's metadata.procedure_keys.
 * Skills missing from skills/ entirely are NOT re-flagged here; they are
 * already `missing.skills`.
 */
export function checkSkillGraph(map: GraphMap): string[] {
  const errors: string[] = [];
  const knownProcedures = new Set(discoverSharedProcedures());
  const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(SKILLS_DIR, e.name, "SKILL.md")))
    .map((e) => e.name);
  const knownSkills = new Set(skillDirs);

  const declaredBy = new Map<string, Set<string>>();
  for (const skill of skillDirs) {
    const content = readFileSync(join(SKILLS_DIR, skill, "SKILL.md"), "utf-8");
    const fm = parseSkillFrontmatter(content);
    if (fm === null) {
      errors.push(`skill '${skill}': SKILL.md frontmatter missing or unparsable`);
      continue;
    }
    const meta = (fm.metadata ?? {}) as Record<string, unknown>;
    errors.push(...checkSkillMetadata(skill, meta, knownProcedures, knownSkills));
    declaredBy.set(skill, new Set(stringList(meta, "procedure_keys", skill, errors)));
  }

  const edges = new Set<string>(); // `${procedure} ${skill}` — space cannot appear in either key
  for (const p of map.procedures) {
    for (const s of p.steps) {
      if (typeof s.skill_key === "string" && s.skill_key.trim() !== "") edges.add(`${p.procedure} ${s.skill_key}`);
    }
  }
  for (const edge of edges) {
    const [procedure, skill] = edge.split(" ");
    const declared = declaredBy.get(skill);
    if (declared !== undefined && !declared.has(procedure)) {
      errors.push(
        `procedure '${procedure}' references skill '${skill}' but the skill's metadata.procedure_keys does not include '${procedure}' — the graph edge and the skill's self-description have drifted (add '${procedure}' to skills/${skill}/SKILL.md metadata.procedure_keys)`
      );
    }
  }
  return errors;
}

/**
 * SA-5 (projection-level validation): every procedure node in the generated
 * graph that has a non-empty `gate` must have exactly one outgoing `in_stage`
 * edge. This mirrors SA-2's registry check but operates on the projection to
 * catch cases where the registry is complete but the generator failed to emit.
 */
export function checkSA5(graphJsonPath: string): string[] {
  const errors: string[] = [];
  if (!existsSync(graphJsonPath)) {
    errors.push(`graph.json not found at ${graphJsonPath} — run \`bun scripts/co-newbiz/graph.ts\` first`);
    return errors;
  }
  try {
    const content = readFileSync(graphJsonPath, "utf-8");
    const graph = JSON.parse(content) as {
      nodes: Array<{ id: string; type: string; [key: string]: unknown }>;
      edges: Array<{ type: string; from: string; to: string; [key: string]: unknown }>;
    };

    // Find all procedure nodes with non-empty gate property
    const procNodes = new Map<string, { id: string; gate?: string }>();
    for (const node of graph.nodes) {
      if (node.type === "procedure") {
        procNodes.set(node.id, { id: node.id, gate: node.gate as string | undefined });
      }
    }

    // For each procedure with a non-empty gate, check in_stage edges
    for (const [procId, proc] of procNodes) {
      if (!proc.gate || proc.gate.trim() === "") continue;
      const inStageEdges = graph.edges.filter((e) => e.type === "in_stage" && e.from === procId);
      if (inStageEdges.length === 0) {
        errors.push(
          `${procId}: has gate '${proc.gate}' but no outgoing in_stage edge — check process/stage-aliases.yaml for missing entry`,
        );
      } else if (inStageEdges.length > 1) {
        errors.push(
          `${procId}: has gate '${proc.gate}' but ${inStageEdges.length} outgoing in_stage edge(s) — expected exactly one`,
        );
      }
    }
  } catch (e) {
    errors.push(`failed to parse graph.json: ${(e as Error).message}`);
  }
  return errors;
}

/**
 * Distinct-step counts per key, sorted descending (ties alphabetical).
 * A step visible in N layer combos counts ONCE — deduped by
 * (procedure, step id, key) — so counts reflect distinct edges in the graph,
 * not combo multiplicity.
 */
function countByKey(map: GraphMap, key: "agent_key" | "skill_key"): Map<string, number> {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const p of map.procedures) {
    for (const s of p.steps) {
      const dedupe = `${p.procedure} ${s.id} ${s[key]}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      counts.set(s[key], (counts.get(s[key]) ?? 0) + 1);
    }
  }
  return new Map([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function printCounts(title: string, counts: Map<string, number>): void {
  console.log(`\n${title}`);
  if (counts.size === 0) {
    console.log("  (none)");
    return;
  }
  for (const [k, n] of counts) {
    console.log(`  ${String(n).padStart(4)}  ${k}`);
  }
}

function printSummary(map: GraphMap): void {
  console.log(`Procedure graph map — ${map.generated_from.procedures} procedure(s), ${map.generated_from.combos} combo(s)\n`);
  const wProc = Math.max("Procedure".length, ...map.procedures.map((p) => p.procedure.length));
  const wCombo = Math.max("Combo".length, ...map.procedures.map((p) => p.combo.length));
  console.log(
    `${"Procedure".padEnd(wProc)}  ${"Combo".padEnd(wCombo)}  Steps  shared  region  entity`
  );
  for (const p of map.procedures) {
    const by = (src: string) => p.steps.filter((s) => s.source === src).length;
    console.log(
      `${p.procedure.padEnd(wProc)}  ${p.combo.padEnd(wCombo)}  ${String(p.steps.length).padStart(5)}  ${String(by("shared")).padStart(6)}  ${String(by("region")).padStart(6)}  ${String(by("entity")).padStart(6)}`
    );
  }

  printCounts("Steps per agent_key (distinct procedure×step across combos, desc):", countByKey(map, "agent_key"));
  printCounts("Steps per skill_key (distinct procedure×step across combos, desc):", countByKey(map, "skill_key"));

  console.log(`\nReferenced agents with no agents/<key>.md (${map.missing.agents.length}):`);
  console.log(map.missing.agents.length === 0 ? "  (none)" : map.missing.agents.map((k) => `  - ${k}`).join("\n"));
  console.log(`Referenced skills with no skills/<key>/SKILL.md (${map.missing.skills.length}):`);
  console.log(map.missing.skills.length === 0 ? "  (none)" : map.missing.skills.map((k) => `  - ${k}`).join("\n"));
  console.log(`Skill-graph / human-role errors (${map.errors.length}):`);
  console.log(map.errors.length === 0 ? "  (none)" : map.errors.map((k) => `  - ${k}`).join("\n"));
}

function runCheck(map: GraphMap): void {
  // SA-5: projection-level validation (ADR-0083)
  const sa5Errors = checkSA5(GRAPH_JSON_FILE);
  const allErrors = [...map.errors, ...sa5Errors];

  if (map.missing.agents.length === 0 && map.missing.skills.length === 0 && allErrors.length === 0) {
    const totalSteps = map.procedures.reduce((n, p) => n + p.steps.length, 0);
    const humanMarked = map.procedures.reduce((n, p) => n + p.steps.filter((s) => s.decision_authority === "human").length, 0);
    console.log(
      `✅ graph-map --check passed: ${map.generated_from.procedures} procedure(s), ${map.generated_from.combos} combo(s), ${totalSteps} merged step(s), ${humanMarked} human-authority step(s) — every agent_key and skill_key resolves, skill-graph metadata consistent, SA-5 projection-level validation passed.`
    );
    return;
  }
  console.error(
    `❌ graph-map --check failed: ${map.missing.agents.length} missing agent file(s), ${map.missing.skills.length} missing skill file(s), ${allErrors.length} graph error(s)`
  );
  for (const key of map.missing.agents) {
    const referrers = [...new Set(map.procedures.filter((p) => p.steps.some((s) => s.agent_key === key)).map((p) => p.procedure))];
    console.error(`  [agent] ${key} — no agents/${key}.md (referenced by ${referrers.join(", ")})`);
  }
  for (const key of map.missing.skills) {
    const referrers = [...new Set(map.procedures.filter((p) => p.steps.some((s) => s.skill_key === key)).map((p) => p.procedure))];
    console.error(`  [skill] ${key} — no skills/${key}/SKILL.md (referenced by ${referrers.join(", ")})`);
  }
  for (const err of allErrors) {
    console.error(`  [graph] ${err}`);
  }
  process.exit(1);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const checkMode = args.includes("--check");
  const unknown = args.filter((a) => a !== "--json" && a !== "--check");
  if (unknown.length > 0 || (jsonMode && checkMode)) {
    console.error(`Usage: bun scripts/co-newbiz/graph-map.ts [--json | --check]${unknown.length > 0 ? ` (unknown argument(s): ${unknown.join(" ")})` : " (--json and --check are mutually exclusive)"}`);
    process.exit(1);
  }

  const map = buildGraphMap();
  if (checkMode) {
    runCheck(map);
  } else if (jsonMode) {
    console.log(JSON.stringify(map, null, 2));
  } else {
    printSummary(map);
  }
}
