"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { useTranslations } from "next-intl";
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

// 데이터 프로토콜 값(저장 카테고리·기록 본문) — UI 문자열이 아니므로 카탈로그로 옮기지 않는다.
const TRI_CATEGORY = "인터뷰 삼각검증";

function InterviewsView() {
  const t = useTranslations("pages.projects.interviews");
  const tc = useTranslations("common");
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
      .catch((e) => setError(e instanceof Error ? e.message : tc("errors.loadFailed")));
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
      toast(t("created"));
      setForm({ interviewee: "", topic: "", claim: "", response_summary: "", disagreement: "", follow_up: "", evidence_ref: "" });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : tc("errors.createFailed")); }
    finally { setBusy(false); }
  }

  async function pushClaim(c: ClaimTri) {
    setPushBusy(c.claim);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/dd/findings`, {
        category: TRI_CATEGORY,
        description: `[cdd-07] ${c.claim} — 독립 출처 ${c.independent_sources}개(인터뷰 ${c.interview_count}건)로 삼각검증됨`,
        value_impact: null,
        evidence_ref: c.evidence_refs.slice(0, 3).join(", ") || `interviews:${c.claim}`,
      });
      toast(t("pushDone"));
    } catch (e) {
      toast(e instanceof Error ? t("pushFailedWith", { message: e.message }) : tc("errors.createFailed"));
    } finally {
      setPushBusy(null);
    }
  }

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>{t("heading")}</h1>
      <p className="objective">{t("objective")}</p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <section className="market-section" aria-label={t("triSectionAria")} data-testid="interview-triangulation">
        <h2 className="text-[length:var(--fs-body)] mb-2">{t("triHeading")}</h2>
        {tri === null ? <PageState state="loading" /> : tri.claims.length === 0 ? (
          <PageState state="empty" emptyText={t("triEmpty", { suffix: tri.unclaimed > 0 ? t("triEmptySuffix", { count: tri.unclaimed }) : "" })} />
        ) : (
          <>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              {t("triSummary", { done: tri.triangulated_count, pending: tri.pending_count, unclaimed: tri.unclaimed > 0 ? t("triUnclaimedSuffix", { count: tri.unclaimed }) : "" })}
            </p>
            <ul className="sizing-note-list">
              {tri.claims.map((c) => (
                <li key={c.claim}>
                  <span className={`status-chip ${c.triangulated ? "status-green" : "status-amber"}`}>{c.triangulated ? t("chipTriangulated") : t("chipSources", { n: c.independent_sources })}</span>
                  {" "}{c.claim}
                  <span className="note ml-1">{t("claimMeta", { count: c.interview_count, sources: c.independent_sources })}</span>
                  {canAct && c.triangulated && (
                    <button type="button" className="btn-ghost btn-sm ml-2" disabled={pushBusy === c.claim}
                      title={t("pushBtnTitle")}
                      onClick={() => void pushClaim(c)}>{t("pushBtn")}</button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="market-section" aria-label={t("listSectionAria")}>
        {rows === null ? <PageState state="loading" /> : rows.length === 0 ? (
          <PageState state="empty" emptyText={t("empty")} />
        ) : (
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-56" aria-label={t("tableAria")}>
              <caption className="sr-only">{t("tableAria")}</caption>
              <ColGroup widths={INTERVIEW_COL_PCT} />
              <thead><tr><th>{t("thInterviewee")}</th><th>{t("thTopic")}</th><th>{t("thClaim")}</th><th>{t("thResponse")}</th><th>{t("thDisagreement")}</th><th>{t("thFollowUp")}</th><th>{t("thEvidence")}</th></tr></thead>
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
        <section className="market-section" aria-label={t("listSectionAria")}>
          <h2 className="text-[length:var(--fs-body)] mb-2">{t("listSectionAria")}</h2>
          <form className="sizing-new-form" onSubmit={create}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[10rem]"><span className="block mb-1">{t("lblInterviewee")}</span>
                <input className="sizing-new-input w-full" value={form.interviewee} onChange={(e) => setForm({ ...form, interviewee: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[10rem]"><span className="block mb-1">{t("lblTopic")}</span>
                <input className="sizing-new-input w-full" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[12rem]"><span className="block mb-1">{t("lblClaim")}</span>
                <input className="sizing-new-input w-full" value={form.claim} onChange={(e) => setForm({ ...form, claim: e.target.value })} placeholder={t("phClaim")} maxLength={300} /></label>
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[14rem]"><span className="block mb-1">{t("lblResponse")}</span>
                <input className="sizing-new-input w-full" value={form.response_summary} onChange={(e) => setForm({ ...form, response_summary: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[10rem]"><span className="block mb-1">{t("lblEvidence")}</span>
                <input className="sizing-new-input w-full" value={form.evidence_ref} onChange={(e) => setForm({ ...form, evidence_ref: e.target.value })} required placeholder="interview-log#1" /></label>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? tc("recording") : t("recordBtn")}</button>
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
