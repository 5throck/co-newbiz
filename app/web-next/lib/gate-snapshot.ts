// Gate decision snapshot builder - ADR-0186 D1 / D3 / D9, design 3.1, 3.12, 3.15.
//
// The server recomputes, never trusts the client: kill-criteria outcomes (with
// the inert list), the latest stored RAG with its data-confidence cap, six-
// validator completeness (read-only), the WACC state, open non-waivable
// checklist items, waivers, the ladder predecessor and the AI recommendation.
// The result is a plain JSON object plus its canonical hash (gate-canonical.ts).
// Nothing here decides: every item is a fact the recorder either acknowledges
// or, for the named hard blocks, must resolve (gate-decision-contract.ts).
//
// Persistence (design 3.12): a PROJECT gate evaluates kill criteria under a
// dedicated `gate_integrity_eval` run, one per evaluation event, and writes the
// kill_criteria_evaluation ledger through the existing repository. An
// OPPORTUNITY gate writes no ledger rows (no project, run.project_id is NOT
// NULL): the outcomes live only in the snapshot, evaluated against an
// opportunity-scoped variable source; a predicate over a project-only
// variable is UNASSESSED, never a silent pass.
//
// buildGateSnapshot() writes (project): call it inside the caller's transaction
// (brief, decision). previewGateSnapshot() is the read path (GET): it runs the
// same builder in a transaction that is rolled back, so GET leaves no residue,
// and caches per (entity, gate, user, input version).
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { evaluateValidatorCompleteness } from "../../../db/lib/validator-completeness.ts";
import { readRagView } from "../../../db/lib/rag-service.ts";
import { listProjectWaivers } from "../../../db/lib/compliance.ts";
import { recordKillCriteriaEvaluation } from "../../../db/repositories/kill-criteria.repository.ts";
import { listConditions } from "../../../db/repositories/condition-precedent.repository.ts";
import { countersignState } from "../../../db/lib/gate-effective.ts";
import { gateIntegrityMode } from "./gate-integrity-flags.ts";
import { resolveWaccConfirmation } from "../../../db/lib/wacc-confirmation.ts";
import { certificationFailure } from "./gate-certification.ts";
import {
  GATE_SNAPSHOT_SCHEMA_VERSION, createGateEvalRun, getBriefRecord, latestBriefRecord, listActiveKillOverrides,
  type BriefRecord, type EvalEvent, type KillOverrideRow,
} from "../../../db/repositories/gate-snapshot.repository.ts";
import { buildLookup, validateRegistryEntry, type RegistryEntry as CoreRegistryEntry, type SnapshotVarRow } from "../../../packages/core-scoring/src/kill-criteria.ts";
import { evaluatePredicate, parsePredicate } from "../../../packages/core-scoring/src/predicate.ts";
import { snapshotHash } from "./gate-canonical.ts";
import {
  GATE_FIRST_STAGE, GATE_LAST_STAGE, OPEN_MONITORING, OPPORTUNITY_LAST_STAGE, carryDue, classifyKill, deriveOpenCarries, laterStage, procedureTrack,
  type CarrySource, type RegistryScope,
} from "./gate-kill-scope.ts";
import { stageIndex } from "../../../packages/core-scoring/src/kill-criteria.ts";
import { collectPredicateVars } from "../../../db/lib/applies-when.ts";
import { ladderBlock } from "./gate-ladder.ts";
import { ladderFor, type LadderTrack } from "./gate-sequence-view.ts";
import { applicableKillProcedures, loadKillCriteriaRegistry } from "./ic-review-steps.ts";
import { evaluateProcess, latestRouteDecision } from "./process-flow.ts";
import { resolveTrack } from "./project-track.ts";
import { scopedChecklistItems } from "./greenfield-subtrack.ts";
import { subTrackChecklistIds } from "./dd-checklist-tailor.ts";

export type SnapshotEntity = "opportunity" | "project";
export const SNAPSHOT_ENGINE_VERSIONS = { snapshot_builder: "2", kill_registry: "adr-0193", validators: "adr-0185-core6", rag: "latest-stored" } as const;
const EXPIRING_DAYS = 14;
/** Items handled by their own rule families (validators / WACC / certification); never listed as generic non-waivable ACKs. */
const OWN_FAMILY_ITEMS: ReadonlySet<string> = new Set(["bf-01", "bf-02", "bf-03"]);
/** Gates at which the DD checklist's open non-waivable items are listed (earlier gates precede DD). */
const NONWAIVABLE_GATES: ReadonlySet<string> = new Set(["dd", "entity_ic", "group_ic"]);
const VALIDATOR_GATES: ReadonlySet<string> = new Set(["dd", "entity_ic", "group_ic"]);

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface KillItem {
  /** `<procedure>:<criterion_id>` - the stable acknowledgement key. */
  key: string;
  procedure: string;
  criterion_id: string;
  title: string;
  action: string;
}
export interface KillTriggered extends KillItem {
  /** action = halt: policy-binding (neb-policy 2.5) unless a Group IC override exists. */
  binding: boolean;
  override_id: string | null;
  /** ADR-0193 C-5: the criterion triggered before its `evaluable_from` stage, so its input may still be partial (a possible false positive). It stays triggered. */
  partial_input: boolean;
}
/** ADR-0193: a criterion whose stage is after the entity's current stage - information only, no acknowledgement, never counted as unassessed. */
export interface KillNotReached extends KillItem {
  evaluable_from: string;
  reevaluate_at: string;
}
/** ADR-0193 (C-4): one carried key and what this gate's evaluation did with it. */
export interface KillCarriedIn {
  key: string;
  /** The decision that opened the carry; null for a criterion this very snapshot found overdue or open-monitoring. */
  from_decision_id: string | null;
  /** Criterion title (shown by name in the IC package). */
  title: string;
  /** false | triggered | unassessed (evaluated here, or an S12 criterion before close); overdue (cannot be classified as reached - registry or stage defect); out_of_track. */
  outcome: "false" | "triggered" | "unassessed" | "overdue" | "out_of_track";
  /** Why a criterion is reported unassessed without a data source evaluation (S12 criteria before close: "post-close data not yet available"). */
  reason: string | null;
  /** evaluated = closed by evaluation; open = evaluated but still unassessed, or overdue; out_of_track = the route decision closed it; open_monitoring = S12, closed only by a recorded human decision on the S12 monitoring surface. */
  closure: "evaluated" | "open" | "out_of_track" | "open_monitoring";
  action: string;
  evaluable_from: string;
  reevaluate_at: string;
  /** The route decision that closed the carry (out_of_track only), never dropped. */
  route_decision_id: string | null;
  /** Read-time implicit carry of a legacy acknowledged GO (design 4.4). */
  implicit: boolean;
}
export interface RequiredAck {
  key: string;
  /** kill_triggered | kill_override | kill_unassessed | rag_red | rag_absent | nonwaivable_open */
  kind: string;
  procedure?: string;
  criterion_id?: string;
  action?: string;
}
export interface HardBlockInfo {
  code: string;
  keys: string[];
  /** True when the rule's family is `enforce` (the GO would be refused); false in shadow, where it is audited only. */
  enforced: boolean;
}

export interface GateSnapshot {
  schema_version: number;
  gate: string;
  entity: { type: SnapshotEntity; id: string };
  track: LadderTrack | null;
  computed_at: string;
  engine_versions: Record<string, string>;
  kill: {
    procedures: string[];
    evaluated: number;
    inert: number;
    inert_list: Array<{ key: string; title: string }>;
    false_count: number;
    triggered: KillTriggered[];
    unassessed: KillItem[];
    /** ADR-0193: the entity's effective current stage the classifier used (S1-S12). */
    current_stage: string;
    /** ADR-0193: criteria not yet evaluable at the current stage (sorted by key). Inside the hash. */
    not_reached: KillNotReached[];
    /** ADR-0193: carried keys from earlier recorded decisions and what this gate did with them (sorted by key). Inside the hash. */
    carried_in: KillCarriedIn[];
    /** ADR-0193 (risk-officer D): criteria owned by a later gate, shown as pending with their scheduled gate - never absent. Not carries (the later gate owns them). */
    scheduled: Array<{ key: string; title: string; action: string; evaluable_from: string; reevaluate_at: string; status: "pending" }>;
    /** ADR-0193 (risk-officer C): evidence caveats on evaluated criteria, e.g. #5 read on gate-date state, not the site-announcement date. Inside the hash. */
    caveats: Array<{ key: string; caveat: string }>;
    /** ADR-0193 C-3: a project's first gate (fs) found no md_project.source_opportunity_id, so the opportunity carries cannot be verified. */
    lineage_missing: boolean;
    /** The evaluation run of this snapshot (project gates); excluded from the hash. */
    eval_run_id: string | null;
  };
  rag: {
    overall: string | null;
    dimensions: Array<{ dimension: string; grade: string }>;
    data_confidence_cap: { grade: string | null; applied: boolean; capped_dimension: string | null };
    assessment_id: string | null;
  } | null;
  validators: { declared: number; applicable: number; completed: number; missing: string[] } | null;
  nonwaivable_open: Array<{ key: string; checklist_id: string; item_id: string; status: string }>;
  /** `confirmed` = subject set AND wacc and hurdle_irr both user-confirmed (ADR-0186 D8); `missing` names what is not. */
  wacc: { subject: string | null; status: "sourced" | "assumed" | "absent"; bf13: "set" | "unset" | "n/a"; confirmed: boolean; missing: string[] } | null;
  waivers: { active: Array<{ id: string; clause_ref: string; approved_by: string | null; expires_at: string }>; expiring_14d: string[] };
  /** Open condition precedents of the project (ADR-0186 D4); DISPLAY at GO, a hard block at closing / group_ic. */
  conditions_open: Array<{ id: string; text: string; clear_by: string }>;
  ladder: {
    prior_gate: string | null; prior_carrier: SnapshotEntity | null; prior_decision_id: string | null; prior_decision: string | null; effective: boolean; blocker: string | null;
    /** The predecessor GO is recorded but still awaits its maker/checker countersign (ADR-0186 D6). */
    prior_awaiting_countersign: boolean;
  };
  ai: { brief_id: string; recommended: string | null; confidence: string | null; source: string } | null;
  required_acks: RequiredAck[];
  hard_blocks: HardBlockInfo[];
}

export interface BuildOptions {
  entityType: SnapshotEntity;
  entityId: string;
  gate: string;
  actor: string;
  event: EvalEvent;
  /** Explicit brief the recorder is deciding against; default = the actor's latest brief for this gate within 24 h. */
  briefId?: string | null;
  now?: string;
  db?: Database;
}

export interface BuiltSnapshot {
  snapshot: GateSnapshot;
  hash: string;
  evalRunId: string | null;
  brief: BriefRecord | null;
}

// ── Kill criteria ───────────────────────────────────────────────────────────

export const OPPORTUNITY_PROCEDURES: Record<string, (track: LadderTrack | null) => string[]> = {
  screening: (t) => (t ? [`${t}-screening`] : ["greenfield-screening", "brownfield-screening"]),
  // ADR-0193 O-2: deal-shape-chain criteria (registry reevaluate_at pre_fs) are owned and evaluated at pre_fs;
  // flow.spec 2.19.0 moved their killCriteriaRegistry listing there from screening (they were never evaluated before).
  pre_fs: (t) => (t ? [`${t}-pre-fs`, "deal-shape-chain"] : ["greenfield-pre-fs", "brownfield-pre-fs", "deal-shape-chain"]),
  target_screening: () => ["brownfield-target-screening", "brownfield-target-identification"],
};

/**
 * Project procedures per gate. `applicableKillProcedures` is the project-level universe (entity IC,
 * track fs/dd, establishment); a gate evaluates the procedures of ITS stage - a brownfield fs GO is not
 * judged on the DD-exit validator criterion - and the IC gates see the whole universe.
 */
export function projectKillProcedures(db: Database, projectId: string, gate: string, track: LadderTrack | null): string[] {
  const all = applicableKillProcedures(db, projectId);
  // ADR-0193 (owner decision 2026-11-07): the M&A post-close procedure is evaluated from DD for the criteria that can
  // occur from S9 (clean-team breach). Its S12 criteria are never evaluated at a gate: they leave the IC gates as
  // open_monitoring carries (openMonitoringCarries) and close only on the S12 monitoring surface.
  const pmi = track === "brownfield" ? [PMI_PROCEDURE] : [];
  if (gate === "entity_ic" || gate === "group_ic") return all;
  if (gate === "fs") {
    const fs = all.filter((p) => p === "brownfield-fs" || p === "brownfield-fs-comparative");
    return track === "greenfield" ? ["greenfield-fs"] : fs;
  }
  return [...all.filter((p) => p.endsWith("-dd")), ...(gate === "dd" ? pmi : [])];
}

export const PMI_PROCEDURE = "pmi-integration-execution";
const POST_CLOSE_REASON = "post-close data not yet available";
/** ADR-0193 C-6 open: #5 is read on the gate-date state (risk-officer condition C). Follow-up ticket: FOLLOWUP-ADR0193-C6 (placeholder; see design 13). */
export const KILL_EVIDENCE_CAVEATS: Readonly<Record<string, string>> = {
  "greenfield-screening:infrastructure_plan_not_finalized_at_site_announcement": "evaluated on gate-date state, not site-announcement date (ADR-0193 C-6 pending): not clean evidence",
};
/** Criteria a gate shows as pending although a later gate owns them (flow.spec 2.19.0 moved deal-shape-chain to pre_fs). */
const SCHEDULED_ELSEWHERE: Readonly<Record<string, readonly string[]>> = { screening: ["deal-shape-chain"] };
/** Gate-owned criteria of a procedure that a gate shares only in part (flow.spec: dd lists clean_team_protocol_breach only). */
const GATE_CRITERION_SCOPE: Readonly<Record<string, Readonly<Record<string, ReadonlySet<string>>>>> = {
  dd: { [PMI_PROCEDURE]: new Set(["clean_team_protocol_breach"]) },
};
function inGateScope(gate: string, procedure: string, criterionId: string): boolean {
  const scope = GATE_CRITERION_SCOPE[gate]?.[procedure];
  return !scope || scope.has(criterionId);
}

/** The variables the opportunity-scoped source can supply (see opportunityVarRows). ADR-0193 guard: a carried criterion reading any other variable has no data source at an opportunity re-evaluation gate. */
export const OPPORTUNITY_SCOPE_VARS: readonly string[] = ["screening.viable_targets"];

/** Opportunity-scoped variable source (design 3.12): only variables that exist at opportunity scope. */
function opportunityVarRows(db: Database, opportunityId: string): SnapshotVarRow[] {
  const total = (db.query("SELECT COUNT(*) AS n FROM brownfield_target WHERE opportunity_id = ?").get(opportunityId) as { n: number }).n;
  if (total === 0) return [];
  const shortlisted = (db.query("SELECT COUNT(*) AS n FROM brownfield_target WHERE opportunity_id = ? AND status = 'shortlisted'").get(opportunityId) as { n: number }).n;
  return [{ var_key: "screening.viable_targets", value_num: shortlisted, value_text: null, status: "present" }];
}

interface KillOutcome { key: string; procedure: string; criterion_id: string; title: string; action: string; outcome: "triggered" | "false" | "unassessed" }
interface KillEvaluation { outcomes: KillOutcome[]; inert: Array<{ key: string; title: string }> }

function titleOf(entry: { criterion_id: string; title?: string }): string {
  return entry.title ?? entry.criterion_id;
}

/** `only` (ADR-0193 carries): evaluate just these `<procedure>:<criterion>` keys of a procedure that is not part of the gate's own set. */
function evaluateOpportunityKill(db: Database, opportunityId: string, procedures: string[], only?: ReadonlySet<string>): KillEvaluation {
  const lookup = buildLookup(opportunityVarRows(db, opportunityId));
  const outcomes: KillOutcome[] = [];
  const inert: Array<{ key: string; title: string }> = [];
  for (const procedure of procedures) {
    for (const entry of loadKillCriteriaRegistry(procedure) as unknown as CoreRegistryEntry[]) {
      const key = `${procedure}:${entry.criterion_id}`;
      if (only && !only.has(key)) continue;
      if (entry.predicate === null || entry.predicate === undefined || entry.enabled === false) {
        inert.push({ key, title: titleOf(entry) });
        continue;
      }
      validateRegistryEntry(entry);
      const result = evaluatePredicate(parsePredicate(entry.predicate), lookup);
      outcomes.push({ key, procedure, criterion_id: entry.criterion_id, title: titleOf(entry), action: entry.action, outcome: result === "true" ? "triggered" : result });
    }
  }
  return { outcomes, inert };
}

function evaluateProjectKill(db: Database, o: BuildOptions, procedures: string[], runId: string, now: string, only?: ReadonlySet<string>): KillEvaluation {
  const outcomes: KillOutcome[] = [];
  const inert: Array<{ key: string; title: string }> = [];
  for (const procedure of procedures) {
    // A procedure shared with this gate only in part (dd lists one pmi criterion): nothing executable in scope means
    // nothing to evaluate - never write ledger rows for the out-of-scope criteria.
    if (GATE_CRITERION_SCOPE[o.gate]?.[procedure]) {
      const scoped = loadKillCriteriaRegistry(procedure).filter((e) => inGateScope(o.gate, procedure, e.criterion_id));
      if (!scoped.some((e) => e.enabled !== false && (e as { predicate?: unknown }).predicate != null)) {
        for (const e of scoped) inert.push({ key: `${procedure}:${e.criterion_id}`, title: titleOf(e) });
        continue;
      }
    }
    const { result } = recordKillCriteriaEvaluation(
      { runId, projectId: o.entityId, procedure, evaluatedBy: o.actor, evaluatedByLabel: `gate-${o.event === "snapshot" ? "decision" : o.event}:${o.actor}`, now },
      db,
    );
    const titles = new Map(loadKillCriteriaRegistry(procedure).map((e) => [e.criterion_id, titleOf(e)]));
    for (const out of result.outcomes) {
      const key = `${procedure}:${out.criterion_id}`;
      if (only && !only.has(key)) continue;
      outcomes.push({
        key, procedure, criterion_id: out.criterion_id, title: out.title ?? titles.get(out.criterion_id) ?? out.criterion_id,
        action: out.action, outcome: out.outcome === "true" ? "triggered" : out.outcome,
      });
    }
    for (const e of loadKillCriteriaRegistry(procedure)) {
      const key = `${procedure}:${e.criterion_id}`;
      if (only && !only.has(key)) continue;
      if (e.enabled === false || (e as { predicate?: unknown }).predicate === null || (e as { predicate?: unknown }).predicate === undefined) {
        inert.push({ key, title: titleOf(e) });
      }
    }
  }
  return { outcomes, inert };
}

// ── Sections ────────────────────────────────────────────────────────────────

const byKey = <T extends { key: string }>(a: T, b: T) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

function ragSection(db: Database, projectId: string): NonNullable<GateSnapshot["rag"]> | null {
  const view = readRagView(db, projectId);
  const latest = db.query("SELECT run_id FROM rag_assessment WHERE project_id = ? ORDER BY assessed_at DESC, id DESC LIMIT 1").get(projectId) as { run_id: string } | null;
  const dims = Object.entries(view.dimensions).map(([dimension, v]) => ({ dimension, grade: v!.grade })).sort((a, b) => (a.dimension < b.dimension ? -1 : 1));
  const confidence = view.dimensions["data_confidence"]?.grade ?? null;
  const overall = view.overall?.grade ?? null;
  // The cap itself is applied inside the RAG engine (boundary 4); this only makes it visible beside the decision.
  const applied = confidence !== null && confidence !== "green" && overall !== null && overall === confidence;
  return {
    overall,
    dimensions: dims,
    data_confidence_cap: { grade: confidence, applied, capped_dimension: applied ? "data_confidence" : null },
    assessment_id: latest?.run_id ?? null,
  };
}

function waccSection(db: Database, projectId: string, track: LadderTrack | null): NonNullable<GateSnapshot["wacc"]> {
  const c = resolveWaccConfirmation(db, projectId);
  return { subject: c.subject, status: c.source_status, bf13: track === "brownfield" ? (c.subject ? "set" : "unset") : "n/a", confirmed: c.confirmed, missing: [...c.missing] };
}

function waiversSection(db: Database, projectId: string, now: string): GateSnapshot["waivers"] {
  const live = listProjectWaivers(db, { projectId, now, targetId: null }).filter((w) => w.effective_status === "active" && w.approved_at !== null);
  const horizon = new Date(new Date(now).getTime() + EXPIRING_DAYS * 86_400_000).toISOString();
  const active = live.map((w) => ({ id: w.id, clause_ref: w.clause_ref, approved_by: w.approved_by, expires_at: w.expires_at })).sort((a, b) => (a.id < b.id ? -1 : 1));
  return { active, expiring_14d: active.filter((w) => w.expires_at <= horizon).map((w) => w.id) };
}

/** Open (not `pass`) mandatory non-waivable DD checklist items, excluding those owned by the validators / WACC / certification families. */
function nonWaivableOpen(db: Database, projectId: string): GateSnapshot["nonwaivable_open"] {
  const states = db
    .query("SELECT checklist_id, item_id, status FROM project_checklist_item_state WHERE project_id = ? AND target_id IS NULL")
    .all(projectId) as Array<{ checklist_id: string; item_id: string; status: string }>;
  const checklistIds = new Set<string>([...subTrackChecklistIds(projectId), ...states.map((s) => s.checklist_id)]);
  const out: GateSnapshot["nonwaivable_open"] = [];
  for (const checklistId of [...checklistIds].sort()) {
    if (checklistId.startsWith("custom:")) continue;
    for (const item of scopedChecklistItems(checklistId) ?? []) {
      if (!item.mandatory || item.waiver_eligible || OWN_FAMILY_ITEMS.has(item.id)) continue;
      const status = states.find((s) => s.checklist_id === checklistId && s.item_id === item.id)?.status ?? "pending";
      if (status !== "pass") out.push({ key: `np:${checklistId}:${item.id}`, checklist_id: checklistId, item_id: item.id, status });
    }
  }
  return out.sort(byKey);
}

interface DecisionRef { id: string; decision: string }

/** Latest non-stale decision of one gate - the same ordering as latestGateDecisions. */
function latestDecisionRef(db: Database, entityType: SnapshotEntity, entityId: string, gate: string): DecisionRef | null {
  return (
    (db
      .query(
        `SELECT g.id, g.decision FROM gate_decision g
         WHERE g.entity_type = ? AND g.entity_id = ? AND g.gate = ? AND NOT EXISTS (SELECT 1 FROM gate_decision_stale s WHERE s.decision_id = g.id)
         ORDER BY g.decided_at DESC, g.id DESC LIMIT 1`,
      )
      .get(entityType, entityId, gate) as DecisionRef | null) ?? null
  );
}

function ladderSection(db: Database, o: BuildOptions, track: LadderTrack | null): GateSnapshot["ladder"] {
  const full = ladderFor(track);
  const idx = full.indexOf(o.gate);
  const prior = idx > 0 ? full[idx - 1] : null;
  const block = ladderBlock(o.entityType, o.entityId, o.gate);
  let priorCarrier: SnapshotEntity | null = null;
  let ref: DecisionRef | null = null;
  if (prior) {
    const isProjectFs = o.entityType === "project" && o.gate === "fs";
    priorCarrier = isProjectFs ? "opportunity" : o.entityType;
    const entityId = isProjectFs
      ? ((db.query("SELECT source_opportunity_id FROM md_project WHERE id = ?").get(o.entityId) as { source_opportunity_id: string | null } | null)?.source_opportunity_id ?? null)
      : o.entityId;
    ref = entityId ? latestDecisionRef(db, priorCarrier, entityId, prior) : null;
  }
  let awaiting = false;
  if (ref && priorCarrier === "project" && prior) {
    const full = db.query("SELECT id, gate, decision, decided_by FROM gate_decision WHERE id = ?").get(ref.id) as { id: string; gate: string; decision: string; decided_by: string } | null;
    const st = full ? countersignState(db, o.entityId, full) : "not_applicable";
    awaiting = st === "pending_countersign" || st === "countersign_rejected";
  }
  return {
    prior_gate: prior, prior_carrier: priorCarrier, prior_decision_id: ref?.id ?? null, prior_decision: ref?.decision ?? null,
    effective: block === null, blocker: block?.blocker ?? null, prior_awaiting_countersign: awaiting,
  };
}

function aiSection(brief: BriefRecord | null): GateSnapshot["ai"] {
  return brief ? { brief_id: brief.id, recommended: brief.recommended, confidence: brief.confidence, source: brief.source } : null;
}

// ── Required acknowledgements and hard-block info (pure over the snapshot) ──

export function requiredAcks(s: Pick<GateSnapshot, "kill" | "rag" | "nonwaivable_open" | "conditions_open" | "entity">): RequiredAck[] {
  const acks: RequiredAck[] = [];
  for (const t of s.kill.triggered) {
    if (t.action === "halt" && t.override_id === null) continue; // a hard block, not an acknowledgement
    acks.push({ key: t.key, kind: t.action === "halt" ? "kill_override" : "kill_triggered", procedure: t.procedure, criterion_id: t.criterion_id, action: t.action });
  }
  for (const u of s.kill.unassessed) acks.push({ key: u.key, kind: "kill_unassessed", procedure: u.procedure, criterion_id: u.criterion_id, action: u.action });
  if (s.entity.type === "project") {
    if (!s.rag || s.rag.overall === null) acks.push({ key: "rag:absent", kind: "rag_absent" });
    else if (s.rag.overall === "red") acks.push({ key: "rag:overall", kind: "rag_red" });
  }
  for (const n of s.nonwaivable_open) acks.push({ key: n.key, kind: "nonwaivable_open" });
  return acks.sort(byKey);
}

function hardBlocks(
  snap: Pick<GateSnapshot, "kill" | "validators" | "conditions_open" | "entity" | "gate" | "track" | "wacc">,
  extra: { certificationKeys: string[]; enforceUnsafeKeys?: string[] },
): HardBlockInfo[] {
  const out: HardBlockInfo[] = [];
  // ADR-0193 (risk-officer B): enforce is fail-closed while a carried criterion has no data source at its re-evaluation scope.
  if ((extra.enforceUnsafeKeys ?? []).length > 0) out.push({ code: "kill_enforce_unsafe", keys: [...(extra.enforceUnsafeKeys ?? [])].sort(), enforced: true });
  const unoverridden = snap.kill.triggered.filter((t) => t.binding && t.override_id === null).map((t) => t.key).sort();
  const killEnforced = gateIntegrityMode("kill_binding") === "enforce";
  if (unoverridden.length > 0) out.push({ code: "kill_binding_unoverridden", keys: unoverridden, enforced: killEnforced });
  // ADR-0193 (R-5: no Group IC override for any of these - overdue and lineage are registry/data defects, not business risks).
  const carried = snap.kill.carried_in ?? [];
  const overdue = carried.filter((c) => c.outcome === "overdue").map((c) => c.key).sort();
  if (overdue.length > 0) out.push({ code: "kill_carry_overdue", keys: overdue, enforced: killEnforced });
  // C-1: a carried halt criterion still unassessed at its re-evaluation gate. Defer-then-acknowledge would be a silent drop.
  const carryUnassessed = carried.filter((c) => c.outcome === "unassessed" && c.closure !== "open_monitoring" && c.action === "halt").map((c) => c.key).sort();
  if (carryUnassessed.length > 0) out.push({ code: "kill_carry_unassessed", keys: carryUnassessed, enforced: killEnforced });
  // C-3: lineage gap at the first project gate - never read as "no carries".
  if (snap.kill.lineage_missing) out.push({ code: "kill_lineage_missing", keys: [snap.entity.id], enforced: killEnforced });
  // bf-01 (ADR-0186 D4): an applicable core validator is missing - brownfield dd GO, re-checked at entity_ic and group_ic.
  const validatorsMode = gateIntegrityMode("validators");
  if (validatorsMode !== "off") {
    if (snap.validators && snap.validators.missing.length > 0) {
      out.push({ code: "validators_incomplete", keys: [...snap.validators.missing].sort(), enforced: validatorsMode === "enforce" });
    }
    // bf-03 (O-3): load-bearing certification transferability unconfirmed at a brownfield pre_fs GO.
    if (extra.certificationKeys.length > 0) out.push({ code: "certification_unconfirmed", keys: [...extra.certificationKeys].sort(), enforced: validatorsMode === "enforce" });
    // group_ic GO with an open condition that waits for the group sitting.
    if (snap.entity.type === "project" && snap.gate === "group_ic") {
      const waiting = snap.conditions_open.filter((c) => c.clear_by === "group_ic").map((c) => c.id).sort();
      if (waiting.length > 0) out.push({ code: "condition_open", keys: waiting, enforced: validatorsMode === "enforce" });
    }
  }
  // ADR-0186 D8 (neb-policy 2.2, bf-02): WACC / hurdle not user-confirmed. fs: any missing item blocks. Later project
  // gates re-read the state and block only on a regression (a non-user row exists: `assumed`), so legacy projects whose
  // history predates the rule are not re-blocked for an absent session (they are labelled provisional instead).
  const waccMode = gateIntegrityMode("wacc");
  if (waccMode !== "off" && snap.entity.type === "project" && snap.wacc && !snap.wacc.confirmed) {
    if (snap.gate === "fs" || ((snap.gate === "dd" || snap.gate === "entity_ic" || snap.gate === "group_ic") && snap.wacc.status === "assumed")) {
      out.push({ code: "wacc_unconfirmed", keys: [...snap.wacc.missing].sort(), enforced: waccMode === "enforce" });
    }
  }
  return out;
}

// ── ADR-0193 helpers: current stage, registry scope, lineage and carry sources ──

/** Registry scope fields of `<procedure>:<criterion>` (evaluable_from / reevaluate_at), or null when the entry is not found. */
function registryScopeOf(key: string): RegistryScope | null {
  const i = key.indexOf(":");
  const e = (loadKillCriteriaRegistry(key.slice(0, i)) as unknown as Array<CoreRegistryEntry & RegistryScope>).find((x) => x.criterion_id === key.slice(i + 1));
  return e ? { evaluable_from: e.evaluable_from, reevaluate_at: e.reevaluate_at } : null;
}

function registryActionOf(key: string): string {
  const i = key.indexOf(":");
  return (loadKillCriteriaRegistry(key.slice(0, i)).find((x) => x.criterion_id === key.slice(i + 1))?.action as string | undefined) ?? "";
}

/** `<procedure>:<criterion>` keys whose registry `reevaluate_at` is open_monitoring and that apply to the track (the M&A post-close procedure). */
function openMonitoringKeys(track: LadderTrack | null): string[] {
  if (track !== "brownfield") return [];
  return loadKillCriteriaRegistry(PMI_PROCEDURE)
    .filter((e) => (e as unknown as RegistryScope).reevaluate_at === OPEN_MONITORING)
    .map((e) => `${PMI_PROCEDURE}:${e.criterion_id}`)
    .sort();
}

/** A track-specific procedure of the other track than the decided one: the carry is closed out_of_track, never reached. */
function outOfTrack(procedure: string, track: LadderTrack | null): boolean {
  const t = procedureTrack(procedure);
  return track !== null && t !== null && t !== track;
}

/**
 * The stage the classifier compares `evaluable_from` against: the entity's current pipeline stage from the process
 * engine (not the gate's nominal stage - the S4 screening re-decision must see S4-reachable criteria), never earlier
 * than the gate's own first stage (an IC GO is recorded at S11 even when S10 still reads open) and, for an
 * opportunity, never later than its carrier's last stage S7.
 */
function resolveCurrentStage(o: BuildOptions): string {
  let cur: string | null = null;
  try {
    cur = evaluateProcess({ type: o.entityType, id: o.entityId }).currentStage;
  } catch {
    cur = GATE_LAST_STAGE[o.gate] ?? null; // the process engine could not read the entity: fall back to the gate's own stage
  }
  let base: string = cur ?? (o.entityType === "opportunity" ? OPPORTUNITY_LAST_STAGE : "S12");
  if (o.entityType === "opportunity" && stageIndex(base) > stageIndex(OPPORTUNITY_LAST_STAGE)) base = OPPORTUNITY_LAST_STAGE;
  return laterStage(base, GATE_FIRST_STAGE[o.gate] ?? "S1");
}

/**
 * Recorded decisions of the entity lineage (opportunity -> project via md_project.source_opportunity_id, the same
 * rule as priorGate), every non-stale decision of every kind, with its stored snapshot when there is one.
 */
function loadCarryContext(db: Database, o: BuildOptions): { sources: CarrySource[]; opportunityId: string | null; lineageMissing: boolean } {
  const entities: Array<[SnapshotEntity, string]> = [[o.entityType, o.entityId]];
  let opportunityId: string | null = o.entityType === "opportunity" ? o.entityId : null;
  let lineageMissing = false;
  if (o.entityType === "project") {
    opportunityId = (db.query("SELECT source_opportunity_id FROM md_project WHERE id = ?").get(o.entityId) as { source_opportunity_id: string | null } | null)?.source_opportunity_id ?? null;
    if (opportunityId) entities.push(["opportunity", opportunityId]);
    else if (o.gate === "fs") lineageMissing = true; // C-3: the first project gate never treats a gap as "no carries"
  }
  const sources: CarrySource[] = [];
  for (const [type, id] of entities) {
    const rows = db
      .query(
        `SELECT g.id, g.gate, g.decision, g.decided_at, s.schema_version, s.snapshot_json
         FROM gate_decision g LEFT JOIN gate_decision_snapshot s ON s.decision_id = g.id
         WHERE g.entity_type = ? AND g.entity_id = ? AND NOT EXISTS (SELECT 1 FROM gate_decision_stale st WHERE st.decision_id = g.id)`,
      )
      .all(type, id) as Array<{ id: string; gate: string; decision: string; decided_at: string; schema_version: number | null; snapshot_json: string | null }>;
    for (const r of rows) {
      let snapshot: Record<string, unknown> | null = null;
      if (r.snapshot_json) {
        try { snapshot = JSON.parse(r.snapshot_json) as Record<string, unknown>; } catch { snapshot = null; }
      }
      sources.push({ decision_id: r.id, gate: r.gate, decision: r.decision, decided_at: r.decided_at, schema_version: r.schema_version, snapshot });
    }
  }
  return { sources, opportunityId, lineageMissing };
}

/** Legacy (schema v1) snapshots read with the ADR-0193 sections empty (design 4.4); the stored row is never rewritten. */
export function normalizeStoredSnapshot(snapshot: unknown): unknown {
  const snap = snapshot as { kill?: Record<string, unknown> } | null;
  if (!snap || typeof snap !== "object" || !snap.kill) return snapshot;
  const k = snap.kill;
  return {
    ...snap,
    kill: {
      ...k,
      current_stage: k.current_stage ?? null,
      not_reached: k.not_reached ?? [],
      carried_in: k.carried_in ?? [],
      scheduled: k.scheduled ?? [],
      caveats: k.caveats ?? [],
      lineage_missing: k.lineage_missing ?? false,
      triggered: Array.isArray(k.triggered) ? (k.triggered as Array<Record<string, unknown>>).map((t) => ({ partial_input: false, ...t })) : k.triggered,
    },
  };
}

/** Per-schema-version canonicalisers: a stored hash is verified under the version it was written with (design 4.4). v2 only ADDED fields inside the hash, so v1 rows keep verifying unchanged. */
const SNAPSHOT_HASHERS: Readonly<Record<number, (snapshot: unknown) => string>> = { 1: snapshotHash, 2: snapshotHash };

export function verifyStoredSnapshotHash(stored: { schema_version: number; snapshot: unknown; snapshot_hash: string }): { ok: boolean; reason: string | null } {
  const hasher = SNAPSHOT_HASHERS[stored.schema_version];
  if (!hasher) return { ok: false, reason: `unknown schema_version ${stored.schema_version}` };
  return hasher(stored.snapshot) === stored.snapshot_hash ? { ok: true, reason: null } : { ok: false, reason: "hash_mismatch" };
}

// ── ADR-0193 enforce guard (risk-officer B) ─────────────────────────────────

export interface GuardOffender { key: string; reevaluate_at: string; missing_vars: string[] }

/**
 * Carried (deferred) opportunity criteria that have NO data source at their re-evaluation scope: a criterion owned by an
 * earlier opportunity gate whose `reevaluate_at` is an opportunity gate, while a variable of its predicate is not supplied by
 * the opportunity-scoped source (OPPORTUNITY_SCOPE_VARS). Under kill_binding=enforce such a carry could only ever end in
 * `kill_carry_unassessed` / a meaningless acknowledgement, so enforce must not be enabled until it is re-scoped or sourced.
 */
export function carriedWithoutDataSource(): GuardOffender[] {
  const out = new Map<string, GuardOffender>();
  const oppGates = ["screening", "pre_fs", "target_screening"];
  for (const gate of oppGates) {
    for (const track of [null, "greenfield", "brownfield"] as Array<LadderTrack | null>) {
      for (const procedure of OPPORTUNITY_PROCEDURES[gate](track)) {
        for (const e of loadKillCriteriaRegistry(procedure) as unknown as Array<CoreRegistryEntry & RegistryScope>) {
          if (e.predicate == null || e.enabled === false || !e.reevaluate_at) continue;
          const deferred = gateIdx(e.reevaluate_at) > gateIdx(gate);
          if (!deferred || gateIdx(e.reevaluate_at) > gateIdx("target_screening")) continue; // a project gate always has its data
          const vars = [...collectPredicateVars(parsePredicate(e.predicate))];
          const missingVars = vars.filter((v) => !OPPORTUNITY_SCOPE_VARS.includes(v));
          if (missingVars.length > 0) out.set(`${procedure}:${e.criterion_id}`, { key: `${procedure}:${e.criterion_id}`, reevaluate_at: e.reevaluate_at, missing_vars: missingVars });
        }
      }
    }
  }
  return [...out.values()].sort(byKey);
}

/**
 * Fail-closed enforce guard. The unit/scenario test environment (NODE_ENV=test) bypasses it so the enforce semantics stay
 * testable, unless CO_NEWBIZ_KILL_ENFORCE_GUARD_TEST=on (the guard's own test). Never bypassed in dev or production.
 */
export function killEnforceGuard(env: Record<string, string | undefined> = process.env): { unsafe: boolean; offenders: GuardOffender[] } {
  if (env.NODE_ENV === "test" && env.CO_NEWBIZ_KILL_ENFORCE_GUARD_TEST !== "on") return { unsafe: false, offenders: [] };
  const offenders = carriedWithoutDataSource();
  return { unsafe: offenders.length > 0, offenders };
}

/** Startup check (instrumentation.ts): throws while kill_binding=enforce is configured and the guard is unsafe. */
export function assertKillEnforceSafe(env: Record<string, string | undefined> = process.env): void {
  if (gateIntegrityMode("kill_binding", env) !== "enforce") return;
  const g = killEnforceGuard(env);
  if (g.unsafe) {
    throw new Error(`kill_enforce_unsafe: CO_NEWBIZ_GATE_INTEGRITY_KILL_BINDING=enforce is refused - carried kill criteria without a data source at their re-evaluation scope: ${g.offenders.map((o) => `${o.key} (${o.missing_vars.join(", ")} @ ${o.reevaluate_at})`).join("; ")}. Re-scope their reevaluate_at (ADR-tracked) or add an opportunity-scope source, or set the flag to shadow/off.`);
  }
}

const GATE_IDX = ["screening", "pre_fs", "target_screening", "fs", "dd", "entity_ic", "group_ic"];
function gateIdx(g: string): number {
  return GATE_IDX.indexOf(g);
}

// ── Builder ─────────────────────────────────────────────────────────────────

function overrideFor(overrides: KillOverrideRow[], procedure: string, criterionId: string): KillOverrideRow | null {
  return overrides.find((o) => o.procedure_key === procedure && o.criterion_id === criterionId) ?? null;
}

export function resolveBrief(db: Database, o: Pick<BuildOptions, "entityType" | "entityId" | "gate" | "actor" | "briefId">, now: string): BriefRecord | null {
  if (o.briefId) {
    const rec = getBriefRecord(db, o.briefId);
    return rec && rec.entity_type === o.entityType && rec.entity_id === o.entityId && rec.gate === o.gate ? rec : null;
  }
  return latestBriefRecord(db, { entityType: o.entityType, entityId: o.entityId, gate: o.gate, userId: o.actor, now });
}

/**
 * Compute the snapshot. For a project this OPENS an evaluation run and writes its ledger rows: call it
 * inside the caller's transaction (decision / brief) or via previewGateSnapshot (rolled back).
 */
export function buildGateSnapshot(o: BuildOptions): BuiltSnapshot {
  const db = o.db ?? getDb();
  const now = o.now ?? new Date().toISOString();
  const isProject = o.entityType === "project";
  const track: LadderTrack | null = isProject
    ? (resolveTrack(o.entityId, db).track as LadderTrack | null)
    : ((latestRouteDecision(o.entityId)?.track ?? null) as LadderTrack | null);

  let procedures: string[];
  let evalRunId: string | null = null;
  const currentStage = resolveCurrentStage(o);
  const carry = loadCarryContext(db, o);
  const open = deriveOpenCarries(carry.sources, registryScopeOf);
  const due = open.filter((c) => carryDue(c.reevaluate_at, o.gate));
  const dueKeys = new Set(due.map((c) => c.key));
  const procOf = (key: string): string => key.slice(0, key.indexOf(":"));

  let evaluated: KillEvaluation;
  let extra: KillEvaluation = { outcomes: [], inert: [] };
  if (isProject) {
    procedures = projectKillProcedures(db, o.entityId, o.gate, track);
    evalRunId = createGateEvalRun(db, { projectId: o.entityId, gate: o.gate, event: o.event, actor: o.actor, now });
    evaluated = evaluateProjectKill(db, o, procedures, evalRunId, now);
    const extraProcs = [...new Set(due.map((c) => procOf(c.key)))].filter((p) => !procedures.includes(p) && !outOfTrack(p, track));
    if (extraProcs.length > 0) extra = evaluateProjectKill(db, o, extraProcs, evalRunId, now, new Set(due.map((c) => c.key)));
  } else {
    procedures = (OPPORTUNITY_PROCEDURES[o.gate] ?? (() => []))(track);
    evaluated = evaluateOpportunityKill(db, o.entityId, procedures);
    const extraProcs = [...new Set(due.map((c) => procOf(c.key)))].filter((p) => !procedures.includes(p) && !outOfTrack(p, track));
    if (extraProcs.length > 0) extra = evaluateOpportunityKill(db, o.entityId, extraProcs, new Set(due.map((c) => c.key)));
  }
  evaluated = { outcomes: evaluated.outcomes.filter((x) => inGateScope(o.gate, x.procedure, x.criterion_id)), inert: evaluated.inert.filter((x) => inGateScope(o.gate, procOf(x.key), x.key.slice(x.key.indexOf(":") + 1))) };

  const overrides = listActiveKillOverrides(db, o.entityType, o.entityId);
  const triggered: KillTriggered[] = [];
  const unassessed: KillItem[] = [];
  const notReached: KillNotReached[] = [];
  const carriedIn: KillCarriedIn[] = [];
  let evaluatedCount = 0;
  let falseCount = 0;
  const isIc = o.gate === "entity_ic" || o.gate === "group_ic";
  const routeDecisionId = (): string | null => {
    const opp = isProject ? carry.opportunityId : o.entityId;
    if (!opp) return null;
    const current = db.query("SELECT id FROM route_decision WHERE opportunity_id = ? AND is_current = 1").get(opp) as { id: string } | null;
    return current?.id ?? latestRouteDecision(opp)?.id ?? null;
  };
  const pushTriggered = (x: KillOutcome, partial: boolean) => {
    const ov = overrideFor(overrides, x.procedure, x.criterion_id);
    triggered.push({ key: x.key, procedure: x.procedure, criterion_id: x.criterion_id, title: x.title, action: x.action, binding: x.action === "halt", override_id: ov?.id ?? null, partial_input: partial });
  };
  const item = (x: KillOutcome): KillItem => ({ key: x.key, procedure: x.procedure, criterion_id: x.criterion_id, title: x.title, action: x.action });

  // Own procedure set: classify by stage (design 3.1). Keys that are due carries are handled below, once.
  for (const x of evaluated.outcomes) {
    if (dueKeys.has(x.key)) continue;
    const scope = registryScopeOf(x.key);
    const { cls, partial_input } = classifyKill({ outcome: x.outcome, procedure: x.procedure, evaluable_from: scope?.evaluable_from, current_stage: currentStage, track });
    if (cls === "out_of_track") continue;
    if (cls === "not_reached") {
      const reevaluateAt = scope?.reevaluate_at ?? "";
      notReached.push({ ...item(x), evaluable_from: scope?.evaluable_from ?? "", reevaluate_at: reevaluateAt });
      if (reevaluateAt !== OPEN_MONITORING && carryDue(reevaluateAt, o.gate)) {
        // Deferred past its own re-evaluation gate: cannot be classified as reached here (design 3.3).
        carriedIn.push({ key: x.key, title: x.title, from_decision_id: null, outcome: "overdue", closure: "open", reason: null, action: x.action, evaluable_from: scope?.evaluable_from ?? "", reevaluate_at: reevaluateAt, route_decision_id: null, implicit: false });
      }
      continue;
    }
    evaluatedCount += 1;
    if (cls === "triggered") pushTriggered(x, partial_input);
    else if (cls === "unassessed") unassessed.push(item(x));
    else falseCount += 1;
  }

  // Due carries (design 3.3): evaluated here even when this gate's own procedure set would not include them.
  const byKeyOutcome = new Map<string, KillOutcome>([...evaluated.outcomes, ...extra.outcomes].map((x) => [x.key, x]));
  for (const c of due) {
    const proc = procOf(c.key);
    const crit = c.key.slice(c.key.indexOf(":") + 1);
    const entry = (loadKillCriteriaRegistry(proc) as unknown as CoreRegistryEntry[]).find((e) => e.criterion_id === crit);
    const base = { key: c.key, title: entry ? titleOf(entry) : crit, reason: null, from_decision_id: c.from_decision_id, action: entry?.action ?? "", evaluable_from: c.evaluable_from, reevaluate_at: c.reevaluate_at, implicit: c.implicit };
    if (outOfTrack(proc, track)) {
      carriedIn.push({ ...base, outcome: "out_of_track", closure: "out_of_track", route_decision_id: routeDecisionId() });
      continue;
    }
    const x = byKeyOutcome.get(c.key);
    const reached = entry && stageIndex(entry.evaluable_from ?? "S1") <= stageIndex(currentStage);
    if (!entry || !x || !reached) {
      carriedIn.push({ ...base, outcome: "overdue", closure: "open", route_decision_id: null });
      continue;
    }
    evaluatedCount += 1;
    if (x.outcome === "triggered") {
      pushTriggered(x, false);
      carriedIn.push({ ...base, outcome: "triggered", closure: "evaluated", route_decision_id: null });
    } else if (x.outcome === "false") {
      falseCount += 1;
      carriedIn.push({ ...base, outcome: "false", closure: "evaluated", route_decision_id: null });
    } else {
      // Still unassessed at its re-evaluation gate: a halt hard-blocks (C-1, no ack path); other actions need the acknowledgement.
      if (x.action !== "halt") unassessed.push(item(x));
      carriedIn.push({ ...base, outcome: "unassessed", closure: "open", route_decision_id: null });
    }
  }
  // S12 criteria leave the IC gates as open_monitoring carries (C-6, Q5), evaluated by DATA PHASE (risk-officer A): before
  // close their evidence does not exist, so they are reported unassessed - "post-close data not yet available" - and kept
  // visible in the carry list, never silently skipped, never hidden. They need no acknowledgement and cannot hard-block (no
  // gate can obtain post-close data); IC never closes them. They close only by a recorded human decision on the S12
  // monitoring surface (pmi-agent evidence, risk-officer review).
  if (isIc) {
    for (const key of openMonitoringKeys(track)) {
      const scope = registryScopeOf(key);
      const entry = loadKillCriteriaRegistry(key.slice(0, key.indexOf(":"))).find((e) => e.criterion_id === key.slice(key.indexOf(":") + 1));
      carriedIn.push({ key, title: entry ? titleOf(entry) : key, from_decision_id: null, outcome: "unassessed", closure: "open_monitoring", reason: POST_CLOSE_REASON, action: registryActionOf(key), evaluable_from: scope?.evaluable_from ?? "S12", reevaluate_at: OPEN_MONITORING, route_decision_id: null, implicit: false });
    }
  }
  // Evidence caveats on criteria that were actually evaluated (a false result is not clean evidence either).
  const caveats: Array<{ key: string; caveat: string }> = [];
  for (const x of [...evaluated.outcomes, ...extra.outcomes]) {
    const caveat = KILL_EVIDENCE_CAVEATS[x.key];
    if (caveat && !caveats.some((c) => c.key === x.key)) caveats.push({ key: x.key, caveat });
  }
  // Criteria owned by a later gate are shown as pending with their scheduled gate (not absent).
  const scheduled: GateSnapshot["kill"]["scheduled"] = [];
  if (!isProject) {
    for (const procedure of SCHEDULED_ELSEWHERE[o.gate] ?? []) {
      for (const e of loadKillCriteriaRegistry(procedure) as unknown as Array<CoreRegistryEntry & RegistryScope>) {
        scheduled.push({ key: `${procedure}:${e.criterion_id}`, title: titleOf(e), action: e.action, evaluable_from: e.evaluable_from ?? "", reevaluate_at: e.reevaluate_at ?? "", status: "pending" });
      }
    }
  }
  const kill: GateSnapshot["kill"] = {
    procedures: [...procedures].sort(),
    evaluated: evaluatedCount,
    inert: evaluated.inert.length,
    inert_list: [...evaluated.inert].sort(byKey),
    false_count: falseCount,
    triggered: triggered.sort(byKey),
    unassessed: unassessed.sort(byKey),
    current_stage: currentStage,
    not_reached: notReached.sort(byKey),
    carried_in: carriedIn.sort(byKey),
    scheduled: scheduled.sort(byKey),
    caveats: caveats.sort(byKey),
    lineage_missing: carry.lineageMissing,
    eval_run_id: evalRunId,
  };

  const brief = resolveBrief(db, o, now);
  const validators =
    isProject && track === "brownfield" && VALIDATOR_GATES.has(o.gate)
      ? (() => {
          const v = evaluateValidatorCompleteness(o.entityId, null, db, { now: new Date(now) });
          return { declared: v.declared as number, applicable: v.applicable_count, completed: v.completed_count, missing: [...v.halt.missing].sort() as string[] };
        })()
      : null;

  const partial = {
    schema_version: GATE_SNAPSHOT_SCHEMA_VERSION,
    gate: o.gate,
    entity: { type: o.entityType, id: o.entityId },
    track,
    computed_at: now,
    engine_versions: { ...SNAPSHOT_ENGINE_VERSIONS } as Record<string, string>,
    kill,
    rag: isProject ? ragSection(db, o.entityId) : null,
    validators,
    nonwaivable_open: isProject && NONWAIVABLE_GATES.has(o.gate) ? nonWaivableOpen(db, o.entityId) : [],
    wacc: isProject ? waccSection(db, o.entityId, track) : null,
    waivers: isProject ? waiversSection(db, o.entityId, now) : { active: [], expiring_14d: [] },
    conditions_open: (isProject ? listConditions(o.entityId, { status: "open", db }) : [])
      .map((c) => ({ id: c.id, text: c.text, clear_by: c.clear_by }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    ladder: ladderSection(db, o, track),
    ai: aiSection(brief),
  };
  const certificationKeys =
    !isProject && o.gate === "pre_fs" && track === "brownfield"
      ? (certificationFailure(db, o.entityId)?.details?.certifications as Array<{ id: string }> | undefined)?.map((c) => c.id) ?? []
      : [];
  const enforceUnsafeKeys = gateIntegrityMode("kill_binding") === "enforce" ? killEnforceGuard().offenders.map((x) => x.key) : [];
  const snapshot: GateSnapshot = { ...partial, required_acks: requiredAcks(partial), hard_blocks: hardBlocks(partial, { certificationKeys, enforceUnsafeKeys }) };
  return { snapshot, hash: snapshotHash(snapshot), evalRunId, brief };
}

// ── Read path with cache (GET) ──────────────────────────────────────────────

class Rollback extends Error {}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { version: string; at: number; built: BuiltSnapshot }>();

/** Cheap "did any decision-relevant input change" tuple (design 3.15): counts and max timestamps of the source tables. */
export function snapshotInputVersion(db: Database, entityType: SnapshotEntity, entityId: string, gate: string): string {
  const one = (sql: string, ...args: string[]): string => {
    const r = db.query(sql).get(...args) as Record<string, unknown> | null;
    return r ? Object.values(r).map((v) => String(v ?? "")).join(".") : "";
  };
  const parts = [
    one("SELECT COUNT(*) c, COALESCE(MAX(rowid),0) m FROM gate_decision WHERE entity_type = ? AND entity_id = ?", entityType, entityId),
    one("SELECT COUNT(*) c FROM gate_decision_stale s JOIN gate_decision g ON g.id = s.decision_id WHERE g.entity_type = ? AND g.entity_id = ?", entityType, entityId),
    one("SELECT COUNT(*) c, COALESCE(MAX(rowid),0) m FROM gate_brief_record WHERE entity_type = ? AND entity_id = ? AND gate = ?", entityType, entityId, gate),
    one("SELECT COUNT(*) c, COALESCE(MAX(rowid),0) m FROM kill_criteria_override WHERE entity_type = ? AND entity_id = ?", entityType, entityId),
  ];
  if (entityType === "project") {
    parts.push(
      one("SELECT COUNT(*) c, COALESCE(MAX(cleared_at),'') m, COALESCE(MAX(rowid),0) r FROM condition_precedent WHERE project_id = ?", entityId),
      one("SELECT COUNT(*) c, COALESCE(MAX(updated_at),'') m FROM approval_chain WHERE project_id = ?", entityId),
    );
    parts.push(
      one("SELECT COUNT(*) c, COALESCE(MAX(assessed_at),'') m FROM rag_assessment WHERE project_id = ?", entityId),
      one("SELECT COUNT(*) c, COALESCE(MAX(a.as_of),'') m FROM assumption a JOIN run r ON r.id = a.run_id WHERE r.project_id = ?", entityId),
      one("SELECT COUNT(*) c, COALESCE(MAX(rowid),0) m, COALESCE(MAX(approved_at),'') a FROM waiver WHERE project_id = ?", entityId),
      one("SELECT COUNT(*) c, COALESCE(MAX(assessed_at),'') m, COALESCE(MAX(na_confirmed_at),'') n FROM project_checklist_item_state WHERE project_id = ?", entityId),
      one("SELECT COUNT(*) c, COALESCE(MAX(rowid),0) m FROM compliance_check WHERE project_id = ?", entityId),
      one("SELECT COUNT(*) c, COALESCE(MAX(rowid),0) m FROM dd_finding WHERE project_id = ?", entityId),
      one("SELECT COALESCE(wacc_subject,'') s FROM md_project WHERE id = ?", entityId),
      one("SELECT COUNT(*) c, COALESCE(MAX(rowid),0) m FROM process_run WHERE entity_type = 'project' AND entity_id = ? AND stage = 's8_target_select'", entityId),
    );
  } else {
    parts.push(
      one("SELECT COUNT(*) c, COALESCE(MAX(c.confirmed_at),'') m, COALESCE(SUM(c.load_bearing),0) l FROM certification c JOIN md_project p ON p.id = c.project_id WHERE p.source_opportunity_id = ?", entityId),
      one("SELECT COUNT(*) c, COALESCE(MAX(updated_at),'') m FROM brownfield_target WHERE opportunity_id = ?", entityId),
      one("SELECT COUNT(*) c, COALESCE(MAX(rowid),0) m FROM route_decision WHERE opportunity_id = ?", entityId),
    );
  }
  return parts.join("|");
}

/**
 * GET path: the same builder, run in a transaction that is rolled back (no run, ledger, audit or access-log
 * residue), served from a per-(entity, gate, user, brief, input-version) cache. The decision write never
 * reads this cache - it recomputes authoritatively.
 */
export function previewGateSnapshot(o: Omit<BuildOptions, "event">, opts: { fresh?: boolean } = {}): BuiltSnapshot & { cached: boolean } {
  const db = o.db ?? getDb();
  const version = snapshotInputVersion(db, o.entityType, o.entityId, o.gate);
  const key = `${o.entityType}:${o.entityId}:${o.gate}:${o.actor}:${o.briefId ?? ""}`;
  const hit = cache.get(key);
  if (!opts.fresh && hit && hit.version === version && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.built, cached: true };
  let built: BuiltSnapshot | null = null;
  try {
    db.transaction(() => {
      built = buildGateSnapshot({ ...o, event: "snapshot" });
      throw new Rollback();
    })();
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  if (!built) throw new Error("gate_snapshot: builder produced no snapshot");
  const out: BuiltSnapshot = built;
  // The rolled-back run id never existed; do not hand it out.
  out.snapshot.kill.eval_run_id = null;
  out.evalRunId = null;
  cache.set(key, { version, at: Date.now(), built: out });
  return { ...out, cached: false };
}

/** Put a freshly computed snapshot (e.g. the one returned with a 409 snapshot_stale) into the GET cache. */
export function primeSnapshotCache(o: Omit<BuildOptions, "event">, built: BuiltSnapshot): void {
  const db = o.db ?? getDb();
  const copy: BuiltSnapshot = { ...built, snapshot: { ...built.snapshot, kill: { ...built.snapshot.kill, eval_run_id: null } }, evalRunId: null };
  cache.set(`${o.entityType}:${o.entityId}:${o.gate}:${o.actor}:${o.briefId ?? ""}`, { version: snapshotInputVersion(db, o.entityType, o.entityId, o.gate), at: Date.now(), built: copy });
}

/** Test seam. */
export function clearSnapshotCache(): void {
  cache.clear();
}
