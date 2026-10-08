// RAG proposal recompute (Wave F-5, design 2026-10-08-wave-f-process-closure §5).
// Explicit, idempotent refresh of the AI-proposed RAG: gathers the persisted
// inputs, hashes them, and appends rag_assessment rows when anything changed.
// The grade is a PROPOSAL — nothing here records a gate decision or approval
// (boundary #2); it runs as the calling user (boundary #1), and the
// data-confidence grade from the S1 sizing (migration 0125) caps it
// (boundary #4). analyst+ only (viewer is read-only).
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { recomputeRag, readRagView } from "../../../../../../../../db/lib/rag-service.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { route } from "../../../../../../lib/route.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "RAG 재산출은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id, { includeClosed: true, includeDeleted: true })) return notFound();

  const db = getDb();
  const result = recomputeRag(db, id, "manual", { actor: ctx.userId });
  appendAudit(db, { actor: ctx.userId, action: "rag_recompute", target: `${id}:manual`, now: new Date().toISOString() });
  const view = readRagView(db, id);
  return ok({
    result: {
      status: result.status,
      run_id: result.runId,
      complete: result.complete,
      overall: result.overall,
      stage_gate: result.stageGate,
      data_confidence_grade: result.dataConfidenceGrade,
    },
    rag: {
      status: view.status,
      overall: view.overall,
      dimensions: view.dimensions,
      missing_dimensions: view.missing_dimensions,
      assessed_at: view.assessed_at,
      isProposal: true,
    },
  });
});
