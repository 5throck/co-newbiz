// Committee minutes (ADR-0104 §minutes) — GET renders the deterministic
// Markdown meeting record (seat scorecard, position record, chair synthesis,
// gate link) as text/markdown; POST records the chair's sign-off once
// (append-only, recorded in process_run meta).
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { buildCommitteeMinutes, confirmCommitteeMinutes } from "../../../../../../../lib/committee-scorecard.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "read"); if (denied) return denied; }
  const { sessionId } = await params;
  const minutes = buildCommitteeMinutes(getDb(), sessionId);
  if (minutes === null) return notFound();
  return new Response(minutes, {
    status: 200,
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "회의록 확정은 analyst 역할 이상이어야 합니다." }); if (denied) return denied; }
  const { id, sessionId } = await params;
  if (!getDb().query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();
  const body = (await request.json().catch(() => null)) as { confirm?: boolean } | null;
  if (body?.confirm !== true) {
    return badRequest("invalid_request", '회의록 확정은 {"confirm": true} 본문이 필요합니다.');
  }
  try {
    confirmCommitteeMinutes(getDb(), sessionId, ctx.userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Minutes confirmation failed.";
    if (message.includes("not found")) return notFound();
    if (message.includes("already confirmed")) return fail(409, "already_confirmed", message);
    return badRequest("minutes_confirm_failed", message);
  }
  appendAudit(getDb(), { actor: ctx.userId, action: "committee_minutes.confirm", target: sessionId, now: new Date().toISOString() });
  return ok({ sessionId, confirmedBy: ctx.userId }, 200);
}
