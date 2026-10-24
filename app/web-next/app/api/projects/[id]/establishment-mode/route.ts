// GET/PUT /api/projects/[id]/establishment-mode — Green Field establishment
// mode (ADR-0167): new_entity (신규 법인 설립) | business_unit (신규 사업부 추진).
// PUT is HUMAN-ONLY: HUMAN_ONLY_ROUTES at the MCP port AND 403 human_only here
// for bearer / OAuth / agent callers (choosing the vehicle is part of the S10
// structure decision, boundary #2). Agents may only PROPOSE a mode
// (propose_establishment_mode -> decision proposal -> a person confirms; the
// confirm runs this PUT in the person's own cookie session). analyst+ member;
// admins are excluded by role separation (visibleProject -> 404).
//
// Body: { mode: "new_entity" | "business_unit", reason?: string }.
//  - business_unit needs origin internal on a Green Field project (400 mode_not_allowed);
//  - the first choice needs no reason; CHANGING a stored mode needs reason >= 10
//    chars (400 reason_required / invalid_request) and keeps the old mode's step
//    rows as read-only history (the new mode starts at pending);
//  - the audit entry (action establishment_mode.set | .change, target
//    "<projectId>#mode@<via>") and an establishment_mode_event row are written
//    in the same transaction.
import { authenticate, callPathOf, humanOnlyDenied } from "../../../../../lib/auth.ts";
import { getEstablishmentModeState, setEstablishmentMode } from "../../../../../lib/establishment.ts";
import { establishmentErrorResponse } from "../../../../../lib/establishment-http.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const state = getEstablishmentModeState(id);
  if (!state) return notFound();
  return ok(state, 200);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = humanOnlyDenied(ctx, "설립 방식 선택·변경은 사람만 할 수 있습니다 (boundary #2) — 에이전트는 propose_establishment_mode로 제안만 합니다.");
  if (denied) return denied;
  if (ctx.role === "viewer") return forbidden("role_required", "Choosing the establishment mode requires the analyst role or higher.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { mode?: unknown; reason?: unknown } | null;
  if (typeof body?.mode !== "string") return badRequest("invalid_request", "mode must be one of: new_entity | business_unit (ADR-0167).");
  if (body.reason != null && typeof body.reason !== "string") return badRequest("invalid_request", "reason must be a string.");

  const result = setEstablishmentMode(id, body.mode, (body.reason as string | undefined) ?? null, ctx.userId, callPathOf(ctx));
  if (!result.ok) return establishmentErrorResponse(result.error);
  const state = getEstablishmentModeState(id)!;
  return ok(
    {
      mode: result.mode, previous_mode: result.previous_mode, changed: result.changed, kind: result.kind,
      updated_at: result.updated_at, state,
    },
    200,
  );
}
