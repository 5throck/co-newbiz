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
// ADR-0208: the credit_spread entry keeps its key/value/as_of and gains additive rating fields (rating,
// rating_source, spread_basis, series_used, anchors, derived, flags, ...). Slice 2: the rating is the DISCLOSED
// one (`rating_source: "disclosed"`, from the cached DART snapshots filled by POST .../wacc/credit-rating/collect;
// this GET reads the cache only and never calls DART) when a snapshot supports it, else the default (BBB-) with a
// reason (`rating_not_collected` + `collect_hint` when nothing is cached). Without a corporate-bond rating the latest
// credit-bureau ISSUER rating is the lower-confidence rung (`rating_source: "bureau"`, `rating_bureau` carries the
// bureau, the cash-flow grade and the rows of the rating date; amendment 2026-11-26). A default, bureau, stale-disclosed
// or legacy-spread rating is listed in apply_all_excluded so one click never carries an unevidenced placeholder.
// Slice 3: between the bureau rung and the default sits the SYNTHETIC rung (`rating_source: "synthetic"`, interest coverage
// = operating income / interest expense mapped through the registry's published table; `synthetic` carries coverage,
// interest source, fiscal year and band, or why it is unavailable with `resync_hint`). A synthetic rating is NOT part of
// apply-all (user decision 2026-11-26, amending ADR-0208 decision 9): it is listed in apply_all_excluded with
// `credit_rating_synthetic_basis` and stays individually applicable. The entry also carries `crosscheck`
// (implied cost of debt vs the market Kd; warns, never changes the number) and `issuance_evidence` (recent bond coupons).
// Slice 4: with a stored KOFIA grade yield of the rating's own grade (AAA..BBB-) the spread basis is `kofia_grade` (the grade's 3y
// yield minus the same-date KOFIA KTB 3y; `kofia` carries date, series and source URL), outranking the ECOS bases unless the
// ECOS data is of a newer month. Stored observations are always read; `data.kofia_collect.enabled` only says whether the
// automated collection (POST .../wacc/kofia/collect, env CO_NEWBIZ_KOFIA_COLLECT=on, default off) may run. The FSC bond
// cross-check is NOT part of this payload (GET .../wacc/bond-evidence, reference only, never applied).
// Kd >= Ke needs the form's beta, so only the indicative Kd is
// returned here (credit_spread.kd_indicative_pct); the confirmation POST reports the kd_ge_ke warning.
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { kofiaCollectEnabled } from "../../../../../../lib/kofia-collector.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { listProjectAnalysisTargets } from "../../../../../../../../db/lib/wacc.ts";
import { computeWaccReference, type ReferenceEntry } from "../../../../../../../../db/lib/wacc-reference.ts";
import { buildErpOffer, resolveProjectMarket } from "../../../../../../../../db/lib/erp-reference.ts";
import { buildTaxRateSuggestion, lookupTaxableIncomeProxy } from "../../../../../../../../db/lib/tax-rate-reference.ts";

/** apply-all exclusions of the credit_spread entry (empty when it carries no value or a fresh evidenced rating). */
function creditApplyAllExcluded(
  e: ReferenceEntry | undefined,
): Array<{ key: string; reason_code: string; reason: string }> {
  if (!e || e.value === null || !e.credit) return [];
  if (e.credit.rating_source === "default") {
    return [
      {
        key: "credit_spread",
        reason_code: "credit_rating_default_basis",
        reason: `The rating (${e.credit.rating}) is a default placeholder with no rating evidence - confirm the company's rating individually before applying.`,
      },
    ];
  }
  if (e.credit.rating_source === "bureau") {
    return [
      {
        key: "credit_spread",
        reason_code: "credit_rating_bureau_basis",
        reason: `The rating (${e.credit.rating}) is a credit-bureau issuer rating (lower confidence than a corporate-bond rating) - confirm it individually before applying.`,
      },
    ];
  }
  if (e.credit.rating_source === "synthetic") {
    return [
      {
        key: "credit_spread",
        reason_code: "credit_rating_synthetic_basis",
        reason: `The rating (${e.credit.rating}) is an interest-coverage estimate, not a rating issued by an agency - confirm it individually before applying.`,
      },
    ];
  }
  if (e.credit.rating_stale) {
    return [
      {
        key: "credit_spread",
        reason_code: "credit_rating_stale",
        reason: `The disclosed rating (${e.credit.rating}) is stale - confirm it individually before applying.`,
      },
    ];
  }
  if (e.credit.rating_source === "disclosed" && e.credit.spread_basis === "aa_minus_legacy") {
    return [
      {
        key: "credit_spread",
        reason_code: "credit_spread_legacy_basis",
        reason: `The spread could not be mapped to the disclosed rating (${e.credit.rating}) and is the AA- legacy value - confirm it individually before applying.`,
      },
    ];
  }
  return [];
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true });
  if (!project) return notFound();
  const db = getDb();
  // ADR-0156: ?target_id= asks for a shortlisted target's company instead of the bound subject.
  const targetId = new URL(request.url).searchParams.get("target_id");
  let companyId =
    (db.query("SELECT company_id FROM md_project WHERE id = ?").get(id) as { company_id: string | null } | undefined)
      ?.company_id ?? null;
  if (targetId) {
    const t = listProjectAnalysisTargets(db, id).find((x) => x.targetId === targetId);
    if (!t || !t.companyId)
      return badRequest("invalid_request", "target_id must be a shortlisted target (a company that can be analyzed).");
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
    return {
      key,
      value: e.value,
      as_of: e.as_of,
      anchor_ref: e.anchor_ref,
      source_label: e.source_label,
      note: e.note ?? null,
      ...(e.credit ?? {}),
    };
  };
  const suggestions = [
    suggestion("risk_free"),
    suggestion("credit_spread"),
    suggestion("observed_de"),
    erpOffer.erp,
    taxRate,
  ];
  // ADR-0208: a default or stale rating is shown and individually applicable, but apply-all skips it.
  const credit = byKey.get("credit_spread");
  const applyAllExcluded: Array<{ key: string; reason_code: string; reason: string }> = [
    ...erpOffer.apply_all_excluded,
    ...creditApplyAllExcluded(credit),
  ];
  const missing = [...reference.missing, ...applyAllExcluded.map((x) => `${x.key}: ${x.reason_code} - ${x.reason}`)];
  return ok(
    {
      subject: reference.subject,
      suggestions,
      erp_alternatives: erpOffer.erp_alternatives,
      apply_all_excluded: applyAllExcluded,
      missing,
      kofia_collect: { enabled: kofiaCollectEnabled() },
    },
    200,
    { suggestion_count: suggestions.filter((s) => s.value !== null).length },
  );
}
