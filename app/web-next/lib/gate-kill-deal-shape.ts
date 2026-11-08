// One-time, NON-BLOCKING listings for the deal-shape-to-S7 re-scope - risk-officer ruling R-4 (2026-11-08).
//
// Criterion #9 (deal-shape-chain:no_viable_deal_shape) moved from the S4 screen read at pre_fs to the S7 deal-shape evaluation
// read at target_screening, brownfield only. Stored gate snapshots are hash-locked and are never rewritten, so two historical
// gaps cannot be repaired by the engine and are listed once for a human to review (same posture as gate-kill-legacy.ts):
//  1. `past_target_screening`: brownfield opportunities that already passed target_screening and whose only #9 record is an
//     acknowledged-unassessed entry at pre_fs. The criterion will never be re-evaluated for them (a historical gap, not a new drop).
//  2. `greenfield_zero_viable`: greenfield opportunities holding live deal-shape rows with zero viable shapes. They stay visible
//     as a trigger (classifyKill lets `triggered` win before `out_of_track`); the action is mark_conditional (RECYCLE), not halt.
// Read-only: nothing is written and no gate is blocked.
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { summarizeLiveDealShapes } from "../../../db/repositories/opportunity-deal-shape.repository.ts";

export const NO_VIABLE_DEAL_SHAPE_KEY = "deal-shape-chain:no_viable_deal_shape";

export interface PastTargetScreeningRow {
  opportunity_id: string;
  opportunity_name: string | null;
  track: "brownfield";
  /** The pre_fs decision whose acknowledgement is the only #9 record. */
  pre_fs_decision_id: string;
  pre_fs_decided_by: string;
  pre_fs_decided_at: string;
  acknowledgement_reason: string;
  /** The (latest) non-stale target_screening GO that passed without evaluating #9. */
  target_screening_decision_id: string;
  target_screening_decided_at: string;
  /** Live deal-shape rows recorded since (viable/recorded), null = none recorded. */
  live_viable: number | null;
  live_recorded: number | null;
}

export interface GreenfieldZeroViableRow {
  opportunity_id: string;
  opportunity_name: string | null;
  track: "greenfield";
  live_recorded: number;
  latest_at: string;
}

export interface DealShapeRescopeListing {
  past_target_screening: PastTargetScreeningRow[];
  greenfield_zero_viable: GreenfieldZeroViableRow[];
}

interface DecisionRow {
  id: string;
  entity_id: string;
  gate: string;
  decision: string;
  decided_by: string;
  decided_at: string;
  acknowledgements_json: string | null;
  snapshot_json: string | null;
}

export function listDealShapeRescope(db: Database = getDb()): DealShapeRescopeListing {
  const nameOf = (id: string) =>
    (db.query("SELECT name FROM opportunity WHERE id = ?").get(id) as { name: string } | null)?.name ?? null;
  const trackOf = (id: string) =>
    (
      db.query("SELECT track FROM route_decision WHERE opportunity_id = ? AND is_current = 1").get(id) as {
        track: string;
      } | null
    )?.track ?? null;

  // 1. brownfield, past target_screening, only #9 record = a pre_fs acknowledgement.
  const decisions = db
    .query(
      `SELECT g.id, g.entity_id, g.gate, g.decision, g.decided_by, g.decided_at, s.acknowledgements_json, s.snapshot_json
       FROM gate_decision g LEFT JOIN gate_decision_snapshot s ON s.decision_id = g.id
       WHERE g.entity_type = 'opportunity' AND g.gate IN ('pre_fs', 'target_screening')
         AND NOT EXISTS (SELECT 1 FROM gate_decision_stale st WHERE st.decision_id = g.id)
       ORDER BY g.entity_id, g.decided_at, g.id`,
    )
    .all() as DecisionRow[];
  const byOpp = new Map<string, DecisionRow[]>();
  for (const d of decisions) byOpp.set(d.entity_id, [...(byOpp.get(d.entity_id) ?? []), d]);
  const past: PastTargetScreeningRow[] = [];
  for (const [oppId, rows] of byOpp) {
    const passed = rows.filter((r) => r.gate === "target_screening" && r.decision === "go");
    if (passed.length === 0 || trackOf(oppId) !== "brownfield") continue;
    const acked = rows.filter((r) => {
      if (r.gate !== "pre_fs" || !r.acknowledgements_json) return false;
      try {
        return (JSON.parse(r.acknowledgements_json) as Array<{ key: string; kind: string }>).some(
          (a) => a.kind === "kill_unassessed" && a.key === NO_VIABLE_DEAL_SHAPE_KEY,
        );
      } catch {
        return false;
      }
    });
    if (acked.length === 0) continue;
    // "Only record": no target_screening snapshot names #9 (carried, evaluated or unassessed there).
    if (rows.some((r) => r.gate === "target_screening" && (r.snapshot_json ?? "").includes(NO_VIABLE_DEAL_SHAPE_KEY)))
      continue;
    const ack = acked[acked.length - 1];
    const reason =
      (JSON.parse(ack.acknowledgements_json ?? "[]") as Array<{ key: string; reason?: string }>).find(
        (a) => a.key === NO_VIABLE_DEAL_SHAPE_KEY,
      )?.reason ?? "";
    const ts = passed[passed.length - 1];
    const live = summarizeLiveDealShapes(db, oppId);
    past.push({
      opportunity_id: oppId,
      opportunity_name: nameOf(oppId),
      track: "brownfield",
      pre_fs_decision_id: ack.id,
      pre_fs_decided_by: ack.decided_by,
      pre_fs_decided_at: ack.decided_at,
      acknowledgement_reason: reason,
      target_screening_decision_id: ts.id,
      target_screening_decided_at: ts.decided_at,
      live_viable: live ? live.viable : null,
      live_recorded: live ? live.recorded : null,
    });
  }

  // 2. greenfield with live rows and zero viable shapes.
  const zero = db
    .query(
      `SELECT d.opportunity_id AS id, COUNT(*) AS recorded, COALESCE(SUM(d.viable),0) AS viable, MAX(d.evaluated_at) AS latest
       FROM opportunity_deal_shape_evaluation d JOIN route_decision r ON r.opportunity_id = d.opportunity_id AND r.is_current = 1
       WHERE d.superseded_by IS NULL AND r.track = 'greenfield'
       GROUP BY d.opportunity_id HAVING SUM(d.viable) = 0 ORDER BY d.opportunity_id`,
    )
    .all() as Array<{ id: string; recorded: number; viable: number; latest: string }>;
  return {
    past_target_screening: past.sort((a, b) => (a.opportunity_id < b.opportunity_id ? -1 : 1)),
    greenfield_zero_viable: zero.map((z) => ({
      opportunity_id: z.id,
      opportunity_name: nameOf(z.id),
      track: "greenfield" as const,
      live_recorded: z.recorded,
      latest_at: z.latest,
    })),
  };
}
