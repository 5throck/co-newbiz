// GET /api/projects/[id]/financial-analysis — the bridge-tab payload
// (ADR-0116 Phase 1): the project's bound subject company with a compact
// metrics summary. The full financial dashboard lives on the company screen
// (/companies/[companyId]); this route only answers "무엇에 연결되어 있나".
// Access is scoped through visibleProject; archived/closed projects are
// hidden by default.
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
  const p = db.query("SELECT company_id, track, subject_company_rationale FROM md_project WHERE id = ?").get(id) as
    | { company_id: string | null; track: string | null; subject_company_rationale: string | null }
    | undefined;

  let company: {
    id: string;
    name_ko: string;
    dart_corp_code: string | null;
    role: string;
    rationale: string;
    latest_sync_at: string | null;
    metrics: { revenue_latest: number | null; revenue_growth: number | null; operating_margin: number | null; debt_ratio: number | null; roe: number | null };
  } | null = null;

  if (p?.company_id) {
    const c = db.query("SELECT id, name_ko, dart_corp_code FROM md_company WHERE id = ?").get(p.company_id) as
      | { id: string; name_ko: string; dart_corp_code: string | null }
      | undefined;
    if (c) {
      // Latest-year ratios from fact_financial (latest revision per account).
      const latest = db
        .query(
          `SELECT a.name_ko AS account, f.value, per.fiscal_year
           FROM fact_financial f
           JOIN md_account a ON a.id = f.account_id
           JOIN md_period per ON per.id = f.period_id
           WHERE f.company_id = ?
             AND f.revision_no = (SELECT MAX(f2.revision_no) FROM fact_financial f2
                                  WHERE f2.company_id = f.company_id AND f2.period_id = f.period_id AND f2.account_id = f.account_id)
           ORDER BY per.fiscal_year DESC`,
        )
        .all(c.id) as Array<{ account: string; value: number; fiscal_year: number }>;
      const latestYear = latest.length > 0 ? latest[0].fiscal_year : null;
      const byAccount = new Map<string, number>();
      const prevByAccount = new Map<string, number>();
      for (const r of latest) {
        if (r.fiscal_year === latestYear) byAccount.set(r.account, r.value);
        else if (prevByAccount.size === 0 || r.fiscal_year === latestYear! - 1) prevByAccount.set(r.account, r.value);
      }
      const num = (m: Map<string, number>, k: string): number | null => {
        const v = m.get(k);
        return v === undefined || v === 0 ? null : v;
      };
      const revenue = num(byAccount, "매출액");
      const op = num(byAccount, "영업이익");
      const ni = num(byAccount, "당기순이익");
      const debt = num(byAccount, "부채총계");
      const equity = num(byAccount, "자본총계");
      const revPrev = num(prevByAccount, "매출액");
      company = {
        id: c.id,
        name_ko: c.name_ko,
        dart_corp_code: c.dart_corp_code,
        role: p.track === "brownfield" ? "target" : "candidate",
        rationale: p.subject_company_rationale ?? "",
        latest_sync_at:
          (db.query("SELECT MAX(created_at) AS at FROM fact_financial WHERE company_id = ?").get(c.id) as { at: string | null }).at ?? null,
        metrics: {
          revenue_latest: revenue,
          revenue_growth: revenue !== null && revPrev !== null ? revenue / revPrev - 1 : null,
          operating_margin: revenue !== null && op !== null ? op / revenue : null,
          debt_ratio: debt !== null && equity !== null ? debt / equity : null,
          roe: ni !== null && equity !== null ? ni / equity : null,
        },
      };
    }
  }

  return ok({ project: { id: project.id, project_no: project.project_no, track: p?.track ?? null }, company }, 200, {
    linked: company !== null,
  });
}
