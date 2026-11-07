// Site-announcement events of a project (ADR-0194 item B, migration 0189): the human-recorded reference date of kill
// criterion #5 (greenfield-screening:infrastructure_plan_not_finalized_at_site_announcement, re-evaluated at fs). One row =
// one announcement event (board_resolution | public_announcement | mou_signing | regulatory_filing) with its date and the
// evidence citation of the announcement itself. The criterion compares the infrastructure plan's finalization date with the
// EARLIEST live announcement of any kind. Append-only: re-posting a kind corrects that kind's live row (superseded, audited
// with the old and new date); a different kind never replaces another kind's row. recorded_by is ALWAYS the session user (the
// body cannot name one). Record-only: nothing infers, defaults or copies a date from a recording or gate timestamp (B-2) -
// an agent may record only a date the calling user supplied or read verbatim from the cited document. Membership is
// enforced at the repository layer (a non-member gets 404, not 403, FR-SEC-03).
import { getDb } from "../../../../../../../db/client.ts";
import {
  ANNOUNCEMENT_KINDS, SiteAnnouncementError, listSiteAnnouncements, recordSiteAnnouncement,
} from "../../../../../../../db/repositories/site-announcement.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { route } from "../../../../../lib/route.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "read"); if (denied) return denied; }
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true })) return notFound();
  const { live, history, earliest_announced_on } = listSiteAnnouncements(getDb(), id);
  const recorded = new Set(live.map((r) => r.announcement_kind));
  return ok(
    {
      project_id: id,
      live,
      history,
      // The date kill criterion #5 compares against; null when nothing is recorded (the criterion is then unassessed).
      earliest_announced_on,
      unrecorded_kinds: ANNOUNCEMENT_KINDS.filter((k) => !recorded.has(k)),
      vocabulary: { announcement_kinds: ANNOUNCEMENT_KINDS },
    },
    200,
    { count: live.length },
  );
});

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "Recording a site announcement requires the analyst role or higher." }); if (denied) return denied; }
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("invalid_request", "A JSON body {announced_on, announcement_kind, evidence_ref, site_id?} is required.");
  const db = getDb();
  try {
    // Any recorded_by / recorder field in the body is ignored: the event belongs to the calling session user.
    const row = recordSiteAnnouncement(db, {
      projectId: id, announcedOn: body.announced_on, announcementKind: body.announcement_kind, evidenceRef: body.evidence_ref,
      siteId: body.site_id, recordedBy: ctx.userId, now: new Date().toISOString(),
    });
    return ok(row, 201);
  } catch (e) {
    if (e instanceof SiteAnnouncementError) return e.kind === "project_not_found" ? notFound() : badRequest("invalid_request", e.message);
    throw e;
  }
});
