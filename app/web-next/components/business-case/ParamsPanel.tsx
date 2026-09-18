"use client";

// ParamsPanel — S8 시뮬레이션 파라미터 + 실행 스냅샷 (design
// 2026-09-18-s8-business-case-evaluation REQ-W5-2/3, REQ-W6-3).
// Resolution chain user > derived > default is shown with its provenance;
// the edit form records a bc.* user batch with a mandatory rationale, and
// the snapshot section renders the persisted job-spec of the latest
// generated model — the execution contract the results came from.

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.ts";

interface ResolvedParams {
  captureRate: number; captureSource: string;
  rampUp: number[]; rampSource: string;
  opexRatio: number; opexSource: string;
  capexRatio: number; capexSource: string;
  initialInvestmentRatio: number; initialInvestmentSource: string;
  growthOverride: number | null; growthOverrideSource: string;
  sigmaOverride: number | null; sigmaOverrideSource: string;
  horizonYears: number; horizonSource: string;
  iterations: number; iterationsSource: string;
}

interface CaseSummary {
  id: string;
  name: string;
  scenario: string | null;
  variant: string;
  inputs_json: string | null;
  adopted: boolean;
  recommended: boolean;
  created_at: string;
}

interface DriverSpec {
  dist: string;
  mean?: number;
  sigma?: number;
  low?: number;
  high?: number;
  expected?: number;
  value?: number | number[];
  unit?: string;
  source?: string;
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const driverValue = (d: DriverSpec): string => {
  if (d.dist === "normal") return `N(${d.mean}, ${d.sigma})`;
  if (d.dist === "uniform") return `U(${d.low}, ${d.high})`;
  if (d.dist === "triangular") return `T(${d.low}, ${d.expected}, ${d.high})`;
  return Array.isArray(d.value) ? d.value.map((x) => x.toFixed(2)).join(" → ") : String(d.value);
};
const DRIVER_LABELS: Record<string, string> = {
  revenue_y1: "1차년도 매출",
  ramp_up: "가동률 램프업",
  revenue_growth: "매출 성장률",
  opex_ratio: "운영비 비율",
  capex_ratio: "설비투자 비율",
  initial_investment: "초기 투자 (year-0)",
};

export function ParamsPanel({ projectId }: { projectId: string }) {
  const [resolved, setResolved] = useState<ResolvedParams | null>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [ramp, setRamp] = useState<string[]>(["", "", "", "", ""]);
  const [rationale, setRationale] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = await api.get<{ params: ResolvedParams }>(`/api/projects/${encodeURIComponent(projectId)}/business-case/params`);
      setResolved(params.data.params);
      const casesRes = await api.get<{ cases: CaseSummary[] }>(`/api/projects/${encodeURIComponent(projectId)}/business-case`);
      setCases(casesRes.data.cases);
    } catch (e) {
      setError(e instanceof Error ? e.message : "파라미터를 불러오지 못했습니다.");
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    if (!rationale.trim()) {
      setError("파라미터 확정에는 근거(rationale)가 필수입니다.");
      return;
    }
    const params: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(form)) {
      if (raw.trim() !== "") params[key] = Number(raw);
    }
    const rampValues = ramp.filter((v) => v.trim() !== "");
    if (rampValues.length > 0) params.ramp_up = rampValues.map((v) => Number(v));
    if (Object.keys(params).length === 0) {
      setError("변경할 값을 하나 이상 입력하세요.");
      return;
    }
    try {
      const res = await api.post<{ written: string[]; run_id: string }>(
        `/api/projects/${encodeURIComponent(projectId)}/business-case/params`,
        { params, rationale },
      );
      setMessage(`저장 완료 — ${res.data.written.length}개 키 (run ${res.data.run_id}). 시나리오 비교 탭에서 재생성하면 새 파라미터가 반영됩니다.`);
      setForm({});
      setRamp(["", "", "", "", ""]);
      setRationale("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "파라미터 저장에 실패했습니다.");
    }
  }

  const snapshotCases = cases.filter((c) => c.inputs_json);
  const latestSnapshot = snapshotCases[snapshotCases.length - 1] ?? null;
  let snapshot: {
    job_id?: string;
    iterations?: number;
    horizon_years?: number;
    discount_rate?: { value: number; subject: string; source: string };
    cases?: Array<{ case_id: string; drivers: Record<string, DriverSpec> }>;
  } | null = null;
  if (latestSnapshot?.inputs_json) {
    try {
      const parsed = JSON.parse(latestSnapshot.inputs_json) as Record<string, unknown>;
      // A snapshot without the contract fields is a legacy placeholder — show
      // it as absent instead of crashing (finding #2, 2026-09-18 GUI review).
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.cases) && parsed.cases.length > 0) {
        snapshot = parsed as typeof snapshot;
      }
    } catch {
      snapshot = null;
    }
  }

  return (
    <>
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem] mb-2">✕ {error}</p>}
      {message && <p className="text-[color:var(--green-fg)] text-[0.82rem] mb-2">✓ {message}</p>}

      {/* 현재 해석값 — user > derived > default 출처 표시 (REQ-W6-2) */}
      <section className="market-section sizing-step" aria-label="현재 파라미터">
        <h3 className="sizing-step-title">시뮬레이션 파라미터 <span className="status-chip status-info">해석 순위: 사용자 확정 &gt; 유도값 &gt; 기본값</span></h3>
        {!resolved ? (
          <p>불러오는 중...</p>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="col-label text-left">항목</th>
                  <th className="text-right">값</th>
                  <th className="text-left">출처</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ["포획률 (year-1 매출)", pct(resolved.captureRate), resolved.captureSource],
                  ["가동률 램프업", resolved.rampUp.map((v) => v.toFixed(2)).join(" → "), resolved.rampSource],
                  ["운영비 비율", pct(resolved.opexRatio), resolved.opexSource],
                  ["설비투자 비율", pct(resolved.capexRatio), resolved.capexSource],
                  ["초기투자 비율 (year-1 매출 대비)", pct(resolved.initialInvestmentRatio), resolved.initialInvestmentSource],
                  ["성장률 오버라이드", resolved.growthOverride != null ? pct(resolved.growthOverride) : "— (유도값 사용)", resolved.growthOverrideSource],
                  ["변동성 오버라이드", resolved.sigmaOverride != null ? pct(resolved.sigmaOverride) : "— (유도값 사용)", resolved.sigmaOverrideSource],
                  ["회수 기간 (년)", String(resolved.horizonYears), resolved.horizonSource],
                  ["반복 수", resolved.iterations.toLocaleString(), resolved.iterationsSource],
                ] as Array<[string, string, string]>).map(([label, value, source]) => (
                  <tr key={label}>
                    <td className="col-label">{label}</td>
                    <td className="text-right tabular-nums">{value}</td>
                    <td className="text-[color:var(--muted-fg)] text-[0.78rem]">{source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 편집 폼 — 근거 필수 (REQ-W6-3) */}
      <section className="market-section sizing-step mt-3" aria-label="파라미터 확정">
        <h3 className="sizing-step-title">파라미터 확정 <span className="status-chip status-info">kind=user — 저장 후 재생성 시 반영</span></h3>
        <form className="grid gap-3" onSubmit={submit} style={{ maxWidth: 560 }}>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="grid gap-1 text-sm">포획률 (비율, 예: 0.005)<input className="form-input" value={form.capture_rate ?? ""} onChange={(e) => setForm({ ...form, capture_rate: e.target.value })} placeholder="0.005" /></label>
            <label className="grid gap-1 text-sm">운영비 비율 (예: 0.6)<input className="form-input" value={form.opex_ratio ?? ""} onChange={(e) => setForm({ ...form, opex_ratio: e.target.value })} placeholder="0.6" /></label>
            <label className="grid gap-1 text-sm">설비투자 비율 (예: 0.1)<input className="form-input" value={form.capex_ratio ?? ""} onChange={(e) => setForm({ ...form, capex_ratio: e.target.value })} placeholder="0.1" /></label>
            <label className="grid gap-1 text-sm">초기투자 비율 (예: 0.5)<input className="form-input" value={form.initial_investment_ratio ?? ""} onChange={(e) => setForm({ ...form, initial_investment_ratio: e.target.value })} placeholder="0.5" /></label>
            <label className="grid gap-1 text-sm">성장률 오버라이드 (비율)<input className="form-input" value={form.growth_override ?? ""} onChange={(e) => setForm({ ...form, growth_override: e.target.value })} placeholder="0.05" /></label>
            <label className="grid gap-1 text-sm">변동성 오버라이드 (비율)<input className="form-input" value={form.sigma_override ?? ""} onChange={(e) => setForm({ ...form, sigma_override: e.target.value })} placeholder="0.03" /></label>
            <label className="grid gap-1 text-sm">회수 기간 (년)<input className="form-input" value={form.horizon_years ?? ""} onChange={(e) => setForm({ ...form, horizon_years: e.target.value })} placeholder="5" /></label>
            <label className="grid gap-1 text-sm">반복 수<input className="form-input" value={form.iterations ?? ""} onChange={(e) => setForm({ ...form, iterations: e.target.value })} placeholder="2000" /></label>
          </div>
          <div>
            <p className="text-sm text-[color:var(--muted-fg)] mb-1">가동률 램프업 (연도별, 일부만 입력 가능 — 예: 0.4, 0.7)</p>
            <div className="flex gap-2">
              {ramp.map((v, i) => (
                <input
                  key={i}
                  className="form-input w-20"
                  aria-label={`가동률 ${i + 1}년차`}
                  value={v}
                  onChange={(e) => setRamp(ramp.map((x, j) => (j === i ? e.target.value : x)))}
                  placeholder={`y${i + 1}`}
                />
              ))}
            </div>
          </div>
          <label className="grid gap-1 text-sm">근거 (필수)<textarea className="form-input" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="시장 조사 결과 포획률 상향 — 출처/근거를 기재하세요" /></label>
          <button className="primary-button justify-self-start" type="submit">파라미터 확정</button>
          <p className="text-[color:var(--muted-fg)] text-[0.78rem]">확정된 값은 사용자 등급(user) 가정으로 기록됩니다. 시나리오 비교 탭의 재생성을 실행하면 새 파라미터로 다시 시뮬레이션됩니다.</p>
        </form>
      </section>

      {/* 실행 스냅샷 — 최근 생성 모델의 job-spec (REQ-W5-1/2) */}
      <section className="market-section sizing-step mt-3" aria-label="실행 스냅샷">
        <h3 className="sizing-step-title">실행 스냅샷 <span className="status-chip status-info">최근 생성 모델의 실행 계약</span></h3>
        {!snapshot ? (
          <p className="text-sm text-[color:var(--muted-fg)]">
            아직 저장된 실행 스냅샷이 없습니다{snapshotCases.length > 0 ? " (이 모델의 스냅샷은 구버전 형식입니다 — 재생성하면 기록됩니다)" : ""}. 시나리오 비교 탭에서 생성을 실행하면 이곳에 해당 결과의 파라미터가 기록됩니다.
          </p>
        ) : (
          <>
            <dl className="grid gap-2 md:grid-cols-3 text-sm mb-2">
              <div><dt className="text-[color:var(--muted-fg)]">반복 수</dt><dd className="font-semibold tabular-nums">{(snapshot.iterations ?? 0).toLocaleString()}</dd></div>
              <div><dt className="text-[color:var(--muted-fg)]">회수 기간</dt><dd className="font-semibold">{snapshot.horizon_years}년</dd></div>
              <div>
                <dt className="text-[color:var(--muted-fg)]">할인율 / 적용 주체</dt>
                <dd className="font-semibold">{snapshot.discount_rate ? `${pct(snapshot.discount_rate.value)} · ${snapshot.discount_rate.subject}` : "—"} <span className="text-[color:var(--muted-fg)] font-normal text-[0.78rem]">({snapshot.discount_rate?.source ?? ""})</span></dd>
              </div>
            </dl>
            <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-2">
              모델: {latestSnapshot!.name} {latestSnapshot!.adopted ? "· 채택됨" : latestSnapshot!.recommended ? "· RECOMMENDED" : ""}
            </p>
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="col-label text-left">드라이버</th>
                    <th className="text-left">분포</th>
                    <th className="text-left">값</th>
                    <th className="text-left">출처</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(snapshot.cases[0]?.drivers ?? {}).map(([key, d]) => (
                    <tr key={key}>
                      <td className="col-label">{DRIVER_LABELS[key] ?? key}</td>
                      <td>{d.dist}</td>
                      <td className="tabular-nums">{driverValue(d)}</td>
                      <td className="text-[color:var(--muted-fg)] text-[0.78rem]">{d.source ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
