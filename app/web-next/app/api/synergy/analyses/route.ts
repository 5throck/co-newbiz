// S3 시너지 정합성 — 회사 등록 후 분석 생성 (POST, analyst+) / 목록 (GET).
// 회사는 md_company에 등록(DART corp code 가능 시 저장)되며, 하나의 회사에
// 하나의 진행 중 분석만 허용된다.
import { getDb } from "../../../../../../db/client.ts";
import { ulid } from "../../../../../../db/lib/ulid.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../lib/auth.ts";
import { badRequest, ok } from "../../../../lib/envelope.ts";
import { runSynergyPipeline } from "../../../../lib/synergy-pipeline.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const db = getDb();
  const analyses = db
    .query(
      `SELECT sa.id, sa.status, sa.current_step, sa.created_at, sa.completed_at,
              sa.rerun_in_progress, sa.error_message,
              c.id AS company_id, c.name_ko AS company_name, c.dart_corp_code,
              sa.target_type, sa.opportunity_id, o.name AS opportunity_name,
              sa.member_id, sa.group_id,
              m.company_name AS member_name, g.name AS group_name,
              (SELECT MAX(version_no) FROM synergy_version v WHERE v.analysis_id = sa.id) AS latest_version
       FROM synergy_analysis sa JOIN md_company c ON c.id = sa.company_id
       LEFT JOIN opportunity o ON o.id = sa.opportunity_id
       LEFT JOIN company_group_member m ON m.id = sa.member_id
       LEFT JOIN company_group g ON g.id = sa.group_id
       WHERE sa.deleted_at IS NULL
         AND (sa.opportunity_id IS NULL OR o.deleted_at IS NULL)
       ORDER BY sa.created_at DESC`,
    )
    .all();
  return ok({ analyses }, 200, { count: analyses.length });
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "시너지 분석 생성은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;

  let body: { targetType?: "affiliate" | "group"; memberId?: string; groupId?: string; opportunityId?: string; source_ref?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("invalid_json", "Request body must be JSON.");
  }

  const targetType = body.targetType;
  if (targetType !== "affiliate" && targetType !== "group") {
    return badRequest("target_required", "targetType은 affiliate | group 중 하나입니다 (ADR-0090 — 별도 회사 등록 제거).");
  }
  const memberId = targetType === "affiliate" ? body.memberId?.trim() || null : null;
  const groupId = targetType === "group" ? body.groupId?.trim() || null : null;
  if (targetType === "affiliate" && !memberId) return badRequest("member_required", "계열사 대상 분석에는 memberId가 필요합니다.");
  if (targetType === "group" && !groupId) return badRequest("group_required", "그룹 대상 분석에는 groupId가 필요합니다.");

  const db = getDb();
  const now = new Date().toISOString();

  // 대상 프로파일 존재 검증 — 시너지 파이프라인은 그룹/계열사 분석의 최신 프로파일을 재사용한다 (ADR-0090).
  if (targetType === "affiliate") {
    const member = db.query("SELECT company_name FROM company_group_member WHERE id = ?").get(memberId) as { company_name: string } | undefined;
    if (!member) return badRequest("member_not_found", "계열사를 찾을 수 없습니다.");
    const hasProfile = db.query("SELECT 1 FROM company_profile_version WHERE member_id = ? LIMIT 1").get(memberId);
    if (!hasProfile) return badRequest("profile_required", `"${member.company_name}"의 프로파일이 없습니다 — 그룹/계열사 분석 화면에서 먼저 분석하세요.`);
  } else {
    const group = db.query("SELECT name FROM company_group WHERE id = ?").get(groupId) as { name: string } | undefined;
    if (!group) return badRequest("group_not_found", "그룹을 찾을 수 없습니다.");
    const withProfile = db.query(
      `SELECT COUNT(*) c FROM company_group_member m
       WHERE m.group_id = ? AND EXISTS (SELECT 1 FROM company_profile_version v WHERE v.member_id = m.id)`,
    ).get(groupId) as { c: number };
    if (withProfile.c === 0) return badRequest("profile_required", `"${group.name}" 그룹에 프로파일이 있는 계열사가 없습니다 — 그룹/계열사 분석을 먼저 실행하세요.`);
  }

  const opportunityId = body.opportunityId?.trim() || null;
  if (opportunityId) {
    const opp = db.query("SELECT id, name FROM opportunity WHERE id = ?").get(opportunityId) as { name: string } | undefined;
    if (!opp) return badRequest("opportunity_not_found", "연결할 기회를 찾을 수 없습니다.");
  }

  const analysisId = ulid();
  db.run(
    `INSERT INTO synergy_analysis (id, company_id, acquirer_company_id, status, current_step, source_ref, created_by, created_at,
                                   target_type, member_id, group_id, opportunity_id)
     VALUES (?, 'md-synergy-registry-sentinel', NULL, 'in_progress', 0, ?, ?, ?, ?, ?, ?, ?)`,
    [analysisId, body.source_ref?.trim() || null, ctx.userId, now, targetType, memberId, groupId, opportunityId],
  );
  appendAudit(db, { actor: ctx.userId, action: "synergy_analysis.create", target: analysisId, now });

  void runSynergyPipeline(db, analysisId).catch((err) => {
    console.error("synergy pipeline failed:", err);
  });

  return ok({ analysis_id: analysisId, reused: false }, 201, { status: "in_progress" });
}
