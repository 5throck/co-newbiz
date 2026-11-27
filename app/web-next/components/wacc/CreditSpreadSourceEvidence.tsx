"use client";

// Source evidence next to the credit-spread row of the WACC reference table (ADR-0208 slice 4):
//   - KofiaYieldEvidence: shown only when the spread basis is `kofia_grade` - the KOFIA grade yield, the same-date KTB 3y and
//     the source page. It explains a number the server already computed; nothing here changes it.
//   - BondEvidenceBlock: the issuer's outstanding bonds from the FSC bond APIs on data.go.kr (coupon, maturity, balance,
//     latest price-implied yield) as REFERENCE evidence. It is fetched on a button press, is never applied, is not part of
//     apply-all and has no apply button; it carries the 공공누리 source notice (type 2 and type 4). Status is carried by text,
//     never by color alone (FR-SYS-05), and long names wrap so the block stays readable on a phone-width viewport.
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { ApiError, api } from "../../lib/api.ts";
import {
  type BondEvidencePayload,
  type ReferenceSuggestion,
  bondEvidenceRows,
  bondEvidenceUrl,
  formatCreditAnchorPct,
  kofiaCreditView,
} from "../../lib/wacc-reference-items.ts";

export function KofiaYieldEvidence({ suggestion }: { suggestion: ReferenceSuggestion }) {
  const t = useTranslations("stages.s8.wacc.waccPanel");
  const view = kofiaCreditView(suggestion);
  if (!view) return null;
  return (
    <div
      className="mt-1 min-w-0 max-w-[26rem] [overflow-wrap:anywhere] text-[color:var(--muted-fg)]"
      data-testid="credit-kofia-evidence"
    >
      <div className="font-semibold">{t("creditKofiaTitle")}</div>
      <div data-testid="credit-kofia-line">
        {t("creditKofiaLine", {
          grade: view.grade,
          yield: formatCreditAnchorPct(view.gradeYieldPct),
          ktb: formatCreditAnchorPct(view.ktbPct),
          date: view.date,
        })}
      </div>
      <div>
        {view.sourceUrl ? (
          <a
            href={view.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[color:var(--accent)] underline"
            data-testid="credit-kofia-source"
          >
            {t("creditKofiaSource")}
            <span className="sr-only"> {t("erpOpensInNewTab")}</span>
          </a>
        ) : (
          t("creditKofiaSource")
        )}
      </div>
      <div>{t("creditKofiaNote")}</div>
    </div>
  );
}

type Lookup =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; payload: BondEvidencePayload }
  | { phase: "error"; code: string | null };

export function BondEvidenceBlock({ projectId, targetId }: { projectId: string; targetId?: string | null }) {
  const t = useTranslations("stages.s8.wacc.waccPanel");
  const [lookup, setLookup] = useState<Lookup>({ phase: "idle" });
  const run = useCallback(async () => {
    setLookup({ phase: "loading" });
    try {
      const r = await api.get<BondEvidencePayload>(bondEvidenceUrl(projectId, targetId));
      setLookup({ phase: "done", payload: r.data });
    } catch (err) {
      setLookup({ phase: "error", code: err instanceof ApiError ? err.code : null });
    }
  }, [projectId, targetId]);

  const reasonText = (code: string | null): string => {
    switch (code) {
      case "service_key_not_registered":
        return t("bondEvidenceKeyNotRegistered");
      case "quota_exceeded":
        return t("bondEvidenceQuota");
      case "service_expired":
        return t("bondEvidenceExpired");
      default:
        return t("bondEvidenceUnavailable");
    }
  };
  const payload = lookup.phase === "done" ? lookup.payload : null;
  const ev = payload?.evidence ?? null;
  const rows = bondEvidenceRows(payload);
  const issuer = ev?.issuer;
  return (
    <div
      className="mt-2 min-w-0 max-w-[26rem] [overflow-wrap:anywhere] text-[color:var(--muted-fg)]"
      data-testid="bond-evidence-block"
    >
      <div className="font-semibold">{t("bondEvidenceTitle")}</div>
      <div>{t("bondEvidenceHint")}</div>
      <div>
        <button
          type="button"
          className="btn-ghost btn-sm"
          disabled={lookup.phase === "loading"}
          aria-busy={lookup.phase === "loading"}
          onClick={() => void run()}
          data-testid="bond-evidence-lookup"
        >
          {lookup.phase === "loading"
            ? t("bondEvidenceLoading")
            : lookup.phase === "idle"
              ? t("bondEvidenceLookup")
              : t("bondEvidenceRefresh")}
        </button>
      </div>
      <div aria-live="polite">
        {lookup.phase === "error" && (
          <div role="alert" data-testid="bond-evidence-error">
            {lookup.code === "data_go_kr_api_key_missing"
              ? t("bondEvidenceKeyMissing")
              : lookup.code === "no_subject_company"
                ? t("bondEvidenceNoSubject")
                : t("bondEvidenceUnavailable")}
          </div>
        )}
        {ev?.status === "unavailable" && (
          <div data-testid="bond-evidence-unavailable">{reasonText(ev.reason_code)}</div>
        )}
        {ev?.status === "ambiguous_issuer" && (
          <div data-testid="bond-evidence-ambiguous">{t("bondEvidenceAmbiguous")}</div>
        )}
        {ev?.status === "no_bonds" && <div data-testid="bond-evidence-empty">{t("bondEvidenceNoBonds")}</div>}
        {ev?.status === "ok" && issuer && (
          <>
            <div>
              {issuer.crno
                ? t("bondEvidenceIssuer", { name: issuer.matched_name ?? issuer.query_name, crno: issuer.crno })
                : t("bondEvidenceIssuerNoCrno", { name: issuer.matched_name ?? issuer.query_name })}
              {ev.basis_date ? ` · ${t("bondEvidenceBasisDate", { date: ev.basis_date })}` : ""}
            </div>
            <ul className="list-disc pl-5" aria-label={t("bondEvidenceTitle")} data-testid="bond-evidence-list">
              {rows.map((b) => (
                <li key={b.key}>
                  {t("bondEvidenceRow", {
                    name: b.name,
                    coupon: b.couponPct === null ? "-" : b.couponPct.toFixed(3),
                    maturity: b.matursOn ?? "-",
                    balance: b.balanceKrwMillion === null ? "-" : b.balanceKrwMillion.toLocaleString("en-US"),
                  })}
                  {" · "}
                  {b.priceStatus === "traded" && b.yieldPct !== null && b.yieldAsOf
                    ? t("bondEvidenceYield", { yield: b.yieldPct.toFixed(3), asOf: b.yieldAsOf })
                    : b.priceStatus === "not_traded_in_window"
                      ? t("bondEvidenceNoTrade", { months: ev.price_window_months })
                      : b.priceStatus === "lookup_failed"
                        ? t("bondEvidenceLookupFailed")
                        : t("bondEvidenceNotLookedUp")}
                </li>
              ))}
            </ul>
            {ev.truncated && <div>{t("bondEvidenceTruncated")}</div>}
          </>
        )}
      </div>
      {ev && (
        <div data-testid="bond-evidence-notice">
          {t("bondEvidenceNotice")}{" "}
          <a
            href={ev.attribution.basic.url}
            target="_blank"
            rel="noreferrer"
            className="text-[color:var(--accent)] underline"
          >
            {ev.attribution.basic.dataset}
            <span className="sr-only"> {t("erpOpensInNewTab")}</span>
          </a>
          {" · "}
          <a
            href={ev.attribution.price.url}
            target="_blank"
            rel="noreferrer"
            className="text-[color:var(--accent)] underline"
          >
            {ev.attribution.price.dataset}
            <span className="sr-only"> {t("erpOpensInNewTab")}</span>
          </a>
        </div>
      )}
    </div>
  );
}
