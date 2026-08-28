// GET/POST /api/projects/:id/contract-coc-clauses — the customer-attrition
// validator's structured record (ma-07/ma-08, ADR-0072). GET is
// membership-filtered; POST is the analyst write path (mirrors
// dd-findings), audited as contract_coc_add.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const rows = getDb()
    .query(
      `SELECT id, counterparty, direction, coc_clause_present, clause_summary,
              concentration_pct, est_churn_pct, overlap_note, value_impact,
              evidence_ref, created_at
       FROM contract_coc_clause
       WHERE project_id = ?
       ORDER BY concentration_pct DESC, counterparty`,
    )
    .all(project.id);
  return ok(rows, 200, { count: rows.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (ctx.role === "viewer") {
    return forbidden("role_required", "Contract CoC findings are recorded by analysts.");
  }
  const body = (await request.json().catch(() => null)) as
    | {
      counterparty?: string;
      direction?: string;
      coc_clause_present?: boolean;
      clause_summary?: string;
      concentration_pct?: number;
      est_churn_pct?: number;
      overlap_note?: string;
      value_impact?: number;
      evidence_ref?: string;
    }
    | null;
  if (!body?.counterparty?.trim() || (body.direction !== "customer" && body.direction !== "supplier")) {
    return badRequest("invalid_request", "counterparty and direction (customer|supplier) are required.");
  }
  if (typeof body.coc_clause_present !== "boolean") {
    return badRequest("invalid_request", "coc_clause_present (boolean) is required.");
  }
  for (const [field, value] of [
    ["concentration_pct", body.concentration_pct],
    ["est_churn_pct", body.est_churn_pct],
  ] as const) {
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100)) {
      return badRequest("invalid_request", `${field} must be a number between 0 and 100.`);
    }
  }
  const db = getDb();
  const now = new Date().toISOString();
  const rowId = ulid();
  try {
    db.run(
      `INSERT INTO contract_coc_clause (id, project_id, counterparty, direction, coc_clause_present,
                                        clause_summary, concentration_pct, est_churn_pct, overlap_note,
                                        value_impact, evidence_ref, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        rowId,
        project.id,
        body.counterparty.trim(),
        body.direction,
        body.coc_clause_present ? 1 : 0,
        body.clause_summary?.trim() || null,
        body.concentration_pct ?? null,
        body.est_churn_pct ?? null,
        body.overlap_note?.trim() || null,
        typeof body.value_impact === "number" ? body.value_impact : null,
        body.evidence_ref?.trim() || null,
        now,
      ],
    );
  } catch (err) {
    return badRequest("contract_coc_rejected", err instanceof Error ? err.message : "Contract CoC record write failed.");
  }
  appendAudit(db, { actor: ctx.userId, action: "contract_coc_add", target: `${project.id}:${body.direction}:${body.counterparty.trim()}`, now });
  return ok({ id: rowId }, 201);
}
