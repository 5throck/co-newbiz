"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { api } from "../../../../lib/api.ts";
import { ColGroup, PageState, useToast } from "../../../../components/ui.tsx";

// 인터뷰 7열 — 응답 요지·후속 확인 텍스트에 여유, 증적 참조는 좁게.
const INTERVIEW_COL_PCT = [12, 12, 16, 24, 14, 14, 8] as const;
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 전문가 인터뷰·채널 체크 (commercial-dd-agent) — Wave 0 REST B7.
// 증적 참조가 필수이고 주제별 합의/엇갈림 롤업을 제공한다.
// 2026-10-21: `claim`(핵심 주장)으로 cdd-07 삼각검증(주장당 독립 출처 2~3개)을
// 집계한다 — 판정 자체는 체크리스트에서 사람이 한다.
interface Row { id: string; interviewee: string; topic: string; response_summary: string; disagreement: string | null; follow_up: string | null; evidence_ref: string; claim: string | null }
interface ClaimTri { claim: string; interview_count: number; independent_sources: number; evidence_refs: string[]; triangulated: boolean }
interface Triangulation { claims: ClaimTri[]; unclaimed: number; triangulated_count: number; pending_count: number }

function InterviewsView() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [tri, setTri] = useState<Triangulation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ interviewee: "", topic: "", claim: "", response_summary: "", disagreement: "", follow_up: "", evidence_ref: "" });
  const [busy, setBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<{ interviews: Row[]; triangulation: Triangulation }>(`/api/projects/${encodeURIComponent(id)}/interviews`)
      .then((r) => { setRows(r.data.interviews); setTri(r.data.triangulation); })
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/interviews`, {
        interviewee: form.interviewee.trim(), topic: form.topic.trim(), claim: form.claim.trim() || undefined,
        response_summary: form.response_summary.trim(), evidence_ref: form.evidence_ref.trim(),
        disagreement: form.disagreement.trim() || undefined, follow_up: form.follow_up.trim() || undefined,
      });
      toast("인터뷰가 기록되었습니다");
      setForm({ interviewee: "", topic: "", claim: "", response_summary: "", disagreement: "", follow_up: "", evidence_ref: "" });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "등록 실패"); }
    finally { setBusy(false); }
  }

  async function pushClaim(c: ClaimTri) {
    setPushBusy(c.claim);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/dd/findings`, {
        category: "인터뷰 삼각검증",
        description: `[cdd-07] ${c.claim} — 독립 출처 ${c.independent_sources}개(인터뷰 ${c.interview_count}건)로 삼각검증됨`,
        value_impact: null,
        evidence_ref: c.evidence_refs.slice(0, 3).join(", ") || `interviews:${c.claim}`,
      });
      toast("조사내역(dd_finding)으로 등록했습니다 — cdd-07 판정 근거로 S9 조사내역 탭에 반영됩니다.");
    } catch (e) {
      toast(e instanceof Error ? `등록 실패: ${e.message}` : "등록 실패");
    } finally {
      setPushBusy(null);
    }
  }

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>전문가 인터뷰·채널 체크</h1>
      <p className="objective">CDD 증적(인터뷰·채널 확인)을 기록합니다 — 증적 참조가 필수이며 주제별 합의·엇갈림이 롤업되고, 핵심 주장별 삼각검증(cdd-07)이 집계됩니다.</p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <section className="market-section" aria-label="삼각검증 요약" data-testid="interview-triangulation">
        <h2 className="text-[0.9rem] mb-2">삼각검증 (cdd-07 — 주장당 독립 출처 2개 이상)</h2>
        {tri === null ? <PageState state="loading" /> : tri.claims.length === 0 ? (
          <PageState state="empty" emptyText={`핵심 주장이 기록된 인터뷰가 없습니다${tri.unclaimed > 0 ? ` — 주장 미지정 ${tri.unclaimed}건은 집계되지 않습니다` : ""}.`} />
        ) : (
          <>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              삼각검증 {tri.triangulated_count}건 / 미충족 {tri.pending_count}건{tri.unclaimed > 0 ? ` · 주장 미지정 인터뷰 ${tri.unclaimed}건` : ""} — 판정은 실사 워크스페이스 cdd-07에서 사람이 기록합니다.
            </p>
            <ul className="sizing-note-list">
              {tri.claims.map((c) => (
                <li key={c.claim}>
                  <span className={`status-chip ${c.triangulated ? "status-green" : "status-amber"}`}>{c.triangulated ? "삼각검증" : `출처 ${c.independent_sources}/2`}</span>
                  {" "}{c.claim}
                  <span className="note ml-1">(인터뷰 {c.interview_count}건 · 독립 출처 {c.independent_sources}명)</span>
                  {canAct && c.triangulated && (
                    <button type="button" className="btn-ghost btn-sm ml-2" disabled={pushBusy === c.claim}
                      title="삼각검증된 주장을 조사내역(dd_finding)으로 등록합니다 — 카테고리 인터뷰 삼각검증"
                      onClick={() => void pushClaim(c)}>→ 조사내역</button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="market-section" aria-label="인터뷰 기록">
        {rows === null ? <PageState state="loading" /> : rows.length === 0 ? (
          <PageState state="empty" emptyText="기록된 인터뷰가 없습니다." />
        ) : (
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-56" aria-label="인터뷰">
              <caption className="sr-only">인터뷰</caption>
              <ColGroup widths={INTERVIEW_COL_PCT} />
              <thead><tr><th>대상</th><th>주제</th><th>핵심 주장</th><th>응답 요지</th><th>엇갈림</th><th>후속 확인</th><th>증적</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.interviewee}</td>
                  <td>{r.topic}</td>
                  <td className="text-[length:var(--fs-caption)]">{r.claim ?? <span className="note">—</span>}</td>
                  <td className="text-[length:var(--fs-caption)]">{r.response_summary}</td>
                  <td className="text-[length:var(--fs-caption)]">{r.disagreement ?? "—"}</td>
                  <td className="text-[length:var(--fs-caption)]">{r.follow_up ?? "—"}</td>
                  <td className="text-[length:var(--fs-caption)]"><code className="dd-item-id">{r.evidence_ref}</code></td>
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
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[10rem]"><span className="block mb-1">대상 *</span>
                <input className="sizing-new-input w-full" value={form.interviewee} onChange={(e) => setForm({ ...form, interviewee: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[10rem]"><span className="block mb-1">주제 *</span>
                <input className="sizing-new-input w-full" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[12rem]"><span className="block mb-1">핵심 주장 (삼각검증 단위)</span>
                <input className="sizing-new-input w-full" value={form.claim} onChange={(e) => setForm({ ...form, claim: e.target.value })} placeholder="상위 고객 이탈 위험 낮음" maxLength={300} /></label>
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[14rem]"><span className="block mb-1">응답 요지 *</span>
                <input className="sizing-new-input w-full" value={form.response_summary} onChange={(e) => setForm({ ...form, response_summary: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[10rem]"><span className="block mb-1">증적 *</span>
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
