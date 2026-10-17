// ADR-0179 amendment slice B (auto-link addition, decider chat 2026-10-17):
// the opportunity -> S1 sizing link (migration 0149 columns) is set
// AUTOMATICALLY when the opportunity's industry has a completed S1 market-
// sizing analysis. Rules:
//   - AUTO-LINK at opportunity creation (POST /api/opportunities) when the
//     industry already has a completed analysis: the link pins that
//     industry's LATEST completed version.
//   - KEPT CURRENT when a newer version completes (market-sizing pipeline):
//     opportunities of that industry auto-follow — UNLESS a person has
//     manually written the link at least once (pin OR clear): a manual
//     override wins FOREVER (frozen). Auto-refresh skips frozen links and a
//     display-side hint (`newer_version_available`) flags "더 최신 S1 버전
//     있음" instead.
//   - A manual CLEAR is a manual write, so it freezes too — the cleared
//     (unlinked) state persists, auto never re-links.
//   - COMPLETED analyses only: in-progress/draft/failed analyses are never
//     auto-linked; unresolvable industry / no completed analysis = no link,
//     nothing fabricated.
//   - Audits: `opportunity_sizing_link.auto` (target
//     `<id>#sizing-link@auto`) vs the manual `opportunity_sizing_link.write`
//     — the LAST link audit decides the displayed provenance (자동 연결 /
//     수동). No schema change: the audit log is the lineage.
import type { Database } from "bun:sqlite";
import { appendAudit } from "../../../db/lib/access-control.ts";

/** Whether ANY manual link write exists for this opportunity (pin or clear)
 *  — a manual act freezes auto-link forever. The audit target format is the
 *  manual route's `<id>#sizing-link@<via>`. */
function hasManualLinkWrite(db: Database, opportunityId: string): boolean {
  const row = db
    .query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'opportunity_sizing_link.write' AND target LIKE ?")
    .get(`${opportunityId}#sizing-link@%`) as { n: number };
  return row.n > 0;
}

/** Display provenance: the LAST link audit decides — auto vs manual vs
 *  none. Tolerant: no audits = "none". */
export function sizingLinkProvenance(db: Database, opportunityId: string): "auto" | "manual" | "none" {
  const row = db
    .query(
      "SELECT action FROM audit_log WHERE action IN ('opportunity_sizing_link.write', 'opportunity_sizing_link.auto') AND target LIKE ?" +
        " ORDER BY id DESC LIMIT 1",
    )
    .get(`${opportunityId}%`) as { action: string } | undefined;
  if (!row) return "none";
  return row.action === "opportunity_sizing_link.auto" ? "auto" : "manual";
}

/** Latest completed-analysis version of an industry (created_at then
 *  version_no desc). Null when none — never fabricated. */
function latestCompletedVersion(db: Database, industryId: string): string | null {
  const row = db
    .query(
      "SELECT mv.id AS id FROM market_sizing_version mv JOIN market_sizing_analysis a ON a.id = mv.analysis_id" +
        " WHERE a.industry_id = ? AND a.status = 'completed' ORDER BY mv.created_at DESC, mv.version_no DESC LIMIT 1",
    )
    .get(industryId) as { id: string } | undefined;
  return row?.id ?? null;
}

/** Latest completed version_no of the opportunity's industry — display-side
 *  freshness hint. Null when no industry or no completed analysis. */
export function latestCompletedVersionNo(db: Database, opportunityId: string): number | null {
  const row = db
    .query(
      "SELECT MAX(mv.version_no) AS m FROM market_sizing_version mv JOIN market_sizing_analysis a ON a.id = mv.analysis_id" +
        " WHERE a.industry_id = (SELECT industry_id FROM opportunity WHERE id = ?) AND a.status = 'completed'",
    )
    .get(opportunityId) as { m: number | null };
  return row?.m ?? null;
}

/** Set the auto link (columns + audit). Returns the version id when a link
 *  landed, null when there was nothing to link. */
function pinAutoLink(db: Database, opportunityId: string, versionId: string, actor: string, now: string): string {
  db.transaction(() => {
    db.run("UPDATE opportunity SET sizing_analysis_id = (SELECT analysis_id FROM market_sizing_version WHERE id = ?), sizing_version_id = ? WHERE id = ?", [
      versionId,
      versionId,
      opportunityId,
    ]);
    appendAudit(db, { actor, action: "opportunity_sizing_link.auto", target: `${opportunityId}#sizing-link@auto`, now });
  })();
  return versionId;
}

/** Auto-link one opportunity if unlinked, not frozen, and a completed
 *  industry analysis exists. Returns the linked version id or null (with
 *  the reason) — never throws, never fabricates. */
export function autoLinkSizing(db: Database, opportunityId: string, actor: string, now: string): { version_id: string | null; reason: string } {
  const opp = db
    .query("SELECT industry_id, sizing_version_id FROM opportunity WHERE id = ?")
    .get(opportunityId) as { industry_id: string | null; sizing_version_id: string | null } | undefined;
  if (!opp) return { version_id: null, reason: "not_found" };
  if (hasManualLinkWrite(db, opportunityId)) return { version_id: null, reason: "frozen_manual" };
  if (opp.sizing_version_id) return { version_id: null, reason: "already_linked" };
  if (!opp.industry_id) return { version_id: null, reason: "no_industry" };
  const versionId = latestCompletedVersion(db, opp.industry_id);
  if (!versionId) return { version_id: null, reason: "no_completed_analysis" };
  return { version_id: pinAutoLink(db, opportunityId, versionId, actor, now), reason: "linked" };
}

/** Auto-follow on a NEW completed version: refresh every opportunity of the
 *  industry whose link is not frozen — unlinked ones get linked, and links
 *  that are still auto-provenanced move to the newer version. Manual
 *  overrides stay frozen; the UI hint (`newer_version_available`) flags the
 *  staleness instead. Called from the market-sizing pipeline after a version
 *  completes. Returns the number of links written. */
export function refreshAutoSizingLinks(db: Database, industryId: string, actor: string, now: string): number {
  const opps = db
    .query("SELECT id, sizing_version_id FROM opportunity WHERE industry_id = ?")
    .all(industryId) as Array<{ id: string; sizing_version_id: string | null }>;
  const latest = latestCompletedVersion(db, industryId);
  if (!latest) return 0;
  let written = 0;
  for (const o of opps) {
    if (hasManualLinkWrite(db, o.id)) continue; // manual override wins forever
    if (o.sizing_version_id === latest) continue;
    if (o.sizing_version_id && sizingLinkProvenance(db, o.id) === "manual") continue; // frozen
    pinAutoLink(db, o.id, latest, actor, now);
    written++;
  }
  return written;
}
