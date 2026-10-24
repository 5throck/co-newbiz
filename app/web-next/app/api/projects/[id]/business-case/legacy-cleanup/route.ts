// POST /api/projects/[id]/business-case/legacy-cleanup — human-only cleanup of
// pre-ADR-0143 (target_id NULL) models (ADR-0158). Unreferenced models are
// deleted, referenced ones archived. Analyst+; deny-by-default visibility.
// OAuth-delegated (agent) principals are rejected: this is a human click.
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { currentPrincipal } from "../../../../../../lib/mcp/principal-context.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { cleanupLegacyModels } from "../../../../../../lib/business-case-cleanup.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (currentPrincipal()) return forbidden("human_only", "Only a human can run old-model cleanup (boundary #2).");
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "Old-model cleanup requires the analyst role or higher." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => ({}))) as { model_ids?: unknown } | null;
  const raw = body?.model_ids;
  if (raw !== undefined && (!Array.isArray(raw) || raw.length === 0 || raw.length > 200 || raw.some((m) => typeof m !== "string"))) {
    return badRequest("invalid_request", "model_ids must be a non-empty array of strings.");
  }
  const result = cleanupLegacyModels(id, ctx.userId, raw as string[] | undefined);
  return ok(result, 200, { deleted: result.deleted.length, archived: result.archived.length });
}
