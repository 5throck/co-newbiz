// S6 대상 후보 발굴 — 기회별 Long List 목록(+체크리스트 정의) / 후보 등록 /
// Target Universe 정의 (ADR-0094).
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import {
  createTarget,
  findDuplicateTarget,
  listTargets,
  screeningItems,
  screeningSummary,
} from "../../../../../lib/brownfield-targets.ts";
import { combinedEvalScore, computeEvalScore, targetEvalStates } from "../../../../../lib/brownfield-eval-criteria.ts";
import { promotedCarrierResponse, trackConflictResponse } from "../../../../../lib/route-track-guard.ts";

export async function GET(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { oppId } = await params;
  const db = getDb();
  const opp = db.query("SELECT id, name, target_universe_json FROM opportunity WHERE id = ?").get(oppId) as {
    id: string;
    name: string;
    target_universe_json: string | null;
  } | null;
  if (!opp) return notFound();
  const targets = listTargets(oppId);
  let universe: unknown = null;
  try {
    universe = opp.target_universe_json ? JSON.parse(opp.target_universe_json) : null;
  } catch {
    /* treat as unset */
  }
  return ok(
    {
      opportunity: { id: opp.id, name: opp.name },
      universe,
      checklist: screeningItems().map((i) => ({
        id: i.id,
        text: i.text,
        mandatory: i.mandatory,
        waiver_eligible: i.waiver_eligible,
      })),
      targets: targets.map((t) => {
        // S7 랭킹은 재무·기술 평가(ADR-0139) 기준으로 매긴다 — t-01~09
        // 체크리스트(screening_summary)는 위원회 심의의 판정 근거로 쓰고,
        // Long List 단계의 스코어·정렬에는 쓰지 않는다(사용자 요청, 2026-09-15).
        const evalScores = computeEvalScore(targetEvalStates(oppId, t.id, auth.auth.userId));
        const complete = (["financial", "technical"] as const).every(
          (c) => evalScores[c].totalWeight > 0 && evalScores[c].scoredWeight === evalScores[c].totalWeight,
        );
        return {
          ...t,
          screening_summary: screeningSummary(t),
          eval_summary: { ...evalScores, combined: combinedEvalScore(evalScores), complete },
        };
      }),
    },
    200,
  );
}

// Target Universe 정의 저장 — S6 완료기준(선정 기준·커버리지 범위·최소 후보 수).
// opportunity.target_universe_json (마이그레이션 0062, ADR-0094).
export async function PUT(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "write", {
    viewerMessage: "Target Universe definition requires the analyst role or higher.",
  });
  if (denied) return denied;
  const { oppId } = await params;
  const body = (await request.json().catch(() => null)) as {
    definition?: string;
    criteria?: string[];
    scope?: string;
    financial_criteria?: string;
    min_long_list?: number;
  } | null;
  const definition = body?.definition?.trim();
  if (!definition) return badRequest("invalid_request", "definition (target market definition) is required.");
  const db = getDb();
  const existingRow = db.query("SELECT target_universe_json FROM opportunity WHERE id = ?").get(oppId) as
    | { target_universe_json: string | null }
    | undefined;
  if (!existingRow) return notFound();
  let existing: {
    criteria?: string[];
    scope?: string | null;
    financial_criteria?: string | null;
    min_long_list?: number;
  } = {};
  try {
    existing = existingRow.target_universe_json ? JSON.parse(existingRow.target_universe_json) : {};
  } catch {
    /* treat as unset */
  }
  const minLongList =
    typeof body?.min_long_list === "number" && body.min_long_list > 0 ? Math.floor(body.min_long_list) : 3;
  // criteria/scope는 이제 화면에서 입력받지 않는다(S7 재무·기술 평가 레이어와
  // 용어·역할이 겹쳐 제거됨, ADR-0139 후속) — 생략 시 기존 값을 그대로 보존한다.
  // financial_criteria(DEC-20261111-05, design §5.1)는 S7 t-08이 비교하는
  // `유니버스 정의의 재무 기준`의 저장소다 — 같은 ADR-0139 보존 의미론(생략 시
  // 기존 값 유지), 600자 상한(viability 400자에 손 편집 여유를 더한 상한).
  const universe = {
    definition,
    criteria: body?.criteria ? body.criteria.map((c) => c.trim()).filter(Boolean) : (existing.criteria ?? []),
    scope: body?.scope !== undefined ? body.scope?.trim() || null : (existing.scope ?? null),
    financial_criteria:
      body?.financial_criteria !== undefined
        ? body.financial_criteria?.trim().slice(0, 600) || null
        : (existing.financial_criteria ?? null),
    min_long_list: minLongList,
  };
  db.run("UPDATE opportunity SET target_universe_json = ? WHERE id = ?", [JSON.stringify(universe), oppId]);
  appendAudit(db, { actor: ctx.userId, action: "target_universe.save", target: oppId, now: new Date().toISOString() });
  return ok({ universe }, 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", {
    viewerMessage: "Candidate registration requires the analyst role or higher.",
  });
  if (denied) return denied;
  const { oppId } = await params;
  const body = (await request.json().catch(() => null)) as {
    company_name?: string;
    dart_corp_code?: string | null;
    universe_note?: string | null;
  } | null;
  const name = body?.company_name?.trim();
  if (!name) return badRequest("invalid_request", "company_name is required.");
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  // T-20261022-038: S6 candidate registration is a brownfield-only write surface. The
  // client gates it with TrackGate, but the server must not trust that — a greenfield
  // route decision makes the registration 409 not_applicable_track (mirror of
  // T-20261022-007's S5 guard). No route decision yet stays writable, same back-compat
  // choice as the S5 route.
  const conflict = trackConflictResponse(
    db,
    oppId,
    "brownfield",
    "S6 대상 후보 등록은 Brownfield Route에서만 할 수 있습니다 — 이 기회의 현재 Route 결정은 Greenfield입니다.",
  );
  if (conflict) return conflict;
  // T-20261022-039: the Short List is the S8 subjectScope set (ADR-0143) —
  // frozen once the carrier is promoted; widening happens before S7→S8 or via
  // the ADR-0157 per-target DD path on existing members.
  const promoted = promotedCarrierResponse(
    db,
    oppId,
    "이 기회는 이미 프로젝트로 승격되었습니다 — Short List 변경은 승격 전에, 승격 후에는 ADR-0157 대상별 DD 경로로 수행합니다.",
  );
  if (promoted) return promoted;
  // design 2026-11-11 §5.1 (D3) — code-or-canonical duplicate match replaces
  // the bare-name 400 guard: registration is "ensure present" (idempotent).
  // A hit returns 200 with the EXISTING row + meta deduped:true and audited
  // brownfield_target.dedupe; the client treats 2xx as success and dismisses
  // the card ("already registered" degrades gracefully).
  const incomingCode = body?.dart_corp_code?.trim() || null;
  const dup = findDuplicateTarget(db, oppId, name, incomingCode);
  if (dup) {
    appendAudit(db, {
      actor: auth.auth.userId,
      action: "brownfield_target.dedupe",
      target: `${oppId}:${dup.id}`,
      now: new Date().toISOString(),
    });
    return ok(dup, 200, { deduped: true });
  }
  const target = createTarget(oppId, name, incomingCode, body?.universe_note?.trim() || null, {
    actorUserId: auth.auth.userId,
  });
  return ok(target, 201);
}
