import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

// GET/POST /api/projects/[id]/customer-coc — contract change-of-control +
// concentration (customer-retention-agent). ≥30% concentration auto-flags. B8.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const rows = getDb()
    .query("SELECT *, CASE WHEN concentration_pct IS NOT NULL AND concentration_pct >= 30 THEN 1 ELSE 0 END AS flagged FROM contract_coc WHERE project_id = ? ORDER BY concentration_pct DESC")
    .all(id);
  return ok({ contracts: rows }, 200, { count: rows.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "계약 CoC 등록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    counterparty?: string; direction?: string; coc_clause_present?: boolean;
    clause_summary?: string | null; concentration_pct?: number | null;
    est_exit_loss?: number | null; evidence_ref?: string | null;
  } | null;
  if (!body?.counterparty?.trim()) return badRequest("counterparty_required", "counterparty는 필수입니다.");
  if (body.direction !== "customer" && body.direction !== "supplier") return badRequest("invalid_direction", "direction은 customer 또는 supplier입니다.");
  const now = new Date().toISOString();
  const rid = ulid();
  getDb().run(
    `INSERT INTO contract_coc (id, project_id, counterparty, direction, coc_clause_present, clause_summary, concentration_pct, est_exit_loss, evidence_ref, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [rid, id, body.counterparty.trim(), body.direction, body.coc_clause_present ? 1 : 0,
     body.clause_summary?.trim() || null, body.concentration_pct ?? null, body.est_exit_loss ?? null,
     body.evidence_ref?.trim() || null, auth.auth.userId, now, now],
  );
  appendAudit(getDb(), { actor: auth.auth.userId, action: "contract_coc.create", target: `${id}:${rid}`, now });
  return ok({ id: rid }, 201);
}
