// PMI 핵심인력 (pmi_key_talent) — 인수·합병 후 통합 대상 핵심 인력과
// 잔존(retention) 상태 관리. status는 DB CHECK와 동일한
// active | departed_regretted | departed_planned 이며 departed_* 전환 시 exit_date를 기록한다.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { route } from "../../../../../../lib/route.ts";
import { PMI_NOT_APPLICABLE_MESSAGE, pmiApplicability } from "../../../../../../lib/pmi-kickoff.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

export const TALENT_STATUSES = ["active", "departed_regretted", "departed_planned"] as const;

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const rows = getDb()
    .query(
      `SELECT id, role_ref, status, exit_date, locked_at, created_at
       FROM pmi_key_talent WHERE project_id = ? ORDER BY created_at`,
    )
    .all(id);
  return ok({ talents: rows }, 200, { count: rows.length });
});

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Registering key talent requires the analyst role or higher.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  if (!pmiApplicability(getDb(), id).applies) return forbidden("not_applicable_track", PMI_NOT_APPLICABLE_MESSAGE);
  const body = (await request.json().catch(() => null)) as { role_ref?: string; status?: string } | null;
  const roleRef = body?.role_ref?.trim();
  if (!roleRef) return badRequest("invalid_request", "role_ref (key-talent role/identifier) is required.");
  const status = body?.status?.trim() || "active";
  if (!(TALENT_STATUSES as readonly string[]).includes(status)) {
    return badRequest("invalid_request", `status must be one of: ${TALENT_STATUSES.join(" | ")}.`);
  }
  const db = getDb();
  const now = new Date().toISOString();
  const rowId = ulid();
  db.run(
    `INSERT INTO pmi_key_talent (id, project_id, role_ref, status, exit_date, locked_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [rowId, id, roleRef, status, status !== "active" ? now : null, now, now],
  );
  appendAudit(db, { actor: ctx.userId, action: "pmi_key_talent.create", target: `${id}:${rowId}`, now });
  return ok(db.query("SELECT * FROM pmi_key_talent WHERE id = ?").get(rowId), 201);
});
