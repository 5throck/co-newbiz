// GET/POST /api/projects/[id]/wacc — Wave C1 WACC input session.
// GET exposes project-scoped WACC/hurdle provenance; POST records confirmed
// kind='user' rows through db/lib/wacc.ts, creating a versioned run snapshot.
import { getDb } from "../../../../../../../db/client.ts";
import { recordWaccSession, resolveProjectHurdleIrr, resolveProjectWacc } from "../../../../../../../db/lib/wacc.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

function parseRate(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n > -1 ? n : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();
  const wacc = resolveProjectWacc(db, id);
  const hurdle = resolveProjectHurdleIrr(db, id);
  return ok({ wacc, hurdle_irr: hurdle }, 200, { wacc_source: wacc.source, run_id: wacc.run_id ?? undefined });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "WACC 입력 세션은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    wacc?: unknown;
    hurdle_irr?: unknown;
    mode?: string;
    rationale?: string;
    anchor_ref?: string;
    as_of?: string;
  } | null;
  const wacc = parseRate(body?.wacc);
  if (wacc === null) return badRequest("invalid_request", "wacc는 -1보다 큰 유한한 비율이어야 합니다. 예: 0.095");
  const hasHurdle = body?.hurdle_irr !== undefined && body?.hurdle_irr !== null && body?.hurdle_irr !== "";
  const hurdleIrr = hasHurdle ? parseRate(body?.hurdle_irr) : null;
  if (hasHurdle && hurdleIrr === null) {
    return badRequest("invalid_request", "hurdle_irr는 -1보다 큰 유한한 비율이어야 합니다.");
  }
  try {
    const result = recordWaccSession(getDb(), {
      projectId: id,
      wacc,
      hurdleIrr,
      mode: body?.mode,
      rationale: body?.rationale,
      anchorRef: body?.anchor_ref,
      asOf: body?.as_of,
      actor: auth.auth.userId,
    });
    return ok(result, 201, { run_id: result.run_id, wacc_source: result.wacc.source });
  } catch (err) {
    return badRequest("wacc_session_failed", err instanceof Error ? err.message : "WACC 입력 세션 저장에 실패했습니다.");
  }
}
