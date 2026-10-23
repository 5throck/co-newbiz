"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { api } from "../../../../lib/api.ts";
import { fmtNpvEok } from "../../../../lib/npv-format.ts";
import { ColGroup, PageState, useToast } from "../../../../components/ui.tsx";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";
import { useConfirm } from "../../../../components/crud.tsx";

// 인센티브 표 7열 — ColGroup 고정 % (R10 table-sizing).
const INCENTIVE_COL_PCT = [16, 12, 12, 10, 18, 22, 10] as const;

// 인센티브·클로백 (incentive-agent) — Wave 0 REST B3. 수혜 예정/확정 인센티브와
// 클로백 조건을 관리하고 클로백 추정액은 S10 자금조달과 대조된다.
// 2026-10-21: 적격 증빙(evidence_ref)이 있는 인센티브만 "→ 자금 조달" 버튼으로 S10
// sources 항목(evidence_kind=subsidy_grant)에 들어간다 — deal-structuring step 7
// "incentive proceeds enter the sources side only with evidenced eligibility".
interface Row { id: string; program_name: string | null; grantor: string | null; npv_value: number | null; clawback_rule: string | null; direction: string; evidence_ref: string | null }

function IncentivesView() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ program_name: "", grantor: "", npv_value: "", clawback_rule: "", direction: "prospective", evidence_ref: "" });
  const [busy, setBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  // 2026-10-21 lifecycle — 방향 전환(prospective↔granted)·삭제.
  async function setDirection(r: Row, direction: string) {
    try {
      await api.put(`/api/projects/${encodeURIComponent(id)}/incentives`, { id: r.id, direction });
      toast(`방향을 ${direction === "granted" ? "확정" : "수혜 예정"}으로 변경했습니다.`);
      load();
    } catch (e) { toast(e instanceof Error ? `변경 실패: ${e.message}` : "변경 실패"); }
  }
  function remove(r: Row) {
    confirm("인센티브 삭제", () => {
      void (async () => {
        try {
          await api.delete(`/api/projects/${encodeURIComponent(id)}/incentives?id=${encodeURIComponent(r.id)}`);
          toast("삭제했습니다 — 감사 로그에 남습니다.");
          load();
        } catch (e) { toast(e instanceof Error ? `삭제 실패: ${e.message}` : "삭제 실패"); }
      })();
    }, { body: `"${r.program_name ?? "프로그램"}" 인센티브를 삭제합니다. 삭제는 감사 로그에 기록됩니다.`, confirmLabel: "삭제" });
  }

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
        // 화면 단위 억원 → 저장 단위 백만 KRW(×100, ADR-0061) — 0168부터 저장 단위 고정.
        npv_value: form.npv_value ? Number(form.npv_value) * 100 : undefined,
        clawback_rule: form.clawback_rule.trim() || undefined, direction: form.direction,
        evidence_ref: form.evidence_ref.trim() || undefined,
      });
      toast("인센티브가 등록되었습니다");
      setForm({ program_name: "", grantor: "", npv_value: "", clawback_rule: "", direction: "prospective", evidence_ref: "" });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "등록 실패"); }
    finally { setBusy(false); }
  }

  // 인센티브 수입을 S10 자금조달 sources로 — 적격 증빙과 NPV가 있는 행만. 저장 단위는 이미 백만 KRW.
  async function pushToFinancing(r: Row) {
    if (!r.evidence_ref || r.npv_value == null) return;
    setPushBusy(r.id);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/deal-structure`, {
        action: "add_financing_entry", kind: "source",
        name: `인센티브 — ${r.program_name ?? "프로그램"}${r.grantor ? ` (${r.grantor})` : ""}`,
        amount_krw_m: r.npv_value,
        note: `${r.direction === "granted" ? "확정" : "수혜 예정"} 인센티브${r.clawback_rule ? ` · 클로백: ${r.clawback_rule}` : ""}`,
        evidence_kind: "subsidy_grant",
        evidence_ref: `incentive:${r.id} · ${r.evidence_ref}`,
      });
      toast("자금조달 sources 항목으로 등록했습니다 (백만 KRW) — 투자구조 탭에서 금액을 확인하세요.");
    } catch (e) {
      toast(e instanceof Error ? `등록 실패: ${e.message}` : "등록 실패");
    } finally {
      setPushBusy(null);
    }
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
            <table className="data-table table-fixed-pct tmin-64" aria-label="인센티브">
              <caption className="sr-only">인센티브</caption>
              <ColGroup widths={INCENTIVE_COL_PCT} />
              <thead><tr><th>프로그램</th><th>부여기관</th><th>방향</th><th className="col-num">NPV</th><th>클로백 조건</th><th>적격 증빙 · 자금 조달</th><th>관리</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.program_name ?? "—"}</td>
                    <td>{r.grantor ?? "—"}</td>
                    <td>{canAct ? (
                        <select aria-label={`${r.program_name ?? "프로그램"} 방향`} className="sizing-new-input sizing-new-input-sm" value={r.direction} onChange={(e) => void setDirection(r, e.target.value)}>
                          <option value="prospective">수혜 예정</option><option value="granted">확정</option>
                        </select>
                      ) : <span className={`status-chip ${r.direction === "granted" ? "status-green" : "status-amber"}`}>{r.direction === "granted" ? "확정" : "수혜 예정"}</span>}</td>
                    <td className="col-num tabular-nums">{r.npv_value != null ? `${fmtNpvEok(r.npv_value)}억` : "—"}</td>
                    <td className="text-[length:var(--fs-caption)]">{r.clawback_rule ?? "—"}</td>
                    <td className="text-[length:var(--fs-caption)]">
                      {r.evidence_ref ? <code className="dd-item-id mr-1" title={r.evidence_ref}>{r.evidence_ref.slice(0, 24)}</code> : <span className="status-chip status-amber mr-1" title="적격 증빙이 없으면 자금조달 sources에 넣을 수 없습니다">증빙 없음</span>}
                      {canAct && (
                        <button type="button" className="btn-ghost btn-sm" disabled={!r.evidence_ref || r.npv_value == null || pushBusy === r.id}
                          title={!r.evidence_ref ? "적격 증빙(evidence_ref)이 있어야 합니다" : r.npv_value == null ? "NPV가 있어야 합니다" : "이 인센티브를 S10 자금조달 sources 항목(보조금 교부 증빙)으로 등록합니다"}
                          onClick={() => void pushToFinancing(r)}>→ 자금 조달</button>
                      )}
                    </td>
                    <td>{canAct && <button type="button" className="btn-danger btn-sm" onClick={() => remove(r)}>삭제</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {canAct && (
        <section className="market-section" aria-label="인센티브 등록">
          <h2 className="text-[length:var(--fs-body)] mb-2">인센티브 등록</h2>
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
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[12rem]"><span className="block mb-1">적격 증빙 참조</span>
                <input className="sizing-new-input w-full" value={form.evidence_ref} onChange={(e) => setForm({ ...form, evidence_ref: e.target.value })} placeholder="교부결정 통지 2026-10-15 / 협약서 §3" /></label>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? "등록 중..." : "등록"}</button>
            </div>
          </form>
        </section>
      )}
      {confirmDialog}
    </main>
  );
}

export default function IncentivesPage() {
  return <Suspense fallback={null}><IncentivesView /></Suspense>;
}
