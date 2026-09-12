import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

// GET/POST /api/projects/[id]/permits — permits and certifications tracked
// SEPARATELY (flow.spec; certification-agent). B5. GET returns both lists +
// the critical-path edges; POST creates one row (kind: permit | certification).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();
  const permits = db.query("SELECT * FROM permit WHERE project_id = ? ORDER BY rowid").all(id);
  const certifications = db.query("SELECT * FROM certification WHERE project_id = ? ORDER BY rowid").all(id);
  return ok({ permits, certifications }, 200, { permits: permits.length, certifications: certifications.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "인허가·인증 등록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    kind?: string; name?: string; agency?: string | null; statutory_days?: number | null;
    transferable_on_coc?: string | null; status?: string;
  } | null;
  if (body?.kind !== "permit" && body?.kind !== "certification") {
    return badRequest("kind_required", "kind은 permit 또는 certification이어야 합니다.");
  }
  if (!body?.name?.trim()) return badRequest("name_required", "name은 필수입니다.");
  const rid = ulid();
  if (body.kind === "permit") {
    getDb().run(
      "INSERT INTO permit (id, project_id, name, agency, statutory_days, status) VALUES (?,?,?,?,?,?)",
      [rid, id, body.name.trim(), body.agency?.trim() || null, body.statutory_days ?? null,
       body.status?.trim() || "not_started"],
    );
  } else {
    getDb().run(
      `INSERT INTO certification (id, project_id, name, agency, statutory_days, status, transferable_on_coc)
       VALUES (?,?,?,?,?,?,?)`,
      [rid, id, body.name.trim(), body.agency?.trim() || null, body.statutory_days ?? null,
       body.status?.trim() || "not_started", body.transferable_on_coc?.trim() || null],
    );
  }
  appendAudit(getDb(), { actor: auth.auth.userId, action: `${body.kind}.create`, target: `${id}:${rid}`, now: new Date().toISOString() });
  return ok({ id: rid, kind: body.kind }, 201);
}
