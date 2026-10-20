"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { api } from "../../../../lib/api.ts";
import { PageState, useToast } from "../../../../components/ui.tsx";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 검토/안건 리스크 히트맵 (ADR-0122 #2) — DD 발견사항·고객 집중·인센티브 클로백·
// 커버넌트 여력을 하나의 발생가능성 × 영향 그리드로 통합한다. 2026-10-21부터
// 집계는 서버(lib/risk-heatmap.ts, GET /risk-heatmap)가 수행하고 같은 스냅샷이
// 투자심의 자료·모니터링 브리프에 첨부된다. 기존 테이블의 실재 데이터만
// 플로팅한다 (값 발명 금지).
type Level = 1 | 2 | 3;
interface Item {
  key: string; source: "dd" | "coc" | "inc" | "cov"; label: string;
  likelihood: Level; impact: Level; severity: "high" | "mid" | "low";
  auto: { likelihood: Level; impact: Level }; assessed: boolean; assessed_at: string | null; mitigation: string | null;
}
interface Heatmap {
  items: Item[]; grid: number[][]; counts: { high: number; mid: number; low: number };
  sources: { dd: number; coc: number; inc: number; cov: number }; assessed_at: string | null;
  covenant_status: "computed" | "insufficient_evidence"; snapshot_hash: string;
}

const SOURCE_LABEL: Record<Item["source"], string> = { dd: "DD", coc: "고객 CoC", inc: "클로백", cov: "커버넌트" };

function HeatmapView() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [heatmap, setHeatmap] = useState<Heatmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 사람 판정 (2026-10-19): likelihood 하드코딩을 보완 — 자동값은 기본값이고 사람이
  // 항목별 가능성·영향(+완화조치, 2026-10-21 원장)을 기록하면 그 값이 우선한다.
  const [drafts, setDrafts] = useState<Record<string, { likelihood: Level; impact: Level; mitigation: string }>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<Heatmap>(`/api/projects/${encodeURIComponent(id)}/risk-heatmap`)
      .then((r) => setHeatmap(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const items = heatmap?.items ?? [];
  const cell = (likelihood: number, impact: number) => items.filter((i) => i.likelihood === likelihood && i.impact === impact);

  async function saveAssessment(it: Item) {
    const d = drafts[it.key];
    const likelihood = d?.likelihood ?? it.likelihood;
    const impact = d?.impact ?? it.impact;
    const mitigation = (d?.mitigation ?? it.mitigation ?? "").trim();
    setBusyKey(it.key);
    try {
      await api.put(`/api/projects/${encodeURIComponent(id)}/risk-assessment`, { key: it.key, likelihood, impact, mitigation: mitigation || null });
      toast("리스크 판정을 원장에 기록했습니다 — 감사 로그에 남고 투자심의 자료 스냅샷에 반영됩니다.");
      setDrafts((cur) => { const next = { ...cur }; delete next[it.key]; return next; });
      load();
    } catch (e) {
      toast(e instanceof Error ? `기록 실패: ${e.message}` : "기록 실패");
    } finally {
      setBusyKey(null);
    }
  }

  const draftOf = (it: Item) => drafts[it.key] ?? { likelihood: it.likelihood, impact: it.impact, mitigation: it.mitigation ?? "" };
  const color = (sev: string) => (sev === "high" ? "var(--red)" : sev === "mid" ? "var(--amber)" : "var(--green)");

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>검토/안건 리스크 히트맵</h1>
      <p className="objective">DD 발견사항·고객 집중·클로백·커버넌트 여력을 하나의 그리드로 통합해 위험 전망을 봅니다 — 실재 기록만 플로팅합니다.</p>
      {error && <PageState state="error" errorText={error} onRetry={() => window.location.reload()} />}
      <div className="grid2e">
        <section className="market-section" aria-label="리스크 그리드">
          <h2 className="text-[0.9rem] mb-2">그리드 (행 아래쪽 = 가능성 높음 / 오른쪽 = 영향 큼)</h2>
          {heatmap === null ? <PageState state="loading" /> : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                {[...Array(9)].map((_, idx) => {
                  const likelihood = 3 - Math.floor(idx / 3);
                  const impact = (idx % 3) + 1;
                  const cellItems = cell(likelihood, impact);
                  return (
                    <div key={idx} style={{ minHeight: 74, border: "1px solid var(--border)", borderRadius: 8, position: "relative", background: "var(--surface)" }}>
                      <span className="note" style={{ position: "absolute", right: 5, bottom: 3, fontSize: "var(--fs-caption)" }}>
                        {["영향 낮음", "영향 중간", "영향 높음"][impact - 1]}
                      </span>
                      {cellItems.map((it, i) => (
                        <span key={it.key} title={it.label}
                          style={{ position: "absolute", width: 24, height: 24, borderRadius: "50%",
                            background: color(it.severity), color: "var(--surface)", fontSize: "var(--fs-caption)", fontWeight: 700,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            left: `${10 + i * 30}%`, top: "18%" }}>{i + 1}</span>
                      ))}
                    </div>
                  );
                })}
              </div>
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2" data-testid="risk-heatmap-snapshot">
                스냅샷 <code className="dd-item-id">{heatmap.snapshot_hash}</code> · 높음 {heatmap.counts.high} / 중간 {heatmap.counts.mid} / 낮음 {heatmap.counts.low}
                {" · "}출처 DD {heatmap.sources.dd} · 고객 CoC {heatmap.sources.coc} · 클로백 {heatmap.sources.inc} · 커버넌트 {heatmap.sources.cov}
                {heatmap.covenant_status === "insufficient_evidence" && <> · <span title="시뮬레이션의 커버넌트 테스트가 없어 커버넌트 항목은 플로팅되지 않았습니다">커버넌트 여력 근거 부족</span></>}
              </p>
            </>
          )}
        </section>
        <section className="market-section" aria-label="리스크 목록">
          <h2 className="text-[0.9rem] mb-2">리스크 목록 · 판정 원장</h2>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="risk-heatmap-caveat">
            ⓘ 가능성·영향은 기록 기준 자동 산정값이 기본이며, 사람이 항목별로 판정(과 완화조치)을 기록하면 그 값이 우선합니다 — 기록은 원장에 쌓이고 감사 로그에 남습니다.
          </p>
          {heatmap === null ? <PageState state="loading" /> : items.length === 0 ? (
            <PageState state="empty" emptyText="플로팅할 리스크가 없습니다 — DD·계약·인센티브·부채 시뮬레이션 기록에서 자동 집계됩니다." />
          ) : (
            <ul className="sizing-note-list">
              {items.map((it) => {
                const d = draftOf(it);
                return (
                  <li key={it.key}>
                    <span className="status-chip" style={{ background: color(it.severity), color: "var(--surface)", marginRight: 6 }}>{it.severity === "high" ? "높음" : it.severity === "mid" ? "중간" : "낮음"}</span>
                    <span className="status-chip status-gray mr-1">{SOURCE_LABEL[it.source]}</span>
                    {it.label}
                    {it.assessed && <span className="status-chip status-green ml-1" title={`사람 판정 기록됨${it.assessed_at ? ` (${it.assessed_at.slice(0, 10)})` : ""} — 자동값 ${it.auto.likelihood}×${it.auto.impact}`}>판정됨</span>}
                    {it.mitigation && !canAct && <span className="note block ml-1">완화: {it.mitigation}</span>}
                    {canAct && (
                      <span className="actions-row ml-2 align-middle flex flex-wrap gap-1 items-center">
                        <select aria-label={`${it.label} 가능성`} className="sizing-new-input sizing-new-input-sm" style={{ width: "6.5rem" }}
                          value={d.likelihood}
                          onChange={(e) => setDrafts((cur) => ({ ...cur, [it.key]: { ...draftOf(it), ...cur[it.key], likelihood: Number(e.target.value) as Level } }))}>
                          <option value={1}>가능성 낮음</option><option value={2}>가능성 중간</option><option value={3}>가능성 높음</option>
                        </select>
                        <select aria-label={`${it.label} 영향`} className="sizing-new-input sizing-new-input-sm" style={{ width: "6rem" }}
                          value={d.impact}
                          onChange={(e) => setDrafts((cur) => ({ ...cur, [it.key]: { ...draftOf(it), ...cur[it.key], impact: Number(e.target.value) as Level } }))}>
                          <option value={1}>영향 낮음</option><option value={2}>영향 중간</option><option value={3}>영향 높음</option>
                        </select>
                        <input aria-label={`${it.label} 완화조치`} className="sizing-new-input sizing-new-input-sm" style={{ minWidth: "12rem", flex: 1 }}
                          placeholder="완화조치 (선택)" maxLength={1000} value={d.mitigation}
                          onChange={(e) => setDrafts((cur) => ({ ...cur, [it.key]: { ...draftOf(it), ...cur[it.key], mitigation: e.target.value } }))} />
                        <button type="button" className="btn-ghost btn-sm" disabled={busyKey === it.key} onClick={() => void saveAssessment(it)}>
                          {busyKey === it.key ? "기록 중..." : "판정 기록"}
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="note" style={{ marginBottom: 0 }}>스냅샷은 투자심의 자료·분기 모니터링 브리프에 자동 첨부됩니다 — 완화 판단은 사람 (경계 #2)</p>
        </section>
      </div>
    </main>
  );
}

export default function RiskHeatmapPage() {
  return <Suspense fallback={null}><HeatmapView /></Suspense>;
}
