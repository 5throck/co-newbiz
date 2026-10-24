// GET /api/projects/[id]/wacc/suggestions — WACC reference values for the
// project's bound subject company (ADR-0116 Phase 4). Proposal-only: the
// caller prefills the WACC session inputs; the human-confirmed scalar stays
// kind='user' on the project run. Fails soft — missing series/facts come
// back as explicit null entries with reasons, never placeholders.
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { listProjectAnalysisTargets } from "../../../../../../../../db/lib/wacc.ts";
import { computeWaccReference } from "../../../../../../../../db/lib/wacc-reference.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true });
  if (!project) return notFound();
  const db = getDb();
  // ADR-0156: ?target_id= asks for a shortlisted target's company instead of the bound subject.
  const targetId = new URL(request.url).searchParams.get("target_id");
  let companyId = (db.query("SELECT company_id FROM md_project WHERE id = ?").get(id) as { company_id: string | null } | undefined)?.company_id ?? null;
  if (targetId) {
    const t = listProjectAnalysisTargets(db, id).find((x) => x.targetId === targetId);
    if (!t || !t.companyId) return badRequest("invalid_request", "target_id must be a shortlisted target (a company that can be analyzed).");
    companyId = t.companyId;
  }
  if (!companyId) {
    return ok(
      { suggestions: [], missing: ["대상 회사가 연결되지 않았습니다 — 재무분석 탭에서 연결하세요"], subject: null },
      200,
      { suggestion_count: 0 },
    );
  }
  const reference = computeWaccReference(db, companyId);
  const byKey = new Map(reference.entries.map((e) => [e.key, e]));
  const suggestion = (key: string) => {
    const e = byKey.get(key);
    if (!e || e.value === null) return { key, value: null, reason: e?.reason ?? "데이터 없음" };
    return { key, value: e.value, as_of: e.as_of, anchor_ref: e.anchor_ref, source_label: e.source_label, note: e.note ?? null };
  };
  const suggestions = [suggestion("risk_free"), suggestion("credit_spread"), suggestion("observed_de")];
  return ok(
    { subject: reference.subject, suggestions, missing: reference.missing },
    200,
    { suggestion_count: suggestions.filter((s) => s.value !== null).length },
  );
}
