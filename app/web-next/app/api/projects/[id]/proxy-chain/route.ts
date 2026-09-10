// GET /api/projects/[id]/proxy-chain — Wave B2 project value-chain links plus
// matching proxy-link/chain grades for the bound/adjacent industries.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true });
  if (!project) return notFound();
  const db = getDb();
  const links = db.query(
    `SELECT v.*, fi.name_ko AS from_industry_ko, fi.name_en AS from_industry_en,
            ti.name_ko AS to_industry_ko, ti.name_en AS to_industry_en
     FROM value_chain_link v
     JOIN md_industry fi ON fi.id = v.from_industry_id
     JOIN md_industry ti ON ti.id = v.to_industry_id
     WHERE v.project_id = ? ORDER BY v.direction, v.assessed_at DESC`
  ).all(id);
  const proxyLinks = db.query(
    `SELECT pl.id, pl.from_industry_id, pl.to_industry_id, pl.hop_type, pl.coefficient, pl.beta, pl.r2, pl.lag_months,
            pl.ci_low, pl.ci_high, pl.evidence_ref, pl.calibrated_at,
            fi.name_ko AS from_industry_ko, ti.name_ko AS to_industry_ko
     FROM proxy_link pl
     JOIN md_industry fi ON fi.id = pl.from_industry_id
     JOIN md_industry ti ON ti.id = pl.to_industry_id
     WHERE EXISTS (
       SELECT 1 FROM value_chain_link v
       WHERE v.project_id = ? AND ((v.from_industry_id = pl.from_industry_id AND v.to_industry_id = pl.to_industry_id)
                                OR (v.from_industry_id = pl.to_industry_id AND v.to_industry_id = pl.from_industry_id))
     ) ORDER BY pl.calibrated_at DESC, pl.id`
  ).all(id);
  const chains = db.query(
    `SELECT pc.* FROM proxy_chain pc
     WHERE pc.target_industry_id IN (
       SELECT from_industry_id FROM value_chain_link WHERE project_id = ?
       UNION SELECT to_industry_id FROM value_chain_link WHERE project_id = ?
       UNION SELECT industry_id FROM project_industry WHERE project_id = ? AND superseded_by IS NULL
     ) ORDER BY pc.reliability_grade, pc.calibrated_at DESC`
  ).all(id, id, id);
  return ok({ project: { id: project.id, project_no: project.project_no }, links, proxyLinks, chains }, 200, {
    link_count: (links as unknown[]).length,
    proxy_link_count: (proxyLinks as unknown[]).length,
    chain_count: (chains as unknown[]).length,
  });
}