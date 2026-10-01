"use client";

// /market — S1 flat route, now a redirect stub (route-cleanup follow-up design
// §4.2, docs/designs/2026-10-02-route-cleanup-followup-design.md). The real S1
// screen is the /deals/{id}/s1 tab (shared MarketAnalysisStage component).
// CarrierGate resolves the deal carrier (query param → auto → picker) and
// redirects there; bare /market no longer renders the S1 screen itself.
import { CarrierGate } from "../../components/CarrierGate.tsx";

export default function MarketPage() {
  return <CarrierGate route="market" />;
}
