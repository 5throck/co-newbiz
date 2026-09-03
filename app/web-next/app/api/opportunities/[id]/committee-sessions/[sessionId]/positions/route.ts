// Human-member position submission for a committee session (ADR-0097 §5).
// The 0065 member_type='human' seat: in human_only / hybrid modes, human
// members deliberate alongside (or instead of) agents. The submitter's
// app_user id is taken from the authenticated session — never from the body.
import { authenticate } from "../../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../../db/client.ts";
import { CommitteeError, submitHumanPosition } from "../../../../../../../lib/committee-session.ts";

const RECOMMENDATIONS = new Set(["go", "hold", "kill"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "위원회 입장 제출은 analyst 역할 이상이어야 합니다.");
  const { id, sessionId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    seat?: string; positionMd?: string; confidence?: number; recommendation?: string; vetoDissent?: boolean;
  } | null;
  const positionMd = body?.positionMd?.trim();
  if (!positionMd) return badRequest("invalid_request", "positionMd(입장 내용)는 필수입니다.");
  if (body?.recommendation !== undefined && !RECOMMENDATIONS.has(body.recommendation)) {
    return badRequest("invalid_request", "recommendation은 go | hold | kill 중 하나입니다.");
  }
  const confidence = body?.confidence;
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 100)) {
    return badRequest("invalid_request", "confidence는 0–100 사이 숫자입니다.");
  }
  try {
    const result = submitHumanPosition({
      sessionId,
      humanUserId: ctx.userId, // from the session — never the request body
      seat: body?.seat?.trim() || undefined,
      positionMd,
      confidence,
      recommendation: body?.recommendation as "go" | "hold" | "kill" | undefined,
      vetoDissent: body?.vetoDissent === true,
    });
    return ok(result, 201);
  } catch (err) {
    if (err instanceof CommitteeError) {
      if (err.code === "not_found") return notFound();
      return badRequest(err.code, err.message);
    }
    return badRequest("submit_failed", err instanceof Error ? err.message : String(err));
  }
}
