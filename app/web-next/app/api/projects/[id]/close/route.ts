// PATCH /api/projects/[id]/close — Wave B1 explicit project lifecycle.
// KILL remains a derived gate_decision verdict; this route records the
// operator lifecycle state (`closed` or `archived`) after closeout evidence is
// captured. Deny-by-default visibility plus lead-only write.
import { closeProject, ProjectLifecycleError } from "../../../../../../../db/repositories/project.repository.ts";
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { buildDealManifest, recordDealArchive } from "../../../../../lib/deal-archive.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { isLead, visibleProject } from "../../../../../lib/project-visibility.ts";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id, { includeClosed: true });
  if (!project) return notFound();
  if (!isLead(auth.auth, id)) return forbidden("role_required", "프로젝트 종료/보관은 프로젝트 lead만 수행할 수 있습니다.");

  const body = (await request.json().catch(() => null)) as { status?: string; closure_reason?: string } | null;
  const status = body?.status === "archived" ? "archived" : "closed";
  const closureReason = body?.closure_reason?.trim() ?? "";
  try {
    const closed = closeProject(id, { status, closureReason, closedBy: auth.auth.userId });
    // point-in-time manifest — pins the market-sizing versions the deal relied
    // on and the member allowlist at closure (deal-deletion-playbook)
    const db = getDb();
    recordDealArchive(db, {
      kind: "archived",
      entityType: "project",
      projectId: id,
      projectNo: closed.project_no ?? null,
      projectName: closed.project_name ?? null,
      track: closed.track ?? null,
      statusAtArchive: closed.status ?? status,
      actedBy: auth.auth.userId,
      actedAt: new Date().toISOString(),
      reason: closureReason,
      manifest: buildDealManifest(db, id),
    });
    return ok({ project: closed }, 200, { project_status: closed.status ?? status });
  } catch (err) {
    if (err instanceof ProjectLifecycleError) {
      if (err.code === "not_found") return notFound();
      return badRequest(err.code, err.message);
    }
    return badRequest("project_close_failed", err instanceof Error ? err.message : "프로젝트 종료/보관 처리에 실패했습니다.");
  }
}