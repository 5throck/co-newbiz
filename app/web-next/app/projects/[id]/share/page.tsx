"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { api } from "../../../../lib/api.ts";
import { PageState, useToast } from "../../../../components/ui.tsx";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 외부 안전 공유 (ADR-0123 #4) — 만료·워터마크·열람 기록이 있는 스냅샷 링크
// 관리. UI는 security-engineer 설계 승인 후 확정된다 (현재 계약 계층 위 UI).
interface Link { id: string; title: string; recipient: string; expires_at: string; revoked_at: string | null; access_count: number }

function ShareView() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [rows, setRows] = useState<Link[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", recipient: "", expires_in_days: "7", payload: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<{ links: Link[] }>(`/api/projects/${encodeURIComponent(id)}/share-links`)
      .then((r) => setRows(r.data.links))
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/share-links`, {
        title: form.title.trim(), recipient: form.recipient.trim(),
        expires_in_days: Number(form.expires_in_days) || 7,
        payload: { note: form.payload.trim() || "요약 스냅샷" },
      });
      toast("공유 링크가 생성되었습니다 (열람 시 기록됩니다)");
      setForm({ ...form, title: "", recipient: "", payload: "" });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "생성 실패"); }
    finally { setBusy(false); }
  }

  async function revoke(linkId: string) {
    try {
      await api.delete(`/api/projects/${encodeURIComponent(id)}/share-links?link_id=${linkId}`);
      toast("링크가 즉시 만료되었습니다");
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "철회 실패"); }
  }

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>외부 안전 공유 <span className="status-chip status-amber">security 설계 승인 전제</span></h1>
      <p className="objective">외부 자문사에게 스냅샷을 만료·워터마크·열람 기록이 있는 링크로만 공유합니다 — 원본 데이터는 노출되지 않습니다.</p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <section className="market-section" aria-label="공유 링크">
        {rows === null ? <PageState state="loading" /> : rows.length === 0 ? (
          <PageState state="empty" emptyText="활성·만료된 공유 링크가 없습니다." />
        ) : (
          <table className="data-table" aria-label="공유 링크">
            <caption className="sr-only">공유 링크</caption>
            <thead><tr><th>자료</th><th>수신자</th><th>만료</th><th className="col-num">열람</th><th>상태</th><th></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td className="font-semibold">{r.title}</td>
                <td>{r.recipient}</td>
                <td className="tabular-nums text-[0.78rem]">{r.expires_at.slice(0, 10)}</td>
                <td className="col-num tabular-nums">{r.access_count}회</td>
                <td>{r.revoked_at ? <span className="status-chip status-gray">만료(철회)</span> : new Date(r.expires_at) > new Date() ? <span className="status-chip status-green">활성</span> : <span className="status-chip status-gray">만료</span>}</td>
                <td>{canAct && !r.revoked_at && <button type="button" className="btn-danger btn-sm" onClick={() => revoke(r.id)}>즉시 만료</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
      {canAct && (
        <section className="market-section" aria-label="공유 링크 생성">
          <h2 className="text-[0.9rem] mb-2">공유 링크 생성</h2>
          <form className="sizing-new-form" onSubmit={create}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[0.78rem] flex-1 min-w-[12rem]"><span className="block mb-1">자료 제목 *</span>
                <input className="sizing-new-input w-full" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
              <label className="text-[0.78rem] flex-1 min-w-[10rem]"><span className="block mb-1">수신자 *</span>
                <input className="sizing-new-input w-full" value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} required /></label>
              <label className="text-[0.78rem] w-[7rem]"><span className="block mb-1">만료 (일, ≤30)</span>
                <input type="number" min={1} max={30} className="sizing-new-input sizing-new-input-sm" value={form.expires_in_days} onChange={(e) => setForm({ ...form, expires_in_days: e.target.value })} /></label>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? "생성 중..." : "링크 생성"}</button>
            </div>
            <label className="text-[0.78rem] block mt-2"><span className="block mb-1">스냅샷 요약 (원본 대신 전달됩니다)</span>
              <input className="sizing-new-input w-full" value={form.payload} onChange={(e) => setForm({ ...form, payload: e.target.value })} /></label>
          </form>
        </section>
      )}
    </main>
  );
}

export default function SharePage() {
  return <Suspense fallback={null}><ShareView /></Suspense>;
}
