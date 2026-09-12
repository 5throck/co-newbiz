"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectSubNav } from "../../../../components/ProjectSubNav.tsx";
import { api } from "../../../../lib/api.ts";
import { PageState, useToast } from "../../../../components/ui.tsx";

// 부채·커버넌트 (financing/valuation) — Wave 0 REST B6. 차입 상품 목록 관리;
// 커버넌트 시나리오 테스트는 Wave 3 계산 뷰.
interface Instrument { id: string; lender: string | null; principal: number; rate_type: string; rate: number; maturity: string | null; covenant_json: string | null; security: string | null; seniority: string | null }

function DebtView() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [rows, setRows] = useState<Instrument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ lender: "", principal: "", rate: "", rate_type: "fixed", maturity: "", covenant_json: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<{ instruments: Instrument[] }>(`/api/projects/${encodeURIComponent(id)}/debt`)
      .then((r) => setRows(r.data.instruments))
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !form.principal) return;
    setBusy(true);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/debt`, {
        lender: form.lender.trim() || undefined, principal: Number(form.principal),
        rate: form.rate ? Number(form.rate) : 0, rate_type: form.rate_type,
        maturity: form.maturity.trim() || undefined, covenant_json: form.covenant_json.trim() || undefined,
      });
      toast("차입이 등록되었습니다");
      setForm({ ...form, lender: "", principal: "", rate: "", maturity: "", covenant_json: "" });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "등록 실패"); }
    finally { setBusy(false); }
  }

  return (
    <main>
      <ProjectSubNav projectId={id} />
      <h1>부채·커버넌트</h1>
      <p className="objective">차입 상품과 커버넌트 조건을 관리합니다 — 커버넌트 여력은 자금조달(S10)과 대조됩니다.</p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <section className="market-section" aria-label="차입 목록">
        {rows === null ? <PageState state="loading" /> : rows.length === 0 ? (
          <PageState state="empty" emptyText="등록된 차입이 없습니다." />
        ) : (
          <div className="table-scroll">
            <table className="data-table" aria-label="차입">
              <caption className="sr-only">차입</caption>
              <thead><tr><th>대출기관</th><th className="col-num">원금</th><th>금리</th><th>만기</th><th>커버넌트</th><th>담보·선위</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.lender ?? "—"}</td>
                  <td className="col-num tabular-nums">{r.principal}</td>
                  <td className="tabular-nums">{r.rate_type === "fixed" ? "고정" : "변동"} {r.rate}%</td>
                  <td className="tabular-nums">{r.maturity ?? "—"}</td>
                  <td className="text-[0.72rem]">{r.covenant_json ?? "—"}</td>
                  <td className="text-[0.72rem]">{[r.security, r.seniority].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      <section className="market-section" aria-label="차입 등록">
        <h2 className="text-[0.9rem] mb-2">차입 등록</h2>
        <form className="sizing-new-form" onSubmit={create}>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[0.78rem]"><span className="block mb-1">대출기관</span>
              <input className="sizing-new-input sizing-new-input-sm" value={form.lender} onChange={(e) => setForm({ ...form, lender: e.target.value })} /></label>
            <label className="text-[0.78rem] w-[8rem]"><span className="block mb-1">원금 *</span>
              <input type="number" className="sizing-new-input sizing-new-input-sm" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} required /></label>
            <label className="text-[0.78rem]"><span className="block mb-1">금리 종류</span>
              <select className="sizing-new-input sizing-new-input-sm" value={form.rate_type} onChange={(e) => setForm({ ...form, rate_type: e.target.value })}><option value="fixed">고정</option><option value="floating">변동</option></select></label>
            <label className="text-[0.78rem] w-[6rem]"><span className="block mb-1">금리 (%)</span>
              <input type="number" step="0.01" className="sizing-new-input sizing-new-input-sm" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></label>
            <label className="text-[0.78rem]"><span className="block mb-1">만기</span>
              <input className="sizing-new-input sizing-new-input-sm" value={form.maturity} onChange={(e) => setForm({ ...form, maturity: e.target.value })} placeholder="2031-06" /></label>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? "등록 중..." : "등록"}</button>
          </div>
          <label className="text-[0.78rem] block mt-2"><span className="block mb-1">커버넌트 (JSON 또는 요약)</span>
            <input className="sizing-new-input w-full" value={form.covenant_json} onChange={(e) => setForm({ ...form, covenant_json: e.target.value })} placeholder="DSCR >= 1.3 · NetLev <= 3.5x" /></label>
        </form>
      </section>
    </main>
  );
}

export default function DebtPage() {
  return <Suspense fallback={null}><DebtView /></Suspense>;
}
