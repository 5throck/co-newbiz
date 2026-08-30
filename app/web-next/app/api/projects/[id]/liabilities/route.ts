// Port of app/server/deal-review.ts GET /api/projects/:id/liabilities
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const db = getDb();
  const debtInstruments = db
    .query(
      `SELECT id, lender, principal, currency_id, rate_type, rate, maturity, amortization,
              covenant_json, coc_acceleration, security, seniority
       FROM debt_instrument WHERE project_id = ? ORDER BY seniority, id`,
    )
    .all(project.id);
  const contingentLiabilities = db
    .query(
      `SELECT id, category, description, probability, amount_low, amount_expected, amount_high,
              distribution, expected_timing_year, evidence_ref, value_impact
       FROM contingent_liability WHERE project_id = ? ORDER BY expected_timing_year, category`,
    )
    .all(project.id);
  const latest = db
    .query(
      `SELECT s.id FROM simulation s JOIN run r ON r.id = s.run_id
       WHERE r.project_id = ? ORDER BY s.created_at DESC, s.id DESC LIMIT 1`,
    )
    .get(project.id) as { id: string } | null;
  const covenantTests = latest
    ? db
      .query(
        `SELECT period_id, covenant_key, threshold, projected_value, breached
         FROM covenant_test WHERE simulation_id = ? ORDER BY period_id, covenant_key`,
      )
      .all(latest.id)
    : [];
  return ok(
    { debt_instruments: debtInstruments, contingent_liabilities: contingentLiabilities, covenant_tests: covenantTests },
    200,
    { simulation_id: latest?.id ?? null },
  );
}


// 우발채무 등록/삭제 — S6 우발채무 입력 UI와 짝을 이루는 쓰기 경로. 등록된
// 우발채무는 시뮬레이션의 반복마다 삼각분포로 자동 반영된다(monte_carlo.py).
// 삭제는 실제 삭제 + 감사로그.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Contingent liabilities are recorded by analysts.");
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  const body = (await request.json().catch(() => null)) as {
    category?: string; description?: string; probability?: number;
    amount_low?: number; amount_expected?: number; amount_high?: number;
    expected_timing_year?: number; evidence_ref?: string; value_impact?: number;
  } | null;
  if (!body?.category?.trim() || typeof body.probability !== "number" ||
      typeof body.amount_low !== "number" || typeof body.amount_expected !== "number" || typeof body.amount_high !== "number") {
    return badRequest("invalid_request", "category, probability, amount_low/expected/high are required.");
  }
  if (body.probability < 0 || body.probability > 1) {
    return badRequest("invalid_request", "probability must be between 0 and 1.");
  }
  if (!(body.amount_low <= body.amount_expected && body.amount_expected <= body.amount_high)) {
    return badRequest("invalid_request", "amounts must satisfy low <= expected <= high.");
  }
  const db = getDb();
  const now = new Date().toISOString();
  const rowId = ulid();
  db.run(
    `INSERT INTO contingent_liability (id, project_id, category, description, probability,
                                      amount_low, amount_expected, amount_high, distribution,
                                      expected_timing_year, evidence_ref, value_impact)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [rowId, project.id, body.category.trim(), body.description?.trim() ?? null, body.probability,
      body.amount_low, body.amount_expected, body.amount_high, "triangular",
      body.expected_timing_year ?? 0, body.evidence_ref?.trim() ?? null, body.value_impact ?? null],
  );
  appendAudit(db, { actor: ctx.userId, action: "liability_create", target: `${project.project_no}:${rowId}`, now });
  return ok({ id: rowId }, 201);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Contingent liabilities are deleted by analysts.");
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  const url = new URL(request.url);
  const rowId = url.searchParams.get("liability_id");
  if (!rowId) return badRequest("invalid_request", "liability_id query param is required.");
  const db = getDb();
  const res = db.run("DELETE FROM contingent_liability WHERE id = ? AND project_id = ?", [rowId, project.id]);
  if (res.changes === 0) return notFound();
  appendAudit(db, { actor: ctx.userId, action: "liability_delete", target: `${project.project_no}:${rowId}`, now: new Date().toISOString() });
  return ok({ deleted: rowId });
}
