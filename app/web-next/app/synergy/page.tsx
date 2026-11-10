// /synergy — S3 flat route, server redirect shell (route-cleanup follow-up
// design §4.2; auto-redirect paths serverized by D5/B-2, design
// 2026-11-11-admin-security-and-board-fixes §7). Rules 1 and 3 resolve on the
// server; the picker stays client-side. The real S3 screen is the
// /deals/{id}/s3 tab (shared SynergyStage component); the S3 자회사 프로파일
// 화면(/our-company)은 별도 라우트로 유지된다.
import { redirect } from "next/navigation";
import { CarrierGate } from "../../components/CarrierGate.tsx";
import { planCarrierPage, resolveCarriers } from "../../lib/carrier-resolve.ts";
import { getRscSession } from "../../lib/rsc-session.ts";
import { getDb } from "../../../../db/client.ts";

export default async function SynergyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const plan = planCarrierPage({
    route: "synergy",
    query,
    session: await getRscSession(),
    resolve: () => resolveCarriers("synergy", getDb()),
  });
  if (plan.kind === "redirect") redirect(plan.href);
  return <CarrierGate route="synergy" initialRows={plan.rows} />;
}
