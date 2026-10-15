// /api/projects/[id]/business-case/s5-reimport — human-triggered re-import of the S5
// investment plan into a fresh greenfield_cost model (ADR-0174). GET previews, POST applies:
// the previous active target-less greenfield_cost models are ARCHIVED (never deleted) in the
// same transaction. Existing cases are not recalculated; bc.investment_basis is never changed.
// Analyst+, deny-by-default visibility, Green Field only; agent principals are rejected (boundary #2).
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { currentPrincipal } from "../../../../../../lib/mcp/principal-context.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { fail, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../db/client.ts";
import { applyS5Reimport, previewS5Reimport, S5ReimportError } from "../../../../../../../../db/repositories/s5-cost-import.ts";

async function guard(request: Request, params: Promise<{ id: string }>) {
  const auth = authenticate(request);
  if (!auth.ok) return { response: auth.response };
  const ctx = auth.auth;
  if (currentPrincipal()) return { response: forbidden("human_only", "S5 투자 계획 다시 가져오기는 사람만 실행할 수 있습니다 (boundary #2).") };
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "S5 투자 계획 다시 가져오기는 analyst 역할 이상이어야 합니다." });
  if (denied) return { response: denied };
  const { id } = await params;
  if (!visibleProject(ctx, id)) return { response: notFound() };
  return { ctx, id };
}

function errorResponse(e: unknown) {
  if (e instanceof S5ReimportError) {
    if (e.code === "not_found") return notFound();
    return fail(409, e.code, e.message);
  }
  throw e;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(request, params);
  if ("response" in g) return g.response;
  try {
    return ok(previewS5Reimport(getDb(), g.id));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(request, params);
  if ("response" in g) return g.response;
  try {
    const result = applyS5Reimport(getDb(), g.id, g.ctx!.userId);
    return ok(result, 200, { imported: result.imported, archived: result.archived_model_ids.length });
  } catch (e) {
    return errorResponse(e);
  }
}
