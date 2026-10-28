"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { useTranslations } from "next-intl";
import { api } from "../../../../lib/api.ts";
import { PageState, useToast } from "../../../../components/ui.tsx";
import { useConfirm } from "../../../../components/crud.tsx";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 인허가·인증 추적 (certification-agent) — Wave 0 REST B5. 허가와 인증을
// 별도 목록으로 추적한다 (flow.spec: permits and certifications are separate).
// 2026-10-21: 상태 변경(PUT)·삭제(DELETE) — 등록만 있던 목록에 생애주기를 붙였다.
interface Permit { id: string; name: string; agency: string | null; statutory_days: number | null; status: string }
interface Cert { id: string; name: string; agency: string | null; status: string; transferable_on_coc: string | null }
const STATUS_OPTIONS = ["not_started", "in_progress", "granted", "denied", "withdrawn"];

function PermitsView() {
  const t = useTranslations("pages.projects.permits");
  const tc = useTranslations("common");
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [data, setData] = useState<{ permits: Permit[]; certifications: Cert[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ kind: "permit", name: "", agency: "", statutory_days: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<{ permits: Permit[]; certifications: Cert[] }>(`/api/projects/${encodeURIComponent(id)}/permits`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : tc("errors.loadFailed")));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/permits`, {
        kind: form.kind, name: form.name.trim(), agency: form.agency.trim() || undefined,
        statutory_days: form.statutory_days ? Number(form.statutory_days) : undefined,
      });
      toast(t("created", { kind: form.kind === "permit" ? t("kindPermit") : t("kindCert") }));
      setForm({ ...form, name: "", agency: "", statutory_days: "" });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : tc("errors.createFailed")); }
    finally { setBusy(false); }
  }

  async function setStatus(kind: "permit" | "certification", rowId: string, status: string) {
    try {
      await api.put(`/api/projects/${encodeURIComponent(id)}/permits`, { kind, id: rowId, status });
      toast(t("statusChanged"));
      load();
    } catch (e) { toast(e instanceof Error ? t("changeFailedWith", { message: e.message }) : t("changeFailed")); }
  }

  function remove(kind: "permit" | "certification", rowId: string, name: string) {
    confirm(t("deleteConfirmTitle", { kind: kind === "permit" ? t("kindPermit") : t("kindCert") }), () => {
      void (async () => {
        try {
          await api.delete(`/api/projects/${encodeURIComponent(id)}/permits?kind=${kind}&id=${encodeURIComponent(rowId)}`);
          toast(t("deleted"));
          load();
        } catch (e) { toast(e instanceof Error ? t("deleteFailedWith", { message: e.message }) : tc("errors.deleteFailed")); }
      })();
    }, { body: t("deleteConfirmBody", { name }), confirmLabel: tc("delete") });
  }

  const statusChip = (s: string) => (
    <span className={`status-chip ${s === "granted" ? "status-green" : s === "denied" || s === "withdrawn" ? "status-red" : "status-amber"}`}>{s}</span>
  );
  const statusEditor = (kind: "permit" | "certification", r: { id: string; status: string }) => (
    canAct
      ? <select aria-label={t("statusChangeAria", { id: r.id })} className="sizing-new-input sizing-new-input-sm" value={STATUS_OPTIONS.includes(r.status) ? r.status : ""} onChange={(e) => { if (e.target.value) void setStatus(kind, r.id, e.target.value); }}>
          {!STATUS_OPTIONS.includes(r.status) && <option value="">{r.status}</option>}
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      : statusChip(r.status)
  );
  const removeButton = (kind: "permit" | "certification", r: { id: string; name: string }) => (
    canAct
      ? <button type="button" className="btn-danger btn-sm" onClick={() => remove(kind, r.id, r.name)}>{tc("delete")}</button>
      : null
  );

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>{t("heading")}</h1>
      <p className="objective">{t("objective")}{" "}<Link href={`/projects/${encodeURIComponent(id)}/sites`} className="underline">{t("sitesLink")}</Link></p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <div className="grid2e">
        <section className="market-section" aria-label={t("kindPermit")}>
          <h2 className=" mb-2">{t("kindPermit")}</h2>
          {data === null ? <PageState state="loading" /> : data.permits.length === 0 ? (
            <PageState state="empty" emptyText={t("emptyPermits")} />
          ) : (
            <table className="data-table" aria-label={t("kindPermit")}>
              <thead><tr><th>{t("kindPermit")}</th><th>{t("thAgency")}</th><th className="col-num">{t("thStatutoryDays")}</th><th>{tc("status")}</th><th>{t("thManage")}</th></tr></thead>
              <tbody>{data.permits.map((r) => (
                <tr key={r.id}><td className="font-semibold">{r.name}</td><td>{r.agency ?? "—"}</td><td className="col-num tabular-nums">{r.statutory_days ?? "—"}</td><td>{statusEditor("permit", r)}</td><td>{removeButton("permit", r)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </section>
        <section className="market-section" aria-label={t("kindCert")}>
          <h2 className=" mb-2">{t("kindCert")}</h2>
          {data === null ? <PageState state="loading" /> : data.certifications.length === 0 ? (
            <PageState state="empty" emptyText={t("emptyCerts")} />
          ) : (
            <table className="data-table" aria-label={t("kindCert")}>
              <thead><tr><th>{t("kindCert")}</th><th>{t("thAgency")}</th><th>{tc("status")}</th><th>{t("thCocTransfer")}</th><th>{t("thManage")}</th></tr></thead>
              <tbody>{data.certifications.map((r) => (
                <tr key={r.id}><td className="font-semibold">{r.name}</td><td>{r.agency ?? "—"}</td><td>{statusEditor("certification", r)}</td><td>{r.transferable_on_coc ?? "—"}</td><td>{removeButton("certification", r)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </section>
      </div>
      {canAct && (
        <section className="market-section" aria-label={tc("register")}>
          <h2 className=" mb-2">{tc("register")}</h2>
          <form className="sizing-new-form" onSubmit={create}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">{t("lblKind")}</span>
                <select className="sizing-new-input sizing-new-input-sm" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  <option value="permit">{t("kindPermit")}</option><option value="certification">{t("kindCert")}</option>
                </select></label>
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[12rem]"><span className="block mb-1">{t("lblName")}</span>
                <input className="sizing-new-input w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">{t("lblAgency")}</span>
                <input className="sizing-new-input sizing-new-input-sm" value={form.agency} onChange={(e) => setForm({ ...form, agency: e.target.value })} /></label>
              <label className="text-[length:var(--fs-caption)] w-[7rem]"><span className="block mb-1">{t("lblStatutoryDays")}</span>
                <input type="number" className="sizing-new-input sizing-new-input-sm" value={form.statutory_days} onChange={(e) => setForm({ ...form, statutory_days: e.target.value })} /></label>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? tc("registering") : tc("register")}</button>
            </div>
          </form>
        </section>
      )}
      {confirmDialog}
    </main>
  );
}

export default function PermitsPage() {
  return <Suspense fallback={null}><PermitsView /></Suspense>;
}
