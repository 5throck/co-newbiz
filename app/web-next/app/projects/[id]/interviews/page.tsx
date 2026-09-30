"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectSubNav } from "../../../../components/ProjectSubNav.tsx";
import { api } from "../../../../lib/api.ts";
import { PageState, useToast } from "../../../../components/ui.tsx";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 전문가 인터뷰·채널 체크 (commercial-dd-agent) — Wave 0 REST B7.
// 증적 참조가 필수이고 주제별 합의/엇갈림 롤업을 제공한다.
interface Row { id: string; interviewee: string; topic: string; response_summary: string; disagreement: string | null; follow_up: string | null; evidence_ref: string }

function InterviewsView() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ interviewee: "", topic: "", response_summary: "", disagreement: "", follow_up: "", evidence_ref: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<{ interviews: Row[] }>(`/api/projects/${encodeURIComponent(id)}/interviews`)
      .then((r) => setRows(r.data.interviews))
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/interviews`, {
        interviewee: form.interviewee.trim(), topic: form.topic.trim(),
        response_summary: form.response_summary.trim(), evidence_ref: form.evidence_ref.trim(),
        disagreement: form.disagreement.trim() || undefined, follow_up: form.follow_up.trim() || undefined,
      });
      toast("인터뷰가 기록되었습니다");
      setForm({ interviewee: "", topic: "", response_summary: "", disagreement: "", follow_up: "", evidence_ref: "" });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "등록 실패"); }
    finally { setBusy(false); }
  }

  return (
    <main>
      <ProjectSubNav projectId={id} />
      <h1>전문가 인터뷰·채널 체크</h1>
      <p className="objective">CDD 증적(인터뷰·채널 확인)을 기록합니다 — 증적 참조가 필수이며 주제별 합의·엇갈림이 롤업됩니다.</p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <section className="market-section" aria-label="인터뷰 기록">
        {rows === null ? <PageState state="loading" /> : rows.length === 0 ? (
          <PageState state="empty" emptyText="기록된 인터뷰가 없습니다." />
        ) : (
          <div className="table-scroll">
            <table className="data-table" aria-label="인터뷰">
              <caption className="sr-only">인터뷰</caption>
              <thead><tr><th>대상</th><th>주제</th><th>응답 요지</th><th>엇갈림</th><th>후속 확인</th><th>증적</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.interviewee}</td>
                  <td>{r.topic}</td>
                  <td className="text-[0.78rem]">{r.response_summary}</td>
                  <td className="text-[0.75rem]">{r.disagreement ?? "—"}</td>
                  <td className="text-[0.75rem]">{r.follow_up ?? "—"}</td>
                  <td className="text-[0.72rem]"><code className="dd-item-id">{r.evidence_ref}</code></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      {canAct && (
        <section className="market-section" aria-label="인터뷰 기록">
          <h2 className="text-[0.9rem] mb-2">인터뷰 기록</h2>
          <form className="sizing-new-form" onSubmit={create}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[0.78rem] flex-1 min-w-[10rem]"><span className="block mb-1">대상 *</span>
                <input className="sizing-new-input w-full" value={form.interviewee} onChange={(e) => setForm({ ...form, interviewee: e.target.value })} required /></label>
              <label className="text-[0.78rem] flex-1 min-w-[10rem]"><span className="block mb-1">주제 *</span>
                <input className="sizing-new-input w-full" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} required /></label>
              <label className="text-[0.78rem] flex-1 min-w-[14rem]"><span className="block mb-1">응답 요지 *</span>
                <input className="sizing-new-input w-full" value={form.response_summary} onChange={(e) => setForm({ ...form, response_summary: e.target.value })} required /></label>
              <label className="text-[0.78rem] flex-1 min-w-[10rem]"><span className="block mb-1">증적 *</span>
                <input className="sizing-new-input w-full" value={form.evidence_ref} onChange={(e) => setForm({ ...form, evidence_ref: e.target.value })} required placeholder="interview-log#1" /></label>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? "기록 중..." : "기록"}</button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}

export default function InterviewsPage() {
  return <Suspense fallback={null}><InterviewsView /></Suspense>;
}
