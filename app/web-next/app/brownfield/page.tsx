"use client";

// /brownfield — S6/S7 flat route, now a redirect stub (route-cleanup follow-up
// design §4.2). The real screens are the /deals/{id}/s6 (and s7, reachable from
// the tab bar) tabs. CarrierGate auto-resolves brownfield-track carriers only.
import { CarrierGate } from "../../components/CarrierGate.tsx";

export default function BrownfieldPage() {
  return <CarrierGate route="brownfield" />;
}
