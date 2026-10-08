"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { api } from "../../../../lib/api.ts";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 가치사슬 연계 탭 — 링크와 보정 근거 (구칭: 프록시 체인) (ADR-0116 Phase 5; approved
// mockup docs/designs/mockups/2026-09-11-proxy-chain-ui-mockup_ko.html).
// 역할 분리: 링크·바인딩 = 분석가 판정(근거 필수) / β·R² 등 통계 수치 =
// calibrate 회귀 산출(수동 입력 불가) / 체인 등급 = 자동 산출.

interface LinkRow { id: string; direction: string; from_industry_ko: string; to_industry_ko: string; from_industry_id: string; to_industry_id: string; elasticity: number | null; correlation: number | null; r2: number | null; switching_cost_grade: string | null; substitution_threat: string | null; evidence_ref: string | null }
interface ProxyRow { id: string; from_industry_ko: string; to_industry_ko: string; hop_type: string; coefficient: number | null; beta: number | null; r2: number | null; ci_low: number | null; ci_high: number | null; evidence_ref: string }
interface ChainRow { id: string; reliability_grade: string; grade_rationale: string; calibrated_at: string }
interface BindingRow { id: string; industry_id: string; industry_name: string | null; bound_by: string; bound_at: string; rationale: string }
interface View { links: LinkRow[]; proxyLinks: ProxyRow[]; chains: ChainRow[] }
interface IndustryRow { id: string; name_ko: string; ksic_code: string }

const GRADE_LABEL: Record<string, string> = { negligible: "극히 낮음", low: "낮음", moderate: "보통", high: "높음", very_high: "매우 높음" };
const GRADE_CHIP: Record<string, string> = { A: "status-green", B: "status-amber", C: "status-red" };
const fmt = (v: number | null) => (typeof v === "number" ? v.toFixed(2) : "—");

export default function ProxyChainPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [view, setView] = useState<View | null>(null);
  const [bindings, setBindings] = useState<BindingRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState(false);

  const [industryQuery, setIndustryQuery] = useState("");
  const [industryResults, setIndustryResults] = useState<IndustryRow[] | null>(null);
  const [bindRationale, setBindRationale] = useState("");
  const [linkFormOpen, setLinkFormOpen] = useState(false);
  const [form, setForm] = useState({ direction: "downstream", from_industry_id: "", to_industry_id: "", elasticity: "", lag_months: "", switching_cost_grade: "", substitution_threat: "", evidence_ref: "" });

  const load = useCallback(() => {
    api.get<{ bindings: BindingRow[] }>(`/api/projects/${encodeURIComponent(projectId)}/industries`)
      .then((r) => setBindings(r.data.bindings))
      .catch(() => setBindings([]));
    api.get<{ links: LinkRow[]; proxyLinks: ProxyRow[]; chains: ChainRow[] }>(`/api/projects/${encodeURIComponent(projectId)}/proxy-chain`)
      .then((r) => setView(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "가치사슬 연계 데이터를 불러오지 못했습니다."));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function searchIndustries() {
    try {
      const r = await api.get<{ industries: IndustryRow[] }>(`/api/industries?q=${encodeURIComponent(industryQuery.trim())}`);
      setIndustryResults(r.data.industries);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "산업 검색에 실패했습니다.");
    }
  }

  async function bind(industryId: string) {
    if (!bindRationale.trim()) {
      setMessage("바인딩 근거(rationale)를 입력하세요.");
      return;
    }
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/industries`, { industry_id: industryId, rationale: bindRationale.trim() });
      setIndustryResults(null);
      setMessage(null);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "바인딩에 실패했습니다.");
    }
  }

  async function retire(industryId: string) {
    const rationale = window.prompt("회수 근거(rationale)를 입력하세요:");
    if (!rationale?.trim()) return;
    try {
      await api.delete(`/api/projects/${encodeURIComponent(projectId)}/industries?industry_id=${encodeURIComponent(industryId)}&rationale=${encodeURIComponent(rationale)}`);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "회수에 실패했습니다.");
    }
  }

  async function createLink() {
    if (!form.from_industry_id || !form.to_industry_id) {
      setMessage("from/to 산업 id를 입력하세요.");
      return;
    }
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/value-chain-links`, {
        direction: form.direction,
        from_industry_id: form.from_industry_id,
        to_industry_id: form.to_industry_id,
        elasticity: form.elasticity ? Number(form.elasticity) : null,
        lag_months: form.lag_months ? Number(form.lag_months) : null,
        switching_cost_grade: form.switching_cost_grade || null,
        substitution_threat: form.substitution_threat || null,
        evidence_ref: form.evidence_ref || null,
      });
      setMessage("링크가 등록되었습니다.");
      setForm({ ...form, from_industry_id: "", to_industry_id: "", elasticity: "", lag_months: "", switching_cost_grade: "", substitution_threat: "", evidence_ref: "" });
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "링크 등록에 실패했습니다.");
    }
  }

  async function runCalibrate() {
    setCalibrating(true);
    setMessage(null);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/proxy-chain/calibrate`, {});
      setMessage("보정이 완료되었습니다.");
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "통계 보정에 실패했습니다.");
    } finally {
      setCalibrating(false);
    }
  }

  return <main className="market-page"><StageTabs projectId={projectId} /><StageFrame stageId="S9" heading="가치사슬 연계 — 링크와 보정 근거">
    <p className="text-[0.82rem] text-[color:var(--muted-fg)] mb-3">사실인가? 위험은 무엇인가? — 분석가 판단(링크·바인딩)과 통계 보정(회귀)을 분리해 관리합니다. 통계 수치(β·R²)는 수동 입력이 불가합니다.</p>

    {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem] mb-2">✕ {error}</p>}
    {message && <p className="text-[0.82rem] text-[color:var(--accent)] mb-2">{message}</p>}

    {/* ① 산업 바인딩 */}
    <section className="market-section sizing-step">
      <h3 className="sizing-step-title">프로젝트 산업 바인딩 <span className="status-chip status-amber">판정 기록 행위 — 근거 필수</span></h3>
      {bindings.length === 0 ? (
        <p className="text-[0.85rem] text-[color:var(--muted-fg)]">바인딩된 산업이 없습니다 — 아래에서 산업을 검색해 바인딩하면 통계 보정 대상이 됩니다.</p>
      ) : (
        <table className="data-table">
          <thead><tr><th scope="col">산업</th><th scope="col">바인딩 근거</th><th scope="col">바인딩자</th><th scope="col">상태</th><th scope="col"></th></tr></thead>
          <tbody>
            {bindings.map((b) => (
              <tr key={b.id}>
                <td><b>{b.industry_name ?? b.industry_id}</b></td>
                <td className="text-[color:var(--muted-fg)] text-[0.8rem]">{b.rationale}</td>
                <td className="text-[color:var(--muted-fg)] text-[0.78rem]">{b.bound_by} · {b.bound_at.slice(0, 10)}</td>
                <td><span className="status-chip status-green">live 바인딩</span></td>
                <td>{canAct && <button type="button" className="btn-ghost btn-sm" onClick={() => void retire(b.industry_id)}>회수</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canAct && (
        <>
        <div className="mt-2">
          <span className="text-[0.78rem] text-[color:var(--muted-fg)]">산업 검색 — md_industry 등록 산업에서 선택</span>
          <div className="grid gap-2 md:grid-cols-[1fr_auto] mt-1">
            <input className="sizing-new-input" value={industryQuery} onChange={(e) => setIndustryQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchIndustries(); } }}
              placeholder="예: 건설기계, 특수차량…" aria-label="산업 검색" />
            <button type="button" className="btn-ghost btn-sm" onClick={() => void searchIndustries()}>검색</button>
          </div>
        </div>
        {industryResults !== null && (
          industryResults.length === 0 ? (
            <p className="text-[0.82rem] text-[color:var(--muted-fg)] mt-1">검색 결과가 없습니다 — 관리자 콘솔 › 마스터 데이터에서 산업을 먼저 등록하세요.</p>
          ) : (
            <div className="border border-[color:var(--border)] rounded-lg mt-2">
              {industryResults.map((ind) => (
                <div key={ind.id} className="flex items-center gap-2 px-2 py-1.5 border-b border-[color:var(--border-subtle)] last:border-b-0 text-[0.84rem]">
                  <b>{ind.name_ko}</b>
                  <span className="font-mono text-[0.74rem] text-[color:var(--muted-fg)]">KSIC {ind.ksic_code}</span>
                  <button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => void bind(ind.id)}>이 산업 바인딩</button>
                </div>
              ))}
            </div>
          )
        )}
        <label className="grid gap-1 mt-2 text-[0.78rem] text-[color:var(--muted-fg)]">바인딩 근거 (rationale) — 필수
          <input className="sizing-new-input" value={bindRationale} onChange={(e) => setBindRationale(e.target.value)} placeholder="예: S6 유니버스 정의 — 수요 전파 검증용" />
        </label>
        </>
      )}
      <p className="note-line">바인딩·회수는 감사 로그에 기록되며, 이력은 유지됩니다.</p>
    </section>

    {/* ② 가치사슬 링크 */}
    <section className="market-section sizing-step mt-3">
      <h3 className="sizing-step-title">프로젝트 가치사슬 링크 <span className="text-[color:var(--muted-fg)] font-normal text-[0.8rem]">— 분석가 판단 등록 (탄력성·전환비용·대체위협)</span></h3>
      {!view || view.links.length === 0 ? (
        <p className="text-[0.85rem] text-[color:var(--muted-fg)]">링크가 없습니다 — 아래 폼에서 분석 근거와 함께 등록하세요.</p>
      ) : (
        <table className="data-table">
          <thead><tr><th scope="col">방향</th><th scope="col">from → to</th><th scope="col" className="num">탄력성</th><th scope="col" className="num">상관(R²)</th><th scope="col">전환비용</th><th scope="col">대체위협</th><th scope="col">근거</th></tr></thead>
          <tbody>
            {view.links.map((l) => (
              <tr key={l.id}>
                <td><span className="status-chip status-not-started">{l.direction}</span></td>
                <td>{l.from_industry_ko} → {l.to_industry_ko}</td>
                <td className="num mono-num">{fmt(l.elasticity)}</td>
                <td className="num mono-num">{l.r2 != null ? `${fmt(l.r2)} (상관 ${fmt(l.correlation)})` : "—"}</td>
                <td>{l.switching_cost_grade ? GRADE_LABEL[l.switching_cost_grade] ?? l.switching_cost_grade : "—"}</td>
                <td>{l.substitution_threat ? GRADE_LABEL[l.substitution_threat] ?? l.substitution_threat : "—"}</td>
                <td className="font-mono text-[0.74rem]">{l.evidence_ref ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canAct && (
        <div className="mt-2">
          <button type="button" className="btn-ghost btn-sm" onClick={() => setLinkFormOpen((v) => !v)}>
            {linkFormOpen ? "링크 등록 폼 닫기" : "+ 링크 등록 폼"}
          </button>
          {linkFormOpen && (
          <div className="sizing-new-form grid gap-2 mt-2">
            <div>
              <span className="text-[0.78rem] text-[color:var(--muted-fg)]">방향</span>
              <div className="flex gap-3 text-[0.84rem]">
                <label><input type="radio" checked={form.direction === "downstream"} onChange={() => setForm({ ...form, direction: "downstream" })} /> downstream (하류 전파)</label>
                <label><input type="radio" checked={form.direction === "upstream"} onChange={() => setForm({ ...form, direction: "upstream" })} /> upstream (상류 전파)</label>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1 text-[0.78rem] text-[color:var(--muted-fg)]">from 산업 id
                <input className="sizing-new-input" value={form.from_industry_id} onChange={(e) => setForm({ ...form, from_industry_id: e.target.value })} placeholder="산업 검색 후 id" />
              </label>
              <label className="grid gap-1 text-[0.78rem] text-[color:var(--muted-fg)]">to 산업 id
                <input className="sizing-new-input" value={form.to_industry_id} onChange={(e) => setForm({ ...form, to_industry_id: e.target.value })} placeholder="산업 검색 후 id" />
              </label>
            </div>
            <div className="grid gap-2 md:grid-cols-4">
              <label className="grid gap-1 text-[0.78rem] text-[color:var(--muted-fg)]">탄력성<input className="sizing-new-input" value={form.elasticity} onChange={(e) => setForm({ ...form, elasticity: e.target.value })} placeholder="0.62" /></label>
              <label className="grid gap-1 text-[0.78rem] text-[color:var(--muted-fg)]">지연(개월)<input className="sizing-new-input" value={form.lag_months} onChange={(e) => setForm({ ...form, lag_months: e.target.value })} placeholder="3" /></label>
              <label className="grid gap-1 text-[0.78rem] text-[color:var(--muted-fg)]">전환비용<input className="sizing-new-input" value={form.switching_cost_grade} onChange={(e) => setForm({ ...form, switching_cost_grade: e.target.value })} placeholder="low|moderate|high" /></label>
              <label className="grid gap-1 text-[0.78rem] text-[color:var(--muted-fg)]">대체위협<input className="sizing-new-input" value={form.substitution_threat} onChange={(e) => setForm({ ...form, substitution_threat: e.target.value })} placeholder="negligible|low|moderate…" /></label>
            </div>
            <label className="grid gap-1 text-[0.78rem] text-[color:var(--muted-fg)]">근거 (evidence_ref — https:// · doc: · src: 필수 형식)
              <input className="sizing-new-input" value={form.evidence_ref} onChange={(e) => setForm({ ...form, evidence_ref: e.target.value })} placeholder="https://…" />
            </label>
            <div><button type="button" className="primary-button" onClick={() => void createLink()}>링크 등록</button></div>
            <p className="note-line">β·R² 등 통계 수치는 이 폼으로 입력할 수 없습니다 — 산출은 보정(calibrate) 회귀로만 이뤄집니다.</p>
          </div>
          )}
        </div>
      )}
    </section>

    {/* ③ 보정된 proxy link */}
    <section className="market-section sizing-step mt-3">
      <h3 className="sizing-step-title">보정된 proxy link <span className="status-chip status-amber">회귀 산출 — 수동 입력 불가</span></h3>
      {!view || view.proxyLinks.length === 0 ? (
        <div>
          <p className="text-[0.85rem] text-[color:var(--muted-fg)]">매칭 proxy link가 없습니다 — 산업 바인딩·링크 등록 후 <b>통계 보정 실행</b>으로 산출합니다.</p>
          <div className="callout-warn mt-2"><b>데이터 의존 안내</b> — 통계 보정에는 바인딩 산업의 <b>관측 시계열</b>이 필요합니다. 시계열 수집 파이프라인(KOSIS·ECOS 어댑터)이 활성화되면 실행이 가능합니다.</div>
        </div>
      ) : (
        <table className="data-table">
          <thead><tr><th scope="col">Hop</th><th scope="col">유형</th><th scope="col" className="num">계수/β</th><th scope="col" className="num">R²</th><th scope="col" className="num">95% CI</th><th scope="col">근거</th></tr></thead>
          <tbody>
            {view.proxyLinks.map((p) => (
              <tr key={p.id}>
                <td>{p.from_industry_ko} → {p.to_industry_ko}</td>
                <td><span className="status-chip status-info">{p.hop_type}</span></td>
                <td className="num mono-num">{fmt(p.hop_type === "statistical" ? p.beta : p.coefficient)}</td>
                <td className="num mono-num">{fmt(p.r2)}</td>
                <td className="num mono-num">{p.ci_low != null && p.ci_high != null ? `${fmt(p.ci_low)} – ${fmt(p.ci_high)}` : "—"}</td>
                <td className="font-mono text-[0.74rem]">{p.evidence_ref}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canAct && (
        <div className="flex gap-2 items-center flex-wrap mt-2">
          <button type="button" className="primary-button" disabled={calibrating} onClick={() => void runCalibrate()}>
            {calibrating ? "보정 실행 중..." : "통계 보정 실행 (calibrate)"}
          </button>
          <span className="text-[color:var(--muted-fg)] text-[0.78rem]">바인딩·링크 산업쌍에 대해 회귀 보정을 실행합니다 — 관측 시계열이 없으면 실행이 거부되고 필요 데이터가 안내됩니다.</span>
        </div>
      )}
    </section>

    {/* ④ 체인 등급 */}
    <section className="market-section sizing-step mt-3">
      <h3 className="sizing-step-title">Proxy chain grade <span className="text-[color:var(--muted-fg)] font-normal text-[0.8rem]">— hop 구성에 따라 자동 산출 (A=공학, B=단일 통계 R²≥0.6, C=그 외)</span></h3>
      {!view || view.chains.length === 0 ? (
        <p className="text-[0.85rem] text-[color:var(--muted-fg)]">체인 등급이 없습니다 — hop 보정 후 자동 산출됩니다.</p>
      ) : (
        <ul className="sizing-note-list">
          {view.chains.map((c) => (
            <li key={c.id}>
              <span className={`status-chip ${GRADE_CHIP[c.reliability_grade] ?? "status-not-started"}`}>Grade {c.reliability_grade}</span>{" "}
              {c.grade_rationale} <span className="text-[color:var(--muted-fg)]">({c.calibrated_at.slice(0, 10)})</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  </StageFrame></main>;
}
