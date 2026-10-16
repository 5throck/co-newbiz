// GET/PUT /api/opportunities/[id]/target-scope — ADR-0179 slice 1: the
// structured target scope of the promoting opportunity. PUT is HUMAN-ONLY
// (boundary #2): a person (analyst+) records the regions / segments /
// unit_basis the deal addresses; bearer / MCP-principal / agent callers get
// 403 human_only (registered in HUMAN_ONLY_ROUTES). GET is open to anyone
// who can see the opportunity. Validation is strict: an invalid shape is a
// 400 invalid_request, never silently dropped. Audit:
// opportunity_target_scope.write, target "<id>#target-scope@<via>".
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, callPathOf, humanOnlyDenied, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { normalizeTargetScopeInput, parseTargetScopeJson, type TargetScope } from "../../../../../lib/target-scope.ts";
import { readSizingLink } from "../sizing-link/route.ts";
// Additive field on GET (ADR-0179 amendment slice A): `linked_sizing` — the
// same reference payload the sizing-link GET returns (analysis/version ids,
// the pinned version's declared scope, anchor value, confidence grade, S1
// href) so the target-scope editor can show the linked S1 analyses with
// their source scopes as reference while choosing a scope. GET shape grows
// additively; existing `scope` field is untouched.

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();
  const row = db.query("SELECT target_scope_json FROM opportunity WHERE id = ?").get(id) as { target_scope_json: string | null } | undefined;
  if (!row) return notFound();
  try {
    const linked = readSizingLink(db, id);
    return ok({ scope: parseTargetScopeJson(row.target_scope_json), linked_sizing: linked?.reference ?? null }, 200);
  } catch (err) {
    return badRequest("invalid_request", err instanceof Error ? err.message : "invalid target scope");
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = humanOnlyDenied(ctx, "구조화된 대상 범위는 사람만 입력할 수 있습니다 (boundary #2) — 에이전트는 읽기만 가능합니다.");
  if (denied) return denied;
  { const d = requireBusinessActor(ctx, "write", { viewerMessage: "target scope 입력은 analyst 역할 이상이어야 합니다." }); if (d) return d; }
  const { id } = await params;
  const db = getDb();
  const row = db.query("SELECT id FROM opportunity WHERE id = ?").get(id);
  if (!row) return notFound();
  const body = (await request.json().catch(() => null)) as unknown;
  let scope: Pick<TargetScope, "regions" | "segments" | "unit_basis">;
  try {
    scope = normalizeTargetScopeInput(body);
  } catch (err) {
    return badRequest("invalid_request", err instanceof Error ? err.message : "invalid target scope");
  }
  const at = new Date().toISOString();
  const record = { ...scope, set_by: ctx.userId, set_at: at };
  db.run("UPDATE opportunity SET target_scope_json = ? WHERE id = ?", [JSON.stringify(record), id]);
  appendAudit(db, { actor: ctx.userId, action: "opportunity_target_scope.write", target: `${id}#target-scope@${callPathOf(ctx)}`, now: at });
  return ok({ scope: record }, 200);
}
