// Port of app/server/projects.ts DELETE /api/projects/:id/members/:userId
import { getDb } from "../../../../../../../../db/client.ts";
import { revokeProjectMembership } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { isLead, visibleProject } from "../../../../../../lib/project-visibility.ts";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id, userId } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (!isLead(ctx, project.id)) {
    return forbidden("not_project_lead", "Only the project lead can manage membership.");
  }
  revokeProjectMembership(getDb(), { projectId: project.id, userId, revokedBy: ctx.userId, now: new Date().toISOString() });
  return ok({ ok: true });
}
