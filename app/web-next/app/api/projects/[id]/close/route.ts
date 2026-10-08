// Project closure (ADR-0152).
//   POST  /api/projects/[id]/close — typed, precondition-enforced closure
//         ({closureType, basisId?, closureReason, learningCapture?}). 409 names
//         the missing record. closed_by is the session user, never client-supplied.
//   PATCH /api/projects/[id]/close — post-closure ARCHIVE only (Wave B1
//         retention step); a bare 'closed' transition is refused (409).
// Deny-by-default visibility plus lead-only write; agents cannot close.
import { closeProject, ProjectLifecycleError } from "../../../../../../../db/repositories/project.repository.ts";
import { ClosureError, closeEntity } from "../../../../../../../db/repositories/closure.repository.ts";
import { AGENT_IDS, closureErrorResponse, parseCloseBody } from "../../../../../lib/closure-http.ts";
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { buildDealManifest, recordDealArchive } from "../../../../../lib/deal-archive.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { isLead, visibleProject } from "../../../../../lib/project-visibility.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id, { includeClosed: true });
  if (!project) return notFound();
  if (!isLead(auth.auth, id)) return forbidden("role_required", "프로젝트 종료는 프로젝트 lead만 수행할 수 있습니다.");

  const parsed = parseCloseBody(await request.json().catch(() => null), "project");
  if ("response" in parsed) return parsed.response;
  try {
    const record = closeEntity({
      entityType: "project",
      entityId: id,
      closureType: parsed.body.closureType,
      basisId: parsed.body.basisId,
      closureReason: parsed.body.closureReason,
      learningCapture: parsed.body.learningCapture,
      closedBy: auth.auth.userId,
      agentIds: AGENT_IDS,
    });
    const db = getDb();
    const closed = db.query("SELECT * FROM md_project WHERE id = ?").get(id) as { project_no?: string | null; project_name?: string | null; track?: string | null; status?: string };
    recordDealArchive(db, {
      kind: "archived",
      entityType: "project",
      projectId: id,
      projectNo: closed.project_no ?? null,
      projectName: closed.project_name ?? null,
      track: (closed.track as "greenfield" | "brownfield" | null) ?? null,
      statusAtArchive: "closed",
      actedBy: auth.auth.userId,
      actedAt: record.closed_at,
      reason: parsed.body.closureReason,
      manifest: buildDealManifest(db, id),
    });
    return ok({ closure: record }, 200, { project_status: "closed", closure_type: record.closure_type });
  } catch (err) {
    if (err instanceof ClosureError) return closureErrorResponse(err);
    throw err;
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id, { includeClosed: true });
  if (!project) return notFound();
  if (!isLead(auth.auth, id)) return forbidden("role_required", "프로젝트 종료/보관은 프로젝트 lead만 수행할 수 있습니다.");

  const body = (await request.json().catch(() => null)) as { status?: string; closure_reason?: string } | null;
  if (body?.status !== "archived") {
    return fail(409, "typed_closure_required", "프로젝트 종료는 POST /close에서 closureType과 함께 수행해야 합니다 (ADR-0152). PATCH는 보관(archived) 전용입니다.");
  }
  const status = "archived" as const;
  const closureReason = body?.closure_reason?.trim() ?? "";
  try {
    const closed = closeProject(id, { status, closureReason, closedBy: auth.auth.userId, agentIds: AGENT_IDS });
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
    if (err instanceof ClosureError) return closureErrorResponse(err);
    if (err instanceof ProjectLifecycleError) {
      if (err.code === "not_found") return notFound();
      if (err.code === "precondition_failed") return fail(409, err.code, err.message);
      return badRequest(err.code, err.message);
    }
    return badRequest("project_close_failed", err instanceof Error ? err.message : "프로젝트 종료/보관 처리에 실패했습니다.");
  }
}