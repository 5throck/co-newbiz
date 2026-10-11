"use client";

// ParamsPanel — S8 시뮬레이션 파라미터 + 실행 스냅샷 (design
// 2026-09-18-s8-business-case-evaluation REQ-W5-2/3, REQ-W6-3).
// Resolution chain user > derived > default is shown with its provenance;
// the edit form records a bc.* user batch with a mandatory rationale, and
// the snapshot section renders the persisted job-spec of the latest
// generated model — the execution contract the results came from.

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { ParamTable, type ParamRow } from "../ui.tsx";
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteProject } from "../../lib/project-write-access.ts";

// Mirrors EV_BAND_OPTIMISM_FLAG_FACTOR / EV_BAND_MAX_SANE / EV_BAND_SPREAD_FLAG_RATIO / ACQUISITION_EV_REVENUE_BAND in
// lib/business-case-generator.ts (DB-bound module, not bundleable here); drift is caught by
// tests/unit/business-case-targets.test.ts. The server stays authoritative.
const EV_BAND_OPTIMISM_FLAG_FACTOR = 1.5;
const EV_BAND_MAX_SANE = 50;
const EV_BAND_SPREAD_FLAG_RATIO = 4.5;
const EV_BAND_REF = { min: 2, max: 6 } as const;

interface ConfirmedBand { min: number; max: number; rationale: string; source: string; confirmedBy: string; confirmedAt: string }

function validateBand(minRaw: string, maxRaw: string, rationale: string, source: string) {
  const errs: { min?: string; max?: string; rationale?: string; source?: string } = {};
  const min = minRaw.trim() === "" ? NaN : Number(minRaw);
  const max = maxRaw.trim() === "" ? NaN : Number(maxRaw);
  if (!Number.isFinite(min) || min <= 0) errs.min = "하한은 0보다 큰 숫자여야 합니다.";
  if (!Number.isFinite(max)) errs.max = "상한은 숫자여야 합니다.";
  else if (max > EV_BAND_MAX_SANE) errs.max = `상한은 ${EV_BAND_MAX_SANE}배 이하여야 합니다 (입력 오류로 간주).`;
  if (!errs.min && !errs.max && min >= max) errs.max = "하한은 상한보다 작아야 합니다.";
  if (rationale.trim().length < 10) errs.rationale = "근거는 10자 이상 입력하세요.";
  if (source.trim().length < 3) errs.source = "출처는 3자 이상 입력하세요 (예: 경영진 판단: 담당자명).";
  return { errs, min, max, valid: Object.keys(errs).length === 0 };
}

function SourceChip({ source }: { source: string }) {
  return <span className="status-chip status-info">{source}</span>;
}

interface ResolvedParams {
  captureRate: number; captureSource: string;
  rampUp: number[]; rampSource: string;
  opexRatio: number; opexSource: string;
  capexRatio: number; capexSource: string;
  initialInvestmentRatio: number; initialInvestmentSource: string;
  acquisitionEvRevenue: number | null; acquisitionEvRevenueSource: string;
  acquisitionEvRevenueBand?: ConfirmedBand | null;
  fadeHorizonYears: number; fadeHorizonSource: string;
  growthTerminal: number | null; growthTerminalSource: string;
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

interface SnapshotShape {
  job_id?: string;
  iterations?: number;
  horizon_years?: number;
  discount_rate?: { value: number; subject: string; source: string };
  cases?: Array<{ case_id: string; drivers: Record<string, DriverSpec> }>;
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
  exit_ev_revenue: "처분 EV/매출 배수 (회수 시점)",
};

export function ParamsPanel({ projectId }: { projectId: string }) {
  const [resolved, setResolved] = useState<ResolvedParams | null>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [ramp, setRamp] = useState<string[]>(["", "", "", "", ""]);
  const [rationale, setRationale] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [bandMin, setBandMin] = useState("");
  const [bandMax, setBandMax] = useState("");
  const [bandRationale, setBandRationale] = useState("");
  const [bandSource, setBandSource] = useState("");
  const [bandTouched, setBandTouched] = useState(false);
  const [bandMsg, setBandMsg] = useState<string | null>(null);
  const [bandErr, setBandErr] = useState<string | null>(null);
  const [bandBusy, setBandBusy] = useState(false);
  const bandCheck = validateBand(bandMin, bandMax, bandRationale, bandSource);
  const bandOptimism = Number.isFinite(bandCheck.max) && bandCheck.max > EV_BAND_OPTIMISM_FLAG_FACTOR * EV_BAND_REF.max;

  const bandSpread = Number.isFinite(bandCheck.min) && Number.isFinite(bandCheck.max) && bandCheck.min > 0 && bandCheck.max / bandCheck.min > EV_BAND_SPREAD_FLAG_RATIO;

  async function submitBand(e: React.FormEvent) {
    e.preventDefault();
    setBandMsg(null);
    setBandErr(null);
    setBandTouched(true);
    if (!bandCheck.valid) return;
    setBandBusy(true);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/business-case/ev-band`, {
        min: bandCheck.min, max: bandCheck.max, rationale: bandRationale.trim(), source: bandSource.trim(),
      });
      setBandMsg("밴드를 확정했습니다. 대상 비교 탭에 확정 밴드 기준으로 반영됩니다.");
      setBandMin(""); setBandMax(""); setBandRationale(""); setBandSource(""); setBandTouched(false);
      load();
    } catch (err) {
      setBandErr(err instanceof Error ? err.message : "밴드 확정에 실패했습니다.");
    } finally {
      setBandBusy(false);
    }
  }

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
  const parseSnapshot = (raw: string | null): SnapshotShape | null => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<SnapshotShape> | null;
      // A snapshot without the contract fields is a legacy placeholder — show
      // it as absent instead of crashing (finding #2, 2026-09-18 GUI review).
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.cases) && parsed.cases.length > 0) {
        return parsed as SnapshotShape;
      }
      return null;
    } catch {
      return null;
    }
  };
  const snapshot = parseSnapshot(latestSnapshot?.inputs_json ?? null);

  return (
    <>
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
      {message && <p className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-2">✓ {message}</p>}

      {/* 현재 해석값 — user > derived > default 출처 표시 (REQ-W6-2) */}
      <section className="market-section sizing-step" aria-label="현재 파라미터">
        <h3 className="sizing-step-title">시뮬레이션 파라미터 <span className="status-chip status-info">해석 순위: 사용자 확정 &gt; 유도값 &gt; 기본값</span></h3>
        {!resolved ? (
          <p>불러오는 중...</p>
        ) : (
          <ParamTable
            caption="현재 시뮬레이션 파라미터"
            rows={[
              ...(([
                ["포획률 (year-1 매출)", resolved.captureRate, resolved.captureSource],
                ["운영비 비율", resolved.opexRatio, resolved.opexSource],
                ["설비투자 비율", resolved.capexRatio, resolved.capexSource],
                ["초기투자 비율 (year-1 매출 대비)", resolved.initialInvestmentRatio, resolved.initialInvestmentSource],
              ] as Array<[string, number, string]>).map(([label, v, source]): ParamRow => ({ label, value: (v * 100).toFixed(1), unit: "%", source: <SourceChip source={source} /> }))),
              { label: "가동률 램프업", value: resolved.rampUp.map((v) => v.toFixed(2)).join(" → "), unit: "비율", source: <SourceChip source={resolved.rampSource} /> },
              { label: "인수 EV/Revenue 배수 (브라운필드)", value: resolved.acquisitionEvRevenue != null ? resolved.acquisitionEvRevenue.toFixed(2) : "3.0 — 미확정 시 컴프 기본값 (글로벌 로보틱스 M&A 2–6×)", unit: resolved.acquisitionEvRevenue != null ? "배" : "", source: <SourceChip source={resolved.acquisitionEvRevenueSource} /> },
              { label: "교차검증 창구 (페이드 DCF)", value: String(resolved.fadeHorizonYears), unit: "년", source: <SourceChip source={resolved.fadeHorizonSource} /> },
              { label: "말기 성장률 (페이드 DCF 수렴점)", value: resolved.growthTerminal != null ? (resolved.growthTerminal * 100).toFixed(1) : "3.0 — 미확정 시 기본값", unit: resolved.growthTerminal != null ? "%" : "", source: <SourceChip source={resolved.growthTerminalSource} /> },
              { label: "성장률 오버라이드", value: resolved.growthOverride != null ? (resolved.growthOverride * 100).toFixed(1) : "— (유도값 사용)", unit: resolved.growthOverride != null ? "%" : "", source: <SourceChip source={resolved.growthOverrideSource} /> },
              { label: "변동성 오버라이드", value: resolved.sigmaOverride != null ? (resolved.sigmaOverride * 100).toFixed(1) : "— (유도값 사용)", unit: resolved.sigmaOverride != null ? "%" : "", source: <SourceChip source={resolved.sigmaOverrideSource} /> },
              { label: "회수 기간", value: String(resolved.horizonYears), unit: "년", source: <SourceChip source={resolved.horizonSource} /> },
              { label: "반복 수", value: resolved.iterations.toLocaleString(), unit: "회", source: <SourceChip source={resolved.iterationsSource} /> },
            ]}
          />
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
            <label className="grid gap-1 text-sm">인수 EV/매출 배수 (예: 3.0 — 확정 시 인수가·처분가 모두 이 배수)<input className="form-input" value={form.acquisition_ev_revenue ?? ""} onChange={(e) => setForm({ ...form, acquisition_ev_revenue: e.target.value })} placeholder="3.0" /></label>
            <label className="grid gap-1 text-sm">교차검증 창구 (페이드 DCF 연수, 예: 10)<input className="form-input" value={form.fade_horizon_years ?? ""} onChange={(e) => setForm({ ...form, fade_horizon_years: e.target.value })} placeholder="10" /></label>
            <label className="grid gap-1 text-sm">말기 성장률 (비율, 예: 0.03)<input className="form-input" value={form.growth_terminal ?? ""} onChange={(e) => setForm({ ...form, growth_terminal: e.target.value })} placeholder="0.03" /></label>
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
          <button className="btn-ghost justify-self-start" type="submit">파라미터 확정</button>
          <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">확정된 값은 사용자 등급(user) 가정으로 기록됩니다. 시나리오 비교 탭의 재생성을 실행하면 새 파라미터로 다시 시뮬레이션됩니다.</p>
        </form>
      </section>

      {/* EV/매출 밴드 확정 — 사람 전용 (경계 #2: 에이전트는 설정할 수 없음) */}
      <section className="market-section sizing-step mt-3" aria-label="EV/매출 밴드 확정">
        <h3 className="sizing-step-title">EV/매출 밴드 확정 <span className="status-chip status-info">사람 전용 — 에이전트는 설정할 수 없습니다</span></h3>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          참고(글로벌 로보틱스·자동화 M&amp;A): {EV_BAND_REF.min}–{EV_BAND_REF.max}× — 이 영역의 근거 없음, 참고용. 확정한 밴드만 대상 비교의 범위 내/밖 표시 기준이 되며 순위·밸류에이션에는 영향이 없습니다.
        </p>
        {resolved?.acquisitionEvRevenueBand ? (
          <p className="text-[length:var(--fs-caption)] mb-2" role="status">
            <span className="status-chip status-green mr-1"><span aria-hidden="true">✓</span> 현재 확정 밴드</span>
            <b className="mono-num">{resolved.acquisitionEvRevenueBand.min}–{resolved.acquisitionEvRevenueBand.max}×</b> — 근거: {resolved.acquisitionEvRevenueBand.rationale} · 출처: {resolved.acquisitionEvRevenueBand.source}{" "}
            <span className="text-[color:var(--muted-fg)]">(확정: {resolved.acquisitionEvRevenueBand.confirmedBy}, {resolved.acquisitionEvRevenueBand.confirmedAt})</span>
          </p>
        ) : (
          <p className="text-[length:var(--fs-caption)] mb-2" role="status">
            <span className="status-chip status-not-started mr-1"><span aria-hidden="true">ⓘ</span> 밴드 미확정</span>
            아직 확정된 밴드가 없어 대상 비교에서 범위 내/밖 판정을 표시하지 않습니다.
          </p>
        )}
        {!canAct ? (
          <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            <span className="status-chip status-not-started mr-1">읽기 전용</span>
            현재 역할은 밴드를 확정할 수 없습니다 (분석가만 가능).
          </p>
        ) : (
          <form className="grid gap-3" onSubmit={submitBand} noValidate style={{ maxWidth: 560 }}>
            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1 text-sm" htmlFor="evband-min">하한 (배, 필수)
                <input id="evband-min" className="form-input" inputMode="decimal" value={bandMin} onChange={(e) => setBandMin(e.target.value)} placeholder="2" aria-invalid={bandTouched && !!bandCheck.errs.min} aria-describedby={bandTouched && bandCheck.errs.min ? "evband-min-err" : undefined} />
                {bandTouched && bandCheck.errs.min && <span id="evband-min-err" role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {bandCheck.errs.min}</span>}
              </label>
              <label className="grid gap-1 text-sm" htmlFor="evband-max">상한 (배, 필수)
                <input id="evband-max" className="form-input" inputMode="decimal" value={bandMax} onChange={(e) => setBandMax(e.target.value)} placeholder="6" aria-invalid={bandTouched && !!bandCheck.errs.max} aria-describedby={bandTouched && bandCheck.errs.max ? "evband-max-err" : undefined} />
                {bandTouched && bandCheck.errs.max && <span id="evband-max-err" role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {bandCheck.errs.max}</span>}
              </label>
            </div>
            {bandOptimism && (
              <p className="status-chip status-amber" role="status">
                <span aria-hidden="true">⚠</span> 상한 {bandCheck.max}×가 글로벌 참고 상한({EV_BAND_REF.max}×)의 {EV_BAND_OPTIMISM_FLAG_FACTOR}배({EV_BAND_REF.max * EV_BAND_OPTIMISM_FLAG_FACTOR}×)를 넘습니다 — 낙관 편향 여부를 점검하세요. (경고일 뿐 저장은 가능합니다)
              </p>
            )}
            {bandSpread && (
              <p className="status-chip status-amber" role="status">
                <span aria-hidden="true">⚠</span> 밴드 폭이 넓습니다 (상한/하한 {(bandCheck.max / bandCheck.min).toFixed(1)}배 &gt; {EV_BAND_SPREAD_FLAG_RATIO}배) — 너무 느슨한 밴드가 아닌지 점검하세요. (경고일 뿐 저장은 가능합니다)
              </p>
            )}
            <label className="grid gap-1 text-sm" htmlFor="evband-rationale">근거 (필수, 10자 이상)
              <textarea id="evband-rationale" className="form-input" value={bandRationale} onChange={(e) => setBandRationale(e.target.value)} aria-invalid={bandTouched && !!bandCheck.errs.rationale} aria-describedby={bandTouched && bandCheck.errs.rationale ? "evband-rationale-err" : undefined} placeholder="이 밴드를 선택한 이유를 기재하세요" />
              {bandTouched && bandCheck.errs.rationale && <span id="evband-rationale-err" role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {bandCheck.errs.rationale}</span>}
            </label>
            <label className="grid gap-1 text-sm" htmlFor="evband-source">출처 (필수, 3자 이상)
              <input id="evband-source" className="form-input" value={bandSource} onChange={(e) => setBandSource(e.target.value)} aria-invalid={bandTouched && !!bandCheck.errs.source} aria-describedby={bandTouched && bandCheck.errs.source ? "evband-source-err" : undefined} placeholder="문헌·문서·URL 또는 경영진 판단: 담당자명" />
              {bandTouched && bandCheck.errs.source && <span id="evband-source-err" role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {bandCheck.errs.source}</span>}
            </label>
            <button className="btn-ghost justify-self-start" type="submit" disabled={bandBusy}>{bandBusy ? "확정 중..." : "밴드 확정"}</button>
            {bandErr && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {bandErr}</p>}
            {bandMsg && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)]">✓ {bandMsg}</p>}
          </form>
        )}
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
            <ParamTable
              caption="시뮬레이션 실행 조건"
              labelHeader="조건"
              rows={[
                { label: "반복 수", value: (snapshot.iterations ?? 0).toLocaleString(), unit: "회" },
                { label: "회수 기간", value: String(snapshot.horizon_years), unit: "년" },
                {
                  label: "할인율",
                  value: snapshot.discount_rate ? pct(snapshot.discount_rate.value) : "—",
                  source: snapshot.discount_rate ? `${snapshot.discount_rate.subject} · ${snapshot.discount_rate.source ?? ""}` : undefined,
                },
              ]}
            />
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              모델: {latestSnapshot!.name} {latestSnapshot!.adopted ? "· 채택됨" : latestSnapshot!.recommended ? "· 권고안" : ""}
            </p>
            <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="col-label text-left">드라이버</th>
                    <th className="text-left">분포</th>
                    <th className="text-right">값</th>
                    <th className="text-left">출처</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(snapshot.cases?.[0]?.drivers ?? {}).map(([key, d]) => (
                    <tr key={key}>
                      <td className="col-label">{DRIVER_LABELS[key] ?? key}</td>
                      <td>{d.dist}</td>
                      <td className="text-right tabular-nums">{driverValue(d)}</td>
                      <td className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{d.source ?? "—"}</td>
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
