// Stage-artifact registry (ADR-0153 rollout steps 2-3, Wave F PRs F-3/F-4).
// The registry is DERIVED from process/flow.spec.yaml via STAGES
// (lib/process-flow.ts — parity with the spec file is enforced by
// tests/unit/process-flow.test.ts, and tests/unit/review-coverage.test.ts
// re-checks this registry against the spec YAML directly): every
// requiredArtifacts entry of every stage S1–S12 becomes one reviewable
// artifact keyed (stage, artifact). There is no hand-maintained artifact
// list to drift.
//
// Carrier follows the spec's entity_lifecycles: S1–S7 ride the opportunity,
// S8–S12 ride the project. The authoring domain comes from the stage
// activities' agents (spec-activities.ts, domain from agents/*.md
// frontmatter — F-2), so the AI 2nd cross-domain rule works unchanged.
import { createHash } from "node:crypto";
import { evaluateProcess, STAGES, type ProcessEvaluation, type StageId } from "../process-flow.ts";
import { loadStageActivities } from "../spec-activities.ts";
import type { ReviewEntityType } from "../../../../db/repositories/review.repository.ts";
import { canonicalJson, type GateArtifact, type GateArtifactStage } from "./gate-artifacts.ts";

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const OPPORTUNITY_STAGES: ReadonlySet<string> = new Set(["S1", "S2", "S3", "S4", "S5", "S6", "S7"]);

export interface StageArtifactDef {
  stageId: StageId;
  /** 1-based index of the artifact within the stage's requiredArtifacts. */
  index: number;
  name: string;
  entityType: ReviewEntityType;
  authorAgents: string[];
}

function buildRegistry(): StageArtifactDef[] {
  const out: StageArtifactDef[] = [];
  for (const stage of STAGES) {
    const authorAgents = [...new Set(loadStageActivities(stage.id).map((a) => a.agent))].sort();
    stage.requiredArtifacts.forEach((name, i) => {
      out.push({
        stageId: stage.id,
        index: i + 1,
        name,
        entityType: OPPORTUNITY_STAGES.has(stage.id) ? "opportunity" : "project",
        authorAgents,
      });
    });
  }
  return out;
}

export const STAGE_ARTIFACT_REGISTRY: readonly StageArtifactDef[] = buildRegistry();

export const artifactKeyForStage = (stageId: StageId, index: number): string => `stage:${stageId}:${index}`;

export function parseStageArtifactKey(key: string): { stageId: StageId; index: number } | null {
  const m = /^stage:(S[1-9]|S1[0-2]):([1-9][0-9]*)$/.exec(key);
  if (!m) return null;
  return { stageId: m[1] as StageId, index: Number(m[2]) };
}

export function stageArtifactDef(stageId: StageId, index: number): StageArtifactDef | null {
  return STAGE_ARTIFACT_REGISTRY.find((d) => d.stageId === stageId && d.index === index) ?? null;
}

export function stageArtifactDefsFor(stageId: StageId): StageArtifactDef[] {
  return STAGE_ARTIFACT_REGISTRY.filter((d) => d.stageId === stageId);
}

/** A stage artifact: the reviewable snapshot of ONE requiredArtifacts entry. */
export interface StageArtifact {
  kind: "stage";
  stageId: StageId;
  artifactIndex: number;
  artifactName: string;
  artifactKey: string;
  entityType: ReviewEntityType;
  entityId: string;
  authorAgents: string[];
  /** Same shape the gate artifacts carry (single-stage here) — lets AI 1st
   * reuse the deterministic predicate walk unchanged. */
  stages: GateArtifactStage[];
  content: Record<string, unknown>;
  contentHash: string;
}

export function buildStageArtifact(
  stageId: StageId,
  artifactIndex: number,
  entityId: string,
): StageArtifact {
  const def = stageArtifactDef(stageId, artifactIndex);
  if (!def) {
    throw new Error(`No stage artifact ${artifactKeyForStage(stageId, artifactIndex)} in the registry`);
  }
  const entityType = def.entityType;
  const ev: ProcessEvaluation = evaluateProcess({ type: entityType, id: entityId });
  const s = ev.stages.find((x) => x.id === stageId);
  const current = ev.currentStage === stageId;
  // The named artifact is the review unit; the deterministic AI 1st check
  // reuses the stage completion predicate (lib/process-flow) and reports
  // which of the stage's blockers cite this artifact.
  const artifactSpecificBlockers = current
    ? ev.blockers.filter((b) => b.includes(def.name))
    : [];
  const stages: GateArtifactStage[] = [
    {
      id: stageId,
      name: s?.name ?? stageId,
      status: s?.status ?? "locked",
      required_artifacts: s?.requiredArtifacts ?? [],
      blockers: current ? [...ev.blockers] : [],
      missing_artifacts: current ? [...ev.requiredArtifacts] : [],
    },
  ];
  const content = {
    kind: "stage-artifact" as const,
    stage: stageId,
    artifact_index: artifactIndex,
    artifact_name: def.name,
    artifact_blockers: artifactSpecificBlockers,
    entity_type: entityType,
    entity_id: entityId,
    track: ev.track,
    stage_status: s?.status ?? "locked",
    stage_required_artifacts: s?.requiredArtifacts ?? [],
  };
  return {
    kind: "stage",
    stageId,
    artifactIndex,
    artifactName: def.name,
    artifactKey: artifactKeyForStage(stageId, artifactIndex),
    entityType,
    entityId,
    authorAgents: def.authorAgents,
    stages,
    content,
    contentHash: sha256(canonicalJson(content)),
  };
}

/** Every artifact of a stage, as built snapshots (human-final fan-out). */
export function buildStageArtifactsForStage(stageId: StageId, entityId: string): StageArtifact[] {
  return stageArtifactDefsFor(stageId).map((d) => buildStageArtifact(stageId, d.index, entityId));
}

// Union of everything the review engine can run on. GateArtifact keeps its
// `gate` discriminant; StageArtifact has kind:"stage" and no gate — the
// engine and AI 1st stay generic over this union.
export type ReviewArtifact = GateArtifact | StageArtifact;
