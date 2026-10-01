"use client";

// /opportunities — S2 flat route, now a redirect stub (route-cleanup follow-up
// design §4.2). The real S2 funnel is the /deals/{id}/s2 tab. The standalone
// /opportunities/[id] detail screen is unchanged (ADR-0127).
import { CarrierGate } from "../../components/CarrierGate.tsx";

export default function OpportunitiesPage() {
  return <CarrierGate route="opportunities" />;
}
