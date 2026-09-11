// GET /api/projects/[id]/wacc/suggestions — WACC reference values for the
// project's bound subject company (ADR-0116 Phase 4). Proposal-only: the
// caller prefills the WACC session inputs; the human-confirmed scalar stays
// kind='user' on the project run. Fails soft — missing series/facts come
// back as explicit null entries with reasons, never placeholders.
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { computeWaccReference } from "../../../../../../../../db/lib/wacc-reference.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true });
  if (!project) return notFound();
  const db = getDb();
  const company = db.query("SELECT company_id FROM md_project WHERE id = ?").get(id) as { company_id: string | null } | undefined;
  if (!company?.company_id) {
    return ok(
      { suggestions: [], missing: ["대상 회사가 연결되지 않았습니다 — 재무분석 탭에서 연결하세요"], subject: null },
      200,
      { suggestion_count: 0 },
    );
  }
  const reference = computeWaccReference(db, company.company_id);
  const byKey = new Map(reference.entries.map((e) => [e.key, e]));
  const suggestion = (key: string) => {
    const e = byKey.get(key);
    if (!e || e.value === null) return { key, value: null, reason: e?.reason ?? "데이터 없음" };
    return { key, value: e.value, as_of: e.as_of, anchor_ref: e.anchor_ref, source_label: e.source_label };
  };
  const suggestions = [suggestion("risk_free"), suggestion("credit_spread"), suggestion("observed_de")];
  return ok(
    { subject: reference.subject, suggestions, missing: reference.missing },
    200,
    { suggestion_count: suggestions.filter((s) => s.value !== null).length },
  );
}
