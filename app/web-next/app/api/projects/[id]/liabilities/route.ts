// Port of app/server/deal-review.ts GET /api/projects/:id/liabilities
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

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
