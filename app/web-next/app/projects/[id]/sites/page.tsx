"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { S10Frame } from "../../../../components/stages/S10Frame.tsx";
import { useTranslations } from "next-intl";
import { api } from "../../../../lib/api.ts";
import Link from "next/link";
import { ColGroup, PageState, useToast } from "../../../../components/ui.tsx";
import { useConfirm } from "../../../../components/crud.tsx";

// 부지 비교 8열 — 부지명·지역에 여유, 점수 열은 균등하게 좁게.
const SITE_COL_PCT = [16, 13, 10, 10, 10, 12, 11, 10, 8] as const;
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 부지·시설 평가 (site-facility-agent) — Wave 0 REST B4. 점수는 저장값만
// 렌더링하고 순위로 비교한다 (ADR-0112 — 값 발명 금지).
interface Row { id: string; name: string; region_code: string | null; infra_score: number | null; logistics_score: number | null; labor_score: number | null; permit_lead_time_days: number | null; total_score: number | null; rank: number | null; address: string | null; infra_notes: string | null; labor_notes: string | null }

function SitesView() {
  const t = useTranslations("pages.projects.sites");
  const tc = useTranslations("common");
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", address: "", region_code: "", infra_score: "", logistics_score: "", labor_score: "", permit_lead_time_days: "", total_score: "", infra_notes: "", labor_notes: "" });
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  // 2026-10-21 lifecycle — 후보 삭제 (잘못 입력한 행이 영구 잔존하지 않도록).
  function remove(r: Row) {
    confirm(t("confirmTitle"), () => {
      void (async () => {
        try {
          await api.delete(`/api/projects/${encodeURIComponent(id)}/sites?id=${encodeURIComponent(r.id)}`);
          toast(t("deleted"));
          load();
        } catch (e) { toast(e instanceof Error ? t("deleteFailedWith", { message: e.message }) : tc("errors.deleteFailed")); }
      })();
    }, { body: t("confirmBody", { name: r.name }), confirmLabel: tc("delete") });
  }

  const [draft, setDraft] = useState<{ siteId: string; siteName: string; source: string; note: string; synthesis: string; items: Array<{ area: string; issue: string; check: string }>; cautions: string[] } | null>(null);
  const [draftBusy, setDraftBusy] = useState<string | null>(null);

  // 법규 사전검토 초안 (k-law 관점 LLM — 제안 전용, 저장 없음; 최종 확인은 사람+k-law 원문)
  async function regulatoryDraft(r: Row) {
    if (draftBusy) return;
    setDraftBusy(r.id);
    try {
      const res = await api.post<{ siteId: string; siteName: string; source: string; note: string; draft: { synthesis: string; items: Array<{ area: string; issue: string; check: string }>; cautions: string[] } }>(
        `/api/projects/${encodeURIComponent(id)}/sites/regulatory-draft`, { site_id: r.id },
      );
      setDraft({ siteId: r.id, siteName: r.name, source: res.data.source, note: res.data.note, ...res.data.draft });
      toast(res.data.source === "llm" ? t("draftLlmToast") : t("draftFallbackToast"));
    } catch (e) {
      toast(e instanceof Error ? t("draftFailedWith", { message: e.message }) : t("draftFailed"));
    } finally {
      setDraftBusy(null);
    }
  }

  const load = useCallback(() => {
    api.get<{ sites: Row[] }>(`/api/projects/${encodeURIComponent(id)}/sites`)
      .then((r) => setRows(r.data.sites))
      .catch((e) => setError(e instanceof Error ? e.message : tc("errors.loadFailed")));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || busy) return;
    setBusy(true);
    try {
      const n = (k: string) => (form[k as keyof typeof form] ? Number(form[k as keyof typeof form]) : undefined);
      await api.post(`/api/projects/${encodeURIComponent(id)}/sites`, {
        name: form.name.trim(), address: form.address.trim() || undefined, region_code: form.region_code.trim() || undefined,
        infra_notes: form.infra_notes.trim() || undefined, labor_notes: form.labor_notes.trim() || undefined,
        infra_score: n("infra_score"), logistics_score: n("logistics_score"), labor_score: n("labor_score"),
        permit_lead_time_days: n("permit_lead_time_days"), total_score: n("total_score"),
      });
      toast(t("created"));
      setForm({ name: "", address: "", region_code: "", infra_score: "", logistics_score: "", labor_score: "", permit_lead_time_days: "", total_score: "", infra_notes: "", labor_notes: "" });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : tc("errors.createFailed")); }
    finally { setBusy(false); }
  }

  return (
    <main>
      <S10Frame projectId={id} />
      <h2>{t("heading")}</h2>
      <p className="objective">{t("objective")}{" "}<Link href={`/projects/${encodeURIComponent(id)}/permits`} className="underline">{t("permitsLink")}</Link></p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <section className="market-section" aria-label={t("compareSectionAria")}>
        {rows === null ? <PageState state="loading" /> : rows.length === 0 ? (
          <PageState state="empty" emptyText={t("empty")} />
        ) : (
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-56" aria-label={t("compareSectionAria")}>
              <caption className="sr-only">{t("compareSectionAria")}</caption>
              <ColGroup widths={SITE_COL_PCT} />
              <thead><tr><th>{t("thSite")}</th><th>{t("thRegion")}</th><th className="col-num">{t("thInfra")}</th><th className="col-num">{t("thLogistics")}</th><th className="col-num">{t("thLabor")}</th><th className="col-num">{t("thPermitDays")}</th><th className="col-num">{t("thTotal")}</th><th>{t("thRank")}</th><th>{t("thManage")}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.name}{r.address && <div className="note" title={r.address}>{r.address}</div>}</td>
                    <td>{r.region_code ?? "—"}</td>
                    <td className="col-num tabular-nums">{r.infra_score ?? "—"}</td>
                    <td className="col-num tabular-nums">{r.logistics_score ?? "—"}</td>
                    <td className="col-num tabular-nums">{r.labor_score ?? "—"}</td>
                    <td className="col-num tabular-nums">{r.permit_lead_time_days ?? "—"}</td>
                    <td className="col-num tabular-nums font-semibold">{r.total_score ?? "—"}</td>
                    <td>{r.rank ? <span className="status-chip status-green">#{r.rank}</span> : "—"}</td>
                    <td>{canAct && <button type="button" className="btn-ghost btn-sm mb-1" disabled={draftBusy === r.id}
                        title={t("draftBtnTitle")}
                        onClick={() => void regulatoryDraft(r)}>{draftBusy === r.id ? t("draftGenerating") : t("draftBtn")}</button>}
                      {canAct && <button type="button" className="btn-danger btn-sm" onClick={() => remove(r)} title={t("deleteBtnTitle")}>{tc("delete")}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {draft && (
        <section className="market-section" aria-label={t("draftSectionAria")} data-testid="site-regulatory-draft">
          <h2 className=" mb-2">{t("draftHeading", { name: draft.siteName })} <span className={`status-chip ${draft.source === "llm" ? "status-amber" : "status-gray"}`}>{draft.source === "llm" ? t("chipLlm") : t("chipFallback")}</span></h2>
          <p className="text-[length:var(--fs-caption)]">{draft.synthesis}</p>
          <ul className="sizing-note-list mt-1">
            {draft.items.map((it, i) => (
              <li key={i}><strong>[{it.area}]</strong> {it.issue}<span className="block text-[color:var(--muted-fg)]">{t("checkLine", { value: it.check })}</span></li>
            ))}
          </ul>
          {draft.cautions.length > 0 && <p className="note">{t("cautionsLine", { value: draft.cautions.join(" · ") })}</p>}
          <p className="note" style={{ marginBottom: 0 }}>{t("draftFootnote")}</p>
        </section>
      )}
      {canAct && (
        <section className="market-section" aria-label={t("registerSectionAria")}>
          <h2 className=" mb-2">{t("registerHeading")}</h2>
            <div className="grid gap-x-3 gap-y-2 md:grid-cols-3 text-[length:var(--fs-caption)]">
              <label className="grid gap-1"><span className="block">{t("lblName")}</span>
                <input className="sizing-new-input w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
              <label className="grid gap-1 md:col-span-2"><span className="block">{t("lblAddress")}</span>
                <input className="sizing-new-input w-full" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder={t("phAddress")} /></label>
              <label className="grid gap-1"><span className="block">{t("lblRegion")}</span>
                <input className="sizing-new-input w-full" value={form.region_code} onChange={(e) => setForm({ ...form, region_code: e.target.value })} /></label>
              <label className="grid gap-1"><span className="block">{t("lblInfra")}</span>
                <input type="number" className="sizing-new-input w-full" value={form.infra_score} onChange={(e) => setForm({ ...form, infra_score: e.target.value })} /></label>
              <label className="grid gap-1"><span className="block">{t("lblLogistics")}</span>
                <input type="number" className="sizing-new-input w-full" value={form.logistics_score} onChange={(e) => setForm({ ...form, logistics_score: e.target.value })} /></label>
              <label className="grid gap-1"><span className="block">{t("lblLabor")}</span>
                <input type="number" className="sizing-new-input w-full" value={form.labor_score} onChange={(e) => setForm({ ...form, labor_score: e.target.value })} /></label>
              <label className="grid gap-1"><span className="block">{t("lblPermitDays")}</span>
                <input type="number" className="sizing-new-input w-full" value={form.permit_lead_time_days} onChange={(e) => setForm({ ...form, permit_lead_time_days: e.target.value })} /></label>
              <label className="grid gap-1"><span className="block">{t("lblTotal")}</span>
                <input type="number" className="sizing-new-input w-full" value={form.total_score} onChange={(e) => setForm({ ...form, total_score: e.target.value })} /></label>
              <label className="grid gap-1 md:col-span-3"><span className="block">{t("lblInfraNotes")}</span>
                <input className="sizing-new-input w-full" value={form.infra_notes} onChange={(e) => setForm({ ...form, infra_notes: e.target.value })} placeholder={t("phInfraNotes")} /></label>
              <label className="grid gap-1 md:col-span-3"><span className="block">{t("lblLaborNotes")}</span>
                <input className="sizing-new-input w-full" value={form.labor_notes} onChange={(e) => setForm({ ...form, labor_notes: e.target.value })} placeholder={t("phLaborNotes")} /></label>
              <div className="md:col-span-3">
                <button type="submit" className="btn-primary" disabled={busy}>{busy ? tc("registering") : tc("register")}</button>
              </div>
            </div>
        </section>
      )}
      {confirmDialog}
    </main>
  );
}

export default function SitesPage() {
  return <Suspense fallback={null}><SitesView /></Suspense>;
}
