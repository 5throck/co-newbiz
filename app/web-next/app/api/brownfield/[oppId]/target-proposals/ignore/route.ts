// POST /api/brownfield/[oppId]/target-proposals/ignore — persist an ignore
// event for a proposed candidate (design 2026-11-13-proposal-ignore-suppression
// §3.3, DEC-20261113-04). The proposal card's 무시 button used to filter only
// the in-memory array, so an ignored company reappeared on every regeneration.
// Now the click appends one row to brownfield_target_proposal_ignore (append-
// only, no update/delete path — ADR-0012 family) and returns the accumulated
// count; suppression itself (count >= 2) is enforced server-side on both
// proposal surfaces. A repeated click is a NEW event and a new 201 —
// accumulation is the contract, not idempotence.
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { companyKey } from "../../../../../../lib/name-similarity.ts";
import { recordProposalIgnore } from "../../../../../../lib/brownfield-proposal-ignore.ts";

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", {
    viewerMessage: "Ignoring a proposal requires the analyst role or higher.",
  });
  if (denied) return denied;
  const { oppId } = await params;
  const db = getDb();
  // 404-not-403 house rule — existence is never leaked as a role answer.
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  const body = (await request.json().catch(() => null)) as { company_name?: string } | null;
  // QA fix iteration 1 — the stored raw name is BOUNDED before the insert:
  // whitespace runs (incl. newlines) collapse to single spaces and the cap is
  // the extractor's own 120 chars (normalizeLlmSuggestions' name cap), so a
  // pasted 300-char multi-line string can never bloat the row or the audit
  // trail. The key is derived from the bounded form — what is stored and what
  // is keyed stay self-consistent.
  const rawName = (body?.company_name?.trim() || "").replace(/\s+/g, " ").slice(0, 120).trim();
  // Blank input AND a name that collapses to nothing (e.g. "(주)") both reject:
  // an empty key is never stored and never matches (design §3.2).
  if (!rawName || !companyKey(rawName)) return badRequest("company_required", "company_name is required.");
  const { companyKey: key, ignoreCount } = recordProposalIgnore(db, oppId, rawName, auth.auth.userId);
  return ok({ company_key: key, ignore_count: ignoreCount }, 201);
}
