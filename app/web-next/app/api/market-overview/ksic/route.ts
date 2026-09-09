// KSIC master search — powers the /market KSIC code picker suggestion list
// (GET, any signed-in role; read-only over the curated ADR-0111 dataset).
import { authenticate } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";
import { searchKsic } from "../../../../lib/ksic.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const entries = searchKsic(q, 20);
  return ok({ entries }, 200, { count: entries.length });
}
