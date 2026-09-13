// JV 조건 (jv_term) — deal의 합작 파트너별 지분구조·거버넌스·엑싯 조항 관리.
// partner_id는 같은 project의 partner_candidate로 강제되며(스키마 FK), viewer는
// 읽기만 가능하고 쓰기는 analyst+ (appendAudit).
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { route } from "../../../../../lib/route.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();
  const terms = db
    .query(
      `SELECT t.id, t.project_id, t.partner_id, t.equity_split, t.governance_json, t.veto_matters,
              t.contribution_json, t.exit_clause, t.deadlock_mechanism, t.non_compete_scope,
              c.name AS partner_name
       FROM jv_term t JOIN partner_candidate c ON c.id = t.partner_id
       WHERE t.project_id = ? ORDER BY c.name`,
    )
    .all(id);
  return ok({ terms }, 200, { count: terms.length });
});

function jsonOrNull(v: unknown): string | null {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return null;
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string") {
    try { JSON.parse(v); return v; } catch { return JSON.stringify(v); }
  }
  return JSON.stringify(v);
}

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "JV 조건 등록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    partner_id?: string; equity_split?: string | null; governance?: unknown; veto_matters?: string | null;
    contribution?: unknown; exit_clause?: string | null; deadlock_mechanism?: string | null;
    non_compete_scope?: string | null;
  } | null;
  const partnerId = body?.partner_id?.trim();
  if (!partnerId) return badRequest("invalid_request", "partner_id(파트너)는 필수입니다.");
  const db = getDb();
  const partner = db
    .query("SELECT id FROM partner_candidate WHERE id = ? AND project_id = ?")
    .get(partnerId, id) as { id: string } | undefined;
  if (!partner) return badRequest("invalid_request", "이 검토/안건에 등록된 파트너 후보가 아닙니다.");
  const dup = db.query("SELECT id FROM jv_term WHERE project_id = ? AND partner_id = ?").get(id, partnerId);
  if (dup) return badRequest("duplicate_jv_term", "이 파트너에 대한 JV 조건이 이미 등록되어 있습니다.");
  const now = new Date().toISOString();
  const rowId = ulid();
  db.run(
    `INSERT INTO jv_term
       (id, project_id, partner_id, equity_split, governance_json, veto_matters,
        contribution_json, exit_clause, deadlock_mechanism, non_compete_scope)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rowId, id, partnerId,
      body?.equity_split?.trim() || null,
      jsonOrNull(body?.governance),
      body?.veto_matters?.trim() || null,
      jsonOrNull(body?.contribution),
      body?.exit_clause?.trim() || null,
      body?.deadlock_mechanism?.trim() || null,
      body?.non_compete_scope?.trim() || null,
    ],
  );
  appendAudit(db, { actor: ctx.userId, action: "jv_term.create", target: `${id}:${rowId}`, now });
  return ok(db.query("SELECT * FROM jv_term WHERE id = ?").get(rowId), 201);
});
