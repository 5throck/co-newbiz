// One-time, NON-BLOCKING listing of legacy kill acknowledgements - ADR-0193 R-4 (risk-officer).
//
// Before ADR-0193 a Screening GO acknowledged `kill_unassessed` criteria that nobody could have measured yet
// (their inputs arrive at S5-S7). Those acknowledgements are recorded facts and stay valid records of what was
// asked; they were never evaluations. This read-only report lists them once per in-flight entity so the owners
// see what they signed and which later gate now re-asks the criterion (the implicit carry, design 4.4). It
// writes nothing and blocks no gate.
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { stageIndex } from "../../../packages/core-scoring/src/kill-criteria.ts";
import { loadKillCriteriaRegistry } from "./ic-review-steps.ts";
import { GATE_LAST_STAGE, deferredToLaterGate } from "./gate-kill-scope.ts";

export interface LegacyKillAckRow {
  decision_id: string;
  entity_type: "opportunity" | "project";
  entity_id: string;
  entity_name: string | null;
  gate: string;
  decided_by: string;
  decided_at: string;
  /** `<procedure>:<criterion>` acknowledged as kill_unassessed. */
  key: string;
  reason: string;
  /** Registry stage declarations of the criterion today (design section 8). */
  evaluable_from: string | null;
  reevaluate_at: string | null;
  /** True when the criterion was not yet evaluable at the decision's gate: it is an implicit carry the later gate now evaluates. */
  implicit_carry: boolean;
}

/** Legacy (schema v1) acknowledged GOs at the Screening gate on in-flight entities (no KILL recorded). Read-only. */
export function listLegacyScreeningKillAcks(db: Database = getDb()): LegacyKillAckRow[] {
  const rows = db
    .query(
      `SELECT g.id AS decision_id, g.entity_type, g.entity_id, g.gate, g.decided_by, g.decided_at, s.acknowledgements_json
       FROM gate_decision g JOIN gate_decision_snapshot s ON s.decision_id = g.id
       WHERE s.schema_version = 1 AND g.decision = 'go' AND g.gate = 'screening'
         AND NOT EXISTS (SELECT 1 FROM gate_decision_stale st WHERE st.decision_id = g.id)
         AND NOT EXISTS (SELECT 1 FROM gate_decision k WHERE k.entity_type = g.entity_type AND k.entity_id = g.entity_id AND k.decision = 'kill')
       ORDER BY g.decided_at, g.id`,
    )
    .all() as Array<{ decision_id: string; entity_type: "opportunity" | "project"; entity_id: string; gate: string; decided_by: string; decided_at: string; acknowledgements_json: string }>;
  const out: LegacyKillAckRow[] = [];
  for (const r of rows) {
    const name = r.entity_type === "opportunity"
      ? ((db.query("SELECT name FROM opportunity WHERE id = ?").get(r.entity_id) as { name: string } | null)?.name ?? null)
      : null;
    let acks: Array<{ key: string; kind: string; reason: string }> = [];
    try { acks = JSON.parse(r.acknowledgements_json) as typeof acks; } catch { acks = []; }
    for (const a of acks.filter((x) => x.kind === "kill_unassessed")) {
      const i = a.key.indexOf(":");
      const entry = loadKillCriteriaRegistry(a.key.slice(0, i)).find((e) => e.criterion_id === a.key.slice(i + 1)) as unknown as { evaluable_from?: string; reevaluate_at?: string } | undefined;
      const nominal = GATE_LAST_STAGE[r.gate];
      out.push({
        decision_id: r.decision_id, entity_type: r.entity_type, entity_id: r.entity_id, entity_name: name, gate: r.gate, decided_by: r.decided_by, decided_at: r.decided_at,
        key: a.key, reason: a.reason, evaluable_from: entry?.evaluable_from ?? null, reevaluate_at: entry?.reevaluate_at ?? null,
        implicit_carry: !!entry?.evaluable_from && !!nominal && (stageIndex(entry.evaluable_from) > stageIndex(nominal) || deferredToLaterGate(entry.reevaluate_at, r.gate)),
      });
    }
  }
  return out;
}
