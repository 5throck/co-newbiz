"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { api } from "../../../../lib/api.ts";
import { ColGroup, PageState, useToast } from "../../../../components/ui.tsx";
import { useConfirm } from "../../../../components/crud.tsx";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";
import { DUE_SOON_DAYS, type MilestoneCategory, type MilestoneStatus, type MilestoneView } from "../../../../lib/milestone-view.ts";

// 마일스톤 표 7열 — ColGroup 고정 % (R10 table-sizing).
const MILESTONE_COL_PCT = [26, 10, 12, 10, 12, 8, 22] as const;

// 프로젝트 마일스톤 (2026-10-21, migration 0167) — S12 일정관리의 사람 전용
// 원장. 모든 단계 바의 공통 링크로 도달한다(프로젝트 공통). 상태는 기한·완료일에서
// 계산값이며 참고 표시다 — 지연 마일스톤이 무엇을 막지는 않는다 (S12 게이트 없음).
// greenfield 실행 기준선의 인허가/인증 마일스톤은 "기준선에서 가져오기"로 일괄 등록.

const CATEGORY_KEY: Record<MilestoneCategory, string> = {
  permit: "catPermit", certification: "catCertification", capex: "catCapex", contract: "catContract", custom: "catCustom",
};
const STATUS_META: Record<MilestoneStatus, { key: string; cls: string }> = {
  done: { key: "statusDone", cls: "status-green" },
  overdue: { key: "statusOverdue", cls: "status-red" },
  due_soon: { key: "statusDueSoon", cls: "status-amber" },
  planned: { key: "statusPlanned", cls: "status-gray" },
};
const STATUS_ORDER: MilestoneStatus[] = ["overdue", "due_soon", "planned", "done"];

function MilestonesView() {
  const t = useTranslations("pages.projects.milestones");
  const tc = useTranslations("common");
  const statusText = (st: MilestoneStatus): string =>
    st === "due_soon" ? t("statusDueSoon", { p1: DUE_SOON_DAYS }) : t(STATUS_META[st].key);
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const { confirm, confirmDialog } = useConfirm();
  const [rows, setRows] = useState<MilestoneView[] | null>(null);
  const [summary, setSummary] = useState<{ total: number; open: number; done: number; overdue: number; due_soon: number } | null>(null);
  const [baselineReady, setBaselineReady] = useState<boolean | null>(null);
  const [track, setTrack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", category: "custom", due_date: "", owner: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  // AI 추천 (제안 전용 — 등록은 사람이 항목별로 실행, 감사 기록)
  const [suggestions, setSuggestions] = useState<Array<{ title: string; category: MilestoneCategory; due_date: string; reason: string }> | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);

  async function suggestMilestones() {
    if (suggestBusy) return;
    setSuggestBusy(true);
    try {
      const r = await api.post<{ source: string; note: string; suggestions: Array<{ title: string; category: MilestoneCategory; due_date: string; reason: string }> }>(
        `/api/projects/${encodeURIComponent(id)}/milestones/suggest`, {},
      );
      setSuggestions(r.data.suggestions);
      toast(r.data.source === "llm" ? t("suggestLlmToast") : t("suggestFallbackToast"));
    } catch (e) {
      toast(e instanceof Error ? t("suggestFailedPrefix", { p1: e.message }) : t("suggestFailed"));
    } finally {
      setSuggestBusy(false);
    }
  }

  async function addSuggestion(sg: { title: string; category: MilestoneCategory; due_date: string }) {
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/milestones`, { title: sg.title, category: sg.category, due_date: sg.due_date });
      toast(t("suggestAddedToast", { p1: sg.title }));
      setSuggestions((cur) => (cur ? cur.filter((x) => x.title !== sg.title) : cur));
      load();
    } catch (e) {
      toast(e instanceof Error ? t("createFailedPrefix", { p1: e.message }) : tc("errors.createFailed"));
    }
  }

  const load = useCallback(() => {
    api.get<{ milestones: MilestoneView[]; summary: typeof summary }>(`/api/projects/${encodeURIComponent(id)}/milestones`)
      .then((r) => { setRows(r.data.milestones); setSummary(r.data.summary); })
      .catch((e) => setError(e instanceof Error ? e.message : t("loadFailed")));
    api.get<{ baseline_variance: { status: string } | null }>(`/api/projects/${encodeURIComponent(id)}/post-management`)
      .then((r) => setBaselineReady(r.data.baseline_variance?.status === "computed"))
      .catch(() => setBaselineReady(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // 트랙 관점 가이드 (2026-10-21 decider: greenfield은 연구개발 기반 사업화,
  // brownfield는 M&A 실사·PMI 관점). 표시 전용.
  useEffect(() => {
    let alive = true;
    api.get<{ track: string | null }>(`/api/projects/${encodeURIComponent(id)}/process`)
      .then((r) => { if (alive) setTrack(r.data.track ?? null); })
      .catch(() => { if (alive) setTrack(null); });
    return () => { alive = false; };
  }, [id]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !form.title.trim() || !form.due_date) return;
    setBusy(true);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/milestones`, {
        title: form.title.trim(), category: form.category, due_date: form.due_date,
        owner: form.owner.trim() || undefined, notes: form.notes.trim() || undefined,
      });
      toast(t("createdToast"));
      setForm({ ...form, title: "", due_date: "", owner: "", notes: "" });
      load();
    } catch (err) { toast(err instanceof Error ? t("createFailedPrefix", { p1: err.message }) : tc("errors.createFailed")); }
    finally { setBusy(false); }
  }

  async function toggleDone(r: MilestoneView) {
    try {
      await api.put(`/api/projects/${encodeURIComponent(id)}/milestones/${encodeURIComponent(r.id)}`, { done: !r.done_at });
      load();
    } catch (e) { toast(e instanceof Error ? t("updateFailedPrefix", { p1: e.message }) : t("updateFailed")); }
  }

  function remove(r: MilestoneView) {
    confirm(t("deleteTitle"), () => {
      void (async () => {
        try {
          await api.delete(`/api/projects/${encodeURIComponent(id)}/milestones/${encodeURIComponent(r.id)}`);
          toast(t("deletedToast"));
          load();
        } catch (e) { toast(e instanceof Error ? t("deleteFailedPrefix", { p1: e.message }) : tc("errors.deleteFailed")); }
      })();
    }, { body: t("deleteBody", { p1: r.title }), confirmLabel: tc("delete") });
  }

  async function importBaseline() {
    if (importing) return;
    setImporting(true);
    try {
      const r = await api.post<{ added: number; skipped: number }>(`/api/projects/${encodeURIComponent(id)}/milestones/import-baseline`, {});
      toast(t("importToast", { p1: r.data.added, p2: r.data.skipped > 0 ? t("importSkippedSuffix", { p1: r.data.skipped }) : "" }));
      load();
    } catch (e) {
      toast(e instanceof Error ? t("importFailedPrefix", { p1: e.message }) : t("importFailed"));
    } finally {
      setImporting(false);
    }
  }

  const grouped = new Map<MilestoneStatus, MilestoneView[]>();
  for (const s of STATUS_ORDER) grouped.set(s, []);
  for (const r of rows ?? []) grouped.get(r.status)?.push(r);

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>{t("h1")}</h1>
      <p className="objective">{t("objective")}</p>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="milestone-track-hint">
        {track === "greenfield"
          ? t("trackGreenfield")
          : track === "brownfield"
            ? t("trackBrownfield")
            : t("trackUndecided")}
        {" "}{t("commonNote")}
      </p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {summary && summary.total > 0 && (
        <p className="text-[length:var(--fs-caption)] mb-2" data-testid="milestone-summary">
          <span className="status-chip status-gray">{t("chipTotal", { p1: summary.total })}</span>{" "}
          <span className="status-chip status-red">{t("chipOverdue", { p1: summary.overdue })}</span>{" "}
          <span className="status-chip status-amber">{t("chipDueSoon", { p1: summary.due_soon })}</span>{" "}
          <span className="status-chip status-green">{t("chipDone", { p1: summary.done })}</span>
        </p>
      )}

      {rows === null ? <PageState state="loading" /> : rows.length === 0 ? (
        <PageState state="empty" emptyText={t("emptyMilestones")} />
      ) : (
        STATUS_ORDER.filter((s) => (grouped.get(s) ?? []).length > 0).map((s) => (
          <section key={s} className="market-section" aria-label={statusText(s)}>
            <h2 className=" mb-2">
              <span className={`status-chip ${STATUS_META[s].cls}`}>{statusText(s)}</span>
              {" "}<span className="note">{t("countSuffix", { p1: (grouped.get(s) ?? []).length })}</span>
            </h2>
            <div className="table-scroll" role="region" aria-label={t("tableScrollRegion")} tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-56" aria-label={t("tableAria", { p1: statusText(s) })}>
                <caption className="sr-only">{t("tableCaption")}</caption>
                <ColGroup widths={MILESTONE_COL_PCT} />
                <thead><tr><th>{t("colTitle")}</th><th>{t("colCategory")}</th><th className="col-num">{t("colDue")}</th><th className="col-num">{t("colDday")}</th><th>{t("colOwner")}</th><th>{t("colDone")}</th><th>{t("colManage")}</th></tr></thead>
                <tbody>{(grouped.get(s) ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.title}{r.notes && <span className="note block" title={r.notes}>{r.notes.slice(0, 60)}</span>}</td>
                    <td>{CATEGORY_KEY[r.category] ? t(CATEGORY_KEY[r.category]) : r.category}
                      {r.source === "execution_baseline" && <span className="status-chip status-gray ml-1" title={t("baselineChipTitle")}>{t("baselineChip")}</span>}
                    </td>
                    <td className="col-num tabular-nums">{r.due_date}</td>
                    <td className="col-num tabular-nums">{r.days_to_due != null && r.status !== "done" ? `${r.days_to_due >= 0 ? "D-" : "D+"}${Math.abs(r.days_to_due)}` : "—"}</td>
                    <td>{r.owner ?? "—"}</td>
                    <td>{canAct
                      ? <input type="checkbox" aria-label={t("doneAria", { p1: r.title })} checked={r.done_at != null} onChange={() => void toggleDone(r)} />
                      : r.done_at ? t("statusDone") : "—"}</td>
                    <td>{canAct && <button type="button" className="btn-danger btn-sm" onClick={() => remove(r)}>{tc("delete")}</button>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        ))
      )}

      {canAct && (
        <section className="market-section mt-3" aria-label={t("registerSection")}>
          <h2 className=" mb-2">{t("registerHeading")}</h2>
          <form className="sizing-new-form" onSubmit={create}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[14rem]"><span className="block mb-1">{t("lblTitle")}</span>
                <input className="sizing-new-input w-full" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("phTitle")} required /></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">{t("colCategory")}</span>
                <select className="sizing-new-input sizing-new-input-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="custom">{t("catCustom")}</option><option value="permit">{t("catPermit")}</option><option value="certification">{t("catCertification")}</option><option value="capex">{t("catCapex")}</option><option value="contract">{t("catContract")}</option>
                </select></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">{t("lblDue")}</span>
                <input type="date" className="sizing-new-input sizing-new-input-sm" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">{t("lblOwner")}</span>
                <input className="sizing-new-input sizing-new-input-sm" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></label>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? t("registering") : t("registerCta")}</button>
            </div>
            <label className="text-[length:var(--fs-caption)] block mt-2"><span className="block mb-1">{t("lblMemo")}</span>
              <input className="sizing-new-input w-full" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          </form>
          <div className="flex items-center gap-2 mt-2">
            <button type="button" className="btn-ghost btn-sm" disabled={suggestBusy}
              title={t("suggestTitle")}
              onClick={() => void suggestMilestones()}>{suggestBusy ? t("suggestBusy") : t("suggestCta")}</button>
          </div>
          {suggestions && suggestions.length > 0 && (
            <ul className="sizing-note-list mt-1" aria-label={t("suggestionsAria")} data-testid="milestone-suggestions">
              {suggestions.map((sg) => (
                <li key={sg.title}>
                  <strong>{sg.title}</strong>
                  <span className="note ml-1">{t("suggestMeta", { p1: CATEGORY_KEY[sg.category] ? t(CATEGORY_KEY[sg.category]) : sg.category, p2: sg.due_date, p3: sg.reason })}</span>
                  {canAct && <button type="button" className="btn-ghost btn-sm ml-2" onClick={() => void addSuggestion(sg)}>{t("addCta")}</button>}
                </li>
              ))}
            </ul>
          )}
          {baselineReady && (
            <div className="flex items-center gap-2 mt-2">
              <button type="button" className="btn-ghost btn-sm" disabled={importing}
                title={t("importTitle")}
                onClick={() => void importBaseline()}>
                {importing ? t("importBusy") : t("importCta")}
              </button>
              <Link href={`/projects/${id}/ic-review`} className="note underline">{t("baselineLink")}</Link>
            </div>
          )}
        </section>
      )}
      {confirmDialog}
    </main>
  );
}

export default function MilestonesPage() {
  return <Suspense fallback={null}><MilestonesView /></Suspense>;
}
