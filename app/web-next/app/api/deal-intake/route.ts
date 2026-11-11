// Deal-board client-request intake (ADR-0197, migration 0190; design
// 2026-11-11-owner-decisions-intake-batch §3.4). One record of WHO asked for
// a deal review and through which board entry, created BEFORE the opportunity
// exists and linked to it later via the optional intake_id field on
// POST /api/opportunities. An intake is ordinary business write data — no
// bearer-token restriction here (unlike /api/tokens).
import { getDb } from "../../../../../db/client.ts";
import { appendAudit } from "../../../../../db/lib/access-control.ts";
import {
  DEAL_INTAKE_SOURCES,
  createDealIntake,
  type DealIntakeSource,
} from "../../../../../db/repositories/deal-intake.repository.ts";
import { authenticate, requireBusinessActor } from "../../../lib/auth.ts";
import { badRequest, ok } from "../../../lib/envelope.ts";

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  // Same gate as opportunity registration (analyst+). Viewers already see the
  // board with PrimaryAction blocked in-place, so this server gate is
  // defense-in-depth, not the primary UX.
  {
    const denied = requireBusinessActor(ctx, "write", {
      viewerMessage: "Recording a deal-request intake requires the analyst role.",
    });
    if (denied) return denied;
  }
  const body = (await request.json().catch(() => null)) as {
    source?: string;
    requested_by?: string;
    note?: string;
  } | null;
  // The CHECK on deal_intake.source is the DB backstop; validate first for a
  // typed envelope error.
  if (!body?.source || !(DEAL_INTAKE_SOURCES as readonly string[]).includes(body.source)) {
    return badRequest("invalid_request", `source must be one of ${DEAL_INTAKE_SOURCES.join("|")}.`);
  }
  const db = getDb();
  const now = new Date().toISOString();
  const id = createDealIntake(db, {
    source: body.source as DealIntakeSource,
    requestedBy: body.requested_by?.trim() || null,
    note: body.note?.trim() || null,
    createdBy: ctx.userId,
    now,
  });
  appendAudit(db, { actor: ctx.userId, action: "intake_created", target: `${id}:${body.source}`, now });
  return ok({ id }, 201);
}
