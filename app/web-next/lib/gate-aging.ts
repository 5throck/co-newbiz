// Gate aging (D2) — how long each non-resolved gate has been sitting in its
// recorded verdict. HOLD/HOLD-pending aging makes blocked deals visible at the
// portfolio level instead of inside one project page.
import type { Database } from "bun:sqlite";
import { evaluateProcess } from "./process-flow.ts";

export interface GateAgingRow {
  entityType: "opportunity" | "project";
  entityId: string;
  label: string;
  gate: string;
  decision: string;
  decidedAt: string;
  ageDays: number;
  /** Carrier track (md_project.track / latest route_decision.track) — lets the inbox deep link to the track-appropriate decision surface. */
  track: string | null;
}

export function listGateAging(db: Database, opts: { minAgeDays?: number } = {}): GateAgingRow[] {
  const minAge = opts.minAgeDays ?? 1;
  const rows = db
    .query(
      `SELECT g.entity_type, g.entity_id, g.gate, g.decision, g.decided_at,
              CAST(julianday('now') - julianday(g.decided_at) AS INTEGER) AS age_days,
              COALESCE(
                CASE WHEN g.entity_type = 'project' THEN (SELECT project_no || '|' || COALESCE(project_name, project_no) FROM md_project WHERE id = g.entity_id) END,
                CASE WHEN g.entity_type = 'opportunity' THEN (SELECT name FROM opportunity WHERE id = g.entity_id) END,
                g.entity_id
              ) AS label,
              COALESCE(
                CASE WHEN g.entity_type = 'project' THEN (SELECT track FROM md_project WHERE id = g.entity_id) END,
                CASE WHEN g.entity_type = 'opportunity' THEN (SELECT track FROM route_decision WHERE opportunity_id = g.entity_id ORDER BY decided_at DESC, id DESC LIMIT 1) END
              ) AS track
       FROM gate_decision g
       LEFT JOIN md_project p ON p.id = g.entity_id AND g.entity_type = 'project'
       WHERE g.decided_at >= datetime('now', '-90 days')
         AND (g.entity_type != 'project' OR (p.status = 'open' AND p.deleted_at IS NULL))
       ORDER BY g.decided_at DESC`,
    )
    .all() as Array<{
      entity_type: "opportunity" | "project";
      entity_id: string;
      gate: string;
      decision: string;
      decided_at: string;
      age_days: number;
      label: string;
      track: string | null;
    }>;

  // Latest verdict per (entity, gate) only — history rows would double-count.
  const seen = new Set<string>();
  const out: GateAgingRow[] = [];
  for (const r of rows) {
    const key = `${r.entity_type}:${r.entity_id}:${r.gate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.decision !== "hold" && r.decision !== "kill") continue;
    if (r.age_days < minAge) continue;
    const [projectNo, projectName] = r.label.includes("|") ? r.label.split("|") : [null, r.label];
    out.push({
      entityType: r.entity_type,
      entityId: r.entity_id,
      label: r.entity_type === "project" ? `${projectName ?? projectNo ?? r.entity_id} (${projectNo ?? ""})`.trim() : r.label,
      gate: r.gate,
      decision: r.decision,
      decidedAt: r.decided_at,
      ageDays: r.age_days,
      track: r.track ?? null,
    });
  }
  return out.sort((a, b) => b.ageDays - a.ageDays);
}

/** D1 — S8~S12 funnel: per-project current stage + gate snapshot. */
export interface PipelineProject {
  projectId: string;
  projectNo: string;
  projectName: string | null;
  track: string | null;
  currentStage: string | null;
  nextStage: string | null;
  gates: Record<string, string>;
  blockers: string[];
}

export function listProjectPipeline(db: Database): PipelineProject[] {
  const projects = db
    .query("SELECT id, project_no, COALESCE(project_name, project_no) AS pname, track FROM md_project WHERE status = 'open' AND deleted_at IS NULL ORDER BY created_at DESC")
    .all() as Array<{ id: string; project_no: string; pname: string; track: string | null }>;
  // evaluateProcess lives in the app lib — imported above (no cycle: the
  // process engine never reads gate aging).
  const out: PipelineProject[] = [];
  for (const p of projects) {
    try {
      const evaluation = evaluateProcess({ type: "project", id: p.id });
      out.push({
        projectId: p.id,
        projectNo: p.project_no,
        projectName: p.pname,
        track: evaluation.track,
        currentStage: evaluation.currentStage,
        nextStage: evaluation.nextStage,
        gates: evaluation.gateStatus,
        blockers: evaluation.blockers,
      });
    } catch {
      // A project whose opportunity row vanished — skip rather than break the funnel.
    }
  }
  return out;
}
