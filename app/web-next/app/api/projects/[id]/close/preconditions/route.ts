// GET /api/projects/[id]/close/preconditions — per-closure-type precondition
// status for the closure modal (ADR-0152 §3.3). Read-only: agents may call
// it; the matching POST /close is human-only. Deny-by-default visibility.
import { getClosurePreconditions } from "../../../../../../../../db/repositories/closure.repository.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { AGENT_IDS } from "../../../../../../lib/closure-http.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true })) return notFound();
  return ok(getClosurePreconditions("project", id, { agentIds: AGENT_IDS }));
}
