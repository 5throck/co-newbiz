// GET /api/portfolio/overlap — same-industry exposure overlap across the
// portfolio (design 2026-10-11-portfolio-view-overlap §4). Grouping rule is
// shared with group-review-agent via lib/portfolio-overlap.ts (direct lib
// import — design §10 open question 2 default); this route only gathers the
// rows:
//   * opportunities: status != 'dropped', deleted_at IS NULL, project_id IS
//     NULL (promotion dedup §3 — promoted cases count on the project side),
//   * projects: listVisibleProjects (deny-by-default, no admin bypass —
//     lib/project-visibility.ts), non-archived; closed projects stay (they
//     still carry deployed exposure; only deleted ones drop out),
//   * live project_industry rows restricted to those visible ids.
// Read-only, analyst+ (requireBusinessActor(ctx, "read") — admins are kept
// out of deal content per ADR-0091).
import { getDb } from "../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../lib/auth.ts";
import { listVisibleProjects } from "../../../../../../db/repositories/project.repository.ts";
import { ok } from "../../../../lib/envelope.ts";
import {
  buildPortfolioOverlap,
  type OverlapIndustry,
  type OverlapProjectInput,
} from "../../../../lib/portfolio-overlap.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "read");
  if (denied) return denied;
  const db = getDb();

  const projects = listVisibleProjects(ctx.userId, {
    excludeMnpi: false,
    includeClosed: true,
    // 삭제(아카이브) 표시는 /api/archive/deals 전용 — 이 읽기에는 나오지 않는다.
  });
  const projectIds = projects.map((p) => p.id);

  // One pass per carrier, no N+1 (design §4 implementation notes).
  const opportunities = db
    .query(
      `SELECT id, name, market_scope, industry_id, status, project_id, deleted_at
       FROM opportunity
       WHERE status != 'dropped' AND deleted_at IS NULL AND project_id IS NULL`,
    )
    .all();

  // Count-only: promoted live opportunities whose project is not in the
  // caller's visible set (their exposure is invisible, not absent). Only a
  // number leaves this route — never ids/names of the hidden projects.
  const promoted = db
    .query(
      `SELECT project_id FROM opportunity
       WHERE status != 'dropped' AND deleted_at IS NULL AND project_id IS NOT NULL`,
    )
    .all() as Array<{ project_id: string }>;
  const visibleSet = new Set(projectIds);
  const hiddenPromotedOpportunities = promoted.filter((r) => !visibleSet.has(r.project_id)).length;

  const industryIds = new Set<string>();
  const bindings = new Map<string, string[]>();
  if (projectIds.length > 0) {
    const placeholders = projectIds.map(() => "?").join(",");
    const rows = db
      .query(
        `SELECT project_id, industry_id FROM project_industry
         WHERE superseded_by IS NULL AND project_id IN (${placeholders})`,
      )
      .all(...projectIds) as Array<{ project_id: string; industry_id: string }>;
    for (const r of rows) {
      industryIds.add(r.industry_id);
      const list = bindings.get(r.project_id) ?? [];
      list.push(r.industry_id);
      bindings.set(r.project_id, list);
    }
  }

  const opportunityIndustryIds = (opportunities as Array<{ industry_id: string | null }>)
    .map((o) => o.industry_id)
    .filter((id): id is string => id !== null);
  for (const id of opportunityIndustryIds) industryIds.add(id);

  const industries = new Map<string, OverlapIndustry>();
  if (industryIds.size > 0) {
    const placeholders = [...industryIds].map(() => "?").join(",");
    const rows = db
      .query(`SELECT id, name_ko, name_en, ksic_code FROM md_industry WHERE id IN (${placeholders})`)
      .all(...industryIds) as Array<{ id: string; name_ko: string; name_en: string; ksic_code: string | null }>;
    for (const r of rows) industries.set(r.id, r);
  }

  const projectInputs: OverlapProjectInput[] = projects.map((p) => ({
    id: p.id,
    project_no: p.project_no,
    name: p.project_name ?? p.project_no,
    track: p.track ?? null,
    industry_ids: bindings.get(p.id) ?? [],
  }));

  const result = buildPortfolioOverlap({
    opportunities: opportunities as Parameters<typeof buildPortfolioOverlap>[0]["opportunities"],
    projects: projectInputs,
    industries,
    hiddenPromotedOpportunities,
  });
  return ok(result, 200, { count: result.groups.length });
}
