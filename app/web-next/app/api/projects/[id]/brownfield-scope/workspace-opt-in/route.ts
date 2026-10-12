// Brownfield S9 workspace scope opt-in (ADR-0162, design
// 2026-10-12-brownfield-dd-workspace-scope-by-subtrack §9). Mirrors the
// greenfield workspace-opt-in route.
// GET  — read-only preview: Judged X / Y before and after, the existing
//        judgements that move to "Judged under previous scope", and recorded
//        fails that stay unmet. Nothing is written.
// POST — HUMAN-ONLY (boundary #2): cookie session + CSRF (authenticate()),
//        analyst+, project visibility, `migration_note` required. Records the
//        brownfield overlay pin with an audit entry. Never touches checklist item
//        state. Bearer / OAuth-delegated / agent callers get 403 human_only;
//        HUMAN_ONLY_ROUTES refuses it in-process. m_and_a and a null sub-track
//        have nothing to opt into (409 no_scope_change).
import { authenticate } from "../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { AGENT_KEYS } from "../../../../../../lib/agent-registry.generated.ts";
import { currentPrincipal } from "../../../../../../lib/mcp/principal-context.ts";
import { optInBrownfieldWorkspaceScope } from "../../../../../../lib/brownfield-subtrack.ts";
import { brownfieldOptInPreview } from "../../../../../../lib/dd-checklist-tailor.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const preview = brownfieldOptInPreview(id);
  if (!preview) return fail(409, "not_brownfield", "작업 범위 전환은 brownfield 경로 프로젝트에만 적용합니다.");
  return ok({ preview }, 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.via !== "cookie" || currentPrincipal() || AGENT_KEYS.has(ctx.userId)) {
    return forbidden("human_only", "작업 범위 전환은 사람만 할 수 있습니다 (boundary #2) — 에이전트는 제안만 가능합니다.");
  }
  if (ctx.role === "viewer") return forbidden("role_required", "analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (typeof body?.migration_note === "string" && body.migration_note.trim().length > 2000) {
    return badRequest("invalid_request", "migration_note는 2000자 이하여야 합니다.");
  }
  const r = optInBrownfieldWorkspaceScope({ projectId: id, migrationNote: body?.migration_note, actor: ctx.userId });
  if (!r.ok) {
    if (r.code === "invalid_request") return badRequest("invalid_request", r.message);
    return fail(409, r.code, r.message);
  }
  return ok({ pin_id: r.pin_id, preview: brownfieldOptInPreview(id) }, 201);
}
