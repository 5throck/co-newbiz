// Gate brief x gate integrity - ADR-0186 D3 (kill evaluation at brief time) and D9 (brief record).
//
// The brief shows the kill-criteria outcomes BEFORE the recorder decides, and it persists its
// recommendation (gate_brief_record) so a later human decision can be compared with it. The brief-time
// evaluation is its own `gate_integrity_eval` run (project gates; design 3.12), separate from the
// decision-time run, so the UNIQUE(run_id, procedure_key, criterion_id) key never collides.
// Nothing here decides: the AI recommendation is stored as a proposal; the human decision is untouched.
import type { Database } from "bun:sqlite";
import { insertBriefRecord } from "../../../db/repositories/gate-snapshot.repository.ts";
import { sha256Hex } from "./gate-canonical.ts";
import { gateIntegrityMode } from "./gate-integrity-flags.ts";
import { buildGateSnapshot, type GateSnapshot, type SnapshotEntity } from "./gate-snapshot.ts";
import type { GateBrief } from "./gate-brief.ts";

// English on purpose: i18n-lint keeps new Korean literals out of lib code. The manifest list is rendered by the UI,
// which maps this exact token to its catalog label; the LLM context block below is model-facing text.
export const KILL_MANIFEST_ENTRY = "Kill criteria evaluation (deterministic)";

export interface BriefKillEvaluation {
  kill: GateSnapshot["kill"];
  evalRunId: string | null;
}

/**
 * Evaluate the gate's kill criteria for the brief and persist the ledger (project gates). Null when no
 * snapshot-related family is on (legacy brief, byte-identical) or when the evaluation faulted (a brief is
 * decision support; its absence of a kill block must never stop it - the fault is logged).
 */
export function briefKillEvaluation(db: Database, input: { entityType: SnapshotEntity; entityId: string; gate: string; actor: string }): BriefKillEvaluation | null {
  if (gateIntegrityMode("snapshot_ack") === "off" && gateIntegrityMode("kill_binding") === "off") return null;
  try {
    const built = db.transaction(() => buildGateSnapshot({ ...input, event: "brief", briefId: null, db }))();
    return { kill: built.snapshot.kill, evalRunId: built.evalRunId };
  } catch (e) {
    console.error(`[gate-brief] kill-criteria evaluation failed for ${input.entityType}:${input.entityId}:${input.gate}:`, e);
    return null;
  }
}

/** The kill block as prompt context (model-facing). */
export function killContextBlock(kill: GateSnapshot["kill"]): string {
  const fmt = (xs: Array<{ title: string; action: string }>) => xs.map((x) => `${x.title} (${x.action})`).join(" / ") || "none";
  return [
    "\n[Kill criteria evaluation (deterministic)]",
    `evaluated ${kill.evaluated} - inert (not evaluated) ${kill.inert}`,
    `triggered: ${fmt(kill.triggered)}`,
    `unassessed (insufficient data - NOT a pass): ${fmt(kill.unassessed)}`,
  ].join("\n");
}

/** Persist the brief's recommendation. Best effort: a failure is logged and the brief is returned without a brief_id. */
export function persistBriefRecord(
  db: Database,
  input: { entityType: SnapshotEntity; entityId: string; gate: string; actor: string; brief: GateBrief; source: "llm" | "synthesis"; provider: string | null; evalRunId: string | null },
): string | null {
  try {
    return insertBriefRecord(db, {
      entity_type: input.entityType, entity_id: input.entityId, gate: input.gate, recommended: input.brief.recommendation, confidence: input.brief.confidence,
      source: input.source, rationale_draft_hash: input.brief.rationale_draft ? sha256Hex(input.brief.rationale_draft) : null, llm_call_ref: input.provider,
      eval_run_id: input.evalRunId, generated_by: input.actor, generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error(`[gate-brief] brief record failed for ${input.entityType}:${input.entityId}:${input.gate}:`, e);
    return null;
  }
}
