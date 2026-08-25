import { useCallback, useEffect, useState } from "react";
// (marketApi already imported above) from "../api.ts";
import {
  marketApi,
  type ChainTopologyResponse,
  type RunSummaryRow,
  type StageFinancialRow,
  type StructureSimQuantileRow,
} from "../api.ts";

// 시장·체인 (Market & Chain) tab — ADR-0066 Phase D. Three sections:
//   1) 체인 구조 — layered upstream→end-market graph from value_chain_link
//   2) 단계별 재무 — per-node 5-year series from fact_industry
//   3) 구조 시뮬레이션 — driver deltas (drv.*) propagated through elasticity/
//      pass-through, quantiles P05/P50/P95 per node/metric.
// Money-adjacent outputs are engine-native units; deltas are % / %p.

const METRIC_KO: Record<string, string> = {
  revenue: "매출",
  operating_income: "영업이익",
  net_income: "당기순이익",
  demand_delta_pct: "수요 변화(%)",
  margin_delta_pp: "마진 변화(%p)",
  hhi_delta: "집중도 변화",
};

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function MarketChainTab({ projectId }: { projectId: string }) {
  const [topology, setTopology] = useState<ChainTopologyResponse | null>(null);
  const [runs, setRuns] = useState<RunSummaryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [financials, setFinancials] = useState<StageFinancialRow[] | null>(null);
  const [importForm, setImportForm] = useState({ fiscal_year: "", metric_key: "revenue", value: "" });

  const [simRunId, setSimRunId] = useState("");
  const [scenario, setScenario] = useState<"downside" | "base" | "upside" | "custom">("downside");
  const [results, setResults] = useState<StructureSimQuantileRow[]>([]);
  const [simMeta, setSimMeta] = useState<{ unassessed_nodes: string[]; defaulted_drivers: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadTopologyAndRuns = useCallback(async () => {
    try {
      const [topo, runList] = await Promise.all([marketApi.topology(projectId), marketApi.runs(projectId)]);
      setTopology(topo.data ?? null);
      const raw = (runList.data ?? []) as unknown as Array<Record<string, unknown>>;
      const normalized: RunSummaryRow[] = raw.map((r) => ({
        id: String(r.id ?? r.run_id ?? ""),
        label: (r.label as string | null) ?? null,
        created_at: String(r.created_at ?? ""),
      }));
      setRuns(normalized.filter((r) => r.id));
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [projectId]);

  useEffect(() => {
    void loadTopologyAndRuns();
  }, [loadTopologyAndRuns]);

  const loadFinancials = useCallback(
    async (industryId: string) => {
      setSelectedNode(industryId);
      try {
        const res = await marketApi.stageFinancials(projectId, industryId, 5);
        setFinancials(res.data ?? []);
        setError(null);
      } catch (e) {
        setError(errText(e));
      }
    },
    [projectId],
  );



  return (
    <section aria-label="시장·체인">
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      <h3>밸류체인 구조 (upstream → end-market)</h3>
      {topology === null ? (
        <p>불러오는 중...</p>
      ) : (
        <div>
          {topology.layers.map(({ layer, industryIds }) => (
            <div key={layer} style={{ marginBlock: "0.5rem" }}>
              <strong>L{layer}</strong>{" "}
              {industryIds.map((nid) => (
                <button key={nid} type="button" onClick={() => void loadFinancials(nid)}>
                  {nid.slice(0, 10)}…
                </button>
              ))}
            </div>
          ))}
          {topology.links.length > 0 && (
            <table>
              <caption className="sr-only">체인 링크 계수</caption>
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>방향</th>
                  <th>Elasticity</th>
                  <th>Pass-through</th>
                </tr>
              </thead>
              <tbody>
                {topology.links.map((l) => (
                  <tr key={l.id}>
                    <td>{l.from_industry_id.slice(0, 10)}…</td>
                    <td>{l.to_industry_id.slice(0, 10)}…</td>
                    <td>{l.direction === "upstream" ? "업스트림" : "다운스트림"}</td>
                    <td>{l.elasticity ?? "미평가"}</td>
                    <td>{l.pass_through_rate ?? "미평가"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {topology.nodeCount === 0 && <p>value_chain_link 행이 없습니다 — 시장조사에서 체인 링크를 먼저 평가하세요.</p>}
        </div>
      )}

      <h3>단계별 5년 재무 {selectedNode && `(노드 ${selectedNode.slice(0, 10)}…)`}</h3>
      {!selectedNode ? (
        <p>위 그래프에서 노드를 선택하면 5년 추이를 불러옵니다.</p>
      ) : financials === null ? (
        <p>불러오는 중...</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>연도</th>
                <th>지표</th>
                <th>값</th>
              </tr>
            </thead>
            <tbody>
              {financials.map((r, i) => (
                <tr key={`${r.fiscal_year}-${r.metric_key}-${i}`}>
                  <td>{r.fiscal_year}</td>
                  <td>{METRIC_KO[r.metric_key] ?? r.metric_key}</td>
                  <td>{r.value}</td>
                </tr>
              ))}
              {financials.length === 0 && (
                <tr>
                  <td colSpan={3}>해당 노드의 적재된 재무 시계열이 없습니다 — DART 수집 또는 아래 임포트로 추가하세요.</td>
                </tr>
              )}
            </tbody>
          </table>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                try {
                  await marketApi.importFinancials(projectId, {
                    industry_id: selectedNode,
                    rows: [{ fiscal_year: Number(importForm.fiscal_year), metric_key: importForm.metric_key, value: Number(importForm.value) }],
                  });
                  await loadFinancials(selectedNode);
                  setImportForm({ fiscal_year: "", metric_key: "revenue", value: "" });
                } catch (err) {
                  setError(errText(err));
                }
              })();
            }}
          >
            <input type="number" placeholder="연도" value={importForm.fiscal_year} onInput={(e) => setImportForm({ ...importForm, fiscal_year: (e.target as HTMLInputElement).value })} required />
            <input placeholder="지표 키 (revenue)" value={importForm.metric_key} onInput={(e) => setImportForm({ ...importForm, metric_key: (e.target as HTMLInputElement).value })} required />
            <input type="number" step="any" placeholder="값" value={importForm.value} onInput={(e) => setImportForm({ ...importForm, value: (e.target as HTMLInputElement).value })} required />
            <button type="submit">값 추가 (폴백 임포트)</button>
          </form>
        </>
      )}

      <h3>구조 시뮬레이션 (드라이버 → 체인 전파)</h3>
      <p className="hint">
        드라이버 델타는 런의 drv.* 가정 키(rate_bp/fx_pct/commodity_pct/regulation_severity)에서 읽습니다. 미기록 드라이버는 0으로 처리되며 응답 meta에 공개됩니다.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void (async () => {
            try {
              const post = await marketApi.runStructureSimulation(projectId, { run_id: simRunId, scenario });
              const meta = (post as { meta?: { unassessed_nodes?: string[]; defaulted_drivers?: string[] } }).meta ?? {};
              setSimMeta({ unassessed_nodes: meta.unassessed_nodes ?? [], defaulted_drivers: meta.defaulted_drivers ?? [] });
              const list = await marketApi.structureResults(projectId, simRunId);
              setResults(list.data ?? []);
              setError(null);
            } catch (err) {
              setError(errText(err));
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <select value={simRunId} onInput={(e) => setSimRunId((e.target as HTMLSelectElement).value)} required>
          <option value="">런 선택</option>
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              {(r.label ?? "무제 런")} · {r.created_at.slice(0, 10)}
            </option>
          ))}
        </select>
        <select value={scenario} onInput={(e) => setScenario((e.target as HTMLSelectElement).value as typeof scenario)}>
          <option value="downside">다운사이드</option>
          <option value="base">베이스</option>
          <option value="upside">업사이드</option>
          <option value="custom">커스텀</option>
        </select>
        <button type="submit" disabled={busy || !simRunId}>
          실행
        </button>
      </form>

      {simMeta && simMeta.defaulted_drivers.length > 0 && (
        <p role="status">기본값 처리된 드라이버: {simMeta.defaulted_drivers.join(", ")}</p>
      )}
      {results.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>시나리오</th>
              <th>산업</th>
              <th>지표</th>
              <th>P05</th>
              <th>P50</th>
              <th>P95</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={`${r.run_id}-${r.scenario}-${r.industry_id}-${r.metric}-${i}`}>
                <td>{r.scenario}</td>
                <td>{r.industry_id.slice(0, 10)}…</td>
                <td>{METRIC_KO[r.metric] ?? r.metric}</td>
                <td>{r.p05}</td>
                <td>{r.p50}</td>
                <td>{r.p95}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── Chain Sensitivity Editor (ADR-0068 round 5 surface) ──────────────────

export function ChainSensitivityEditor({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Array<{ id: string; industry_id: string; driver_code: string; sensitivity: number; lag_months: number }> | null>(null);
  const [form, setForm] = useState({ industry_id: "", driver_code: "rate", sensitivity: "", lag_months: "0" });
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await marketApi.chainSensitivities(projectId);
      setRows(res.data ?? []);
      setError(null);
    } catch (e) { setError(errText(e)); }
  }, [projectId]);
  useEffect(() => { void reload(); }, [reload]);

  return (
    <section aria-label="드라이버 민감도 편집기">
      <h3>드라이버 민감도 (구조 시뮬레이션 입력)</h3>
      {error && <p role="alert">{error}</p>}
      <table>
        <thead><tr><th>산업</th><th>드라이버</th><th>민감도</th><th>지연(월)</th></tr></thead>
        <tbody>
          {(rows ?? []).map((r) => (
            <tr key={r.id}><td>{r.industry_id.slice(0,10)}…</td><td>{r.driver_code}</td><td>{r.sensitivity}</td><td>{r.lag_months}</td></tr>
          ))}
          {rows !== null && rows.length === 0 && <tr><td colSpan={4}>민감도 미평가</td></tr>}
        </tbody>
      </table>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await marketApi.upsertChainSensitivity(projectId, { industry_id: form.industry_id, driver_code: form.driver_code, sensitivity: Number(form.sensitivity), lag_months: Number(form.lag_months) });
            await reload();
            setError(null);
          } catch (err) { setError(errText(err)); }
        }}
      >
        <input placeholder="industry_id" value={form.industry_id} onInput={(e) => setForm({ ...form, industry_id: (e.target as HTMLInputElement).value })} required />
        <select value={form.driver_code} onInput={(e) => setForm({ ...form, driver_code: (e.target as HTMLSelectElement).value })}>
          <option value="rate">금리</option><option value="fx">환율</option><option value="commodity">원자재</option><option value="regulation">규제</option>
        </select>
        <input type="number" step="any" placeholder="민감도" value={form.sensitivity} onInput={(e) => setForm({ ...form, sensitivity: (e.target as HTMLInputElement).value })} required />
        <input type="number" placeholder="지연(월)" value={form.lag_months} onInput={(e) => setForm({ ...form, lag_months: (e.target as HTMLInputElement).value })} required />
        <button type="submit">저장</button>
      </form>
    </section>
  );
}

