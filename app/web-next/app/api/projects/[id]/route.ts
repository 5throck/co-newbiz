// DELETE /api/projects/[id] — deletion-mark teardown of the deal (lead-only).
// Nothing is physically deleted (deal-deletion-playbook): the project and its
// source opportunity are tombstoned (deleted_at/deleted_by/delete_reason) in
// one transaction, and a deal_archive manifest records WHO acted, WHICH members
// could see the deal at that moment, and WHICH market-sizing version it relied
// on (shared, industry-keyed asset — the manifest pins the as-of version).
// Every list/read surface filters the mark, so the deal disappears from
// 파이프라인·진출방식 결정·기회 발굴 while staying fully inspectable for audit.
// audit_log records the delete itself (FR-SEC-07).
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { isLead, visibleProject } from "../../../../lib/project-visibility.ts";
import { buildDealManifest, recordDealArchive } from "../../../../lib/deal-archive.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../lib/envelope.ts";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "프로젝트 삭제는 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const project = visibleProject(ctx, id, { includeClosed: true, includeDeleted: true });
  if (!project) return notFound();
  if (!isLead(ctx, id)) return forbidden("role_required", "프로젝트 삭제는 프로젝트 lead만 수행할 수 있습니다.");

  const db = getDb();
  const now = new Date().toISOString();
  const existing = db
    .query("SELECT source_opportunity_id, deleted_at, project_no, project_name, track, status FROM md_project WHERE id = ?")
    .get(id) as
    | { source_opportunity_id: string | null; deleted_at: string | null; project_no: string; project_name: string | null; track: string | null; status: string }
    | undefined;
  if (!existing) return notFound();
  if (existing.deleted_at) return badRequest("already_deleted", "이 프로젝트는 이미 삭제 표시되어 있습니다.");

  const manifest = buildDealManifest(db, id);
  db.transaction(() => {
    db.run("UPDATE md_project SET deleted_at = ?, deleted_by = ?, delete_reason = ? WHERE id = ?", [
      now,
      ctx.userId,
      `deleted by ${ctx.userId}`,
      id,
    ]);
    if (existing.source_opportunity_id) {
      db.run("UPDATE opportunity SET deleted_at = ?, deleted_by = ?, delete_reason = ? WHERE id = ?", [
        now,
        ctx.userId,
        `deleted with project ${existing.project_no}`,
        existing.source_opportunity_id,
      ]);
    }
    recordDealArchive(db, {
      kind: "deleted",
      entityType: "project",
      projectId: id,
      opportunityId: existing.source_opportunity_id,
      projectNo: existing.project_no,
      projectName: existing.project_name,
      track: existing.track,
      statusAtArchive: existing.status,
      actedBy: ctx.userId,
      actedAt: now,
      reason: existing.status === "open" ? null : "deleted after close",
      manifest,
    });
  })();
  appendAudit(db, {
    actor: ctx.userId,
    action: "project_delete",
    target: `${id}:${existing.project_no}`,
    now,
  });
  return ok({ id, deleted: true });
}
