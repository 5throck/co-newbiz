// S6 대상 후보 발굴 — 기회별 Long List 목록(+체크리스트 정의) / 후보 등록.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { createTarget, listTargets, screeningItems, screeningSummary } from "../../../../../lib/brownfield-targets.ts";

export async function GET(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { oppId } = await params;
  const db = getDb();
  const opp = db.query("SELECT id, name FROM opportunity WHERE id = ?").get(oppId) as { id: string; name: string } | null;
  if (!opp) return notFound();
  const targets = listTargets(oppId);
  return ok({
    opportunity: opp,
    checklist: screeningItems().map((i) => ({ id: i.id, text: i.text, mandatory: i.mandatory, waiver_eligible: i.waiver_eligible })),
    targets: targets.map((t) => ({ ...t, screening_summary: screeningSummary(t) })),
  }, 200);
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
