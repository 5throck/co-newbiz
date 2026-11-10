// /opportunities — S2 flat route, server redirect shell (route-cleanup
// follow-up design §4.2; auto-redirect paths serverized by D5/B-2, design
// 2026-11-11-admin-security-and-board-fixes §7). Rules 1 and 3 resolve on the
// server; the picker, the ?new=1/?known_target=1 exemptions and the embedded
// funnel render stay client-side. The standalone /opportunities/[id] detail
// screen is unchanged (ADR-0127).
import { redirect } from "next/navigation";
import { CarrierGate } from "../../components/CarrierGate.tsx";
import { planCarrierPage, resolveCarriers } from "../../lib/carrier-resolve.ts";
import { getRscSession } from "../../lib/rsc-session.ts";
import { getDb } from "../../../../db/client.ts";

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const plan = planCarrierPage({
    route: "opportunities",
    query,
    session: await getRscSession(),
    resolve: () => resolveCarriers("opportunities", getDb()),
  });
  if (plan.kind === "redirect") redirect(plan.href);
  return <CarrierGate route="opportunities" initialRows={plan.rows} />;
}
