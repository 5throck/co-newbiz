"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { StageTabs } from "../../../../components/StageTabs.tsx";
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
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
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
      toast(`${form.kind === "permit" ? "허가" : "인증"}이 등록되었습니다`);
      setForm({ ...form, name: "", agency: "", statutory_days: "" });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "등록 실패"); }
    finally { setBusy(false); }
  }

  async function setStatus(kind: "permit" | "certification", rowId: string, status: string) {
    try {
      await api.put(`/api/projects/${encodeURIComponent(id)}/permits`, { kind, id: rowId, status });
      toast("상태를 변경했습니다.");
      load();
    } catch (e) { toast(e instanceof Error ? `변경 실패: ${e.message}` : "변경 실패"); }
  }

  function remove(kind: "permit" | "certification", rowId: string, name: string) {
    confirm(`${kind === "permit" ? "허가" : "인증"} 삭제`, () => {
      void (async () => {
        try {
          await api.delete(`/api/projects/${encodeURIComponent(id)}/permits?kind=${kind}&id=${encodeURIComponent(rowId)}`);
          toast("삭제했습니다 — 감사 로그에 남습니다.");
          load();
        } catch (e) { toast(e instanceof Error ? `삭제 실패: ${e.message}` : "삭제 실패"); }
      })();
    }, { body: `"${name}" 항목과 그 중요 경로(critical path) 연결을 삭제합니다. 삭제는 감사 로그에 기록됩니다.`, confirmLabel: "삭제" });
  }

  const statusChip = (s: string) => (
    <span className={`status-chip ${s === "granted" ? "status-green" : s === "denied" || s === "withdrawn" ? "status-red" : "status-amber"}`}>{s}</span>
  );
  const statusEditor = (kind: "permit" | "certification", r: { id: string; status: string }) => (
    canAct
      ? <select aria-label={`${r.id} 상태 변경`} className="sizing-new-input sizing-new-input-sm" value={STATUS_OPTIONS.includes(r.status) ? r.status : ""} onChange={(e) => { if (e.target.value) void setStatus(kind, r.id, e.target.value); }}>
          {!STATUS_OPTIONS.includes(r.status) && <option value="">{r.status}</option>}
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      : statusChip(r.status)
  );
  const removeButton = (kind: "permit" | "certification", r: { id: string; name: string }) => (
    canAct
      ? <button type="button" className="btn-danger btn-sm" onClick={() => remove(kind, r.id, r.name)}>삭제</button>
      : null
  );

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>인허가·인증 추적</h1>
      <p className="objective">허가와 인증을 별도로 추적합니다 — 만료·갱신은 감시 규칙으로 태스크가 생성됩니다. <Link href={`/projects/${encodeURIComponent(id)}/sites`} className="underline">부지·시설 평가(주소 기반 법규 사전검토)와 함께 검토 →</Link></p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <div className="grid2e">
        <section className="market-section" aria-label="허가">
          <h2 className="text-[0.9rem] mb-2">허가</h2>
          {data === null ? <PageState state="loading" /> : data.permits.length === 0 ? (
            <PageState state="empty" emptyText="등록된 허가가 없습니다." />
          ) : (
            <table className="data-table" aria-label="허가">
              <thead><tr><th>허가</th><th>기관</th><th className="col-num">법정기간(일)</th><th>상태</th><th>관리</th></tr></thead>
              <tbody>{data.permits.map((r) => (
                <tr key={r.id}><td className="font-semibold">{r.name}</td><td>{r.agency ?? "—"}</td><td className="col-num tabular-nums">{r.statutory_days ?? "—"}</td><td>{statusEditor("permit", r)}</td><td>{removeButton("permit", r)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </section>
        <section className="market-section" aria-label="인증">
          <h2 className="text-[0.9rem] mb-2">인증</h2>
          {data === null ? <PageState state="loading" /> : data.certifications.length === 0 ? (
            <PageState state="empty" emptyText="등록된 인증이 없습니다." />
          ) : (
            <table className="data-table" aria-label="인증">
              <thead><tr><th>인증</th><th>기관</th><th>상태</th><th>CoC 이전</th><th>관리</th></tr></thead>
              <tbody>{data.certifications.map((r) => (
                <tr key={r.id}><td className="font-semibold">{r.name}</td><td>{r.agency ?? "—"}</td><td>{statusEditor("certification", r)}</td><td>{r.transferable_on_coc ?? "—"}</td><td>{removeButton("certification", r)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </section>
      </div>
      {canAct && (
        <section className="market-section" aria-label="등록">
          <h2 className="text-[0.9rem] mb-2">등록</h2>
          <form className="sizing-new-form" onSubmit={create}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">구분 *</span>
                <select className="sizing-new-input sizing-new-input-sm" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  <option value="permit">허가</option><option value="certification">인증</option>
                </select></label>
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[12rem]"><span className="block mb-1">이름 *</span>
                <input className="sizing-new-input w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">기관</span>
                <input className="sizing-new-input sizing-new-input-sm" value={form.agency} onChange={(e) => setForm({ ...form, agency: e.target.value })} /></label>
              <label className="text-[length:var(--fs-caption)] w-[7rem]"><span className="block mb-1">법정기간(일)</span>
                <input type="number" className="sizing-new-input sizing-new-input-sm" value={form.statutory_days} onChange={(e) => setForm({ ...form, statutory_days: e.target.value })} /></label>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? "등록 중..." : "등록"}</button>
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
