"use client";

// Single owner of the opportunity `status` read for the S3 result screen (design
// 2026-11-07-s3-completion-into-decision-tab §8): the status line above the tabs and the
// decision-tab checklist share this one GET instead of each fetching it.
import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api.ts";

export function useOpportunityStatus(opportunityId: string | null | undefined) {
  const [status, setStatus] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    if (!opportunityId) return;
    try {
      const r = await api.get<{ status: string }>(`/api/opportunities/${encodeURIComponent(opportunityId)}`);
      setStatus(r.data.status);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [opportunityId]);

  useEffect(() => {
    setStatus(null);
    setLoadFailed(false);
    void refresh();
  }, [refresh]);

  return { status, loadFailed, loading: !!opportunityId && status === null && !loadFailed, refresh };
}
