// PUT/DELETE /api/projects/[id]/milestones/[milestoneId] — update (fields or
// the done toggle) / remove one milestone (2026-10-21, migration 0167).
// Analyst+ writes, audited project_milestone.*; members only (FR-SEC-01).
// Reference display only — a late milestone blocks nothing.
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { MILESTONE_CATEGORIES, deleteMilestone, updateMilestone, type MilestoneCategory } from "../../../../../../lib/milestones.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { route } from "../../../../../../lib/route.ts";

export const PUT = route(async (request: Request, { params }: { params: Promise<{ id: string; milestoneId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Milestone updates require the analyst role or higher." });
  if (denied) return denied;
  const { id, milestoneId } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    title?: unknown; category?: unknown; due_date?: unknown; owner?: unknown; notes?: unknown; done?: unknown;
  } | null;
  try {
    const row = updateMilestone(getDb(), {
      projectId: id, milestoneId,
      title: typeof body?.title === "string" ? body.title : undefined,
      category: (typeof body?.category === "string" && (MILESTONE_CATEGORIES as readonly string[]).includes(body.category)
        ? body.category : undefined) as MilestoneCategory | undefined,
      dueDate: typeof body?.due_date === "string" ? body.due_date : undefined,
      owner: typeof body?.owner === "string" ? body.owner : undefined,
      notes: typeof body?.notes === "string" ? body.notes : undefined,
      done: typeof body?.done === "boolean" ? body.done : undefined,
      by: auth.auth.userId,
    });
    return ok(row, 200);
  } catch (err) {
    if (err instanceof Error && err.message === "milestone not found") return notFound();
    return badRequest("invalid_request", err instanceof Error ? err.message : "Milestone update failed.");
  }
});

export const DELETE = route(async (request: Request, { params }: { params: Promise<{ id: string; milestoneId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Milestone deletion requires the analyst role or higher." });
  if (denied) return denied;
  const { id, milestoneId } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const removed = deleteMilestone(getDb(), id, milestoneId, auth.auth.userId);
  if (!removed) return notFound();
  return ok({ id: milestoneId }, 200);
});
