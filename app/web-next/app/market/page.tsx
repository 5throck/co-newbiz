// /market — S1 flat route, server redirect shell (route-cleanup follow-up
// design §4.2; auto-redirect paths serverized by D5/B-2, design
// 2026-11-11-admin-security-and-board-fixes §7). Rules 1 (query carrier) and 3
// (single-carrier auto) resolve on the server before any HTML is served; the
// picker and the embedded S1 render stay client-side in CarrierGate.
import { redirect } from "next/navigation";
import { CarrierGate } from "../../components/CarrierGate.tsx";
import { planCarrierPage, resolveCarriers } from "../../lib/carrier-resolve.ts";
import { getRscSession } from "../../lib/rsc-session.ts";
import { getDb } from "../../../../db/client.ts";

export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const plan = planCarrierPage({
    route: "market",
    query,
    session: await getRscSession(),
    resolve: () => resolveCarriers("market", getDb()),
  });
  if (plan.kind === "redirect") redirect(plan.href);
  return <CarrierGate route="market" initialRows={plan.rows} />;
}
