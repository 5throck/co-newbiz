// Greenfield S9 workspace scope opt-in (ADR-0160 addendum b, design
// 2026-10-12-greenfield-dd-workspace-domains-by-track §9.3 / §10).
// GET  — read-only preview: Judged X / Y before and after, the existing
//        judgements that move to "Judged under previous scope", and recorded
//        fails that stay unmet. Nothing is written.
// POST — HUMAN-ONLY (boundary #2): cookie session + CSRF (authenticate()),
//        analyst+, project visibility, `migration_note` required. Records the
//        overlay pin (and the ADR-0160 sub-track pin when not yet active) with an
//        audit entry. Never touches checklist item state. Bearer / OAuth-delegated
//        / agent callers get 403 human_only; HUMAN_ONLY_ROUTES refuses it in-process.
import { authenticate } from "../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { AGENT_KEYS } from "../../../../../../lib/agent-registry.generated.ts";
import { currentPrincipal } from "../../../../../../lib/mcp/principal-context.ts";
import { optInWorkspaceScope } from "../../../../../../lib/greenfield-subtrack.ts";
import { workspaceOptInPreview } from "../../../../../../lib/dd-checklist-tailor.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const preview = workspaceOptInPreview(id);
  if (!preview) return fail(409, "not_greenfield", "Work-scope switching applies only to greenfield-route projects.");
  return ok({ preview }, 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.via !== "cookie" || currentPrincipal() || AGENT_KEYS.has(ctx.userId)) {
    return forbidden("human_only", "Only a human can switch the work scope (boundary #2) — agents may only propose.");
  }
  if (ctx.role === "viewer") return forbidden("role_required", "Requires the analyst role or higher.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const r = optInWorkspaceScope({ projectId: id, migrationNote: body?.migration_note, actor: ctx.userId });
  if (!r.ok) {
    if (r.code === "invalid_request") return badRequest("invalid_request", r.message);
    return fail(409, r.code, r.message);
  }
  return ok({ pin_id: r.pin_id, subtrack_pin_id: r.subtrack_pin_id, preview: workspaceOptInPreview(id) }, 201);
}
