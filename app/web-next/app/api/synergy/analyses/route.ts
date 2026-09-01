// S3 시너지 정합성 — 회사 등록 후 분석 생성 (POST, analyst+) / 목록 (GET).
// 회사는 md_company에 등록(DART corp code 가능 시 저장)되며, 하나의 회사에
// 하나의 진행 중 분석만 허용된다.
import { getDb } from "../../../../../../db/client.ts";
import { ulid } from "../../../../../../db/lib/ulid.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { badRequest, forbidden, ok } from "../../../../lib/envelope.ts";
import { runSynergyPipeline } from "../../../../lib/synergy-pipeline.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const db = getDb();
  const analyses = db
    .query(
      `SELECT sa.id, sa.status, sa.current_step, sa.created_at, sa.completed_at,
              c.id AS company_id, c.name_ko AS company_name, c.dart_corp_code,
              (SELECT MAX(version_no) FROM synergy_version v WHERE v.analysis_id = sa.id) AS latest_version
       FROM synergy_analysis sa JOIN md_company c ON c.id = sa.company_id
       ORDER BY sa.created_at DESC`,
    )
    .all();
  return ok({ analyses }, 200, { count: analyses.length });
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "시너지 분석 생성은 analyst 역할 이상이어야 합니다.");

  let body: { company_name?: string; acquirer_name?: string; dart_corp_code?: string; source_ref?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("invalid_json", "Request body must be JSON.");
  }
  const companyName = body.company_name?.trim();
  if (!companyName) return badRequest("company_required", "M&A 대상 기업명(company_name)은 필수입니다.");
  const acquirerName = body.acquirer_name?.trim() || null; // 인수 주체 (선택)
  const dartCode = body.dart_corp_code?.trim() || null;

  const db = getDb();
  const now = new Date().toISOString();

  const findOrCreate = (name: string, code: string | null): { id: string } => {
    let c = db.query("SELECT id FROM md_company WHERE name_ko = ?").get(name) as { id: string } | null;
    if (!c) {
      const id = ulid();
      db.run(
        "INSERT INTO md_company (id, dart_corp_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)",
        [id, code, name, null, now],
      );
      c = { id };
    } else if (code) {
      db.run("UPDATE md_company SET dart_corp_code = ? WHERE id = ? AND (dart_corp_code IS NULL OR dart_corp_code = '')", [code, c.id]);
    }
    return c;
  };

  const company = findOrCreate(companyName, dartCode); // M&A 대상 기업
  const acquirer = acquirerName ? findOrCreate(acquirerName, null) : null;

  // 회사당 분석 행은 하나 — 재분석 시 같은 행을 재사용하고 파이프라인이
  // 새 버전(append-only)을 쌓는다. 회사별 목록 중복을 방지한다.
  const existing = db
    .query("SELECT id, status FROM synergy_analysis WHERE company_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(company.id) as { id: string; status: string } | null;
  if (existing) {
    if (existing.status === "in_progress") {
      return ok({ analysis_id: existing.id, reused: true }, 200, { status: "in_progress" });
    }
    db.run(
      "UPDATE synergy_analysis SET status = 'in_progress', current_step = 0, completed_at = NULL, acquirer_company_id = COALESCE(?, acquirer_company_id) WHERE id = ?",
      [acquirer?.id ?? null, existing.id],
    );
    appendAudit(db, { actor: ctx.userId, action: "synergy_analysis.rerun", target: existing.id, now });
    void runSynergyPipeline(db, existing.id).catch((err) => {
      console.error("synergy pipeline rerun failed:", err);
    });
    return ok({ analysis_id: existing.id, reused: true }, 200, { rerun: true });
  }

  const analysisId = ulid();
  db.run(
    `INSERT INTO synergy_analysis (id, company_id, acquirer_company_id, status, current_step, source_ref, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [analysisId, company.id, acquirer?.id ?? null, "in_progress", 0, body.source_ref?.trim() || null, ctx.userId, now],
  );
  appendAudit(db, { actor: ctx.userId, action: "synergy_analysis.create", target: analysisId, now });

  void runSynergyPipeline(db, analysisId).catch((err) => {
    console.error("synergy pipeline failed:", err);
  });

  return ok({ analysis_id: analysisId, reused: false }, 201, { status: "in_progress" });
}
