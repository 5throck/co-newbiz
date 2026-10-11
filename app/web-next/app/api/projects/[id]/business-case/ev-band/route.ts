// Human-only EV/Revenue band confirmation (design 2026-10-11-s8-ev-band-user-
// confirmed, boundary #2). Analyst+ only; listed in HUMAN_ONLY_ROUTES so the
// MCP in-process port refuses it for agent callers. Overwrite-only: each call
// writes a new run holding the min/max pair (latest complete pair wins).
// recordAssumption appends the standard assumption_set audit entries.
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import {
  EvBandValidationError,
  evRevenueBandPayload,
  recordEvRevenueBand,
  resolveConfirmedEvBand,
  validateEvBandInput,
} from "../../../../../../lib/business-case-generator.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "EV/Revenue 밴드 확정은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const v = validateEvBandInput({ min: body?.min, max: body?.max, rationale: body?.rationale, source: body?.source });
    const result = await recordEvRevenueBand(getDb(), { projectId: id, ...v, actor: auth.auth.userId });
    return ok({ run_id: result.run_id, evRevenueBand: evRevenueBandPayload(resolveConfirmedEvBand(getDb(), id)) }, 201);
  } catch (err) {
    if (err instanceof EvBandValidationError) return badRequest("invalid_request", err.message);
    console.error("ev-band save failed", err);
    return fail(500, "internal_error", "밴드 저장에 실패했습니다.");
  }
}
