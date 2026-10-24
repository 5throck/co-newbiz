// POST /api/proposals — record a decision PROPOSAL (ADR-0154 §5, Wave M M-2).
// This is the only write path of the propose_* MCP tools. It writes the
// decision_proposal row (and an audit entry) and nothing else: no
// gate_decision / route_decision / adoption / selection / transition /
// charter-confirmation row is created here (boundary #2). A human confirms
// the proposal on /proposals/{id}/confirm in their own web session.
// GET lists the caller's own proposals (the propose tools' status view).
import { getDb } from "../../../../../db/client.ts";
import { appendAudit } from "../../../../../db/lib/access-control.ts";
import {
  PROPOSAL_KINDS,
  createProposal,
  listProposalsFor,
  type ProposalKind,
  type ProposalStatus,
} from "../../../../../db/repositories/decision-proposal.repository.ts";
import { authenticate, requireBusinessActor } from "../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../lib/envelope.ts";
import { currentPrincipal } from "../../../lib/mcp/principal-context.ts";
import { confirmUrl, entityTypeFor, stageFor, validatePayload } from "../../../lib/proposals.ts";
import { visibleProject } from "../../../lib/project-visibility.ts";
import { route } from "../../../lib/route.ts";

const STATUSES = new Set(["pending", "confirmed", "rejected", "expired", "superseded"]);

export const GET = route(async (request: Request) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "read"); if (denied) return denied; }
  const status = new URL(request.url).searchParams.get("status");
  if (status && !STATUSES.has(status)) return badRequest("invalid_request", "status must be pending|confirmed|rejected|expired|superseded.");
  const rows = listProposalsFor(auth.auth.userId, { status: (status as ProposalStatus | null) ?? undefined });
  return ok(rows.map((p) => ({ ...p, confirm_url: confirmUrl(request, p.id) })), 200, { count: rows.length });
});

export const POST = route(async (request: Request) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "Decision proposals require the analyst role or higher." }); if (denied) return denied; }
  // An OAuth-delegated principal needs the dedicated 'propose' scope; 'write'
  // alone never creates a proposal and no scope executes a decision.
  const delegated = currentPrincipal();
  if (delegated && !delegated.scopes.includes("propose")) {
    return forbidden("insufficient_scope", "This token lacks the 'propose' scope required to record a decision proposal.");
  }

  const body = (await request.json().catch(() => null)) as {
    kind?: string; entity_id?: string; payload?: unknown; rationale?: string; evidence_refs?: unknown;
  } | null;
  if (!body?.kind || !(PROPOSAL_KINDS as readonly string[]).includes(body.kind)) {
    return badRequest("invalid_request", `kind must be one of ${PROPOSAL_KINDS.join("|")}.`);
  }
  const kind = body.kind as ProposalKind;
  const entityId = body.entity_id?.trim();
  if (!entityId) return badRequest("invalid_request", "entity_id is required.");

  const validated = validatePayload(kind, body.payload);
  if (!validated.ok) return badRequest("invalid_payload", validated.message);
  const payload = validated.payload;

  const rationale = (body.rationale ?? (typeof payload.rationale === "string" ? payload.rationale : "")).trim();
  if (!rationale) return badRequest("invalid_request", "rationale is required — a proposal without its reasoning cannot be reviewed.");
  const refs = body.evidence_refs;
  if (refs !== undefined && (!Array.isArray(refs) || refs.length > 20 || refs.some((r) => typeof r !== "string" || r.length > 500))) {
    return badRequest("invalid_request", "evidence_refs must be an array of at most 20 strings.");
  }

  const entityType = entityTypeFor(kind, payload);
  const db = getDb();
  if (entityType === "project") {
    if (!visibleProject(ctx, entityId)) return notFound();
  } else if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(entityId)) {
    return notFound();
  }

  const now = new Date().toISOString();
  const proposal = createProposal({
    kind, entityType, entityId, stageId: stageFor(kind, payload), payload, rationale,
    evidenceRefs: (refs as string[] | undefined) ?? [], proposedByUserId: ctx.userId,
    viaClientId: delegated?.clientId ?? null, supersedeKey: kind === "gate_decision" ? String(payload.gate) : null, now,
  });
  appendAudit(db, { actor: ctx.userId, action: "decision_proposal.create", target: `${kind}:${proposal.id}`, now });
  return ok(
    { proposal_id: proposal.id, kind, status: proposal.status, expires_at: proposal.expires_at, confirm_url: confirmUrl(request, proposal.id) },
    201,
  );
});
