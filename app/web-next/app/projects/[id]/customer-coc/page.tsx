"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { useTranslations } from "next-intl";
import { api } from "../../../../lib/api.ts";
import { ColGroup, PageState, useToast } from "../../../../components/ui.tsx";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 계약 CoC 표 6열 — ColGroup 고정 % (R10 table-sizing).
const COC_COL_PCT = [18, 10, 16, 12, 12, 32] as const;

// 고객 집중·CoC (customer-retention-agent) — Wave 0 REST B8.
// 매출 집중도 30% 이상은 자동 플래그, 추정 이탈은 가치 영향으로 반영된다.
interface Row { id: string; counterparty: string; direction: string; coc_clause_present: number; clause_summary: string | null; concentration_pct: number | null; est_exit_loss: number | null; flagged: number }

// 데이터 프로토콜 값(저장 카테고리·기록 본문) — UI 문자열이 아니므로 카탈로그로 옮기지 않는다.
const COC_CATEGORY = "고객·집중";

function CocView() {
  const t = useTranslations("pages.projects.customerCoc");
  const tc = useTranslations("common");
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ counterparty: "", direction: "customer", coc: false, concentration_pct: "", est_exit_loss: "", clause_summary: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<{ contracts: Row[] }>(`/api/projects/${encodeURIComponent(id)}/customer-coc`)
      .then((r) => setRows(r.data.contracts))
      .catch((e) => setError(e instanceof Error ? e.message : tc("errors.loadFailed")));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.counterparty.trim() || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/customer-coc`, {
        counterparty: form.counterparty.trim(), direction: form.direction,
        coc_clause_present: form.coc, clause_summary: form.clause_summary.trim() || undefined,
        concentration_pct: form.concentration_pct ? Number(form.concentration_pct) : undefined,
        est_exit_loss: form.est_exit_loss ? Number(form.est_exit_loss) : undefined,
      });
      toast(t("created"));
      setForm({ counterparty: "", direction: "customer", coc: false, concentration_pct: "", est_exit_loss: "", clause_summary: "" });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : tc("errors.createFailed")); }
    finally { setBusy(false); }
  }

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>{t("heading")}</h1>
      <p className="objective">
        {t("objLead")}<b>{t("objBold")}</b>{t("objMid")}
      </p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <section className="market-section" aria-label={t("tableAria")}>
        {rows === null ? <PageState state="loading" /> : rows.length === 0 ? (
          <PageState state="empty" emptyText={t("empty")} />
        ) : (
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-48" aria-label={t("tableAria")}>
              <caption className="sr-only">{t("tableAria")}</caption>
              <ColGroup widths={COC_COL_PCT} />
              <thead><tr><th>{t("thCounterparty")}</th><th>{tc("direction")}</th><th>{t("thCocClause")}</th><th className="col-num">{t("thConcentration")}</th><th className="col-num">{t("thEstExit")}</th><th>{t("thRegister")}</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id} className={r.flagged ? "row-selected" : undefined}>
                  <td className="font-semibold">{r.counterparty}{r.flagged ? <span className="status-chip status-red" style={{ marginLeft: 6 }}>{t("flaggedChip")}</span> : null}</td>
                  <td>{r.direction === "customer" ? t("dirCustomer") : t("dirSupplier")}</td>
                  <td>{r.coc_clause_present ? <span className="status-chip status-red">{t("clausePresent")}</span> : <span className="status-chip status-green">{t("clauseAbsent")}</span>}</td>
                  <td className="col-num tabular-nums">{r.concentration_pct != null ? `${r.concentration_pct}%` : "—"}</td>
                  <td className="col-num tabular-nums">{r.est_exit_loss != null ? t("estExitCell", { value: r.est_exit_loss }) : "—"}</td>
                  <td>
                    {canAct && (r.flagged || r.coc_clause_present) && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        title={t("pushBtnTitle")}
                        onClick={() => {
                          void (async () => {
                            setBusy(true);
                            try {
                              await api.post(`/api/projects/${encodeURIComponent(id)}/dd/findings`, {
                                category: COC_CATEGORY,
                                description: `[${r.direction === "customer" ? "고객" : "공급"}] ${r.counterparty} — 지위 변동(CoC) 조항 ${r.coc_clause_present ? "있음" : "없음"}${r.concentration_pct != null ? `, 집중도 ${r.concentration_pct}%` : ""}${r.clause_summary ? ` — ${r.clause_summary}` : ""}`,
                                value_impact: r.est_exit_loss != null ? Math.round(r.est_exit_loss * 100) : null,
                                evidence_ref: `customer-coc:${r.id}`,
                              });
                              toast(t("pushDone"));
                            } catch (e) {
                              toast(e instanceof Error ? t("pushFailedWith", { message: e.message }) : tc("errors.createFailed"));
                            } finally { setBusy(false); }
                          })();
                        }}
                      >{t("pushBtn")}</button>
                    )}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      {canAct && (
        <section className="market-section" aria-label={t("registerSectionAria")}>
          <h2 className="text-[length:var(--fs-body)] mb-2">{t("registerHeading")}</h2>
          <form className="sizing-new-form" onSubmit={create}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[12rem]"><span className="block mb-1">{t("lblCounterparty")}</span>
                <input className="sizing-new-input w-full" value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">{tc("direction")}</span>
                <select className="sizing-new-input sizing-new-input-sm" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}><option value="customer">{t("dirCustomer")}</option><option value="supplier">{t("dirSupplier")}</option></select></label>
              <label className="text-[length:var(--fs-caption)] flex items-center gap-1" style={{ marginBottom: 8 }}><input type="checkbox" checked={form.coc} onChange={(e) => setForm({ ...form, coc: e.target.checked })} /> {t("lblCocClause")}</label>
              <label className="text-[length:var(--fs-caption)] w-[7rem]"><span className="block mb-1">{t("lblConcentration")}</span>
                <input type="number" className="sizing-new-input sizing-new-input-sm" value={form.concentration_pct} onChange={(e) => setForm({ ...form, concentration_pct: e.target.value })} /></label>
              <label className="text-[length:var(--fs-caption)] w-[8rem]"><span className="block mb-1">{t("lblEstExit")}</span>
                <input type="number" className="sizing-new-input sizing-new-input-sm" value={form.est_exit_loss} onChange={(e) => setForm({ ...form, est_exit_loss: e.target.value })} /></label>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? tc("registering") : tc("register")}</button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}

export default function CocPage() {
  return <Suspense fallback={null}><CocView /></Suspense>;
}
