"use client";

// Resolves the deal carrier (opportunity) behind /deals/[id] and
// /opportunities/[id]: its display name and, when promoted, the project id that
// S8-S12 routes need (the route param is the OPPORTUNITY id, never the project
// id — walkthrough F4). Requests are de-duplicated for a few seconds so the
// breadcrumb and the stage rail share one fetch.
import { useEffect, useState } from "react";
import { api } from "./api.ts";

export interface DealContext {
  name: string | null;
  /** Promoted project id, or null while the deal is still an opportunity. */
  projectId: string | null;
}

interface OppLite { name: string; project_id: string | null }

const TTL_MS = 3000;
const inflight = new Map<string, { at: number; p: Promise<DealContext | null> }>();

function fetchDealContext(id: string): Promise<DealContext | null> {
  const hit = inflight.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = api
    .get<OppLite>(`/api/opportunities/${encodeURIComponent(id)}`)
    .then((r) => ({ name: r.data.name, projectId: r.data.project_id ?? null }) as DealContext)
    .catch(() => null);
  inflight.set(id, { at: Date.now(), p });
  return p;
}

/** `state` is "loading" until the first answer, then "ready" (ctx may be null when unresolvable). */
export function useDealContext(id: string | undefined, enabled = true): { state: "loading" | "ready"; ctx: DealContext | null } {
  const [res, setRes] = useState<{ id: string; ctx: DealContext | null } | null>(null);
  useEffect(() => {
    if (!id || !enabled) return;
    let alive = true;
    void fetchDealContext(id).then((ctx) => { if (alive) setRes({ id, ctx }); });
    return () => { alive = false; };
  }, [id, enabled]);
  if (!id || !enabled) return { state: "ready", ctx: null };
  if (!res || res.id !== id) return { state: "loading", ctx: null };
  return { state: "ready", ctx: res.ctx };
}
