// GET /api/projects/[id]/reports/[snapshotId]/render/[format] — stream a
// rendered report file (ADR-0116 Phase 6). The file path comes ONLY from the
// report_render table (written by the render pipeline), and the resolved
// path must stay inside the project's render_out directory — request
// segments never touch the filesystem directly.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { getDb } from "../../../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../../../lib/auth.ts";
import { fail, notFound, ok } from "../../../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../../../lib/project-visibility.ts";
import { route } from "../../../../../../../../lib/route.ts";

const CONTENT_TYPES: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  hwpx: "application/octet-stream",
};
const FORMATS = new Set(Object.keys(CONTENT_TYPES));

export const GET = route(async (
  request: Request,
  { params }: { params: Promise<{ id: string; snapshotId: string; format: string }> },
) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id, snapshotId, format } = await params;
  if (!FORMATS.has(format)) return fail(400, "invalid_format", "format must be one of: docx/pdf/hwpx.");
  const project = visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true });
  if (!project) return notFound();

  const db = getDb();
  const snapshot = db
    .query("SELECT id FROM report_snapshot WHERE id = ? AND project_id = ?")
    .get(snapshotId, id) as { id: string } | undefined;
  if (!snapshot) return notFound();
  const render = db
    .query("SELECT file_path FROM report_render WHERE snapshot_id = ? AND format = ?")
    .get(snapshotId, format) as { file_path: string } | undefined;
  if (!render) return notFound("No render file for that format — re-save the snapshot specifying the format.");

  // Path-containment guard: the stored file must live in a directory that
  // ends with render_out/<projectId>/<snapshotId>/ — cwd-independent, and
  // request segments never touch the filesystem directly.
  const expectedDirSuffix = ["render_out", id, snapshotId, ""].join(sep);
  const filePath = resolve(render.file_path);
  const fileDir = dirname(filePath) + sep;
  if (!fileDir.endsWith(expectedDirSuffix)) return fail(400, "invalid_render_path", "Invalid render file path.");
  if (!existsSync(filePath)) return notFound("The render file is missing on disk — re-render the snapshot.");

  const bytes = readFileSync(filePath);
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="snapshot.${format}"`,
      "Cache-Control": "no-store",
    },
  });
});