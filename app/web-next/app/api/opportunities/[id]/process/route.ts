// Opportunity-side process evaluation (S1–S3 derived state).
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { evaluateProcess } from "../../../../../lib/process-flow.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "read"); if (denied) return denied; }
  const { id } = await params;
  const exists = getDb().query("SELECT id FROM opportunity WHERE id = ?").get(id);
  if (!exists) return notFound();
  return ok(evaluateProcess({ type: "opportunity", id }), 200);
}
