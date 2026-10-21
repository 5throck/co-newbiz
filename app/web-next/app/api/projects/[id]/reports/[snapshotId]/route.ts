// GET/DELETE /api/projects/[id]/reports/[snapshotId] — one report snapshot.
// GET returns the full markdown (members; archived snapshots are readable).
// DELETE is a SOFT delete (archived_at set — the "immutable history" doctrine
// keeps the row and its render files, ADR-0116 Phase 6; the history list hides
// it). Analyst+, audited report_snapshot.archived; members only (FR-SEC-01).
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { route } from "../../../../../../lib/route.ts";

interface SnapshotRow {
  id: string; project_id: string; title: string; content_md: string;
  created_by: string; created_at: string; archived_at: string | null;
}

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string; snapshotId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id, snapshotId } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const row = getDb()
    .query("SELECT id, project_id, title, content_md, created_by, created_at, archived_at FROM report_snapshot WHERE id = ? AND project_id = ?")
    .get(snapshotId, id) as SnapshotRow | undefined;
  if (!row) return notFound();
  return ok(row, 200);
});

export const DELETE = route(async (request: Request, { params }: { params: Promise<{ id: string; snapshotId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "보고서 보관은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { id, snapshotId } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const db = getDb();
  const row = db
    .query("SELECT id, title, archived_at FROM report_snapshot WHERE id = ? AND project_id = ?")
    .get(snapshotId, id) as { id: string; title: string; archived_at: string | null } | undefined;
  if (!row) return notFound();
  if (row.archived_at) return ok({ id: snapshotId, archived_at: row.archived_at, already_archived: true }, 200);
  const now = new Date().toISOString();
  db.run("UPDATE report_snapshot SET archived_at = ? WHERE id = ?", [now, snapshotId]);
  appendAudit(db, { actor: auth.auth.userId, action: "report_snapshot.archived", target: `${id}:${snapshotId}:${row.title}`, now });
  return ok({ id: snapshotId, archived_at: now }, 200);
});
