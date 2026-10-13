"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { api } from "../../../../lib/api.ts";
import { fmtNpvInteger } from "../../../../lib/npv-format.ts";
import { PageState, useToast } from "../../../../components/ui.tsx";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 인센티브·클로백 (incentive-agent) — Wave 0 REST B3. 수혜 예정/확정 인센티브와
// 클로백 조건을 관리하고 클로백 추정액은 S10 자금조달과 대조된다.
interface Row { id: string; program_name: string | null; grantor: string | null; npv_value: number | null; clawback_rule: string | null; direction: string }

function IncentivesView() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ program_name: "", grantor: "", npv_value: "", clawback_rule: "", direction: "prospective" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<{ incentives: Row[] }>(`/api/projects/${encodeURIComponent(id)}/incentives`)
      .then((r) => setRows(r.data.incentives))
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.program_name.trim() || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/incentives`, {
        program_name: form.program_name.trim(), grantor: form.grantor.trim() || undefined,
        npv_value: form.npv_value ? Number(form.npv_value) : undefined,
        clawback_rule: form.clawback_rule.trim() || undefined, direction: form.direction,
      });
      toast("인센티브가 등록되었습니다");
      setForm({ program_name: "", grantor: "", npv_value: "", clawback_rule: "", direction: "prospective" });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "등록 실패"); }
    finally { setBusy(false); }
  }

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>인센티브·클로백</h1>
      <p className="objective">지역 인센티브 소싱과 이전 시 클로백 노출을 관리합니다 — 클로백 추정은 투자구조(uses)와 대조됩니다.</p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <section className="market-section" aria-label="인센티브 목록">
        {rows === null ? <PageState state="loading" /> : rows.length === 0 ? (
          <PageState state="empty" emptyText="등록된 인센티브가 없습니다." />
        ) : (
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table" aria-label="인센티브">
              <caption className="sr-only">인센티브</caption>
              <thead><tr><th>프로그램</th><th>부여기관</th><th>방향</th><th className="col-num">NPV</th><th>클로백 조건</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.program_name ?? "—"}</td>
                    <td>{r.grantor ?? "—"}</td>
                    <td><span className={`status-chip ${r.direction === "granted" ? "status-green" : "status-amber"}`}>{r.direction === "granted" ? "확정" : "수혜 예정"}</span></td>
                    <td className="col-num tabular-nums">{r.npv_value != null ? `${fmtNpvInteger(r.npv_value)}억` : "—"}</td>
                    <td className="text-[length:var(--fs-caption)]">{r.clawback_rule ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {canAct && (
        <section className="market-section" aria-label="인센티브 등록">
          <h2 className="text-[0.9rem] mb-2">인센티브 등록</h2>
          <form className="sizing-new-form" onSubmit={create}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[14rem]"><span className="block mb-1">프로그램명 *</span>
                <input className="sizing-new-input w-full" value={form.program_name} onChange={(e) => setForm({ ...form, program_name: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">부여기관</span>
                <input className="sizing-new-input sizing-new-input-sm" value={form.grantor} onChange={(e) => setForm({ ...form, grantor: e.target.value })} /></label>
              <label className="text-[length:var(--fs-caption)] w-[7rem]"><span className="block mb-1">NPV (억원)</span>
                <input type="number" className="sizing-new-input sizing-new-input-sm" value={form.npv_value} onChange={(e) => setForm({ ...form, npv_value: e.target.value })} /></label>
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[12rem]"><span className="block mb-1">클로백 조건</span>
                <input className="sizing-new-input w-full" value={form.clawback_rule} onChange={(e) => setForm({ ...form, clawback_rule: e.target.value })} placeholder="예: 5년 내 이전 시 전액 반환" /></label>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? "등록 중..." : "등록"}</button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}

export default function IncentivesPage() {
  return <Suspense fallback={null}><IncentivesView /></Suspense>;
}
