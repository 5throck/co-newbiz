// Pipeline start (ADR-0102 §3) — the "산업 선정 + 계열사 결정" trigger.
// The opportunity must already exist (creation stays with the discover flow);
// this route validates both ids against md_industry/md_company, rejects a
// second active run for the entity, and kicks the first advancePipeline pass
// synchronously (subsequent passes come from the watch:run resume pass,
// ADR-0019 — no in-process timers). Analyst+ role floor, consistent with the
// other opportunity write routes.
import { getDb } from "../../../../../../../../db/client.ts";
import { startPipeline, advancePipeline, PipelineError } from "../../../../../../../../app/web-next/lib/pipeline.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "파이프라인 시작은 analyst 역할 이상이어야 합니다." }); if (denied) return denied; }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    industry_id?: string;
    initiating_company_id?: string;
  } | null;
  const industryId = body?.industry_id?.trim();
  const companyId = body?.initiating_company_id?.trim();
  if (!industryId || !companyId) {
    return badRequest("invalid_request", "industry_id와 initiating_company_id는 모두 필수입니다 (산업 선정 + 계열사 결정).");
  }

  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();

  let run;
  try {
    run = startPipeline({
      entityType: "opportunity",
      entityId: id,
      industryId,
      initiatingCompanyId: companyId,
      startedBy: ctx.userId,
    });
  } catch (err) {
    if (err instanceof PipelineError) {
      if (err.code === "not_found") return notFound();
      return badRequest(err.code, err.message);
    }
    return badRequest("pipeline_start_failed", err instanceof Error ? err.message : "파이프라인을 시작할 수 없습니다.");
  }

  // First synchronous pass; the run lands in its terminal-for-now state
  // (paused_for_human on the first human gate, or completed/failed/killed).
  const result = await advancePipeline(run.id, { actor: ctx.userId });
  return ok({ pipelineRunId: result.run.id, status: result.run.status, actions: result.actions }, 200);
}
