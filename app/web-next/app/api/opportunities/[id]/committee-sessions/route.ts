// Committee sessions for one opportunity — steering-committee deliberation
// (ADR-0097 §5). Convening creates a process_run session and, in agent_team
// mode, runs the full deliberation engine (ADR-0096 runDeliberationRounds)
// with the pluggable member executor from lib/committee-agents.ts. The
// result is ALWAYS a PROPOSAL (gate_evaluation) — never a confirming record
// (design boundary #2; guarded by tests/unit/committee-boundary.test.ts).
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import {
  DECISION_MODES,
  CommitteeError,
  createCommitteeSession,
  listCommitteeSessions,
  runCommitteeSession,
  type DecisionMode,
} from "../../../../../lib/committee-session.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  {
    const denied = requireBusinessActor(auth.auth, "read");
    if (denied) return denied;
  }
  const { id } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();
  const sessions = listCommitteeSessions(id);
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
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();

  try {
    // Async convene contract: validate + create the session row fast (<100ms),
    // kick the deliberation off in the background (the Cloudflare tunnel's
    // ~100s proxy timeout makes a synchronous multi-minute LLM deliberation
    // structurally impossible), and return 202. The llm_required guard fired
    // inside createCommitteeSession BEFORE this point — a 202 is never
    // emitted for an unconfigured LLM.
    const created = createCommitteeSession(
      { entityType: "opportunity", entityId: id },
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
      target: `${id}:${created.sessionId}:${body.committeeKey}`,
      now: new Date().toISOString(),
    });
    if (created.convening) {
      // Fire-and-forget: runCommitteeSession marks meta.convening_error +
      // process_run.status 'failed' on failure (never hangs silently); this
      // catch only logs the rethrown error.
      void runCommitteeSession(created.sessionId).catch((err: unknown) => {
        console.error(`committee session ${created.sessionId} deliberation failed:`, err);
      });
      return ok(
        {
          sessionId: created.sessionId,
          committeeKey: created.committeeKey,
          decisionMode: created.decisionMode,
          status: "convening",
        },
        202,
      );
    }
    return ok(
      {
        sessionId: created.sessionId,
        committeeKey: created.committeeKey,
        decisionMode: created.decisionMode,
        status: "ready",
      },
      202,
    );
  } catch (err) {
    if (err instanceof CommitteeError) return badRequest(err.code, err.message);
    return badRequest("convene_failed", err instanceof Error ? err.message : String(err));
  }
}

type ConveneGate = "screening" | "pre_fs" | "target_screening" | "fs" | "dd" | "entity_ic" | "group_ic";
