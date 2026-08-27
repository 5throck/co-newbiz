// Proxy-chain reliability grading view — design v1.0 §4-5, meeting M4.
// Surfaces each proxy_chain for the project's target industries together with
// its per-hop detail and the stored vs. recomputed grade (db/lib/chain-grading.ts
// is the SSOT for the grade rule; the stored grade must match it).
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { gradeChain, type Hop } from "../../../../../../../db/lib/chain-grading.ts";

interface ProxyHopRow {
  id: string;
  from_industry_id: string;
  to_industry_id: string;
  hop_type: "engineering" | "statistical";
  coefficient: number | null;
  beta: number | null;
  r2: number | null;
  lag_months: number | null;
  ci_low: number | null;
  ci_high: number | null;
  evidence_ref: string;
  calibrated_at: string | null;
}

interface ProxyChainRow {
  id: string;
  target_industry_id: string;
  hop_ids: string;
  reliability_grade: string;
  grade_rationale: string;
  compounded_ci_low: number | null;
  compounded_ci_high: number | null;
  calibrated_at: string;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();

  const industries = getDb()
    .query("SELECT industry_id FROM project_industry WHERE project_id = ? AND superseded_by IS NULL")
    .all(project.id) as { industry_id: string }[];
  const industryIds = industries.map((r) => r.industry_id);

  if (industryIds.length === 0) {
    return ok({ chains: [] }, 200, { target_industries: [] });
  }

  const inPlaceholders = industryIds.map(() => "?").join(",");
  const chains = getDb()
    .query(
      `SELECT id, target_industry_id, hop_ids, reliability_grade, grade_rationale,
              compounded_ci_low, compounded_ci_high, calibrated_at
       FROM proxy_chain WHERE target_industry_id IN (${inPlaceholders})`,
    )
    .all(...industryIds) as ProxyChainRow[];

  const result = chains.map((c) => {
    let hopIds: string[] = [];
    try {
      hopIds = JSON.parse(c.hop_ids ?? "[]");
    } catch {
      hopIds = [];
    }
    const hops: ProxyHopRow[] =
      hopIds.length > 0
        ? (getDb()
            .query(
              `SELECT id, from_industry_id, to_industry_id, hop_type, coefficient, beta, r2,
                      lag_months, ci_low, ci_high, evidence_ref, calibrated_at
               FROM proxy_link WHERE id IN (${hopIds.map(() => "?").join(",")})`,
            )
            .all(...hopIds) as ProxyHopRow[])
        : [];

    const graded = gradeChain(
      hops.map((h) => ({
        hopType: h.hop_type,
        r2: h.r2 ?? undefined,
        ciLow: h.ci_low ?? undefined,
        ciHigh: h.ci_high ?? undefined,
        betaOrCoefficient: (h.beta ?? h.coefficient ?? 0) as number,
      }) as Hop),
    );

    return {
      id: c.id,
      target_industry_id: c.target_industry_id,
      stored_grade: c.reliability_grade,
      stored_rationale: c.grade_rationale,
      recomputed_grade: graded.grade,
      recomputed_rationale: graded.rationale,
      grade_mismatch: graded.grade !== c.reliability_grade,
      compounded_ci_low: c.compounded_ci_low,
      compounded_ci_high: c.compounded_ci_high,
      calibrated_at: c.calibrated_at,
      hops: hops.map((h) => ({
        id: h.id,
        from_industry_id: h.from_industry_id,
        to_industry_id: h.to_industry_id,
        hop_type: h.hop_type,
        coefficient: h.coefficient,
        beta: h.beta,
        r2: h.r2,
        lag_months: h.lag_months,
        ci_low: h.ci_low,
        ci_high: h.ci_high,
        evidence_ref: h.evidence_ref,
      })),
    };
  });

  return ok({ chains: result }, 200, { target_industries: industryIds });
}
