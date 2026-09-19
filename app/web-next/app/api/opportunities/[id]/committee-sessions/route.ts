// Committee sessions for one opportunity — steering-committee deliberation
// (ADR-0097 §5). Convening creates a process_run session and, in agent_team
// mode, runs the full deliberation engine (ADR-0096 runDeliberationRounds)
// with the pluggable member executor from lib/committee-agents.ts. The
// result is ALWAYS a PROPOSAL (gate_evaluation) — never a confirming record
// (design boundary #2; guarded by tests/unit/committee-boundary.test.ts).
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../db/client.ts";
import { DECISION_MODES, CommitteeError, conveneCommitteeSession, listCommitteeSessions, type DecisionMode } from "../../../../../lib/committee-session.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
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
  if (ctx.role === "viewer") return forbidden("role_required", "위원회 소집은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    committeeKey?: string; decisionMode?: string; gate?: string; targetRef?: string; track?: string; briefMd?: string;
  } | null;
  if (!body?.committeeKey || typeof body.committeeKey !== "string") {
    return badRequest("invalid_request", "committeeKey는 필수입니다.");
  }
  if (!body.decisionMode || !DECISION_MODES.includes(body.decisionMode as DecisionMode)) {
    return badRequest("invalid_request", `decisionMode는 ${DECISION_MODES.join(" | ")} 중 하나입니다.`);
  }
  if (body.gate !== undefined && !["screening", "pre_fs", "target_screening", "fs", "dd", "entity_ic", "group_ic"].includes(body.gate)) {
    return badRequest("invalid_request", "gate는 screening | pre_fs | target_screening | fs | dd | entity_ic | group_ic 중 하나입니다.");
  }
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();

  try {
    const result = await conveneCommitteeSession(
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
    return ok(result, 201);
  } catch (err) {
    if (err instanceof CommitteeError) return badRequest(err.code, err.message);
    return badRequest("convene_failed", err instanceof Error ? err.message : String(err));
  }
}

type ConveneGate = "screening" | "pre_fs" | "target_screening" | "fs" | "dd" | "entity_ic" | "group_ic";
