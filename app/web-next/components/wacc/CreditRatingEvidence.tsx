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
  disclosedCreditView,
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
  const agencyLinks = creditAgencyLinks(suggestion);
  if (!view && !bureau && agencyLinks.length === 0) return null;

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
        {links}
      </div>
    );
  }
  // No disclosed rating: the agency home pages are still a useful manual-verification aid.
  if (!view) {
    return (
      <div className="mt-1 min-w-0 max-w-[26rem] [overflow-wrap:anywhere] text-[color:var(--muted-fg)]">{links}</div>
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
      {links}
    </div>
  );
}
