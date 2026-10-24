// 보정 사이클 오케스트레이터 — 제안 수용(사람 확인) → 병렬 실행 계층에 재분석
// 작업 제출까지를 하나의 진입점으로 (design §5 3단계, 경계 #2: 수용은 사람,
// 계층은 실행만). 워커(job-worker)가 작업을 소화한다.
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../db/client.ts";
import { submitJob } from "../../../../../../lib/execution-jobs.ts";
import { decideCalibrationDriver } from "../../../../../../lib/market-calibration.ts";

export async function POST(request: Request, { params }: { params: Promise<{ industryId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Calibration cycles require the analyst role or higher." });
  if (denied) return denied;
  const { industryId } = await params;
  const body = (await request.json().catch(() => null)) as { acceptProposals?: boolean } | null;
  const db = getDb();
  if (!db.query("SELECT id FROM md_industry WHERE id = ?").get(industryId)) return notFound();

  let accepted = 0;
  if (body?.acceptProposals) {
    const rows = db
      .query("SELECT id FROM industry_driver_calibration WHERE industry_id = ? AND status = 'proposed'")
      .all(industryId) as Array<{ id: string }>;
    for (const r of rows) {
      decideCalibrationDriver(db, r.id, "accept", auth.auth.userId);
      accepted += 1;
    }
  }
  const analyses = db
    .query("SELECT id FROM market_sizing_analysis WHERE industry_id = ? AND status = 'completed' ORDER BY created_at ASC")
    .all(industryId) as Array<{ id: string }>;
  const jobs = analyses.map((a) =>
    submitJob(db, {
      kind: "market-sizing.rerun",
      payload: { analysisId: a.id },
      resourceClass: "llm",
      createdBy: auth.auth.userId,
      timeoutSec: 1800,
    }),
  );
  return ok({ acceptedProposals: accepted, jobs: jobs.map((j) => ({ id: j.id, status: j.status })) }, 200);
}
