"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { useTranslations } from "next-intl";
import { api } from "../../../../lib/api.ts";
import { ColGroup, PageState, useToast } from "../../../../components/ui.tsx";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 보상 패키지 표 6열(조사내역 등록 열은 canAct일 때만) — ColGroup 고정 % (R10 table-sizing).
const PKG_COL_PCT_ACT = [14, 18, 18, 12, 14, 24] as const;
const PKG_COL_PCT_RO = [18, 24, 22, 14, 22] as const;

// 경영진 보상·임금 형평 (hr-integration-agent) — Wave 0 REST B9.
// 집계 전용 (k-익명성 ≥3) + 경영진 참조만 노출 (SEC-05, 개인 노출 없음).
// 2026-10-21: 경영진 보상 패키지 사람 입력(POST comp-parity/packages — brownfield-dd
// step 7, ma-04~06)과 CoC 트리거 패키지의 조사내역(dd_finding) 등록 버튼.
interface Parity { job_family: string; grade: string | null; headcount: number; target_median: number; acquirer_median: number; gap_pct: number; annual_cost_delta: number }
interface Pkg { id: string; executive_ref: string; role_title: string; base_pay: number; coc_trigger: number; coc_payout_estimate: number | null; accelerated_vesting: number; non_compete_months: number | null; flight_risk: string | null; value_impact: number | null }

const EMPTY_PKG = { executive_ref: "", role_title: "", base_pay: "", coc_trigger: false, coc_payout_estimate: "", accelerated_vesting: false, non_compete_months: "", flight_risk: "", evidence_ref: "" };

function CompView() {
  const t = useTranslations("pages.projects.compParity");
  const tc = useTranslations("common");
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [data, setData] = useState<{ parity: Parity[]; management_packages: Pkg[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [entry, setEntry] = useState({ job_family: "", grade: "", headcount: "", target_median: "", acquirer_median: "" });
  const [entryErr, setEntryErr] = useState<string | null>(null);
  const [entryMsg, setEntryMsg] = useState<string | null>(null);
  const [entryBusy, setEntryBusy] = useState(false);
  const [pkg, setPkg] = useState(EMPTY_PKG);
  const [pkgErr, setPkgErr] = useState<string | null>(null);
  const [pkgBusy, setPkgBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<{ parity: Parity[]; management_packages: Pkg[] }>(`/api/projects/${encodeURIComponent(id)}/comp-parity`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : tc("errors.loadFailed")));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function submitPackage(e: React.FormEvent) {
    e.preventDefault();
    if (pkgBusy) return;
    setPkgErr(null); setPkgBusy(true);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/comp-parity/packages`, {
        executive_ref: pkg.executive_ref, role_title: pkg.role_title, base_pay: Number(pkg.base_pay),
        coc_trigger: pkg.coc_trigger, coc_payout_estimate: pkg.coc_payout_estimate === "" ? null : Number(pkg.coc_payout_estimate),
        accelerated_vesting: pkg.accelerated_vesting, non_compete_months: pkg.non_compete_months === "" ? null : Number(pkg.non_compete_months),
        flight_risk: pkg.flight_risk || null, evidence_ref: pkg.evidence_ref || null,
      });
      toast(t("pkgSaved"));
      setPkg(EMPTY_PKG);
      load();
    } catch (err) {
      setPkgErr(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setPkgBusy(false);
    }
  }

  async function pushFinding(r: Pkg) {
    setPushBusy(r.id);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/dd/findings`, {
        // 데이터 프로토콜 값(저장 카테고리·기록 본문) — UI 문자열이 아니므로 카탈로그로 옮기지 않는다.
        category: "경영진 보상",
        description: `[${r.executive_ref}] ${r.role_title} — 지위 변동(CoC) 트리거 보상${r.coc_payout_estimate != null ? ` 추정 ${Math.round(r.coc_payout_estimate / 1_000_000).toLocaleString("ko-KR")}백만원` : ""}${r.accelerated_vesting ? ", 가속 베스팅" : ""}${r.non_compete_months != null ? `, 경업금지 ${r.non_compete_months}개월` : ""}`,
        value_impact: r.coc_payout_estimate != null ? -Math.round(r.coc_payout_estimate / 1_000_000) : null,
        evidence_ref: `management-package:${r.id}`,
      });
      toast(t("findingPushed"));
    } catch (e) {
      toast(e instanceof Error ? t("findingPushFailed", { msg: e.message }) : tc("errors.createFailed"));
    } finally {
      setPushBusy(null);
    }
  }

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault();
    if (entryBusy) return;
    setEntryErr(null); setEntryMsg(null);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/comp-parity`, {
        job_family: entry.job_family, grade: entry.grade, headcount: Number(entry.headcount),
        target_median: Number(entry.target_median), acquirer_median: Number(entry.acquirer_median),
      });
      setEntryMsg(t("paritySaved"));
      setEntry({ job_family: "", grade: "", headcount: "", target_median: "", acquirer_median: "" });
      load();
    } catch (err) {
      setEntryErr(err instanceof Error ? err.message : t("saveFailed"));
    }
  }

  const fmt = (v: number | null) => (v == null ? "—" : v.toLocaleString("ko-KR"));

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>{t("heading")}</h1>
      <p className="objective">{t("objective")}</p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <div className="grid2e">
        <section className="market-section" aria-label={t("pkgSectionAria")}>
          <h2 className="text-[length:var(--fs-body)] mb-2">{t("pkgHeading")}</h2>
          {data === null ? <PageState state="loading" /> : data.management_packages.length === 0 ? (
            <PageState state="empty" emptyText={t("pkgEmpty")} />
          ) : (
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-56" aria-label={t("pkgTableAria")}>
              <ColGroup widths={canAct ? PKG_COL_PCT_ACT : PKG_COL_PCT_RO} />
              <thead><tr><th>{t("thExecRef")}</th><th>{t("thRole")}</th><th className="col-num">{t("thBasePay")}</th><th>CoC</th><th>{t("thRisk")}</th>{canAct && <th>{t("thFindingPush")}</th>}</tr></thead>
              <tbody>{data.management_packages.map((r) => (
                <tr key={r.id}>
                  <td><code className="dd-item-id">{r.executive_ref}</code></td>
                  <td>{r.role_title}</td>
                  <td className="col-num tabular-nums">{fmt(r.base_pay)}</td>
                  <td>{r.coc_trigger ? <span className="status-chip status-amber" title={r.coc_payout_estimate != null ? t("estPayoutTitle", { value: fmt(r.coc_payout_estimate) }) : undefined}>{t("chipTrigger")}</span> : <span className="status-chip status-gray">{t("chipNone")}</span>}</td>
                  <td>{r.flight_risk ? <span className={`status-chip ${r.flight_risk === "high" ? "status-red" : r.flight_risk === "medium" ? "status-amber" : "status-green"}`}>{r.flight_risk}</span> : "—"}</td>
                  {canAct && (
                    <td>
                      {r.coc_trigger ? (
                        <button type="button" className="btn-ghost btn-sm" disabled={pushBusy === r.id}
                          title={t("pushTitle")}
                          onClick={() => void pushFinding(r)}>{t("pushBtn")}</button>
                      ) : <span className="note">—</span>}
                    </td>
                  )}
                </tr>
              ))}</tbody>
            </table>
            </div>
          )}
        </section>
        {canAct && (
          <section className="market-section" aria-label={t("pkgFormSectionAria")}>
            <h2 className="text-[length:var(--fs-body)] mb-2">{t("pkgFormHeading")}</h2>
            <form className="grid gap-2 md:grid-cols-4" onSubmit={submitPackage}>
              <label className="grid gap-1 text-sm">{t("lblExecRef")}<input className="form-input" value={pkg.executive_ref} onChange={(e) => setPkg({ ...pkg, executive_ref: e.target.value })} placeholder="CEO-01" required /></label>
              <label className="grid gap-1 text-sm">{t("lblRole")}<input className="form-input" value={pkg.role_title} onChange={(e) => setPkg({ ...pkg, role_title: e.target.value })} placeholder={t("phRole")} required /></label>
              <label className="grid gap-1 text-sm">{t("lblBasePay")}<input className="form-input" inputMode="numeric" value={pkg.base_pay} onChange={(e) => setPkg({ ...pkg, base_pay: e.target.value })} placeholder="300000000" required /></label>
              <label className="grid gap-1 text-sm">{t("lblFlightRisk")}
                <select className="form-input" value={pkg.flight_risk} onChange={(e) => setPkg({ ...pkg, flight_risk: e.target.value })}>
                  <option value="">—</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pkg.coc_trigger} onChange={(e) => setPkg({ ...pkg, coc_trigger: e.target.checked })} /> {t("lblCocTrigger")}</label>
              <label className="grid gap-1 text-sm">{t("lblCocPayout")}<input className="form-input" inputMode="numeric" value={pkg.coc_payout_estimate} onChange={(e) => setPkg({ ...pkg, coc_payout_estimate: e.target.value })} placeholder="600000000" disabled={!pkg.coc_trigger} /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pkg.accelerated_vesting} onChange={(e) => setPkg({ ...pkg, accelerated_vesting: e.target.checked })} /> {t("lblAccelVesting")}</label>
              <label className="grid gap-1 text-sm">{t("lblNonCompete")}<input className="form-input" inputMode="numeric" value={pkg.non_compete_months} onChange={(e) => setPkg({ ...pkg, non_compete_months: e.target.value })} placeholder="24" /></label>
              <label className="grid gap-1 text-sm md:col-span-3">{t("lblEvidenceRef")}<input className="form-input" value={pkg.evidence_ref} onChange={(e) => setPkg({ ...pkg, evidence_ref: e.target.value })} placeholder={t("phEvidenceRef")} /></label>
              <button className="btn-ghost btn-sm justify-self-start self-end" type="submit" disabled={pkgBusy}>{pkgBusy ? t("saving") : t("save")}</button>
            </form>
            {pkgErr && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1">✕ {pkgErr}</p>}
            <p className="note" style={{ marginBottom: 0 }}>{t("noRealNamesNote")}</p>
          </section>
        )}
        {canAct && (
          <section className="market-section" aria-label={t("parityFormSectionAria")}>
            <h2 className="text-[length:var(--fs-body)] mb-2">{t("parityFormHeading")}</h2>
            <form className="grid gap-2 md:grid-cols-5" onSubmit={submitEntry}>
              <label className="grid gap-1 text-sm">{t("lblJobFamily")}<input className="form-input" value={entry.job_family} onChange={(e) => setEntry({ ...entry, job_family: e.target.value })} placeholder={t("phJobFamily")} required /></label>
              <label className="grid gap-1 text-sm">{t("lblGrade")}<input className="form-input" value={entry.grade} onChange={(e) => setEntry({ ...entry, grade: e.target.value })} placeholder={t("phGrade")} required /></label>
              <label className="grid gap-1 text-sm">{t("lblHeadcount")}<input className="form-input" inputMode="numeric" value={entry.headcount} onChange={(e) => setEntry({ ...entry, headcount: e.target.value })} placeholder="5" required /></label>
              <label className="grid gap-1 text-sm">{t("lblTargetMedian")}<input className="form-input" inputMode="numeric" value={entry.target_median} onChange={(e) => setEntry({ ...entry, target_median: e.target.value })} placeholder="4800000" required /></label>
              <label className="grid gap-1 text-sm">{t("lblAcquirerMedian")}<input className="form-input" inputMode="numeric" value={entry.acquirer_median} onChange={(e) => setEntry({ ...entry, acquirer_median: e.target.value })} placeholder="5200000" required /></label>
              <button className="btn-ghost btn-sm justify-self-start" type="submit" disabled={entryBusy}>{entryBusy ? t("saving") : t("save")}</button>
            </form>
            {entryErr && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1">✕ {entryErr}</p>}
            {entryMsg && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mt-1">✓ {entryMsg}</p>}
          </section>
        )}

        <section className="market-section" aria-label={t("paritySectionAria")}>
          <h2 className="text-[length:var(--fs-body)] mb-2">{t("parityHeading")}</h2>
          {data === null ? <PageState state="loading" /> : data.parity.length === 0 ? (
            <PageState state="empty" emptyText={t("parityEmpty")} />
          ) : (
            <table className="data-table" aria-label={t("parityTableAria")}>
              <thead><tr><th>{t("thJobFamily")}</th><th className="col-num">{t("thTargetMedian")}</th><th className="col-num">{t("thAcquirerMedian")}</th><th className="col-num">{t("thGap")}</th></tr></thead>
              <tbody>{data.parity.map((r, i) => (
                <tr key={i}>
                  <td className="font-semibold">{r.job_family}{r.grade ? ` (${r.grade})` : ""}</td>
                  <td className="col-num tabular-nums">{fmt(r.target_median)}</td>
                  <td className="col-num tabular-nums">{fmt(r.acquirer_median)}</td>
                  <td className="col-num tabular-nums"><span className={`status-chip ${Math.abs(r.gap_pct) >= 10 ? "status-amber" : "status-green"}`}>{r.gap_pct > 0 ? "+" : ""}{r.gap_pct}%</span></td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <p className="note" style={{ marginBottom: 0 }}>{t("unitNote")}</p>
        </section>
      </div>
    </main>
  );
}

export default function CompPage() {
  return <Suspense fallback={null}><CompView /></Suspense>;
}
