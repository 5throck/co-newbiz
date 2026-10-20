"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { api } from "../../../../lib/api.ts";
import { PageState, useToast } from "../../../../components/ui.tsx";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 검토/안건 리스크 히트맵 (ADR-0122 #2) — DD 발견사항·고객 집중·인센티브 클로백을
// 하나의 발생가능성 × 영향 그리드로 통합한다. 기존 테이블의 실재 데이터만
// 플로팅한다 (값 발명 금지).
interface Finding { id: string; description: string; value_impact: number | null }
interface Coc { id: string; counterparty: string; concentration_pct: number | null; est_exit_loss: number | null; flagged: number }
interface Inc { id: string; program_name: string | null; clawback_rule: string | null }

interface Item { key: string; label: string; likelihood: 1 | 2 | 3; impact: 1 | 2 | 3; severity: "high" | "mid" | "low" }

function HeatmapView() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 사람 판정 오버라이드 (2026-10-19): likelihood 하드코딩을 보완 — 자동값은 기본값이고
  // 사람이 항목별 가능성·영향을 기록하면 그 값이 우선한다 (분석가+, 감사 기록).
  const [overrides, setOverrides] = useState<Record<string, { likelihood: 1 | 2 | 3; impact: 1 | 2 | 3 }>>({});
  const [drafts, setDrafts] = useState<Record<string, { likelihood: 1 | 2 | 3; impact: 1 | 2 | 3 }>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get<{ findings?: Finding[] }>(`/api/projects/${encodeURIComponent(id)}/dd`),
      api.get<{ contracts: Coc[] }>(`/api/projects/${encodeURIComponent(id)}/customer-coc`),
      api.get<{ incentives: Inc[] }>(`/api/projects/${encodeURIComponent(id)}/incentives`),
    ]).then(([dd, coc, inc]) => {
      if (!alive) return;
      const out: Item[] = [];
      for (const f of dd.data.findings ?? []) {
        const impact = f.value_impact != null && f.value_impact < 0;
        out.push({
          key: `dd:${f.id}`, label: `DD — ${f.description.slice(0, 24)}`,
          likelihood: 2, impact: impact ? 3 : 2,
          severity: impact ? "high" : "mid",
        });
      }
      for (const c of coc.data.contracts ?? []) {
        if (!c.flagged && !c.est_exit_loss) continue;
        out.push({
          key: `coc:${c.id}`, label: `고객 집중 — ${c.counterparty}${c.concentration_pct != null ? ` (${c.concentration_pct}%)` : ""}`,
          likelihood: 2, impact: c.concentration_pct != null && c.concentration_pct >= 30 ? 3 : 2,
          severity: c.concentration_pct != null && c.concentration_pct >= 30 ? "high" : "mid",
        });
      }
      for (const i of inc.data.incentives ?? []) {
        if (!i.clawback_rule) continue;
        out.push({
          key: `inc:${i.id}`, label: `클로백 — ${i.program_name ?? "프로그램"}`,
          likelihood: 2, impact: 2, severity: "mid",
        });
      }
      setItems(out);
    }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : "불러오기 실패"); });
    api.get<{ overrides: Record<string, { likelihood: 1 | 2 | 3; impact: 1 | 2 | 3 }> }>(
      `/api/projects/${encodeURIComponent(id)}/risk-assessment`,
    ).then((r) => { if (alive) setOverrides(r.data.overrides ?? {}); }).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  const effItems = (items ?? []).map((it) => {
    const o = overrides[it.key];
    return o ? { ...it, likelihood: o.likelihood, impact: o.impact } : it;
  });
  const cell = (likelihood: number, impact: number) =>
    effItems.filter((i) => i.likelihood === likelihood && i.impact === impact);

  async function saveAssessment(it: Item, likelihood: 1 | 2 | 3, impact: 1 | 2 | 3) {
    setBusyKey(it.key);
    try {
      await api.put(`/api/projects/${encodeURIComponent(id)}/risk-assessment`, { key: it.key, likelihood, impact });
      setOverrides((cur) => ({ ...cur, [it.key]: { likelihood, impact } }));
      toast("리스크 판정을 기록했습니다 — 감사 로그에 남습니다.");
    } catch (e) {
      toast(e instanceof Error ? `기록 실패: ${e.message}` : "기록 실패");
    } finally {
      setBusyKey(null);
    }
  }

  const pos = (idx: number) => ({ left: `${12 + (idx % 3) * 26}%`, top: `${14 + Math.floor(idx / 2) * 24}%` });
  const color = (sev: string) => (sev === "high" ? "var(--red)" : sev === "mid" ? "var(--amber)" : "var(--green)");

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>검토/안건 리스크 히트맵</h1>
      <p className="objective">DD 발견사항·고객 집중·클로백을 하나의 그리드로 통합해 위험 전망을 봅니다 — 실재 기록만 플로팅합니다.</p>
      {error && <PageState state="error" errorText={error} onRetry={() => window.location.reload()} />}
      <div className="grid2e">
        <section className="market-section" aria-label="리스크 그리드">
          <h2 className="text-[0.9rem] mb-2">그리드 (행 아래쪽 = 가능성 높음 / 오른쪽 = 영향 큼)</h2>
          {items === null ? <PageState state="loading" /> : (
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
          )}
        </section>
        <section className="market-section" aria-label="리스크 목록">
          <h2 className="text-[0.9rem] mb-2">리스크 목록</h2>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="risk-heatmap-caveat">
            ⓘ 가능성·영향은 기록 기준 자동 산정값이 기본이며, 사람이 항목별로 판정을 기록하면 그 값이 우선합니다 (기록은 감사 로그에 남습니다).
          </p>
          {items === null ? <PageState state="loading" /> : effItems.length === 0 ? (
            <PageState state="empty" emptyText="플로팅할 리스크가 없습니다 — DD·계약·인센티브 기록에서 자동 집계됩니다." />
          ) : (
            <ul className="sizing-note-list">
              {effItems.map((it) => {
                const draft = drafts[it.key];
                return (
                  <li key={it.key}>
                    <span className="status-chip" style={{ background: color(it.severity), color: "var(--surface)", marginRight: 6 }}>{it.severity === "high" ? "높음" : it.severity === "mid" ? "중간" : "낮음"}</span>
                    {it.label}
                    {overrides[it.key] && <span className="status-chip status-green ml-1" title="사람 판정 기록됨">판정됨</span>}
                    {canAct && (
                      <span className="actions-row ml-2 align-middle">
                        <select
                          aria-label={`${it.label} 가능성`}
                          className="sizing-new-input sizing-new-input-sm"
                          style={{ width: "6.5rem" }}
                          value={draft?.likelihood ?? it.likelihood}
                          onChange={(e) => setDrafts((cur) => ({ ...cur, [it.key]: { likelihood: Number(e.target.value) as 1 | 2 | 3, impact: cur[it.key]?.impact ?? it.impact } }))}
                        >
                          <option value={1}>가능성 낮음</option>
                          <option value={2}>가능성 중간</option>
                          <option value={3}>가능성 높음</option>
                        </select>
                        <select
                          aria-label={`${it.label} 영향`}
                          className="sizing-new-input sizing-new-input-sm"
                          style={{ width: "6rem" }}
                          value={draft?.impact ?? it.impact}
                          onChange={(e) => setDrafts((cur) => ({ ...cur, [it.key]: { likelihood: cur[it.key]?.likelihood ?? it.likelihood, impact: Number(e.target.value) as 1 | 2 | 3 } }))}
                        >
                          <option value={1}>영향 낮음</option>
                          <option value={2}>영향 중간</option>
                          <option value={3}>영향 높음</option>
                        </select>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={busyKey === it.key}
                          onClick={() => void saveAssessment(it, draft?.likelihood ?? it.likelihood, draft?.impact ?? it.impact)}
                        >
                          {busyKey === it.key ? "기록 중..." : "판정 기록"}
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="note" style={{ marginBottom: 0 }}>스냅샷은 투자심의 자료·분기 브리핑에 첨부 가능 — 완화 판단은 사람 (경계 #2)</p>
        </section>
      </div>
    </main>
  );
}

export default function RiskHeatmapPage() {
  return <Suspense fallback={null}><HeatmapView /></Suspense>;
}
