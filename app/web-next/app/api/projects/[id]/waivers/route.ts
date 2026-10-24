// Waiver lifecycle for one project — S9 dd-waiver-review surface
// (skills/waiver-management; engine db/lib/compliance.ts). GET lists with the
// date-authoritative effective status (ADR-0036 — expiry is derived at read
// time, never rewritten); POST files a request. A waiver is a HUMAN-owned
// instrument (boundary #2): approval routing (Group IC / PGM / domain lead by
// layer) is process discipline recorded via the PATCH decision route.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { issueWaiver, listProjectWaivers } from "../../../../../../../db/lib/compliance.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { scopeOrResponse } from "../../../../../lib/dd-target-http.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();
  // ADR-0157: ?target_id= selects a comparison target; omitted = the selected/legacy scope.
  const scope = scopeOrResponse(id, new URL(request.url).searchParams.get("target_id"));
  if ("response" in scope) return scope.response;
  const waivers = listProjectWaivers(db, { projectId: id, now: new Date().toISOString(), targetId: scope.targetId });
  // Reference list for the request form's doc select — policy documents are
  // not MNPI; the admin console stays the full management surface.
  const governanceDocs = db
    .query("SELECT id, layer, key, title FROM governance_doc ORDER BY layer, key")
    .all() as Array<{ id: string; layer: string; key: string; title: string }>;
  return ok({ waivers, governanceDocs }, 200, { count: waivers.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Waiver requests require the analyst role or higher.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  // R2-E (2026-10-09): the S9 per-row dialog may send the checklist item it is
  // waiving instead of a hand-built clause string — the route derives clause_ref
  // from the item itself so no client-side reshaping is needed.
  const body = (await request.json().catch(() => null)) as {
    governance_doc_id?: string; clause_ref?: string; reason?: string;
    approver_role?: string; expires_at?: string; approved_by?: string;
    dd_item?: { checklist_id?: string; item_id?: string };
    target_id?: string;
  } | null;
  const scope = scopeOrResponse(id, body?.target_id);
  if ("response" in scope) return scope.response;

  const governanceDocId = body?.governance_doc_id?.trim();
  const ddItemId = body?.dd_item?.item_id?.trim();
  const ddChecklistId = body?.dd_item?.checklist_id?.trim();
  const clauseRef = body?.clause_ref?.trim() ?? (ddItemId && ddChecklistId ? `${ddChecklistId} ${ddItemId}` : undefined);
  const reason = body?.reason?.trim() || (ddItemId ? `DD 항목 ${ddChecklistId} ${ddItemId} 면제 요청` : undefined);
  const approverRole = body?.approver_role?.trim();
  const expiresAt = body?.expires_at?.trim();
  if (!governanceDocId || !clauseRef || !reason || !approverRole || !expiresAt) {
    return badRequest("invalid_request", "governance_doc_id, clause_ref, reason, approver_role, and expires_at are all required.");
  }
  const now = new Date().toISOString();
  if (Number.isNaN(Date.parse(expiresAt))) {
    return badRequest("invalid_request", "expires_at is not an ISO date.");
  }
  if (expiresAt <= now) {
    return badRequest("invalid_request", "expires_at must be in the future — indefinite or retroactive waivers are not allowed (ADR-0036).");
  }
  const db = getDb();
  if (!db.query("SELECT id FROM governance_doc WHERE id = ?").get(governanceDocId)) {
    return badRequest("invalid_request", "governance_doc_id does not exist.");
  }
  // Re-filing an identical still-active waiver would silently extend it —
  // refuse and let the operator revoke the old one first.
  const dupe = db
    .query(
      "SELECT id FROM waiver WHERE project_id = ? AND governance_doc_id = ? AND clause_ref = ? AND status = 'active' AND expires_at > ? AND target_id IS ?",
    )
    .get(id, governanceDocId, clauseRef, now, scope.targetId);
  if (dupe) {
    return badRequest("duplicate_active", `An active waiver for the same clause (${dupe.id}) already exists — revoke it before re-requesting.`);
  }
  const approvedBy = body?.approved_by?.trim() || undefined;
  let waiverId: string;
  try {
    waiverId = issueWaiver(db, {
      projectId: id,
      governanceDocId,
      clauseRef,
      reason,
      requestedBy: ctx.userId,
      approverRole,
      expiresAt,
      approvedBy,
      targetId: scope.targetId,
      now,
    });
  } catch (err) {
    return badRequest("invalid_request", err instanceof Error ? err.message : String(err));
  }
  appendAudit(db, {
    actor: ctx.userId,
    action: approvedBy ? "waiver.issue_approved" : "waiver.request",
    target: `${id}:${governanceDocId}:${clauseRef}:${waiverId}`,
    now,
  });
  return ok({ id: waiverId, status: approvedBy ? "active" : "pending" }, 201);
}
