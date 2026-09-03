// POST /api/projects/[id]/business-case/adopt — human-only case adoption
// (ADR-0098 §2, design boundary #2). Generation may flag a case RECOMMENDED;
// which case feeds the fs gate is investment judgment and belongs to a human.
// This endpoint is the ONLY writer of the s8_case_adopt adoption marker —
// the generation engine never writes it (regression:
// tests/unit/business-case.test.ts). Analyst+; deny-by-default visibility.
import { authenticate } from "../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { adoptBusinessCase } from "../../../../../../lib/business-case.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "사업 채택(adopt)은 analyst 역할 이상이어야 합니다 — 채택은 인간의 판단입니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { model_id?: string } | null;
  if (!body?.model_id) return badRequest("invalid_request", "model_id는 필수입니다.");
  try {
    const adoption = adoptBusinessCase(id, body.model_id, ctx.userId);
    return ok(adoption, 201);
  } catch {
    return notFound();
  }
}
