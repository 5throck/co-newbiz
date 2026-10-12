"use client";

// Lead detection shared by the closure button, the policy-migration panel and the S11 baseline
// confirm form: GET /api/projects?status=all reports is_lead per project (project_member.project_role='lead').
// The server stays the authority (403 lead_required); this only decides what to render.

import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";

export function useIsProjectLead(projectId: string): boolean {
  const [isLead, setIsLead] = useState(false);
  useEffect(() => {
    let live = true;
    api.get<Array<{ id: string; is_lead?: boolean }>>("/api/projects?status=all")
      .then((r) => { if (live) setIsLead(r.data.some((p) => p.id === projectId && p.is_lead === true)); })
      .catch(() => { /* not a lead as far as we can tell */ });
    return () => { live = false; };
  }, [projectId]);
  return isLead;
}
