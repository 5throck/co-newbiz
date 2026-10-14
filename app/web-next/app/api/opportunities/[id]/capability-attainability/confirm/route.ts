// POST /api/opportunities/[id]/capability-attainability/confirm — HUMAN-ONLY (ADR-0168 D1, ADR-0171,
// boundary #2). A person confirms the attainability judgements they (or an agent draft) recorded
// on S5: sets confirmedBy/confirmedAt on judged rows. Cookie session of a non-agent account only;
// bearer / OAuth-delegated MCP / agent callers get 403 human_only (also in HUMAN_ONLY_ROUTES).
// Body: { row_ids?: string[] } (default: every judged, unconfirmed row). analyst+.
// A row with a 해소 방식 needs a 기대 수준 (400 expected_level_required, ADR-0172 OD-7);
// a stale row needs a fresh save first (400 stale_requires_rejudge). Audit
// capability_attainability.confirm, target "<opportunityId>#capability@<via>:surface=S5".
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate, callPathOf, humanOnlyDenied, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, fail, notFound, ok } from "../../../../../../lib/envelope.ts";
import { buildAttainabilityView, confirmAndWrite, readRegister } from "../../../../../../lib/capability-attainability.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = humanOnlyDenied(ctx, "필요 역량 달성 가능성의 확정은 사람만 할 수 있습니다 (boundary #2) — 에이전트는 초안만 저장합니다.");
  if (denied) return denied;
  { const d = requireBusinessActor(ctx, "write", { viewerMessage: "달성 가능성 확정은 analyst 역할 이상이어야 합니다." }); if (d) return d; }
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { row_ids?: unknown } | null;
  if (body?.row_ids != null && (!Array.isArray(body.row_ids) || body.row_ids.some((x) => typeof x !== "string"))) return badRequest("invalid_request", "row_ids는 문자열 배열입니다.");
  const db = getDb();
  if (!readRegister(db, id)) return notFound();
  const at = new Date().toISOString();
  const res = confirmAndWrite(db, id, (body?.row_ids as string[] | undefined) ?? null, ctx.userId, { action: "capability_attainability.confirm", target: `${id}#capability@${callPathOf(ctx)}:surface=S5`, at });
  if (!res.ok) return res.error.code === "nothing_to_confirm" ? fail(409, res.error.code, res.error.message) : badRequest(res.error.code, res.error.message);
  return ok({ ...buildAttainabilityView(id, res.rows, at, res.removed), confirmed: res.confirmedIds.length }, 200);
}
