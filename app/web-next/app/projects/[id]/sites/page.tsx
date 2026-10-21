"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { api } from "../../../../lib/api.ts";
import { ColGroup, PageState, useToast } from "../../../../components/ui.tsx";
import { useConfirm } from "../../../../components/crud.tsx";

// 부지 비교 8열 — 부지명·지역에 여유, 점수 열은 균등하게 좁게.
const SITE_COL_PCT = [16, 13, 10, 10, 10, 12, 11, 10, 8] as const;
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 부지·시설 평가 (site-facility-agent) — Wave 0 REST B4. 점수는 저장값만
// 렌더링하고 순위로 비교한다 (ADR-0112 — 값 발명 금지).
interface Row { id: string; name: string; region_code: string | null; infra_score: number | null; logistics_score: number | null; labor_score: number | null; permit_lead_time_days: number | null; total_score: number | null; rank: number | null }

function SitesView() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", region_code: "", infra_score: "", logistics_score: "", labor_score: "", permit_lead_time_days: "", total_score: "" });
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
        name: form.name.trim(), region_code: form.region_code.trim() || undefined,
        infra_score: n("infra_score"), logistics_score: n("logistics_score"), labor_score: n("labor_score"),
        permit_lead_time_days: n("permit_lead_time_days"), total_score: n("total_score"),
      });
      toast("부지가 등록되었습니다");
      setForm({ name: "", region_code: "", infra_score: "", logistics_score: "", labor_score: "", permit_lead_time_days: "", total_score: "" });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "등록 실패"); }
    finally { setBusy(false); }
  }

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>부지·시설 평가</h1>
      <p className="objective">입지 인프라·물류·노동력 점수와 인허가 리드타임을 비교해 최적 부지를 선정합니다.</p>
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
                    <td className="font-semibold">{r.name}</td>
                    <td>{r.region_code ?? "—"}</td>
                    <td className="col-num tabular-nums">{r.infra_score ?? "—"}</td>
                    <td className="col-num tabular-nums">{r.logistics_score ?? "—"}</td>
                    <td className="col-num tabular-nums">{r.labor_score ?? "—"}</td>
                    <td className="col-num tabular-nums">{r.permit_lead_time_days ?? "—"}</td>
                    <td className="col-num tabular-nums font-semibold">{r.total_score ?? "—"}</td>
                    <td>{r.rank ? <span className="status-chip status-green">#{r.rank}</span> : "—"}</td>
                    <td>{canAct && <button type="button" className="btn-danger btn-sm" onClick={() => remove(r)} title="이 후보를 삭제합니다 — 감사 로그에 기록됩니다">삭제</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {canAct && (
        <section className="market-section" aria-label="부지 등록">
          <h2 className="text-[0.9rem] mb-2">부지 등록</h2>
          <form className="sizing-new-form" onSubmit={create}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">부지명 *</span>
                <input className="sizing-new-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
              <label className="text-[length:var(--fs-caption)]"><span className="block mb-1">지역코드</span>
                <input className="sizing-new-input sizing-new-input-sm" value={form.region_code} onChange={(e) => setForm({ ...form, region_code: e.target.value })} /></label>
              {(["infra_score", "logistics_score", "labor_score", "permit_lead_time_days", "total_score"] as const).map((k) => (
                <label key={k} className="text-[length:var(--fs-caption)] w-[6rem]"><span className="block mb-1">{k === "infra_score" ? "인프라" : k === "logistics_score" ? "물류" : k === "labor_score" ? "노동력" : k === "permit_lead_time_days" ? "인허가(일)" : "총점"}</span>
                  <input type="number" className="sizing-new-input sizing-new-input-sm" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></label>
              ))}
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
