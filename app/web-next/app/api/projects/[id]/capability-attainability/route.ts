// GET/PUT /api/projects/[id]/capability-attainability — S8 required-capability
// attainability (ADR-0168). Reads/writes the SOURCE opportunity's S3 register
// rows (opportunity.capability_gap_json, no migration): per row the 5-step
// required/current level, resolution route, closing cost (KRW million), months
// to attain, and a human attainability judgement (높음/중간/낮음; null = 미판정).
// PUT saves a draft (analyst+ member, any caller; agents may only draft) and
// clears the row's confirmation when its content changed. Confirming is a
// separate human-only route (POST .../confirm). Audit: capability_attainability.save,
// target "<projectId>#capability@<via>".
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, callPathOf, humanOnlyDenied, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { applyAttainabilityPatches, buildAttainabilityView, readRegister, sourceOpportunityOf, writeRegister } from "../../../../../lib/capability-attainability.ts";

function load(projectId: string) {
  const db = getDb();
  const oppId = sourceOpportunityOf(db, projectId);
  const reg = oppId ? readRegister(db, oppId) : null;
  return { db, oppId, reg };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "read"); if (denied) return denied; }
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const { oppId, reg } = load(id);
  if (!oppId || !reg) return ok(buildAttainabilityView(null, [], null), 200);
  return ok(buildAttainabilityView(oppId, reg.rows, reg.json === null ? null : reg.updatedAt ?? ""), 200);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "필요 역량 달성 가능성 저장은 analyst 역할 이상이어야 합니다." }); if (denied) return denied; }
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { rows?: unknown } | null;
  if (!body) return badRequest("invalid_request", "요청 본문이 올바르지 않습니다.");
  const { db, oppId, reg } = load(id);
  if (!oppId || !reg) return badRequest("no_source_opportunity", "원 기회(S3 역량 레지스터)가 없는 프로젝트입니다.");
  const res = applyAttainabilityPatches(reg.rows, body.rows, { userId: ctx.userId, human: humanOnlyDenied(ctx, "") === null });
  if (!res.ok) return badRequest(res.error.code, res.error.message);
  if (res.changedIds.length === 0) return ok({ ...buildAttainabilityView(oppId, reg.rows, reg.updatedAt), changed: 0 }, 200);
  const at = new Date().toISOString();
  writeRegister(db, oppId, res.rows, { actor: ctx.userId, action: "capability_attainability.save", target: `${id}#capability@${callPathOf(ctx)}`, at });
  return ok({ ...buildAttainabilityView(oppId, res.rows, at), changed: res.changedIds.length }, 200);
}
