// project-track — the ONE shared track resolver (ADR-0161, Q5 + review F6)
// for S11 execution baseline, S12 post-management and the PMI guards.
// track = live project_case_classification.case_type, else the current route
// decision / md_project.track. Never origin. case_type vs route disagreement =
// basis "conflict" (track null); no signal at all = basis "unresolved".
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";

export type TrackBasis = "case_type" | "route" | "project_track" | "case_type+route" | "conflict" | "unresolved";
export interface ResolvedTrack {
  track: "greenfield" | "brownfield" | null;
  case_type: string | null;
  route_track: string | null;
  sub_track: string | null;
  origin: string | null;
  basis: TrackBasis;
}

export function resolveTrack(projectId: string, db: Database = getDb()): ResolvedTrack {
  const cls = db
    .query("SELECT case_type, origin FROM project_case_classification WHERE project_id = ? AND superseded_by IS NULL")
    .get(projectId) as { case_type: string; origin: string } | null;
  const route = db
    .query(
      "SELECT r.track, r.sub_track FROM route_decision r JOIN md_project m ON m.source_opportunity_id = r.opportunity_id WHERE m.id = ? AND r.is_current = 1",
    )
    .get(projectId) as { track: string | null; sub_track: string | null } | null;
  const proj = db.query("SELECT track, origin FROM md_project WHERE id = ?").get(projectId) as { track: string | null; origin: string | null } | null;
  const caseType = cls?.case_type ?? null;
  const routeTrack = route?.track ?? proj?.track ?? null;
  const base = { case_type: caseType, route_track: routeTrack, sub_track: route?.sub_track ?? null, origin: cls?.origin ?? proj?.origin ?? null };
  const valid = (v: string | null): v is "greenfield" | "brownfield" => v === "greenfield" || v === "brownfield";
  if (caseType && routeTrack && caseType !== routeTrack) return { ...base, track: null, basis: "conflict" };
  if (valid(caseType)) return { ...base, track: caseType, basis: routeTrack ? "case_type+route" : "case_type" };
  if (valid(routeTrack)) return { ...base, track: routeTrack, basis: route?.track ? "route" : "project_track" };
  return { ...base, track: null, basis: "unresolved" };
}
