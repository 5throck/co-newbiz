// Agent Orchestrator (ADR-0096) — the generalized execution engine over the
// 0045 process-execution tables.
//
//   runActivityChain      — sequential generation, not debate. Each activity
//                           produces an artifact; every run is recorded in
//                           activity_run + agent_run. Consumers: S8 case
//                           generation (Phase 3), S9 checklist tailoring (P4).
//
// The multi-round deliberation engine (runDeliberationRounds / buildSynthesis)
// lives separately in lib/deliberation.ts since the committee-deliberation
// split — consumers import it from there; this module only hosts the shared
// process_run bookkeeping the engine reuses.
//
// Boundaries (design of record):
//   - Entity-agnostic: runs address an {entityType, entityId} pair
//     (opportunity | project). Project runs also populate the nullable
//     process_run.project_id compatibility column (0064).
//   - The orchestrator writes PROPOSALS only. The final synthesis is a
//     gate_evaluation row; the human go/hold/kill lives in gate_decision
//     (ADR-0094, the sole human-confirmation ledger). The `decision` table
//     (0045) is explicitly NOT used (ADR-0096 §5) and is never written here.
//   - Dissent preservation (ADR-0096 §6): veto-dissent positions are copied
//     VERBATIM into gate_evaluation.dissent_json via buildSynthesis() — never
//     summarized, and enforced in code, not left to the chair model.
//   - Agent LLM execution is an injected strategy (callAgent) so unit tests
//     inject fakes and Phases 2–4 supply real implementations.
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { SPEC_VERSION } from "./spec-activities.generated.ts";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type EntityType = "opportunity" | "project";
export interface EntityRef {
  entityType: EntityType;
  entityId: string;
}

export type RunStatus = "running" | "done" | "failed";
export type Recommendation = "go" | "hold" | "kill";

/** Injected agent-executor strategy — Phase 2/3/4 supply real LLM callers. */
export interface AgentCallResult {
  positionMd: string;
  confidence?: number;
  recommendation?: Recommendation;
  /** Member flags this position as a veto dissent (e.g. the risk officer). */
  vetoDissent?: boolean;
  /** ADR-0104 5criteria × 1-3 scorecard input, when the executor provides one. */
  criteriaScores?: Record<string, number>;
}
export type CallAgent = (agentKey: string, prompt: string) => Promise<AgentCallResult>;

export interface RunOpts {
  actor: string;
  source?: string;
  /** process_run.stage label; defaults per call site. */
  stage?: string;
  /** process_run.spec_version; defaults to the flow.spec meta version. */
  specVersion?: string;
}

// nowIso / insertProcessRun / finishProcessRun are the shared process_run
// bookkeeping — used by runActivityChain here and by the deliberation engine
// in lib/deliberation.ts.
export function nowIso(): string {
  return new Date().toISOString();
}

export function insertProcessRun(entity: EntityRef, stage: string, opts: RunOpts): string {
  const db = getDb();
  const runId = ulid();
  db.run(
    `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      runId,
      entity.entityType,
      entity.entityId,
      // Compatibility column (0064): populated for project runs only.
      entity.entityType === "project" ? entity.entityId : null,
      opts.specVersion ?? loadSpecVersion(),
      stage,
      "running",
      opts.source ?? "agent",
      opts.actor,
      nowIso(),
    ],
  );
  return runId;
}

export function finishProcessRun(runId: string, status: RunStatus): void {
  getDb().run("UPDATE process_run SET status = ?, finished_at = ? WHERE id = ?", [status, nowIso(), runId]);
}

/**
 * Write an agent_position row, enforcing the 0065 app-layer invariant:
 * EXACTLY ONE of agent_key | human_user_id non-null. Deliberate trade
 * (ADR-0096 §2): no cross-column CHECK — this one line is the enforcement.
 */
function loadSpecVersion(): string {
  return SPEC_VERSION;
}

// ---------------------------------------------------------------------------
// runActivityChain — sequential generation (ADR-0096 §4, mode 1)
// ---------------------------------------------------------------------------

export interface ActivityContext {
  entity: EntityRef;
  processRunId: string;
}
export interface ActivitySpec {
  activityId: string;
  agentKey: string;
  /** Prompt handed to callAgent when the activity has no execute(). */
  prompt: string;
  /** Direct artifact producer; when absent the artifact comes from callAgent. */
  execute?: (ctx: ActivityContext) => Promise<string>;
}
export interface ActivityResult {
  activityId: string;
  agentKey: string;
  status: RunStatus;
  outputMd: string | null;
  error?: string;
}
export interface ChainResult {
  processRunId: string;
  status: RunStatus;
  activities: ActivityResult[];
}

export interface RunActivityChainOpts extends RunOpts {
  callAgent?: CallAgent;
  /** Keep going after a failed activity (process_run still ends 'failed'). */
  continueOnError?: boolean;
}

/**
 * Execute activities sequentially. Each activity writes one activity_run and
 * one agent_run row; the artifact (output_md) comes from execute() or, in its
 * absence, from the injected callAgent strategy. First failure marks the run
 * failed and stops, unless continueOnError.
 */
export async function runActivityChain(
  entity: EntityRef,
  activities: ActivitySpec[],
  opts: RunActivityChainOpts,
): Promise<ChainResult> {
  const db = getDb();
  const runId = insertProcessRun(entity, opts.stage ?? "activity_chain", opts);
  const results: ActivityResult[] = [];
  let runStatus: RunStatus = "done";

  for (const activity of activities) {
    const startedAt = nowIso();
    const ctx: ActivityContext = { entity, processRunId: runId };
    let outputMd: string | null = null;
    let error: string | undefined;
    try {
      outputMd =
        activity.execute !== undefined
          ? await activity.execute(ctx)
          : await (opts.callAgent
              ? (await opts.callAgent(activity.agentKey, activity.prompt)).positionMd
              : Promise.reject(new Error("runActivityChain: no execute() and no callAgent supplied")));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const status: RunStatus = error ? "failed" : "done";
    db.run(
      `INSERT INTO activity_run (id, process_run_id, activity_id, status, output_md, source, started_at, finished_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [ulid(), runId, activity.activityId, status, outputMd, opts.source ?? "agent", startedAt, nowIso()],
    );
    db.run(
      `INSERT INTO agent_run (id, process_run_id, activity_id, agent_key, status, summary_md, source, started_at, finished_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [ulid(), runId, activity.activityId, activity.agentKey, status, outputMd, "agent", startedAt, nowIso()],
    );
    results.push({ activityId: activity.activityId, agentKey: activity.agentKey, status, outputMd, error });

    if (error) {
      runStatus = "failed";
      if (!opts.continueOnError) break;
    }
  }

  finishProcessRun(runId, runStatus);
  return { processRunId: runId, status: runStatus, activities: results };
}
