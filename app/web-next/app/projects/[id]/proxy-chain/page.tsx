"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { useTranslations } from "next-intl";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { api } from "../../../../lib/api.ts";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";
import { ColGroup } from "../../../../components/ui.tsx";

// 가치사슬 링크 7열 / 보정 proxy link 6열 — 숫자·근거 참조가 좁아지지 않도록
// .table-scroll 안에서 고정 비율 유지(tmin-64)한다.
const LINK_COL_PCT = [10, 20, 10, 14, 12, 12, 22] as const;
const PROXY_LINK_COL_PCT = [24, 12, 12, 10, 16, 26] as const;

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

const GRADE_KEY: Record<string, string> = { negligible: "gradeNegligible", low: "gradeLow", moderate: "gradeModerate", high: "gradeHigh", very_high: "gradeVeryHigh" };
const GRADE_CHIP: Record<string, string> = { A: "status-green", B: "status-amber", C: "status-red" };
const fmt = (v: number | null) => (typeof v === "number" ? v.toFixed(2) : "—");

export default function ProxyChainPage() {
  const t = useTranslations("pages.projects.proxyChain");
  const tc = useTranslations("common");
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
      .catch((e) => setError(e instanceof Error ? e.message : t("loadFailed")));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function searchIndustries() {
    try {
      const r = await api.get<{ industries: IndustryRow[] }>(`/api/industries?q=${encodeURIComponent(industryQuery.trim())}`);
      setIndustryResults(r.data.industries);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("searchFailed"));
    }
  }

  async function bind(industryId: string) {
    if (!bindRationale.trim()) {
      setMessage(t("errRationaleRequired"));
      return;
    }
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/industries`, { industry_id: industryId, rationale: bindRationale.trim() });
      setIndustryResults(null);
      setMessage(null);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("bindFailed"));
    }
  }

  async function retire(industryId: string) {
    const rationale = window.prompt(t("retirePrompt"));
    if (!rationale?.trim()) return;
    try {
      await api.delete(`/api/projects/${encodeURIComponent(projectId)}/industries?industry_id=${encodeURIComponent(industryId)}&rationale=${encodeURIComponent(rationale)}`);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("retireFailed"));
    }
  }

  async function createLink() {
    if (!form.from_industry_id || !form.to_industry_id) {
      setMessage(t("errLinkIdsRequired"));
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
      setMessage(t("linkCreated"));
      setForm({ ...form, from_industry_id: "", to_industry_id: "", elasticity: "", lag_months: "", switching_cost_grade: "", substitution_threat: "", evidence_ref: "" });
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("linkCreateFailed"));
    }
  }

  async function runCalibrate() {
    setCalibrating(true);
    setMessage(null);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/proxy-chain/calibrate`, {});
      setMessage(t("calibrateDone"));
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("calibrateFailed"));
    } finally {
      setCalibrating(false);
    }
  }

  return <main className="market-page"><StageTabs projectId={projectId} /><StageFrame stageId="S9" heading={t("heading")}>
    <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">{t("intro")}</p>

    {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
    {message && <p className="text-[length:var(--fs-caption)] text-[color:var(--accent)] mb-2">{message}</p>}

    {/* ① 산업 바인딩 */}
    <section className="market-section sizing-step">
      <h3 className="sizing-step-title">{t("bindingTitle")} <span className="status-chip status-amber">{t("bindingChip")}</span></h3>
      {bindings.length === 0 ? (
        <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{t("noBindings")}</p>
      ) : (
        <table className="data-table">
          <caption className="sr-only">{t("bindingTableCaption")}</caption>
          <thead><tr><th scope="col">{t("colIndustry")}</th><th scope="col">{t("colBindRationale")}</th><th scope="col">{t("colBinder")}</th><th scope="col">{tc("status")}</th><th scope="col"></th></tr></thead>
          <tbody>
            {bindings.map((b) => (
              <tr key={b.id}>
                <td><b>{b.industry_name ?? b.industry_id}</b></td>
                <td className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{b.rationale}</td>
                <td className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{b.bound_by} · {b.bound_at.slice(0, 10)}</td>
                <td><span className="status-chip status-green">{t("liveBindingChip")}</span></td>
                <td>{canAct && <button type="button" className="btn-ghost btn-sm" onClick={() => void retire(b.industry_id)}>{t("retireCta")}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canAct && (
        <>
        <div className="mt-2">
          <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("searchHint")}</span>
          <div className="grid gap-2 md:grid-cols-[1fr_auto] mt-1">
            <input className="sizing-new-input" value={industryQuery} onChange={(e) => setIndustryQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchIndustries(); } }}
              placeholder={t("searchPlaceholder")} aria-label={t("searchAria")} />
            <button type="button" className="btn-ghost btn-sm" onClick={() => void searchIndustries()}>{t("searchCta")}</button>
          </div>
        </div>
        {industryResults !== null && (
          industryResults.length === 0 ? (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">{t("noSearchResults")}</p>
          ) : (
            <div className="border border-[color:var(--border)] rounded-lg mt-2">
              {industryResults.map((ind) => (
                <div key={ind.id} className="flex items-center gap-2 px-2 py-1.5 border-b border-[color:var(--border-subtle)] last:border-b-0 text-[length:var(--fs-caption)]">
                  <b>{ind.name_ko}</b>
                  <span className="font-mono text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">KSIC {ind.ksic_code}</span>
                  <button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => void bind(ind.id)}>{t("bindCta")}</button>
                </div>
              ))}
            </div>
          )
        )}
        <label className="grid gap-1 mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("rationaleLabel")}
          <input className="sizing-new-input" value={bindRationale} onChange={(e) => setBindRationale(e.target.value)} placeholder={t("rationalePlaceholder")} />
        </label>
        </>
      )}
      <p className="note-line">{t("auditNote")}</p>
    </section>

    {/* ② 가치사슬 링크 */}
    <section className="market-section sizing-step mt-3">
      <h3 className="sizing-step-title">{t("linksTitle")} <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">{t("linksSubtitle")}</span></h3>
      {!view || view.links.length === 0 ? (
        <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{t("noLinks")}</p>
      ) : (
        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
        <table className="data-table table-fixed-pct tmin-64">
          <ColGroup widths={LINK_COL_PCT} />
          <caption className="sr-only">{t("linksTableCaption")}</caption>
          <thead><tr><th scope="col">{t("colDirection")}</th><th scope="col">from → to</th><th scope="col" className="num">{t("colElasticity")}</th><th scope="col" className="num">{t("colR2")}</th><th scope="col">{t("colSwitchingCost")}</th><th scope="col">{t("colSubstitution")}</th><th scope="col">{t("colEvidence")}</th></tr></thead>
          <tbody>
            {view.links.map((l) => (
              <tr key={l.id}>
                <td><span className="status-chip status-not-started">{l.direction === "downstream" ? t("directionDownstream") : l.direction === "upstream" ? t("directionUpstream") : l.direction}</span></td>
                <td>{l.from_industry_ko} → {l.to_industry_ko}</td>
                <td className="num mono-num">{fmt(l.elasticity)}</td>
                <td className="num mono-num">{l.r2 != null ? t("r2WithCorrelation", { p1: fmt(l.r2), p2: fmt(l.correlation) }) : "—"}</td>
                <td>{l.switching_cost_grade ? (GRADE_KEY[l.switching_cost_grade] ? t(GRADE_KEY[l.switching_cost_grade]) : l.switching_cost_grade) : "—"}</td>
                <td>{l.substitution_threat ? (GRADE_KEY[l.substitution_threat] ? t(GRADE_KEY[l.substitution_threat]) : l.substitution_threat) : "—"}</td>
                <td className="font-mono text-[length:var(--fs-caption)]">{l.evidence_ref ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {canAct && (
        <div className="mt-2">
          <button type="button" className="btn-ghost btn-sm" onClick={() => setLinkFormOpen((v) => !v)}>
            {linkFormOpen ? t("linkFormClose") : t("linkFormOpen")}
          </button>
          {linkFormOpen && (
          <div className="sizing-new-form grid gap-2 mt-2">
            <div>
              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("lblDirection")}</span>
              <div className="flex gap-3 text-[length:var(--fs-caption)]">
                <label><input type="radio" checked={form.direction === "downstream"} onChange={() => setForm({ ...form, direction: "downstream" })} /> {t("directionDownstream")}</label>
                <label><input type="radio" checked={form.direction === "upstream"} onChange={() => setForm({ ...form, direction: "upstream" })} /> {t("directionUpstream")}</label>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("lblFromIndustry")}
                <input className="sizing-new-input" value={form.from_industry_id} onChange={(e) => setForm({ ...form, from_industry_id: e.target.value })} placeholder={t("phIndustryId")} />
              </label>
              <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("lblToIndustry")}
                <input className="sizing-new-input" value={form.to_industry_id} onChange={(e) => setForm({ ...form, to_industry_id: e.target.value })} placeholder={t("phIndustryId")} />
              </label>
            </div>
            <div className="grid gap-2 md:grid-cols-4">
              <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("colElasticity")}<input className="sizing-new-input" value={form.elasticity} onChange={(e) => setForm({ ...form, elasticity: e.target.value })} placeholder="0.62" /></label>
              <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("lblLagMonths")}<input className="sizing-new-input" value={form.lag_months} onChange={(e) => setForm({ ...form, lag_months: e.target.value })} placeholder="3" /></label>
              <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("lblSwitchingCost")}<input className="sizing-new-input" value={form.switching_cost_grade} onChange={(e) => setForm({ ...form, switching_cost_grade: e.target.value })} placeholder="low|moderate|high" /></label>
              <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("lblSubstitution")}<input className="sizing-new-input" value={form.substitution_threat} onChange={(e) => setForm({ ...form, substitution_threat: e.target.value })} placeholder="negligible|low|moderate…" /></label>
            </div>
            <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("lblEvidenceRef")}
              <input className="sizing-new-input" value={form.evidence_ref} onChange={(e) => setForm({ ...form, evidence_ref: e.target.value })} placeholder="https://…" />
            </label>
            <div><button type="button" className="primary-button" onClick={() => void createLink()}>{t("createLinkCta")}</button></div>
            <p className="note-line">{t("statsNote")}</p>
          </div>
          )}
        </div>
      )}
    </section>

    {/* ③ 보정된 proxy link */}
    <section className="market-section sizing-step mt-3">
      <h3 className="sizing-step-title">{t("calibratedTitle")} <span className="status-chip status-amber">{t("calibratedChip")}</span></h3>
      {!view || view.proxyLinks.length === 0 ? (
        <div>
          <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{t("noCalibratedPre")}<b>{t("calibrateRunName")}</b>{t("noCalibratedPost")}</p>
          <div className="callout-warn mt-2"><b>{t("dataDependencyTitle")}</b>{t("dataDependencyPre")}<b>{t("observedSeries")}</b>{t("dataDependencyPost")}</div>
        </div>
      ) : (
        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
        <table className="data-table table-fixed-pct tmin-56">
          <ColGroup widths={PROXY_LINK_COL_PCT} />
          <caption className="sr-only">{t("hopTableCaption")}</caption>
          <thead><tr><th scope="col">Hop</th><th scope="col">{t("colType")}</th><th scope="col" className="num">{t("colBeta")}</th><th scope="col" className="num">R²</th><th scope="col" className="num">95% CI</th><th scope="col">{t("colEvidence")}</th></tr></thead>
          <tbody>
            {view.proxyLinks.map((p) => (
              <tr key={p.id}>
                <td>{p.from_industry_ko} → {p.to_industry_ko}</td>
                <td><span className="status-chip status-info">{p.hop_type}</span></td>
                <td className="num mono-num">{fmt(p.hop_type === "statistical" ? p.beta : p.coefficient)}</td>
                <td className="num mono-num">{fmt(p.r2)}</td>
                <td className="num mono-num">{p.ci_low != null && p.ci_high != null ? `${fmt(p.ci_low)} – ${fmt(p.ci_high)}` : "—"}</td>
                <td className="font-mono text-[length:var(--fs-caption)]">{p.evidence_ref}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {canAct && (
        <div className="flex gap-2 items-center flex-wrap mt-2">
          <button type="button" className="primary-button" disabled={calibrating} onClick={() => void runCalibrate()}>
            {calibrating ? t("calibrating") : t("calibrateCta")}
          </button>
          <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("calibrateHint")}</span>
        </div>
      )}
    </section>

    {/* ④ 체인 등급 */}
    <section className="market-section sizing-step mt-3">
      <h3 className="sizing-step-title">Proxy chain grade <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">{t("gradeSubtitle")}</span></h3>
      {!view || view.chains.length === 0 ? (
        <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{t("noGrade")}</p>
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
