// @version 1.2.1
/**
 * proc:resolve — merges a shared procedure with its region/entity overrides,
 * per design v1.0 §6.3's references:/overrides: model (safety_os
 * REFERENCE-SPEC pattern). Precedence: _shared → regions/<code> →
 * entities/<company> (design §2-2) — a later layer's overrides apply on top
 * of, never replacing wholesale, the layer before it.
 *
 * Every merged step carries `_source` (`shared` | `region` | `entity`) so a
 * caller (CLI output, and eventually the UI's Procedure Viewer per
 * docs/architecture/ui-spec.md §4) can show provenance per step, not just the merge
 * result.
 *
 * v1.1.0 (design of record 2026-08-22, Decision 8 / PR-3): also parses and
 * merges `kill_criteria`. Merge semantics differ from thresholds on purpose
 * — see appendKillCriteria.
 *
 * v1.2.0 (ADR-0069/0070 Phase 2 port): PROCEDURES_ROOT gained a cwd-walk-up
 * fallback for when `import.meta.dirname` is undefined — found empirically
 * when this module is dynamically imported from a Next.js/Turbopack Route
 * Handler (app/web-next/app/api/procedures/resolve/route.ts), where
 * `import.meta.dirname` does not survive the bundling of a dynamically
 * imported module outside the app directory. The CLI (`bun
 * scripts/co-newbiz/newbiz.ts`) and app/server's Hono route both still hit
 * the primary `import.meta.dirname` branch unchanged — the fallback only
 * activates when that value is absent, so neither existing call site's
 * behavior changes.
 */

import * as yaml from "js-yaml";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";

function findProceduresRoot(): string {
  if (import.meta.dirname) {
    return resolvePath(import.meta.dirname, "..", "..", "procedures");
  }
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "procedures");
    if (existsSync(candidate)) return candidate;
    const parent = resolvePath(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate the procedures/ directory by walking up from cwd=${process.cwd()} (import.meta.dirname was unavailable).`);
}

const PROCEDURES_ROOT = findProceduresRoot();

interface Step {
  id: number | string;
  gate: string;
  agent_key: string;
  skill_key: string;
  output_type: string;
  description: string;
  _source?: "shared" | "region" | "entity";
}

interface AddStepOverride {
  after: number | string;
  step: Step;
}

interface Overrides {
  add_steps?: AddStepOverride[];
  replace_steps?: { id: number | string; step: Step }[];
  thresholds?: Record<string, unknown>;
}

/**
 * One declared kill criterion, typed to the YAML's actual shape
 * (`{condition, action}` — actions observed in-tree: halt,
 * escalate_to_risk_officer, mark_conditional). `condition` doubles as the
 * criterion id used by the procedures/_kill-criteria/ registry.
 */
export interface KillCriterion {
  condition: string;
  action: string;
}

interface ProcedureDoc {
  procedure_id: string;
  scope: "shared" | "entity" | "region" | "group";
  steps?: Step[];
  references?: { shared: string }[];
  overrides?: Overrides;
  thresholds?: Record<string, unknown>;
  kill_criteria?: KillCriterion[];
  [key: string]: unknown;
}

function loadProcedure(dir: string): ProcedureDoc {
  const file = join(dir, "schema.yaml");
  if (!existsSync(file)) {
    throw new Error(`No schema.yaml at ${dir}`);
  }
  return yaml.load(readFileSync(file, "utf-8"), { schema: yaml.JSON_SCHEMA }) as ProcedureDoc;
}

function applyOverrides(
  baseSteps: Step[],
  overrides: Overrides | undefined,
  source: "region" | "entity"
): Step[] {
  let steps = [...baseSteps];

  if (overrides?.replace_steps) {
    for (const r of overrides.replace_steps) {
      const idx = steps.findIndex((s) => s.id === r.id);
      if (idx >= 0) {
        steps[idx] = { ...r.step, _source: source };
      }
    }
  }

  if (overrides?.add_steps) {
    for (const a of overrides.add_steps) {
      // `after: 0` is a sentinel meaning "insert at the very beginning" when
      // no step with id 0 exists in the base procedure (real example:
      // procedures/entities/ent-a/brownfield-screening/schema.yaml, which
      // documents this exact intent in its own comment). Only treat 0 as a
      // literal step id if a step 0 actually exists.
      const hasStepZero = a.after === 0 && steps.some((s) => s.id === 0);
      const insertAt =
        a.after === 0 && !hasStepZero
          ? 0
          : (() => {
              const idx = steps.findIndex((s) => s.id === a.after);
              return idx >= 0 ? idx + 1 : steps.length;
            })();
      steps.splice(insertAt, 0, { ...a.step, _source: source });
    }
  }

  return steps;
}

/**
 * Kill-criteria merge: UNION with shared-first precedence. A region/entity
 * layer may ADD criteria to a procedure but never drop or weaken one
 * declared in _shared — a layer re-declaring an existing condition is
 * ignored (the shared declaration stands). This deliberately differs from
 * the later-layer-wins thresholds merge: weakening or removing a kill
 * criterion is not expressible by merge at all; it has its own separate
 * exception path (supersession records per a higher-tier regulation,
 * design of record 2026-08-22 legal-review #5) that must leave an
 * explicit record.
 */
function appendKillCriteria(base: KillCriterion[], extra: KillCriterion[] | undefined): KillCriterion[] {
  if (!extra || extra.length === 0) return base;
  const seen = new Set(base.map((k) => k.condition));
  const out = [...base];
  for (const k of extra) {
    if (!seen.has(k.condition)) {
      seen.add(k.condition);
      out.push(k);
    }
  }
  return out;
}

export interface ResolveResult {
  procedureKey: string;
  steps: Step[];
  thresholds: Record<string, unknown>;
  kill_criteria: KillCriterion[];
  layersApplied: string[];
}

export function resolveProcedure(
  procedureName: string,
  opts: { entity?: string; region?: string } = {}
): ResolveResult {
  const sharedDir = join(PROCEDURES_ROOT, "_shared", procedureName);
  const shared = loadProcedure(sharedDir);
  if (!shared.steps) {
    throw new Error(`Shared procedure '${procedureName}' has no steps — cannot resolve.`);
  }

  let steps: Step[] = shared.steps.map((s) => ({ ...s, _source: "shared" as const }));
  let thresholds: Record<string, unknown> = { ...(shared.thresholds ?? {}) };
  let killCriteria: KillCriterion[] = [...(shared.kill_criteria ?? [])];
  const layersApplied = ["shared"];

  // Precedence: _shared -> regions/<code> -> entities/<company> (design §2-2).
  if (opts.region) {
    const regionDir = join(PROCEDURES_ROOT, "regions", opts.region, procedureName);
    if (existsSync(join(regionDir, "schema.yaml"))) {
      const regionDoc = loadProcedure(regionDir);
      steps = applyOverrides(steps, regionDoc.overrides, "region");
      thresholds = { ...thresholds, ...(regionDoc.overrides?.thresholds ?? {}) };
      killCriteria = appendKillCriteria(killCriteria, regionDoc.kill_criteria);
      layersApplied.push(`region:${opts.region}`);
    }
  }

  if (opts.entity) {
    const entityDir = join(PROCEDURES_ROOT, "entities", opts.entity, procedureName);
    if (existsSync(join(entityDir, "schema.yaml"))) {
      const entityDoc = loadProcedure(entityDir);
      steps = applyOverrides(steps, entityDoc.overrides, "entity");
      thresholds = { ...thresholds, ...(entityDoc.overrides?.thresholds ?? {}) };
      killCriteria = appendKillCriteria(killCriteria, entityDoc.kill_criteria);
      layersApplied.push(`entity:${opts.entity}`);
    }
  }

  return { procedureKey: procedureName, steps, thresholds, kill_criteria: killCriteria, layersApplied };
}

function printResult(result: ResolveResult): void {
  console.log(`Procedure: ${result.procedureKey}`);
  console.log(`Layers applied: ${result.layersApplied.join(" -> ")}`);
  console.log(`\nSteps:`);
  for (const s of result.steps) {
    console.log(`  [${s._source}] ${s.id}. (${s.gate}) ${s.agent_key} / ${s.skill_key} -> ${s.output_type}`);
  }
  if (Object.keys(result.thresholds).length > 0) {
    console.log(`\nThresholds:`);
    for (const [k, v] of Object.entries(result.thresholds)) {
      console.log(`  ${k}: ${v}`);
    }
  }
  if (result.kill_criteria.length > 0) {
    console.log(`\nKill criteria:`);
    for (const k of result.kill_criteria) {
      console.log(`  ${k.condition} -> ${k.action}`);
    }
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const procedureIdx = args.indexOf("--procedure");
  const entityIdx = args.indexOf("--entity");
  const regionIdx = args.indexOf("--region");
  const jsonMode = args.includes("--json");

  const procedureName = procedureIdx >= 0 ? args[procedureIdx + 1] : undefined;
  if (!procedureName) {
    console.error("Usage: bun scripts/co-newbiz/proc-resolve.ts --procedure <name> [--entity <code>] [--region <code>] [--json]");
    process.exit(1);
  }

  const result = resolveProcedure(procedureName, {
    entity: entityIdx >= 0 ? args[entityIdx + 1] : undefined,
    region: regionIdx >= 0 ? args[regionIdx + 1] : undefined,
  });

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printResult(result);
  }
}
