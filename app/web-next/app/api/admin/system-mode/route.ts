// GET/POST /api/admin/system-mode (ADR-0133) — production|development 전역
// 스위치. 관리자만 변경할 수 있다. production에서는 프로젝트·검토/안건 DELETE가
// 차단된다(app/api/projects/[id]/route.ts, app/api/opportunities/[id]/route.ts).
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { getSystemMode, setSystemMode, type SystemMode } from "../../../../../../db/lib/system-mode.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { badRequest, ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const db = getDb();
  const row = db.query("SELECT value, updated_by, updated_at FROM system_setting WHERE key = 'system_mode'").get() as
    | { value: string; updated_by: string | null; updated_at: string }
    | null;
  return ok({ mode: getSystemMode(db), updated_by: row?.updated_by ?? null, updated_at: row?.updated_at ?? null });
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const body = (await request.json().catch(() => null)) as { mode?: string } | null;
  if (body?.mode !== "production" && body?.mode !== "development") {
    return badRequest("invalid_request", "mode must be one of: production | development.");
  }
  const db = getDb();
  const now = new Date().toISOString();
  const mode = body.mode as SystemMode;
  setSystemMode(db, mode, auth.auth.userId, now);
  appendAudit(db, { actor: auth.auth.userId, action: "system_mode_set", target: mode, now });
  return ok({ mode }, 200);
}
