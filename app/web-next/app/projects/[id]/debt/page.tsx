"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { api } from "../../../../lib/api.ts";
import { ColGroup, PageState, useToast } from "../../../../components/ui.tsx";

// 차입 6열 — 대출기관·커버넌트·담보 텍스트에 여유, 수치·날짜는 좁게.
const DEBT_COL_PCT = [20, 13, 13, 11, 22, 21] as const;
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 부채·커버넌트 (financing/valuation) — Wave 0 REST B6. 차입 상품 목록 관리;
// 커버넌트 시나리오 테스트는 Wave 3 계산 뷰.
interface Instrument { id: string; lender: string | null; principal: number; rate_type: string; rate: number; maturity: string | null; covenant_json: string | null; security: string | null; seniority: string | null }

function DebtView() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [rows, setRows] = useState<Instrument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ lender: "", principal: "", rate: "", rate_type: "fixed", maturity: "", covenant_json: "" });
  const [busy, setBusy] = useState(false);
  // 시나리오 계산 입력 — 명시적 가정(사용자 입력)이며 저장되지 않는다.
  // 산식: 연간 상환액 = 연금공식(원금, 금리, 잔존기간) / DSCR = 현금흐름 ÷ 상환액.
  const [scenarioCf, setScenarioCf] = useState("");
  const [stress, setStress] = useState(false);

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

  // covenant_json 파싱 — 표시 형식("DSCR >= 1.3 · NetLev <= 3.5x")과 JSON 형식 모두 수용.
  function parseThresholds(raw: string | null): Array<{ key: string; op: string; value: number }> {
    if (!raw?.trim()) return [];
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const out: Array<{ key: string; op: string; value: number }> = [];
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v !== "number") continue;
        const upper = /max|le|<=|상한|ceiling/i.test(k);
        out.push({ key: k.replace(/^(wacc\.)?/i, "").replace(/_min$|_max$|_min$|_max$/i, ""), op: upper ? "≤" : "≥", value: v });
      }
      return out;
    } catch {
      const out: Array<{ key: string; op: string; value: number }> = [];
      for (const m of raw.matchAll(/([A-Za-z]+)\s*(>=|<=|≥|≤|>|<)\s*([0-9.]+)/g)) {
        out.push({ key: m[1], op: m[2].replace(">", "≥").replace("<", "≤"), value: Number(m[3]) });
      }
      return out;
    }
  }
  // 잔존기간(년) — maturity(YYYY-MM) 기준, 미지정 시 5년 가정(명시 표기).
  function remainingYears(maturity: string | null): number {
    if (!maturity) return 5;
    const end = new Date(maturity).getTime();
    if (!Number.isFinite(end)) return 5;
    return Math.max(1, Math.round(((end - Date.now()) / (365.25 * 24 * 3600 * 1000)) * 10) / 10);
  }
  // 연금 상환액 — 원금 × r / (1 − (1+r)^−n)
  function annualDebtService(p: Instrument): number {
    const r = p.rate_type === "fixed" ? p.rate / 100 : p.rate / 100; // 변동금리는 현재값 기준 시나리오
    const n = remainingYears(p.maturity);
    if (r <= 0) return p.principal / n;
    return Math.round(p.principal * (r / (1 - Math.pow(1 + r, -n))));
  }

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>부채·커버넌트</h1>
      <p className="objective">차입 상품과 커버넌트 조건을 관리합니다 — 커버넌트 여력은 자금조달(S10)과 대조됩니다.</p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <section className="market-section" aria-label="차입 목록">
        {rows === null ? <PageState state="loading" /> : rows.length === 0 ? (
          <PageState state="empty" emptyText="등록된 차입이 없습니다." />
        ) : (
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-48" aria-label="차입">
              <caption className="sr-only">차입</caption>
              <ColGroup widths={DEBT_COL_PCT} />
              <thead><tr><th>대출기관</th><th className="col-num">원금</th><th>금리</th><th>만기</th><th>커버넌트</th><th>담보·선위</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.lender ?? "—"}</td>
                  <td className="col-num tabular-nums">{r.principal}</td>
                  <td className="tabular-nums">{r.rate_type === "fixed" ? "고정" : "변동"} {r.rate}%</td>
                  <td className="tabular-nums">{r.maturity ?? "—"}</td>
                  <td className="text-[length:var(--fs-caption)]">{r.covenant_json ?? "—"}</td>
                  <td className="text-[length:var(--fs-caption)]">{[r.security, r.seniority].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      <section className="market-section" aria-label="커버넌트 시나리오 계산" style={{ border: "1px solid var(--border)", borderRadius: 12 }}>
        <h2 className="text-[0.9rem] mb-2">커버넌트 시나리오 계산 <span className="note">— 산식은 저장 조건 기반, 현금흐름은 명시적 가정 입력</span></h2>
        <div className="form-grid" style={{ marginBottom: 8 }}>
          <label className="text-[length:var(--fs-caption)] w-[12rem]"><span className="block mb-1">시나리오 연간 영업현금흐름 (억원)</span>
            <input type="number" className="sizing-new-input sizing-new-input-sm" value={scenarioCf} onChange={(e) => setScenarioCf(e.target.value)} placeholder="예: 120" /></label>
          <span className="note">금리 +2%p 스트레스는 체크박스로 적용</span>
          <label className="text-[length:var(--fs-caption)] flex items-center gap-1" style={{ marginBottom: 4 }}><input type="checkbox" checked={stress} onChange={(e) => setStress(e.target.checked)} /> 금리 +2%p 스트레스</label>
        </div>
        {rows && rows.length > 0 && scenarioCf && Number(scenarioCf) > 0 ? (
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table" aria-label="커버넌트 시나리오">
              <caption className="sr-only">커버넌트 시나리오 계산</caption>
              <thead><tr><th>차입</th><th className="col-num">연간 상환액</th><th className="col-num">부채상환비율</th><th>임계값</th><th>판정</th></tr></thead>
              <tbody>{rows.map((r) => {
                const rate = (stress ? r.rate + 2 : r.rate) / 100;
                const n = remainingYears(r.maturity);
                const ds = r.principal > 0 && rate >= 0 ? Math.round(r.principal * (rate / (1 - Math.pow(1 + rate, -n)))) : 0;
                const dscr = ds > 0 ? Math.round((Number(scenarioCf) / ds) * 100) / 100 : null;
                const th = parseThresholds(r.covenant_json).find((t) => /dscr/i.test(t.key));
                const pass = dscr != null && th ? dscr >= th.value : null;
                return (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.lender ?? "차입"}</td>
                    <td className="col-num tabular-nums">{ds}억</td>
                    <td className="col-num tabular-nums font-semibold">{dscr ?? "—"}</td>
                    <td className="text-[length:var(--fs-caption)]">{th ? `부채상환비율 ≥ ${th.value}` : "임계값 미등록"}</td>
                    <td>{pass == null ? <span className="status-chip status-gray">판정 불가</span> : pass ? <span className="status-chip status-green">충족</span> : <span className="status-chip status-red">위반</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : (
          <p className="note" style={{ margin: 0 }}>시나리오 현금흐름을 입력하면 각 차입의 연간 상환액(연금공식)과 부채상환비율을 계산해 임계값과 대조합니다.</p>
        )}
        <p className="note" style={{ margin: "6px 0 0" }}>
          재무약정 판정 결과는 참고용 시나리오이며 공식 테스트는 재무약정 시험(시뮬레이션 실행)으로 확정됩니다 — 시뮬레이션 연계는 백로그.
        </p>
      </section>

      {canAct && (
        <section className="market-section" aria-label="차입 등록">
          <h2 className="text-[0.9rem] mb-2">차입 등록</h2>
          <form className="sizing-new-form" onSubmit={create}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">대출기관</span>
                <input className="sizing-new-input sizing-new-input-sm" value={form.lender} onChange={(e) => setForm({ ...form, lender: e.target.value })} /></label>
              <label className="text-[length:var(--fs-caption)] w-[8rem]"><span className="block mb-1">원금 *</span>
                <input type="number" className="sizing-new-input sizing-new-input-sm" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">금리 종류</span>
                <select className="sizing-new-input sizing-new-input-sm" value={form.rate_type} onChange={(e) => setForm({ ...form, rate_type: e.target.value })}><option value="fixed">고정</option><option value="floating">변동</option></select></label>
              <label className="text-[length:var(--fs-caption)] w-[6rem]"><span className="block mb-1">금리 (%)</span>
                <input type="number" step="0.01" className="sizing-new-input sizing-new-input-sm" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">만기</span>
                <input className="sizing-new-input sizing-new-input-sm" value={form.maturity} onChange={(e) => setForm({ ...form, maturity: e.target.value })} placeholder="2031-06" /></label>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? "등록 중..." : "등록"}</button>
            </div>
            <label className="text-[length:var(--fs-caption)] block mt-2"><span className="block mb-1">커버넌트 (JSON 또는 요약)</span>
              <input className="sizing-new-input w-full" value={form.covenant_json} onChange={(e) => setForm({ ...form, covenant_json: e.target.value })} placeholder="DSCR >= 1.3 · NetLev <= 3.5x" /></label>
          </form>
        </section>
      )}
    </main>
  );
}

export default function DebtPage() {
  return <Suspense fallback={null}><DebtView /></Suspense>;
}
