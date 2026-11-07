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

// ---------------------------------------------------------------------------
// AI 2nd payload sanitization (design 2026-11-07-review-internal-items §3.1).
// Applied ONLY to the copy sent to the reviewer: the stored artifact content —
// and therefore its content hash / cache key — is unchanged.
// ---------------------------------------------------------------------------

const OPAQUE_ID_VALUE = /^(?:[0-9A-HJKMNP-TV-Z]{26}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Omit opaque identifiers (`*_id` keys, ULID/UUID values). `id` itself stays: stage ids (S1..S12) are review subjects. */
export function stripOpaqueIdentifiers(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((v) => !(typeof v === "string" && OPAQUE_ID_VALUE.test(v))).map(stripOpaqueIdentifiers);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/_id$/i.test(k)) continue;
      if (typeof v === "string" && OPAQUE_ID_VALUE.test(v)) continue;
      out[k] = stripOpaqueIdentifiers(v);
    }
    return out;
  }
  return value;
}

/**
 * Fields that are legitimately null until a given stage has run. `track` is
 * set by the S4 route decision. A null owned by a stage that has not run yet
 * is annotated; any other null passes through unchanged.
 */
export const PENDING_FIELD_OWNER: Readonly<Record<string, { stage: StageId; label: string }>> = {
  track: { stage: "S4", label: "route decision" },
};

const stageSequence = (id: string): number | null => STAGES.find((s) => s.id === id)?.sequence ?? null;

/** Has the owning stage not completed yet, judged from the artifact's own stage context (stage order, not per gate)? */
function ownerStagePending(owner: StageId, content: Record<string, unknown>): boolean {
  const ownerSeq = stageSequence(owner);
  if (ownerSeq === null) return false;
  if (content.kind === "stage-artifact" && typeof content.stage === "string") {
    // A stage artifact at or before the owner stage cannot see a populated field yet.
    const seq = stageSequence(content.stage);
    return seq !== null && seq <= ownerSeq;
  }
  const stages = content.stages;
  if (!Array.isArray(stages)) return false;
  const ownerEntry = stages.find((s) => s && typeof s === "object" && (s as { id?: unknown }).id === owner) as
    | { status?: string }
    | undefined;
  if (ownerEntry) return ownerEntry.status !== "complete" && ownerEntry.status !== "skipped";
  // The gate span does not include the owner stage: pending only when the whole span precedes it.
  const seqs = stages
    .map((s) => stageSequence(String((s as { id?: unknown })?.id ?? "")))
    .filter((n): n is number => n !== null);
  return seqs.length > 0 && seqs.every((n) => n < ownerSeq);
}

export function annotatePendingNulls(content: Record<string, unknown>): Record<string, unknown> {
  const out = { ...content };
  for (const [field, owner] of Object.entries(PENDING_FIELD_OWNER)) {
    if (field in out && out[field] === null && ownerStagePending(owner.stage, content)) {
      out[field] = `not yet decided — set at the ${owner.stage} ${owner.label}`;
    }
  }
  return out;
}

/** Identifier omission + pending-null annotation for the AI 2nd payload (call BEFORE dropping not_reached stages). */
export function sanitizeContentForReview(content: Record<string, unknown>): Record<string, unknown> {
  return stripOpaqueIdentifiers(annotatePendingNulls(content)) as Record<string, unknown>;
}

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
