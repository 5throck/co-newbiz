"use client";

// /greenfield — S5 flat route, now a redirect stub (route-cleanup follow-up
// design §4.2). The real S5 screen is the /deals/{id}/s5 tab (shared
// GreenfieldStage component). CarrierGate auto-resolves greenfield-track
// carriers only.
import { CarrierGate } from "../../components/CarrierGate.tsx";

export default function GreenfieldPage() {
  return <CarrierGate route="greenfield" />;
}
