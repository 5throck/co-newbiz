"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { api } from "../../../../lib/api.ts";
import Link from "next/link";
import { ColGroup, PageState, useToast } from "../../../../components/ui.tsx";
import { useConfirm } from "../../../../components/crud.tsx";

// 부지 비교 8열 — 부지명·지역에 여유, 점수 열은 균등하게 좁게.
const SITE_COL_PCT = [16, 13, 10, 10, 10, 12, 11, 10, 8] as const;
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 부지·시설 평가 (site-facility-agent) — Wave 0 REST B4. 점수는 저장값만
// 렌더링하고 순위로 비교한다 (ADR-0112 — 값 발명 금지).
interface Row { id: string; name: string; region_code: string | null; infra_score: number | null; logistics_score: number | null; labor_score: number | null; permit_lead_time_days: number | null; total_score: number | null; rank: number | null; address: string | null; infra_notes: string | null; labor_notes: string | null }

function SitesView() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", address: "", region_code: "", infra_score: "", logistics_score: "", labor_score: "", permit_lead_time_days: "", total_score: "", infra_notes: "", labor_notes: "" });
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  // 2026-10-21 lifecycle — 후보 삭제 (잘못 입력한 행이 영구 잔존하지 않도록).
  function remove(r: Row) {
    confirm("부지 후보 삭제", () => {
      void (async () => {
        try {
          await api.delete(`/api/projects/${encodeURIComponent(id)}/sites?id=${encodeURIComponent(r.id)}`);
          toast("삭제했습니다 — 감사 로그에 남습니다.");
          load();
        } catch (e) { toast(e instanceof Error ? `삭제 실패: ${e.message}` : "삭제 실패"); }
      })();
    }, { body: `"${r.name}" 후보를 삭제합니다. 삭제는 감사 로그에 기록됩니다.`, confirmLabel: "삭제" });
  }

  const [draft, setDraft] = useState<{ siteId: string; siteName: string; source: string; note: string; synthesis: string; items: Array<{ area: string; issue: string; check: string }>; cautions: string[] } | null>(null);
  const [draftBusy, setDraftBusy] = useState<string | null>(null);

  // 법규 사전검토 초안 (k-law 관점 LLM — 제안 전용, 저장 없음; 최종 확인은 사람+k-law 원문)
  async function regulatoryDraft(r: Row) {
    if (draftBusy) return;
    setDraftBusy(r.id);
    try {
      const res = await api.post<{ siteId: string; siteName: string; source: string; note: string; draft: { synthesis: string; items: Array<{ area: string; issue: string; check: string }>; cautions: string[] } }>(
        `/api/projects/${encodeURIComponent(id)}/sites/regulatory-draft`, { site_id: r.id },
      );
      setDraft({ siteId: r.id, siteName: r.name, source: res.data.source, note: res.data.note, ...res.data.draft });
      toast(res.data.source === "llm" ? "법규 사전검토 초안을 받았습니다 — k-law 원문 확인 후 확정하세요." : "LLM 미구성 — 결정론 폴백(축 나열)입니다.");
    } catch (e) {
      toast(e instanceof Error ? `초안 생성 실패: ${e.message}` : "초안 생성 실패");
    } finally {
      setDraftBusy(null);
    }
  }

  const load = useCallback(() => {
    api.get<{ sites: Row[] }>(`/api/projects/${encodeURIComponent(id)}/sites`)
      .then((r) => setRows(r.data.sites))
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || busy) return;
    setBusy(true);
    try {
      const n = (k: string) => (form[k as keyof typeof form] ? Number(form[k as keyof typeof form]) : undefined);
      await api.post(`/api/projects/${encodeURIComponent(id)}/sites`, {
        name: form.name.trim(), address: form.address.trim() || undefined, region_code: form.region_code.trim() || undefined,
        infra_notes: form.infra_notes.trim() || undefined, labor_notes: form.labor_notes.trim() || undefined,
        infra_score: n("infra_score"), logistics_score: n("logistics_score"), labor_score: n("labor_score"),
        permit_lead_time_days: n("permit_lead_time_days"), total_score: n("total_score"),
      });
      toast("부지가 등록되었습니다");
      setForm({ name: "", address: "", region_code: "", infra_score: "", logistics_score: "", labor_score: "", permit_lead_time_days: "", total_score: "", infra_notes: "", labor_notes: "" });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "등록 실패"); }
    finally { setBusy(false); }
  }

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>부지·시설 평가</h1>
      <p className="objective">입지 인프라·물류·노동력 점수와 인허가 리드타임을 비교해 최적 부지를 선정합니다 — 주소를 등록하면 건축법·인허가 법규 사전검토 초안(k-law 관점 LLM, 제안 전용)을 받을 수 있습니다. <Link href={`/projects/${encodeURIComponent(id)}/permits`} className="underline">인허가·인증 추적 →</Link></p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <section className="market-section" aria-label="부지 비교">
        {rows === null ? <PageState state="loading" /> : rows.length === 0 ? (
          <PageState state="empty" emptyText="등록된 부지가 없습니다." />
        ) : (
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-56" aria-label="부지 비교">
              <caption className="sr-only">부지 비교</caption>
              <ColGroup widths={SITE_COL_PCT} />
              <thead><tr><th>부지</th><th>지역</th><th className="col-num">인프라</th><th className="col-num">물류</th><th className="col-num">노동력</th><th className="col-num">인허가(일)</th><th className="col-num">총점</th><th>순위</th><th>관리</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.name}{r.address && <div className="note" title={r.address}>{r.address}</div>}</td>
                    <td>{r.region_code ?? "—"}</td>
                    <td className="col-num tabular-nums">{r.infra_score ?? "—"}</td>
                    <td className="col-num tabular-nums">{r.logistics_score ?? "—"}</td>
                    <td className="col-num tabular-nums">{r.labor_score ?? "—"}</td>
                    <td className="col-num tabular-nums">{r.permit_lead_time_days ?? "—"}</td>
                    <td className="col-num tabular-nums font-semibold">{r.total_score ?? "—"}</td>
                    <td>{r.rank ? <span className="status-chip status-green">#{r.rank}</span> : "—"}</td>
                    <td>{canAct && <button type="button" className="btn-ghost btn-sm mb-1" disabled={draftBusy === r.id}
                        title="이 부지의 주소·용도를 근거로 건축법·인허가 법규 사전검토 초안을 생성합니다 (k-law 관점, 저장 없음)"
                        onClick={() => void regulatoryDraft(r)}>{draftBusy === r.id ? "초안 생성 중..." : "⚖ 법규 초안"}</button>}
                      {canAct && <button type="button" className="btn-danger btn-sm" onClick={() => remove(r)} title="이 후보를 삭제합니다 — 감사 로그에 기록됩니다">삭제</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {draft && (
        <section className="market-section" aria-label="법규 사전검토 초안" data-testid="site-regulatory-draft">
          <h2 className="text-[0.9rem] mb-2">법규 사전검토 초안 — {draft.siteName} <span className={`status-chip ${draft.source === "llm" ? "status-amber" : "status-gray"}`}>{draft.source === "llm" ? "LLM 초안" : "결정론 폴백"}</span></h2>
          <p className="text-[length:var(--fs-caption)]">{draft.synthesis}</p>
          <ul className="sizing-note-list mt-1">
            {draft.items.map((it, i) => (
              <li key={i}><strong>[{it.area}]</strong> {it.issue}<span className="block text-[color:var(--muted-fg)]">확인: {it.check}</span></li>
            ))}
          </ul>
          {draft.cautions.length > 0 && <p className="note">주의: {draft.cautions.join(" · ")}</p>}
          <p className="note" style={{ marginBottom: 0 }}>제안 전용 — 법령 원문은 k-law 확인, 최종 판단은 법무 담당자 (경계 #2). 저장되지 않습니다 — 필요 시 조사내역에 기록하세요.</p>
        </section>
      )}
      {canAct && (
        <section className="market-section" aria-label="부지 등록">
          <h2 className="text-[0.9rem] mb-2">부지 등록</h2>
          <form className="sizing-new-form" onSubmit={create}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">부지명 *</span>
                <input className="sizing-new-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[16rem]"><span className="block mb-1">주소 (법규 검토 근거)</span>
                <input className="sizing-new-input w-full" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="예: 충북 청주시 청원구 OOO 123" /></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">지역코드</span>
                <input className="sizing-new-input sizing-new-input-sm" value={form.region_code} onChange={(e) => setForm({ ...form, region_code: e.target.value })} /></label>
              {(["infra_score", "logistics_score", "labor_score", "permit_lead_time_days", "total_score"] as const).map((k) => (
                <label key={k} className="text-[length:var(--fs-caption)] w-[6rem]"><span className="block mb-1">{k === "infra_score" ? "인프라" : k === "logistics_score" ? "물류" : k === "labor_score" ? "노동력" : k === "permit_lead_time_days" ? "인허가(일)" : "총점"}</span>
                  <input type="number" className="sizing-new-input sizing-new-input-sm" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></label>
              ))}
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[24rem]"><span className="block mb-1">인프라 확인 메모 (상하수도·전기·도로·물류 — 사람 확인 값)</span>
                <input className="sizing-new-input w-full" value={form.infra_notes} onChange={(e) => setForm({ ...form, infra_notes: e.target.value })} placeholder="예: 상수도 관로 인접, 22.9kV 전력 신설 필요" /></label>
              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[24rem]"><span className="block mb-1">인력 확인 메모 (주변 학교·인력pool)</span>
                <input className="sizing-new-input w-full" value={form.labor_notes} onChange={(e) => setForm({ ...form, labor_notes: e.target.value })} placeholder="예: 반경 5km 내 공대 2곳, 생산 인력 확보 양호" /></label>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? "등록 중..." : "등록"}</button>
            </div>
          </form>
        </section>
      )}
      {confirmDialog}
    </main>
  );
}

export default function SitesPage() {
  return <Suspense fallback={null}><SitesView /></Suspense>;
}
