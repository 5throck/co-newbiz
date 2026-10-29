"use client";

// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { AdminConsoleState } from "./useAdminActions.ts";
import { api } from "../../../lib/api.ts";
import { ColGroup, DevRef } from "../../ui.tsx";
import type { GovernanceDocRow } from "./types.ts";
import { ListSearch, Pager, adrStatusCode, matchesQuery, useAdminLabel, usePaged } from "./admin-ui.tsx";

const GOV_PAGE_SIZE = 20;
const ADR_COL_PCT = [10, 44, 14, 32] as const;
const ADR_PAGE_SIZE = 25;

// 거버넌스 문서 레지스트리 8열 — ID·키·제목이 긴 텍스트라 고정 비율 유지.
const GOVERNANCE_COL_PCT = [23, 8, 7, 9, 15, 8, 11, 10, 9] as const;

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

interface GovSyncResult {
  inserted: number;
  superseded: number;
  updated: number;
  unchanged: number;
  orphans: unknown[];
  findings: Array<{ path: string; severity: "error" | "warn"; missing: string[] }>;
}

export function GovernancePanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.governance");
  const tc = useTranslations("common");
  const label = useAdminLabel();
  const tl = useTranslations("admin.list");
  const { section, governance, setNotice, setError } = ctx;
  const [fresh, setFresh] = useState<GovernanceDocRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [layer, setLayer] = useState("");
  const [showPast, setShowPast] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sync, setSync] = useState<GovSyncResult | null>(null);
  const rows = fresh ?? governance;
  const filtered = useMemo(
    () =>
      (rows ?? []).filter(
        (g) =>
          (showPast || !g.superseded_by) &&
          (!layer || g.layer === layer) &&
          matchesQuery(query, g.id, g.key, g.title, label("govLayer", g.layer), label("govOwner", g.owner_agent)),
      ),
    [rows, query, layer, showPast, label],
  );
  const paged = usePaged(filtered, GOV_PAGE_SIZE);

  async function runSync() {
    setBusy(true);
    try {
      const res = await api.post<GovSyncResult>("/api/admin/governance/sync", {});
      setSync(res.data);
      setNotice(t("syncDone", { p1: res.data.inserted, p2: res.data.superseded, p3: res.data.updated, p4: res.data.unchanged }));
      const list = await api.get<GovernanceDocRow[]>("/api/admin/governance");
      setFresh(list.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("syncFailed"));
    } finally {
      setBusy(false);
    }
  }

  const missingText = (m: string[]) => m.map((x) => label("govMissing", x.split("(")[0])).join(", ");
  const reviewChip = (g: GovernanceDocRow) => {
    switch (g.review_status) {
      case "overdue": return <span className="status-chip status-red"><span aria-hidden="true">!</span> {t("reviewOverdue")}</span>;
      case "due_soon": return <span className="status-chip status-amber"><span aria-hidden="true">●</span> {t("reviewSoon")}</span>;
      case "ok": return <span className="status-chip status-green"><span aria-hidden="true">✓</span> {t("reviewOk")}</span>;
      default: return <span className="text-[color:var(--muted-fg)]">{t("reviewNone")}</span>;
    }
  };

  return (
    <>{section === "governance" &&
        (rows === null ? (
          <p>{tc("loading")}</p>
        ) : rows.length === 0 ? (
          <>
            <p className="text-[color:var(--muted-fg)] italic">{t("emptyDocs")}</p>
            <button type="button" className="btn-primary mt-2" disabled={busy} onClick={() => void runSync()}>{busy ? t("syncing") : t("syncButton")}</button>
          </>
        ) : (
          <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <ListSearch value={query} onChange={setQuery} ariaLabel={t("searchAria")} placeholder={t("searchPlaceholder")} />
            <select aria-label={t("filterLayerAria")} value={layer} onChange={(e) => setLayer(e.target.value)}>
              <option value="">{t("filterLayerAll")}</option>
              {["policy", "procedure", "guideline", "checklist", "template"].map((l) => <option key={l} value={l}>{label("govLayer", l)}</option>)}
            </select>
            <label className="inline-flex items-center gap-1 text-[length:var(--fs-caption)]">
              <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> {t("showPast")}
            </label>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void runSync()}>{busy ? t("syncing") : t("syncButton")}</button>
          </div>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("editedInRepo")} {t("syncHint")}</p>
          {sync && (
            <section role="status" aria-live="polite" className="market-section mb-3">
              {sync.orphans.length > 0 && <p className="text-[length:var(--fs-caption)]">{t("orphansNote", { p1: sync.orphans.length })}</p>}
              {sync.findings.length > 0 && (
                <>
                  <h3 className="text-[length:var(--fs-body)] font-semibold mb-1">{t("findingsHeading", { p1: sync.findings.length })}</h3>
                  <ul className="text-[length:var(--fs-caption)]">
                    {sync.findings.map((f) => (
                      <li key={f.path}>
                        <span className={`status-chip ${f.severity === "error" ? "status-red" : "status-amber"}`}>{f.severity === "error" ? t("findingNotRegistered") : t("findingIncomplete")}</span>{" "}
                        <span className="font-mono">{f.path}</span> — {t("findingMissing", { p1: missingText(f.missing) })}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
          {filtered.length === 0 ? <p className="text-[color:var(--muted-fg)] italic">{tl("noMatch")}</p> : (
          <>
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
<table className="data-table table-fixed-pct tmin-56">
            <caption className="sr-only">{t("registryCaption")}</caption>
            <ColGroup widths={GOVERNANCE_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">{t("colTitle")}</th>
                <th scope="col">{t("colLayer")}</th>
                <th scope="col">{t("colVersion")}</th>
                <th scope="col">{t("colEffective")}</th>
                <th scope="col">{t("colNextReview")}</th>
                <th scope="col">{t("colEnforceability")}</th>
                <th scope="col">{t("colOwner")}</th>
                <th scope="col">{t("colWaivers")}</th>
                <th scope="col">{t("colDocument")}</th>
              </tr>
            </thead>
            <tbody>
              {paged.slice.map((g) => (
                <tr key={g.id}>
                  <td>
                    {g.title}
                    <div className="font-mono text-xs text-[color:var(--muted-fg)]">{g.key}</div>
                    <div>{g.superseded_by ? <span className="status-chip status-not-started">{t("superseded", { p1: g.superseded_by })}</span> : null}</div>
                  </td>
                  <td>{label("govLayer", g.layer)}</td>
                  <td>{g.version}</td>
                  <td className="mono-num">{g.effective_from || "—"}</td>
                  <td>
                    <div className="mono-num">{g.next_review ?? "—"}</div>
                    {reviewChip(g)}
                  </td>
                  <td>{label("govEnforce", g.enforceability)}</td>
                  <td>{label("govOwner", g.owner_agent)}</td>
                  <td>
                    <span className="mono-num">{t("waiverCount", { p1: g.active_waivers ?? 0 })}</span>
                    {g.waiver_concentrated && <span className="status-chip status-amber ml-1" title={t("waiverConcentratedNote")}>{t("waiverConcentrated")}</span>}
                    {(g.waiver_clauses ?? []).length > 0 && (
                      <div className="font-mono text-xs text-[color:var(--muted-fg)]">{(g.waiver_clauses ?? []).map((c) => `${c.clause_ref} ×${c.count}`).join(", ")}</div>
                    )}
                  </td>
                  <td>{g.library_id ? <a href={`/library?doc=${encodeURIComponent(g.library_id)}`}>{t("openDoc")}</a> : <span className="text-[color:var(--muted-fg)]">{t("noDoc")}</span>}</td>
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
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}><table className="data-table table-fixed-pct tmin-56">
            <caption className="sr-only">{t("adrCaption")}</caption>
            <ColGroup widths={ADR_COL_PCT} />
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
                  <td className="font-mono text-[length:var(--fs-caption)]">
                    {a.id}
                    {(idCounts.get(a.id) ?? 0) > 1 && <span className="status-chip status-amber ml-1" title={t("adrDuplicateNote")}>{t("adrDuplicateChip")}</span>}
                  </td>
                  <td title={a.title}>{a.title}</td>
                  <td title={a.status}>{label("adrStatus", adrStatusCode(a.status))}</td>
                  <td className="font-mono text-[length:var(--fs-caption)] cell-truncate" title={a.file}>{a.file}</td>
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
