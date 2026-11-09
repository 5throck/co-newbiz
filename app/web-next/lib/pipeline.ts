// @version 1.0.0
// ADR-0102 §2 — the industry × company end-to-end auto pipeline.
//
// advancePipeline() is the loop that turns evaluateProcess() (process-flow.ts,
// the state oracle) from a UI rendering input into a driver: evaluate →
// classify the current blocker → run the EXISTING automation entry point that
// fills it → re-evaluate → … until the process completes, a KILL terminates
// it, or a HUMAN confirmation is required.
//
// BOUNDARY #2 (design non-negotiable, ADR-0102 §5 — regression-tested in
// tests/unit/pipeline.test.ts): this module's allowed-action table contains
// ONLY generation functions. It cannot insert a gate_decision, cannot adopt a
// business case, cannot approve a checklist item, cannot confirm a track or
// route, and cannot record a transition decision. Human actions happen through
// the EXISTING UI surfaces and routes; the pipeline only writes its own
// pipeline_run state and notification rows (trigger_type 'pipeline_paused').
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { evaluateProcess, type GateId, type ProcessEntity, type ProcessEvaluation } from "./process-flow.ts";
import { generateBusinessCases } from "./business-case-generator.ts";
import { tailorDdChecklist, ddCompletionSummary } from "./dd-checklist-tailor.ts";
import { CommitteeError, conveneCommitteeSession, getCommittee, listCommitteeSessions } from "./committee-session.ts";
import { promoteOpportunity } from "../../../db/repositories/project.repository.ts";

export type PipelineStatus = "running" | "paused_for_human" | "completed" | "failed" | "killed" | "withdrawn";

export interface PipelineRunRow {
  id: string;
  entity_type: "opportunity" | "project";
  entity_id: string;
  industry_id: string;
  initiating_company_id: string;
  status: PipelineStatus;
  current_stage: string | null;
  paused_reason: string | null;
  started_by: string;
  started_at: string;
  updated_at: string;
}

/** Safety cap: automation iterations per advancePipeline call (ADR-0102 §2). */
export const MAX_PIPELINE_ITERATIONS = 10;

export class PipelineError extends Error {
  constructor(
    public code: "not_found" | "active_run_exists" | "unknown_industry" | "unknown_company",
    message: string,
  ) {
    super(message);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function getRun(id: string): PipelineRunRow {
  const row = getDb().query("SELECT * FROM pipeline_run WHERE id = ?").get(id) as PipelineRunRow | undefined;
  if (!row) throw new PipelineError("not_found", `pipeline_run '${id}' not found.`);
  return row;
}

function setRunState(
  id: string,
  status: PipelineStatus,
  fields: { currentStage?: string | null; pausedReason?: string | null } = {},
): void {
  getDb().run("UPDATE pipeline_run SET status = ?, current_stage = ?, paused_reason = ?, updated_at = ? WHERE id = ?", [
    status,
    fields.currentStage ?? null,
    fields.pausedReason ?? null,
    nowIso(),
    id,
  ]);
}

/**
 * startPipeline — validate the two product-vision inputs (산업 선정 + 계열사
 * 결정) and open the run. One ACTIVE (running/paused_for_human) run per entity:
 * enforced here at the repository layer per ADR-0102 §1, checking both the
 * opportunity key and its promoted project key so a second run cannot ride
 * either side of a promotion.
 */
export function startPipeline(opts: {
  entityType: "opportunity" | "project";
  entityId: string;
  industryId: string;
  initiatingCompanyId: string;
  startedBy: string;
}): PipelineRunRow {
  const db = getDb();
  if (!db.query("SELECT id FROM md_industry WHERE id = ?").get(opts.industryId)) {
    throw new PipelineError("unknown_industry", `industry '${opts.industryId}' does not exist in md_industry.`);
  }
  if (!db.query("SELECT id FROM md_company WHERE id = ?").get(opts.initiatingCompanyId)) {
    throw new PipelineError("unknown_company", `company '${opts.initiatingCompanyId}' does not exist in md_company.`);
  }
  const tableName = opts.entityType === "opportunity" ? "opportunity" : "md_project";
  if (!db.query(`SELECT id FROM ${tableName} WHERE id = ?`).get(opts.entityId)) {
    throw new PipelineError("not_found", `${opts.entityType} '${opts.entityId}' not found.`);
  }
  if (opts.entityType === "project") {
    const status = db.query("SELECT status FROM md_project WHERE id = ?").get(opts.entityId) as
      | { status: string }
      | undefined;
    if (status?.status !== "open") {
      throw new PipelineError("not_found", `project '${opts.entityId}' is not open.`);
    }
  }

  const ids = relatedEntityIds(opts.entityType, opts.entityId);

  // Race-tolerant exclusivity: the check-and-insert runs in ONE transaction so
  // two concurrent starts cannot both pass the active-run probe.
  const inserted = db.transaction(() => {
    const active = db
      .query(
        `SELECT id FROM pipeline_run
         WHERE status IN ('running','paused_for_human')
           AND ((entity_type = 'opportunity' AND entity_id IN (?, ?))
             OR (entity_type = 'project' AND entity_id IN (?, ?)))`,
      )
      .get(ids.opportunityId, ids.projectId, ids.opportunityId, ids.projectId) as { id: string } | undefined;
    if (active) {
      throw new PipelineError(
        "active_run_exists",
        `An active pipeline run ('${active.id}') already exists for this entity.`,
      );
    }
    const id = ulid();
    const now = nowIso();
    db.run(
      `INSERT INTO pipeline_run (id, entity_type, entity_id, industry_id, initiating_company_id, status, current_stage, paused_reason, started_by, started_at, updated_at)
       VALUES (?,?,?,?,?,'running',NULL,NULL,?,?,?)`,
      [id, opts.entityType, opts.entityId, opts.industryId, opts.initiatingCompanyId, opts.startedBy, now, now],
    );
    return id;
  })();
  return getRun(inserted);
}

/** The opportunity/project key pair an entity maps to across a promotion. */
function relatedEntityIds(
  entityType: "opportunity" | "project",
  entityId: string,
): { opportunityId: string; projectId: string } {
  const db = getDb();
  if (entityType === "opportunity") {
    const row = db.query("SELECT project_id FROM opportunity WHERE id = ?").get(entityId) as
      | { project_id: string | null }
      | undefined;
    return { opportunityId: entityId, projectId: row?.project_id ?? "" };
  }
  const row = db.query("SELECT source_opportunity_id FROM md_project WHERE id = ?").get(entityId) as
    | { source_opportunity_id: string | null }
    | undefined;
  return { opportunityId: row?.source_opportunity_id ?? "", projectId: entityId };
}

// ── Blocker classification: the explicit, ordered rule table (ADR-0102 §2) ──
// Future automations register here: add a rule with kind 'automatable' whose
// run() invokes an existing generation entry point. Anything not matched
// degrades to an explicit human pause (no_automation:<stage>), never silence.

interface RuleCtx {
  run: PipelineRunRow;
  entity: ProcessEntity;
  ev: ProcessEvaluation;
  actor: string;
}

interface Rule {
  /** Stable machine key used as paused_reason (ADR-0102 §2b examples). */
  key: string;
  kind: "human" | "automatable";
  when(ctx: RuleCtx): boolean;
  /**
   * Change signal for the ineffective-automation guard: when an automation
   * fires but its blocker signature is unchanged on the next iteration, the
   * loop pauses instead of burning the iteration cap.
   */
  signature?(ctx: RuleCtx): string;
  run?(ctx: RuleCtx): Promise<RuleOutcome | undefined>;
}

/** A promotion inside the loop re-points the run to a NEW project segment. */
interface RuleOutcome {
  promotedProjectId?: string;
  /** Owner decision 10 (ADR-0196): an automation may stop the loop with a
   * recorded skip notice instead of completing (committee M3 llm_required). */
  pausedReason?: string;
}

function count(sql: string, ...params: unknown[]): number {
  return (
    getDb()
      .query(sql)
      .get(...params) as { c: number }
  ).c;
}

const OPPORTUNITY_GATES: GateId[] = ["screening", "pre_fs", "target_screening"];

/**
 * A gate becomes DECIDABLE only once the work it gates exists (process-flow.md
 * gate placement): screening after S3 artifacts, pre_fs after the route
 * decision plus the track's S5/S6 entry-strategy work, target_screening after
 * S7. Pending-but-not-yet-relevant gates must NOT pause the pipeline — the
 * stage work in front of them is what the rules below handle first. Note
 * evaluateProcess walks S1–S12 for opportunities too, so currentStage alone
 * cannot distinguish "gate pending" from "carrier scope finished" — that is
 * exactly what ev.carrierScopeFinished disambiguates (the promotion rule
 * consumes it instead of re-deriving stage statuses).
 */
function firstPendingGate(ev: ProcessEvaluation, gates: GateId[]): GateId | null {
  const relevant: Partial<Record<GateId, boolean>> = {
    screening: ev.completedStages.includes("S3"),
    pre_fs:
      ev.completedStages.includes("S4") &&
      (ev.track === "greenfield" ? ev.completedStages.includes("S5") : ev.completedStages.includes("S6")),
    target_screening: ev.completedStages.includes("S7"),
  };
  for (const g of gates) {
    if (relevant[g] && ev.gateStatus[g] !== "go") return g;
  }
  return null;
}

const OPPORTUNITY_RULES: Rule[] = [
  {
    // ADR-0102 §2a names the market-sizing chain as future wiring; today the
    // discover flow produces the S1 industrial artifacts — explicit pause.
    key: "no_automation:S1",
    kind: "human",
    when: ({ ev }) => ev.currentStage === "S1",
  },
  {
    // 매력도 평가 — human judgement over recorded factor evidence.
    key: "manual_input:S2",
    kind: "human",
    when: ({ ev }) => ev.currentStage === "S2",
  },
  {
    // 시너지 평가·전략적 적합성 판단 + 기회 선택 — human judgement.
    key: "manual_input:S3",
    kind: "human",
    when: ({ ev }) => ev.currentStage === "S3",
  },
  {
    // Route/track confirmation is a HUMAN decision (boundary #2) — the
    // pipeline never writes a route_decision.
    key: "route_confirmation:S4",
    kind: "human",
    when: ({ ev }) =>
      ev.currentStage === "S4" && (ev.track === null || (ev.track === "brownfield" && ev.subTrack === null)),
  },
  {
    key: "manual_input:S4",
    kind: "human",
    when: ({ ev }) => ev.currentStage === "S4",
  },
  { key: "no_automation:S5", kind: "human", when: ({ ev }) => ev.currentStage === "S5" },
  { key: "no_automation:S6", kind: "human", when: ({ ev }) => ev.currentStage === "S6" },
  { key: "no_automation:S7", kind: "human", when: ({ ev }) => ev.currentStage === "S7" },
  {
    // ADR-0102 §2a: where a committee applies and its composition permits,
    // convene in agent_team mode producing a PROPOSAL (gate_evaluation) —
    // never the gate_decision itself. Once per (entity, gate).
    key: "committee_proposal:pre_fs",
    kind: "automatable",
    when: ({ entity, ev }) => {
      if (entity.type !== "opportunity" || ev.terminated) return false;
      if (firstPendingGate(ev, OPPORTUNITY_GATES) !== "pre_fs") return false;
      const committee = getCommittee("route-steering-committee");
      if (!committee?.decision_modes_allowed.includes("agent_team")) return false;
      const already = listCommitteeSessions(entity.id).some((s) => s.meta.gate === "pre_fs");
      return !already;
    },
    signature: () => "pre_fs",
    run: async ({ run, entity, ev, actor }) => {
      try {
        await conveneCommitteeSession(
          { entityType: "opportunity", entityId: entity.id },
          {
            committeeKey: "route-steering-committee",
            decisionMode: "agent_team",
            gate: "pre_fs",
            // Conditional seats (applies_when: track == ...) resolve by track.
            track: ev.track ?? undefined,
            actor,
            source: "system",
          },
        );
      } catch (err) {
        // Owner decision 10 (ADR-0196 amendment 2026-11-09): when the LLM is
        // not configured, SKIP the convene — never convene a hollow
        // deterministic session and never fail the run. Pause with a recorded
        // notice (insertPauseNotification fires inside pauseRun) so the
        // reviewer convenes later, once the provider is configured.
        if (err instanceof CommitteeError && err.code === "llm_required") {
          pauseRun(getRun(run.id), "committee_llm_required:pre_fs", ev.currentStage);
          return { pausedReason: "committee_llm_required:pre_fs" };
        }
        throw err;
      }
    },
  },
  {
    // Gate approval belongs to humans (boundary #2). The paused_reason key
    // carries the gate: gate_decision:<gate> (ADR-0102 §2b).
    key: "gate_decision",
    kind: "human",
    when: ({ entity, ev }) => {
      if (entity.type !== "opportunity" || ev.terminated) return false;
      return firstPendingGate(ev, OPPORTUNITY_GATES) !== null;
    },
  },
  {
    // Promotion preconditions met → promoteOpportunity (the ADR-0095 carrier
    // handoff). Preconditions are FACT checks inside promoteOpportunity; the
    // fs/dd/entity_ic/group_ic gates stay human. carrierScopeFinished is the
    // evaluation's own carrier-scope marker (track-final stage done, no
    // project yet) — the row probe below re-checks project_id because a
    // promotion recorded BETWEEN evaluateProcess and this probe must not
    // double-promote.
    key: "promotion",
    kind: "automatable",
    when: ({ entity, ev }) => {
      if (entity.type !== "opportunity" || ev.terminated) return false;
      if (firstPendingGate(ev, OPPORTUNITY_GATES) !== null) return false;
      if (!ev.carrierScopeFinished) return false;
      const row = getDb().query("SELECT project_id FROM opportunity WHERE id = ?").get(entity.id) as
        | { project_id: string | null }
        | undefined;
      return !!row && row.project_id === null;
    },
    signature: () => "promote",
    run: async ({ entity, actor }) => {
      const result = promoteOpportunity(entity.id, {
        promotedBy: actor,
        needToKnowBasis: "ADR-0102 pipeline promotion — S1–S7 track artifacts complete (flow.spec completionCriteria)",
      });
      return { promotedProjectId: result.project.id };
    },
  },
];

const PROJECT_RULES: Rule[] = [
  {
    // S8 business-case modeling → generateBusinessCases (ADR-0098). Writes
    // PROPOSAL cases + simulations under its own process_run — no adoption
    // marker, no gate_decision.
    key: "generate_business_cases:S8",
    kind: "automatable",
    when: ({ ev }) => ev.currentStage === "S8",
    signature: ({ entity }) => `${count("SELECT COUNT(*) c FROM business_case_model WHERE project_id = ?", entity.id)}`,
    run: async ({ entity, actor }) => {
      await generateBusinessCases(entity.id, { actor, source: "system" });
    },
  },
  {
    // S9 checklist tailoring → tailorDdChecklist (ADR-0099). PROPOSALS only —
    // every item lands 'proposed'; approval is the human boundary decision.
    key: "tailor_dd_checklist:S9",
    kind: "automatable",
    when: ({ entity }) =>
      count(
        "SELECT COUNT(*) c FROM project_checklist_item_custom WHERE project_id = ? AND target_id IS NULL",
        entity.id,
      ) === 0,
    signature: ({ entity }) =>
      `${count("SELECT COUNT(*) c FROM project_checklist_item_custom WHERE project_id = ? AND target_id IS NULL", entity.id)}`,
    run: async ({ entity, actor }) => {
      await tailorDdChecklist(entity.id, { actor, source: "system" });
    },
  },
  {
    // fs gate pending while the S8 quantitative work exists → the human
    // adopts a business case and records the fs gate decision (boundary #2).
    key: "case_adoption:S8",
    kind: "human",
    when: ({ ev }) => ev.completedStages.includes("S8") && ev.gateStatus.fs !== "go",
  },
  {
    // Checklist items proposed but pending approval (or mandatory unmet).
    key: "checklist_approval:S9",
    kind: "human",
    when: ({ entity, ev }) => ev.currentStage === "S9" && ddCompletionSummary(entity.id).pending > 0,
  },
  {
    // dd gate pending while the S9 checklist is fully resolved. currentStage is
    // NOT part of this predicate: evaluateProcess sets currentStage only for
    // INCOMPLETE stages, so once S9 completes the loop is already looking at
    // S11 — keying on currentStage would make this rule dead and let the run
    // skip the dd gate straight to entity_ic.
    key: "gate_decision:dd",
    kind: "human",
    when: ({ ev }) => ev.gateStatus.dd !== "go" && ev.completedStages.includes("S9"),
  },
  {
    // S11/S12 are human gates BY DESIGN (ADR-0102 §2): the IC approval is
    // recorded by humans through their own routes; the pipeline always stops
    // here and never proposes to short-circuit it.
    key: "gate_decision:entity_ic",
    kind: "human",
    when: ({ ev }) => ev.currentStage === "S11" && ev.gateStatus.entity_ic !== "go",
  },
  {
    key: "gate_decision:group_ic",
    kind: "human",
    when: ({ ev }) => ev.currentStage === "S11" && ev.gateStatus.entity_ic === "go" && ev.gateStatus.group_ic !== "go",
  },
  {
    // 설립 실행 기록 — chk-entity-formation evidence, human-recorded.
    key: "no_automation:S11",
    kind: "human",
    when: ({ ev }) => ev.currentStage === "S11",
  },
  {
    // 스코어카드 갱신 — the operating owner's quarterly record (ADR-0101).
    key: "no_automation:S12",
    kind: "human",
    when: ({ ev }) => ev.currentStage === "S12",
  },
];

function rulesFor(entity: ProcessEntity): Rule[] {
  return entity.type === "opportunity" ? OPPORTUNITY_RULES : PROJECT_RULES;
}

// ── The loop ───────────────────────────────────────────────────────────────

export interface AdvanceResult {
  run: PipelineRunRow;
  /** What the pipeline did this call (informational action log). */
  actions: string[];
}

/**
 * S12 stale flip (ADR-0152 §3.3): a 'completed' project run whose S12
 * predicate went incomplete (stale review cycle) goes back to 'running' at
 * S12 — but ONLY for an open project. Closure is terminal: a closed project
 * (typed closure_record) is never reopened by staleness. The evaluator is
 * injectable so the flip is unit-testable without satisfying S8–S11.
 */
export function maybeReopenStaleS12(
  run: PipelineRunRow,
  evaluate: (entity: ProcessEntity) => Pick<ProcessEvaluation, "currentStage"> = evaluateProcess,
): PipelineRunRow {
  if (run.status !== "completed" || run.entity_type !== "project" || run.current_stage !== "S12") return run;
  const project = getDb().query("SELECT status FROM md_project WHERE id = ?").get(run.entity_id) as
    | { status: string }
    | undefined;
  if (project?.status !== "open") return run;
  let stale = false;
  try {
    stale = evaluate({ type: "project", id: run.entity_id }).currentStage === "S12";
  } catch {
    stale = false;
  }
  if (!stale) return run;
  setRunState(run.id, "running", { currentStage: "S12" });
  return getRun(run.id);
}

/**
 * advancePipeline — one synchronous pass of the loop. Returns the run in its
 * terminal-for-now state: completed / killed / failed, or paused_for_human
 * with a machine-readable paused_reason and a notification row.
 */
export async function advancePipeline(pipelineRunId: string, opts: { actor?: string } = {}): Promise<AdvanceResult> {
  const actions: string[] = [];
  let run = getRun(pipelineRunId);
  const reopened = maybeReopenStaleS12(run);
  if (reopened.status !== run.status) actions.push("reopened:s12_stale");
  run = reopened;
  if (run.status === "completed" || run.status === "failed" || run.status === "killed" || run.status === "withdrawn") {
    return { run, actions };
  }

  // Claim the run: a conditional UPDATE flips it to 'running' only if it is
  // still advanceable. 0 rows updated means another advance is in flight on
  // this run — no-op instead of interleaving two loops over the same state.
  const claimed = getDb().run(
    "UPDATE pipeline_run SET status = 'running', updated_at = ? WHERE id = ? AND status IN ('running','paused_for_human')",
    [nowIso(), pipelineRunId],
  );
  if (claimed.changes === 0) {
    return { run: getRun(pipelineRunId), actions: [] };
  }

  // Ineffective-automation guard state: per ADVANCE CALL, rule key → the
  // blocker signature seen when the rule last fired. Firing again with an
  // unchanged signature means the automation is not clearing its blocker.
  const fired = new Map<string, string>();

  for (let iteration = 0; iteration < MAX_PIPELINE_ITERATIONS; iteration++) {
    run = getRun(run.id);
    // Append-only lineage (ADR-0102 §1): a promotion recorded outside this
    // loop re-points the run to a NEW project segment.
    const rePointed = maybeRePointAfterExternalPromotion(run);
    if (rePointed) {
      run = rePointed;
      actions.push(`repointed:${run.entity_type}:${run.entity_id}`);
    }

    const entity: ProcessEntity = { type: run.entity_type, id: run.entity_id };
    let ev: ProcessEvaluation;
    try {
      ev = evaluateProcess(entity);
    } catch (err) {
      setRunState(run.id, "failed", {
        pausedReason: `entity_evaluation_failed:${(err as Error).message.slice(0, 120)}`,
      });
      return { run: getRun(run.id), actions };
    }
    const actor = opts.actor ?? run.started_by;

    // KILL anywhere → the process ends (killed, not completed).
    if (ev.terminated) {
      setRunState(run.id, "killed", { currentStage: ev.currentStage });
      actions.push("terminated:kill");
      return { run: getRun(run.id), actions };
    }

    // Everything complete — the project branch reaching S12-complete. (An
    // opportunity never completes: its terminal transition is promotion.)
    if (run.entity_type === "project" && ev.currentStage === null && ev.nextStage === null) {
      setRunState(run.id, "completed", { currentStage: "S12" });
      actions.push("completed:S12");
      return { run: getRun(run.id), actions };
    }

    const ctx: RuleCtx = { run, entity, ev, actor };
    const rule = rulesFor(entity).find((r) => r.when(ctx));

    if (!rule) {
      const stage = ev.currentStage ?? ev.nextStage ?? "unknown";
      pauseRun(run, `no_automation:${stage}`, ev.currentStage);
      actions.push(`paused:no_automation:${stage}`);
      return { run: getRun(run.id), actions };
    }

    if (rule.kind === "human") {
      pauseRun(run, humanKey(rule, ev), ev.currentStage);
      actions.push(`paused:${humanKey(rule, ev)}`);
      return { run: getRun(run.id), actions };
    }

    // Automatable — guarded against ineffective repetition.
    const signature = rule.signature?.(ctx) ?? "";
    if (fired.get(rule.key) === signature) {
      const stage = ev.currentStage ?? "unknown";
      pauseRun(run, `no_automation:${stage}`, ev.currentStage);
      actions.push(`paused:automation_ineffective:${rule.key}`);
      return { run: getRun(run.id), actions };
    }
    fired.set(rule.key, signature);

    try {
      const outcome = await rule.run?.(ctx);
      if (outcome?.pausedReason) {
        pauseRun(run, outcome.pausedReason, ev.currentStage);
        actions.push(`paused:${outcome.pausedReason}`);
        return { run: getRun(run.id), actions };
      }
      actions.push(`auto:${rule.key}`);
      if (outcome?.promotedProjectId) {
        run = openProjectSegment(run, outcome.promotedProjectId);
        actions.push(`promoted:${outcome.promotedProjectId}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRunState(run.id, "failed", {
        currentStage: ev.currentStage,
        pausedReason: `automation_failed:${rule.key}:${message.slice(0, 160)}`,
      });
      actions.push(`failed:${rule.key}`);
      return { run: getRun(run.id), actions };
    }
  }

  // Safety cap exceeded — the automations kept changing state without ever
  // reaching a terminal state. Fail loudly, never spin silently (ADR-0102 §2).
  const current = getRun(run.id);
  setRunState(run.id, "failed", {
    currentStage: current.current_stage,
    pausedReason: `max_iterations_exceeded:${MAX_PIPELINE_ITERATIONS}`,
  });
  return { run: getRun(run.id), actions };
}

/** The exact paused_reason key for a human rule (gate rules carry the gate). */
function humanKey(rule: Rule, ev: ProcessEvaluation): string {
  if (rule.key === "gate_decision") {
    const gate = firstPendingGate(ev, OPPORTUNITY_GATES);
    return gate ? `gate_decision:${gate}` : "gate_decision";
  }
  return rule.key;
}

function pauseRun(run: PipelineRunRow, reason: string, currentStage: string | null): void {
  setRunState(run.id, "paused_for_human", { currentStage, pausedReason: reason });
  insertPauseNotification(getRun(run.id));
}

/**
 * The pause must never be silent (ADR-0102): one notification row per
 * paused_for_human transition, trigger_type 'pipeline_paused', project_id set
 * only when the paused entity IS a project (the 0072 rebuild made the column
 * nullable for opportunity-scoped pauses).
 */
function insertPauseNotification(run: PipelineRunRow): string {
  const id = ulid();
  const now = nowIso();
  const projectId = run.entity_type === "project" ? run.entity_id : null;
  // E1 (ADR-0104) — the pause is never a bare flag: attach a Markdown
  // briefing pack (process snapshot + track advisory + blockers) so the
  // reviewer can start the committee deliberation immediately.
  let briefing = "";
  try {
    const { buildBriefingPack } = require("./briefing-pack.ts");
    const entity: ProcessEntity = { type: run.entity_type, id: run.entity_id } as ProcessEntity;
    briefing = buildBriefingPack(getDb(), entity);
  } catch (err) {
    console.error("[pipeline] briefing pack failed:", err instanceof Error ? err.message : err);
  }
  const payload = JSON.stringify({
    pipeline_run_id: run.id,
    entity_type: run.entity_type,
    entity_id: run.entity_id,
    current_stage: run.current_stage,
    paused_reason: run.paused_reason,
    deep_link: pauseLinkFor(run.paused_reason ?? "", run),
    ...(briefing ? { briefing_markdown: briefing } : {}),
  });
  getDb().run(
    `INSERT INTO notification (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at)
     VALUES (?,?,?,'pipeline_paused','warning',?,'in_app','immediate',?)`,
    [id, resolveResponsibleUser(run), projectId, payload, now],
  );
  return id;
}

/**
 * Responsible person for the pause notification (ADR-0053/0096 human-role
 * posture): the project's lead member on the project branch, the opportunity
 * creator on the opportunity branch, else whoever started the pipeline.
 */
function resolveResponsibleUser(run: PipelineRunRow): string {
  const db = getDb();
  if (run.entity_type === "project") {
    const lead = db
      .query(
        "SELECT user_id FROM project_member WHERE project_id = ? AND revoked_at IS NULL AND project_role = 'lead' ORDER BY granted_at DESC LIMIT 1",
      )
      .get(run.entity_id) as { user_id: string } | undefined;
    if (lead) return lead.user_id;
  } else {
    const creator = db.query("SELECT created_by FROM opportunity WHERE id = ?").get(run.entity_id) as
      | { created_by: string }
      | undefined;
    if (creator?.created_by) return creator.created_by;
  }
  return run.started_by;
}

// ── Promotion lineage ──────────────────────────────────────────────────────

/**
 * Close the opportunity segment and open the project segment (append-only,
 * ADR-0102 §1): the opportunity-keyed row is marked completed (its S1–S7
 * scope IS complete at promotion), a new project-keyed row carries the run
 * forward with the same industry/company inputs.
 */
function openProjectSegment(opportunityRun: PipelineRunRow, projectId: string): PipelineRunRow {
  const db = getDb();
  const now = nowIso();
  db.run(
    "UPDATE pipeline_run SET status = 'completed', current_stage = 'S7', paused_reason = NULL, updated_at = ? WHERE id = ?",
    [now, opportunityRun.id],
  );
  const id = ulid();
  db.run(
    `INSERT INTO pipeline_run (id, entity_type, entity_id, industry_id, initiating_company_id, status, current_stage, paused_reason, started_by, started_at, updated_at)
     VALUES (?,'project',?,?,?,'running','S8',NULL,?,?,?)`,
    [
      id,
      projectId,
      opportunityRun.industry_id,
      opportunityRun.initiating_company_id,
      opportunityRun.started_by,
      now,
      now,
    ],
  );
  return getRun(id);
}

/** A promotion recorded outside this loop re-points the run the same way. */
function maybeRePointAfterExternalPromotion(run: PipelineRunRow): PipelineRunRow | null {
  if (run.entity_type !== "opportunity") return null;
  const row = getDb().query("SELECT project_id FROM opportunity WHERE id = ?").get(run.entity_id) as
    | { project_id: string | null }
    | undefined;
  if (!row?.project_id) return null;
  return openProjectSegment(run, row.project_id);
}

// ── Resume (the watch-cycle pass, ADR-0102 §7) ─────────────────────────────

export interface PipelineResumeOutcome {
  pipelineRunId: string;
  action: "resumed" | "left_paused" | "skipped";
  detail: string;
  status?: PipelineStatus;
  paused_reason?: string | null;
}

/**
 * One resume pass over every paused_for_human run. Auto-resume rule (ADR-0102
 * §7): resume only when the human blocker that caused the pause has cleared —
 * i.e. the first HUMAN rule that would fire now is a DIFFERENT one (or none).
 * "No change = no action": otherwise the run stays paused and nothing is
 * written.
 */
export async function resumePausedPipelines(opts: { actor?: string } = {}): Promise<PipelineResumeOutcome[]> {
  const db = getDb();
  const rows = db
    .query(
      `SELECT r.*
       FROM pipeline_run r
       LEFT JOIN md_project p ON p.id = r.entity_id AND r.entity_type = 'project'
       WHERE r.status = 'paused_for_human'
         AND (r.entity_type != 'project' OR p.status = 'open')
       ORDER BY r.updated_at ASC`,
    )
    .all() as PipelineRunRow[];
  const outcomes: PipelineResumeOutcome[] = [];
  for (const run of rows) {
    const entity: ProcessEntity = { type: run.entity_type, id: run.entity_id };
    let ev: ProcessEvaluation;
    try {
      ev = evaluateProcess(entity);
    } catch {
      outcomes.push({ pipelineRunId: run.id, action: "skipped", detail: "entity no longer evaluable" });
      continue;
    }
    const nextHumanKey = firstHumanRuleKey(entity, ev);
    if (nextHumanKey !== null && sameReason(nextHumanKey, run.paused_reason)) {
      outcomes.push({
        pipelineRunId: run.id,
        action: "left_paused",
        detail: `blocker unchanged: ${run.paused_reason}`,
      });
      continue;
    }
    db.run("UPDATE pipeline_run SET status = 'running', updated_at = ? WHERE id = ?", [nowIso(), run.id]);
    const result = await advancePipeline(run.id, opts);
    outcomes.push({
      pipelineRunId: run.id,
      action: "resumed",
      detail: `resumed from ${run.paused_reason}`,
      status: result.run.status,
      paused_reason: result.run.paused_reason,
    });
  }
  return outcomes;
}

function sameReason(a: string, b: string | null): boolean {
  return b !== null && (a === b || a.startsWith(`${b}:`) || b.startsWith(`${a}:`));
}

/** Classification-only: the first HUMAN rule that would fire (no execution). */
function firstHumanRuleKey(entity: ProcessEntity, ev: ProcessEvaluation): string | null {
  const placeholderRun: PipelineRunRow = {
    id: "",
    entity_type: entity.type,
    entity_id: entity.id,
    industry_id: "",
    initiating_company_id: "",
    status: "running",
    current_stage: null,
    paused_reason: null,
    started_by: "",
    started_at: "",
    updated_at: "",
  };
  const rule = rulesFor(entity).find(
    (r) => r.kind === "human" && r.when({ run: placeholderRun, entity, ev, actor: "" }),
  );
  return rule ? humanKey(rule, ev) : null;
}

// ── Deep links (static blocker → screen map, ADR-0102 §3) ──────────────────

export function pauseLinkFor(reason: string, run: Pick<PipelineRunRow, "entity_type" | "entity_id">): string {
  const projectId = run.entity_type === "project" ? run.entity_id : null;
  const opportunityId = run.entity_type === "opportunity" ? run.entity_id : null;
  // 캐리어 id를 알 때는 딜 캐리어 탭(/deals/{id}/sN)으로 직행하고(route-cleanup
  // design §4.3), 모르면 플랫 라우트로 보낸다 — 플랫 라우트는 이제 캐리어
  // 리다이렉트 스텁(CarrierGate)이라 어차피 같은 곳에 도달한다.
  if (
    reason.startsWith("route_confirmation") ||
    reason === "gate_decision:screening" ||
    reason === "gate_decision:pre_fs" ||
    reason.startsWith("promotion_")
  ) {
    return opportunityId ? `/deals/${opportunityId}/s4` : "/route-decision";
  }
  if (reason.startsWith("manual_input")) return opportunityId ? `/deals/${opportunityId}/s2` : "/opportunities";
  if (reason === "no_automation:S1") return opportunityId ? `/deals/${opportunityId}/s1` : "/market";
  if (reason === "no_automation:S5") return opportunityId ? `/deals/${opportunityId}/s5` : "/greenfield";
  if (reason === "no_automation:S6" || reason === "no_automation:S7" || reason === "gate_decision:target_screening") {
    return opportunityId ? `/deals/${opportunityId}/s6` : "/brownfield";
  }
  if (projectId) return `/projects/${encodeURIComponent(projectId)}`;
  return "/opportunities";
}
