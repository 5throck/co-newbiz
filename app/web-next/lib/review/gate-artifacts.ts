// The 7 gate-proposal artifacts the review runtime covers in PR F-2 (ADR-0153
// §7 rollout step 1): screening, pre_fs, fs, dd, entity_ic, group_ic and the
// S12 transition proposal. An artifact is the deterministic snapshot of the
// stages feeding the gate (completion status, required artifacts, blockers),
// so its content hash changes exactly when the underlying evidence does —
// that hash is the AI 2nd cache key.
//
// target_screening (the brownfield S7 gate, ADR-0076) is deliberately NOT in
// this set — documented as the decision of record in the ADR-0153 addendum
// (2026-10-22, a). Adding it would newly engage the AI-1st/AI-2nd/human-final
// pipeline (snapshot rows + LLM 2nd-stage spend) for every brownfield S7
// decision: a rollout step ADR-0153 never scheduled and no test covers.
// Consequence (accepted): target_screening decisions record no human_final
// snapshot; gate briefs/committees still name the gate (review-display.ts).
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
  /**
   * True for a `locked` stage that comes AFTER the entity's current stage (the
   * entity simply has not got there yet), and — when the review is requested
   * from a stage carrier (BuildGateArtifactOptions.carrierStage) — for any
   * unfinished stage AFTER that carrier stage (out of the review's scope).
   * Omitted otherwise, so artifacts of already-reached stages keep their
   * content hash.
   */
  not_reached?: true;
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

export interface BuildGateArtifactOptions {
  /**
   * The stage screen the review is requested from (e.g. the S3 screen asking
   * for the `screening` gate, which spans S1-S4). Stages AFTER it that are
   * still unfinished (`current` / `locked`) are scoped out like not_reached:
   * non-structural, informational, excluded from the AI 2nd payload. Omitted =
   * gate-level review (inbox, proposal confirm) with the full gate span.
   */
  carrierStage?: StageId;
}

export function buildGateArtifact(
  gate: ReviewGate,
  entityId: string,
  opts: BuildGateArtifactOptions = {},
): GateArtifact {
  const entityType = gateEntityType(gate);
  const ev = evaluateProcess({ type: entityType, id: entityId });
  const ids = gateStageIds(gate);
  const currentSequence = ev.currentStage ? (STAGES.find((x) => x.id === ev.currentStage)?.sequence ?? null) : null;
  const carrierSequence = opts.carrierStage ? (STAGES.find((x) => x.id === opts.carrierStage)?.sequence ?? null) : null;
  const stages: GateArtifactStage[] = ids.map((id) => {
    const s = ev.stages.find((x) => x.id === id);
    const current = ev.currentStage === id;
    const status = s?.status ?? "locked";
    const sequence = STAGES.find((x) => x.id === id)?.sequence ?? 0;
    // Locked AND after the current stage = not reached yet. A locked stage at
    // or before the current one (or with no current stage) stays structural.
    const notReached =
      (status === "locked" && currentSequence !== null && sequence > currentSequence) ||
      // Carrier scope: a stage after the requesting screen's stage that is not
      // finished yet is out of scope (finished stages stay verifiable).
      ((status === "locked" || status === "current") && carrierSequence !== null && sequence > carrierSequence);
    return {
      id,
      name: s?.name ?? id,
      status,
      required_artifacts: s?.requiredArtifacts ?? [],
      blockers: current && !notReached ? [...ev.blockers] : [],
      missing_artifacts: current && !notReached ? [...ev.requiredArtifacts] : [],
      ...(notReached ? { not_reached: true as const } : {}),
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
