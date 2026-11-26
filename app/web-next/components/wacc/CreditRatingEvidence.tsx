"use client";

// Evidence block of a DISCLOSED credit rating inside the WACC reference table (ADR-0208 slice 2): which agencies
// rated, on what date, from which DART filing, and how stale the rating is. Everything shown here is read from the
// suggestion the server returned; the human still decides whether to apply it. Status is carried by text, never
// by color alone (FR-SYS-05), and long filing numbers / agency names wrap so the block stays readable on a phone-width viewport.
import { useTranslations } from "next-intl";
import {
  type ReferenceSuggestion,
  bureauCreditView,
  creditAgencyLinks,
  crosscheckUnreliable,
  crosscheckView,
  dartFilingUrl,
  disclosedCreditView,
  formatCreditAnchorPct,
  issuanceEvidenceRows,
  syntheticCreditView,
} from "../../lib/wacc-reference-items.ts";

function ExternalLink({ href, label, hint }: { href: string; label: string; hint: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">
      {label}
      <span className="sr-only"> {hint}</span>
    </a>
  );
}

export function CreditRatingEvidence({ suggestion }: { suggestion: ReferenceSuggestion }) {
  const t = useTranslations("stages.s8.wacc.waccPanel");
  const view = disclosedCreditView(suggestion);
  const bureau = bureauCreditView(suggestion);
  const synthetic = syntheticCreditView(suggestion);
  const crosscheck = crosscheckView(suggestion);
  const crosscheckNote = crosscheckUnreliable(suggestion);
  const issuance = issuanceEvidenceRows(suggestion);
  const agencyLinks = creditAgencyLinks(suggestion);
  const hasCostOfDebtEvidence = crosscheck !== null || crosscheckNote !== null || issuance.length > 0;
  if (!view && !bureau && !synthetic && !hasCostOfDebtEvidence && agencyLinks.length === 0) return null;

  const agencyLabel: Record<string, string> = {
    "korea-ratings": t("creditAgencyKoreaRatings"),
    kis: t("creditAgencyKis"),
    nice: t("creditAgencyNice"),
    "nice-dnb": t("creditAgencyNiceDnb"),
    ecredible: t("creditAgencyEcredible"),
    ked: t("creditAgencyKed"),
    "nice-info": t("creditAgencyNiceInfo"),
    sci: t("creditAgencySci"),
  };
  const outlookLabel: Record<string, string> = {
    stable: t("creditOutlookStable"),
    positive: t("creditOutlookPositive"),
    negative: t("creditOutlookNegative"),
    developing: t("creditOutlookDeveloping"),
  };
  const evidenceLabel = {
    business_report: t("creditEvidenceBusinessReport"),
    debt_securities_filing: t("creditEvidenceDebtFiling"),
  } as const;
  const instrumentLabel: Record<string, string> = { corporate_bond: t("creditInstrumentCorporateBond") };
  const hint = t("erpOpensInNewTab");
  const links = agencyLinks.length > 0 && (
    <div className="text-[length:var(--fs-caption)]" data-testid="credit-agency-links">
      <span>{t("creditAgencyLinksLabel")}: </span>
      {agencyLinks.map((l, i) => (
        <span key={l.agency}>
          {i > 0 ? " · " : ""}
          <ExternalLink href={l.href} label={agencyLabel[l.agency] ?? l.agency} hint={hint} />
        </span>
      ))}
    </div>
  );
  const interestSourceLabel: Record<string, string> = {
    interest_expense: t("creditInterestSourceExpense"),
    interest_paid: t("creditInterestSourcePaid"),
    finance_costs: t("creditInterestSourceFinanceCosts"),
  };
  // Cost-of-debt evidence (cross-check and recent bond coupons): a warning input, it never changes the number.
  const costOfDebt = hasCostOfDebtEvidence && (
    <div data-testid="credit-costofdebt-evidence">
      {crosscheck && (
        <div data-testid="credit-crosscheck">
          <div className="font-semibold">{t("creditCrosscheckTitle")}</div>
          <div>
            {t("creditCrosscheckLine", {
              implied: formatCreditAnchorPct(crosscheck.impliedPct),
              interest: String(suggestion.crosscheck?.interest_expense_krw_million ?? ""),
              debt: String(suggestion.crosscheck?.avg_debt_krw_million ?? ""),
              basis: crosscheck.debtBasis === "year_end" ? t("creditDebtBasisYearEnd") : t("creditDebtBasisAverage"),
              kd: formatCreditAnchorPct(crosscheck.marketKdPct),
              gap: formatCreditAnchorPct(Math.abs(crosscheck.gapPp)),
            })}
          </div>
          <div>
            {crosscheck.direction === "market_above_actual"
              ? t("creditCrosscheckMarketAbove")
              : t("creditCrosscheckMarketBelow")}
          </div>
          {crosscheck.reasonCode === "crosscheck_implied_far_below_market" && (
            <div data-testid="credit-crosscheck-far-below">
              {t("creditCrosscheckFarBelow", {
                implied: formatCreditAnchorPct(crosscheck.impliedPct),
                market: formatCreditAnchorPct(crosscheck.marketKdPct),
              })}
            </div>
          )}
          <div>
            {crosscheck.status === "warn" ? (
              <span className="status-chip status-amber" data-testid="credit-crosscheck-warning">
                {t("creditCrosscheckWarnLine", { warn: crosscheck.warnGapPp.toFixed(1) })}
              </span>
            ) : (
              t("creditCrosscheckOkLine", { warn: crosscheck.warnGapPp.toFixed(1) })
            )}
          </div>
          {crosscheck.interestSource && crosscheck.interestSource !== "interest_expense" && (
            <div>{t("creditCrosscheckProxyNote", { source: interestSourceLabel[crosscheck.interestSource] })}</div>
          )}
          <div>{t("creditCrosscheckNote")}</div>
        </div>
      )}
      {!crosscheck && crosscheckNote && (
        <div data-testid="credit-crosscheck-unreliable">{t("creditCrosscheckUnreliable")}</div>
      )}
      {issuance.length > 0 && (
        <div data-testid="credit-issuance">
          <div className="font-semibold">{t("creditIssuanceTitle")}</div>
          <ul className="list-disc pl-5" aria-label={t("creditIssuanceTitle")}>
            {issuance.map((i) => (
              <li key={`${i.issued_on}-${i.rating_raw}-${i.coupon_pct ?? ""}-${i.maturity_on ?? ""}`}>
                {t("creditIssuanceRow", {
                  issuedOn: i.issued_on,
                  coupon: i.coupon_pct === null ? "-" : i.coupon_pct.toFixed(2),
                  rating: i.rating_raw,
                  maturity: i.maturity_on ?? "-",
                })}
              </li>
            ))}
          </ul>
          <div>{t("creditIssuanceNote")}</div>
        </div>
      )}
    </div>
  );
  // Synthetic estimate (interest coverage): how the rating was derived, and that it is an estimate, not an agency rating.
  if (synthetic) {
    const sup = synthetic.superseded;
    const supUrl = sup ? dartFilingUrl(sup.source_rcept_no) : null;
    return (
      <div
        className="mt-1 min-w-0 max-w-[26rem] [overflow-wrap:anywhere] text-[color:var(--muted-fg)]"
        data-testid="credit-synthetic-evidence"
      >
        <div className="font-semibold">{t("creditSyntheticTitle")}</div>
        <div data-testid="credit-synthetic-coverage">
          {t("creditSyntheticCoverageLine", {
            coverage: synthetic.coverageX.toFixed(2),
            year: synthetic.fiscalYear,
            operating: String(synthetic.operatingIncomeKrwMillion),
            source: interestSourceLabel[synthetic.interestSource] ?? synthetic.interestSource,
            interest: String(synthetic.interestExpenseKrwMillion),
          })}
        </div>
        <div>
          {t("creditSyntheticTableLine", {
            label: synthetic.publishedLabel ?? synthetic.rating,
            asOf: synthetic.tableAsOf,
          })}
        </div>
        {synthetic.interestIsProxy && (
          <div>{t("creditSyntheticProxyNote", { source: interestSourceLabel[synthetic.interestSource] })}</div>
        )}
        {synthetic.lossMaking && <div>{t("creditSyntheticLossLine")}</div>}
        <div>{t("creditSyntheticEstimateNote")}</div>
        {sup && (
          <div data-testid="credit-synthetic-superseded">
            {t("creditSupersededLine", {
              basis: sup.basis === "bureau" ? t("creditSupersededBasisBureau") : t("creditSupersededBasisDisclosed"),
              rating: sup.rating,
              ratedOn: sup.rated_on,
            })}{" "}
            {supUrl && (
              <ExternalLink href={supUrl} label={t("creditFilingLink", { rceptNo: sup.source_rcept_no })} hint={hint} />
            )}
          </div>
        )}
        {costOfDebt}
        {links}
      </div>
    );
  }
  // Bureau issuer rating (lower confidence): who rated, the cash-flow grade (its own scale), the filing it came from.
  if (bureau) {
    const named = (a: string | null, raw: string | null) =>
      a ? (agencyLabel[a] ?? a) : (raw ?? t("creditBureauAgencyUnnamed"));
    return (
      <div
        className="mt-1 min-w-0 max-w-[26rem] [overflow-wrap:anywhere] text-[color:var(--muted-fg)]"
        data-testid="credit-bureau-evidence"
      >
        <div className="font-semibold">{t("creditBureauTitle")}</div>
        <div>{t("creditBureauNote")}</div>
        <ul className="list-disc pl-5" aria-label={t("creditBureauRows")} data-testid="credit-bureau-list">
          {bureau.evidence.rows.map((r) => (
            <li key={`${r.agency ?? r.agency_raw ?? "unnamed"}-${r.grade}-${r.cashflow_grade ?? ""}`}>
              {t("creditBureauRow", {
                agency: named(r.agency, r.agency_raw),
                grade: r.grade,
                ratedOn: bureau.ratedOn ?? "",
              })}
              {r.cashflow_grade ? ` · ${t("creditCashflowGrade", { grade: r.cashflow_grade })}` : ""}
            </li>
          ))}
        </ul>
        {bureau.evidence.agency_carried && <div>{t("creditBureauAgencyCarried")}</div>}
        {bureau.filingNo && (
          <div data-testid="credit-filing">
            {bureau.filingUrl ? (
              <ExternalLink
                href={bureau.filingUrl}
                label={t("creditFilingLink", { rceptNo: bureau.filingNo })}
                hint={hint}
              />
            ) : (
              t("creditFilingLink", { rceptNo: bureau.filingNo })
            )}
          </div>
        )}
        {bureau.stale && (
          <div>
            <span className="status-chip status-amber" data-testid="credit-evidence-stale-chip">
              {t("creditStaleChip")}
            </span>
          </div>
        )}
        {costOfDebt}
        {links}
      </div>
    );
  }
  // No disclosed rating: the agency home pages are still a useful manual-verification aid.
  if (!view) {
    return (
      <div className="mt-1 min-w-0 max-w-[26rem] [overflow-wrap:anywhere] text-[color:var(--muted-fg)]">
        {costOfDebt}
        {links}
      </div>
    );
  }

  return (
    <div
      className="mt-1 min-w-0 max-w-[26rem] [overflow-wrap:anywhere] text-[color:var(--muted-fg)]"
      data-testid="credit-disclosed-evidence"
    >
      <div className="font-semibold">{t("creditDisclosedTitle")}</div>
      {view.agencies.length > 0 && (
        <ul className="list-disc pl-5" aria-label={t("creditDisclosedAgencies")} data-testid="credit-agency-list">
          {view.agencies.map((a) => (
            <li key={`${a.agency}-${a.grade}-${a.rated_on}`}>
              {t("creditAgencyRow", {
                agency: agencyLabel[a.agency] ?? a.agency,
                grade: a.grade,
                ratedOn: a.rated_on,
              })}
              {a.outlook ? ` · ${t("creditOutlookLine", { outlook: outlookLabel[a.outlook] ?? a.outlook })}` : ""}
            </li>
          ))}
        </ul>
      )}
      {view.instrument && (
        <div>{t("creditInstrumentLine", { instrument: instrumentLabel[view.instrument] ?? view.instrument })}</div>
      )}
      {view.ratedOn && <div>{t("creditRatedOnLine", { date: view.ratedOn })}</div>}
      {view.evidenceKind && <div>{t("creditEvidenceLine", { kind: evidenceLabel[view.evidenceKind] })}</div>}
      {view.filingNo && (
        <div data-testid="credit-filing">
          {view.filingUrl ? (
            <ExternalLink href={view.filingUrl} label={t("creditFilingLink", { rceptNo: view.filingNo })} hint={hint} />
          ) : (
            t("creditFilingLink", { rceptNo: view.filingNo })
          )}
        </div>
      )}
      {view.stale && (
        <div>
          <span className="status-chip status-amber" data-testid="credit-evidence-stale-chip">
            {t("creditStaleChip")}
          </span>
        </div>
      )}
      {view.alternative && (
        <div data-testid="credit-rating-alternative">
          {t("creditAlternativeNote", {
            rating: view.alternative.rating,
            ratedOn: view.alternative.rated_on,
            kind: `${evidenceLabel[view.alternative.evidence_kind]}${view.alternative.stale ? `, ${t("creditAlternativeStale")}` : ""}`,
          })}{" "}
          {view.alternative.filingUrl && (
            <ExternalLink
              href={view.alternative.filingUrl}
              label={t("creditFilingLink", { rceptNo: view.alternative.source_rcept_no })}
              hint={hint}
            />
          )}
        </div>
      )}
      {costOfDebt}
      {links}
    </div>
  );
}
