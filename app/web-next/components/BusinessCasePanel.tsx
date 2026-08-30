"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";

// S5 Business Case 패널 (greenfield cost model) — 라인 항목 입력 → 연도별
// 손익·누적현금흐름·BEP 표시. 서버가 라인에서 전개를 계산한다(저장 안 함).

interface BcLine {
  id: string;
  category: "labor" | "opex" | "capex" | "revenue";
  name: string;
  annual_amount_krw_m: number;
  headcount: number | null;
  start_year: number;
  growth_rate: number;
  note: string | null;
}

interface BcModel {
  id: string;
  kind: string;
  name: string;
  horizon_years: number;
}

interface BcYear {
  year: number;
  revenue: number;
  labor: number;
  opex: number;
  capex: number;
  ebitda: number;
  netCashflow: number;
  cumulative: number;
}

interface BcDetail {
  model: BcModel;
  lines: BcLine[];
  projection: { years: BcYear[]; bep_year: number | null };
}

const CAT_LABELS: Record<string, string> = {
  revenue: "매출",
  labor: "인건비",
  opex: "운영비",
  capex: "투자비",
};

const nf = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });

export function BusinessCasePanel({ projectId }: { projectId: string }) {
  const [models, setModels] = useState<Array<BcModel & { line_count?: number }> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<BcDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newModelName, setNewModelName] = useState("");
  const [line, setLine] = useState({ category: "revenue", name: "", annual_amount_krw_m: "", headcount: "", start_year: "1", growth_rate: "0" });

  const loadModels = useCallback(() => {
    api.get<Array<BcModel & { line_count?: number }>>(`/api/projects/${projectId}/business-case`).then((r) => {
      setModels(r.data);
      if (r.data.length > 0 && !selected) setSelected(r.data[0].id);
    }).catch(() => setModels([]));
  }, [projectId, selected]);

  const loadDetail = useCallback(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    api.get<BcDetail>(`/api/projects/${projectId}/business-case/${selected}`).then((r) => setDetail(r.data)).catch(() => setDetail(null));
  }, [projectId, selected]);

  useEffect(loadModels, [loadModels]);
  useEffect(loadDetail, [loadDetail]);

  async function createModel(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ id: string }>(`/api/projects/${projectId}/business-case`, {
        kind: "greenfield_cost",
        name: newModelName,
      });
      setNewModelName("");
      setSelected(res.data.id);
      loadModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "생성 실패");
    } finally {
      setBusy(false);
    }
  }

  async function addLine(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/projects/${projectId}/business-case/${selected}`, {
        category: line.category,
        name: line.name,
        annual_amount_krw_m: Number(line.annual_amount_krw_m),
        headcount: line.headcount ? Number(line.headcount) : undefined,
        start_year: Number(line.start_year) || 1,
        growth_rate: Number(line.growth_rate) || 0,
      });
      setLine({ ...line, name: "", annual_amount_krw_m: "", headcount: "" });
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "라인 추가 실패");
    } finally {
      setBusy(false);
    }
  }

  // A1: Business Case → 시뮬레이션. 라인으로 연도별 순현금흐름을 계산해
  // 런(sim.cf1..N + 할인율)을 만들고 몬테카를로를 즉시 실행한다.
  const [simBusy, setSimBusy] = useState(false);
  const [simNote, setSimNote] = useState<string | null>(null);
  async function simulateModel() {
    if (!selected) return;
    setSimBusy(true);
    setSimNote(null);
    setError(null);
    try {
      const res = await api.post<{ run_id: string; simulation: { p05: number; p50: number; p95: number; irr?: number; payback_year?: number } }>(
        `/api/projects/${projectId}/business-case/${selected}/simulate`,
        {},
      );
      const sim = res.data.simulation;
      setSimNote(
        `시뮬레이션 완료 — NPV P05 ${sim.p05} / 중앙 ${sim.p50} / P95 ${sim.p95} KRM` +
          (sim.irr !== undefined && sim.irr !== null ? ` · IRR ${(sim.irr * 100).toFixed(1)}%` : "") +
          (sim.payback_year ? ` · 페이백 ${sim.payback_year}년차` : "") +
          ` (런 ${res.data.run_id.slice(0, 8)}…)`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "시뮬레이션 실패");
    } finally {
      setSimBusy(false);
    }
  }

  async function deleteLine(lineId: string) {
    if (!selected) return;
    if (!window.confirm("이 라인을 삭제할까요?")) return;
    try {
      await api.delete(`/api/projects/${projectId}/business-case/${selected}?line_id=${lineId}`);
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제 실패");
    }
  }

  return (
    <section className="workflow-card" aria-label="Business Case (S5)">
      <h3>Business Case — 비용·수익 모델 (단위: KRM)</h3>
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
      {models === null ? (
        <p>불러오는 중...</p>
      ) : models.length === 0 ? (
        <form onSubmit={createModel} className="route-form" aria-label="모델 생성">
          <label>
            모델명
            <input type="text" value={newModelName} onChange={(e) => setNewModelName(e.target.value)} placeholder="예: GF 손익모델 v1" required />
          </label>
          <button type="submit" className="btn-premium" disabled={busy}>
            모델 생성
          </button>
        </form>
      ) : (
        <>
          <div className="bc-model-row">
            <select aria-label="모델 선택" value={selected ?? ""} onChange={(e) => setSelected(e.target.value)}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.line_count ?? 0} 라인)
                </option>
              ))}
            </select>
            <button type="button" className="btn-premium" disabled={simBusy} onClick={simulateModel}>
              {simBusy ? "시뮬레이션 실행 중..." : "Business Case로 시뮬레이션 실행"}
            </button>
          </div>
          {simNote && (
            <p role="status" className="text-[color:var(--green-fg)] text-[0.82rem] mb-1">
              {simNote} — 시뮬레이션 탭에서 분포를 확인할 수 있습니다.
            </p>
          )}
          {detail && (
            <>
              <table className="data-table" aria-label="라인 항목">
                <caption className="sr-only">Business Case 라인</caption>
                <thead>
                  <tr>
                    <th scope="col">구분</th>
                    <th scope="col">항목</th>
                    <th scope="col">연간액</th>
                    <th scope="col">인원</th>
                    <th scope="col">시작연도</th>
                    <th scope="col">증가율</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{CAT_LABELS[l.category]}</td>
                      <td>{l.name}</td>
                      <td className="tabular-nums">{nf.format(l.annual_amount_krw_m)}</td>
                      <td className="tabular-nums">{l.headcount ?? "—"}</td>
                      <td className="tabular-nums">{l.start_year}</td>
                      <td className="tabular-nums">{(l.growth_rate * 100).toFixed(0)}%</td>
                      <td>
                        <button type="button" className="btn-ghost" onClick={() => deleteLine(l.id)}>
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <form onSubmit={addLine} className="route-form" aria-label="라인 추가">
                <div className="bc-line-row">
                  <select aria-label="구분" value={line.category} onChange={(e) => setLine({ ...line, category: e.target.value })}>
                    {Object.entries(CAT_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <input type="text" aria-label="항목명" placeholder="항목명" value={line.name} onChange={(e) => setLine({ ...line, name: e.target.value })} required />
                  <input type="number" step="0.1" aria-label="연간액 (KRM)" placeholder="연간액 KRM" value={line.annual_amount_krw_m} onChange={(e) => setLine({ ...line, annual_amount_krw_m: e.target.value })} required />
                  <input type="number" aria-label="인원" placeholder="인원" value={line.headcount} onChange={(e) => setLine({ ...line, headcount: e.target.value })} />
                  <input type="number" min={1} aria-label="시작연도" placeholder="시작연도" value={line.start_year} onChange={(e) => setLine({ ...line, start_year: e.target.value })} />
                  <input type="number" step="0.05" aria-label="연 증가율" placeholder="증가율" value={line.growth_rate} onChange={(e) => setLine({ ...line, growth_rate: e.target.value })} />
                  <button type="submit" className="btn-ghost" disabled={busy}>
                    라인 추가
                  </button>
                </div>
              </form>
              <table className="data-table" aria-label="연도별 손익 전개">
                <caption className="sr-only">연도별 손익 전개</caption>
                <thead>
                  <tr>
                    <th scope="col">연도</th>
                    <th scope="col">매출</th>
                    <th scope="col">인건비</th>
                    <th scope="col">운영비</th>
                    <th scope="col">투자비</th>
                    <th scope="col">EBITDA</th>
                    <th scope="col">누적현금흐름</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.projection.years.map((y) => (
                    <tr key={y.year}>
                      <td className="tabular-nums">{y.year}</td>
                      <td className="tabular-nums">{nf.format(y.revenue)}</td>
                      <td className="tabular-nums">{nf.format(y.labor)}</td>
                      <td className="tabular-nums">{nf.format(y.opex)}</td>
                      <td className="tabular-nums">{nf.format(y.capex)}</td>
                      <td className="tabular-nums">{nf.format(y.ebitda)}</td>
                      <td className={`tabular-nums ${y.cumulative < 0 ? "text-[color:var(--red-fg)]" : "text-[color:var(--green-fg)]"}`}>
                        {nf.format(y.cumulative)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[color:var(--muted-fg)] text-[0.82rem]">
                손익분기(BEP): {detail.projection.bep_year ? `${detail.projection.bep_year}년차` : "도달하지 않음 (기간/규모 조정 필요)"}
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
