"use client";

// Deal-context industry linkage (decider-approved navigation fix, 2026-10-16):
// which of the workspace industries belong to THIS deal. Two existing sources,
// composed client-side — no new backend surface:
//   1. opportunity.industry_id (migration 0126) — the deal's own industry,
//      keyed by the S1 predicate. Fetched via GET /api/opportunities/{id}.
//   2. project_industry live bindings (ADR-0056) — post-promotion bindings,
//      fetched via GET /api/projects/{projectId}/industries.
// A promoted project route id resolves through path 2 directly (the
// opportunity GET 404s — the route id is itself the project). An unpromoted
// opportunity probes the binding API only when it carries a real project row
// (project_id set); without one there is nothing to probe, so the fetch is
// skipped and linkedIds keeps the deal's own industry — the same degradation
// as an unreadable binding.
// Fetch failure degrades to "nothing linked" — every industry lands in the
// "다른 검토의 산업 분석" section, which is the honest rendering of unknown
// linkage. linkedIds === null means "not in a deal context".
import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api.ts";

/** The slice of the opportunity GET the linkage decision reads. */
export interface OpportunityLinkData {
  industry_id: string | null;
  project_id: string | null;
}

/**
 * Decide whether the project-industry binding API should be probed, and with
 * which id. `opportunity` is null when the opportunity GET 404'd (promoted
 * project route — the route id IS a project). An unpromoted opportunity with
 * a null project_id has no project row to bind to, so probing the deal id
 * would be a guaranteed 404 (the route's visibleProject check) — skip it.
 */
export function resolveBindingProbe(
  opportunity: OpportunityLinkData | null,
  dealId: string,
): { probe: boolean; projId: string | null } {
  if (!opportunity) return { probe: true, projId: dealId };
  if (opportunity.project_id) return { probe: true, projId: opportunity.project_id };
  return { probe: false, projId: null };
}

export interface DealIndustryLinkState {
  linkedIds: Set<string> | null;
  /** md_project id the binding API writes to; null when the deal has no project row. */
  projectId: string | null;
  loading: boolean;
  reload: () => void;
}

export function useDealIndustryLink(dealId: string | undefined): DealIndustryLinkState {
  const [linkedIds, setLinkedIds] = useState<Set<string> | null>(dealId ? new Set<string>() : null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!dealId);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is an intentional reload trigger
  useEffect(() => {
    if (!dealId) {
      setLinkedIds(null);
      setProjectId(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    (async () => {
      const ids = new Set<string>();
      let oppData: OpportunityLinkData | null = null;
      try {
        const opp = await api.get<OpportunityLinkData>(`/api/opportunities/${encodeURIComponent(dealId)}`);
        oppData = opp.data;
        if (oppData.industry_id) ids.add(oppData.industry_id);
      } catch {
        // Not an opportunity id (promoted project route) — the route id is itself the project id.
      }
      const { probe, projId } = resolveBindingProbe(oppData, dealId);
      if (probe && projId) {
        try {
          const b = await api.get<{ bindings: Array<{ industry_id: string }> }>(
            `/api/projects/${encodeURIComponent(projId)}/industries`,
          );
          for (const row of b.data.bindings ?? []) ids.add(row.industry_id);
          setProjectId(projId);
        } catch {
          // Bindings unreadable (no project row / not visible) — keep own-industry link only.
          setProjectId(null);
        }
      } else {
        // No project row to probe (unpromoted opportunity, project_id null) —
        // same degradation as an unreadable binding; avoids the guaranteed
        // 404 a deal-id probe would hit on the visibleProject check.
        setProjectId(null);
      }
      if (alive) {
        setLinkedIds(ids);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [dealId, nonce]);

  return { linkedIds, projectId, loading, reload };
}
