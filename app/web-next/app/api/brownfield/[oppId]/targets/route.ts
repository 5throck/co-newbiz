// S6 대상 후보 발굴 — 기회별 Long List 목록(+체크리스트 정의) / 후보 등록 /
// Target Universe 정의 (ADR-0094).
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { createTarget, listTargets, screeningItems, screeningSummary } from "../../../../../lib/brownfield-targets.ts";

export async function GET(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { oppId } = await params;
  const db = getDb();
  const opp = db.query("SELECT id, name, target_universe_json FROM opportunity WHERE id = ?").get(oppId) as { id: string; name: string; target_universe_json: string | null } | null;
  if (!opp) return notFound();
  const targets = listTargets(oppId);
  let universe: unknown = null;
  try { universe = opp.target_universe_json ? JSON.parse(opp.target_universe_json) : null; } catch { /* treat as unset */ }
  return ok({
    opportunity: { id: opp.id, name: opp.name },
    universe,
    checklist: screeningItems().map((i) => ({ id: i.id, text: i.text, mandatory: i.mandatory, waiver_eligible: i.waiver_eligible })),
    targets: targets.map((t) => ({ ...t, screening_summary: screeningSummary(t) })),
  }, 200);
}

// Target Universe 정의 저장 — S6 완료기준(선정 기준·커버리지 범위·최소 후보 수).
// opportunity.target_universe_json (마이그레이션 0062, ADR-0094).
export async function PUT(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Target Universe 정의는 analyst 역할 이상이어야 합니다.");
  const { oppId } = await params;
  const body = (await request.json().catch(() => null)) as {
    definition?: string; criteria?: string[]; scope?: string; min_long_list?: number;
  } | null;
  const definition = body?.definition?.trim();
  if (!definition) return badRequest("invalid_request", "definition(유니버스 정의)은 필수입니다.");
  const universe = {
    definition,
    criteria: (body?.criteria ?? []).map((c) => c.trim()).filter(Boolean),
    scope: body?.scope?.trim() || null,
    min_long_list: typeof body?.min_long_list === "number" && body.min_long_list > 0 ? Math.floor(body.min_long_list) : 3,
  };
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  db.run("UPDATE opportunity SET target_universe_json = ? WHERE id = ?", [JSON.stringify(universe), oppId]);
  appendAudit(db, { actor: ctx.userId, action: "target_universe.save", target: oppId, now: new Date().toISOString() });
  return ok({ universe }, 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "후보 등록은 analyst 역할 이상이어야 합니다.");
  const { oppId } = await params;
  const body = (await request.json().catch(() => null)) as
    | { company_name?: string; dart_corp_code?: string | null; universe_note?: string | null }
    | null;
  const name = body?.company_name?.trim();
  if (!name) return badRequest("invalid_request", "company_name은 필수입니다.");
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  const dup = db
    .query("SELECT id FROM brownfield_target WHERE opportunity_id = ? AND company_name = ? AND status != 'excluded'")
    .get(oppId, name) as { id: string } | undefined;
  if (dup) return badRequest("duplicate_target", `'${name}'은(는) 이미 Long List에 있습니다.`);
  const target = createTarget(oppId, name, body?.dart_corp_code?.trim() || null, body?.universe_note?.trim() || null);
  return ok(target, 201);
}
