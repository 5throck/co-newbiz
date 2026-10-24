"use client";

// ParamsPanel — S8 시뮬레이션 파라미터 + 실행 스냅샷 (design
// 2026-09-18-s8-business-case-evaluation REQ-W5-2/3, REQ-W6-3).
// Resolution chain user > derived > default is shown with its provenance;
// the edit form records a bc.* user batch with a mandatory rationale, and
// the snapshot section renders the persisted job-spec of the latest
// generated model — the execution contract the results came from.

import { TranslatorFn } from "../../i18n/config.ts";
import { useCallback, useEffect, useState } from "react";
import { KO_DATA } from "../../lib/ko-data-values.ts";
import { api } from "../../lib/api.ts";
import { ColGroup, ParamTable } from "../ui.tsx";
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteProject } from "../../lib/project-write-access.ts";
import { s5ParamLinkage, type S5ParamKey } from "../../lib/s5-linkage-labels.ts";
import { ANCHOR_SCOPE_CONFIDENCE_NOTE, type AnchorScopeFlag } from "../../lib/anchor-scope.ts";
import { SHARE_UN_SOURCED_LABEL, captureSourceLabel, isShareUnsourced, shareUnsourcedLabel } from "../../lib/share-guard.ts";
import { useTranslations } from "next-intl";

// Mirrors EV_BAND_OPTIMISM_FLAG_FACTOR / EV_BAND_MAX_SANE / EV_BAND_SPREAD_FLAG_RATIO / ACQUISITION_EV_REVENUE_BAND in
// lib/business-case-generator.ts (DB-bound module, not bundleable here); drift is caught by
// tests/unit/business-case-targets.test.ts. The server stays authoritative.
const EV_BAND_OPTIMISM_FLAG_FACTOR = 1.5;
const EV_BAND_MAX_SANE = 50;
const EV_BAND_SPREAD_FLAG_RATIO = 4.5;
const EV_BAND_REF = { min: 2, max: 6 } as const;

interface ConfirmedBand { min: number; max: number; rationale: string; source: string; confirmedBy: string; confirmedAt: string }

function validateBand(minRaw: string, maxRaw: string, defaultRaw: string, rationale: string, source: string, t: TranslatorFn) {
  const errs: { min?: string; max?: string; default?: string; rationale?: string; source?: string } = {};
  const min = minRaw.trim() === "" ? NaN : Number(minRaw);
  const max = maxRaw.trim() === "" ? NaN : Number(maxRaw);
  const def = defaultRaw.trim() === "" ? null : Number(defaultRaw);
  if (!Number.isFinite(min) || min <= 0) errs.min = t("theLowerBoundMustBe");
  if (!Number.isFinite(max)) errs.max = t("theUpperBoundMustBe");
  else if (max > EV_BAND_MAX_SANE) errs.max = t("theUpperBoundMustBe2", { p1: EV_BAND_MAX_SANE });
  if (!errs.min && !errs.max && min >= max) errs.max = t("theLowerBoundMustBe2");
  if (def !== null) {
    if (!Number.isFinite(def) || def <= 0) errs.default = t("theDefaultMultipleMustBe");
    else if (!errs.min && !errs.max && (def < min || def > max)) errs.default = t("theDefaultMultipleMustLie");
  }
  if (rationale.trim().length < 10) errs.rationale = t("enterAtLeast10Characters");
  if (source.trim().length < 3) errs.source = t("enterAtLeast3Characters");
  return { errs, min, max, default: def, valid: Object.keys(errs).length === 0 };
}

/** user > derived > default made visible: three distinct chip tones, the raw source string stays as tooltip. */
type SourceKind = "user" | "derived" | "default";
const SOURCE_CHIP = (tr: TranslatorFn): Record<SourceKind, { label: string; cls: string }> => ({
  user: { label: "stages.s8.paramsPanel.userConfirmed", cls: "status-green" },
  derived: { label: "stages.s8.paramsPanel.derivedValue", cls: "status-amber" },
  default: { label: "common.defaultValue", cls: "status-not-started" },
});
const sourceKindOf = (source: string): SourceKind => (source.startsWith(KO_DATA.sourceUserPrefix) ? "user" : "default");

function SourceChip({ source, kind, label }: { source: string; kind?: SourceKind; label?: string }) {const tr = useTranslations(); 
  const k = kind ?? sourceKindOf(source);
  return <span className={`status-chip whitespace-nowrap ${SOURCE_CHIP(tr)[k].cls}`} title={source}>{label ?? SOURCE_CHIP(tr)[k].label}</span>;
}

interface ResolvedParams {
  captureRate: number; captureSource: string;
  rampUp: number[]; rampSource: string;
  opexRatio: number; opexSource: string;
  capexRatio: number; capexSource: string;
  initialInvestmentRatio: number; initialInvestmentSource: string;
  investmentBasis: "ratio" | "s5_plan" | "s5_plan_full" | "s5_pnl"; investmentBasisSource: string;
  s5PlanHorizonYears: number | null;
  /** ADR-0178 slice 0 - where the S5 plan comes from (copy default / pinned reference, opt-in). */
  s5Source?: "copy" | "pinned"; s5SourceSource?: string; s5PinId?: string | null;
  acquisitionEvRevenue: number | null; acquisitionEvRevenueSource: string;
  exitEvRevenue: number | null; exitEvRevenueSource: string;
  acquisitionEvRevenueBand?: ConfirmedBand | null;
  fadeHorizonYears: number; fadeHorizonSource: string;
  growthTerminal: number | null; growthTerminalSource: string;
  growthOverride: number | null; growthOverrideSource: string;
  sigmaOverride: number | null; sigmaOverrideSource: string;
  horizonYears: number; horizonSource: string;
  iterations: number; iterationsSource: string;
  irrFlagThreshold?: number; irrFlagThresholdSource?: string;
  irrCautionThreshold?: number; irrCautionThresholdSource?: string;
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

const INVESTMENT_BASIS_LABELS = (tr: TranslatorFn): Record<string, string> => ({
  ratio: "stages.s8.paramsPanel.ratioEstimate",
  s5_plan: "stages.s8.paramsPanel.s5InvestmentPlanFormerlyCapex",
  s5_plan_full: "stages.s8.paramsPanel.s5InvestmentPlan",
  s5_pnl: "stages.s8.paramsPanel.s5PlannedPL",
});

const DRIVER_LABELS = (tr: TranslatorFn): Record<string, string> => ({
  revenue_y1: "stages.s8.paramsPanel.revenue",
  ramp_up: "stages.s8.paramsPanel.utilization",
  revenue_growth: "stages.s8.paramsPanel.revenueGrowthRate",
  opex_ratio: "stages.s8.paramsPanel.operatingCostRatio",
  capex_ratio: "stages.s8.paramsPanel.capexRatio",
  initial_investment: "stages.s8.paramsPanel.initialInvestment",
  exit_ev_revenue: "stages.s8.paramsPanel.exitEvRevenueMultipleAt",
});

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

function CurrentParamsTable({ resolved, track, s5Pin, s5Run, s5PinCapexTotal, anchorScope }: { resolved: ResolvedParams; track: string | null; s5Pin: S5PinStatusView | null; s5Run: { id: string; drawCount: number } | null; s5PinCapexTotal: number | null; anchorScope: AnchorScopeFlag | null }) {const tr = useTranslations(); const t = useTranslations("stages.s8.paramsPanel"); const tc = useTranslations("common");
  const gf = track === "greenfield";
  const pct1 = (v: number) => (v * 100).toFixed(1);
  const s5Source = s5Pin?.path === "pinned" && s5Pin.pin
    ? t("linkedToS5DefaultFixedReferenceP1P2P3P4P5", { p1: s5Pin.pin.id.slice(-8), p2: s5Pin.pin.pinnedAt.slice(0, 10), p3: s5Pin.pin.pinnedBy, p4: s5Pin.pin.s5SimRunId ? t("simulationP1", { p1: s5Pin.pin.s5SimRunId.slice(-8) }) : "", p5: s5Pin.state === "stale" ? t("reassessmentNeeded") : "" })
    : s5Pin?.reverted
      ? t("copyRevertedByAPersonP1", { p1: s5Pin?.pin ? t("fixedReferenceP1ExistsBut", { p1: s5Pin.pin.id.slice(-8) }) : "" })
      : t("copyP1", { p1: s5Pin?.pin ? t("fixedReferenceP1ExistsBefore", { p1: s5Pin.pin.id.slice(-8) }) : "" });
  // Green Field collapses the two override rows into the rows they override (growth, volatility).
  const growthRow: ParamLine = gf
    ? resolved.growthOverride != null
      ? { key: "growth", label: tc("growthRate"), value: pct1(resolved.growthOverride), numeric: true, unit: "%", source: <SourceChip source={resolved.growthOverrideSource} kind="user" />, note: t("humanOverride") }
      : { key: "growth", label: tc("growthRate"), value: t("derivedFromTheMarketGrowth"), source: <SourceChip source={tc("marketGrowthOpportunity")} kind="derived" /> }
    : { key: "growth", label: t("growthRateOverride"), value: resolved.growthOverride != null ? pct1(resolved.growthOverride) : t("derivedValueUsed"), numeric: resolved.growthOverride != null, unit: resolved.growthOverride != null ? "%" : "", source: <SourceChip source={resolved.growthOverrideSource} /> };
  const sigmaRow: ParamLine = gf
    ? resolved.sigmaOverride != null
      ? { key: "sigma", label: t("volatility"), value: pct1(resolved.sigmaOverride), numeric: true, unit: "%", source: <SourceChip source={resolved.sigmaOverrideSource} kind="user" />, note: t("humanOverride2"), s5Key: "sigma" }
      : { key: "sigma", label: t("volatility2"), value: t("derivedFromTheVolatilityProfile"), source: <SourceChip source={t("volatilityProfile")} kind="derived" />, s5Key: "sigma" }
    : { key: "sigma", label: t("volatilityOverride"), value: resolved.sigmaOverride != null ? pct1(resolved.sigmaOverride) : t("derivedValueUsed2"), numeric: resolved.sigmaOverride != null, unit: resolved.sigmaOverride != null ? "%" : "", source: <SourceChip source={resolved.sigmaOverrideSource} /> };
  const groups: Array<{ title: string; lines: ParamLine[] }> = [
    {
      title: t("revenueAndMarket"),
      lines: [
        { key: "capture", label: t("marketShareRevenue"), value: pct1(resolved.captureRate), numeric: true, unit: "%", source: <SourceChip source={resolved.captureSource} label={captureSourceLabel(resolved.captureSource, resolved.captureRate)} />, s5Key: "capture", note: (
          <>
            {isShareUnsourced(resolved.captureSource) && (
              <span data-testid="params-share-unsourced-flag" className="status-chip status-amber" title={t("p1NotAMarketShare", { p1: shareUnsourcedLabel(resolved.captureRate) })}>
                {shareUnsourcedLabel(resolved.captureRate)}
              </span>
            )}{" "}
            {anchorScope && anchorScope.status !== "ok" && (
              <span data-testid="params-anchor-scope-flag" title={`${anchorScope.reason} — ${ANCHOR_SCOPE_CONFIDENCE_NOTE}`}>
                <span className="status-chip status-amber">{anchorScope.label}</span>{" "}
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{anchorScope.reason}</span>
              </span>
            )}
          </>
        ) },
        growthRow,
        ...(!gf ? [
          { key: "acq", label: t("acquisitionEvRevenueMultipleBrownfield"), value: resolved.acquisitionEvRevenue != null ? resolved.acquisitionEvRevenue.toFixed(2) : t("n30ScreeningPlaceholderWhen"), numeric: resolved.acquisitionEvRevenue != null, unit: resolved.acquisitionEvRevenue != null ? t("x") : "", source: <SourceChip source={resolved.acquisitionEvRevenueSource} /> } as ParamLine,
          { key: "exitEv", label: t("exitEvRevenueMultipleBrownfield"), value: resolved.exitEvRevenue != null ? resolved.exitEvRevenue.toFixed(2) : t("sameAsTheEntryMultiple"), numeric: resolved.exitEvRevenue != null, unit: resolved.exitEvRevenue != null ? t("x2") : "", source: <SourceChip source={resolved.exitEvRevenueSource} /> } as ParamLine,
        ] : []),
      ],
    },
    {
      title: t("pLAndInvestment"),
      lines: [
        { key: "opex", label: t("operatingCostRatio2"), value: pct1(resolved.opexRatio), numeric: true, unit: "%", source: <SourceChip source={resolved.opexSource} />, s5Key: "opex" },
        { key: "capex", label: t("capexRatio2"), value: pct1(resolved.capexRatio), numeric: true, unit: "%", source: <SourceChip source={resolved.capexSource} />, s5Key: "capex" },
        { key: "initial", label: t("initialInvestmentRatioVsRevenue"), value: pct1(resolved.initialInvestmentRatio), numeric: true, unit: "%", source: <SourceChip source={resolved.initialInvestmentSource} />, s5Key: "initial" },
        { key: "basis", label: t("investmentBasis"), value: INVESTMENT_BASIS_LABELS(tr)[resolved.investmentBasis] ?? resolved.investmentBasis, source: <SourceChip source={resolved.investmentBasisSource} /> },
        ...(gf ? [{ key: "s5source", label: t("s5PlanSource"), value: s5Source, source: <SourceChip source={resolved.s5SourceSource ?? t("defaultCopy")} /> } as ParamLine] : []),
        { key: "ramp", label: t("utilization2"), value: resolved.rampUp.map((v) => v.toFixed(2)).join(" → "), unit: t("ratio"), source: <SourceChip source={resolved.rampSource} />, s5Key: "ramp" },
      ],
    },
    {
      title: t("simulationAndDiscounting"),
      lines: [
        sigmaRow,
        { key: "iterations", label: tc("iterations"), value: resolved.iterations.toLocaleString(), numeric: true, unit: tc("timesUnit"), source: <SourceChip source={resolved.iterationsSource} />, s5Key: "iterations" },
        // ADR-0179 slice 1 — IRR ceiling guard thresholds. Person-settable display metadata.
        { key: "irr_flag", label: t("irrExtremeValueThreshold"), value: resolved.irrFlagThreshold != null ? pct1(resolved.irrFlagThreshold) : "100.0%", numeric: true, unit: t("yr"), source: <SourceChip source={resolved.irrFlagThresholdSource ?? tc("defaultValue")} /> },
        { key: "irr_caution", label: t("irrCautionThreshold"), value: resolved.irrCautionThreshold != null ? pct1(resolved.irrCautionThreshold) : "50.0%", numeric: true, unit: t("yr2"), source: <SourceChip source={resolved.irrCautionThresholdSource ?? tc("defaultValue")} /> },
        { key: "horizon", label: t("paybackPeriod"), value: String(resolved.horizonYears), numeric: true, unit: tc("year"), source: <SourceChip source={resolved.horizonSource} /> },
        ...(!gf ? [
          { key: "fade", label: t("windowFadedDcf"), value: String(resolved.fadeHorizonYears), numeric: true, unit: tc("year"), source: <SourceChip source={resolved.fadeHorizonSource} /> } as ParamLine,
          { key: "gterm", label: t("terminalGrowthRateFadedDcf"), value: resolved.growthTerminal != null ? pct1(resolved.growthTerminal) : t("n30DefaultWhenNot"), numeric: resolved.growthTerminal != null, unit: resolved.growthTerminal != null ? "%" : "", source: <SourceChip source={resolved.growthTerminalSource} /> } as ParamLine,
        ] : []),
      ],
    },
  ];
  const cols = gf ? PARAM_COL_PCT : PARAM_COL_PCT_NO_S5;
  return (
    <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
      <table className="data-table table-fixed-pct tmin-64" data-testid="s8-params-table">
        <caption className="sr-only">{t("currentSimulationParameters")}</caption>
        <ColGroup widths={gf ? PARAM_COL_PCT : PARAM_COL_PCT_NO_S5} />
        <thead>
          <tr>
            <th scope="col">{tc("items")}</th>
            <th scope="col" className="col-num">{tc("value")}</th>
            <th scope="col" className="whitespace-nowrap">{tc("unit")}</th>
            <th scope="col" className="whitespace-nowrap">{tc("source")}</th>
            {gf && <th scope="col" className="whitespace-nowrap">{t("s5Integration")}</th>}
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
                          <span className={`status-chip whitespace-nowrap ${cell.kind === "s5" ? "status-green" : "status-amber"}`}>{cell.kind === "s5" ? t("s5Value") : t("assumptionValue")}</span>
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

export function ParamsPanel({ projectId, onOpenTargets }: { projectId: string; onOpenTargets?: () => void }) {const tr = useTranslations(); const t = useTranslations("stages.s8.paramsPanel"); const tc = useTranslations("common");
  const [resolved, setResolved] = useState<ResolvedParams | null>(null);
  const [s5Run, setS5Run] = useState<{ id: string; drawCount: number } | null>(null);
  const [s5Pin, setS5Pin] = useState<S5PinStatusView | null>(null);
  const [anchorScope, setAnchorScope] = useState<AnchorScopeFlag | null>(null);
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
  const [bandDefault, setBandDefault] = useState("");
  const [bandRationale, setBandRationale] = useState("");
  const [bandSource, setBandSource] = useState("");
  const [bandTouched, setBandTouched] = useState(false);
  const [bandMsg, setBandMsg] = useState<string | null>(null);
  const [bandErr, setBandErr] = useState<string | null>(null);
  const [bandBusy, setBandBusy] = useState(false);
  const [bandAiBusy, setBandAiBusy] = useState(false);
  const [bandAiNote, setBandAiNote] = useState<string | null>(null);
  const bandCheck = validateBand(bandMin, bandMax, bandDefault, bandRationale, bandSource, t);

  // 2026-10-19 decider direction — AI 밴드 추천: the LLM drafts the band; the draft
  // only PREFILLS this form and the person still confirms through 밴드 확정 (boundary #2).
  async function recommendBand() {
    setBandAiNote(null);
    setBandAiBusy(true);
    try {
      const r = await api.post<{ draft: { min: number; max: number; default?: number; rationale: string; source: string } | null; source: string; note: string }>(
        `/api/projects/${encodeURIComponent(projectId)}/business-case/ev-band/recommend`,
      );
      setBandAiNote(r.data.note);
      if (r.data.draft) {
        setBandMin(String(r.data.draft.min));
        setBandMax(String(r.data.draft.max));
        setBandDefault(r.data.draft.default !== undefined ? String(r.data.draft.default) : "");
        setBandRationale(r.data.draft.rationale);
        setBandSource(r.data.draft.source);
      }
    } catch (err) {
      setBandAiNote(err instanceof Error ? err.message : t("aiRecommendationFailed"));
    } finally {
      setBandAiBusy(false);
    }
  }

  async function submitBand(e: React.FormEvent) {
    e.preventDefault();
    setBandMsg(null);
    setBandErr(null);
    setBandTouched(true);
    if (!bandCheck.valid) return;
    setBandBusy(true);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/business-case/ev-band`, {
        min: bandCheck.min, max: bandCheck.max,
        ...(bandCheck.default !== null ? { default: bandCheck.default } : {}),
        rationale: bandRationale.trim(), source: bandSource.trim(),
      });
      setBandMsg(t("bandConfirmedReflectedInThe"));
      setBandMin(""); setBandMax(""); setBandDefault(""); setBandRationale(""); setBandSource(""); setBandTouched(false);
      load();
    } catch (err) {
      setBandErr(err instanceof Error ? err.message : t("failedToConfirmTheBand"));
    } finally {
      setBandBusy(false);
    }
  }

  const load = useCallback(async () => {
    try {
      const params = await api.get<{ params: ResolvedParams; s5_connect?: { run: { id: string; drawCount: number } | null } | null; s5_pin?: S5PinStatusView | null; anchor_scope?: AnchorScopeFlag | null }>(`/api/projects/${encodeURIComponent(projectId)}/business-case/params`);
      setResolved(params.data.params);
      setS5Run(params.data.s5_connect?.run ?? null);
      setS5Pin(params.data.s5_pin ?? null);
      setAnchorScope(params.data.anchor_scope ?? null);
      setTrack((params.data as { track?: string | null }).track ?? null);
      setParamsCapexTotal((params.data as { s5_pin_capex_total_krw_m?: number | null }).s5_pin_capex_total_krw_m ?? null);
      const casesRes = await api.get<{ cases: CaseSummary[] }>(`/api/projects/${encodeURIComponent(projectId)}/business-case`);
      setCases(casesRes.data.cases);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failedToLoadParameters"));
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
      setError(t("confirmingParametersRequiresARationale"));
      return;
    }
    const params: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(form)) {
      if (raw.trim() !== "") params[key] = Number(raw);
    }
    const rampValues = ramp.filter((v) => v.trim() !== "");
    if (rampValues.length > 0) params.ramp_up = rampValues.map((v) => Number(v));
    if (Object.keys(params).length === 0) {
      setError(t("enterAtLeastOneValue"));
      return;
    }
    try {
      const res = await api.post<{ written: string[]; run_id: string }>(
        `/api/projects/${encodeURIComponent(projectId)}/business-case/params`,
        { params, rationale },
      );
      setMessage(t("savedP1KeysRunP2", { p1: res.data.written.length, p2: res.data.run_id }));
      setForm({});
      setRamp(["", "", "", "", ""]);
      setRationale("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToSaveTheParameters"));
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
      <section className="market-section sizing-step" aria-label={t("currentParameters")}>
        <h3 className="sizing-step-title">{t("simulationParameters")} <span className="status-chip status-info">{t("interpretationPrecedenceUserConfirmedDerived")}</span></h3>
        {!resolved ? (
          <p>{tc("loading")}</p>
        ) : (
          <>
            <CurrentParamsTable resolved={resolved} track={track} s5Pin={s5Pin} s5Run={s5Run} s5PinCapexTotal={paramsCapexTotal} anchorScope={anchorScope} />
            {track === "greenfield" && s5Pin?.path === "pinned" && paramsCapexTotal === 0 && (
              <p role="note" data-testid="s8-params-capex-warning" className="text-[length:var(--fs-caption)] mt-2">
                <span className="status-chip status-amber"><span aria-hidden="true">⚠</span> {t("noCapex")}</span>{" "}
                {t("theS5PlanHasNo")}
              </p>
              )}

            {resolved.s5PlanHorizonYears != null && resolved.s5PlanHorizonYears !== resolved.horizonYears && (
              <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-2">
                {t("s5ReviewPeriod")}{resolved.s5PlanHorizonYears}{t("yrAndTheHorizon")}{resolved.horizonYears}{t("yrDiffer")}
              </p>
            )}
          </>
        )}
      </section>

      {/* 편집 폼 — 근거 필수 (REQ-W6-3) */}
      <section className="market-section sizing-step mt-3" aria-label={t("confirmParameters")}>
        <h3 className="sizing-step-title">{t("confirmParameters2")} <span className="status-chip status-info">{t("reflectedWhenRegeneratingAfterSave")}</span></h3>
        <form className="grid gap-3" onSubmit={submit} style={{ maxWidth: 560 }}>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="grid gap-1 text-sm">{t("marketShareRatioEG")}<input className="form-input" value={form.capture_rate ?? ""} onChange={(e) => setForm({ ...form, capture_rate: e.target.value })} placeholder="0.005" /></label>
            <label className="grid gap-1 text-sm">{t("operatingCostRatioEG")}<input className="form-input" value={form.opex_ratio ?? ""} onChange={(e) => setForm({ ...form, opex_ratio: e.target.value })} placeholder="0.6" /></label>
            <label className="grid gap-1 text-sm">{t("capexRatioEG0")}<input className="form-input" value={form.capex_ratio ?? ""} onChange={(e) => setForm({ ...form, capex_ratio: e.target.value })} placeholder="0.1" /></label>
            <label className="grid gap-1 text-sm">{t("initialInvestmentRatioEG")}<input className="form-input" value={form.initial_investment_ratio ?? ""} onChange={(e) => setForm({ ...form, initial_investment_ratio: e.target.value })} placeholder="0.5" /></label>
            <label className="grid gap-1 text-sm">{t("investmentBasis2")}
              <select className="form-input" value={form.investment_basis ?? ""} onChange={(e) => setForm({ ...form, investment_basis: e.target.value })}>
                <option value="">{t("unchanged")}</option>
                <option value="0">{t("ratioEstimateDefault")}</option>
                <option value="2">{t("s5InvestmentPlan2")}</option>
                <option value="3" disabled={!(track === "greenfield" && s5Pin?.path === "pinned")}>{t("s5PlannedPL2")}{track === "greenfield" && s5Pin?.path === "pinned" ? "" : t("selectableOnlyWhenLinkedTo")}</option>
                {form.investment_basis === "1" && <option value="1" disabled>{t("s5InvestmentPlanFormerlyCapex2")}</option>}
              </select>
            </label>
            {track === "greenfield" && (
              <label className="grid gap-1 text-sm">{t("s5PlanSource2")}
                <select className="form-input" value={form.s5_source ?? ""} onChange={(e) => setForm({ ...form, s5_source: e.target.value })}>
                  <option value="">{t("unchanged2")}</option>
                  <option value="0">{t("revertedToTheCopy")}</option>
                  <option value="1" disabled={!s5Pin?.pin}>{t("toS5FixedReference")}{s5Pin?.pin ? "" : t("noFixedReferenceLinkIt")}</option>
                </select>
              </label>
            )}
            <label className="grid gap-1 text-sm">{t("exitMultipleEvRevenueDefaults")}<input className="form-input" value={form.exit_ev_revenue ?? ""} onChange={(e) => setForm({ ...form, exit_ev_revenue: e.target.value })} placeholder={t("emptyAcquisitionMultiple")} /></label>
            <label className="grid gap-1 text-sm">{t("windowFadedDcfYearsE")}<input className="form-input" value={form.fade_horizon_years ?? ""} onChange={(e) => setForm({ ...form, fade_horizon_years: e.target.value })} placeholder="10" /></label>
            <label className="grid gap-1 text-sm">{t("terminalGrowthRateRatioE")}<input className="form-input" value={form.growth_terminal ?? ""} onChange={(e) => setForm({ ...form, growth_terminal: e.target.value })} placeholder="0.03" /></label>
            <label className="grid gap-1 text-sm">{t("growthRateOverrideRatio")}<input className="form-input" value={form.growth_override ?? ""} onChange={(e) => setForm({ ...form, growth_override: e.target.value })} placeholder="0.05" /></label>
            <label className="grid gap-1 text-sm">{t("volatilityOverrideRatio")}<input className="form-input" value={form.sigma_override ?? ""} onChange={(e) => setForm({ ...form, sigma_override: e.target.value })} placeholder="0.03" /></label>
            <label className="grid gap-1 text-sm">{t("paybackPeriodYears")}<input className="form-input" value={form.horizon_years ?? ""} onChange={(e) => setForm({ ...form, horizon_years: e.target.value })} placeholder="5" /></label>
            <label className="grid gap-1 text-sm">{tc("iterations")}<input className="form-input" value={form.iterations ?? ""} onChange={(e) => setForm({ ...form, iterations: e.target.value })} placeholder="2000" /></label>
            <label className="grid gap-1 text-sm">{t("irrExtremeValueThresholdRatio")}<input className="form-input" value={form.irr_flag_threshold ?? ""} onChange={(e) => setForm({ ...form, irr_flag_threshold: e.target.value })} placeholder="1.0" /></label>
            <label className="grid gap-1 text-sm">{t("irrCautionThresholdRatioE")}<input className="form-input" value={form.irr_caution_threshold ?? ""} onChange={(e) => setForm({ ...form, irr_caution_threshold: e.target.value })} placeholder="0.5" /></label>
          </div>
          <div>
            <p className="text-sm text-[color:var(--muted-fg)] mb-1">{t("utilizationByYearPartialEntry")}</p>
            <div className="flex gap-2">
              {ramp.map((v, i) => (
                <input
                  key={i}
                  className="form-input w-20"
                  aria-label={t("utilizationYearP1", { p1: i + 1 })}
                  value={v}
                  onChange={(e) => setRamp(ramp.map((x, j) => (j === i ? e.target.value : x)))}
                  placeholder={`y${i + 1}`}
                />
              ))}
            </div>
          </div>
          <label className="grid gap-1 text-sm">{tc("evidenceRequiredMark")}<textarea className="form-input" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder={t("marketResearchRaisedTheMarket")} /></label>
          <button className="btn-ghost justify-self-start" type="submit">{t("confirmParameters3")}</button>
          <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("confirmedValuesAreRecordedAs")}</p>
        </form>
      </section>

      {/* EV/매출 밴드 확정 — 사람 전용 (경계 #2: 에이전트는 설정할 수 없음) */}
      <section className="market-section sizing-step mt-3" aria-label={t("confirmEvRevenueBand")}>
        <h3 className="sizing-step-title">{t("confirmEvRevenueBand2")} <span className="status-chip status-info">{t("humanOnlyAnAgentCannot")}</span></h3>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          {t("thisBandIsBrownfield")} <b>{tc("acquisitionPrice")}</b> {t("sizingTargetRevenueEvRevenue")}{" "}
          <b>{t("defaultMultiple")}</b>{t("isConfirmedTheAcquisitionPrice")}{" "}
          <b>{t("n30xBand")}</b>{t("appliesTheExitValueFollows")} <b>{t("exitMultiple")}</b>{t("whenUnconfirmedTheAcquisitionMultiple")}{" "}
          {onOpenTargets ? (
            <button type="button" className="text-[color:var(--accent)] font-bold" onClick={onOpenTargets}>{t("bandStatusIsInThe")}</button>
          ) : (
            <span>{t("bandStatusIsInThe2")}</span>
          )}
        </p>
        {!canAct ? (
          <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            <span className="status-chip status-not-started mr-1">{tc("readOnly")}</span>
            {t("theCurrentRoleCannotConfirm")}
          </p>
        ) : (
          <>
          <div className="flex items-center gap-2 mb-2">
            <button type="button" className="btn-ghost btn-sm" disabled={bandAiBusy} onClick={() => void recommendBand()} data-testid="evband-ai-recommend">
              {bandAiBusy ? t("generatingAiRecommendation") : t("aiBandRecommendation")}
            </button>
            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("draftsFromTheTargetS")}</span>
          </div>
          {bandAiNote && (
            <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="evband-ai-note">{bandAiNote}</p>
          )}
          <form className="grid gap-3" onSubmit={submitBand} noValidate style={{ maxWidth: 560 }}>
            <div className="grid gap-2 md:grid-cols-3">
              <label className="grid gap-1 text-sm" htmlFor="evband-min">{t("lowerBoundXRequired")}
                <input id="evband-min" className="form-input" inputMode="decimal" value={bandMin} onChange={(e) => setBandMin(e.target.value)} placeholder="2" aria-invalid={bandTouched && !!bandCheck.errs.min} aria-describedby={bandTouched && bandCheck.errs.min ? "evband-min-err" : undefined} />
                {bandTouched && bandCheck.errs.min && <span id="evband-min-err" role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {bandCheck.errs.min}</span>}
              </label>
              <label className="grid gap-1 text-sm" htmlFor="evband-max">{t("upperBoundXRequired")}
                <input id="evband-max" className="form-input" inputMode="decimal" value={bandMax} onChange={(e) => setBandMax(e.target.value)} placeholder="6" aria-invalid={bandTouched && !!bandCheck.errs.max} aria-describedby={bandTouched && bandCheck.errs.max ? "evband-max-err" : undefined} />
                {bandTouched && bandCheck.errs.max && <span id="evband-max-err" role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {bandCheck.errs.max}</span>}
              </label>
              <label className="grid gap-1 text-sm" htmlFor="evband-default">{t("defaultMultipleXOptionalWithin")}
                <input id="evband-default" className="form-input" inputMode="decimal" value={bandDefault} onChange={(e) => setBandDefault(e.target.value)} placeholder="3" aria-invalid={bandTouched && !!bandCheck.errs.default} aria-describedby={bandTouched && bandCheck.errs.default ? "evband-default-err" : undefined} />
                {bandTouched && bandCheck.errs.default && <span id="evband-default-err" role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {bandCheck.errs.default}</span>}
              </label>
            </div>
            <label className="grid gap-1 text-sm" htmlFor="evband-rationale">{t("evidenceRequired10Chars")}
              <textarea id="evband-rationale" className="form-input" value={bandRationale} onChange={(e) => setBandRationale(e.target.value)} aria-invalid={bandTouched && !!bandCheck.errs.rationale} aria-describedby={bandTouched && bandCheck.errs.rationale ? "evband-rationale-err" : undefined} placeholder={t("recordWhyThisBandWas")} />
              {bandTouched && bandCheck.errs.rationale && <span id="evband-rationale-err" role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {bandCheck.errs.rationale}</span>}
            </label>
            <label className="grid gap-1 text-sm" htmlFor="evband-source">{t("sourceRequired3Chars")}
              <input id="evband-source" className="form-input" value={bandSource} onChange={(e) => setBandSource(e.target.value)} aria-invalid={bandTouched && !!bandCheck.errs.source} aria-describedby={bandTouched && bandCheck.errs.source ? "evband-source-err" : undefined} placeholder={t("literatureDocumentsUrlsOrManagement")} />
              {bandTouched && bandCheck.errs.source && <span id="evband-source-err" role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {bandCheck.errs.source}</span>}
            </label>
            <button className="btn-ghost justify-self-start" type="submit" disabled={bandBusy}>{bandBusy ? t("confirming") : t("confirmBand")}</button>
            {bandErr && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {bandErr}</p>}
            {bandMsg && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)]">✓ {bandMsg}</p>}
          </form>
          </>
        )}
      </section>

      {/* 실행 스냅샷 — 최근 생성 모델의 job-spec (REQ-W5-1/2) */}
      <section className="market-section sizing-step mt-3" aria-label={t("executionSnapshot")}>
        <h3 className="sizing-step-title">{t("executionSnapshot2")} <span className="status-chip status-info">{t("runContractOfTheLatest")}</span></h3>
        {!snapshot ? (
          <p className="text-sm text-[color:var(--muted-fg)]">
            {t("noSavedExecutionSnapshotYet")}{snapshotCases.length > 0 ? t("thisModelSnapshotIsIn") : ""}{t("runningGenerationInTheExplanation")}
          </p>
        ) : (
          <>
            <ParamTable
              caption={t("simulationRunConditions")}
              labelHeader={t("conditions")}
              rows={[
                { label: tc("iterations"), value: (snapshot.iterations ?? 0).toLocaleString(), unit: tc("timesUnit") },
                { label: t("paybackPeriod2"), value: String(snapshot.horizon_years), unit: tc("year") },
                {
                  label: t("discountRate"),
                  value: snapshot.discount_rate ? pct(snapshot.discount_rate.value) : "—",
                  source: snapshot.discount_rate ? `${snapshot.discount_rate.subject} · ${snapshot.discount_rate.source ?? ""}` : undefined,
                },
              ]}
            />
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              {t("model")} {latestSnapshot!.name} {latestSnapshot!.adopted ? t("adopted") : latestSnapshot!.recommended ? t("recommendation") : ""}
            </p>
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
              <table className="data-table">
                <caption className="sr-only">{t("simulationDriverDistributionsDriversDistributions")}</caption>
                <thead>
                  <tr>
                    <th className="col-label text-left">{t("drivers")}</th>
                    <th className="text-left">{t("distribution")}</th>
                    <th className="text-right">{tc("value")}</th>
                    <th className="text-left">{tc("source")}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(snapshot.cases?.[0]?.drivers ?? {}).map(([key, d]) => (
                    <tr key={key}>
                      <td className="col-label">{DRIVER_LABELS(tr)[key] ?? key}</td>
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
