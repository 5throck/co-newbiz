// Market-sizing analyses — create a new industry analysis that runs the
// systematic-market-sizing pipeline (POST, analyst+; the pipeline itself runs
// async so the UI can show the "분석 중" state), and list recent analyses.
import { getDb } from "../../../../../../db/client.ts";
import { ulid } from "../../../../../../db/lib/ulid.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { forbidden, badRequest, fail, ok } from "../../../../lib/envelope.ts";
import { runSizingPipeline } from "../../../../lib/market-sizing-pipeline.ts";
import { parseKsicInput } from "../../../../lib/ksic.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const db = getDb();
  const analyses = db
    .query(
      `SELECT a.id, a.status, a.current_step, a.created_at, a.completed_at,
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

  let body: { name_ko?: string; ksic_code?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("invalid_json", "Request body must be JSON.");
  }
  const nameKo = body.name_ko?.trim();
  if (!nameKo) return badRequest("name_required", "산업명(name_ko)은 필수입니다.");
  const ksic = parseKsicInput(body.ksic_code);
  if (!ksic.ok) return badRequest("invalid_ksic_code", ksic.reason);
  const ksicCode = ksic.code;

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
  const existing = db
    .query("SELECT id FROM market_sizing_analysis WHERE industry_id = ? AND status = 'in_progress'")
    .get(industry.id) as { id: string } | null;
  if (existing) return ok({ analysis_id: existing.id, reused: true }, 200, { status: "in_progress" });

  const analysisId = ulid();
  db.run(
    `INSERT INTO market_sizing_analysis (id, industry_id, status, current_step, methodology_version, created_by, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [analysisId, industry.id, "in_progress", 0, "1.1.0", ctx.userId, now],
  );
  appendAudit(db, {
    actor: ctx.userId,
    action: "market_sizing_analysis.create",
    target: analysisId,
    now,
  });

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
