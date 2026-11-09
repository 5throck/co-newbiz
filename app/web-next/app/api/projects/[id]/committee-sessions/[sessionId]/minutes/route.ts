// Project-scoped committee minutes (ADR-0104 §minutes, ADR-0196 Phase E) —
// GET renders the meeting record: text/markdown by default (compat),
// ?format=json for the UI. A GET NEVER calls the LLM; it renders only what
// is stored. POST either confirms the chair's sign-off once (append-only,
// ADR-0104) or regenerates the AI-drafted draft (analyst+, audited, refused
// once confirmed — ADR-0196 decision 4).
import { committeeSessionForProject } from "../../../../../../../lib/committee-session.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import {
  buildCommitteeMinutes,
  buildCommitteeMinutesJson,
  confirmCommitteeMinutes,
} from "../../../../../../../lib/committee-scorecard.ts";
import { regenerateCommitteeMinutes } from "../../../../../../../lib/committee-session.ts";
import { badRequest, fail, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  {
    const denied = requireBusinessActor(auth.auth, "read");
    if (denied) return denied;
  }
  const { id, sessionId } = await params;
  if (!committeeSessionForProject(id, sessionId)) return notFound();
  if (!visibleProject(auth.auth, id, { includeClosed: true })) return notFound();
  const format = new URL(request.url).searchParams.get("format");
  if (format === "json") {
    const payload = buildCommitteeMinutesJson(getDb(), sessionId);
    if (payload === null) return notFound();
    return ok(payload, 200);
  }
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
  {
    const denied = requireBusinessActor(ctx, "write", {
      viewerMessage: "Minutes confirmation requires the analyst role or higher.",
    });
    if (denied) return denied;
  }
  const { id, sessionId } = await params;
  if (!committeeSessionForProject(id, sessionId)) return notFound();
  if (!visibleProject(ctx, id, { includeClosed: true })) return notFound();
  const body = (await request.json().catch(() => null)) as { confirm?: boolean; regenerate?: boolean } | null;
  if (body?.confirm === true && body.regenerate === true) {
    return badRequest("invalid_request", "Confirm and regenerate are mutually exclusive.");
  }
  if (body?.confirm === true) {
    try {
      confirmCommitteeMinutes(getDb(), sessionId, ctx.userId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Minutes confirmation failed.";
      if (message.includes("not found")) return notFound();
      if (message.includes("already confirmed")) return fail(409, "already_confirmed", message);
      return badRequest("minutes_confirm_failed", message);
    }
    appendAudit(getDb(), {
      actor: ctx.userId,
      action: "committee_minutes.confirm",
      target: sessionId,
      now: new Date().toISOString(),
    });
    return ok({ sessionId, confirmedBy: ctx.userId }, 200);
  }
  if (body?.regenerate === true) {
    try {
      const draft = await regenerateCommitteeMinutes(sessionId);
      appendAudit(getDb(), {
        actor: ctx.userId,
        action: "committee_minutes.regenerate",
        target: sessionId,
        now: new Date().toISOString(),
      });
      return ok({ sessionId, fallback: draft.fallback, inputHash: draft.input_hash, createdAt: draft.created_at }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Minutes regeneration failed.";
      if (message.includes("does not exist")) return notFound();
      if (message.includes("minutes are confirmed")) return fail(409, "minutes_already_confirmed", message);
      if (message.includes("regeneration is not applicable")) return fail(409, "regenerate_not_needed", message);
      return badRequest("minutes_regenerate_failed", message);
    }
  }
  return badRequest("invalid_request", 'The minutes POST takes {"confirm": true} or {"regenerate": true}.');
}
