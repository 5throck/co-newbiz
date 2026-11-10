// /brownfield — S6/S7 flat route, server redirect shell (route-cleanup
// follow-up design §4.2; auto-redirect paths serverized by D5/B-2, design
// 2026-11-11-admin-security-and-board-fixes §7). Rules 1 and 3 resolve on the
// server; the picker stays client-side. CarrierGate auto-resolves
// brownfield-track carriers only (route_decision track filter).
import { redirect } from "next/navigation";
import { CarrierGate } from "../../components/CarrierGate.tsx";
import { planCarrierPage, resolveCarriers } from "../../lib/carrier-resolve.ts";
import { getRscSession } from "../../lib/rsc-session.ts";
import { getDb } from "../../../../db/client.ts";

export default async function BrownfieldPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const plan = planCarrierPage({
    route: "brownfield",
    query,
    session: await getRscSession(),
    resolve: () => resolveCarriers("brownfield", getDb()),
  });
  if (plan.kind === "redirect") redirect(plan.href);
  return <CarrierGate route="brownfield" initialRows={plan.rows} />;
}
