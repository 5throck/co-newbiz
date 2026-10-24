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
import { getSystemMode } from "../../../../../../db/lib/system-mode.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { isLead, visibleProject } from "../../../../lib/project-visibility.ts";
import { buildDealManifest, recordDealArchive } from "../../../../lib/deal-archive.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../lib/envelope.ts";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Deleting a project requires the analyst role or higher.");
  // ADR-0133 — production 모드에서는 딜 데이터 삭제(톰스톤 포함)를 전면 차단한다.
  // 관리자가 /admin/system-mode에서 development로 전환해야 다시 허용된다.
  if (getSystemMode(getDb()) === "production") {
    return forbidden("production_mode_delete_blocked", "Project deletion is blocked in production mode — an admin must switch the system mode to development.");
  }
  const { id } = await params;
  const project = visibleProject(ctx, id, { includeClosed: true, includeDeleted: true });
  if (!project) return notFound();
  if (!isLead(ctx, id)) return forbidden("role_required", "Only the project lead can delete the project.");

  const db = getDb();
  const now = new Date().toISOString();
  const existing = db
    .query("SELECT source_opportunity_id, deleted_at, project_no, project_name, track, status FROM md_project WHERE id = ?")
    .get(id) as
    | { source_opportunity_id: string | null; deleted_at: string | null; project_no: string; project_name: string | null; track: string | null; status: string }
    | undefined;
  if (!existing) return notFound();
  if (existing.deleted_at) return badRequest("already_deleted", "This project is already soft-deleted.");

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
