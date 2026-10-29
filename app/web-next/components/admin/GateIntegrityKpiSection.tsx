"use client";

// Admin console - gate integrity KPIs G1-G12 (governance-operations section 4.1). Read-only: the API owns every number and
// every breach decision; this view picks the period and shows each indicator with its state in icon + text (never colour alone).
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight, BookOpen, CheckCircle2, Clock, HelpCircle, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api.ts";
import { useAdminLabel, useKpiKeyLabel } from "./console/admin-ui.tsx";
import {
  KPI_GATE_OPTIONS, KPI_GROUPS, breachActions, currentWeekStart, flattenValue, formatRate, isEmptyKpi, isKnownFamily, kpiQueryProblem, kpiQueryString, mixRows,
  notReadyText, runbookHref, sortFamilies, streakRows, todayDate, weekCountRows,
  type Kpi, type KpiQuery, type KpiReport,
} from "../../lib/gate-integrity-kpis-view.ts";
import type { FamilyStatus } from "../../lib/gate-integrity-readiness.ts";

const small = "text-[length:var(--fs-caption)]";
const muted = "text-[color:var(--muted-fg)]";

function KpiState({ kpi }: { kpi: Kpi }) {
  const t = useTranslations("admin.gateIntegrity");
  if (kpi.status === "migration_pending") return <span className="status-chip status-amber"><Clock size={14} aria-hidden="true" /> {t("state.migrationPending")}</span>;
  if (kpi.status === "unavailable") return <span className="status-chip status-amber"><HelpCircle size={14} aria-hidden="true" /> {t("state.unavailable")}</span>;
  if (kpi.breach.breached) return <span className="status-chip status-red"><AlertTriangle size={14} aria-hidden="true" /> {t("state.breached")}</span>;
  return <span className="status-chip status-green"><CheckCircle2 size={14} aria-hidden="true" /> {t("state.withinLimit")}</span>;
}

/** Plain-Korean (or English) name of a rule family; an unmapped family falls back to its raw key. */
function useFamilyName(): (family: string) => string {
  const t = useTranslations("admin.gateIntegrity");
  return (f) => (isKnownFamily(f) ? t(`family.${f}.name` as never) : f);
}

/** Localized sentence for one breach finding, built from its structured code and params; null when the code is unknown. */
function useBreachText(): (code: string, params: Record<string, string | number>) => string | null {
  const t = useTranslations("admin.gateIntegrity");
  const label = useAdminLabel();
  return (code, params) => {
    if (!t.has(`actions.text.${code}` as never)) return null;
    const p: Record<string, string | number> = { ...params };
    if (typeof p.gate === "string") p.gate = label("kpiKey", p.gate);
    if (typeof p.role === "string") p.role = t.has(`actions.role.${p.role}` as never) ? t(`actions.role.${p.role}` as never) : p.role;
    return t(`actions.text.${code}` as never, p as never);
  };
}

function KpiValue({ kpi }: { kpi: Kpi }) {
  const t = useTranslations("admin.gateIntegrity");
  const familyName = useFamilyName();
  const label = useAdminLabel();
  const keyLabel = useKpiKeyLabel();
  if (!kpi.value) return null;
  if (kpi.id === "G1") {
    const rows = mixRows(kpi.value);
    if (rows.length === 0) return <p className={`${small} ${muted} m-0`}>{t("value.empty")}</p>;
    return (
      <div className="table-scroll"><table className="data-table">
        <caption className="sr-only">{t("value.g1Caption")}</caption>
        <thead><tr>
          <th scope="col">{t("value.gate")}</th><th scope="col">{t("value.total")}</th><th scope="col">GO</th><th scope="col">HOLD</th><th scope="col">KILL</th>
          <th scope="col">{t("value.goShare")}</th><th scope="col">{t("value.priorGoShare")}</th>
        </tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.gate}><th scope="row">{label("kpiKey", r.gate)}</th><td className="tabular-nums">{r.total}</td><td className="tabular-nums">{r.go}</td><td className="tabular-nums">{r.hold}</td><td className="tabular-nums">{r.kill}</td>
            <td className="tabular-nums">{formatRate(r.goShare)}</td><td className="tabular-nums">{r.priorTotal === null ? "-" : `${formatRate(r.priorGoShare)} (${r.priorTotal})`}</td></tr>
        ))}</tbody>
      </table></div>
    );
  }
  if (kpi.id === "G6") {
    const rows = weekCountRows(kpi.value);
    return (
      <>
        <p className={`${small} ${muted} m-0 mb-2`}>{t("value.g6Unreviewed", { count: Number(kpi.value.unexplained ?? 0) })}</p>
        {rows.length === 0 ? <p className={`${small} ${muted} m-0`}>{t("value.empty")}</p> : (
          <div className="table-scroll"><table className="data-table">
            <caption className="sr-only">{t("value.g6Caption")}</caption>
            <thead><tr><th scope="col">{t("value.family")}</th><th scope="col">{t("value.code")}</th><th scope="col">{t("value.week")}</th><th scope="col">{t("value.count")}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={`${r.family}|${r.code}|${r.week}`}><th scope="row">{familyName(r.family)}</th><td><code lang="en">{r.code}</code></td><td className="tabular-nums">{r.week}</td><td className="tabular-nums">{r.count}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </>
    );
  }
  if (kpi.id === "G12") {
    const rows = streakRows(kpi.value);
    return (
      <div className="table-scroll"><table className="data-table">
        <caption className="sr-only">{t("value.g12Caption")}</caption>
        <thead><tr><th scope="col">{t("value.family")}</th><th scope="col">{t("value.streakDays")}</th><th scope="col">{t("value.writes")}</th><th scope="col">{t("value.qualifies")}</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.family}><th scope="row">{familyName(r.family)}</th><td className="tabular-nums">{r.streakDays}</td><td className="tabular-nums">{r.writes}</td>
            <td>{r.qualifies ? <span className="status-chip status-green"><CheckCircle2 size={14} aria-hidden="true" /> {t("value.yes")}</span> : <span className="status-chip status-amber"><Clock size={14} aria-hidden="true" /> {t("value.notYet")}</span>}</td></tr>
        ))}</tbody>
      </table></div>
    );
  }
  const flat = flattenValue(kpi.value);
  if (flat.length === 0) return null;
  return (
    <div className="table-scroll"><table className="data-table">
      <caption className="sr-only">{t("value.generalCaption", { id: kpi.id })}</caption>
      <thead><tr><th scope="col">{t("value.item")}</th><th scope="col">{t("value.figure")}</th></tr></thead>
      <tbody>{flat.map((r) => (
        <tr key={r.key}><th scope="row">{keyLabel(r.key)}</th><td className="tabular-nums">{r.value === null ? "-" : String(r.value)}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const t = useTranslations("admin.gateIntegrity");
  const familyName = useFamilyName();
  const breachText = useBreachText();
  const known = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"].includes(kpi.id);
  const title = known ? t(`kpiName.${kpi.id}` as never) : kpi.name;
  return (
    <section className="card" id={`kpi-card-${kpi.id}`} aria-labelledby={`kpi-${kpi.id}`} data-testid={`kpi-${kpi.id}`}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h2 id={`kpi-${kpi.id}`} className="m-0"><span className="tabular-nums">{kpi.id}</span> · {title}</h2>
        <KpiState kpi={kpi} />
        {kpi.li && (
          <span className="status-chip" title={t("li.title")}>
            {t("li.label")}{kpi.li_families.length > 0 && <>: {kpi.li_families.map((f, i) => <span key={f}>{i > 0 && ", "}{familyName(f)}</span>)}</>}
          </span>
        )}
      </div>
      {kpi.status === "ok" && (
        <p className={`${small} m-0 mb-2`}>
          <span className="tabular-nums">{kpi.numerator ?? "-"}</span>{kpi.denominator !== null && <> / <span className="tabular-nums">{kpi.denominator}</span></>}
          {kpi.rate !== null ? <> · {t("rate")} <strong className="tabular-nums">{formatRate(kpi.rate)}</strong></> : null}
        </p>
      )}
      {kpi.status === "migration_pending" && kpi.migration_pending && (
        <div role="note" className={small}>
          <p className="m-0 mb-1">{t("pending.intro", { section: kpi.migration_pending.section })}</p>
          <ul className="m-0 pl-5">
            {kpi.migration_pending.migrations.map((m) => <li key={m}><code lang="en">{m}</code></li>)}
            {kpi.migration_pending.missing.map((m) => <li key={m}>{t("pending.missing")} <code lang="en">{m}</code></li>)}
          </ul>
        </div>
      )}
      {kpi.status === "unavailable" && <p role="note" className={`${small} m-0`}>{t("unavailableBody")}{kpi.note ? <> <span className={muted} lang="en">{kpi.note}</span></> : null}</p>}
      {kpi.breach.breached && kpi.breach.reasons.length > 0 && (
        <div className={`${small} mb-2`}>
          <strong>{t("reasons")}</strong>
          <ul className="m-0 pl-5">{kpi.breach.reasons.map((r, i) => {
            const it = kpi.breach.items?.[i];
            const text = it ? breachText(it.code, it.params) : null;
            return <li key={`${i}-${r}`} {...(text ? {} : { lang: "en" })}>{text ?? r}</li>;
          })}</ul>
        </div>
      )}
      {kpi.status === "ok" && <KpiValue kpi={kpi} />}
      {kpi.status === "ok" && kpi.note && (
        <details className={`${small} mt-2`}><summary>{t("noteSummary")}</summary><p className={`${muted} m-0 mt-1`} lang="en">{kpi.note}</p></details>
      )}
    </section>
  );
}

function ReadinessSection({ families }: { families: FamilyStatus[] | undefined }) {
  const t = useTranslations("admin.gateIntegrity");
  const locale = useLocale();
  const rows = sortFamilies(families ?? []);
  return (
    <section className="card mb-3" aria-labelledby="gi-readiness" data-testid="gi-readiness">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h2 id="gi-readiness" className="m-0">{t("readiness.title")}</h2>
        <Link href={runbookHref(locale)} className="btn-ghost btn-sm inline-flex items-center gap-1"><BookOpen size={14} aria-hidden="true" /> {t("readiness.runbook")}</Link>
      </div>
      <p className={`${small} ${muted} m-0 mb-1`}>{t("readiness.intro")}</p>
      <p className={`${small} ${muted} m-0 mb-2`}>{t("readiness.ownerNote")}</p>
      {rows.length === 0 ? <p className={`${small} ${muted} m-0`}>{t("readiness.empty")}</p> : (
        <div className="table-scroll"><table className="data-table">
          <caption className="sr-only">{t("readiness.caption")}</caption>
          <thead><tr>
            <th scope="col">{t("readiness.col.family")}</th><th scope="col">{t("readiness.col.mode")}</th><th scope="col">{t("readiness.col.cleanDays")}</th>
            <th scope="col">{t("readiness.col.decisions")}</th><th scope="col">{t("readiness.col.wouldBlocks")}</th><th scope="col">{t("readiness.col.verdict")}</th>
          </tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.family} data-testid={`family-${r.family}`}>
              <th scope="row">
                <span className="block">{isKnownFamily(r.family) ? t(`family.${r.family}.name` as never) : r.family}</span>
                {isKnownFamily(r.family) && <span className={`block ${small} ${muted} font-normal`}>{t(`family.${r.family}.desc` as never)}</span>}
              </th>
              <td>{r.mode === "enforce"
                ? <span className="status-chip status-green"><ShieldCheck size={14} aria-hidden="true" /> {t("readiness.mode.enforce")}</span>
                : r.mode === "shadow"
                  ? <span className="status-chip status-amber"><Clock size={14} aria-hidden="true" /> {t("readiness.mode.shadow")}</span>
                  : <span className="status-chip"><HelpCircle size={14} aria-hidden="true" /> {t("readiness.mode.off")}</span>}</td>
              <td className="tabular-nums">{r.clean_days}</td>
              <td className="tabular-nums">{r.decisions}</td>
              <td className="tabular-nums">{r.would_blocks_14d}</td>
              <td>
                {r.verdict.state === "enforcing" && <span className="status-chip status-green"><ShieldCheck size={14} aria-hidden="true" /> {t("readiness.verdict.enforcing")}</span>}
                {r.verdict.state === "ready" && <span className="status-chip status-green"><CheckCircle2 size={14} aria-hidden="true" /> {t("readiness.verdict.ready")}</span>}
                {r.verdict.state === "not_yet" && (
                  <>
                    <span className="status-chip status-amber"><Clock size={14} aria-hidden="true" /> {t("readiness.verdict.notYet")}</span>
                    <ul className={`${small} ${muted} m-0 mt-1 pl-5`}>{r.verdict.reasons.map((x) => { const n = notReadyText(x); return <li key={x.code}>{t(n.key as never, n.params as never)}</li>; })}</ul>
                  </>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function ActionsSection({ kpis }: { kpis: Kpi[] }) {
  const t = useTranslations("admin.gateIntegrity");
  const breachText = useBreachText();
  const actions = useMemo(() => breachActions(kpis), [kpis]);
  return (
    <section className="card mb-3" aria-labelledby="gi-actions" data-testid="gi-actions">
      <h2 id="gi-actions" className="m-0 mb-1">{t("actions.title")}</h2>
      <p className={`${small} ${muted} m-0 mb-2`}>{t("actions.intro")}</p>
      {actions.length === 0 ? (
        <p className="m-0 flex items-center gap-1"><CheckCircle2 size={14} aria-hidden="true" /> {t("actions.empty")}</p>
      ) : (
        <ul className="m-0 pl-0 grid gap-2" style={{ listStyle: "none" }}>
          {actions.map((a) => {
            const text = breachText(a.code, a.params);
            const external = !a.href.startsWith("#");
            const href = a.href.startsWith("#") ? `#kpi-card-${a.kpiId}` : a.href;
            return (
              <li key={a.key} className="flex flex-wrap items-center gap-2" data-testid="gi-action">
                <AlertTriangle size={14} aria-hidden="true" />
                <span {...(text ? {} : { lang: "en" })}>{text ?? a.fallback}</span>
                {external ? <Link href={href} className="btn-ghost btn-sm inline-flex items-center gap-1">{t("actions.go")} <ArrowRight size={14} aria-hidden="true" /></Link>
                  : <a href={href} className="btn-ghost btn-sm inline-flex items-center gap-1">{t("actions.go")} <ArrowRight size={14} aria-hidden="true" /></a>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function KpiGroups({ kpis }: { kpis: Kpi[] }) {
  const t = useTranslations("admin.gateIntegrity");
  return (
    <div className="grid gap-3">
      {KPI_GROUPS.map((g) => {
        const members = g.ids.map((id) => kpis.find((k) => k.id === id)).filter((k): k is Kpi => !!k);
        if (members.length === 0) return null;
        const empty = members.filter(isEmptyKpi);
        const shown = members.filter((k) => !isEmptyKpi(k));
        const breached = members.filter((k) => k.status === "ok" && k.breach.breached).length;
        return (
          <details key={g.id} className="card" open={breached > 0 || shown.length > 0} data-testid={`kpi-group-${g.id}`}>
            <summary className="font-semibold">
              {t(`group.${g.id}.title` as never)} <span className={`${small} ${muted} font-normal`}>· {t("kpiCount", { count: members.length })}</span>
              {breached > 0 && <span className="status-chip status-red ml-2"><AlertTriangle size={14} aria-hidden="true" /> {t("state.breached")} {breached}</span>}
            </summary>
            <p className={`${small} ${muted} m-0 mt-1 mb-2`}>{t(`group.${g.id}.desc` as never)}</p>
            <div className="grid gap-3">{shown.map((k) => <KpiCard key={k.id} kpi={k} />)}</div>
            {empty.length > 0 && (
              <details className={`${small} mt-3`} data-testid={`kpi-empty-${g.id}`}>
                <summary>{t("emptyGroup", { count: empty.length })}</summary>
                <p className={`${muted} m-0 mt-1`}>{t("emptyGroupHint")}</p>
                <ul className="m-0 pl-5">{empty.map((k) => <li key={k.id}><span className="tabular-nums">{k.id}</span> · {t(`kpiName.${k.id}` as never)} - <span className={muted}>{t("noData")}</span></li>)}</ul>
              </details>
            )}
          </details>
        );
      })}
    </div>
  );
}

export function GateIntegrityKpiSection() {
  const t = useTranslations("admin.gateIntegrity");
  const tc = useTranslations("common");
  const label = useAdminLabel();
  const uid = useId().replace(/:/g, "");
  const [q, setQ] = useState<KpiQuery>(() => ({ from: currentWeekStart(), to: todayDate(), gate: "", minWrites: "" }));
  const [report, setReport] = useState<KpiReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = kpiQueryProblem(q);

  const load = useCallback((query: KpiQuery) => {
    setBusy(true); setError(null);
    api.get<KpiReport>(`/api/admin/gate-integrity/kpis?${kpiQueryString(query)}`)
      .then((r) => setReport(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : t("loadFailed")))
      .finally(() => setBusy(false));
  }, [t]);
  useEffect(() => { load(q); /* initial period only; later loads come from the form */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const breachedCount = useMemo(() => report?.kpis.filter((k) => k.status === "ok" && k.breach.breached).length ?? 0, [report]);

  return (
    <>
      <form
        className="card flex flex-wrap items-end gap-3 mb-3"
        aria-label={t("filter.legend")}
        onSubmit={(e) => { e.preventDefault(); if (!problem && !busy) load(q); }}
      >
        <label className={small} htmlFor={`${uid}-from`}><span className="block mb-1">{t("filter.from")}</span>
          <input id={`${uid}-from`} type="date" className="sizing-new-input sizing-new-input-sm" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} /></label>
        <label className={small} htmlFor={`${uid}-to`}><span className="block mb-1">{t("filter.to")}</span>
          <input id={`${uid}-to`} type="date" className="sizing-new-input sizing-new-input-sm" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} /></label>
        <label className={small} htmlFor={`${uid}-gate`}><span className="block mb-1">{t("filter.gate")}</span>
          <select id={`${uid}-gate`} className="sizing-new-input sizing-new-input-sm" value={q.gate} onChange={(e) => setQ({ ...q, gate: e.target.value })}>
            <option value="">{tc("all")}</option>
            {KPI_GATE_OPTIONS.map((g) => <option key={g} value={g}>{label("kpiKey", g)}</option>)}
          </select></label>
        <label className={small} htmlFor={`${uid}-mw`}><span className="block mb-1">{t("filter.minWrites")}</span>
          <input id={`${uid}-mw`} inputMode="numeric" className="sizing-new-input sizing-new-input-sm w-24" value={q.minWrites} placeholder="10" aria-describedby={`${uid}-mwh`} onChange={(e) => setQ({ ...q, minWrites: e.target.value })} />
          <span id={`${uid}-mwh`} className={`block mt-1 ${muted}`}>{t("filter.minWritesHint")}</span></label>
        <button type="submit" className="btn-primary" disabled={busy || !!problem}>{busy ? tc("loading") : t("filter.apply")}</button>
        {problem && <p role="alert" className={`${small} m-0 text-[color:var(--red-fg)]`}>{problem === "range" ? t("filter.rangeProblem") : t("filter.minWritesProblem")}</p>}
      </form>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      {!report && !error && <p>{tc("loading")}</p>}
      {report && (
        <>
          {report.unapplied_migrations.length > 0 && (
            <div role="status" className="card mb-3" data-testid="unapplied-banner">
              <p className="m-0 mb-1"><Clock size={14} aria-hidden="true" className="inline mr-1" /><strong>{t("banner.title")}</strong></p>
              <p className={`${small} ${muted} m-0 mb-1`}>{t("banner.body")}</p>
              <ul className={`${small} m-0 pl-5`}>{report.unapplied_migrations.map((m) => <li key={m}><code lang="en">{m}</code></li>)}</ul>
            </div>
          )}
          <p className={`${small} ${muted} mb-3`} data-testid="kpi-summary">
            {t("summary", { from: report.period.from.slice(0, 10), to: report.period.to.slice(0, 10), count: breachedCount })}{report.gate ? ` · ${t("filter.gate")}: ${label("kpiKey", report.gate)}` : ""}
          </p>
          <ReadinessSection families={report.families} />
          <ActionsSection kpis={report.kpis} />
          <KpiGroups kpis={report.kpis} />
        </>
      )}
    </>
  );
}
