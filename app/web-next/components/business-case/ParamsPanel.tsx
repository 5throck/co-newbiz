"use client";

// ParamsPanel — S8 시뮬레이션 파라미터 + 실행 스냅샷 (design
// 2026-09-18-s8-business-case-evaluation REQ-W5-2/3, REQ-W6-3).
// Resolution chain user > derived > default is shown with its provenance;
// the edit form records a bc.* user batch with a mandatory rationale, and
// the snapshot section renders the persisted job-spec of the latest
// generated model — the execution contract the results came from.

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { ColGroup, ParamTable } from "../ui.tsx";
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteProject } from "../../lib/project-write-access.ts";
import { s5ParamLinkage, type S5ParamKey } from "../../lib/s5-linkage-labels.ts";

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

/** user > derived > default made visible: three distinct chip tones, the raw source string stays as tooltip. */
type SourceKind = "user" | "derived" | "default";
const SOURCE_CHIP: Record<SourceKind, { label: string; cls: string }> = {
  user: { label: "사용자 확정", cls: "status-green" },
  derived: { label: "유도값", cls: "status-amber" },
  default: { label: "기본값", cls: "status-not-started" },
};
const sourceKindOf = (source: string): SourceKind => (source.startsWith("사용자") ? "user" : "default");

function SourceChip({ source, kind }: { source: string; kind?: SourceKind }) {
  const k = kind ?? sourceKindOf(source);
  return <span className={`status-chip whitespace-nowrap ${SOURCE_CHIP[k].cls}`} title={source}>{SOURCE_CHIP[k].label}</span>;
}

interface ResolvedParams {
  captureRate: number; captureSource: string;
  rampUp: number[]; rampSource: string;
  opexRatio: number; opexSource: string;
  capexRatio: number; capexSource: string;
  initialInvestmentRatio: number; initialInvestmentSource: string;
  investmentBasis: "ratio" | "s5_plan" | "s5_plan_full"; investmentBasisSource: string;
  s5PlanHorizonYears: number | null;
  /** ADR-0178 slice 0 - where the S5 plan comes from (copy default / pinned reference, opt-in). */
  s5Source?: "copy" | "pinned"; s5SourceSource?: string; s5PinId?: string | null;
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
/** ADR-0178 slice 0 - S5 plan pin state (read-only source row; actions live in the 설명·생성·권고 tab). */
interface S5PinStatusView {
  path: "copy" | "pinned";
  optedIn: boolean;
  reverted?: boolean;
  pin: { id: string; planHash: string; pinnedAt: string; pinnedBy: string; reason: "initial" | "repin"; s5SimRunId: string | null } | null;
  state: "not_applicable" | "in_effect" | "stale";
  stale: boolean;
  reasons: string[];
  caseGeneratedOnPin: string | null;
}

const INVESTMENT_BASIS_LABELS: Record<string, string> = {
  ratio: "비율 추정",
  s5_plan: "S5 투자 계획 (예전: 설비투자만)",
  s5_plan_full: "S5 투자 계획",
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

// Full-width parameter table (decider feedback 2026-10-16): fixed percentage columns, group header rows,
// one source chip per row, one `S5 연동` chip + reason per row (Green Field). Text values are left-aligned,
// numbers right-aligned. Display only - nothing here links or changes a value.
const PARAM_COL_PCT = [24, 24, 6, 14, 32] as const;
const PARAM_COL_PCT_NO_S5 = [30, 32, 8, 30] as const;

interface ParamLine {
  key: string;
  label: string;
  /** Numeric values right-align; text values left-align. */
  value: React.ReactNode;
  numeric?: boolean;
  unit?: string;
  source?: React.ReactNode;
  s5Key?: S5ParamKey;
  note?: React.ReactNode;
}

function CurrentParamsTable({ resolved, track, s5Pin, s5Run, s5PinCapexTotal }: { resolved: ResolvedParams; track: string | null; s5Pin: S5PinStatusView | null; s5Run: { id: string; drawCount: number } | null; s5PinCapexTotal: number | null }) {
  const gf = track === "greenfield";
  const pct1 = (v: number) => (v * 100).toFixed(1);
  const s5Source = s5Pin?.path === "pinned" && s5Pin.pin
    ? `S5와 연결됨 (기본) · 고정 참조 ${s5Pin.pin.id.slice(-8)} (${s5Pin.pin.pinnedAt.slice(0, 10)} · ${s5Pin.pin.pinnedBy})${s5Pin.pin.s5SimRunId ? ` · 시뮬레이션 ${s5Pin.pin.s5SimRunId.slice(-8)}` : ""}${s5Pin.state === "stale" ? " · 재평가 필요" : ""}`
    : s5Pin?.reverted
      ? `복사본 (사람이 되돌림)${s5Pin?.pin ? ` — 고정 참조 ${s5Pin.pin.id.slice(-8)} 있음, 사용하지 않음` : ""}`
      : `복사본${s5Pin?.pin ? ` — 고정 참조 ${s5Pin.pin.id.slice(-8)} 있음, 아직 첫 \`자동 생성\` 전` : ""}`;
  // Green Field collapses the two override rows into the rows they override (growth, volatility).
  const growthRow: ParamLine = gf
    ? resolved.growthOverride != null
      ? { key: "growth", label: "성장률", value: pct1(resolved.growthOverride), numeric: true, unit: "%", source: <SourceChip source={resolved.growthOverrideSource} kind="user" />, note: "사람 오버라이드" }
      : { key: "growth", label: "성장률", value: "시장 성장률에서 유도", source: <SourceChip source="시장 성장률 (opportunity)" kind="derived" /> }
    : { key: "growth", label: "성장률 오버라이드", value: resolved.growthOverride != null ? pct1(resolved.growthOverride) : "— (유도값 사용)", numeric: resolved.growthOverride != null, unit: resolved.growthOverride != null ? "%" : "", source: <SourceChip source={resolved.growthOverrideSource} /> };
  const sigmaRow: ParamLine = gf
    ? resolved.sigmaOverride != null
      ? { key: "sigma", label: "변동성", value: pct1(resolved.sigmaOverride), numeric: true, unit: "%", source: <SourceChip source={resolved.sigmaOverrideSource} kind="user" />, note: "사람 오버라이드", s5Key: "sigma" }
      : { key: "sigma", label: "변동성", value: "시장 기반 변동성 프로파일에서 유도", source: <SourceChip source="시장 기반 변동성 프로파일" kind="derived" />, s5Key: "sigma" }
    : { key: "sigma", label: "변동성 오버라이드", value: resolved.sigmaOverride != null ? pct1(resolved.sigmaOverride) : "— (유도값 사용)", numeric: resolved.sigmaOverride != null, unit: resolved.sigmaOverride != null ? "%" : "", source: <SourceChip source={resolved.sigmaOverrideSource} /> };
  const groups: Array<{ title: string; lines: ParamLine[] }> = [
    {
      title: "매출·시장",
      lines: [
        { key: "capture", label: "1년차 시장점유율 (year-1 매출)", value: pct1(resolved.captureRate), numeric: true, unit: "%", source: <SourceChip source={resolved.captureSource} />, s5Key: "capture" },
        growthRow,
        ...(!gf ? [{ key: "acq", label: "인수 EV/Revenue 배수 (브라운필드)", value: resolved.acquisitionEvRevenue != null ? resolved.acquisitionEvRevenue.toFixed(2) : "3.0 — 미확정 시 컴프 기본값 (글로벌 로보틱스 M&A 2–6×)", numeric: resolved.acquisitionEvRevenue != null, unit: resolved.acquisitionEvRevenue != null ? "배" : "", source: <SourceChip source={resolved.acquisitionEvRevenueSource} /> } as ParamLine] : []),
      ],
    },
    {
      title: "손익·투자",
      lines: [
        { key: "opex", label: "운영비 비율", value: pct1(resolved.opexRatio), numeric: true, unit: "%", source: <SourceChip source={resolved.opexSource} />, s5Key: "opex" },
        { key: "capex", label: "설비투자 비율", value: pct1(resolved.capexRatio), numeric: true, unit: "%", source: <SourceChip source={resolved.capexSource} />, s5Key: "capex" },
        { key: "initial", label: "초기투자 비율 (year-1 매출 대비)", value: pct1(resolved.initialInvestmentRatio), numeric: true, unit: "%", source: <SourceChip source={resolved.initialInvestmentSource} />, s5Key: "initial" },
        { key: "basis", label: "투자비 기준 (ADR-0174)", value: INVESTMENT_BASIS_LABELS[resolved.investmentBasis] ?? resolved.investmentBasis, source: <SourceChip source={resolved.investmentBasisSource} /> },
        ...(gf ? [{ key: "s5source", label: "S5 계획 출처 (ADR-0178)", value: s5Source, source: <SourceChip source={resolved.s5SourceSource ?? "기본값 (복사본, ADR-0178)"} /> } as ParamLine] : []),
        { key: "ramp", label: "가동률 램프업", value: resolved.rampUp.map((v) => v.toFixed(2)).join(" → "), unit: "비율", source: <SourceChip source={resolved.rampSource} />, s5Key: "ramp" },
      ],
    },
    {
      title: "시뮬레이션·할인",
      lines: [
        sigmaRow,
        { key: "iterations", label: "반복 수", value: resolved.iterations.toLocaleString(), numeric: true, unit: "회", source: <SourceChip source={resolved.iterationsSource} />, s5Key: "iterations" },
        { key: "horizon", label: "회수 기간", value: String(resolved.horizonYears), numeric: true, unit: "년", source: <SourceChip source={resolved.horizonSource} /> },
        ...(!gf ? [
          { key: "fade", label: "교차검증 창구 (페이드 DCF)", value: String(resolved.fadeHorizonYears), numeric: true, unit: "년", source: <SourceChip source={resolved.fadeHorizonSource} /> } as ParamLine,
          { key: "gterm", label: "말기 성장률 (페이드 DCF 수렴점)", value: resolved.growthTerminal != null ? pct1(resolved.growthTerminal) : "3.0 — 미확정 시 기본값", numeric: resolved.growthTerminal != null, unit: resolved.growthTerminal != null ? "%" : "", source: <SourceChip source={resolved.growthTerminalSource} /> } as ParamLine,
        ] : []),
      ],
    },
  ];
  const cols = gf ? PARAM_COL_PCT : PARAM_COL_PCT_NO_S5;
  return (
    <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
      <table className="data-table table-fixed-pct tmin-64" data-testid="s8-params-table">
        <caption className="sr-only">현재 시뮬레이션 파라미터</caption>
        <ColGroup widths={gf ? PARAM_COL_PCT : PARAM_COL_PCT_NO_S5} />
        <thead>
          <tr>
            <th scope="col">항목</th>
            <th scope="col">값</th>
            <th scope="col" className="whitespace-nowrap">단위</th>
            <th scope="col" className="whitespace-nowrap">출처</th>
            {gf && <th scope="col" className="whitespace-nowrap">S5 연동</th>}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.title}>
            <tr>
              <th scope="colgroup" colSpan={cols.length} className="text-left text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] bg-[color:var(--muted-bg)]">{g.title}</th>
            </tr>
            {g.lines.map((l) => {
              const cell = gf && l.s5Key ? s5ParamLinkage(l.s5Key, { basis: resolved.investmentBasis, run: s5Run, s8Iterations: resolved.iterations, planCapexZero: gf && s5Pin?.path === "pinned" && s5PinCapexTotal === 0 }) : null;
              return (
                <tr key={l.key} data-testid={`s8-param-${l.key}`}>
                  <th scope="row" className="text-left font-normal">{l.label}</th>
                  <td className={l.numeric ? "col-num tabular-nums font-semibold" : "text-left"}>
                    {l.value}{l.note && <> <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{l.note}</span></>}
                  </td>
                  <td className="whitespace-nowrap text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{l.unit ?? ""}</td>
                  <td>{l.source}</td>
                  {gf && (
                    <td data-testid={l.s5Key ? `s8-s5-link-${l.s5Key}` : undefined}>
                      {cell && (
                        <>
                          <span className={`status-chip whitespace-nowrap ${cell.kind === "s5" ? "status-green" : "status-amber"}`}>{cell.kind === "s5" ? "S5 값" : "가정값"}</span>
                          <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">{cell.detail}</div>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

export function ParamsPanel({ projectId, onOpenTargets }: { projectId: string; onOpenTargets?: () => void }) {
  const [resolved, setResolved] = useState<ResolvedParams | null>(null);
  const [s5Run, setS5Run] = useState<{ id: string; drawCount: number } | null>(null);
  const [s5Pin, setS5Pin] = useState<S5PinStatusView | null>(null);
  const [track, setTrack] = useState<string | null>(null);
  const [paramsCapexTotal, setParamsCapexTotal] = useState<number | null>(null);
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
      const params = await api.get<{ params: ResolvedParams; s5_connect?: { run: { id: string; drawCount: number } | null } | null; s5_pin?: S5PinStatusView | null }>(`/api/projects/${encodeURIComponent(projectId)}/business-case/params`);
      setResolved(params.data.params);
      setS5Run(params.data.s5_connect?.run ?? null);
      setS5Pin(params.data.s5_pin ?? null);
      setTrack((params.data as { track?: string | null }).track ?? null);
      setParamsCapexTotal((params.data as { s5_pin_capex_total_krw_m?: number | null }).s5_pin_capex_total_krw_m ?? null);
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
      setMessage(`저장 완료 — ${res.data.written.length}개 키 (run ${res.data.run_id}). 설명·생성·권고 탭에서 재생성하면 새 파라미터가 반영됩니다.`);
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
          <>
            <CurrentParamsTable resolved={resolved} track={track} s5Pin={s5Pin} s5Run={s5Run} s5PinCapexTotal={paramsCapexTotal} />
            {track === "greenfield" && s5Pin?.path === "pinned" && paramsCapexTotal === 0 && (
              <p role="note" data-testid="s8-params-capex-warning" className="text-[length:var(--fs-caption)] mt-2">
                <span className="status-chip status-amber"><span aria-hidden="true">⚠</span> 설비투자 없음</span>{" "}
                S5 계획에 설비투자(capex) 줄이 없습니다 — 설비투자가 있다면 S5 투자비 탭에 입력하세요.
              </p>
              )}

            {resolved.s5PlanHorizonYears != null && resolved.s5PlanHorizonYears !== resolved.horizonYears && (
              <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-2">
                ⚠ S5 검토 기간({resolved.s5PlanHorizonYears}년)과 사업계획 기간({resolved.horizonYears}년)이 다릅니다
              </p>
            )}
          </>
        )}
      </section>

      {/* 편집 폼 — 근거 필수 (REQ-W6-3) */}
      <section className="market-section sizing-step mt-3" aria-label="파라미터 확정">
        <h3 className="sizing-step-title">파라미터 확정 <span className="status-chip status-info">kind=user — 저장 후 재생성 시 반영</span></h3>
        <form className="grid gap-3" onSubmit={submit} style={{ maxWidth: 560 }}>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="grid gap-1 text-sm">1년차 시장점유율 (비율, 예: 0.005)<input className="form-input" value={form.capture_rate ?? ""} onChange={(e) => setForm({ ...form, capture_rate: e.target.value })} placeholder="0.005" /></label>
            <label className="grid gap-1 text-sm">운영비 비율 (예: 0.6)<input className="form-input" value={form.opex_ratio ?? ""} onChange={(e) => setForm({ ...form, opex_ratio: e.target.value })} placeholder="0.6" /></label>
            <label className="grid gap-1 text-sm">설비투자 비율 (예: 0.1)<input className="form-input" value={form.capex_ratio ?? ""} onChange={(e) => setForm({ ...form, capex_ratio: e.target.value })} placeholder="0.1" /></label>
            <label className="grid gap-1 text-sm">초기투자 비율 (예: 0.5)<input className="form-input" value={form.initial_investment_ratio ?? ""} onChange={(e) => setForm({ ...form, initial_investment_ratio: e.target.value })} placeholder="0.5" /></label>
            <label className="grid gap-1 text-sm">투자비 기준 (ADR-0174)
              <select className="form-input" value={form.investment_basis ?? ""} onChange={(e) => setForm({ ...form, investment_basis: e.target.value })}>
                <option value="">— 미변경 —</option>
                <option value="0">비율 추정 (기본)</option>
                <option value="2">S5 투자 계획</option>
                {form.investment_basis === "1" && <option value="1" disabled>S5 투자 계획 (예전: 설비투자만)</option>}
              </select>
            </label>
            {track === "greenfield" && (
              <label className="grid gap-1 text-sm">S5 계획 출처 (ADR-0178)
                <select className="form-input" value={form.s5_source ?? ""} onChange={(e) => setForm({ ...form, s5_source: e.target.value })}>
                  <option value="">— 미변경 —</option>
                  <option value="0">복사본으로 되돌림</option>
                  <option value="1" disabled={!s5Pin?.pin}>S5와 다시 연결 (고정 참조){s5Pin?.pin ? "" : " — 고정 참조 없음(먼저 연결하세요)"}</option>
                </select>
              </label>
            )}
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
          <label className="grid gap-1 text-sm">근거 (필수)<textarea className="form-input" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="시장 조사 결과 시장점유율 상향 — 출처/근거를 기재하세요" /></label>
          <button className="btn-ghost justify-self-start" type="submit">파라미터 확정</button>
          <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">확정된 값은 사용자 등급(user) 가정으로 기록됩니다. 설명·생성·권고 탭의 재생성을 실행하면 새 파라미터로 다시 시뮬레이션됩니다.</p>
        </form>
      </section>

      {/* EV/매출 밴드 확정 — 사람 전용 (경계 #2: 에이전트는 설정할 수 없음) */}
      <section className="market-section sizing-step mt-3" aria-label="EV/매출 밴드 확정">
        <h3 className="sizing-step-title">EV/매출 밴드 확정 <span className="status-chip status-info">사람 전용 — 에이전트는 설정할 수 없습니다</span></h3>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          확정한 밴드만 대상 비교의 범위 내/밖 표시 기준이 되며 순위·밸류에이션에는 영향이 없습니다.{" "}
          {onOpenTargets ? (
            <button type="button" className="text-[color:var(--accent)] font-bold" onClick={onOpenTargets}>밴드 상태는 대상 비교·선정 탭 →</button>
          ) : (
            <span>밴드 상태는 대상 비교·선정 탭.</span>
          )}
        </p>
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
            아직 저장된 실행 스냅샷이 없습니다{snapshotCases.length > 0 ? " (이 모델의 스냅샷은 구버전 형식입니다 — 재생성하면 기록됩니다)" : ""}. 설명·생성·권고 탭에서 생성을 실행하면 이곳에 해당 결과의 파라미터가 기록됩니다.
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
