// route-track-guard — T-20261022-038. Opportunity-carrier write surfaces must
// not trust the client's TrackGate: the route itself reads the opportunity's
// CURRENT route decision (same lookup the S5 route inlined for
// T-20261022-007) and refuses a carrier whose confirmed track conflicts with
// the surface's own track with 409 not_applicable_track. An opportunity with
// no route decision yet stays writable — S5/S6 drafting on legacy data
// precedes the S4 record, and only an explicit opposite-track call is refused.
// Project-carrier resolution (case_type/route/md_project merge) stays in
// lib/project-track.ts; this helper is the opportunity-keyed lookup only.
import type { Database } from "bun:sqlite";
import { fail } from "./envelope.ts";

/** 409 not_applicable_track when the carrier's current route decision exists
 *  AND names the other track; null = proceed (no decision, or same track). */
export function trackConflictResponse(
  db: Database,
  opportunityId: string,
  surfaceTrack: "greenfield" | "brownfield",
  message: string,
): Response | null {
  const decision = db
    .query("SELECT track FROM route_decision WHERE opportunity_id = ? AND is_current = 1 LIMIT 1")
    .get(opportunityId) as { track: string } | null;
  const track = decision?.track;
  if ((track === "greenfield" || track === "brownfield") && track !== surfaceTrack) {
    return fail(409, "not_applicable_track", message);
  }
  return null;
}

/** T-20261022-039: 409 already_promoted once the opportunity has been promoted
 *  to a project. The S6/S7 Short List IS the S8 subjectScope set (ADR-0143) —
 *  growing it after the fs GO rewinds S8 to current and locks S9–S12 while the
 *  recorded gate decisions stay live. Post-promotion widening goes through the
 *  sanctioned ADR-0157 per-target DD path on existing Short List members. */
export function promotedCarrierResponse(db: Database, opportunityId: string, message: string): Response | null {
  const promoted = db
    .query("SELECT id FROM opportunity WHERE id = ? AND project_id IS NOT NULL")
    .get(opportunityId);
  if (promoted) return fail(409, "already_promoted", message);
  return null;
}
