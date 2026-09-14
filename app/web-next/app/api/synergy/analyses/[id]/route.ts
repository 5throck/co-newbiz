// One synergy analysis: status (for the "분석 중" polling) + versions with
// parsed payloads. GET is read-only for any authenticated role.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();

  const analysis = db
    .query(
      `SELECT sa.id, sa.status, sa.current_step, sa.created_by, sa.created_at, sa.completed_at, sa.source_ref,
              c.id AS company_id, c.name_ko AS company_name, c.dart_corp_code,
              ac.name_ko AS acquirer_name,
              sa.target_type, sa.opportunity_id, o.name AS opportunity_name,
              m.company_name AS member_name, g.name AS group_name
       FROM synergy_analysis sa
       JOIN md_company c ON c.id = sa.company_id
       LEFT JOIN md_company ac ON ac.id = sa.acquirer_company_id
       LEFT JOIN opportunity o ON o.id = sa.opportunity_id
       LEFT JOIN company_group_member m ON m.id = sa.member_id
       LEFT JOIN company_group g ON g.id = sa.group_id
       WHERE sa.id = ?`,
    )
    .get(id) as
    | { id: string; status: string; current_step: number; created_by: string; created_at: string; completed_at: string | null; source_ref: string | null; company_id: string; company_name: string; dart_corp_code: string | null; acquirer_name: string | null }
    | null;
  if (!analysis) return notFound();

  const versions = db
    .query(
      `SELECT version_no, payload, changelog, created_by, created_at
       FROM synergy_version WHERE analysis_id = ? ORDER BY version_no DESC`,
    )
    .all(id) as Array<{ version_no: number; payload: string; changelog: string | null; created_by: string; created_at: string }>;
  const parsed = versions.map((v) => {
    try {
      return { ...v, payload: JSON.parse(v.payload) as unknown };
    } catch {
      return { ...v, payload: null };
    }
  });

  // ADR-0125 — 사람 큐레이션 레이어를 최신 버전에만 병합한다. payload 자체는
  // append-only 스냅샷이라 건드리지 않고, 응답에서만 겹쳐 보여준다. 과거
  // 버전(versions[1..])에는 병합하지 않는다 — 큐레이션은 "현재"에 대한
  // 오버레이이지 과거 스냅샷의 소급 수정이 아니다.
  const latest = parsed[0];
  if (latest?.payload && typeof latest.payload === "object") {
    const payload = latest.payload as {
      marketLinkage?: { synergyAreas?: Array<Record<string, unknown>> };
      shortList?: Array<{ rank: number; area: string; verdict: string; reason: string }>;
    };

    const linkageAdditions = db
      .query(
        `SELECT id, area, synergy_type, rationale, opportunity, risk, sources_json, created_by, created_at
         FROM synergy_linkage_item WHERE analysis_id = ? ORDER BY created_at`,
      )
      .all(id) as Array<{ id: string; area: string; synergy_type: string; rationale: string; opportunity: string | null; risk: string | null; sources_json: string | null; created_by: string; created_at: string }>;
    if (payload.marketLinkage) {
      const llmAreas = (payload.marketLinkage.synergyAreas ?? []).map((a) => ({ ...a, origin: "llm" as const }));
      const humanAreas = linkageAdditions.map((a) => ({
        area: a.area, synergyType: a.synergy_type, rationale: a.rationale,
        opportunity: a.opportunity ?? "", risk: a.risk ?? "",
        sources: a.sources_json ? (JSON.parse(a.sources_json) as string[]) : [],
        origin: "human" as const, createdBy: a.created_by, createdAt: a.created_at,
      }));
      payload.marketLinkage = { ...payload.marketLinkage, synergyAreas: [...llmAreas, ...humanAreas] };
    }

    const curationRows = db
      .query(`SELECT area, origin, verdict, reason, rank, updated_by, updated_at FROM synergy_shortlist_curation WHERE analysis_id = ?`)
      .all(id) as Array<{ area: string; origin: "llm" | "human"; verdict: string; reason: string; rank: number | null; updated_by: string | null; updated_at: string | null }>;
    const curationByArea = new Map(curationRows.map((r) => [r.area, r]));
    const baseAreas = new Set((payload.shortList ?? []).map((s) => s.area));
    interface MergedShortListItem { rank: number; area: string; verdict: string; reason: string; origin: "llm" | "human"; editedBy: string | null; editedAt: string | null }
    const mergedShortList: MergedShortListItem[] = (payload.shortList ?? []).map((s, i) => {
      const c = curationByArea.get(s.area);
      return {
        rank: s.rank ?? i + 1,
        area: s.area,
        verdict: c?.verdict ?? s.verdict,
        reason: c?.reason ?? s.reason,
        origin: "llm",
        editedBy: c?.updated_by ?? null,
        editedAt: c?.updated_at ?? null,
      };
    });
    for (const r of curationRows) {
      if (r.origin === "human" && !baseAreas.has(r.area)) {
        mergedShortList.push({ rank: r.rank ?? mergedShortList.length + 1, area: r.area, verdict: r.verdict, reason: r.reason, origin: "human", editedBy: r.updated_by, editedAt: r.updated_at });
      }
    }
    payload.shortList = mergedShortList as unknown as Array<{ rank: number; area: string; verdict: string; reason: string }>;
  }

  return ok({ ...analysis, versions: parsed }, 200, { status: analysis.status, versions: parsed.length });
}

// DELETE — 시너지 분석 삭제 (deletion mark, never row removal).
// 살아있는 검토/안건(selected 기회 또는 승격 프로젝트)의 전략적 근거인 시너지 분석은
// 단독 삭제를 거부한다 — 근거가 검토/안건보다 먼저 사라지는 상황을 원천 차단.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "시너지 분석 삭제는 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const db = getDb();
  const analysis = db
    .query(
      `SELECT sa.id, sa.deleted_at, sa.status, sa.rerun_in_progress, o.status AS opp_status, o.project_id, o.deleted_at AS opp_deleted_at
       FROM synergy_analysis sa
       LEFT JOIN opportunity o ON o.id = sa.opportunity_id
       WHERE sa.id = ?`,
    )
    .get(id) as
    | { id: string; deleted_at: string | null; status: string; rerun_in_progress: number; opp_status: string | null; project_id: string | null; opp_deleted_at: string | null }
    | null;
  if (!analysis) return notFound();
  if (analysis.deleted_at) return badRequest("already_deleted", "이 시너지 분석은 이미 삭제 표시되어 있습니다.");
  if (analysis.status === "in_progress" || analysis.rerun_in_progress) {
    return fail(409, "analysis_running", "이 시너지 분석은 분석(또는 재분석)이 진행 중이어서 삭제할 수 없습니다 — 완료 후 다시 시도하세요.");
  }
  if (!analysis.opp_deleted_at && (analysis.opp_status === "selected" || analysis.project_id)) {
    return fail(
      409,
      "synergy_basis_in_use",
      "이 시너지 분석은 진행 중인 검토/안건의 전략적 근거입니다. 해당 검토/안건을 삭제 또는 보관한 뒤 다시 시도하세요.",
    );
  }
  const now = new Date().toISOString();
  db.run("UPDATE synergy_analysis SET deleted_at = ?, deleted_by = ?, delete_reason = ? WHERE id = ?", [
    now,
    ctx.userId,
    `deleted by ${ctx.userId}`,
    id,
  ]);
  appendAudit(db, { actor: ctx.userId, action: "synergy.analysis_delete", target: id, now });
  return ok({ deleted: id }, 200);
}
