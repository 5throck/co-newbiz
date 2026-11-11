// GET/PATCH/DELETE /api/brownfield/targets/[targetId] — 후보 1건 상세·수정·삭제
// (전용 상세 화면용, 2026-09-15). GET은 후보 행 + 소속 기회 + 재무·기술 평가
// 카탈로그·판정·100점 점수를 한 번에 내려준다. PATCH는 회사명·DART 고유번호·
// 목표 시장 근거를 수정하고(등록 후 수정 가능 — 사용자 요청), DELETE는 후보와
// 그 평가 판정을 삭제한다(analyst+, 감사 기록).
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { fail, badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import {
  findPatchCollision,
  screeningItems,
  screeningSummary,
  updateTargetFields,
  type TargetRow,
} from "../../../../../lib/brownfield-targets.ts";
import {
  combinedEvalScore,
  computeEvalScore,
  detectCriteriaReconcile,
  targetEvalStates,
} from "../../../../../lib/brownfield-eval-criteria.ts";

export async function GET(request: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { targetId } = await params;
  const db = getDb();
  const target = db
    .query(
      `SELECT bt.*,
         COALESCE(
           (SELECT mc.id FROM md_company mc WHERE bt.dart_corp_code IS NOT NULL AND mc.dart_corp_code = bt.dart_corp_code),
           (SELECT mc.id FROM md_company mc WHERE mc.name_ko = bt.company_name)
         ) AS company_id
       FROM brownfield_target bt WHERE bt.id = ?`,
    )
    .get(targetId) as Record<string, unknown> | undefined;
  if (!target) return notFound();
  const oppId = target.opportunity_id as string;
  const opp = db.query("SELECT id, name, market_scope FROM opportunity WHERE id = ?").get(oppId) as
    | { id: string; name: string; market_scope: string | null }
    | undefined;
  if (!opp) return notFound();
  const evalItems = targetEvalStates(oppId, targetId, auth.auth.userId);
  const scores = computeEvalScore(evalItems);
  // 사전 검토 근거(참고 저장소) — 위원회 추천 검토·등록·재분석에서 수집된
  // 정보를 후보 상세에서 나중에 참고할 수 있게 내려준다(사용자 결정, 2026-09-16).
  const evidence = db
    .query(
      `SELECT id, kind, title, detail, source_url, source_kind, created_by, created_at
       FROM brownfield_target_evidence WHERE target_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`,
    )
    .all(targetId);
  return ok(
    {
      target,
      opportunity: opp,
      evalItems,
      scores: { ...scores, combined: combinedEvalScore(scores) },
      checklist: screeningItems(),
      screening_summary: screeningSummary(target as unknown as TargetRow),
      evidence,
      // ADR-0171 D6: S3 rows added/removed/renamed since the technical criteria were seeded.
      reconcile: detectCriteriaReconcile(oppId, db),
    },
    200,
  );
}

const now = () => new Date().toISOString();

/** PATCH — 후보 정보 수정(회사명·DART 고유번호·목표 시장 근거).
 * design 2026-11-11 §5.2 (D4) — updateTargetFields 하나로 위임한다
 * (정규화 → 행 갱신 → 항상 회사 마스터 재연결 → 감사 1형태). */
export async function PATCH(request: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", {
    viewerMessage: "Candidate updates require the analyst role or higher.",
  });
  if (denied) return denied;
  const { targetId } = await params;
  const body = (await request.json().catch(() => null)) as {
    company_name?: string;
    dart_corp_code?: string | null;
    universe_note?: string | null;
  } | null;
  if (body?.company_name !== undefined && !body.company_name.trim()) {
    return badRequest("invalid_request", "company_name cannot be blank.");
  }
  const db = getDb();
  const existing = db.query("SELECT id FROM brownfield_target WHERE id = ?").get(targetId) as
    | { id: string }
    | undefined;
  if (!existing) return notFound();
  // design 2026-11-11 §5.1 — PATCH collision onto a sibling is a 409 with
  // existing_target_id; merging targets stays a human action (no auto-merge).
  const collision = findPatchCollision(db, targetId, body ?? {});
  if (collision) {
    return fail(
      409,
      "duplicate_target",
      `'${collision.company_name}' is already on the Long List — merging targets is a manual step.`,
      {
        existing_target_id: collision.id,
      },
    );
  }
  return ok(updateTargetFields(db, targetId, body ?? {}, { actorUserId: auth.auth.userId }), 200);
}

/** DELETE — 후보 삭제. 평가 판정(brownfield_target_eval_state)을 먼저 지우고
 * 후보 행을 삭제한다. 제외(excluded)와 달리 레코드가 남지 않는 완전 삭제이며
 * 감사 기록으로 추적한다. */
export async function DELETE(request: Request, { params }: { params: Promise<{ targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", {
    viewerMessage: "Candidate deletion requires the analyst role or higher.",
  });
  if (denied) return denied;
  const { targetId } = await params;
  const db = getDb();
  const existing = db.query("SELECT id, company_name FROM brownfield_target WHERE id = ?").get(targetId) as
    | { id: string; company_name: string }
    | undefined;
  if (!existing) return notFound();
  // migration 0120 (ADR-0143): business_case_model.target_id references this
  // target — deleting an analyzed target would throw a raw FK error (500).
  const caseCount = db.query("SELECT COUNT(*) AS n FROM business_case_model WHERE target_id = ?").get(targetId) as {
    n: number;
  };
  if (caseCount.n > 0) {
    return fail(
      409,
      "target_has_cases",
      `A target with S8 analyses cannot be deleted — delete the target's ${caseCount.n} Business Case(s) first.`,
    );
  }
  db.transaction(() => {
    db.run("DELETE FROM brownfield_target_eval_state WHERE brownfield_target_id = ?", [targetId]);
    db.run("DELETE FROM brownfield_target_capability_judgement WHERE brownfield_target_id = ?", [targetId]);
    db.run("DELETE FROM brownfield_target WHERE id = ?", [targetId]);
  })();
  appendAudit(db, {
    actor: auth.auth.userId,
    action: "brownfield_target.delete",
    target: `${existing.company_name}:${targetId}`,
    now: now(),
  });
  return ok({ deleted: true, id: targetId }, 200);
}
