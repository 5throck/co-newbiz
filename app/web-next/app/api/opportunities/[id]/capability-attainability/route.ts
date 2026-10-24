// GET/PUT /api/opportunities/[id]/capability-attainability — S5 (Green Field) edit surface of the
// required-capability attainability judgement (ADR-0171 / ADR-0172). Reads/writes the opportunity's
// S3 register rows (opportunity.capability_gap_json, no migration): per row the resolution route
// (해소 방식), the 기대 수준 narrative (<= 400), closing cost (KRW million), months to attain and a
// human attainability judgement (높음/중간/낮음; null = 미판정). PUT saves a draft (analyst+, any
// caller; agents may only draft) and clears the row's confirmation when its content changed.
// S3-owned fields (capability, requiredNote, necessity, held.*, requiredLevel, currentLevel, ...)
// are rejected with 400 s3_owned_field — S5 never writes them. Confirming is a separate
// human-only route (POST .../confirm). Audit: capability_attainability.save, target
// "<opportunityId>#capability@<via>:surface=S5".
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, callPathOf, humanOnlyDenied, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { buildAttainabilityView, readRegister, saveAttainability } from "../../../../../lib/capability-attainability.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "read"); if (denied) return denied; }
  const { id } = await params;
  const reg = readRegister(getDb(), id);
  if (!reg) return notFound();
  return ok(buildAttainabilityView(id, reg.rows, reg.json === null ? null : reg.updatedAt ?? "", reg.removed), 200);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "Capability-attainability saves require the analyst role or higher." }); if (denied) return denied; }
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { rows?: unknown } | null;
  if (!body) return badRequest("invalid_request", "Invalid request body.");
  const db = getDb();
  if (!readRegister(db, id)) return notFound();
  const at = new Date().toISOString();
  // Read-merge-write in one transaction: only judgement-owned fields are merged onto the live register.
  const res = saveAttainability(db, id, body.rows, { userId: ctx.userId, human: humanOnlyDenied(ctx, "") === null }, { action: "capability_attainability.save", target: `${id}#capability@${callPathOf(ctx)}:surface=S5`, at });
  if (!res.ok) return badRequest(res.error.code, res.error.message);
  if (res.changedIds.length === 0) return ok({ ...buildAttainabilityView(id, res.rows, res.updatedAt, res.removed), changed: 0 }, 200);
  return ok({ ...buildAttainabilityView(id, res.rows, at, res.removed), changed: res.changedIds.length }, 200);
}
