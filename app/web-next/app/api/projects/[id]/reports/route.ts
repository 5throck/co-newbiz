// GET/POST /api/projects/[id]/reports — Wave B2 report history + renderer wrapper.
// POST persists a report_snapshot and, when formats are requested, invokes the
// existing python/report renderer facade (scripts/co-newbiz/report.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../../../../../../../db/client.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import type { ReportFormat } from "../../../../../../../scripts/co-newbiz/report.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

const FORMATS = new Set(["docx", "pdf", "hwpx"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const rows = getDb().query(
    `SELECT id, project_id, title, content_md, created_by, created_at
     FROM report_snapshot WHERE project_id = ? ORDER BY created_at DESC, id DESC`
  ).all(id);
  return ok({ project: { id: project.id, project_no: project.project_no }, reports: rows }, 200, { count: (rows as unknown[]).length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "보고서 스냅샷 생성은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const body = (await request.json().catch(() => null)) as { title?: string; content_md?: string; formats?: string[] } | null;
  const title = body?.title?.trim() || `${project.project_no} report`;
  const contentMd = body?.content_md?.trim() || `# ${title}\n\nProject: ${project.project_no}\n\nGenerated from co-newbiz report snapshot.`;
  const formats = (body?.formats ?? []).filter((f): f is ReportFormat => FORMATS.has(f));
  if ((body?.formats ?? []).length !== formats.length) return badRequest("invalid_format", "formats는 docx/pdf/hwpx만 허용합니다.");

  const db = getDb();
  const now = new Date().toISOString();
  const snapshotId = ulid();
  db.run(
    "INSERT INTO report_snapshot (id, project_id, title, content_md, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [snapshotId, id, title, contentMd, auth.auth.userId, now],
  );
  appendAudit(db, { actor: auth.auth.userId, action: "report_snapshot_create", target: `${project.project_no}:${snapshotId}`, now });

  let renders: unknown[] = [];
  if (formats.length > 0) {
    const { renderReport } = await import("../../../../../../../scripts/co-newbiz/report.ts");
    const outDir = join("render_out", id, snapshotId);
    mkdirSync(outDir, { recursive: true });
    const mdPath = join(outDir, "snapshot.md");
    writeFileSync(mdPath, contentMd, "utf8");
    try {
      renders = await renderReport(mdPath, formats, { outDir });
    } catch (err) {
      return badRequest("report_render_failed", err instanceof Error ? err.message : "보고서 렌더링 실패");
    }
  }
  return ok({ snapshot: { id: snapshotId, project_id: id, title, content_md: contentMd, created_by: auth.auth.userId, created_at: now }, renders }, 201, { render_count: renders.length });
}
