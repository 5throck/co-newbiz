"use client";

// /companies — company list + search (ADR-0116 Phase 1). Entry point for the
// company connect flow and direct lookup; the dashboard per company lives at
// /companies/[companyId]. No top-level menu entry — companies are reached
// from deal flow contexts (bridge tab, target lists).
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../../lib/api.ts";

interface CompanyRow {
  id: string;
  name_ko: string;
  dart_corp_code: string | null;
  fact_years: number;
  latest_sync_at: string | null;
}

export default function CompaniesPage() {
  const t = useTranslations("pages.companies");
  const tc = useTranslations("common");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<CompanyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((query: string) => {
    api.get<{ companies: CompanyRow[] }>(`/api/companies?scope=targets&q=${encodeURIComponent(query)}`)
      .then((r) => setRows(r.data.companies))
      .catch((e) => setError(e instanceof Error ? e.message : t("loadFailed")));
  }, []);
  useEffect(() => { load(""); }, [load]);

  return (
    <main className="market-page">
      <h1 className="text-[1.35rem] font-extrabold tracking-tight mt-6">{t("heading")}</h1>
      <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-body)] mb-3">{t("intro")}</p>
      {/* INTERIM-WORDING */}
      <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-body)] mb-3">{t("ourCompanyPre")}<Link className="text-[color:var(--accent)] font-bold" href="/our-company">{t("ourCompanyLink")}</Link>{t("ourCompanyPost")}</p>

      <form
        className="flex gap-2 mb-3"
        onSubmit={(e) => { e.preventDefault(); load(q.trim()); }}
      >
        <input
          className="sizing-new-input flex-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchAria")}
        />
        <button className="bg-[color:var(--accent)] text-[color:var(--accent-fg)] rounded-lg px-4 py-2 text-[length:var(--fs-body)] font-bold cursor-pointer" type="submit">{t("search")}</button>
      </form>

      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {error}</p>}
      {!rows ? (
        <p className="text-[color:var(--muted-fg)]">{tc("loading")}</p>
      ) : rows.length === 0 ? (
        <div className="border border-dashed border-[color:var(--border-bright)] rounded-lg p-6 text-center text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
          {t("noResults")}
        </div>
      ) : (
        <table className="data-table">
          <caption className="sr-only">{t("tableCaption")}</caption>
          <thead><tr><th>{t("thName")}</th><th>{t("thDartCode")}</th><th>{t("thFactData")}</th><th>{t("thLastSync")}</th><th></th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="font-semibold">{c.name_ko}</td>
                <td className="font-mono text-[length:var(--fs-caption)]">{c.dart_corp_code ?? "—"}</td>
                <td>{c.fact_years > 0 ? t("factYears", { count: c.fact_years }) : t("noFactData")}</td>
                <td className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{c.latest_sync_at ? new Date(c.latest_sync_at).toLocaleDateString("ko-KR") : "—"}</td>
                <td><Link className="text-[color:var(--accent)] font-bold text-[length:var(--fs-body)] whitespace-nowrap" href={`/companies/${c.id}`}>{t("viewFinancials")}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
