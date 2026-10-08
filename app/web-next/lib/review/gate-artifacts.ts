// The 7 gate-proposal artifacts the review runtime covers in PR F-2 (ADR-0153
// §7 rollout step 1): screening, pre_fs, fs, dd, entity_ic, group_ic and the
// S12 transition proposal. An artifact is the deterministic snapshot of the
// stages feeding the gate (completion status, required artifacts, blockers),
// so its content hash changes exactly when the underlying evidence does —
// that hash is the AI 2nd cache key.
import { createHash } from "node:crypto";
import { evaluateProcess, STAGES, type ProcessEvaluation, type StageId } from "../process-flow.ts";
import { loadStageActivities } from "../spec-activities.ts";
import type { ReviewEntityType } from "../../../../db/repositories/review.repository.ts";

export const REVIEW_GATES = ["screening", "pre_fs", "fs", "dd", "entity_ic", "group_ic", "transition"] as const;
export type ReviewGate = (typeof REVIEW_GATES)[number];

export function isReviewGate(value: string): value is ReviewGate {
  return (REVIEW_GATES as readonly string[]).includes(value);
}

const GATE_ENTITY: Record<ReviewGate, ReviewEntityType> = {
  screening: "opportunity",
  pre_fs: "opportunity",
  fs: "project",
  dd: "project",
  entity_ic: "project",
  group_ic: "project",
  transition: "project",
};

export function gateEntityType(gate: ReviewGate): ReviewEntityType {
  return GATE_ENTITY[gate];
}

export function gateStageIds(gate: ReviewGate): StageId[] {
  if (gate === "transition") return ["S12"];
  return STAGES.filter((s) => (s.gateIds as string[]).includes(gate)).map((s) => s.id);
}

export const artifactKeyFor = (gate: ReviewGate): string => `gate:${gate}`;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

export interface GateArtifactStage {
  id: StageId;
  name: string;
  status: ProcessEvaluation["stages"][number]["status"];
  required_artifacts: string[];
  /** Present only for the evaluation's current stage. */
  blockers: string[];
  missing_artifacts: string[];
}

export interface GateArtifact {
  gate: ReviewGate;
  artifactKey: string;
  entityType: ReviewEntityType;
  entityId: string;
  /** Highest stage feeding the gate — stored as review_stage.stage_id. */
  stageId: StageId;
  stages: GateArtifactStage[];
  authorAgents: string[];
  content: Record<string, unknown>;
  contentHash: string;
}

export function buildGateArtifact(gate: ReviewGate, entityId: string): GateArtifact {
  const entityType = gateEntityType(gate);
  const ev = evaluateProcess({ type: entityType, id: entityId });
  const ids = gateStageIds(gate);
  const stages: GateArtifactStage[] = ids.map((id) => {
    const s = ev.stages.find((x) => x.id === id);
    const current = ev.currentStage === id;
    return {
      id,
      name: s?.name ?? id,
      status: s?.status ?? "locked",
      required_artifacts: s?.requiredArtifacts ?? [],
      blockers: current ? [...ev.blockers] : [],
      missing_artifacts: current ? [...ev.requiredArtifacts] : [],
    };
  });
  const authorAgents = [...new Set(ids.flatMap((id) => loadStageActivities(id).map((a) => a.agent)))].sort();
  // The gate verdict itself is deliberately NOT part of the content: the
  // artifact is what the human judges, not the judgement.
  const content = {
    gate,
    entity_type: entityType,
    entity_id: entityId,
    track: ev.track,
    stages,
  };
  return {
    gate,
    artifactKey: artifactKeyFor(gate),
    entityType,
    entityId,
    stageId: ids[ids.length - 1],
    stages,
    authorAgents,
    content,
    contentHash: sha256(canonicalJson(content)),
  };
}
