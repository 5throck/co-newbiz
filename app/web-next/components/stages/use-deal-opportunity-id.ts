"use client";

// Source opportunity id of the deal in the route (opportunity id passes through; a
// promoted project id resolves to its source opportunity, or null when it has none).
// Same resolver as the deal overview page, so the two cannot diverge.
import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { resolveDealCarrier, type CarrierProcess } from "../../lib/deal-carrier.ts";

export type DealOpportunityState =
  | { status: "loading" }
  | { status: "ready"; opportunityId: string | null }
  | { status: "error"; message: string };

export function useDealOpportunityId(routeId: string): DealOpportunityState {
  const [state, setState] = useState<DealOpportunityState>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    resolveDealCarrier<CarrierProcess>((u) => api.get(u), routeId)
      .then((c) => { if (alive) setState({ status: "ready", opportunityId: c.opportunityId }); })
      .catch((e) => { if (alive) setState({ status: "error", message: e instanceof Error ? e.message : "딜 정보를 불러오지 못했습니다." }); });
    return () => { alive = false; };
  }, [routeId]);
  return state;
}
