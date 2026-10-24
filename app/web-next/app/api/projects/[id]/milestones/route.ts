// GET/POST /api/projects/[id]/milestones — the person-managed milestone
// register (2026-10-21, migration 0167). GET returns every milestone with its
// derived status (done / overdue / due_soon / planned) plus a summary;
// ?summary=1 returns only the counts for the sidebar badge. POST creates one
// milestone. Analyst+ writes, audited project_milestone.*; members only
// (FR-SEC-01). Reference display only — a late milestone blocks nothing.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import {
  MILESTONE_CATEGORIES,
  listMilestones,
  milestoneSummary,
  createMilestone,
  type MilestoneCategory,
} from "../../../../../lib/milestones.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { route } from "../../../../../lib/route.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();
  if (new URL(request.url).searchParams.get("summary") === "1") {
    return ok({ summary: milestoneSummary(db, id) }, 200);
  }
  const milestones = listMilestones(db, id);
  return ok({ milestones, summary: milestoneSummary(db, id) }, 200, { count: milestones.length });
});

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Milestone registration requires the analyst role or higher." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    title?: unknown; category?: unknown; due_date?: unknown; owner?: unknown; notes?: unknown;
  } | null;
  const category = (typeof body?.category === "string" && (MILESTONE_CATEGORIES as readonly string[]).includes(body.category)
    ? body.category : "custom") as MilestoneCategory;
  try {
    const row = createMilestone(getDb(), {
      projectId: id,
      title: typeof body?.title === "string" ? body.title : "",
      category,
      dueDate: typeof body?.due_date === "string" ? body.due_date : "",
      owner: typeof body?.owner === "string" ? body.owner : null,
      notes: typeof body?.notes === "string" ? body.notes : null,
      by: auth.auth.userId,
    });
    return ok(row, 201);
  } catch (err) {
    return badRequest("invalid_request", err instanceof Error ? err.message : "Milestone registration failed.");
  }
});
