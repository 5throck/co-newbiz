// @version 1.0.0
/**
 * Machine gate consumers for three pre-project checklists (ADR-0187 phase P3,
 * finding H9; design 2026-10-27-process-ssot-decision-evidence-design 4.3):
 *
 *   chk-legal-regulatory         Screening gate  -> S4 blocker s4.legal_regulatory_screening
 *   chk-greenfield-feasibility   Pre-FS gate     -> S5 blocker s5.greenfield_feasibility_checklist
 *   chk-site-selection           Pre-FS gate     -> S5 blocker s5.site_selection_checklist
 *
 * The checklists are produced by named procedure steps (regulatory-screening,
 * greenfield-screening / greenfield-pre-fs); this module is the machine side that
 * reads what a person recorded and turns it into compliance-engine requirements
 * (db/lib/compliance.ts GateRequirement). Semantics are the engine's (ADR-0037):
 *   - a mandatory item that is not satisfied blocks the gate;
 *   - a recommended item never blocks (its result is `reason_required`);
 *   - satisfied = recorded `pass`, or `not_applicable` with a written reason.
 * A recorded `fail` leaves a mandatory item unsatisfied. checkGate() itself
 * persists compliance_check rows keyed to a project, and the Screening / Pre-FS
 * gates run on the opportunity carrier, so the evaluation here is the same rule
 * applied in memory (`evaluateRequirements`); the formal waiver path
 * (waiver rows) exists from the project carrier on and is not reachable pre-project.
 *
 * Storage: an append-only process_run ledger on the opportunity (entity_type
 * 'opportunity', stage s4_/s5_ names below, meta_json = the per-item results) -
 * no schema change. The latest `done` row per checklist is the record of record.
 *
 * Rollout (the ADR-0186 pattern): CO_NEWBIZ_CHECKLIST_CONSUMERS = off | shadow |
 * enforce. Default: production -> shadow, anything else -> off. off: the engine
 * ignores these checklists. shadow: an unmet gate requirement is shown as an
 * advisory line only (never `missing`). enforce: it blocks the stage. Opportunities
 * created before ADR_0187_P3_PREDICATE_DATE are exempt (ADR-0151 precedent).
 */
import type { Database } from "bun:sqlite";
import { ulid } from "../../../db/lib/ulid.ts";
import type { GateRequirement } from "../../../db/lib/compliance.ts";
import { AGENT_KEYS } from "./agent-registry.generated.ts";
import { getChecklistItems, type ChecklistItemDef } from "./library.ts";
import { blocker, type BlockerKey } from "./process-blocker-keys.ts";
import { SPEC_VERSION } from "./spec-activities.generated.ts";

export const CHECKLIST_CONSUMER_ENV = "CO_NEWBIZ_CHECKLIST_CONSUMERS";
export type ChecklistConsumerMode = "off" | "shadow" | "enforce";

export function checklistConsumerMode(env: Record<string, string | undefined> = process.env): ChecklistConsumerMode {
  const raw = env[CHECKLIST_CONSUMER_ENV]?.trim().toLowerCase();
  if (raw === "off" || raw === "shadow" || raw === "enforce") return raw;
  return env.NODE_ENV === "production" ? "shadow" : "off";
}

/** Opportunities created before this date keep the legacy S4 / S5 predicates (ADR-0151 precedent). */
export const CHECKLIST_CONSUMER_PREDICATE_DATE = "2026-10-28";

export interface GateChecklist {
  docId: string;
  gate: "screening" | "pre_fs";
  stage: "S4" | "S5";
  blockerKey: BlockerKey;
  /** process_run stage of the ledger row. */
  ledgerStage: string;
  /** Tracks the consumer applies to. */
  tracks: ReadonlyArray<"greenfield" | "brownfield">;
}

export const GATE_CHECKLISTS: readonly GateChecklist[] = [
  { docId: "chk-legal-regulatory", gate: "screening", stage: "S4", blockerKey: "s4.legal_regulatory_screening", ledgerStage: "s4_legal_regulatory_screen", tracks: ["greenfield", "brownfield"] },
  { docId: "chk-greenfield-feasibility", gate: "pre_fs", stage: "S5", blockerKey: "s5.greenfield_feasibility_checklist", ledgerStage: "s5_greenfield_feasibility_screen", tracks: ["greenfield"] },
  { docId: "chk-site-selection", gate: "pre_fs", stage: "S5", blockerKey: "s5.site_selection_checklist", ledgerStage: "s5_site_selection_screen", tracks: ["greenfield"] },
];

export function gateChecklist(docId: string): GateChecklist | undefined {
  return GATE_CHECKLISTS.find((c) => c.docId === docId);
}

export type ItemResult = "pass" | "fail" | "not_applicable";
export const ITEM_RESULTS: readonly ItemResult[] = ["pass", "fail", "not_applicable"];
export const MIN_NA_NOTE_LENGTH = 10;

export interface ItemRecord { result: ItemResult; note: string }
export interface ChecklistRecord {
  id: string;
  docId: string;
  recordedBy: string;
  recordedAt: string;
  items: Record<string, ItemRecord>;
}

export class ChecklistRecordError extends Error {
  constructor(public readonly code: "invalid_input" | "agent_forbidden" | "unknown_checklist", message: string) {
    super(message);
  }
}

/**
 * Checklist item definitions from the library projection (the checklist YAML is the source).
 * The projection keys a checklist by `chk-<file stem>` (e.g. chk-legal-regulatory-checklist);
 * the governance doc id this module speaks (chk-legal-regulatory) is that key without the suffix.
 */
export function checklistItems(docId: string): ChecklistItemDef[] {
  return getChecklistItems(`${docId}-checklist`) ?? getChecklistItems(docId) ?? [];
}

export function latestChecklistRecord(db: Database, opportunityId: string, docId: string): ChecklistRecord | null {
  const def = gateChecklist(docId);
  if (!def) return null;
  const row = db
    .query(
      `SELECT id, started_by, finished_at, meta_json FROM process_run
       WHERE entity_type = 'opportunity' AND entity_id = ? AND stage = ? AND status = 'done'
       ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .get(opportunityId, def.ledgerStage) as { id: string; started_by: string; finished_at: string | null; meta_json: string | null } | undefined;
  if (!row?.meta_json) return null;
  try {
    const meta = JSON.parse(row.meta_json) as { items?: Record<string, ItemRecord> };
    return { id: row.id, docId, recordedBy: row.started_by, recordedAt: row.finished_at ?? "", items: meta.items ?? {} };
  } catch {
    return null;
  }
}

/**
 * Append a checklist screening record. The submitted items are the complete
 * state of the record (a new POST supersedes the previous one; history stays in
 * process_run). Only a person records it: an agent persona id is refused.
 */
export function recordChecklistScreening(
  db: Database,
  input: { opportunityId: string; docId: string; items: Array<{ id: string; result: string; note?: string }>; recordedBy: string; now?: string },
): ChecklistRecord {
  const def = gateChecklist(input.docId);
  if (!def) throw new ChecklistRecordError("unknown_checklist", `checklist must be one of ${GATE_CHECKLISTS.map((c) => c.docId).join(", ")}.`);
  if (AGENT_KEYS.has(input.recordedBy)) throw new ChecklistRecordError("agent_forbidden", "Only a person (the session user) can record a checklist screening.");
  const known = new Map(checklistItems(input.docId).map((i) => [i.id, i]));
  if (!Array.isArray(input.items) || input.items.length === 0) throw new ChecklistRecordError("invalid_input", "items must be a non-empty array of { id, result, note? }.");
  const items: Record<string, ItemRecord> = {};
  for (const it of input.items) {
    if (!known.has(it.id)) throw new ChecklistRecordError("invalid_input", `item '${it.id}' is not an item of ${input.docId}.`);
    if (!(ITEM_RESULTS as readonly string[]).includes(it.result)) throw new ChecklistRecordError("invalid_input", `item '${it.id}': result must be one of ${ITEM_RESULTS.join("|")}.`);
    const note = (it.note ?? "").trim();
    if (it.result === "not_applicable" && note.length < MIN_NA_NOTE_LENGTH)
      throw new ChecklistRecordError("invalid_input", `item '${it.id}': not_applicable needs a written reason (at least ${MIN_NA_NOTE_LENGTH} characters).`);
    if (items[it.id]) throw new ChecklistRecordError("invalid_input", `item '${it.id}' appears more than once.`);
    items[it.id] = { result: it.result as ItemResult, note };
  }
  const now = input.now ?? new Date().toISOString();
  const id = ulid();
  db.run(
    `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, "opportunity", input.opportunityId, null, SPEC_VERSION, def.ledgerStage, "done", "web", input.recordedBy, now, now, JSON.stringify({ checklist: input.docId, items })],
  );
  return { id, docId: input.docId, recordedBy: input.recordedBy, recordedAt: now, items };
}

/** The checklist as compliance-engine requirements (rule key = `<docId>:<itemId>`). */
export function gateRequirements(docId: string, record: ChecklistRecord | null): GateRequirement[] {
  return checklistItems(docId).map((item) => {
    const r = record?.items[item.id];
    const satisfied = !!r && (r.result === "pass" || (r.result === "not_applicable" && r.note.length >= MIN_NA_NOTE_LENGTH));
    return {
      ruleKey: `${docId}:${item.id}`,
      layer: "checklist" as const,
      mandatory: item.mandatory,
      waiverEligible: item.waiver_eligible,
      satisfied,
      governanceDocId: docId,
      clauseRef: item.id,
    };
  });
}

export interface RequirementOutcome { ruleKey: string; result: "pass" | "blocked" | "reason_required" }

/** db/lib/compliance.ts checkGate() semantics without persistence or waivers (pre-project carrier). */
export function evaluateRequirements(requirements: GateRequirement[]): { pass: boolean; rows: RequirementOutcome[] } {
  const rows = requirements.map((r): RequirementOutcome => ({
    ruleKey: r.ruleKey,
    result: r.satisfied ? "pass" : r.mandatory ? "blocked" : "reason_required",
  }));
  return { pass: rows.every((r) => r.result !== "blocked"), rows };
}

export interface ChecklistGateState {
  docId: string;
  gate: GateChecklist["gate"];
  recorded: boolean;
  pass: boolean;
  blockedItems: string[];
  reasonRequiredItems: string[];
}

export function checklistGateState(db: Database, opportunityId: string, docId: string): ChecklistGateState {
  const def = gateChecklist(docId) as GateChecklist;
  const record = latestChecklistRecord(db, opportunityId, docId);
  const ev = evaluateRequirements(gateRequirements(docId, record));
  return {
    docId,
    gate: def.gate,
    recorded: record !== null,
    pass: ev.pass,
    blockedItems: ev.rows.filter((r) => r.result === "blocked").map((r) => r.ruleKey.split(":")[1]!),
    reasonRequiredItems: ev.rows.filter((r) => r.result === "reason_required").map((r) => r.ruleKey.split(":")[1]!),
  };
}

export interface ChecklistBlockers { blockers: string[]; missing: string[] }

/**
 * Stage contribution of the gate checklists of one stage for one opportunity.
 * `track` is the current route track (null before S4: S5 does not evaluate then).
 */
export function checklistStageBlockers(
  db: Database,
  opp: { id: string; created_at: string | null },
  stage: GateChecklist["stage"],
  track: "greenfield" | "brownfield" | null,
  mode: ChecklistConsumerMode = checklistConsumerMode(),
): ChecklistBlockers {
  const out: ChecklistBlockers = { blockers: [], missing: [] };
  if (mode === "off" || (opp.created_at ?? "") < CHECKLIST_CONSUMER_PREDICATE_DATE) return out;
  for (const def of GATE_CHECKLISTS.filter((c) => c.stage === stage)) {
    if (stage === "S5" ? track !== "greenfield" : track !== null && !def.tracks.includes(track)) continue;
    const state = checklistGateState(db, opp.id, def.docId);
    if (state.pass) continue;
    const why = state.recorded
      ? `필수 항목 미충족 ${state.blockedItems.length}건 (${state.blockedItems.slice(0, 5).join(", ")}${state.blockedItems.length > 5 ? " 외" : ""})`
      : "판정 기록이 없습니다";
    const text = `${def.docId} 체크리스트 판정이 필요합니다 (${def.gate} 게이트) — ${why}`;
    if (mode === "enforce") {
      out.blockers.push(text);
      out.missing.push(blocker(def.blockerKey));
    } else {
      out.blockers.push(`[권고·shadow] ${text}`);
    }
  }
  return out;
}
