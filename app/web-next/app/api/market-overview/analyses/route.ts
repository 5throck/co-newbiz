// Market-sizing analyses — create a new industry analysis that runs the
// systematic-market-sizing pipeline (POST, analyst+; the pipeline itself runs
// async so the UI can show the "분석 중" state), and list recent analyses.
import { getDb } from "../../../../../../db/client.ts";
import { ulid } from "../../../../../../db/lib/ulid.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { forbidden, badRequest, ok } from "../../../../lib/envelope.ts";
import { runSizingPipeline } from "../../../../lib/market-sizing-pipeline.ts";

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
  const ksicCode = body.ksic_code?.trim() || null;

  const db = getDb();
  const now = new Date().toISOString();

  // One active analysis per industry: reuse an in_progress one instead of stacking.
  let industry = db
    .query("SELECT id FROM md_industry WHERE name_ko = ?")
    .get(nameKo) as { id: string } | null;
  if (!industry) {
    const id = ulid();
    db.run(
      "INSERT INTO md_industry (id, ksic_code, naics_code, isic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?,?,?)",
      [id, ksicCode ?? `NEW-${id.slice(-6)}`, null, null, nameKo, nameKo, now],
    );
    industry = { id };
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
  });

  return ok({ analysis_id: analysisId, reused: false }, 201, { status: "in_progress" });
}
