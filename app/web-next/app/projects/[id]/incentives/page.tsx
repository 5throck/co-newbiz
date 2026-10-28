"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { useTranslations } from "next-intl";
import { api } from "../../../../lib/api.ts";
import { fmtNpvEok } from "../../../../lib/npv-format.ts";
import { ColGroup, PageState, useToast } from "../../../../components/ui.tsx";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";
import { useConfirm } from "../../../../components/crud.tsx";

// 인센티브 표 7열 — ColGroup 고정 % (R10 table-sizing).
const INCENTIVE_COL_PCT = [16, 12, 12, 10, 18, 22, 10] as const;

// 인센티브·클로백 (incentive-agent) — Wave 0 REST B3. 수혜 예정/확정 인센티브와
// 클로백 조건을 관리하고 클로백 추정액은 S10 자금조달과 대조된다.
// 2026-10-21: 적격 증빙(evidence_ref)이 있는 인센티브만 "→ 자금 조달" 버튼으로 S10
// sources 항목(evidence_kind=subsidy_grant)에 들어간다 — deal-structuring step 7
// "incentive proceeds enter the sources side only with evidenced eligibility".
interface Row { id: string; program_name: string | null; grantor: string | null; npv_value: number | null; clawback_rule: string | null; direction: string; evidence_ref: string | null }

function IncentivesView() {
  const t = useTranslations("pages.projects.incentives");
  const tc = useTranslations("common");
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ program_name: "", grantor: "", npv_value: "", clawback_rule: "", direction: "prospective", evidence_ref: "" });
  const [busy, setBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  // 2026-10-21 lifecycle — 방향 전환(prospective↔granted)·삭제.
  async function setDirection(r: Row, direction: string) {
    try {
      await api.put(`/api/projects/${encodeURIComponent(id)}/incentives`, { id: r.id, direction });
      toast(t("dirChanged", { direction: direction === "granted" ? t("dirGranted") : t("dirProspective") }));
      load();
    } catch (e) { toast(e instanceof Error ? t("changeFailedWith", { message: e.message }) : t("changeFailed")); }
  }
  function remove(r: Row) {
    confirm(t("deleteConfirmTitle"), () => {
      void (async () => {
        try {
          await api.delete(`/api/projects/${encodeURIComponent(id)}/incentives?id=${encodeURIComponent(r.id)}`);
          toast(t("deleted"));
          load();
        } catch (e) { toast(e instanceof Error ? t("deleteFailedWith", { message: e.message }) : tc("errors.deleteFailed")); }
      })();
    }, { body: t("deleteConfirmBody", { name: r.program_name ?? t("fallbackProgram") }), confirmLabel: tc("delete") });
  }

  const load = useCallback(() => {
    api.get<{ incentives: Row[] }>(`/api/projects/${encodeURIComponent(id)}/incentives`)
      .then((r) => setRows(r.data.incentives))
      .catch((e) => setError(e instanceof Error ? e.message : tc("errors.loadFailed")));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.program_name.trim() || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/incentives`, {
        program_name: form.program_name.trim(), grantor: form.grantor.trim() || undefined,
        // 화면 단위 억원 → 저장 단위 백만 KRW(×100, ADR-0061) — 0168부터 저장 단위 고정.
        npv_value: form.npv_value ? Number(form.npv_value) * 100 : undefined,
        clawback_rule: form.clawback_rule.trim() || undefined, direction: form.direction,
        evidence_ref: form.evidence_ref.trim() || undefined,
      });
      toast(t("created"));
      setForm({ program_name: "", grantor: "", npv_value: "", clawback_rule: "", direction: "prospective", evidence_ref: "" });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : tc("errors.createFailed")); }
    finally { setBusy(false); }
  }

  // 인센티브 수입을 S10 자금조달 sources로 — 적격 증빙과 NPV가 있는 행만. 저장 단위는 이미 백만 KRW.
  async function pushToFinancing(r: Row) {
    if (!r.evidence_ref || r.npv_value == null) return;
    setPushBusy(r.id);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/deal-structure`, {
        action: "add_financing_entry", kind: "source",
        name: r.grantor ? t("pushNameWithGrantor", { name: r.program_name ?? t("fallbackProgram"), grantor: r.grantor }) : t("pushName", { name: r.program_name ?? t("fallbackProgram") }),
        amount_krw_m: r.npv_value,
        note: r.clawback_rule
          ? t("pushNoteClawback", { direction: r.direction === "granted" ? t("dirGranted") : t("dirProspective"), clawback: r.clawback_rule })
          : t("pushNoteSimple", { direction: r.direction === "granted" ? t("dirGranted") : t("dirProspective") }),
        evidence_kind: "subsidy_grant",
        evidence_ref: `incentive:${r.id} · ${r.evidence_ref}`,
      });
      toast(t("pushDone"));
    } catch (e) {
      toast(e instanceof Error ? t("pushFailedWith", { message: e.message }) : tc("errors.createFailed"));
    } finally {
      setPushBusy(null);
    }
  }

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>{t("heading")}</h1>
      <p className="objective">{t("objective")}</p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <section className="market-section" aria-label={t("listSectionAria")}>
        {rows === null ? <PageState state="loading" /> : rows.length === 0 ? (
          <PageState state="empty" emptyText={t("empty")} />
        ) : (
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-64" aria-label={t("tableAria")}>
              <caption className="sr-only">{t("tableAria")}</caption>
              <ColGroup widths={INCENTIVE_COL_PCT} />
              <thead><tr><th>{t("thProgram")}</th><th>{t("thGrantor")}</th><th>{tc("direction")}</th><th className="col-num">{t("thNpv")}</th><th>{t("thClawback")}</th><th>{t("thEvidence")}</th><th>{t("thManage")}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.program_name ?? "—"}</td>
                    <td>{r.grantor ?? "—"}</td>
                    <td>{canAct ? (
                        <select aria-label={t("dirAria", { name: r.program_name ?? t("fallbackProgram") })} className="sizing-new-input sizing-new-input-sm" value={r.direction} onChange={(e) => void setDirection(r, e.target.value)}>
                          <option value="prospective">{t("dirProspective")}</option><option value="granted">{t("dirGranted")}</option>
                        </select>
                      ) : <span className={`status-chip ${r.direction === "granted" ? "status-green" : "status-amber"}`}>{r.direction === "granted" ? t("dirGranted") : t("dirProspective")}</span>}</td>
                    <td className="col-num tabular-nums">{r.npv_value != null ? t("npvEok", { value: fmtNpvEok(r.npv_value) }) : "—"}</td>
                    <td className="text-[length:var(--fs-caption)]">{r.clawback_rule ?? "—"}</td>
                    <td className="text-[length:var(--fs-caption)]">
                      {r.evidence_ref ? <code className="dd-item-id mr-1" title={r.evidence_ref}>{r.evidence_ref.slice(0, 24)}</code> : <span className="status-chip status-amber mr-1" title={t("noEvidenceTitle")}>{t("noEvidenceChip")}</span>}
                      {canAct && (
                        <button type="button" className="btn-ghost btn-sm" disabled={!r.evidence_ref || r.npv_value == null || pushBusy === r.id}
                          title={!r.evidence_ref ? t("pushNeedEvidence") : r.npv_value == null ? t("pushNeedNpv") : t("pushTitle")}
                          onClick={() => void pushToFinancing(r)}>{t("pushBtn")}</button>
                      )}
                    </td>
                    <td>{canAct && <button type="button" className="btn-danger btn-sm" onClick={() => remove(r)}>{tc("delete")}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {canAct && (
        <section className="market-section" aria-label={t("registerSectionAria")}>
          <h2 className=" mb-2">{t("registerHeading")}</h2>
          <form className="sizing-new-form" onSubmit={create}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[14rem]"><span className="block mb-1">{t("lblProgram")}</span>
                <input className="sizing-new-input w-full" value={form.program_name} onChange={(e) => setForm({ ...form, program_name: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">{t("lblGrantor")}</span>
                <input className="sizing-new-input sizing-new-input-sm" value={form.grantor} onChange={(e) => setForm({ ...form, grantor: e.target.value })} /></label>
              <label className="text-[length:var(--fs-caption)] w-[7rem]"><span className="block mb-1">{t("lblNpv")}</span>
                <input type="number" className="sizing-new-input sizing-new-input-sm" value={form.npv_value} onChange={(e) => setForm({ ...form, npv_value: e.target.value })} /></label>
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[12rem]"><span className="block mb-1">{t("lblClawback")}</span>
                <input className="sizing-new-input w-full" value={form.clawback_rule} onChange={(e) => setForm({ ...form, clawback_rule: e.target.value })} placeholder={t("phClawback")} /></label>
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[12rem]"><span className="block mb-1">{t("lblEvidence")}</span>
                <input className="sizing-new-input w-full" value={form.evidence_ref} onChange={(e) => setForm({ ...form, evidence_ref: e.target.value })} placeholder={t("phEvidence")} /></label>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? tc("registering") : tc("register")}</button>
            </div>
          </form>
        </section>
      )}
      {confirmDialog}
    </main>
  );
}

export default function IncentivesPage() {
  return <Suspense fallback={null}><IncentivesView /></Suspense>;
}
