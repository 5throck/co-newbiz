"use client";

// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { AdminConsoleState } from "./useAdminActions.ts";
import { ColGroup, DevRef } from "../../ui.tsx";
import { ListSearch, Pager, adrStatusCode, matchesQuery, useAdminLabel, usePaged } from "./admin-ui.tsx";

const GOV_PAGE_SIZE = 20;
const ADR_PAGE_SIZE = 25;

// 거버넌스 문서 레지스트리 8열 — ID·키·제목이 긴 텍스트라 고정 비율 유지.
const GOVERNANCE_COL_PCT = [18, 8, 14, 26, 7, 9, 10, 8] as const;

export function ReviewAuditPanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.governance");
  const { section, reviewAudit } = ctx;
  return (
    <>{section === "governance" && reviewAudit !== null && reviewAudit !== undefined && (
        <section aria-label={t("kpiSectionAria")} className="market-section mb-3">
          <h3 className="text-[length:var(--fs-body)] font-semibold mb-1">{t("kpiHeading")}</h3>
          <DevRef refs="ADR-0153" />
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
            {t("kpiIntroPre")} {Math.round(reviewAudit.suggested_sample_rate * 100)}% {t("kpiIntroPost")}
            {reviewAudit.note && <span className="block">{reviewAudit.note}</span>}
          </p>
          <table className="data-table">
            <caption className="sr-only">{t("kpiCaption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("colDivision")}</th>
                <th scope="col">{t("colKey")}</th>
                <th scope="col">{t("colSample")}</th>
                <th scope="col">{t("colAgree")}</th>
                <th scope="col">{t("colAgreeRate")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t("rowOverall")}</td>
                <td>—</td>
                <td className="mono-num">{reviewAudit.overall.sampled}</td>
                <td className="mono-num">{reviewAudit.overall.agreed}</td>
                <td className="mono-num">{reviewAudit.overall.rate === null ? "—" : `${Math.round(reviewAudit.overall.rate * 100)}%`}</td>
              </tr>
              {reviewAudit.by_domain.map((d) => (
                <tr key={`d-${d.key}`}>
                  <td>{t("rowDomain")}</td>
                  <td>{d.key}</td>
                  <td className="mono-num">{d.sampled}</td>
                  <td className="mono-num">{d.agreed}</td>
                  <td className="mono-num">{d.rate === null ? "—" : `${Math.round(d.rate * 100)}%`}</td>
                </tr>
              ))}
              {reviewAudit.by_quarter.map((q) => (
                <tr key={`q-${q.key}`}>
                  <td>{t("rowQuarter")}</td>
                  <td>{q.key}</td>
                  <td className="mono-num">{q.sampled}</td>
                  <td className="mono-num">{q.agreed}</td>
                  <td className="mono-num">{q.rate === null ? "—" : `${Math.round(q.rate * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}</>
  );
}

export function GovernancePanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.governance");
  const tc = useTranslations("common");
  const label = useAdminLabel();
  const tl = useTranslations("admin.list");
  const { section, governance } = ctx;
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => (governance ?? []).filter((g) => matchesQuery(query, g.id, g.key, g.title, label("govLayer", g.layer), label("govOwner", g.owner_agent))),
    [governance, query, label],
  );
  const paged = usePaged(filtered, GOV_PAGE_SIZE);
  return (
    <>{section === "governance" &&
        (governance === null ? (
          <p>{tc("loading")}</p>
        ) : governance.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">{t("emptyDocs")}</p>
        ) : (
          <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <ListSearch value={query} onChange={setQuery} ariaLabel={t("searchAria")} placeholder={t("searchPlaceholder")} />
            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("readOnlyNote")}</span>
          </div>
          {filtered.length === 0 ? <p className="text-[color:var(--muted-fg)] italic">{tl("noMatch")}</p> : (
          <>
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
<table className="data-table table-fixed-pct tmin-56">
            <caption className="sr-only">{t("registryCaption")}</caption>
            <ColGroup widths={GOVERNANCE_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">{t("colId")}</th>
                <th scope="col">{t("colLayer")}</th>
                <th scope="col">{t("colKey")}</th>
                <th scope="col">{t("colTitle")}</th>
                <th scope="col">{t("colVersion")}</th>
                <th scope="col">{t("colEnforceability")}</th>
                <th scope="col">{t("colOwner")}</th>
                <th scope="col">{tc("status")}</th>
              </tr>
            </thead>
            <tbody>
              {paged.slice.map((g) => (
                <tr key={g.id}>
                  <td className="font-mono text-xs">{g.id}</td>
                  <td>{label("govLayer", g.layer)}</td>
                  <td className="font-mono text-xs">{g.key}</td>
                  <td>{g.title}</td>
                  <td>{g.version}</td>
                  <td>{label("govEnforce", g.enforceability)}</td>
                  <td>{label("govOwner", g.owner_agent)}</td>
                  <td>{g.superseded_by ? t("superseded", { p1: g.superseded_by }) : t("valid")}</td>
                </tr>
              ))}
            </tbody>
          </table>
</div>
          <Pager page={paged.page} pages={paged.pages} total={paged.total} onPage={paged.setPage} />
          </>
          )}
          </>
        ))}</>
  );
}

export function AdrPanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.governance");
  const tc = useTranslations("common");
  const label = useAdminLabel();
  const tl = useTranslations("admin.list");
  const { section, adrs } = ctx;
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => (adrs ?? []).filter((a) => matchesQuery(query, a.id, a.title, a.file, label("adrStatus", adrStatusCode(a.status)))), [adrs, query, label]);
  const paged = usePaged(filtered, ADR_PAGE_SIZE);
  const idCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of adrs ?? []) m.set(a.id, (m.get(a.id) ?? 0) + 1);
    return m;
  }, [adrs]);
  return (
    <>{section === "adr" &&
        (adrs === null ? (
          <p>{tc("loading")}</p>
        ) : adrs.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">{t("emptyAdrs")}</p>
        ) : (
          <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <ListSearch value={query} onChange={setQuery} ariaLabel={t("adrSearchAria")} placeholder={t("adrSearchPlaceholder")} />
            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("adrReadOnlyNote")}</span>
          </div>
          {filtered.length === 0 ? <p className="text-[color:var(--muted-fg)] italic">{tl("noMatch")}</p> : (
          <>
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}><table className="data-table">
            <caption className="sr-only">{t("adrCaption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("colId")}</th>
                <th scope="col">{t("colTitle")}</th>
                <th scope="col">{tc("status")}</th>
                <th scope="col">{t("colFile")}</th>
              </tr>
            </thead>
            <tbody>
              {paged.slice.map((a) => (
                // Two ADR files can share a number (e.g. 0142), so the file name is the unique key.
                <tr key={a.file}>
                  <td className="font-mono text-xs">
                    {a.id}
                    {(idCounts.get(a.id) ?? 0) > 1 && <span className="status-chip status-amber ml-1" title={t("adrDuplicateNote")}>{t("adrDuplicateChip")}</span>}
                  </td>
                  <td>{a.title}</td>
                  <td title={a.status}>{label("adrStatus", adrStatusCode(a.status))}</td>
                  <td className="font-mono text-xs">{a.file}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <Pager page={paged.page} pages={paged.pages} total={paged.total} onPage={paged.setPage} />
          </>
          )}
          </>
        ))}</>
  );
}
