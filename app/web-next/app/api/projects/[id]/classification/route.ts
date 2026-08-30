// Port of app/server/projects.ts GET/PUT /api/projects/:id/classification
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

const SENSITIVITIES = new Set(["public", "internal", "confidential", "restricted"]);

function classificationOf(projectId: string) {
  return getDb()
    .query("SELECT sensitivity, mnpi_flag, wall_group, classified_by, classified_at FROM project_classification WHERE project_id = ?")
    .get(projectId);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  return ok(classificationOf(project.id));
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role !== "admin") {
    return forbidden("admin_required", "Classification is set by an administrator who is a project member.");
  }
  const { id } = await params;
  const project = visibleProject(ctx, id, { allowAdmin: true });
  if (!project) return notFound();
  const body = (await request.json().catch(() => null)) as
    | { sensitivity?: string; mnpi_flag?: number | boolean; wall_group?: string | null }
    | null;
  const mnpi = body?.mnpi_flag === true || body?.mnpi_flag === 1 ? 1 : 0;
  if (!body?.sensitivity || !SENSITIVITIES.has(body.sensitivity)) {
    return badRequest("invalid_request", `sensitivity must be one of ${[...SENSITIVITIES].join("|")}.`);
  }
  const db = getDb();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO project_classification (project_id, sensitivity, mnpi_flag, wall_group, classified_by, classified_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT (project_id) DO UPDATE SET
       sensitivity = excluded.sensitivity,
       mnpi_flag = excluded.mnpi_flag,
       wall_group = excluded.wall_group,
       classified_by = excluded.classified_by,
       classified_at = excluded.classified_at`,
    [project.id, body.sensitivity, mnpi, body.wall_group?.trim() || null, ctx.userId, now],
  );
  appendAudit(db, { actor: ctx.userId, action: "classification_set", target: `${project.id}:${body.sensitivity}:mnpi=${mnpi}`, now });
  return ok(classificationOf(project.id));
}
