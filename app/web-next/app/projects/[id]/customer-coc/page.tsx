"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { api } from "../../../../lib/api.ts";
import { ColGroup, PageState, useToast } from "../../../../components/ui.tsx";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 계약 CoC 표 6열 — ColGroup 고정 % (R10 table-sizing).
const COC_COL_PCT = [18, 10, 16, 12, 12, 32] as const;

// 고객 집중·CoC (customer-retention-agent) — Wave 0 REST B8.
// 매출 집중도 30% 이상은 자동 플래그, 추정 이탈은 가치 영향으로 반영된다.
interface Row { id: string; counterparty: string; direction: string; coc_clause_present: number; clause_summary: string | null; concentration_pct: number | null; est_exit_loss: number | null; flagged: number }

function CocView() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ counterparty: "", direction: "customer", coc: false, concentration_pct: "", est_exit_loss: "", clause_summary: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<{ contracts: Row[] }>(`/api/projects/${encodeURIComponent(id)}/customer-coc`)
      .then((r) => setRows(r.data.contracts))
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.counterparty.trim() || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/customer-coc`, {
        counterparty: form.counterparty.trim(), direction: form.direction,
        coc_clause_present: form.coc, clause_summary: form.clause_summary.trim() || undefined,
        concentration_pct: form.concentration_pct ? Number(form.concentration_pct) : undefined,
        est_exit_loss: form.est_exit_loss ? Number(form.est_exit_loss) : undefined,
      });
      toast("계약 CoC가 등록되었습니다");
      setForm({ counterparty: "", direction: "customer", coc: false, concentration_pct: "", est_exit_loss: "", clause_summary: "" });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "등록 실패"); }
    finally { setBusy(false); }
  }

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>고객 집중·지위 변동 (CoC, Change of Control)</h1>
      <p className="objective">
        고객·공급 계약의 <b>지위 변동(CoC, Change of Control)</b> 조항 — 인수로 지배구조가 바뀔 때 계약 해지·재협상·동의가 트리거되는 조항 — 과
        매출 집중도를 점검합니다. 집중도 30% 이상은 자동 플래그되며, 플래그 건은 조사내역(dd_finding)으로 등록해 게이트 판정 근거로 사용할 수 있습니다.
      </p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <section className="market-section" aria-label="계약 CoC">
        {rows === null ? <PageState state="loading" /> : rows.length === 0 ? (
          <PageState state="empty" emptyText="등록된 계약이 없습니다." />
        ) : (
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-48" aria-label="계약 CoC">
              <caption className="sr-only">계약 CoC</caption>
              <ColGroup widths={COC_COL_PCT} />
              <thead><tr><th>상대</th><th>방향</th><th>지위 변동(CoC) 조항</th><th className="col-num">집중도</th><th className="col-num">추정 이탈</th><th>조사내역 등록</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id} className={r.flagged ? "row-selected" : undefined}>
                  <td className="font-semibold">{r.counterparty}{r.flagged ? <span className="status-chip status-red" style={{ marginLeft: 6 }}>집중 30%+</span> : null}</td>
                  <td>{r.direction === "customer" ? "고객" : "공급"}</td>
                  <td>{r.coc_clause_present ? <span className="status-chip status-red">조항 있음</span> : <span className="status-chip status-green">없음</span>}</td>
                  <td className="col-num tabular-nums">{r.concentration_pct != null ? `${r.concentration_pct}%` : "—"}</td>
                  <td className="col-num tabular-nums">{r.est_exit_loss != null ? `${r.est_exit_loss}억` : "—"}</td>
                  <td>
                    {canAct && (r.flagged || r.coc_clause_present) && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        title="이 계약을 조사내역(dd_finding)으로 등록합니다 — 카테고리 고객·집중, 가치 영향 = 추정 이탈 손실"
                        onClick={() => {
                          void (async () => {
                            setBusy(true);
                            try {
                              await api.post(`/api/projects/${encodeURIComponent(id)}/dd/findings`, {
                                category: "고객·집중",
                                description: `[${r.direction === "customer" ? "고객" : "공급"}] ${r.counterparty} — 지위 변동(CoC) 조항 ${r.coc_clause_present ? "있음" : "없음"}${r.concentration_pct != null ? `, 집중도 ${r.concentration_pct}%` : ""}${r.clause_summary ? ` — ${r.clause_summary}` : ""}`,
                                value_impact: r.est_exit_loss != null ? Math.round(r.est_exit_loss * 100) : null,
                                evidence_ref: `customer-coc:${r.id}`,
                              });
                              toast("조사내역(dd_finding)으로 등록했습니다 — S9 조사내역 탭과 S10 입력에 반영됩니다.");
                            } catch (e) {
                              toast(e instanceof Error ? `등록 실패: ${e.message}` : "등록 실패");
                            } finally { setBusy(false); }
                          })();
                        }}
                      >→ 조사내역</button>
                    )}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      {canAct && (
        <section className="market-section" aria-label="계약 등록">
          <h2 className="text-[length:var(--fs-body)] mb-2">계약 CoC 등록</h2>
          <form className="sizing-new-form" onSubmit={create}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[12rem]"><span className="block mb-1">상대 *</span>
                <input className="sizing-new-input w-full" value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">방향</span>
                <select className="sizing-new-input sizing-new-input-sm" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}><option value="customer">고객</option><option value="supplier">공급</option></select></label>
              <label className="text-[length:var(--fs-caption)] flex items-center gap-1" style={{ marginBottom: 8 }}><input type="checkbox" checked={form.coc} onChange={(e) => setForm({ ...form, coc: e.target.checked })} /> CoC 조항 있음</label>
              <label className="text-[length:var(--fs-caption)] w-[7rem]"><span className="block mb-1">집중도 (%)</span>
                <input type="number" className="sizing-new-input sizing-new-input-sm" value={form.concentration_pct} onChange={(e) => setForm({ ...form, concentration_pct: e.target.value })} /></label>
              <label className="text-[length:var(--fs-caption)] w-[8rem]"><span className="block mb-1">추정 이탈 (억원)</span>
                <input type="number" className="sizing-new-input sizing-new-input-sm" value={form.est_exit_loss} onChange={(e) => setForm({ ...form, est_exit_loss: e.target.value })} /></label>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? "등록 중..." : "등록"}</button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}

export default function CocPage() {
  return <Suspense fallback={null}><CocView /></Suspense>;
}
