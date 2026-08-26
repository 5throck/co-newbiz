// Port of app/server/index.ts's GET /api/health — no auth, ADR-0014's
// post-deploy health-check target (docs/runbooks/deployment.md §4).
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok" });
}
