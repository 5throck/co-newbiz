// /api/proposals/[id]/confirm — the human confirmation of a decision proposal
// (ADR-0154 §5, design §6.3, Wave M M-2).
//
//   GET  — session cookie ONLY: the proposal, the AI-proposed RAG grade (the
//          review buckets come from the reviews route), and a single-use
//          confirm nonce. Loading the view is the "show the payload first"
//          step; nothing is decided by loading it.
//   POST — session cookie ONLY: {nonce, payload?}. Runs the EXISTING decision
//          route in the human's own session (cookie + CSRF + Origin forwarded),
//          so normal role checks apply: a confirmer without gate authority
//          gets that route's 403 and the proposal stays pending. The decision
//          row's decider is the human, never the proposing token.
//
// A bearer token — OAuth-delegated or personal — is refused outright: an agent
// can propose but never confirm (boundary #2), and an elicitation answer
// arriving through the agent's client cannot prove a human web session.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { readRagView } from "../../../../../../../db/lib/rag-service.ts";
import {
  claimConfirmNonce,
  getProposal,
  issueConfirmNonce,
  markConfirmed,
  type DecisionProposal,
} from "../../../../../../../db/repositories/decision-proposal.repository.ts";
import { AGENT_KEYS } from "../../../../../lib/agent-registry.generated.ts";
import { authenticate, requireBusinessActor, type AuthContext } from "../../../../../lib/auth.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import {
  entityTypeFor,
  executeTarget,
  proposalVisible,
  recordIdOf,
  targetFor,
  validatePayload,
} from "../../../../../lib/proposals.ts";
import { route } from "../../../../../lib/route.ts";

type Params = { params: Promise<{ id: string }> };

function humanSession(request: Request): { ctx: AuthContext } | { response: Response } {
  const auth = authenticate(request);
  if (!auth.ok) return { response: auth.response };
  const ctx = auth.auth;
  if (ctx.via !== "cookie") {
    return { response: forbidden("session_required", "A proposal can be confirmed only from a logged-in human web session; tokens may propose but never confirm.") };
  }
  if (AGENT_KEYS.has(ctx.userId)) {
    return { response: forbidden("agent_forbidden", "An agent identity cannot confirm a decision proposal (boundary #1/#2).") };
  }
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "Decision confirmation requires the analyst role or higher." });
  if (denied) return { response: denied };
  return { ctx };
}

function ragContext(p: DecisionProposal) {
  // The AI-proposed RAG grade rides along for project decisions; the review
  // buckets are rendered by the page's shared ReviewBuckets component.
  if (p.entity_type !== "project") return null;
  try {
    return readRagView(getDb(), p.entity_id);
  } catch {
    return null;
  }
}

export const GET = route(async (request: Request, { params }: Params) => {
  const session = humanSession(request);
  if ("response" in session) return session.response;
  const { id } = await params;
  const p = getProposal(id);
  if (!p || !proposalVisible(session.ctx, p)) return notFound();
  const nonce = p.status === "pending" ? issueConfirmNonce(p.id) : null;
  return ok({ proposal: p, confirm_nonce: nonce, rag: ragContext(p) });
});

export const POST = route(async (request: Request, { params }: Params) => {
  const session = humanSession(request);
  if ("response" in session) return session.response;
  const ctx = session.ctx;
  const { id } = await params;
  const p = getProposal(id);
  if (!p || !proposalVisible(ctx, p)) return notFound();
  if (p.status !== "pending") {
    return fail(409, `proposal_${p.status}`, p.status === "expired" ? "This proposal has expired; ask for a new one." : `This proposal is already ${p.status}.`);
  }

  const body = (await request.json().catch(() => null)) as { nonce?: string; payload?: unknown; goals_ack?: { acknowledged?: unknown; note?: unknown } } | null;
  if (!body?.nonce) return badRequest("invalid_request", "nonce is required — load the confirmation view first.");

  // The human may edit before confirming; the edited payload must satisfy the
  // same contract and address the same carrier.
  let payload = p.payload;
  if (body.payload !== undefined) {
    const validated = validatePayload(p.kind, body.payload);
    if (!validated.ok) return badRequest("invalid_payload", validated.message);
    if (entityTypeFor(p.kind, validated.payload) !== p.entity_type) {
      return badRequest("invalid_payload", "The edit moves the decision to a different carrier; propose it again instead.");
    }
    payload = validated.payload;
  }

  // ADR-0159: the no-goals acknowledgement is the HUMAN's, supplied at confirm
  // time (never part of the agent's stored proposal) and forwarded to adopt.
  if (p.kind === "case_adoption" && body.goals_ack && typeof body.goals_ack === "object") {
    payload = { ...payload, goals_ack: { acknowledged: body.goals_ack.acknowledged === true, ...(typeof body.goals_ack.note === "string" ? { note: body.goals_ack.note } : {}) } };
  }

  if (!claimConfirmNonce(p.id, body.nonce)) {
    return fail(409, "confirm_nonce_invalid", "The confirmation view is stale or was already used — reload it and review the proposal again.");
  }

  const target = targetFor(p.kind, p.entity_type, p.entity_id, payload);
  const res = await executeTarget(request, target, p.entity_id);
  const text = await res.text();
  if (!res.ok) {
    // The decision route refused (role, validation, state): nothing was
    // decided, the proposal stays pending, the route's own envelope is relayed.
    return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
  }
  const envelope = JSON.parse(text) as { data?: unknown };
  const resultingId = recordIdOf(envelope.data);
  const now = new Date().toISOString();
  markConfirmed(p.id, { confirmedByUserId: ctx.userId, confirmedPayload: payload, resultingRecordId: resultingId, now });
  appendAudit(getDb(), { actor: ctx.userId, action: "decision_proposal.confirm", target: `${p.kind}:${p.id}`, now });
  return ok({ proposal_id: p.id, status: "confirmed", resulting_record_id: resultingId, result: envelope.data ?? null });
});
