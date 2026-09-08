// Spec-driven activity loading (completes flow.spec.yaml's header claim that
// "the agent orchestrator renders/executes from this spec at runtime").
// process/flow.spec.yaml is the SSOT (ADR-0074) — stage activities (agent +
// skills + procedures) are read from the spec file, never hardcoded at call
// sites. js-yaml parses the full spec; only stages[].activities[] is exposed.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";

export interface SpecActivity {
  id: string;
  agent: string;
  skills: string[];
  procedures: string[];
}

interface SpecStage {
  id: string;
  activities?: Array<{ id: string; agent: string; skills?: string[]; procedure?: string[] }>;
}

// Walked up from cwd — import.meta.dirname is unavailable under Turbopack
// (same strategy as loadSpecVersion in agent-orchestrator.ts).
function findSpecPath(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "process", "flow.spec.yaml");
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // keep walking
    }
    dir = join(dir, "..");
  }
  throw new Error("process/flow.spec.yaml not found (walked up 6 levels from cwd)");
}

interface CachedSpec {
  version: string;
  stagesById: Map<string, SpecStage>;
}
let cached: CachedSpec | null = null;

function loadSpec(): CachedSpec {
  if (cached) return cached;
  const raw = yaml.load(readFileSync(findSpecPath(), "utf8")) as {
    meta?: { version?: string };
    stages?: SpecStage[];
  };
  const stagesById = new Map<string, SpecStage>();
  for (const stage of raw.stages ?? []) stagesById.set(stage.id, stage);
  cached = { version: raw.meta?.version ?? "unknown", stagesById };
  return cached;
}

/** All activities of a stage, in spec order. Throws on an unknown stage id. */
export function loadStageActivities(stageId: string): SpecActivity[] {
  const stage = loadSpec().stagesById.get(stageId);
  if (!stage) throw new Error(`Unknown stage '${stageId}' in process/flow.spec.yaml`);
  return (stage.activities ?? []).map((a) => ({
    id: a.id,
    agent: a.agent,
    skills: a.skills ?? [],
    procedures: a.procedure ?? [],
  }));
}

/** The agent assigned to one activity of a stage. Throws when absent. */
export function specAgentFor(stageId: string, activityId: string): string {
  const activity = loadStageActivities(stageId).find((a) => a.id === activityId);
  if (!activity) {
    throw new Error(`Stage ${stageId} has no activity '${activityId}' in process/flow.spec.yaml`);
  }
  return activity.agent;
}

/** Spec meta version (same provenance loadSpecVersion() records on runs). */
export function specVersion(): string {
  return loadSpec().version;
}
