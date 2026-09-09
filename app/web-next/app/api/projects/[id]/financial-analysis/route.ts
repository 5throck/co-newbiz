// GET /api/projects/[id]/financial-analysis — Wave B2 read model over
// fact_financial, comp_benchmark, and valuation_simulation. Access is scoped
// through visibleProject; archived/closed projects are hidden by default.
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
  const p = db.query("SELECT company_id FROM md_project WHERE id = ?").get(id) as { company_id: string | null } | undefined;
  const financials = p?.company_id
    ? db.query(
        `SELECT f.id, f.value, f.revision_no, f.created_at,
                a.name_ko AS account_name, a.ifrs_code,
                per.fiscal_year, per.period_type, per.start_date, per.end_date,
                s.code AS source_code
         FROM fact_financial f
         JOIN md_account a ON a.id = f.account_id
         JOIN md_period per ON per.id = f.period_id
         LEFT JOIN md_source s ON s.id = f.source_id
         WHERE f.company_id = ?
         ORDER BY per.fiscal_year DESC, a.ifrs_code, f.revision_no DESC`
      ).all(p.company_id)
    : [];
  const compBenchmarks = db.query(
    `SELECT id, job_family, grade, headcount, target_median, acquirer_median, gap_pct, annual_cost_delta, evidence_ref
     FROM comp_benchmark WHERE project_id = ? ORDER BY job_family, grade`
  ).all(id);
  const valuations = db.query(
    `SELECT v.id, v.model_id, v.scenario, v.percentile, v.npv_krw_m, v.irr, v.note, v.created_at,
            m.name AS model_name
     FROM valuation_simulation v JOIN business_case_model m ON m.id = v.model_id
     WHERE v.project_id = ? ORDER BY v.scenario, v.percentile`
  ).all(id);
  return ok({ project: { id: project.id, project_no: project.project_no }, company_id: p?.company_id ?? null, financials, compBenchmarks, valuations }, 200, {
    financial_count: (financials as unknown[]).length,
    comp_benchmark_count: (compBenchmarks as unknown[]).length,
    valuation_count: (valuations as unknown[]).length,
  });
}