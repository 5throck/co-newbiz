// GET/POST /api/opportunities/[id]/review-acks — the opportunity-carrier twin
// of the project review-acks route (S1–S7 gates; migration 0165, ADR-0182 §5
// addendum). Same contract: latest acknowledgement per claim, analyst+ writes,
// audited review_claim_ack.recorded.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { isValidAckGate, listClaimAcks, recordClaimAck, type AckEntityType } from "../../../../../lib/review/claim-acks.ts";
import { route } from "../../../../../lib/route.ts";

const GATE_MESSAGE = `gate는 검토 게이트(screening·pre_fs·fs·dd·entity_ic·group_ic·transition) 또는 단계 산출물 키(stage:S#:N)여야 합니다.`;

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!getDb().query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();
  const gate = new URL(request.url).searchParams.get("gate") ?? "";
  if (!isValidAckGate(gate)) return badRequest("invalid_request", GATE_MESSAGE);
  const acks = listClaimAcks(getDb(), "opportunity" as AckEntityType, id, gate);
  return ok({ acks }, 200, { count: acks.length });
});

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "사람 확인 기록은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { id } = await params;
  if (!getDb().query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();
  const body = (await request.json().catch(() => null)) as { gate?: unknown; claim?: unknown; acked?: unknown; note?: unknown } | null;
  const gate = typeof body?.gate === "string" ? body.gate : "";
  if (!isValidAckGate(gate)) return badRequest("invalid_request", GATE_MESSAGE);
  if (typeof body?.claim !== "string" || !body.claim.trim()) return badRequest("invalid_request", "claim은 필수입니다.");
  if (typeof body?.acked !== "boolean") return badRequest("invalid_request", "acked는 boolean이어야 합니다.");
  const ack = recordClaimAck(getDb(), {
    entityType: "opportunity", entityId: id, gate, claim: body.claim, acked: body.acked,
    note: typeof body.note === "string" ? body.note : null, by: auth.auth.userId,
  });
  return ok(ack, 201);
});
