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
import {
  GATE_SNAPSHOT_SCHEMA_VERSION, createGateEvalRun, getBriefRecord, latestBriefRecord, listActiveKillOverrides,
  type BriefRecord, type EvalEvent, type KillOverrideRow,
} from "../../../db/repositories/gate-snapshot.repository.ts";
import { buildLookup, validateRegistryEntry, type RegistryEntry as CoreRegistryEntry, type SnapshotVarRow } from "../../../packages/core-scoring/src/kill-criteria.ts";
import { evaluatePredicate, parsePredicate } from "../../../packages/core-scoring/src/predicate.ts";
import { snapshotHash } from "./gate-canonical.ts";
import { ladderBlock } from "./gate-ladder.ts";
import { ladderFor, type LadderTrack } from "./gate-sequence-view.ts";
import { applicableKillProcedures, loadKillCriteriaRegistry } from "./ic-review-steps.ts";
import { latestRouteDecision } from "./process-flow.ts";
import { resolveTrack } from "./project-track.ts";
import { scopedChecklistItems } from "./greenfield-subtrack.ts";
import { subTrackChecklistIds } from "./dd-checklist-tailor.ts";

export type SnapshotEntity = "opportunity" | "project";
export const SNAPSHOT_ENGINE_VERSIONS = { snapshot_builder: "1", kill_registry: "adr-0057", validators: "adr-0185-core6", rag: "latest-stored" } as const;
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
  wacc: { subject: string | null; status: "sourced" | "assumed" | "absent"; bf13: "set" | "unset" | "n/a" } | null;
  waivers: { active: Array<{ id: string; clause_ref: string; approved_by: string | null; expires_at: string }>; expiring_14d: string[] };
  /** P3 placeholder: condition precedents (migration 0175) are not built yet. */
  conditions_open: Array<{ id: string; text: string; clear_by: string }>;
  ladder: { prior_gate: string | null; prior_carrier: SnapshotEntity | null; prior_decision_id: string | null; prior_decision: string | null; effective: boolean; blocker: string | null };
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

const OPPORTUNITY_PROCEDURES: Record<string, (track: LadderTrack | null) => string[]> = {
  screening: (t) => (t ? [`${t}-screening`] : ["greenfield-screening", "brownfield-screening"]),
  pre_fs: (t) => (t ? [`${t}-pre-fs`] : ["greenfield-pre-fs", "brownfield-pre-fs"]),
  target_screening: () => ["brownfield-target-screening", "brownfield-target-identification"],
};

/**
 * Project procedures per gate. `applicableKillProcedures` is the project-level universe (entity IC,
 * track fs/dd, establishment); a gate evaluates the procedures of ITS stage - a brownfield fs GO is not
 * judged on the DD-exit validator criterion - and the IC gates see the whole universe.
 */
export function projectKillProcedures(db: Database, projectId: string, gate: string, track: LadderTrack | null): string[] {
  const all = applicableKillProcedures(db, projectId);
  if (gate === "entity_ic" || gate === "group_ic") return all;
  if (gate === "fs") {
    const fs = all.filter((p) => p === "brownfield-fs" || p === "brownfield-fs-comparative");
    return track === "greenfield" ? ["greenfield-fs"] : fs;
  }
  return all.filter((p) => p.endsWith("-dd"));
}

/** Opportunity-scoped variable source (design 3.12): only variables that exist at opportunity scope. */
function opportunityVarRows(db: Database, opportunityId: string): SnapshotVarRow[] {
  const total = (db.query("SELECT COUNT(*) AS n FROM brownfield_target WHERE opportunity_id = ?").get(opportunityId) as { n: number }).n;
  if (total === 0) return [];
  const shortlisted = (db.query("SELECT COUNT(*) AS n FROM brownfield_target WHERE opportunity_id = ? AND status = 'shortlisted'").get(opportunityId) as { n: number }).n;
  return [{ var_key: "screening.viable_targets", value_num: shortlisted, value_text: null, status: "present" }];
}

interface KillOutcome { key: string; procedure: string; criterion_id: string; title: string; action: string; outcome: "triggered" | "false" | "unassessed" }

function titleOf(entry: { criterion_id: string; title?: string }): string {
  return entry.title ?? entry.criterion_id;
}

function evaluateOpportunityKill(db: Database, opportunityId: string, procedures: string[]): { outcomes: KillOutcome[]; inert: Array<{ key: string; title: string }> } {
  const lookup = buildLookup(opportunityVarRows(db, opportunityId));
  const outcomes: KillOutcome[] = [];
  const inert: Array<{ key: string; title: string }> = [];
  for (const procedure of procedures) {
    for (const entry of loadKillCriteriaRegistry(procedure) as unknown as CoreRegistryEntry[]) {
      const key = `${procedure}:${entry.criterion_id}`;
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

function evaluateProjectKill(db: Database, o: BuildOptions, procedures: string[], runId: string, now: string): { outcomes: KillOutcome[]; inert: Array<{ key: string; title: string }> } {
  const outcomes: KillOutcome[] = [];
  const inert: Array<{ key: string; title: string }> = [];
  for (const procedure of procedures) {
    const { result } = recordKillCriteriaEvaluation(
      { runId, projectId: o.entityId, procedure, evaluatedBy: o.actor, evaluatedByLabel: `gate-${o.event === "snapshot" ? "decision" : o.event}:${o.actor}`, now },
      db,
    );
    const titles = new Map(loadKillCriteriaRegistry(procedure).map((e) => [e.criterion_id, titleOf(e)]));
    for (const out of result.outcomes) {
      outcomes.push({
        key: `${procedure}:${out.criterion_id}`, procedure, criterion_id: out.criterion_id, title: out.title ?? titles.get(out.criterion_id) ?? out.criterion_id,
        action: out.action, outcome: out.outcome === "true" ? "triggered" : out.outcome,
      });
    }
    for (const e of loadKillCriteriaRegistry(procedure)) {
      if (e.enabled === false || (e as { predicate?: unknown }).predicate === null || (e as { predicate?: unknown }).predicate === undefined) {
        inert.push({ key: `${procedure}:${e.criterion_id}`, title: titleOf(e) });
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
  const proj = db.query("SELECT wacc_subject FROM md_project WHERE id = ?").get(projectId) as { wacc_subject: string | null } | null;
  const rows = db
    .query(
      `SELECT assumption_key, kind FROM (
         SELECT a.assumption_key, a.kind, ROW_NUMBER() OVER (PARTITION BY a.assumption_key ORDER BY a.as_of DESC, a.id DESC) rn
         FROM assumption a JOIN run r ON r.id = a.run_id WHERE r.project_id = ? AND a.assumption_key IN ('wacc','hurdle_irr')
       ) WHERE rn = 1`,
    )
    .all(projectId) as Array<{ assumption_key: string; kind: string }>;
  const status: "sourced" | "assumed" | "absent" = rows.length === 0 ? "absent" : rows.some((r) => r.kind === "assumed") ? "assumed" : rows.length < 2 || rows.some((r) => r.kind !== "user") ? "assumed" : "sourced";
  return { subject: proj?.wacc_subject ?? null, status, bf13: track === "brownfield" ? (proj?.wacc_subject ? "set" : "unset") : "n/a" };
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
  return { prior_gate: prior, prior_carrier: priorCarrier, prior_decision_id: ref?.id ?? null, prior_decision: ref?.decision ?? null, effective: block === null, blocker: block?.blocker ?? null };
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

function hardBlocks(kill: GateSnapshot["kill"]): HardBlockInfo[] {
  const unoverridden = kill.triggered.filter((t) => t.binding && t.override_id === null).map((t) => t.key).sort();
  return unoverridden.length > 0 ? [{ code: "kill_binding_unoverridden", keys: unoverridden }] : [];
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
  let evaluated: { outcomes: KillOutcome[]; inert: Array<{ key: string; title: string }> };
  if (isProject) {
    procedures = projectKillProcedures(db, o.entityId, o.gate, track);
    evalRunId = createGateEvalRun(db, { projectId: o.entityId, gate: o.gate, event: o.event, actor: o.actor, now });
    evaluated = evaluateProjectKill(db, o, procedures, evalRunId, now);
  } else {
    procedures = (OPPORTUNITY_PROCEDURES[o.gate] ?? (() => []))(track);
    evaluated = evaluateOpportunityKill(db, o.entityId, procedures);
  }

  const overrides = listActiveKillOverrides(db, o.entityType, o.entityId);
  const triggered: KillTriggered[] = evaluated.outcomes
    .filter((x) => x.outcome === "triggered")
    .map((x) => {
      const ov = overrideFor(overrides, x.procedure, x.criterion_id);
      return { key: x.key, procedure: x.procedure, criterion_id: x.criterion_id, title: x.title, action: x.action, binding: x.action === "halt", override_id: ov?.id ?? null };
    })
    .sort(byKey);
  const unassessed: KillItem[] = evaluated.outcomes
    .filter((x) => x.outcome === "unassessed")
    .map((x) => ({ key: x.key, procedure: x.procedure, criterion_id: x.criterion_id, title: x.title, action: x.action }))
    .sort(byKey);
  const kill: GateSnapshot["kill"] = {
    procedures: [...procedures].sort(),
    evaluated: evaluated.outcomes.length,
    inert: evaluated.inert.length,
    inert_list: [...evaluated.inert].sort(byKey),
    false_count: evaluated.outcomes.filter((x) => x.outcome === "false").length,
    triggered,
    unassessed,
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
    conditions_open: [] as GateSnapshot["conditions_open"],
    ladder: ladderSection(db, o, track),
    ai: aiSection(brief),
  };
  const snapshot: GateSnapshot = { ...partial, required_acks: requiredAcks(partial), hard_blocks: hardBlocks(kill) };
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
      one("SELECT COUNT(*) c, COALESCE(MAX(assessed_at),'') m FROM rag_assessment WHERE project_id = ?", entityId),
      one("SELECT COUNT(*) c, COALESCE(MAX(a.as_of),'') m FROM assumption a JOIN run r ON r.id = a.run_id WHERE r.project_id = ?", entityId),
      one("SELECT COUNT(*) c, COALESCE(MAX(rowid),0) m, COALESCE(MAX(approved_at),'') a FROM waiver WHERE project_id = ?", entityId),
      one("SELECT COUNT(*) c, COALESCE(MAX(assessed_at),'') m, COALESCE(MAX(na_confirmed_at),'') n FROM project_checklist_item_state WHERE project_id = ?", entityId),
      one("SELECT COUNT(*) c, COALESCE(MAX(rowid),0) m FROM compliance_check WHERE project_id = ?", entityId),
      one("SELECT COUNT(*) c, COALESCE(MAX(rowid),0) m FROM dd_finding WHERE project_id = ?", entityId),
      one("SELECT COALESCE(wacc_subject,'') s FROM md_project WHERE id = ?", entityId),
    );
  } else {
    parts.push(
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
