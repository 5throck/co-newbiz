// S6 대상 후보 발굴 — 기회별 Long List 목록(+체크리스트 정의) / 후보 등록 /
// Target Universe 정의 (ADR-0094).
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { createTarget, listTargets, screeningItems, screeningSummary } from "../../../../../lib/brownfield-targets.ts";
import { combinedEvalScore, computeEvalScore, targetEvalStates } from "../../../../../lib/brownfield-eval-criteria.ts";

export async function GET(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
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
    targets: targets.map((t) => {
      // S7 랭킹은 재무·기술 평가(ADR-0139) 기준으로 매긴다 — t-01~09
      // 체크리스트(screening_summary)는 위원회 심의의 판정 근거로 쓰고,
      // Long List 단계의 스코어·정렬에는 쓰지 않는다(사용자 요청, 2026-09-15).
      const evalScores = computeEvalScore(targetEvalStates(oppId, t.id, auth.auth.userId));
      const complete = (["financial", "technical"] as const).every(
        (c) => evalScores[c].totalWeight > 0 && evalScores[c].scoredWeight === evalScores[c].totalWeight,
      );
      return { ...t, screening_summary: screeningSummary(t), eval_summary: { ...evalScores, combined: combinedEvalScore(evalScores), complete } };
    }),
  }, 200);
}

// Target Universe 정의 저장 — S6 완료기준(선정 기준·커버리지 범위·최소 후보 수).
// opportunity.target_universe_json (마이그레이션 0062, ADR-0094).
export async function PUT(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "Target Universe 정의는 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { oppId } = await params;
  const body = (await request.json().catch(() => null)) as {
    definition?: string; criteria?: string[]; scope?: string; min_long_list?: number;
  } | null;
  const definition = body?.definition?.trim();
  if (!definition) return badRequest("invalid_request", "definition(목표 시장 정의)은 필수입니다.");
  const db = getDb();
  const existingRow = db.query("SELECT target_universe_json FROM opportunity WHERE id = ?").get(oppId) as { target_universe_json: string | null } | undefined;
  if (!existingRow) return notFound();
  let existing: { criteria?: string[]; scope?: string | null; min_long_list?: number } = {};
  try { existing = existingRow.target_universe_json ? JSON.parse(existingRow.target_universe_json) : {}; } catch { /* treat as unset */ }
  const minLongList = typeof body?.min_long_list === "number" && body.min_long_list > 0 ? Math.floor(body.min_long_list) : 3;
  // criteria/scope는 이제 화면에서 입력받지 않는다(S7 재무·기술 평가 레이어와
  // 용어·역할이 겹쳐 제거됨, ADR-0139 후속) — 생략 시 기존 값을 그대로 보존한다.
  const universe = {
    definition,
    criteria: body?.criteria ? body.criteria.map((c) => c.trim()).filter(Boolean) : (existing.criteria ?? []),
    scope: body?.scope !== undefined ? (body.scope?.trim() || null) : (existing.scope ?? null),
    min_long_list: minLongList,
  };
  db.run("UPDATE opportunity SET target_universe_json = ? WHERE id = ?", [JSON.stringify(universe), oppId]);
  appendAudit(db, { actor: ctx.userId, action: "target_universe.save", target: oppId, now: new Date().toISOString() });
  return ok({ universe }, 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "후보 등록은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
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
  const target = createTarget(oppId, name, body?.dart_corp_code?.trim() || null, body?.universe_note?.trim() || null, { actorUserId: auth.auth.userId });
  return ok(target, 201);
}
