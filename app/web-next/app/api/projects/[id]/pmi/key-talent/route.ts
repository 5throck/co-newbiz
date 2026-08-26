// Port of app/server/pmi.ts GET/POST /api/projects/:id/pmi/key-talent
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

const KEY_TALENT_STATUSES = ["active", "departed_regretted", "departed_planned"] as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const rows = getDb()
    .query("SELECT id, role_ref, status, exit_date, locked_at FROM pmi_key_talent WHERE project_id = ? ORDER BY locked_at DESC, id")
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
  if (ctx.role === "viewer") return forbidden("role_required", "Key-talent writes require the analyst role.");
  const body = (await request.json().catch(() => null)) as
    | { role_ref?: string; status?: string; exit_date?: string | null; locked_at?: string }
    | null;
  if (!body?.role_ref?.trim() || !body?.locked_at) {
    return badRequest("invalid_request", "role_ref and locked_at are required.");
  }
  const status = body.status ?? "active";
  if (!KEY_TALENT_STATUSES.includes(status as never)) {
    return badRequest("invalid_status", `status must be one of ${KEY_TALENT_STATUSES.join(", ")}.`);
  }
  if ((status === "active") === (body.exit_date != null && body.exit_date !== "")) {
    return badRequest("status_exit_mismatch", "active rows carry no exit_date; departed rows carry one.");
  }
  if (!/^[A-Z]-[A-Z0-9]{2}-[0-9]{3}$/.test(body.role_ref.trim())) {
    return badRequest("invalid_role_ref", "role_ref must be a role key like 'C-EO-001' — never a person's name (ADR-0039).");
  }
  const db = getDb();
  const id2 = ulid();
  try {
    db.run(
      "INSERT INTO pmi_key_talent (id, project_id, role_ref, status, exit_date, locked_at, created_at) VALUES (?,?,?,?,?,?,?)",
      [id2, project.id, body.role_ref.trim(), status, body.exit_date ?? null, body.locked_at, new Date().toISOString()],
    );
  } catch (err) {
    return badRequest("key_talent_failed", err instanceof Error ? err.message : "Key-talent insert failed.");
  }
  appendAudit(db, { actor: ctx.userId, action: "pmi_key_talent_write", target: `${project.id}:${id2}`, now: new Date().toISOString() });
  return ok({ id: id2, status }, 201);
}
