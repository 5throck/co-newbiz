// @version 1.0.0
/**
 * site-announcement.repository.ts - the project-scoped site-announcement event (ADR-0194 item B, migration 0189).
 *
 * One row = one HUMAN-recorded announcement event (board resolution, public announcement, MOU signing, regulatory filing)
 * with its date and the evidence reference of the announcement itself. Kill criterion #5
 * (greenfield-screening:infrastructure_plan_not_finalized_at_site_announcement, re-evaluated at fs) compares the plan's
 * finalization date with the EARLIEST live announcement of any kind (owner O-B2, risk-officer C-1).
 *
 * Append-only with a superseded_by chain (ADR-0005 / FR-DATA-10); nothing is ever deleted. The live unique index is per
 * (project, announcement_kind): different events coexist as live rows, and the snapshot filler takes MIN(announced_on).
 * Supersession is a CORRECTION OF THE SAME EVENT only: re-recording a kind replaces that kind's live row (an evidenced
 * correction); recording a different kind never touches another kind's row, so a later event can never replace an earlier one
 * and move the reference date later (C-1). Every correction is audited with the old and the new date.
 *
 * Risk-officer B-2: `announced_on` later than today (Asia/Seoul calendar date) is rejected at write time; the evidence
 * reference is mandatory and must be a resolvable citation (doc:/src:/https://, db/lib/evidence-ref.ts). Dates are never
 * inferred, defaulted or copied from observed_at/recorded_at/gate dates: the caller supplies `announced_on`.
 * `recorded_by` is the calling human's user id taken from the session, never from a request body (Boundary 1).
 */
import type { Database } from "bun:sqlite";
import { appendAudit, logDataAccess, requireActiveMember, requireInsiderIfMnpi } from "../lib/access-control.ts";
import { EVIDENCE_REF_SHAPES, isValidEvidenceRef } from "../lib/evidence-ref.ts";
import { isIsoCalendarDate, seoulToday } from "../lib/iso-date.ts";
import { ulid } from "../lib/ulid.ts";

/** Closed vocabulary, byte-identical to the migration 0189 CHECK. */
export const ANNOUNCEMENT_KINDS = ["board_resolution", "public_announcement", "mou_signing", "regulatory_filing"] as const;
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];

export const EVIDENCE_REF_MAX = 2000;

export interface SiteAnnouncementRow {
  id: string;
  project_id: string;
  site_id: string | null;
  announced_on: string;
  announcement_kind: AnnouncementKind;
  evidence_ref: string;
  recorded_by: string;
  recorded_at: string;
  superseded_by: string | null;
}

export interface RecordSiteAnnouncementInput {
  projectId: string;
  announcedOn: unknown;
  announcementKind: unknown;
  evidenceRef: unknown;
  siteId?: unknown;
  /** The calling human's user id, taken from the session by the route - never from a request body. */
  recordedBy: string;
  now: string;
}

/** `invalid` = request shape/vocabulary/date problem (route: 400 invalid_request); `project_not_found` = route: 404. */
export class SiteAnnouncementError extends Error {
  constructor(readonly kind: "invalid" | "project_not_found", message: string) {
    super(message);
    this.name = "SiteAnnouncementError";
  }
}

const COLUMNS = "id, project_id, site_id, announced_on, announcement_kind, evidence_ref, recorded_by, recorded_at, superseded_by";

/**
 * Record (or correct) one announcement event. Validates the closed vocabulary, the real calendar date, the not-in-the-future
 * rule (B-2) and the mandatory evidence citation; requires an active project member (FR-SEC-08, insider on an MNPI project,
 * FR-SEC-06); supersedes only the live row of the SAME kind, atomically. Returns the new live row.
 */
export function recordSiteAnnouncement(db: Database, input: RecordSiteAnnouncementInput): SiteAnnouncementRow {
  const kind = typeof input.announcementKind === "string" ? input.announcementKind : "";
  if (!(ANNOUNCEMENT_KINDS as readonly string[]).includes(kind)) {
    throw new SiteAnnouncementError("invalid", `announcement_kind must be one of: ${ANNOUNCEMENT_KINDS.join(" | ")}.`);
  }
  if (!isIsoCalendarDate(input.announcedOn)) {
    throw new SiteAnnouncementError("invalid", "announced_on is required and must be a real calendar date in YYYY-MM-DD form (never inferred from a recording or gate date).");
  }
  const announcedOn = input.announcedOn;
  if (announcedOn > seoulToday(input.now)) {
    throw new SiteAnnouncementError("invalid", "announced_on cannot be later than today: a site announcement is a past event, and a future date would move the criterion's reference date later.");
  }
  const evidenceRef = typeof input.evidenceRef === "string" ? input.evidenceRef.trim() : "";
  if (!evidenceRef) throw new SiteAnnouncementError("invalid", "evidence_ref is required: the document or URL of the announcement itself.");
  if (evidenceRef.length > EVIDENCE_REF_MAX) throw new SiteAnnouncementError("invalid", `evidence_ref must be at most ${EVIDENCE_REF_MAX} characters.`);
  if (!isValidEvidenceRef(evidenceRef)) {
    throw new SiteAnnouncementError("invalid", `evidence_ref must be a resolvable citation (${EVIDENCE_REF_SHAPES.join(" | ")}).`);
  }
  let siteId: string | null = null;
  if (input.siteId !== undefined && input.siteId !== null && input.siteId !== "") {
    if (typeof input.siteId !== "string") throw new SiteAnnouncementError("invalid", "site_id must be a string.");
    siteId = input.siteId;
  }
  if (!input.recordedBy) throw new SiteAnnouncementError("invalid", "An announcement needs the calling user's identity.");

  const id = ulid();
  const write = db.transaction(() => {
    if (!db.query("SELECT 1 AS x FROM md_project WHERE id = ?").get(input.projectId)) {
      throw new SiteAnnouncementError("project_not_found", "Project not found.");
    }
    try {
      requireActiveMember(db, input.projectId, input.recordedBy);
      requireInsiderIfMnpi(db, input.projectId, input.recordedBy);
    } catch {
      // Not a member / not an insider: indistinguishable from a missing project (404-not-403, FR-SEC-03).
      throw new SiteAnnouncementError("project_not_found", "Project not found.");
    }
    if (siteId !== null && !db.query("SELECT 1 AS x FROM site WHERE id = ? AND project_id = ?").get(siteId, input.projectId)) {
      throw new SiteAnnouncementError("invalid", "site_id must name a site of this project.");
    }
    const previous = db
      .query("SELECT id, announced_on FROM site_announcement WHERE project_id = ? AND announcement_kind = ? AND superseded_by IS NULL")
      .get(input.projectId, kind) as { id: string; announced_on: string } | null;
    // The unique live index forbids two live rows of a kind, so the old row leaves the live set first; superseded_by points at
    // the row inserted next, hence the self-FK is checked at commit, not per statement.
    db.run("PRAGMA defer_foreign_keys = ON");
    if (previous) db.run("UPDATE site_announcement SET superseded_by = ? WHERE id = ?", [id, previous.id]);
    db.run(
      `INSERT INTO site_announcement (id, project_id, site_id, announced_on, announcement_kind, evidence_ref, recorded_by, recorded_at, superseded_by)
       VALUES (?,?,?,?,?,?,?,?,NULL)`,
      [id, input.projectId, siteId, announcedOn, kind, evidenceRef, input.recordedBy, input.now],
    );
    logDataAccess(db, { userId: input.recordedBy, tableKey: "site_announcement", recordRef: `${input.projectId}:${kind}:${id}`, projectId: input.projectId, action: "write", at: input.now });
    appendAudit(db, {
      actor: input.recordedBy,
      action: previous ? "project.site_announcement.correct" : "project.site_announcement.record",
      target: previous
        ? `${input.projectId}:${kind}:${id} supersedes=${previous.id} announced_on ${previous.announced_on} -> ${announcedOn}`
        : `${input.projectId}:${kind}:${id} announced_on=${announcedOn}`,
      now: input.now,
    });
  });
  write();
  return db.query(`SELECT ${COLUMNS} FROM site_announcement WHERE id = ?`).get(id) as SiteAnnouncementRow;
}

export interface SiteAnnouncementList {
  /** One row per kind (canonical vocabulary order). */
  live: SiteAnnouncementRow[];
  /** Superseded rows, newest first. */
  history: SiteAnnouncementRow[];
  /** MIN(announced_on) over the live rows - the date kill criterion #5 compares against; null when nothing is recorded. */
  earliest_announced_on: string | null;
}

/** Live (one per kind) and superseded history for one project, plus the earliest live date the criterion reads. */
export function listSiteAnnouncements(db: Database, projectId: string): SiteAnnouncementList {
  const rows = db.query(`SELECT ${COLUMNS} FROM site_announcement WHERE project_id = ? ORDER BY recorded_at DESC, id DESC`).all(projectId) as SiteAnnouncementRow[];
  const order = (k: AnnouncementKind) => ANNOUNCEMENT_KINDS.indexOf(k);
  const live = rows.filter((r) => r.superseded_by === null).sort((a, b) => order(a.announcement_kind) - order(b.announcement_kind));
  return {
    live,
    history: rows.filter((r) => r.superseded_by !== null),
    earliest_announced_on: live.length === 0 ? null : live.map((r) => r.announced_on).sort()[0],
  };
}
