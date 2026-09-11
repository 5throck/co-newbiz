// GET/POST/DELETE /api/projects/[id]/industries — the project↔industry
// binding REST surface (ADR-0116 Phase 5). Delegates to the ADR-0056
// repository (bind/retire with mandatory rationale, supersede history,
// audit + data-access rows) — the repository had zero callers until now,
// so agents could not reach it through ADR-0011's REST-only rule.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { bindIndustry, getLiveBindings, retireIndustry } from "../../../../../../../db/repositories/project-industry.repository.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();
  const bindings = getLiveBindings(id, db).map((b) => ({
    ...b,
    industry_name: (db.query("SELECT name_ko FROM md_industry WHERE id = ?").get(b.industry_id) as { name_ko: string } | undefined)?.name_ko ?? null,
  }));
  return ok({ bindings }, 200, { count: bindings.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "산업 바인딩은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();

  const body = (await request.json().catch(() => null)) as { industry_id?: string; rationale?: string } | null;
  const industryId = body?.industry_id?.trim();
  const rationale = body?.rationale?.trim();
  if (!industryId) return badRequest("industry_id_required", "바인딩할 산업을 지정하세요.");
  if (!rationale) return badRequest("rationale_required", "바인딩 근거(rationale)는 필수입니다 — 판정 기록 행위입니다.");

  const db = getDb();
  if (!db.query("SELECT id FROM md_industry WHERE id = ?").get(industryId)) {
    return badRequest("industry_not_found", "산업을 찾을 수 없습니다 — 관리자 콘솔 › 마스터 데이터에 먼저 등록하세요.");
  }
  try {
    const row = bindIndustry({
      project_id: id,
      industry_id: industryId,
      bound_by: auth.auth.userId,
      rationale,
    }, db);
    return ok({ binding: row }, 201, { binding_id: row.id });
  } catch (err) {
    return badRequest("binding_rejected", err instanceof Error ? err.message : "산업 바인딩에 실패했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "산업 바인딩 회수는 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();

  const url = new URL(request.url);
  const industryId = url.searchParams.get("industry_id")?.trim();
  const rationale = url.searchParams.get("rationale")?.trim();
  if (!industryId) return badRequest("industry_id_required", "회수할 산업을 지정하세요.");
  if (!rationale) return badRequest("rationale_required", "회수 근거(rationale)는 필수입니다.");

  try {
    const row = retireIndustry({
      project_id: id,
      industry_id: industryId,
      retired_by: auth.auth.userId,
      rationale,
    }, getDb());
    return ok({ binding: row }, 200, { retired: true });
  } catch (err) {
    return badRequest("retire_rejected", err instanceof Error ? err.message : "산업 바인딩 회수에 실패했습니다.");
  }
}
