// Project-scoped committee sessions (ADR-0196 committee-minutes-as-meeting,
// Phase E — entity-IC and group-IC review as committee sessions, design
// §7.2). IC gates are project-scoped, so this surface mirrors the
// opportunity-side routes with entity_type='project' process_run rows.
// The result is ALWAYS a PROPOSAL (gate_evaluation) — never a confirming
// record (design boundary #2).
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import {
  DECISION_MODES,
  CommitteeError,
  conveneCommitteeSession,
  listCommitteeSessions,
  type DecisionMode,
} from "../../../../../lib/committee-session.ts";

type ConveneGate = "screening" | "pre_fs" | "target_screening" | "fs" | "dd" | "entity_ic" | "group_ic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  {
    const denied = requireBusinessActor(auth.auth, "read");
    if (denied) return denied;
  }
  const { id } = await params;
  const project = visibleProject(auth.auth, id, { includeClosed: true });
  if (!project) return notFound();
  const sessions = listCommitteeSessions(id, "project");
  return ok({ sessions }, 200, { count: sessions.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  {
    const denied = requireBusinessActor(ctx, "write", {
      viewerMessage: "Committee convening requires the analyst role or higher.",
    });
    if (denied) return denied;
  }
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    committeeKey?: string;
    decisionMode?: string;
    gate?: string;
    targetRef?: string;
    track?: string;
    briefMd?: string;
  } | null;
  if (!body?.committeeKey || typeof body.committeeKey !== "string") {
    return badRequest("invalid_request", "committeeKey is required.");
  }
  if (!body.decisionMode || !DECISION_MODES.includes(body.decisionMode as DecisionMode)) {
    return badRequest("invalid_request", `decisionMode must be one of: ${DECISION_MODES.join(" | ")}.`);
  }
  if (
    body.gate !== undefined &&
    !["screening", "pre_fs", "target_screening", "fs", "dd", "entity_ic", "group_ic"].includes(body.gate)
  ) {
    return badRequest(
      "invalid_request",
      "gate must be one of: screening | pre_fs | target_screening | fs | dd | entity_ic | group_ic.",
    );
  }
  const db = getDb();
  const project = visibleProject(ctx, id, { includeClosed: true });
  if (!project) return notFound();

  try {
    const result = await conveneCommitteeSession(
      { entityType: "project", entityId: id },
      {
        committeeKey: body.committeeKey,
        decisionMode: body.decisionMode as DecisionMode,
        gate: body.gate as ConveneGate | undefined,
        targetRef: body.targetRef?.trim() || undefined,
        track: body.track?.trim() || undefined,
        briefMd: body.briefMd?.trim() || undefined,
        actor: ctx.userId,
        source: "web",
      },
    );
    appendAudit(db, {
      actor: ctx.userId,
      action: "committee_session.convene",
      target: `${id}:${result.sessionId}:${body.committeeKey}`,
      now: new Date().toISOString(),
    });
    return ok(result, 201);
  } catch (err) {
    if (err instanceof CommitteeError) return badRequest(err.code, err.message);
    return badRequest("convene_failed", err instanceof Error ? err.message : String(err));
  }
}
