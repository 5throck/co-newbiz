"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { useTranslations } from "next-intl";
import { api } from "../../../../lib/api.ts";
import { ColGroup, PageState, useToast } from "../../../../components/ui.tsx";
import { useConfirm } from "../../../../components/crud.tsx";

// 차입 7열(관리 열 포함) — 대출기관·커버넌트·담보 텍스트에 여유, 수치·날짜는 좁게.
const DEBT_COL_PCT = [17, 11, 12, 11, 20, 17, 12] as const;
// 커버넌트 여력 표 6열 — ColGroup 고정 % (R10 table-sizing).
const COV_HEADROOM_COL_PCT = [22, 12, 14, 18, 14, 20] as const;
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 부채·커버넌트 (financing/valuation) — Wave 0 REST B6. 차입 상품 목록 관리;
// 2026-10-21: 최신 시뮬레이션의 커버넌트 여력(headroom)을 서버(lib/covenant-headroom)
// 에서 읽어 S10 산출물 "커버넌트 여력"으로 표시한다 — 투자심의 자료·히트맵에도 전달.
interface Instrument { id: string; lender: string | null; principal: number; rate_type: string; rate: number; maturity: string | null; amortization: string | null; covenant_json: string | null; security: string | null; seniority: string | null }
interface HeadroomRow { covenant_key: string; direction: "max" | "min" | "unknown"; min_headroom_pct: number | null; tightest_period: string | null; periods: number; breached_periods: number; status: "breached" | "tight" | "ok" | "unknown_direction" }
interface DscrPeriodRow { year: number; cfads: number; debt_service: number; dscr: number | null }
interface Headroom {
  status: "computed" | "insufficient_evidence"; reason?: string; message?: string | null; covenants: HeadroomRow[];
  dscr?: { scenario: "downside" | "base" | null; fallback_to_base: boolean; periods: DscrPeriodRow[]; min_dscr: number | null; advisories: string[]; missing_inputs: string[] };
}

function DebtView() {
  const t = useTranslations("pages.projects.debt");
  const tc = useTranslations("common");
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [rows, setRows] = useState<Instrument[] | null>(null);
  const [headroom, setHeadroom] = useState<Headroom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const EMPTY_FORM = { lender: "", principal: "", rate: "", rate_type: "fixed", maturity: "", amortization: "annuity", covenant_json: "", security: "", seniority: "" };
  const [form, setForm] = useState(EMPTY_FORM);
  // 수정 중인 차입 id — null이면 신규 등록 모드 (같은 폼·같은 단일 주 버튼을 재사용).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  // 시나리오 계산 입력 — 명시적 가정(사용자 입력)이며 저장되지 않는다.
  // 산식: 연간 상환액 = 연금공식(원금, 금리, 잔존기간) / DSCR = 현금흐름 ÷ 상환액.
  const [scenarioCf, setScenarioCf] = useState("");
  const [stress, setStress] = useState(false);

  const load = useCallback(() => {
    api.get<{ instruments: Instrument[]; headroom: Headroom }>(`/api/projects/${encodeURIComponent(id)}/debt`)
      .then((r) => { setRows(r.data.instruments); setHeadroom(r.data.headroom); })
      .catch((e) => setError(e instanceof Error ? e.message : tc("errors.loadFailed")));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !form.principal || !form.rate) return;
    setBusy(true);
    const payload = {
      lender: form.lender.trim() || undefined, principal: Number(form.principal),
      rate: Number(form.rate), rate_type: form.rate_type,
      maturity: form.maturity.trim() || undefined, amortization: form.amortization || undefined,
      covenant_json: form.covenant_json.trim() || undefined,
      security: form.security.trim() || undefined, seniority: form.seniority.trim() || undefined,
    };
    const base = `/api/projects/${encodeURIComponent(id)}/debt`;
    try {
      if (editingId) {
        await api.put(`${base}/${encodeURIComponent(editingId)}`, payload);
        toast(t("updated"));
      } else {
        await api.post(base, payload);
        toast(t("created"));
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      setError(null);
      load();
    } catch (err) { setError(err instanceof Error ? err.message : editingId ? t("updateFailed") : tc("errors.createFailed")); }
    finally { setBusy(false); }
  }

  function startEdit(r: Instrument) {
    setEditingId(r.id);
    setForm({
      lender: r.lender ?? "", principal: String(r.principal), rate: String(r.rate), rate_type: r.rate_type,
      maturity: r.maturity ?? "", amortization: r.amortization ?? "", covenant_json: r.covenant_json ?? "",
      security: r.security ?? "", seniority: r.seniority ?? "",
    });
    document.getElementById("debt-register-form")?.scrollIntoView?.({ block: "center" });
  }
  function cancelEdit() { setEditingId(null); setForm(EMPTY_FORM); }

  function remove(r: Instrument) {
    confirm(t("deleteConfirmTitle"), () => {
      void (async () => {
        try {
          await api.delete(`/api/projects/${encodeURIComponent(id)}/debt/${encodeURIComponent(r.id)}`);
          toast(t("deleted"));
          if (editingId === r.id) cancelEdit();
          load();
        } catch (e) { toast(e instanceof Error ? t("deleteFailedWith", { message: e.message }) : tc("errors.deleteFailed")); }
      })();
    }, { body: t("deleteConfirmBody", { name: r.lender ?? t("fallbackLender"), principal: r.principal }), confirmLabel: tc("delete") });
  }

  // covenant_json 파싱 — 표시 형식("DSCR >= 1.3 · NetLev <= 3.5x")과 JSON 형식 모두 수용.
  function parseThresholds(raw: string | null): Array<{ key: string; op: string; value: number }> {
    if (!raw?.trim()) return [];
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const out: Array<{ key: string; op: string; value: number }> = [];
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v !== "number") continue;
        const upper = /max|le|<=|상한|ceiling/i.test(k);
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
      <h1>{t("heading")} {t("headingSuffix")}</h1>
      <p className="objective">{t("objective")}</p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <section className="market-section" aria-label={t("listSectionAria")}>
        {rows === null ? <PageState state="loading" /> : rows.length === 0 ? (
          <PageState state="empty" emptyText={t("empty")} />
        ) : (
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-48" aria-label={t("tableAria")}>
              <caption className="sr-only">{t("tableAria")}</caption>
              <ColGroup widths={DEBT_COL_PCT} />
              <thead><tr><th>{t("thLender")}</th><th className="col-num">{t("thPrincipal")}</th><th>{t("thRate")}</th><th>{t("thMaturity")}</th><th>{t("thCovenant")}</th><th>{t("thSecurity")}</th><th>{t("thManage")}</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.lender ?? "—"}</td>
                  <td className="col-num tabular-nums">{r.principal}</td>
                  <td className="tabular-nums">{r.rate_type === "fixed" ? t("rateFixed") : t("rateFloating")}{" "}{r.rate}%</td>
                  <td className="tabular-nums" title={r.amortization ? t("amortTitle", { value: r.amortization }) : undefined}>{r.maturity ?? "—"}{r.amortization ? <span className="note"> · {r.amortization}</span> : null}</td>
                  <td className="text-[length:var(--fs-caption)]">{r.covenant_json ?? "—"}</td>
                  <td className="text-[length:var(--fs-caption)]">{[r.security, r.seniority].filter(Boolean).join(" · ") || "—"}</td>
                  <td>{canAct && (
                    <span className="flex flex-wrap gap-1">
                      <button type="button" className="btn-ghost btn-sm" aria-label={t("editAria", { name: r.lender ?? t("fallbackLender") })} onClick={() => startEdit(r)}>{tc("edit")}</button>
                      <button type="button" className="btn-danger btn-sm" aria-label={t("deleteAria", { name: r.lender ?? t("fallbackLender") })} onClick={() => remove(r)}>{tc("delete")}</button>
                    </span>
                  )}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      {canAct && (
        <section className="market-section" aria-label={t("registerSectionAria")}>
          <h2 className="text-[length:var(--fs-body)] mb-2">{editingId ? t("editHeading") : t("registerHeading")}</h2>
          <form id="debt-register-form" className="sizing-new-form" onSubmit={submit} aria-label={editingId ? t("editHeading") : t("registerHeading")}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">{t("lblLender")}</span>
                <input className="sizing-new-input sizing-new-input-sm" value={form.lender} onChange={(e) => setForm({ ...form, lender: e.target.value })} /></label>
              <label className="text-[length:var(--fs-caption)] w-[8rem]"><span className="block mb-1">{t("lblPrincipal")}</span>
                <input type="number" className="sizing-new-input sizing-new-input-sm" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">{t("lblRateType")}</span>
                <select className="sizing-new-input sizing-new-input-sm" value={form.rate_type} onChange={(e) => setForm({ ...form, rate_type: e.target.value })}><option value="fixed">{t("rateFixed")}</option><option value="floating">{t("rateFloating")}</option></select></label>
              <label className="text-[length:var(--fs-caption)] w-[6rem]"><span className="block mb-1">{t("lblRate")}</span>
                <input type="number" step="0.01" className="sizing-new-input sizing-new-input-sm" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">{t("lblMaturity")}</span>
                <input className="sizing-new-input sizing-new-input-sm" value={form.maturity} onChange={(e) => setForm({ ...form, maturity: e.target.value })} placeholder={t("phMaturity")} /></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">{t("lblAmortization")}</span>
                <select className="sizing-new-input sizing-new-input-sm" value={form.amortization} onChange={(e) => setForm({ ...form, amortization: e.target.value })}>{form.amortization && !["annuity", "equal_principal", "bullet"].includes(form.amortization) && <option value={form.amortization}>{form.amortization}</option>}<option value="annuity">{t("amortAnnuity")}</option><option value="equal_principal">{t("amortEqualPrincipal")}</option><option value="bullet">{t("amortBullet")}</option></select></label>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? (editingId ? tc("saving") : tc("registering")) : editingId ? tc("save") : tc("register")}</button>
              {editingId && <button type="button" className="btn-ghost" onClick={cancelEdit}>{tc("cancel")}</button>}
            </div>
            <label className="text-[length:var(--fs-caption)] block mt-2"><span className="block mb-1">{t("lblCovenant")}</span>
              <input className="sizing-new-input w-full" value={form.covenant_json} onChange={(e) => setForm({ ...form, covenant_json: e.target.value })} placeholder={t("phCovenant")} /></label>
            <div className="flex flex-wrap items-end gap-2 mt-2">
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[12rem]"><span className="block mb-1">{t("lblSecurity")}</span>
                <input className="sizing-new-input w-full" value={form.security} onChange={(e) => setForm({ ...form, security: e.target.value })} /></label>
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[12rem]"><span className="block mb-1">{t("lblSeniority")}</span>
                <input className="sizing-new-input w-full" value={form.seniority} onChange={(e) => setForm({ ...form, seniority: e.target.value })} /></label>
            </div>
          </form>
        </section>
      )}
      <section className="market-section" aria-label={t("headroomSectionAria")} data-testid="covenant-headroom">
        <h2 className="text-[length:var(--fs-body)] mb-2">{t("headroomHeading")} <span className="note">{t("headroomNote")}</span></h2>
        {headroom === null ? <PageState state="loading" /> : headroom.status === "insufficient_evidence" ? (
          <PageState state="empty" emptyText={headroom.reason === "no_debt" ? t("headroomNoDebt") : (headroom.message ?? t("headroomNoSim"))} />
        ) : (
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-48" aria-label={t("headroomSectionAria")}>
              <caption className="sr-only">{t("headroomSectionAria")}</caption>
              <ColGroup widths={COV_HEADROOM_COL_PCT} />
              <thead><tr><th>{t("thCovenant")}</th><th>{tc("direction")}</th><th className="col-num">{t("hMinHeadroom")}</th><th>{t("hTightestPeriod")}</th><th className="col-num">{t("hBreachedPeriods")}</th><th>{t("hVerdict")}</th></tr></thead>
              <tbody>{headroom.covenants.map((c) => (
                <tr key={c.covenant_key}>
                  <td className="font-semibold">{c.covenant_key}</td>
                  <td className="text-[length:var(--fs-caption)]">{c.direction === "max" ? t("dirMax") : c.direction === "min" ? t("dirMin") : <span title={t("dirUnknownTitle")}>{t("dirUnknown")}</span>}</td>
                  <td className="col-num tabular-nums">{c.min_headroom_pct != null ? `${Math.round(c.min_headroom_pct * 1000) / 10}%` : "—"}</td>
                  <td className="tabular-nums">{c.tightest_period ?? "—"}</td>
                  <td className="col-num tabular-nums">{c.breached_periods}/{c.periods}</td>
                  <td>{c.status === "breached" ? <span className="status-chip status-red">{t("chipBreached")}</span> : c.status === "tight" ? <span className="status-chip status-amber">{t("chipTight")}</span> : c.status === "ok" ? <span className="status-chip status-green">{t("chipOk")}</span> : <span className="status-chip status-gray">{t("chipNoDir")}</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {headroom?.dscr?.scenario && headroom.dscr.min_dscr !== null && (
          <p className="note mt-2" data-testid="dscr-basis">
            {t("headroomBasis", { scenario: headroom.dscr.scenario === "downside" ? t("basisDownside") : t("basisBase"), min: headroom.dscr.min_dscr })}
          </p>
        )}
        {(headroom?.dscr?.advisories ?? []).map((a) => <p key={a} className="note mt-1">{a}</p>)}
        <p className="note mt-2">{t("headroomFootnote")}</p>
      </section>
      <section className="market-section" aria-label={t("scenarioSectionAria")}>
        <h2 className="text-[length:var(--fs-body)] mb-2">{t("scenarioHeading")} <span className="note">{t("scenarioNote")}</span></h2>
        <div className="form-grid mb-2">
          <label className="text-[length:var(--fs-caption)] w-[12rem]"><span className="block mb-1">{t("scenarioCfLabel")}</span>
            <input type="number" className="sizing-new-input sizing-new-input-sm" value={scenarioCf} onChange={(e) => setScenarioCf(e.target.value)} placeholder={t("scenarioCfPlaceholder")} /></label>
          <span className="note">{t("stressNote")}</span>
          <label className="text-[length:var(--fs-caption)] flex items-center gap-1 mb-1"><input type="checkbox" checked={stress} onChange={(e) => setStress(e.target.checked)} /> {t("stressLabel")}</label>
        </div>
        {rows && rows.length > 0 && scenarioCf && Number(scenarioCf) > 0 ? (
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table" aria-label={t("scenarioTableAria")}>
              <caption className="sr-only">{t("scenarioCaption")}</caption>
              <thead><tr><th>{t("sThInstrument")}</th><th className="col-num">{t("sThAnnualService")}</th><th className="col-num">{t("sThDscr")}</th><th>{t("sThThreshold")}</th><th>{t("hVerdict")}</th></tr></thead>
              <tbody>{rows.map((r) => {
                const rate = (stress ? r.rate + 2 : r.rate) / 100;
                const n = remainingYears(r.maturity);
                const ds = r.principal > 0 && rate >= 0 ? Math.round(r.principal * (rate / (1 - Math.pow(1 + rate, -n)))) : 0;
                const dscr = ds > 0 ? Math.round((Number(scenarioCf) / ds) * 100) / 100 : null;
                const th = parseThresholds(r.covenant_json).find((cv) => /dscr/i.test(cv.key));
                const pass = dscr != null && th ? dscr >= th.value : null;
                return (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.lender ?? t("fallbackLender")}</td>
                    <td className="col-num tabular-nums">{t("annualService", { value: ds })}</td>
                    <td className="col-num tabular-nums font-semibold">{dscr ?? "—"}</td>
                    <td className="text-[length:var(--fs-caption)]">{th ? t("thresholdDscr", { value: th.value }) : t("noThreshold")}</td>
                    <td>{pass == null ? <span className="status-chip status-gray">{t("verdictUnknown")}</span> : pass ? <span className="status-chip status-green">{t("verdictPass")}</span> : <span className="status-chip status-red">{t("chipBreached")}</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : (
          <p className="note">{t("scenarioHint")}</p>
        )}
        <p className="note mt-2">
          {t("scenarioDisclaimer")}
        </p>
      </section>

      {confirmDialog}
    </main>
  );
}

export default function DebtPage() {
  return <Suspense fallback={null}><DebtView /></Suspense>;
}
