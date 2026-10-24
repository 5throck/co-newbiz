// GET/PUT /api/brownfield/targets/[targetId]/capability-judgements — Brown Field S7 per-target
// required-capability judgement (ADR-0171 slice 2). Same row view and patch body as the Green
// Field S5 route (GET /api/opportunities/{id}/capability-attainability): per S3 register row the
// target's 해소 방식, 기대 수준, cost, months and attainability grade; staleness is the S3 row
// hash plus this target's evaluation state for the seeded criterion. Only shortlisted targets
// (the selected target is always one) are in scope: others get 409 target_not_in_scope.
// PUT saves a draft (analyst+, any caller; agents may only draft) and clears the row's
// confirmation when its content changed; confirming is the human-only POST .../confirm.
// Audit capability_attainability.save, target "<oppId>#capability@<via>:surface=S7:target_id=<id>".
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate, callPathOf, humanOnlyDenied, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, fail, notFound, ok } from "../../../../../../lib/envelope.ts";
import { buildTargetView, saveTargetJudgements, targetScope } from "../../../../../../lib/brownfield-capability-judgement.ts";

export async function GET(request: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "read"); if (denied) return denied; }
  const { targetId } = await params;
  const db = getDb();
  const scope = targetScope(db, targetId);
  if (!scope.ok) return scope.code === "not_found" ? notFound() : fail(409, scope.code, scope.message);
  return ok(buildTargetView(db, scope.target), 200);
}

export async function PUT(request: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "Capability-attainability saves require the analyst role or higher." }); if (denied) return denied; }
  const { targetId } = await params;
  const body = (await request.json().catch(() => null)) as { rows?: unknown } | null;
  if (!body) return badRequest("invalid_request", "Invalid request body.");
  const db = getDb();
  const scope = targetScope(db, targetId);
  if (!scope.ok) return scope.code === "not_found" ? notFound() : fail(409, scope.code, scope.message);
  const at = new Date().toISOString();
  const res = saveTargetJudgements(db, scope.target, body.rows, { userId: ctx.userId, human: humanOnlyDenied(ctx, "") === null }, { action: "capability_attainability.save", via: callPathOf(ctx), at });
  if (!res.ok) return badRequest(res.error.code, res.error.message);
  return ok({ ...buildTargetView(db, scope.target), changed: res.changedIds.length }, 200);
}
