// Track advisory (ADR-0104) — deterministic greenfield/brownfield
// recommendation + base rates + re-review triggers for the S4 decision
// surface. Read-only: the human decision is still recorded via the
// route-decision POST (boundary #2).
import { authenticate } from "../../../../../lib/auth.ts";
import { computeTrackAdvisory } from "../../../../../lib/track-advisory.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../db/client.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!getDb().query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();
  return ok(computeTrackAdvisory(getDb(), id), 200);
}
