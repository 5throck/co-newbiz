"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { api } from "../../../../lib/api.ts";
import { PageState, useToast } from "../../../../components/ui.tsx";
import { useConfirm } from "../../../../components/crud.tsx";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";
import { DUE_SOON_DAYS, type MilestoneCategory, type MilestoneStatus, type MilestoneView } from "../../../../lib/milestones.ts";

// 프로젝트 마일스톤 (2026-10-21, migration 0167) — S12 일정관리의 사람 전용
// 원장. 모든 단계 바의 공통 링크로 도달한다(프로젝트 공통). 상태는 기한·완료일에서
// 계산값이며 참고 표시다 — 지연 마일스톤이 무엇을 막지는 않는다 (S12 게이트 없음).
// greenfield 실행 기준선의 인허가/인증 마일스톤은 "기준선에서 가져오기"로 일괄 등록.

const CATEGORY_LABEL: Record<MilestoneCategory, string> = {
  permit: "인허가", certification: "인증", capex: "설비투자", contract: "계약", custom: "일반",
};
const STATUS_META: Record<MilestoneStatus, { label: string; cls: string }> = {
  done: { label: "완료", cls: "status-green" },
  overdue: { label: "기한 지연", cls: "status-red" },
  due_soon: { label: `기한 임박(${DUE_SOON_DAYS}일)`, cls: "status-amber" },
  planned: { label: "예정", cls: "status-gray" },
};
const STATUS_ORDER: MilestoneStatus[] = ["overdue", "due_soon", "planned", "done"];

function MilestonesView() {
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

  const load = useCallback(() => {
    api.get<{ milestones: MilestoneView[]; summary: typeof summary }>(`/api/projects/${encodeURIComponent(id)}/milestones`)
      .then((r) => { setRows(r.data.milestones); setSummary(r.data.summary); })
      .catch((e) => setError(e instanceof Error ? e.message : "마일스톤을 불러오지 못했습니다."));
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
      toast("마일스톤을 등록했습니다.");
      setForm({ ...form, title: "", due_date: "", owner: "", notes: "" });
      load();
    } catch (err) { toast(err instanceof Error ? `등록 실패: ${err.message}` : "등록 실패"); }
    finally { setBusy(false); }
  }

  async function toggleDone(r: MilestoneView) {
    try {
      await api.put(`/api/projects/${encodeURIComponent(id)}/milestones/${encodeURIComponent(r.id)}`, { done: !r.done_at });
      load();
    } catch (e) { toast(e instanceof Error ? `갱신 실패: ${e.message}` : "갱신 실패"); }
  }

  function remove(r: MilestoneView) {
    confirm("마일스톤 삭제", () => {
      void (async () => {
        try {
          await api.delete(`/api/projects/${encodeURIComponent(id)}/milestones/${encodeURIComponent(r.id)}`);
          toast("삭제했습니다 — 감사 로그에 남습니다.");
          load();
        } catch (e) { toast(e instanceof Error ? `삭제 실패: ${e.message}` : "삭제 실패"); }
      })();
    }, { body: `"${r.title}" 마일스톤을 삭제합니다. 삭제는 감사 로그에 기록됩니다.`, confirmLabel: "삭제" });
  }

  async function importBaseline() {
    if (importing) return;
    setImporting(true);
    try {
      const r = await api.post<{ added: number; skipped: number }>(`/api/projects/${encodeURIComponent(id)}/milestones/import-baseline`, {});
      toast(`실행 기준선에서 ${r.data.added}건을 가져왔습니다${r.data.skipped > 0 ? ` (중복 스킵 ${r.data.skipped}건)` : ""}.`);
      load();
    } catch (e) {
      toast(e instanceof Error ? `가져오기 실패: ${e.message}` : "가져오기 실패");
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
      <h1>프로젝트 마일스톤</h1>
      <p className="objective">주요 마일스톤의 기한과 완료를 관리합니다 — 프로젝트 공통 화면으로 모든 단계에서 열 수 있으며, 기준선 마일스톤(인허가·인증)도 여기에 모입니다. 지연 표시는 참고이며 게이트가 아닙니다.</p>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="milestone-track-hint">
        {track === "greenfield"
          ? "Green Field — 연구개발(R&D) 기반 사업화 관점: 기술 검증(TRL)·인허가·초기 판매·설비투자 트랜치 마일스톤을 권장합니다."
          : track === "brownfield"
            ? "Brown Field — M&A 실사·PMI 관점: 단계별 실사 종결·시너지 인증·핵심인재 확보·통합 마일스톤을 권장합니다."
            : "트랙이 확정되면 Green Field(연구개발 기반 사업화) 또는 Brown Field(M&A 실사·PMI) 관점의 권장 마일스톤이 표시됩니다."}
        {" "}이 화면은 프로젝트 공통 — S8~S12 어느 단계에서도 관리할 수 있습니다 (사이드바 공통 링크·배지).
      </p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {summary && summary.total > 0 && (
        <p className="text-[length:var(--fs-caption)] mb-2" data-testid="milestone-summary">
          <span className="status-chip status-gray">전체 {summary.total}</span>{" "}
          <span className="status-chip status-red">지연 {summary.overdue}</span>{" "}
          <span className="status-chip status-amber">임박 {summary.due_soon}</span>{" "}
          <span className="status-chip status-green">완료 {summary.done}</span>
        </p>
      )}

      {rows === null ? <PageState state="loading" /> : rows.length === 0 ? (
        <PageState state="empty" emptyText="등록된 마일스톤이 없습니다 — 아래에서 등록하거나 실행 기준선에서 가져오세요." />
      ) : (
        STATUS_ORDER.filter((s) => (grouped.get(s) ?? []).length > 0).map((s) => (
          <section key={s} className="market-section" aria-label={STATUS_META[s].label}>
            <h2 className="text-[0.9rem] mb-2">
              <span className={`status-chip ${STATUS_META[s].cls}`}>{STATUS_META[s].label}</span>
              {" "}<span className="note">{(grouped.get(s) ?? []).length}건</span>
            </h2>
            <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
              <table className="data-table" aria-label={`마일스톤 — ${STATUS_META[s].label}`}>
                <caption className="sr-only">마일스톤</caption>
                <thead><tr><th>제목</th><th>분류</th><th className="col-num">기한</th><th className="col-num">D-day</th><th>담당</th><th>완료</th><th>관리</th></tr></thead>
                <tbody>{(grouped.get(s) ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.title}{r.notes && <span className="note block" title={r.notes}>{r.notes.slice(0, 60)}</span>}</td>
                    <td>{CATEGORY_LABEL[r.category] ?? r.category}
                      {r.source === "execution_baseline" && <span className="status-chip status-gray ml-1" title="greenfield 실행 기준선에서 가져온 마일스톤">기준선</span>}
                    </td>
                    <td className="col-num tabular-nums">{r.due_date}</td>
                    <td className="col-num tabular-nums">{r.days_to_due != null && r.status !== "done" ? `${r.days_to_due >= 0 ? "D-" : "D+"}${Math.abs(r.days_to_due)}` : "—"}</td>
                    <td>{r.owner ?? "—"}</td>
                    <td>{canAct
                      ? <input type="checkbox" aria-label={`${r.title} 완료`} checked={r.done_at != null} onChange={() => void toggleDone(r)} />
                      : r.done_at ? "완료" : "—"}</td>
                    <td>{canAct && <button type="button" className="btn-danger btn-sm" onClick={() => remove(r)}>삭제</button>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        ))
      )}

      {canAct && (
        <section className="market-section mt-3" aria-label="마일스톤 등록">
          <h2 className="text-[0.9rem] mb-2">마일스톤 등록</h2>
          <form className="sizing-new-form" onSubmit={create}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[14rem]"><span className="block mb-1">제목 *</span>
                <input className="sizing-new-input w-full" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: 상위 3개 고객 계약 갱신 완료" required /></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">분류</span>
                <select className="sizing-new-input sizing-new-input-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="custom">일반</option><option value="permit">인허가</option><option value="certification">인증</option><option value="capex">설비투자</option><option value="contract">계약</option>
                </select></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">기한 *</span>
                <input type="date" className="sizing-new-input sizing-new-input-sm" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">담당</span>
                <input className="sizing-new-input sizing-new-input-sm" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></label>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? "등록 중..." : "등록"}</button>
            </div>
            <label className="text-[length:var(--fs-caption)] block mt-2"><span className="block mb-1">메모</span>
              <input className="sizing-new-input w-full" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          </form>
          {baselineReady && (
            <div className="flex items-center gap-2 mt-2">
              <button type="button" className="btn-ghost btn-sm" disabled={importing}
                title="확정된 실행 기준선의 인허가·인증 마일스톤을 이 원장으로 가져옵니다 — 같은 제목은 건너뜁니다"
                onClick={() => void importBaseline()}>
                {importing ? "가져오는 중..." : "⚙ 실행 기준선에서 마일스톤 가져오기"}
              </button>
              <Link href={`/projects/${id}/ic-review`} className="note underline">실행 기준선은 S11 화면에서 확정합니다 →</Link>
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
