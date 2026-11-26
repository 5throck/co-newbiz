// GET /api/projects/[id]/wacc/suggestions — WACC reference values for the
// project's bound subject company (ADR-0116 Phase 4). Proposal-only: the
// caller prefills the WACC session inputs; the human-confirmed scalar stays
// kind='user' on the project run. Fails soft — missing series/facts come
// back as explicit null entries with reasons, never placeholders.
// ADR-0207: also offers the published ERP reference (default + alternatives)
// from region-profiles/KR.yaml — market-common, so it does not depend on the
// subject company and survives the no-company early return.
// ADR-0207 addendum: also offers the statutory marginal corporate tax rate
// (combined national + local, percent points) from region-profiles/KR.yaml —
// the bracket is estimated from the subject's latest DART income figure and
// falls back to the top bracket (with a stated reason) when none is usable.
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { listProjectAnalysisTargets } from "../../../../../../../../db/lib/wacc.ts";
import { computeWaccReference } from "../../../../../../../../db/lib/wacc-reference.ts";
import { buildErpOffer, resolveProjectMarket } from "../../../../../../../../db/lib/erp-reference.ts";
import { buildTaxRateSuggestion, lookupTaxableIncomeProxy } from "../../../../../../../../db/lib/tax-rate-reference.ts";

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
  const market = resolveProjectMarket(db, id) === "KR" ? "KR" : "OTHER";
  const erpOffer = buildErpOffer(market);
  // Market-common like ERP: with no bound company the top bracket is offered with an explicit reason.
  const taxRate = buildTaxRateSuggestion(market, lookupTaxableIncomeProxy(db, companyId));
  const marketCommonCount = (erpOffer.erp.value !== null ? 1 : 0) + (taxRate.value !== null ? 1 : 0);
  if (!companyId) {
    return ok(
      {
        suggestions: [erpOffer.erp, taxRate],
        erp_alternatives: erpOffer.erp_alternatives,
        apply_all_excluded: erpOffer.apply_all_excluded,
        missing: [
          "대상 회사가 연결되지 않았습니다 — 재무분석 탭에서 연결하세요",
          ...erpOffer.apply_all_excluded.map((x) => `erp: ${x.reason_code} - ${x.reason}`),
        ],
        subject: null,
      },
      200,
      { suggestion_count: marketCommonCount },
    );
  }
  const reference = computeWaccReference(db, companyId);
  const byKey = new Map(reference.entries.map((e) => [e.key, e]));
  const suggestion = (key: string) => {
    const e = byKey.get(key);
    if (!e || e.value === null) return { key, value: null, reason: e?.reason ?? "데이터 없음" };
    return { key, value: e.value, as_of: e.as_of, anchor_ref: e.anchor_ref, source_label: e.source_label, note: e.note ?? null };
  };
  const suggestions = [suggestion("risk_free"), suggestion("credit_spread"), suggestion("observed_de"), erpOffer.erp, taxRate];
  const missing = [
    ...reference.missing,
    ...erpOffer.apply_all_excluded.map((x) => `erp: ${x.reason_code} - ${x.reason}`),
  ];
  return ok(
    {
      subject: reference.subject,
      suggestions,
      erp_alternatives: erpOffer.erp_alternatives,
      apply_all_excluded: erpOffer.apply_all_excluded,
      missing,
    },
    200,
    { suggestion_count: suggestions.filter((s) => s.value !== null).length },
  );
}
