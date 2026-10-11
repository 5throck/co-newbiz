// Portfolio overlap grouping rule (design 2026-10-11-portfolio-view-overlap
// §3-§4) — pure function, no DB access, so group-review-agent can import it
// directly (open question #2 default: direct lib import, MCP exposure out of
// scope) and the route /api/portfolio/overlap reuses the exact same rule the
// UI consumes.
//
// Key: md_industry.id, shared between opportunity.industry_id (migration
// 0126, exact-match backfill only) and live project_industry rows (migration
// 0021, superseded_by IS NULL). Never grouped by KSIC code (nullable per
// ADR-0111) or by industry name (not stable across locales/curation).
//
// Precision tiers are kept EXPLICITLY SEPARATED in the output so consumers
// (UI and group-review-agent) never blur them:
//   exact       — same industry_id on 2+ members (FK-verified identity)
//   name_prefix — fallback for opportunities with NULL industry_id whose
//                 trimmed market_scope strings coincide case- and
//                 whitespace-insensitively (free-text coincidence; the
//                 pre-existing dedup behavior demoted to a labeled fallback).
//                 Kept for now; revisited when the backfill report clears
//                 (design §10 open question 1 default).
// Everything with a key but fewer than 2 members is simply not a group;
// members with NO key surface in the na bucket, never force-grouped.

export type OverlapTier = "exact" | "name_prefix";

export interface OverlapIndustry {
  id: string;
  name_ko: string;
  name_en: string;
  /** null = unpinned KSIC (ADR-0111) — shown as such in the UI, never used as a grouping key. */
  ksic_code: string | null;
}

export interface OverlapOpportunityInput {
  id: string;
  name: string;
  market_scope: string | null;
  industry_id: string | null;
  status: string;
  /** Set when the opportunity was promoted to a project — it then counts on the PROJECT side only. */
  project_id: string | null;
  deleted_at: string | null;
}

export interface OverlapProjectInput {
  id: string;
  project_no: string;
  name: string;
  track: string | null;
  /** Live industry bindings (superseded_by IS NULL) for this project. */
  industry_ids: string[];
}

export interface OverlapMember {
  kind: "opportunity" | "project";
  id: string;
  name: string;
  href: string;
  status?: string;
  industry_pinned: boolean;
  project_no?: string;
  track?: string | null;
}

export interface OverlapGroup {
  tier: OverlapTier;
  /** null for the name_prefix tier (no verified industry identity behind it). */
  industry: OverlapIndustry | null;
  /** Identical trimmed scope text — name_prefix tier only. */
  key_label?: string;
  members: OverlapMember[];
}

export interface OverlapNa {
  opportunities_without_industry: Array<{ id: string; name: string; reason: "no_pinned_industry" | "industry_unresolved" }>;
  projects_without_industry: Array<{ id: string; project_no: string; reason: "no_live_binding" | "industry_unresolved" }>;
  /**
   * Count-only: promoted, live opportunities whose project the caller cannot
   * see. Deliberately carries no ids/names/industries (need-to-know).
   */
  hidden_promoted: { count: number };
}

export interface OverlapCounts {
  active_opportunities: number;
  projects: number;
  exact_groups: number;
  name_prefix_groups: number;
  na_opportunities: number;
  na_projects: number;
  /** na_opportunities + na_projects — for the UI empty-state wording. */
  na_total: number;
  /** Same value as na.hidden_promoted.count; exposure the caller cannot see (under-count signal). */
  hidden_promoted_opportunities: number;
}

export interface PortfolioOverlapResult {
  groups: OverlapGroup[];
  na: OverlapNa;
  counts: OverlapCounts;
}

export interface OverlapInput {
  opportunities: OverlapOpportunityInput[];
  projects: OverlapProjectInput[];
  industries: Map<string, OverlapIndustry>;
  /** Route-computed count of promoted live opportunities whose project is not visible to the caller. Default 0. */
  hiddenPromotedOpportunities?: number;
}

/**
 * name_prefix key: trimmed, lowercased, internal whitespace runs collapsed —
 * case- and whitespace-insensitive identity, nothing stronger (design §3).
 */
function normalizeScope(scope: string): string {
  return scope.trim().toLowerCase().replace(/\s+/g, " ");
}

function industryOf(industries: Map<string, OverlapIndustry>, id: string): OverlapIndustry {
  // Callers load md_industry for every referenced id; a missing row would be a
  // caller bug, so fail loud rather than emit an unlabeled group.
  const ind = industries.get(id);
  // Unreachable: unresolved ids are diverted to the na bucket above.
  if (!ind) throw new Error(`portfolio-overlap: unknown industry id ${id}`);
  return ind;
}

function opportunityMember(o: OverlapOpportunityInput, pinned: boolean): OverlapMember {
  return {
    kind: "opportunity",
    id: o.id,
    name: o.name,
    href: `/opportunities?opportunity=${o.id}`,
    status: o.status,
    industry_pinned: pinned,
  };
}

export function buildPortfolioOverlap(input: OverlapInput): PortfolioOverlapResult {
  // Exposure filter (design §3): status != 'dropped', not deleted. Promotion
  // dedup: an opportunity with a live project_id counts on the project side
  // only (via the project's live bindings) — enforced HERE as well as in the
  // route query so the pure rule stays safe for direct consumers.
  const hidden = Math.max(0, input.hiddenPromotedOpportunities ?? 0);
  const active = input.opportunities.filter(
    (o) => o.status !== "dropped" && o.deleted_at === null && o.project_id === null,
  );

  const exactMembers = new Map<string, OverlapMember[]>();
  // Prefix candidates keep the raw input so leftovers (keys with fewer than
  // 2 members) can surface in the na bucket instead of vanishing (design §3:
  // "single member ... surfaced in na bucket").
  const prefixCandidates = new Map<string, OverlapOpportunityInput[]>();
  const naOpportunities: OverlapNa["opportunities_without_industry"] = [];

  for (const o of active) {
    if (o.industry_id && !input.industries.has(o.industry_id)) {
      naOpportunities.push({ id: o.id, name: o.name, reason: "industry_unresolved" });
      continue;
    }
    if (o.industry_id) {
      const list = exactMembers.get(o.industry_id) ?? [];
      list.push(opportunityMember(o, true));
      exactMembers.set(o.industry_id, list);
      continue;
    }
    const scope = (o.market_scope ?? "").trim();
    if (scope !== "") {
      const key = normalizeScope(scope);
      const list = prefixCandidates.get(key) ?? [];
      list.push(o);
      prefixCandidates.set(key, list);
      continue;
    }
    naOpportunities.push({ id: o.id, name: o.name, reason: "no_pinned_industry" });
  }

  const naProjects: OverlapNa["projects_without_industry"] = [];

  for (const p of input.projects) {
    const resolvable = p.industry_ids.filter((id) => input.industries.has(id));
    if (p.industry_ids.length === 0) {
      naProjects.push({ id: p.id, project_no: p.project_no, reason: "no_live_binding" });
      continue;
    }
    if (resolvable.length === 0) {
      naProjects.push({ id: p.id, project_no: p.project_no, reason: "industry_unresolved" });
      continue;
    }
    for (const indId of resolvable) {
      const list = exactMembers.get(indId) ?? [];
      list.push({
        kind: "project",
        id: p.id,
        name: p.name,
        href: `/projects/${p.id}/process`,
        industry_pinned: true,
        project_no: p.project_no,
        track: p.track,
      });
      exactMembers.set(indId, list);
    }
  }

  const groups: OverlapGroup[] = [];

  for (const [industryId, members] of exactMembers) {
    // Single-member keys are just not groups (design §3 n/a row) — they are
    // NOT na-bucket entries: the na bucket carries members with no key at
    // all, per the response shape (§4).
    if (members.length < 2) continue;
    groups.push({ tier: "exact", industry: industryOf(input.industries, industryId), members });
  }

  for (const [key, cands] of prefixCandidates) {
    if (cands.length < 2) {
      for (const o of cands) {
        naOpportunities.push({ id: o.id, name: o.name, reason: "no_pinned_industry" });
      }
      continue;
    }
    groups.push({
      tier: "name_prefix",
      industry: null,
      key_label: key,
      members: cands.map((o) => opportunityMember(o, false)),
    });
  }

  // Exact tier first (high precision), then the fallback tier; alphabetical
  // inside a tier for stable output.
  groups.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === "exact" ? -1 : 1;
    const al = a.tier === "exact" ? (a.industry?.name_ko ?? "") : (a.key_label ?? "");
    const bl = b.tier === "exact" ? (b.industry?.name_ko ?? "") : (b.key_label ?? "");
    return al.localeCompare(bl, "ko");
  });

  // Deterministic na ordering (prefix leftovers append after empty-scope
  // entries in discovery order).
  naOpportunities.sort((a, b) => a.id.localeCompare(b.id));
  naProjects.sort((a, b) => a.id.localeCompare(b.id));

  return {
    groups,
    na: {
      opportunities_without_industry: naOpportunities,
      projects_without_industry: naProjects,
      hidden_promoted: { count: hidden },
    },
    counts: {
      active_opportunities: active.length,
      projects: input.projects.length,
      exact_groups: groups.filter((g) => g.tier === "exact").length,
      name_prefix_groups: groups.filter((g) => g.tier === "name_prefix").length,
      na_opportunities: naOpportunities.length,
      na_projects: naProjects.length,
      na_total: naOpportunities.length + naProjects.length,
      hidden_promoted_opportunities: hidden,
    },
  };
}
