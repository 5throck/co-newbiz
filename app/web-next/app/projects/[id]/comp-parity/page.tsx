"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { api } from "../../../../lib/api.ts";
import { PageState, useToast } from "../../../../components/ui.tsx";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 경영진 보상·임금 형평 (hr-integration-agent) — Wave 0 REST B9.
// 집계 전용 (k-익명성 ≥3) + 경영진 참조만 노출 (SEC-05, 개인 노출 없음).
// 2026-10-21: 경영진 보상 패키지 사람 입력(POST comp-parity/packages — brownfield-dd
// step 7, ma-04~06)과 CoC 트리거 패키지의 조사내역(dd_finding) 등록 버튼.
interface Parity { job_family: string; grade: string | null; headcount: number; target_median: number; acquirer_median: number; gap_pct: number; annual_cost_delta: number }
interface Pkg { id: string; executive_ref: string; role_title: string; base_pay: number; coc_trigger: number; coc_payout_estimate: number | null; accelerated_vesting: number; non_compete_months: number | null; flight_risk: string | null; value_impact: number | null }

const EMPTY_PKG = { executive_ref: "", role_title: "", base_pay: "", coc_trigger: false, coc_payout_estimate: "", accelerated_vesting: false, non_compete_months: "", flight_risk: "", evidence_ref: "" };

function CompView() {
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
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
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
      toast("경영진 보상 패키지를 기록했습니다 — 감사 로그에 남습니다 (ma-04~06).");
      setPkg(EMPTY_PKG);
      load();
    } catch (err) {
      setPkgErr(err instanceof Error ? err.message : "기록 실패");
    } finally {
      setPkgBusy(false);
    }
  }

  async function pushFinding(r: Pkg) {
    setPushBusy(r.id);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/dd/findings`, {
        category: "경영진 보상",
        description: `[${r.executive_ref}] ${r.role_title} — 지위 변동(CoC) 트리거 보상${r.coc_payout_estimate != null ? ` 추정 ${Math.round(r.coc_payout_estimate / 1_000_000).toLocaleString("ko-KR")}백만원` : ""}${r.accelerated_vesting ? ", 가속 베스팅" : ""}${r.non_compete_months != null ? `, 경업금지 ${r.non_compete_months}개월` : ""}`,
        value_impact: r.coc_payout_estimate != null ? -Math.round(r.coc_payout_estimate / 1_000_000) : null,
        evidence_ref: `management-package:${r.id}`,
      });
      toast("조사내역(dd_finding)으로 등록했습니다 — S9 조사내역 탭·리스크 히트맵·S10 입력에 반영됩니다.");
    } catch (e) {
      toast(e instanceof Error ? `등록 실패: ${e.message}` : "등록 실패");
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
      setEntryMsg("임금 형평 데이터를 기록했습니다 — 집계 표에 반영됩니다 (k-익명성 ≥3 스키마 강제).");
      setEntry({ job_family: "", grade: "", headcount: "", target_median: "", acquirer_median: "" });
      load();
    } catch (err) {
      setEntryErr(err instanceof Error ? err.message : "기록 실패");
    }
  }

  const fmt = (v: number | null) => (v == null ? "—" : v.toLocaleString("ko-KR"));

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>경영진 보상·임금 형평</h1>
      <p className="objective">경영진 보상 구조와 인수사-피인수사 임금 형평을 분석합니다 — 집계 전용(5인 미만 억제), 개인 노출 없음.</p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <div className="grid2e">
        <section className="market-section" aria-label="경영진 보상 패키지">
          <h2 className="text-[length:var(--fs-body)] mb-2">경영진 보상 패키지</h2>
          {data === null ? <PageState state="loading" /> : data.management_packages.length === 0 ? (
            <PageState state="empty" emptyText="등록된 보상 패키지가 없습니다." />
          ) : (
            <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table" aria-label="보상 패키지">
              <thead><tr><th>임원 참조</th><th>역할</th><th className="col-num">기본급</th><th>CoC</th><th>리스크</th>{canAct && <th>조사내역 등록</th>}</tr></thead>
              <tbody>{data.management_packages.map((r) => (
                <tr key={r.id}>
                  <td><code className="dd-item-id">{r.executive_ref}</code></td>
                  <td>{r.role_title}</td>
                  <td className="col-num tabular-nums">{fmt(r.base_pay)}</td>
                  <td>{r.coc_trigger ? <span className="status-chip status-amber" title={r.coc_payout_estimate != null ? `추정 지급 ${fmt(r.coc_payout_estimate)}원` : undefined}>트리거</span> : <span className="status-chip status-gray">없음</span>}</td>
                  <td>{r.flight_risk ? <span className={`status-chip ${r.flight_risk === "high" ? "status-red" : r.flight_risk === "medium" ? "status-amber" : "status-green"}`}>{r.flight_risk}</span> : "—"}</td>
                  {canAct && (
                    <td>
                      {r.coc_trigger ? (
                        <button type="button" className="btn-ghost btn-sm" disabled={pushBusy === r.id}
                          title="이 패키지를 조사내역(dd_finding)으로 등록합니다 — 카테고리 경영진 보상, 가치 영향 = −추정 지급액(백만원)"
                          onClick={() => void pushFinding(r)}>→ 조사내역</button>
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
          <section className="market-section" aria-label="경영진 보상 패키지 기록">
            <h2 className="text-[length:var(--fs-body)] mb-2">경영진 보상 패키지 기록 (ma-04~06 — 익명 참조만)</h2>
            <form className="grid gap-2 md:grid-cols-4" onSubmit={submitPackage}>
              <label className="grid gap-1 text-sm">임원 참조<input className="form-input" value={pkg.executive_ref} onChange={(e) => setPkg({ ...pkg, executive_ref: e.target.value })} placeholder="CEO-01" required /></label>
              <label className="grid gap-1 text-sm">역할<input className="form-input" value={pkg.role_title} onChange={(e) => setPkg({ ...pkg, role_title: e.target.value })} placeholder="대표이사" required /></label>
              <label className="grid gap-1 text-sm">기본급 (원/년)<input className="form-input" inputMode="numeric" value={pkg.base_pay} onChange={(e) => setPkg({ ...pkg, base_pay: e.target.value })} placeholder="300000000" required /></label>
              <label className="grid gap-1 text-sm">이탈 리스크
                <select className="form-input" value={pkg.flight_risk} onChange={(e) => setPkg({ ...pkg, flight_risk: e.target.value })}>
                  <option value="">—</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pkg.coc_trigger} onChange={(e) => setPkg({ ...pkg, coc_trigger: e.target.checked })} /> 지위 변동(CoC) 트리거</label>
              <label className="grid gap-1 text-sm">CoC 추정 지급 (원)<input className="form-input" inputMode="numeric" value={pkg.coc_payout_estimate} onChange={(e) => setPkg({ ...pkg, coc_payout_estimate: e.target.value })} placeholder="600000000" disabled={!pkg.coc_trigger} /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pkg.accelerated_vesting} onChange={(e) => setPkg({ ...pkg, accelerated_vesting: e.target.checked })} /> 가속 베스팅</label>
              <label className="grid gap-1 text-sm">경업금지 (개월)<input className="form-input" inputMode="numeric" value={pkg.non_compete_months} onChange={(e) => setPkg({ ...pkg, non_compete_months: e.target.value })} placeholder="24" /></label>
              <label className="grid gap-1 text-sm md:col-span-3">근거 참조<input className="form-input" value={pkg.evidence_ref} onChange={(e) => setPkg({ ...pkg, evidence_ref: e.target.value })} placeholder="임원 계약서 §7 / 데이터룸 3.2" /></label>
              <button className="btn-ghost btn-sm justify-self-start self-end" type="submit" disabled={pkgBusy}>{pkgBusy ? "기록 중..." : "기록"}</button>
            </form>
            {pkgErr && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1">✕ {pkgErr}</p>}
            <p className="note" style={{ marginBottom: 0 }}>실명은 기록할 수 없습니다 (SEC-05) — 임원 참조는 CEO-01 형식.</p>
          </section>
        )}
        {canAct && (
          <section className="market-section" aria-label="임금 형평 데이터 기록">
            <h2 className="text-[length:var(--fs-body)] mb-2">임금 형평 데이터 기록 (직군 집계 — 사람 확정)</h2>
            <form className="grid gap-2 md:grid-cols-5" onSubmit={submitEntry}>
              <label className="grid gap-1 text-sm">직군<input className="form-input" value={entry.job_family} onChange={(e) => setEntry({ ...entry, job_family: e.target.value })} placeholder="연구개발" required /></label>
              <label className="grid gap-1 text-sm">직급<input className="form-input" value={entry.grade} onChange={(e) => setEntry({ ...entry, grade: e.target.value })} placeholder="과장" required /></label>
              <label className="grid gap-1 text-sm">인원 (≥3)<input className="form-input" inputMode="numeric" value={entry.headcount} onChange={(e) => setEntry({ ...entry, headcount: e.target.value })} placeholder="5" required /></label>
              <label className="grid gap-1 text-sm">피인수 중위 (원/월)<input className="form-input" inputMode="numeric" value={entry.target_median} onChange={(e) => setEntry({ ...entry, target_median: e.target.value })} placeholder="4800000" required /></label>
              <label className="grid gap-1 text-sm">인수 중위 (원/월)<input className="form-input" inputMode="numeric" value={entry.acquirer_median} onChange={(e) => setEntry({ ...entry, acquirer_median: e.target.value })} placeholder="5200000" required /></label>
              <button className="btn-ghost btn-sm justify-self-start" type="submit" disabled={entryBusy}>{entryBusy ? "기록 중..." : "기록"}</button>
            </form>
            {entryErr && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1">✕ {entryErr}</p>}
            {entryMsg && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mt-1">✓ {entryMsg}</p>}
          </section>
        )}

        <section className="market-section" aria-label="임금 형평">
          <h2 className="text-[length:var(--fs-body)] mb-2">임금 형평 (직군 집계)</h2>
          {data === null ? <PageState state="loading" /> : data.parity.length === 0 ? (
            <PageState state="empty" emptyText="등록된 형평 데이터가 없습니다." />
          ) : (
            <table className="data-table" aria-label="임금 형평">
              <thead><tr><th>직군</th><th className="col-num">피인수 중위</th><th className="col-num">인수 중위</th><th className="col-num">격차</th></tr></thead>
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
          <p className="note" style={{ marginBottom: 0 }}>단위: 원/월 · 보상 정책 결정은 PMI 화면으로 이관</p>
        </section>
      </div>
    </main>
  );
}

export default function CompPage() {
  return <Suspense fallback={null}><CompView /></Suspense>;
}
