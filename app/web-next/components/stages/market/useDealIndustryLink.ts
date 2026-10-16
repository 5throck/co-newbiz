"use client";

// Deal-context industry linkage (decider-approved navigation fix, 2026-10-16):
// which of the workspace industries belong to THIS deal. Two existing sources,
// composed client-side — no new backend surface:
//   1. opportunity.industry_id (migration 0126) — the deal's own industry,
//      keyed by the S1 predicate. Fetched via GET /api/opportunities/{id}.
//   2. project_industry live bindings (ADR-0056) — post-promotion bindings,
//      fetched via GET /api/projects/{projectId}/industries.
// A promoted project route id resolves through path 2 directly (the
// opportunity GET 404s); an unpromoted opportunity keeps its shell project_id
// so its bindings are still picked up when they exist.
// Fetch failure degrades to "nothing linked" — every industry lands in the
// "다른 검토의 산업 분석" section, which is the honest rendering of unknown
// linkage. linkedIds === null means "not in a deal context".
import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api.ts";

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

  useEffect(() => {
    if (!dealId) { setLinkedIds(null); setProjectId(null); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    (async () => {
      const ids = new Set<string>();
      let projId: string | null = dealId;
      try {
        const opp = await api.get<{ industry_id: string | null; project_id: string | null }>(`/api/opportunities/${encodeURIComponent(dealId)}`);
        if (opp.data.industry_id) ids.add(opp.data.industry_id);
        projId = opp.data.project_id ?? dealId;
      } catch {
        // Not an opportunity id (promoted project route) — the route id is itself the project id.
        projId = dealId;
      }
      if (projId) {
        try {
          const b = await api.get<{ bindings: Array<{ industry_id: string }> }>(`/api/projects/${encodeURIComponent(projId)}/industries`);
          for (const row of b.data.bindings ?? []) ids.add(row.industry_id);
          setProjectId(projId);
        } catch {
          // Bindings unreadable (no project row / not visible) — keep own-industry link only.
          setProjectId(null);
        }
      }
      if (alive) { setLinkedIds(ids); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [dealId, nonce]);

  return { linkedIds, projectId, loading, reload };
}
