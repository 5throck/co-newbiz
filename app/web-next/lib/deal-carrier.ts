// Resolve a deal route id (opportunity id OR promoted project id) to its process view
// and source opportunity id. Shared by the deal overview and the S3 stage so both
// interpret the route id identically (design 2026-10-11-deal-overview-and-s3-deal-scope).
export interface CarrierProcess {
  opportunity?: { id: string } | null;
}

export type CarrierGet = <T>(url: string) => Promise<{ data: T }>;

export interface ResolvedCarrier<P extends CarrierProcess> {
  proc: P;
  /** Source opportunity id; null when a project deal has no source opportunity. */
  opportunityId: string | null;
}

export async function resolveDealCarrier<P extends CarrierProcess>(get: CarrierGet, routeId: string): Promise<ResolvedCarrier<P>> {
  const enc = encodeURIComponent(routeId);
  try {
    const r = await get<P>(`/api/opportunities/${enc}/process`);
    return { proc: r.data, opportunityId: routeId };
  } catch {
    const r = await get<P>(`/api/projects/${enc}/process`);
    return { proc: r.data, opportunityId: r.data.opportunity?.id ?? null };
  }
}
