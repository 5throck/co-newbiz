"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ProjectSubNav } from "../../../../components/ProjectSubNav.tsx";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { api } from "../../../../lib/api.ts";

interface LinkRow { id: string; direction: string; from_industry_ko: string; to_industry_ko: string; elasticity: number | null; correlation: number | null; r2: number | null; switching_cost_grade: string | null; substitution_threat: string | null; evidence_ref: string | null }
interface ProxyRow { id: string; from_industry_ko: string; to_industry_ko: string; hop_type: string; coefficient: number | null; beta: number | null; r2: number | null; evidence_ref: string }
interface ChainRow { id: string; reliability_grade: string; grade_rationale: string; hop_ids: string; calibrated_at: string }
interface View { links: LinkRow[]; proxyLinks: ProxyRow[]; chains: ChainRow[] }
function fmt(v: number | null) { return typeof v === "number" ? v.toFixed(2) : "—"; }

export default function ProxyChainPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.get<View>(`/api/projects/${encodeURIComponent(projectId)}/proxy-chain`)
      .then((r) => setView(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "프록시 체인 데이터를 불러오지 못했습니다."));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  return <main className="market-page"><ProjectSubNav projectId={projectId} /><StageFrame stageId="S9" heading="프록시 체인 — 가치사슬 링크와 보정 근거">
    {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem]">✕ {error}</p>}
    {!view ? <p>불러오는 중...</p> : <>
      <section className="market-section sizing-step"><h3 className="sizing-step-title">프로젝트 가치사슬 링크</h3>{view.links.length === 0 ? <p className="text-[color:var(--muted-fg)]">링크가 없습니다.</p> : <table className="data-table"><thead><tr><th>방향</th><th>From → To</th><th>탄력성</th><th>상관</th><th>R²</th><th>전환비용</th><th>대체위협</th></tr></thead><tbody>{view.links.map((r) => <tr key={r.id}><td>{r.direction}</td><td>{r.from_industry_ko} → {r.to_industry_ko}</td><td>{fmt(r.elasticity)}</td><td>{fmt(r.correlation)}</td><td>{fmt(r.r2)}</td><td>{r.switching_cost_grade ?? "—"}</td><td>{r.substitution_threat ?? "—"}</td></tr>)}</tbody></table>}</section>
      <section className="market-section sizing-step mt-3"><h3 className="sizing-step-title">보정된 proxy link</h3>{view.proxyLinks.length === 0 ? <p className="text-[color:var(--muted-fg)]">매칭 proxy link가 없습니다.</p> : <table className="data-table"><thead><tr><th>Hop</th><th>유형</th><th>계수/β</th><th>R²</th><th>근거</th></tr></thead><tbody>{view.proxyLinks.map((r) => <tr key={r.id}><td>{r.from_industry_ko} → {r.to_industry_ko}</td><td>{r.hop_type}</td><td>{fmt(r.coefficient ?? r.beta)}</td><td>{fmt(r.r2)}</td><td>{r.evidence_ref}</td></tr>)}</tbody></table>}</section>
      <section className="market-section sizing-step mt-3"><h3 className="sizing-step-title">Proxy chain grade</h3>{view.chains.length === 0 ? <p className="text-[color:var(--muted-fg)]">체인 등급이 없습니다.</p> : <ul className="sizing-note-list">{view.chains.map((c) => <li key={c.id}><span className="status-chip status-not-started">Grade {c.reliability_grade}</span> {c.grade_rationale} <span className="text-[color:var(--muted-fg)]">({c.calibrated_at.slice(0,10)})</span></li>)}</ul>}</section>
    </>}
  </StageFrame></main>;
}