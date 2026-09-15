// Market-sizing analyses — create a new industry analysis that runs the
// systematic-market-sizing pipeline (POST, analyst+; the pipeline itself runs
// async so the UI can show the "분석 중" state), and list recent analyses.
import { getDb } from "../../../../../../db/client.ts";
import { ulid } from "../../../../../../db/lib/ulid.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { forbidden, badRequest, fail, ok } from "../../../../lib/envelope.ts";
import { runSizingPipeline, releaseQueueNext } from "../../../../lib/market-sizing-pipeline.ts";
import { parseKsicInput } from "../../../../lib/ksic.ts";
import { stripCitationMarkers } from "../../../../lib/value-chain-proposals.ts";

const LINKED_RELATIONS = ["전방", "전전방", "후방", "후후방"];

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const db = getDb();
  const analyses = db
    .query(
      `SELECT a.id, a.status, a.current_step, a.created_at, a.completed_at,
              a.after_analysis_id, a.linked_relation, a.started_at, a.error_message,
              i.id AS industry_id, i.name_ko, i.ksic_code,
              (SELECT MAX(version_no) FROM market_sizing_version v WHERE v.analysis_id = a.id) AS latest_version
       FROM market_sizing_analysis a JOIN md_industry i ON i.id = a.industry_id
       ORDER BY a.created_at DESC`,
    )
    .all();
  return ok({ analyses }, 200, { count: analyses.length });
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "신규 산업 분석 생성은 analyst 역할 이상이어야 합니다.");

  let body: { name_ko?: string; ksic_code?: string; after_analysis_id?: string; linked_relation?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("invalid_json", "Request body must be JSON.");
  }
  // 산업명은 저장·표시용 식별자 — LLM 제안 등에서 붙은 인용 표기([2] 등)가
  // 섞여 들어오지 않도록 저장 전에 제거한다(사용자 리포트, 2026-09-16).
  const nameKo = body.name_ko?.trim() ? stripCitationMarkers(body.name_ko.trim()) : undefined;
  if (!nameKo) return badRequest("name_required", "산업명(name_ko)은 필수입니다.");
  const ksic = parseKsicInput(body.ksic_code);
  if (!ksic.ok) return badRequest("invalid_ksic_code", ksic.reason);
  const ksicCode = ksic.code;

  // 직렬 큐 앵커(설계 2026-09-13) — 재분석 모달에서 연계 산업을 고르면
  // after_analysis_id(재분석 중인 대상)에 채워 온다. 대상이 in_progress면
  // pending으로 대기시키고 완료 후 한 건씩 자동 시작된다.
  const afterId = body.after_analysis_id?.trim() || null;
  const linkedRelation = body.linked_relation?.trim() || null;
  if (linkedRelation && !LINKED_RELATIONS.includes(linkedRelation)) {
    return badRequest("invalid_relation", "linked_relation은 전방 | 전전방 | 후방 | 후후방 중 하나입니다.");
  }

  const db = getDb();
  const now = new Date().toISOString();

  // One active analysis per industry: reuse an existing one (name-based dedup)
  // instead of stacking — a supplied KSIC code is applied to that industry
  // (fill-or-update), never silently dropped.
  let industry = db
    .query("SELECT id, ksic_code FROM md_industry WHERE name_ko = ?")
    .get(nameKo) as { id: string; ksic_code: string | null } | null;
  if (!industry) {
    const id = ulid();
    try {
      // ksic_code is nullable (ADR-0111): no code → NULL ("미지정"), never a
      // fabricated placeholder. The UNIQUE index still guards real collisions.
      db.run(
        "INSERT INTO md_industry (id, ksic_code, naics_code, isic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?,?,?)",
        [id, ksicCode, null, null, nameKo, nameKo, now],
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE")) {
        return fail(409, "code_in_use", `KSIC 코드 ${ksicCode}는 이미 다른 산업에 할당되어 있습니다. 인라인 편집으로 기존 산업을 확인하세요.`);
      }
      throw err;
    }
    industry = { id, ksic_code: ksicCode };
  } else if (ksicCode && industry.ksic_code !== ksicCode) {
    try {
      db.run("UPDATE md_industry SET ksic_code = ? WHERE id = ?", [ksicCode, industry.id]);
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE")) {
        return fail(409, "code_in_use", `KSIC 코드 ${ksicCode}는 이미 다른 산업에 할당되어 있습니다.`);
      }
      throw err;
    }
    industry = { ...industry, ksic_code: ksicCode };
  }

  // 앵커 검증 — 존재, 자기 참조 금지, 실패/대기 앵커에는 큐잉 금지(패널 P1-5).
  let anchor: { id: string; status: string; industry_id: string } | null = null;
  if (afterId) {
    anchor = db
      .query("SELECT id, status, industry_id FROM market_sizing_analysis WHERE id = ?")
      .get(afterId) as { id: string; status: string; industry_id: string } | null;
    if (!anchor) return badRequest("anchor_not_found", "선행 분석(after_analysis_id)을 찾을 수 없습니다.");
    if (anchor.industry_id === industry.id) return badRequest("anchor_self", "선행 분석과 대상 산업이 같습니다.");
    if (anchor.status === "failed") return fail(409, "anchor_not_ready", "선행 분석이 실패한 상태입니다 — 먼저 재분석을 완료한 뒤 연계 산업을 추가하세요.");
    if (anchor.status === "pending") return fail(409, "anchor_not_ready", "선행 분석이 아직 대기 중입니다 — 대기 중인 분석에는 연계를 추가할 수 없습니다.");
  }

  // One active analysis per industry: reuse an existing in_progress or queued
  // (pending) analysis instead of stacking duplicates.
  const existing = db
    .query("SELECT id FROM market_sizing_analysis WHERE industry_id = ? AND status = 'in_progress'")
    .get(industry.id) as { id: string } | null;
  if (existing) return ok({ analysis_id: existing.id, reused: true }, 200, { status: "in_progress" });
  const existingPending = db
    .query("SELECT id FROM market_sizing_analysis WHERE industry_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1")
    .get(industry.id) as { id: string } | null;
  if (existingPending) return ok({ analysis_id: existingPending.id, reused: true }, 200, { status: "pending" });

  // Anchor states: a running anchor queues the new analysis ('pending'); a
  // completed anchor just runs immediately (anchor kept for provenance).
  const queued = anchor !== null && anchor.status === "in_progress";
  const analysisId = ulid();
  db.run(
    `INSERT INTO market_sizing_analysis (id, industry_id, status, current_step, methodology_version, created_by, created_at, after_analysis_id, linked_relation)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [analysisId, industry.id, queued ? "pending" : "in_progress", 0, "1.1.0", ctx.userId, now, afterId, linkedRelation],
  );
  appendAudit(db, {
    actor: ctx.userId,
    action: "market_sizing_analysis.create",
    target: analysisId,
    now,
  });

  if (queued) {
    // 대기 등록 — 파이프라인을 지금 돌리지 않는다(202). 앵커(대상 재분석) 완료
    // 훅이 직렬 큐에서 한 건씩 시작한다. 훅이 동작하지 않은 잔여 대기는
    // watch:run 회수 패스가 담당한다.
    return ok({ analysis_id: analysisId, reused: false, deferred: true, after_analysis_id: afterId }, 202, { status: "pending" });
  }

  // Fire-and-forget: the pipeline advances current_step and flips the status
  // to 'completed' when done, so the UI can poll the "분석 중" state.
  void runSizingPipeline(db, analysisId).catch((err) => {
    console.error("market-sizing pipeline failed:", err);
    // Defense in depth: the pipeline itself marks the row 'failed' on error,
    // but if the failure happened before it could write (e.g. DB connection
    // failure), this catch is the last chance to avoid a stuck 'in_progress' row.
    try {
      db.run(
        "UPDATE market_sizing_analysis SET status = 'failed', error_message = ? WHERE id = ? AND status = 'in_progress'",
        [(err instanceof Error ? err.message : String(err)).slice(0, 2000), analysisId],
      );
    } catch (dbErr) {
      console.error("market-sizing pipeline: failed to mark analysis failed:", dbErr);
    }
  });

  return ok({ analysis_id: analysisId, reused: false }, 201, { status: "in_progress" });
}
