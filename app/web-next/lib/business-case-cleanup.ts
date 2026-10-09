// Legacy business-case cleanup (ADR-0158). Human-only: callers (the
// legacy-cleanup route) must reject agent / delegated principals first.
// Unreferenced pre-ADR-0143 models (target_id NULL on a shortlist-scoped
// project) are deleted through the same path as the ordinary delete; models a
// decision record still points at are ARCHIVED so the adoption / IC audit
// trail keeps resolving. Per-target models are never touched.
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";

export interface LegacyModelRow {
  id: string;
  name: string;
  scenario: string | null;
  variant: "market_forward" | "historical";
  created_at: string;
  /** True when an adoption / gate / process record names this model id. */
  referenced: boolean;
}

export interface CleanupResult {
  deleted: string[];
  archived: string[];
}

function isShortlistScopedProject(db: Database, projectId: string): boolean {
  const p = db.query("SELECT track, source_opportunity_id FROM md_project WHERE id = ?").get(projectId) as
    | { track: string | null; source_opportunity_id: string | null }
    | undefined;
  if (!p || p.track !== "brownfield" || !p.source_opportunity_id) return false;
  const n = db.query("SELECT COUNT(*) AS n FROM brownfield_target WHERE opportunity_id = ? AND status = 'shortlisted'").get(p.source_opportunity_id) as { n: number };
  return n.n > 0;
}

/** Does any decision record name this model? Adoption (s8_case_adopt meta
 *  model_id) and any other process_run meta, plus gate rationale / missing-artifact
 *  text. Over-matching only ever archives instead of deleting. */
export function isModelReferenced(db: Database, projectId: string, modelId: string): boolean {
  const like = `%${modelId}%`;
  const run = db.query("SELECT 1 AS x FROM process_run WHERE (project_id = ? OR entity_id = ?) AND meta_json LIKE ? LIMIT 1").get(projectId, projectId, like);
  if (run) return true;
  const gate = db
    .query("SELECT 1 AS x FROM gate_decision WHERE entity_id = ? AND (rationale LIKE ? OR COALESCE(missing_artifacts_json, '') LIKE ?) LIMIT 1")
    .get(projectId, like, like);
  if (gate) return true;
  const ev = db
    .query(
      `SELECT 1 AS x FROM gate_evaluation g JOIN process_run r ON r.id = g.process_run_id
       WHERE (r.project_id = ? OR r.entity_id = ?) AND (COALESCE(g.evidence_json, '') LIKE ? OR COALESCE(g.criteria_json, '') LIKE ?) LIMIT 1`,
    )
    .get(projectId, projectId, like, like);
  return Boolean(ev);
}

/** Active (non-archived) NULL-target models of a shortlist-scoped project; [] otherwise. */
export function listLegacyModels(projectId: string, db: Database = getDb()): LegacyModelRow[] {
  if (!isShortlistScopedProject(db, projectId)) return [];
  const rows = db
    .query(
      `SELECT m.id, m.name, COALESCE(m.variant, 'market_forward') AS variant, m.created_at,
              (SELECT v.scenario FROM valuation_simulation v WHERE v.model_id = m.id ORDER BY v.scenario LIMIT 1) AS scenario
       FROM business_case_model m
       WHERE m.project_id = ? AND m.target_id IS NULL AND m.archived_at IS NULL
       ORDER BY m.created_at, m.id`,
    )
    .all(projectId) as Array<Omit<LegacyModelRow, "referenced">>;
  return rows.map((r) => ({ ...r, referenced: isModelReferenced(db, projectId, r.id) }));
}

/** Delete unreferenced legacy models, archive referenced ones. `modelIds`
 *  omitted = every active legacy model; ids that are not legacy are ignored
 *  (never touches a per-target or already-archived model). */
export function cleanupLegacyModels(projectId: string, actor: string, modelIds?: readonly string[], db: Database = getDb()): CleanupResult {
  const legacy = listLegacyModels(projectId, db).filter((m) => !modelIds || modelIds.includes(m.id));
  const result: CleanupResult = { deleted: [], archived: [] };
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const m of legacy) {
      if (m.referenced) {
        db.run("UPDATE business_case_model SET archived_at = ?, archived_by = ? WHERE id = ?", [now, actor, m.id]);
        appendAudit(db, { actor, action: "business_case.archive", target: `${projectId}:${m.id}`, now });
        result.archived.push(m.id);
      } else {
        // valuation_simulation has no ON DELETE CASCADE — remove its rows first (same as the ordinary delete).
        db.run("DELETE FROM valuation_simulation WHERE model_id = ?", [m.id]);
        db.run("DELETE FROM business_case_line WHERE model_id = ?", [m.id]);
        db.run("DELETE FROM business_case_model WHERE id = ?", [m.id]);
        appendAudit(db, { actor, action: "business_case.delete", target: `${projectId}:${m.id}`, now });
        result.deleted.push(m.id);
      }
    }
  })();
  return result;
}
