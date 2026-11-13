// 그룹/계열사 분석 — 그룹 등록/목록/상세 (그룹+계열사+최신 프로파일 롤업).
import { getDb } from "../../../../../../db/client.ts";
import { ulid } from "../../../../../../db/lib/ulid.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../lib/auth.ts";
import { badRequest, ok } from "../../../../lib/envelope.ts";
import { listGroups } from "../../../../lib/our-company-groups.ts";

const now = () => new Date().toISOString();

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const groups = listGroups(getDb());
  return ok({ groups }, 200, { count: groups.length });
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "write", {
    viewerMessage: "Registering groups requires the analyst role or higher.",
  });
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = body?.name?.trim();
  if (!name) return badRequest("invalid_request", "Group name (name) is required.");
  const db = getDb();
  const existing = db.query("SELECT id FROM company_group WHERE name = ? AND deleted_at IS NULL").get(name) as
    | { id: string }
    | undefined;
  if (existing) return ok({ id: existing.id, name, reused: true }, 200);
  const id = ulid();
  const ts = now();
  db.run("INSERT INTO company_group (id, name, created_by, created_at) VALUES (?,?,?,?)", [id, name, ctx.userId, ts]);
  // FR-SEC-07 (ADR-0012) — every write path lands in audit_log. The register
  // write previously had no audit row (route-audit scan gap, repaired
  // 2026-11-13 alongside the calibration-loop batch).
  appendAudit(db, { actor: ctx.userId, action: "company_group.register", target: id, now: ts });
  return ok({ id, name, reused: false }, 201);
}
