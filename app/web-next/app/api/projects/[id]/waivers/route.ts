// Port of app/server/governance.ts GET/POST /api/projects/:id/waivers
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { issueWaiver } from "../../../../../../../db/lib/compliance.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { isLead, visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const rows = getDb()
    .query(
      "SELECT governance_doc_id, clause_ref, reason, requested_by, approver_role, approved_by, approved_at, expires_at, status, created_at FROM waiver WHERE project_id = ? ORDER BY created_at DESC, id DESC",
    )
    .all(project.id);
  return ok(rows);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (!isLead(ctx, project.id)) {
    return forbidden("not_project_lead", "Only the project lead can file a waiver for this project.");
  }
  const body = (await request.json().catch(() => null)) as
    | { governance_doc_id?: string; clause_ref?: string; reason?: string; approver_role?: string; expires_at?: string; approve?: boolean }
    | null;
  if (!body?.governance_doc_id || !body?.clause_ref?.trim() || !body?.reason?.trim() || !body?.approver_role) {
    return badRequest("invalid_request", "governance_doc_id, clause_ref, reason and approver_role are required.");
  }
  if (!body.expires_at) {
    return badRequest("waiver_expiry_required", "expires_at is mandatory — an indefinite waiver is a de facto repeal of its clause (ADR-0036).");
  }
  if (body.approve && ctx.role !== "admin") {
    return forbidden("admin_required", "Activating a waiver at filing time requires the admin role.");
  }
  const now = new Date().toISOString();
  try {
    const wid = issueWaiver(getDb(), {
      projectId: project.id,
      governanceDocId: body.governance_doc_id,
      clauseRef: body.clause_ref.trim(),
      reason: body.reason.trim(),
      requestedBy: ctx.userId,
      approverRole: body.approver_role,
      expiresAt: body.expires_at,
      approvedBy: body.approve ? ctx.userId : undefined,
      approvedAt: body.approve ? now : undefined,
      now,
    });
    appendAudit(getDb(), { actor: ctx.userId, action: "waiver_file", target: `${project.id}:${wid}`, now });
    return ok({ id: wid, status: body.approve ? "active" : "pending" }, 201);
  } catch (err) {
    return badRequest("waiver_failed", err instanceof Error ? err.message : "Waiver filing failed.");
  }
}
