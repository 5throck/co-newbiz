"use client";

// S8 WACC 입력 세션 — FS 진행 할인율 확정 (ADR-0115).
// 직접 입력(기존) + CAPM 분해 모드: 시장 수치는 외부 출처(AlphaSpread,
// 한국은행 ECOS 등)에서 인용해 값·출처·기준일을 남기고, 인용값이 없으면
// CAPM(자기자본비용)과 신용등급 기반 타인자본비용으로 WACC를 산출한다.
// 산식 분해 표·워터폴은 db/lib/wacc-components.ts의 assembleDerivation 하나로
// 그린다 — 서버가 저장하는 derivation과 같은 구현이므로 화면과 DB가 drift하지
// 않는다. 화면 구성은 승인된 목업
// docs/designs/mockups/2026-09-10-wacc-capm-ui-mockup_ko.html 기준.

import { TranslatorFn, resolveLabels } from "../../i18n/config.ts";
import { suggestionToInputValue } from "../../lib/wacc-suggestion-convert.ts";
import { KO_DATA } from "../../lib/ko-data-values.ts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SourceTooltip } from "../SourceTooltip.tsx";
import { ParamTable } from "../ui.tsx";
import { RoicWaterfallChart } from "../RoicWaterfallChart.tsx";
import { BetaPanel, type PeerRow } from "./BetaPanel.tsx";
import { DerivationTable } from "./DerivationTable.tsx";
import { api } from "../../lib/api.ts";
import TargetSelector, { type AnalysisTarget } from "../TargetSelector.tsx";
import { resolveTargetScope } from "../../lib/target-default.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteProject } from "../../lib/project-write-access.ts";
import {
  assembleDerivation,
  capmComponentGaps,
  hamadaRelever,
  hamadaUnlever,
  type WaccComponentInput,
  type WaccDerivation,
} from "../../../../db/lib/wacc-components.ts";
import { medianBetaUnlevered, regressionFromText, type BetaRegressionResult } from "../../../../db/lib/beta-regression.ts";
import { useTranslations } from "next-intl";

interface WaccResolution {
  value: number;
  source: "user" | "run_input" | "default";
  run_id: string | null;
  as_of: string | null;
  rationale: string | null;
  anchor_ref: string | null;
}
interface WaccComponentRecord {
  key: string;
  kind: string;
  value: number;
  rationale: string | null;
  anchor_ref: string | null;
  as_of: string;
  run_id: string;
}
interface WaccSubjectView {
  subject: "promoter" | "target" | "project_newco";
  source: "user" | "track_default";
  rationale: string | null;
  decided_by: string | null;
  decided_at: string | null;
  default_track: "greenfield" | "brownfield" | null;
}
interface View {
  wacc: WaccResolution;
  hurdle_irr: WaccResolution | null;
  components: WaccComponentRecord[];
  derivation: WaccDerivation | null;
  subject: WaccSubjectView;
  relevering: { beta_levered: number; beta_unlevered: number; target_de: number; tax_rate: number } | null;
}

/** 값 + 출처명 + 근거 URL + 기준일 — 시장 수치 인용 입력 단위. */
interface Cited {
  value: string;
  source: string;
  url: string;
  asOf: string;
}
const emptyCited = (): Cited => ({ value: "", source: "", url: "", asOf: "" });

function pct(n: number | null | undefined) {
  return typeof n === "number" ? `${(n * 100).toFixed(2)}%` : "—";
}
function nOr(s: string): number | null {
  if (s.trim() === "") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}
const num2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "—");

function KindChip({ kind }: { kind: "live" | "user" | "derived" }) {const t = useTranslations("stages.s8.wacc.waccPanel");
  const map = {
    live: t("liveCited"),
    user: t("userJudgement"),
    derived: t("derivedComputed"),
  } as const;
  const cls = {
    live: "bg-[color:var(--success-bg)] text-[color:var(--success)]",
    user: "bg-[color:var(--primary-bg)] text-[color:var(--accent)]",
    derived: "bg-[color:var(--muted-bg)] text-[color:var(--muted-fg)]",
  } as const;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[length:var(--fs-caption)] font-bold whitespace-nowrap ${cls[kind]}`}>{map[kind]}</span>;
}

/** 출처 인용 입력 한 줄 — 항목명 + 값 + 출처명 + URL + 기준일 + kind 칩. */
function CitedRow({
  name,
  sub,
  field,
  onChange,
  forceKind,
}: {
  name: string;
  sub?: string;
  field: Cited;
  onChange: (f: Cited) => void;
  forceKind?: "live" | "user";
}) {const t = useTranslations("stages.s8.wacc.waccPanel"); const tc = useTranslations("common");
  const kind: "live" | "user" = forceKind ?? (field.source.trim() !== "" ? "live" : "user");
  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-[9.5rem_7rem_1fr_1fr_7.5rem_6.5rem] gap-2 items-end py-2 border-t border-[color:var(--border-subtle)] text-sm">
      <div>
        <div className="text-[length:var(--fs-body)] font-semibold">{name}</div>
        {sub && <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{sub}</div>}
      </div>
      <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("value")}
        <input className="form-input" value={field.value} onChange={(e) => onChange({ ...field, value: e.target.value })} />
      </label>
      <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("sourceName")}
        <input className="form-input" value={field.source} placeholder={t("bankOfKoreaEcosGovernment")} onChange={(e) => onChange({ ...field, source: e.target.value })} />
      </label>
      <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("sourceUrlEvidenceReference")}
        <input className="form-input" value={field.url} placeholder="https://…" onChange={(e) => onChange({ ...field, url: e.target.value })} />
      </label>
      <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("asOfDate")}
        <input className="form-input" value={field.asOf} placeholder="2026-09-10" onChange={(e) => onChange({ ...field, asOf: e.target.value })} />
      </label>
      <div><KindChip kind={kind} /></div>
    </div>
  );
}

function StatCard({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)]">
      <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{k}</div>
      <div className="font-bold text-[1.05rem] tabular-nums">{children}</div>
    </div>
  );
}

const COMPONENT_LABELS = (tr: TranslatorFn): Record<string, string> => resolveLabels(tr, {
  "wacc.risk_free": "stages.s8.wacc.waccPanel.rateRf",
  "wacc.erp": "stages.s8.wacc.waccPanel.equityRiskPremiumErp",
  "wacc.size_premium": "stages.s8.wacc.waccPanel.scalePremium",
  "wacc.beta_levered": "stages.s8.wacc.waccPanel.betaLevered",
  "wacc.beta_unlevered": "stages.s8.wacc.waccPanel.betaUnleveredBetau",
  "wacc.observed_de": "common.observedDE",
  "wacc.target_de": "stages.s8.wacc.waccPanel.targetDE",
  "wacc.tax_rate": "stages.s8.wacc.waccPanel.marginalTaxRate",
  "wacc.cost_of_debt": "stages.s8.wacc.waccPanel.costOfDebtKd",
  "wacc.debt_spread": "stages.s8.wacc.waccPanel.creditRatingSpread",
  "wacc.beta_r2": "stages.s8.wacc.waccPanel.betaRegression",
  "wacc.beta_alpha": "stages.s8.wacc.waccPanel.betaRegressionAlphaAnnualized",
  "wacc.beta_vol_asset": "stages.s8.wacc.waccPanel.annualizedVolatilityAsset",
  "wacc.beta_vol_market": "stages.s8.wacc.waccPanel.annualizedVolatilityMarket",
});

/** 컴포넌트 키별 표시 포맷 — 비율은 %, 베타·D/E·R²는 배수/지수 그대로. */
function formatComponentValue(key: string, v: number): string {
  if (key === "wacc.beta_levered" || key === "wacc.beta_unlevered") return v.toFixed(2);
  if (key === "wacc.observed_de" || key === "wacc.target_de") return v.toFixed(2);
  if (key === "wacc.beta_r2") return v.toFixed(2);
  if (key === "wacc.beta_alpha") return `${(v * 100).toFixed(2)}%`;
  if (key === "wacc.beta_vol_asset" || key === "wacc.beta_vol_market") return `${(v * 100).toFixed(1)}%`;
  return pct(v);
}

export function WaccPanel({ projectId }: { projectId: string }) {const tr = useTranslations(); const t = useTranslations("stages.s8.wacc.waccPanel"); const tc = useTranslations("common");
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  // ADR-0156: per-target sessions. null = project-level (the fs-gate view);
  // a target id scopes GET/POST/suggestions to that target's own runs.
  const [targets, setTargets] = useState<AnalysisTarget[]>([]);
  const [chosenTarget, setChosenTarget] = useState<string | null>(null);
  // Default = S8-selected (gate-bound) target, else the first shortlisted; the bound target maps to
  // the project-level scope (no target_id), so the gate figure stays reachable (ADR-0156 §2).
  const targetScope = resolveTargetScope(targets, chosenTarget);
  const selectedTarget = targetScope.scopeId;
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── 모드 ──
  // CAPM decomposition is the structured default (the parameters analysts tune live there);
  // a project whose saved WACC is a direct user input keeps opening in direct mode.
  const [mode, setMode] = useState<"direct" | "capm">("capm");

  // ── 참조값 (ADR-0116 Phase 4; 제안일 뿐 — 확정은 사람) ──
  interface Sugg { key: string; value: number | null; as_of?: string; anchor_ref?: string; source_label?: string; reason?: string; note?: string | null }
  const [sugg, setSugg] = useState<{ subject: { name_ko: string | null } | null; suggestions: Sugg[]; missing?: string[] } | null>(null);
  const targetQuery = selectedTarget ? `?target_id=${encodeURIComponent(selectedTarget)}` : "";
  const loadSugg = useCallback(() => {
    api.get<{ subject: { name_ko: string | null } | null; suggestions: Sugg[] }>(`/api/projects/${encodeURIComponent(projectId)}/wacc/suggestions${targetQuery}`)
      .then((r) => setSugg(r.data)) // 제안은 선택 대상(기본: 게이트 기준 회사)을 따라 갱신 — 확정은 사람
      .catch(() => setSugg(null));
  }, [projectId, targetQuery]);
  useEffect(() => { loadSugg(); }, [loadSugg]);
  useEffect(() => {
    api.get<{ targets: AnalysisTarget[] }>(`/api/projects/${encodeURIComponent(projectId)}/targets`)
      .then((r) => setTargets(r.data.targets ?? []))
      .catch(() => setTargets([]));
  }, [projectId]);
  const applyRef = useCallback((key: string, e: Sugg) => {
    // ECOS percent points (risk_free, credit_spread) become ratios; observed_de is already a multiple.
    const ratio = suggestionToInputValue(key, e.value);
    const cited = { value: ratio !== null ? String(ratio) : "", source: e.source_label ?? "", url: e.anchor_ref ?? "", asOf: e.as_of ?? "" };
    if (key === "risk_free") setRf(cited);
    if (key === "credit_spread") setKdSpread(cited);
    if (key === "observed_de") setObsDe({ value: cited.value, source: cited.source, asOf: cited.asOf });
  }, []);
  const APPLY_LABEL: Record<string, string> = { risk_free: t("applyRf"), credit_spread: t("applyCreditSpread"), observed_de: t("applyDE") };

  // ── 직접 입력 ──
  const [subject, setSubject] = useState<"" | "promoter" | "target" | "project_newco">("");
  const [subjectRationale, setSubjectRationale] = useState("");
  const [directWacc, setDirectWacc] = useState("0.10");
  const [directHurdle, setDirectHurdle] = useState("");
  const [directRationale, setDirectRationale] = useState("");

  // ── CAPM 분해 ──
  const [rf, setRf] = useState<Cited>(emptyCited);
  const [erp, setErp] = useState<Cited>(emptyCited);
  const [sp, setSp] = useState<Cited>(emptyCited);
  const [betaTab, setBetaTab] = useState<"peer" | "regression">("regression");
  const [peers, setPeers] = useState<PeerRow[]>([
    { name: "", beta: "", de: "", source: "" },
    { name: "", beta: "", de: "", source: "" },
    { name: "", beta: "", de: "", source: "" },
  ]);
  const [regText, setRegText] = useState("");
  const [regResult, setRegResult] = useState<BetaRegressionResult | null>(null);
  const [regError, setRegError] = useState<string | null>(null);
  const [obsDe, setObsDe] = useState({ value: "", source: "", asOf: "" });
  const [kdMode, setKdMode] = useState<"rating" | "direct">("rating");
  const [kdSpread, setKdSpread] = useState<Cited>(emptyCited);
  const [kdDirect, setKdDirect] = useState<Cited>(emptyCited);
  const [targetDe, setTargetDe] = useState({ value: "", source: "" });
  const [taxRate, setTaxRate] = useState({ value: "", source: "" });
  const [waccFinal, setWaccFinal] = useState("");
  const [waccTouched, setWaccTouched] = useState(false);
  const [hurdle, setHurdle] = useState("");
  const [rationale, setRationale] = useState("");

  const load = useCallback(() => {
    api.get<View>(`/api/projects/${encodeURIComponent(projectId)}/wacc${targetQuery}`)
      .then((r) => {
        setView(r.data);
        setDirectWacc(String(r.data.wacc.value));
        if (r.data.hurdle_irr) setHurdle(String(r.data.hurdle_irr.value));
        setMode(r.data.components.length === 0 && r.data.wacc.source === "user" ? "direct" : "capm");
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("failedToLoadWaccInformation")));
  }, [projectId, targetQuery]);
  useEffect(() => { load(); }, [load]);

  const taxN = nOr(taxRate.value);
  const targetDeN = nOr(targetDe.value);
  const rfN = nOr(rf.value);
  const erpN = nOr(erp.value);
  const spN = nOr(sp.value);
  const obsDeN = nOr(obsDe.value);

  /** 폼 상태 → 저장 예정 컴포넌트 (UI 프리뷰와 POST 페이로드가 동일한 소스). */
  const components = useMemo<WaccComponentInput[]>(() => {
    const comps: WaccComponentInput[] = [];
    const cited = (key: WaccComponentInput["key"], f: Cited, forceKind?: "live" | "user") => {
      const v = nOr(f.value);
      if (v === null) return;
      comps.push({
        key,
        value: v,
        kind: forceKind ?? (f.source.trim() !== "" ? "live" : "user"),
        sourceLabel: f.source.trim() || undefined,
        anchorRef: f.url.trim() || null,
        asOf: f.asOf.trim() || undefined,
      });
    };
    cited("wacc.risk_free", rf);
    cited("wacc.erp", erp);
    cited("wacc.size_premium", sp, "user");
    if (betaTab === "regression" && regResult) {
      comps.push({
        key: "wacc.beta_levered",
        value: regResult.beta,
        kind: "derived",
        rationale: t("regressionP1P2DaysP3", { p1: regResult.r2.toFixed(2), p2: regResult.n, p3: regResult.windowStart, p4: regResult.windowEnd }),
      });
      comps.push({ key: "wacc.beta_r2", value: regResult.r2, kind: "derived", rationale: t("regressionStats") });
      comps.push({ key: "wacc.beta_alpha", value: regResult.annualAlpha, kind: "derived", rationale: t("regressionStatsAnnualized") });
      comps.push({ key: "wacc.beta_vol_asset", value: regResult.annualVolAsset, kind: "derived", rationale: t("annualizedVolatilityAsset2") });
      comps.push({ key: "wacc.beta_vol_market", value: regResult.annualVolMarket, kind: "derived", rationale: t("annualizedVolatilityMarket2") });
      if (obsDeN !== null) {
        comps.push({
          key: "wacc.observed_de",
          value: obsDeN,
          kind: obsDe.source.trim() !== "" ? "live" : "user",
          sourceLabel: obsDe.source.trim() || undefined,
          asOf: obsDe.asOf.trim() || undefined,
        });
      }
    }
    if (betaTab === "peer") {
      const usable = peers.filter((p) => p.name.trim() !== "" && nOr(p.beta) !== null);
      if (usable.length > 0) {
        try {
          const { median } = medianBetaUnlevered(
            usable.map((p) => ({ label: p.name, betaLevered: nOr(p.beta)!, deRatio: nOr(p.de) ?? 0, taxRate: taxN ?? 0 })),
          );
          comps.push({
            key: "wacc.beta_unlevered",
            value: median,
            kind: "derived",
            rationale: t("peerMedianP1", { p1: usable.map((p) => `${p.name} β${p.beta}/D-E ${p.de}${p.source ? ` (${p.source})` : ""}`).join(", ") }),
          });
        } catch {
          // out-of-range peer input — no beta component until fixed
        }
      }
    }
    if (kdMode === "rating") cited("wacc.debt_spread", kdSpread);
    else cited("wacc.cost_of_debt", kdDirect);
    if (targetDeN !== null) {
      comps.push({ key: "wacc.target_de", value: targetDeN, kind: "user", sourceLabel: targetDe.source.trim() || undefined });
    }
    if (taxN !== null) {
      comps.push({ key: "wacc.tax_rate", value: taxN, kind: "user", sourceLabel: taxRate.source.trim() || undefined });
    }
    return comps;
  }, [rf, erp, sp, betaTab, regResult, obsDe, obsDeN, peers, taxN, kdMode, kdSpread, kdDirect, targetDe, targetDeN, taxRate]);

  const derivation = useMemo(() => (components.length > 0 ? assembleDerivation(components) : null), [components]);
  const computedWacc = derivation?.computed.wacc ?? null;
  const gaps = useMemo(() => capmComponentGaps(components), [components]);

  useEffect(() => {
    if (!waccTouched && computedWacc != null) setWaccFinal(computedWacc.toFixed(4));
  }, [computedWacc, waccTouched]);

  const mismatch = computedWacc != null && nOr(waccFinal) !== null && Math.abs(computedWacc - nOr(waccFinal)!) > 0.00005;

  // 워터폴 스텝 — assembleDerivation 결과에서 그대로 가져온다.
  const keSteps = useMemo(() => {
    const d = derivation;
    if (!d || d.computed.ke == null || rfN == null || erpN == null) return [];
    const steps: { step: string; value: number; kind: "delta" | "total" }[] = [
      { step: t("rate"), value: rfN, kind: "delta" },
      { step: "β×ERP", value: (d.computed.betaLevered ?? 0) * erpN, kind: "delta" },
    ];
    if (spN) steps.push({ step: t("sizePremium"), value: spN, kind: "delta" });
    steps.push({ step: t("costOfEquityKe"), value: d.computed.ke, kind: "total" });
    return steps;
  }, [derivation, rfN, erpN, spN]);
  const waccSteps = useMemo(() => {
    const d = derivation;
    if (!d || d.computed.wacc == null || d.computed.ke == null || d.computed.kd == null || d.computed.we == null || d.computed.wd == null || taxN == null) return [];
    const steps: { step: string; value: number; kind: "delta" | "total" }[] = [
      { step: t("equityContribution"), value: d.computed.we * d.computed.ke, kind: "total" },
      { step: t("debtContributionAfterTax"), value: d.computed.wd * d.computed.kd * (1 - taxN), kind: "delta" },
      { step: "WACC", value: d.computed.wacc, kind: "total" },
    ];
    return steps;
  }, [derivation, taxN]);

  // Hamada 체인 표시 (② 패널 하단) — tax = 법인세율(수치), t = 번역기
  const chain = useMemo(() => {
    const tax = taxN;
    const de = targetDeN;
    if (tax == null || de == null) return null;
    if (betaTab === "regression" && regResult) {
      if (obsDeN == null) return { text: t("enteringTheObservedDE"), path: t("regression") };
      const u = hamadaUnlever(regResult.beta, obsDeN, tax);
      const l = hamadaRelever(u, de, tax);
      return {
        path: t("regressionBetalBetau"),
        text: `βU = ${num2(regResult.beta)} / (1 + ${(tax * 100).toFixed(0)}%×${num2(obsDeN)}) = ${num2(u)}  →  βL* = ${num2(u)} × (1 + ${(tax * 100).toFixed(0)}%×${num2(de)}) = ${num2(l)}`,
      };
    }
    const medianComponents = components.find((c) => c.key === "wacc.beta_unlevered");
    if (betaTab === "peer" && medianComponents) {
      const l = hamadaRelever(medianComponents.value, de, tax);
      return {
        path: t("peerCitationBetauMedian"),
        text: `βL* = ${num2(medianComponents.value)} × (1 + ${(tax * 100).toFixed(0)}%×${num2(de)}) = ${num2(l)}`,
      };
    }
    return null;
  }, [betaTab, regResult, obsDeN, taxN, targetDeN, components]);

  function runRegression() {
    setRegError(null);
    try {
      setRegResult(regressionFromText(regText));
    } catch (e) {
      setRegResult(null);
      setRegError(e instanceof Error ? e.message : t("regressionFailed"));
    }
  }

  async function submitCapm(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    const w = nOr(waccFinal);
    if (w === null) {
      setError(t("enterTheConfirmedWaccValue"));
      return;
    }
    if (gaps.length > 0) {
      setError(t("capmComponentsMissingP1", { p1: gaps.join(", ") }));
      return;
    }
    try {
      const res = await api.post<{ run_id: string; wacc_computed: number | null; computed_mismatch: boolean; wacc: WaccResolution; hurdle_irr: WaccResolution | null }>(
        `/api/projects/${encodeURIComponent(projectId)}/wacc`,
        {
          wacc: w,
          hurdle_irr: hurdle.trim() || undefined,
          mode: "capm",
          rationale,
          components,
          target_id: selectedTarget ?? undefined,
        },
      );
      const mismatchNote = res.data.computed_mismatch && res.data.wacc_computed != null
        ? t("capmValueP1ConfirmedValue", { p1: pct(res.data.wacc_computed), p2: pct(w) })
        : "";
      setMessage(t("savedRunP1P2", { p1: res.data.run_id, p2: mismatchNote }));
      setWaccTouched(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failedToSaveTheWacc"));
    }
  }

  async function submitDirect(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    try {
      if (subject && !subjectRationale.trim()) {
        setError(t("evidenceMustBeRecordedWhen"));
        return;
      }
      const res = await api.post<{ run_id: string }>(`/api/projects/${encodeURIComponent(projectId)}/wacc`, {
        wacc: Number(directWacc),
        hurdle_irr: directHurdle.trim() ? Number(directHurdle) : undefined,
        mode: "direct",
        rationale: directRationale,
        subject: selectedTarget ? undefined : subject || undefined,
        subject_rationale: selectedTarget ? undefined : subject ? subjectRationale : undefined,
        target_id: selectedTarget ?? undefined,
      });
      setSubject("");
      setSubjectRationale("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failedToSaveTheWacc2"));
    }
  }

  return (
    <>
        {targets.length > 1 && (
          <section className="market-section sizing-step" aria-label={t("selectAnalysisScope")}>
            <h3 className="sizing-step-title">{t("analysisScope")}</h3>
            <TargetSelector targets={targets} selected={targetScope.activeId} onSelect={setChosenTarget} />
            {selectedTarget && (
              <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                {t("individualTargetSessionThisValue")}
              </p>
            )}
            {targetScope.noGateBasis && (
              <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]" data-testid="no-gate-basis-note">
                {t("s8TargetSelectionIsPending")}
              </p>
            )}
          </section>
        )}
        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {error}</p>}
        {message && <p className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)]">✓ {message}</p>}

        {/* 현재 확정값 */}
        <section className="market-section sizing-step">
          <h3 className="sizing-step-title">{t("currentConfirmedValue")}</h3>
          {!view ? <p>{tc("loading")}</p> : (
            <ParamTable
              caption={t("currentlyConfirmedWaccValue")}
              labelHeader={tc("items")}
              rows={[
                {
                  label: "WACC",
                  value: (
                    <SourceTooltip provenance={{ as_of: view.wacc.as_of, source: view.wacc.rationale, anchor_ref: view.wacc.anchor_ref, run_id: view.wacc.run_id, assumption_key: "wacc" }}>
                      {pct(view.wacc.value)}
                    </SourceTooltip>
                  ),
                  source: <span className="status-chip status-info">{view.wacc.source}</span>,
                },
                { label: t("targetReturn"), value: pct(view.hurdle_irr?.value) },
                {
                  label: t("waccApplyingEntity"),
                  value: view.subject.subject === "promoter" ? t("investingEntityPromoter") : view.subject.subject === "target" ? t("targetCompanyTarget") : t("newlyEstablishedEntity"),
                  source: (
                    <>
                      <span className="status-chip status-info">{view.subject.source === "user" ? t("humanConfirmationFinal") : t("trackDefault")}</span>
                      {view.subject.source === "user" && view.subject.rationale ? <span className="block">{view.subject.rationale}</span> : null}
                    </>
                  ),
                },
                ...(view.relevering
                  ? [{
                      label: t("releveredBetaReference"),
                      value: view.relevering.beta_levered.toFixed(3),
                      source: `= βu ${view.relevering.beta_unlevered.toFixed(2)} × (1 + (1−t) × D/E ${view.relevering.target_de.toFixed(2)})`,
                    }]
                  : []),
                { label: t("runNumber"), value: view.wacc.run_id ?? "—" },
                { label: tc("asOfDate"), value: view.wacc.as_of ?? "—" },
              ]}
            />
          )}
        </section>

        {canAct && (
          <>
          {/* WACC 참조값 — 두 모드 모두에서 보이는 가져오기 액션 (ADR-0116 Phase 4).
              제안일 뿐이며, 적용 후 값·출처를 확인하고 사람이 확정한다 (kind=user). */}
          {sugg && sugg.suggestions.length > 0 && (
            <section className="market-section sizing-step mt-3" aria-label={tc("waccReference")}>
              <h3 className="sizing-step-title">
                {tc("waccReference")}
                <span className="status-chip status-info">{sugg.subject?.name_ko ?? t("targetCompany")} {t("baselineAndProposalAPerson")}</span>
              </h3>
              <div className="flex flex-wrap gap-5 items-start text-[length:var(--fs-body)]">
                {sugg.suggestions.filter((x): x is Sugg & { value: number } => x.value !== null).map((x) => (
                  <div key={x.key}>
                    <div className="font-bold tabular-nums text-[1.05rem]">{x.key === "observed_de" ? x.value.toFixed(2) : `${x.value.toFixed(2)}%`}</div>
                    <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                      {x.key === "risk_free" ? t("rfGovernmentBond") : x.key === "credit_spread" ? t("creditSpreadMinusGovernmentBond") : tc("observedDE")} · {x.as_of}
                    </div>
                    {x.note ? <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] max-w-[22rem]">{x.note}</div> : null}
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setMode("capm");
                    for (const x of sugg.suggestions) {
                      if (x.value !== null) applyRef(x.key, x);
                    }
                  }}
                >
                  {t("applyToTheWholeCapm")}
                </button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => void loadSugg()}>{t("refresh")}</button>
              </div>
              <p className="note-line">{t("referenceValuesAreProposalsAfter")}</p>
            </section>
          )}
          {sugg && sugg.suggestions.every((x) => x.value === null) && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-3">
              {t("noDataToFetchReference")} {(sugg.missing ?? []).join(" · ")}
            </p>
          )}
          </>
        )}
        {/* 저장된 CAPM 세션 — 계산 과정은 저장 후에도 레지스트리에서 재현된다 (ADR-0115) */}
        {view && view.derivation && view.components.length > 0 && (
          <section className="market-section sizing-step">
            <h3 className="sizing-step-title">
              {t("savedSessionFormulaBreakdown")}
              <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">{t("recomputedFromTheWaccRows")}</span>
            </h3>
            <DerivationTable derivation={view.derivation} />
            <div className="overflow-x-auto mt-3">
              <table className="data-table" aria-label={t("savedWaccComponents")}>
                <caption className="sr-only">{t("savedWaccComponentsAssumptionKeys")}</caption>
                <thead>
                  <tr className="text-left text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] border-b border-[color:var(--border-bright)]">
                    <th className="py-1.5 px-1.5">{t("assumptionKey")}</th>
                    <th className="py-1.5 px-1.5 text-right">{tc("value")}</th>
                    <th className="py-1.5 px-1.5">kind</th>
                    <th className="py-1.5 px-1.5">{t("sourceEvidence")}</th>
                    <th className="py-1.5 px-1.5">{tc("asOfDate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.components.map((c) => (
                    <tr key={c.key} className="border-b border-[color:var(--border-subtle)]">
                      <td className="py-1.5 px-1.5">
                        <div className="text-[length:var(--fs-caption)]">{COMPONENT_LABELS(tr)[c.key] ?? c.key}</div>
                        <div className="font-mono text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{c.key}</div>
                      </td>
                      <td className="py-1.5 px-1.5 text-right tabular-nums font-semibold">
                        <SourceTooltip provenance={{ assumption_key: c.key, as_of: c.as_of, source: c.rationale, anchor_ref: c.anchor_ref, run_id: c.run_id }}>
                          {formatComponentValue(c.key, c.value)}
                        </SourceTooltip>
                      </td>
                      <td className="py-1.5 px-1.5"><KindChip kind={c.kind as "live" | "user" | "derived"} /></td>
                      <td className="py-1.5 px-1.5 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                        {c.rationale ?? "—"}
                        {c.anchor_ref && <> <a href={c.anchor_ref} className="text-[color:var(--accent)]" target="_blank" rel="noreferrer">{tc("linkLabel")}</a></>}
                      </td>
                      <td className="py-1.5 px-1.5 text-[length:var(--fs-caption)]">{c.as_of}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {canAct && (
          <>
          {/* 모드 탭 */}
          <div className="flex gap-1.5 mt-6" role="tablist" aria-label={t("inputMode")}>
            <button role="tab" aria-selected={mode === "direct"} type="button"
              className={`rounded-t-lg border border-b-0 px-4 py-2 text-[length:var(--fs-body)] font-semibold ${mode === "direct" ? "bg-[color:var(--surface)] text-[color:var(--accent)]" : "bg-[color:var(--muted-bg)] text-[color:var(--muted-fg)]"}`}
              onClick={() => setMode("direct")}>{t("enterDirectly")}</button>
            <button role="tab" aria-selected={mode === "capm"} type="button"
              className={`rounded-t-lg border border-b-0 px-4 py-2 text-[length:var(--fs-body)] font-semibold ${mode === "capm" ? "bg-[color:var(--surface)] text-[color:var(--accent)]" : "bg-[color:var(--muted-bg)] text-[color:var(--muted-fg)]"}`}
              onClick={() => setMode("capm")}>{t("capmBreakdown")}</button>
          </div>

          {mode === "capm" && sugg && sugg.suggestions.some((x) => x.value !== null) && (
            <section className="market-section sizing-step mt-3" aria-label={tc("waccReference")}>
              <h3 className="sizing-step-title">{tc("waccReference")} <span className="status-chip status-info">{sugg.subject?.name_ko ?? t("targetCompany2")} {t("baselineAndProposalAPerson2")}</span></h3>
              <table className="data-table">
                <caption className="sr-only">{t("waccReferenceParametersReferenceValues")}</caption>
                <thead><tr><th scope="col">{t("parameters")}</th><th scope="col" className="num">{t("referenceValue")}</th><th scope="col">{t("sourceAndDate")}</th><th scope="col"></th></tr></thead>
                <tbody>
                  {sugg.suggestions.map((x) => (
                    <tr key={x.key}>
                      <td>{x.key === "risk_free" ? t("rateRfGovernmentBond") : x.key === "credit_spread" ? t("creditRatingSpreadCorporateBond") : t("observedDEDebtEquity")}</td>
                      <td className="num mono-num">{x.value === null ? "N/A" : x.key === "observed_de" ? x.value.toFixed(2) : `${x.value.toFixed(2)}%`}</td>
                      <td className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{x.value !== null ? `${x.source_label ?? ""} · ${x.as_of ?? ""}` : x.reason ?? ""}</td>
                      <td>{x.value !== null && <button type="button" className="btn-ghost btn-sm" onClick={() => applyRef(x.key, x)}>{APPLY_LABEL[x.key]}</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {mode === "direct" ? (
            <form className="sizing-step grid gap-3 mt-0 rounded-tl-none" style={{ maxWidth: 460 }} onSubmit={submitDirect}>
              <h3 className="sizing-step-title">{t("enterDirectly2")}{selectedTarget ? t("individualTarget") : ""}</h3>
              <label className="grid gap-1 text-sm">{t("waccRatio")}<input className="form-input" value={directWacc} onChange={(e) => setDirectWacc(e.target.value)} placeholder="0.095" /></label>
              <label className="grid gap-1 text-sm">{t("targetReturnOptional")}<input className="form-input" value={directHurdle} onChange={(e) => setDirectHurdle(e.target.value)} placeholder="0.15" /></label>
              <label className="grid gap-1 text-sm">{t("evidenceApprovalMemo")}<textarea className="form-input" value={directRationale} onChange={(e) => setDirectRationale(e.target.value)} placeholder={t("treasuryCheckIcGuidelinesEtc")} /></label>
              {selectedTarget ? (
                <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                  {t("theWaccApplyingEntityIs")}
                </p>
              ) : (
                <>
                  <label className="grid gap-1 text-sm">
                    {t("waccApplyingEntityOptionalTrack")}
                    <select className="form-input" value={subject} onChange={(e) => setSubject(e.target.value as typeof subject)}>
                      <option value="">{t("followTheTrackDefault")}</option>
                      <option value="promoter">{t("investingEntityPromoter2")}</option>
                      <option value="target">{t("targetCompanyTargetAcquisitionOr")}</option>
                      <option value="project_newco">{t("newlyEstablishedEntity2")}</option>
                    </select>
                  </label>
                  {subject && (
                    <label className="grid gap-1 text-sm">{t("entityEvidenceRequired")}<textarea className="form-input" value={subjectRationale} onChange={(e) => setSubjectRationale(e.target.value)} placeholder={t("cashFlowRiskAttributedTo")} /></label>
                  )}
                </>
              )}
              <button className="primary-button justify-self-start" type="submit">{t("confirmWithThisValue")}</button>
              <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("onConfirmationThisValueIs")}</p>
            </form>
          ) : (
            <form className="sizing-step mt-0 rounded-tl-none" onSubmit={submitCapm}>
              {/* ① 시장 수치 */}
              <h3 className="sizing-step-title"><span className="sizing-step-badge">1</span>{t("marketFigures")} <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">{t("citesValuesVerifiedAgainstCredible")}</span></h3>
              <div>
                <CitedRow name={t("rateRf2")} sub={t("basedOnGovernmentBonds")} field={rf} onChange={setRf} />
                <CitedRow name={t("equityRiskPremiumErp2")} sub={t("marketRiskPremium")} field={erp} onChange={setErp} />
                <CitedRow name={t("scalePremium2")} sub={t("optionalPremium")} field={sp} onChange={setSp} forceKind="user" />
              </div>

              {/* ② 베타 추정 */}
              <h3 className="sizing-step-title mt-6"><span className="sizing-step-badge">2</span>{t("betaEstimation")} <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">{t("alsoComputesVolatilityVsThe")}</span></h3>
              <BetaPanel
                projectId={projectId}
                betaTab={betaTab}
                onBetaTab={setBetaTab}
                peers={peers}
                onPeers={setPeers}
                peerTaxRate={taxN}
                regressionText={regText}
                onRegressionText={setRegText}
                regression={regResult}
                regressionError={regError}
                onRunRegression={runRegression}
                observedDe={obsDe}
                onObservedDe={setObsDe}
              />
              {chain && (
                <div className="mt-3 rounded-lg border border-dashed border-[color:var(--primary-border)] bg-[color:var(--primary-bg)] p-3 text-[length:var(--fs-body)]">
                  <b>{t("selectedBetaPath")}</b> {chain.path}
                  {chain.text.startsWith(KO_DATA.waccChainObservedPrefix) ? (
                    <div className="text-[color:var(--muted-fg)]">{chain.text}</div>
                  ) : (
                    <div className="font-mono text-[length:var(--fs-caption)] mt-1">{chain.text}</div>
                  )}
                </div>
              )}

              {/* ③ 타인자본비용 */}
              <h3 className="sizing-step-title mt-6"><span className="sizing-step-badge">3</span>{t("costOfDebtKd2")} <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">{t("loanRateBasedOnThe")}</span></h3>
              <div className="flex gap-1.5 mb-1">
                <button type="button" onClick={() => setKdMode("rating")}
                  className={`rounded-full border px-3 py-1 text-[length:var(--fs-caption)] ${kdMode === "rating" ? "border-[color:var(--primary-border)] bg-[color:var(--primary-bg)] text-[color:var(--accent)] font-bold" : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-fg)]"}`}>
                  {t("creditRatingPlusSpread")}
                </button>
                <button type="button" onClick={() => setKdMode("direct")}
                  className={`rounded-full border px-3 py-1 text-[length:var(--fs-caption)] ${kdMode === "direct" ? "border-[color:var(--primary-border)] bg-[color:var(--primary-bg)] text-[color:var(--accent)] font-bold" : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-fg)]"}`}>
                  {t("enterTheActualLoanRate")}
                </button>
              </div>
              {kdMode === "rating" ? (
                <>
                  <CitedRow name={t("creditRatingSpread2")} sub={t("addedToRfIncludeThe")} field={kdSpread} onChange={setKdSpread} />
                  {rfN != null && nOr(kdSpread.value) != null && (
                    <div className="grid gap-2 md:grid-cols-2 mt-2 text-sm">
                      <StatCard k={t("costOfDebtKdRf")}>{pct(rfN)} + {pct(nOr(kdSpread.value))} = <b>{pct(rfN + nOr(kdSpread.value)!)}</b></StatCard>
                    </div>
                  )}
                </>
              ) : (
                <CitedRow name={t("fundingRateActual")} sub={t("actualLoanRate")} field={kdDirect} onChange={setKdDirect} forceKind="user" />
              )}

              {/* ④ 자본구조·세율 */}
              <h3 className="sizing-step-title mt-6"><span className="sizing-step-badge">4</span>{t("capitalStructureAndTaxRate")} <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">{t("basedOnTheTargetCapital")}</span></h3>
              <div className="grid md:grid-cols-2 xl:grid-cols-[9.5rem_7rem_1fr_6.5rem] gap-2 items-end py-2 border-t border-[color:var(--border-subtle)] text-sm">
                <div>
                  <div className="text-[length:var(--fs-body)] font-semibold">{t("targetDE2")}</div>
                  <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("debtEquity")}</div>
                </div>
                <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("value")}
                  <input className="form-input" value={targetDe.value} placeholder="0.60" onChange={(e) => setTargetDe({ ...targetDe, value: e.target.value })} />
                </label>
                <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("sourceName")}
                  <input className="form-input" value={targetDe.source} placeholder={t("financialPlanTargetLeverageRight")} onChange={(e) => setTargetDe({ ...targetDe, source: e.target.value })} />
                </label>
                <div><KindChip kind="user" /></div>
              </div>
              <div className="grid md:grid-cols-2 xl:grid-cols-[9.5rem_7rem_1fr_6.5rem] gap-2 items-end py-2 border-t border-[color:var(--border-subtle)] text-sm">
                <div>
                  <div className="text-[length:var(--fs-body)] font-semibold">{t("marginalTaxRate2")}</div>
                  <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("corporateTaxPlusLocalTax")}</div>
                </div>
                <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("value")}
                  <input className="form-input" value={taxRate.value} placeholder="0.22" onChange={(e) => setTaxRate({ ...taxRate, value: e.target.value })} />
                </label>
                <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("sourceName")}
                  <input className="form-input" value={taxRate.source} placeholder={t("standardCorporateTaxRate")} onChange={(e) => setTaxRate({ ...taxRate, source: e.target.value })} />
                </label>
                <div><KindChip kind="user" /></div>
              </div>
              {derivation?.computed.we != null && derivation?.computed.wd != null && (
                <div className="grid gap-2 md:grid-cols-2 mt-2 text-sm">
                  <StatCard k={t("equityWeightWe11")}>{pct(derivation.computed.we)}</StatCard>
                  <StatCard k={t("debtWeightWdDE")}>{pct(derivation.computed.wd)}</StatCard>
                </div>
              )}

              {/* 산식 분해 */}
              <h3 className="sizing-step-title mt-6">{t("breakdown")} <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">{t("seeAtAGlanceHow")}</span></h3>
              {derivation && derivation.steps.length > 0 ? (
                <>
                  {derivation.missing.length > 0 && (
                    <p className="text-[color:var(--amber-fg)] text-[length:var(--fs-caption)] mb-2">{t("notEntered")} {derivation.missing.join(" · ")}</p>
                  )}
                  <DerivationTable derivation={derivation} />
                  {keSteps.length > 0 && (
                    <div className="grid gap-4 lg:grid-cols-2 mt-4">
                      <div className="border border-[color:var(--border-subtle)] rounded-lg p-3">
                        <h4 className="text-[length:var(--fs-caption)] font-semibold text-[color:var(--muted-fg)] mb-1">{t("costOfEquityCapm")}</h4>
                        <RoicWaterfallChart steps={keSteps} numberFormat="percent" />
                      </div>
                      {waccSteps.length > 0 && (
                        <div className="border border-[color:var(--border-subtle)] rounded-lg p-3">
                          <h4 className="text-[length:var(--fs-caption)] font-semibold text-[color:var(--muted-fg)] mb-1">{t("waccWeightedBlend")}</h4>
                          <RoicWaterfallChart steps={waccSteps} numberFormat="percent" />
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("enterMarketFigures1Beta")}</p>
              )}

              {/* 기록될 컴포넌트·출처 */}
              {components.length > 0 && (
                <>
                  <h3 className="sizing-step-title mt-6">{t("componentsAndSourcesToRecord")} <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">{t("inTheAssumptionRegistry")} <span className="font-mono">wacc.*</span> {t("savedTogetherAsKeys")}</span></h3>
                  <div className="overflow-x-auto">
                    <table className="data-table" aria-label={t("waccComponentsToRecord")}>
                      <caption className="sr-only">{t("waccComponentsAndSourcesTo")}</caption>
                      <thead>
                        <tr className="text-left text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] border-b border-[color:var(--border-bright)]">
                          <th className="py-1.5 px-1.5">{t("assumptionKey2")}</th>
                          <th className="py-1.5 px-1.5 text-right">{tc("value")}</th>
                          <th className="py-1.5 px-1.5">kind</th>
                          <th className="py-1.5 px-1.5">{t("sourceEvidence2")}</th>
                          <th className="py-1.5 px-1.5">{tc("asOfDate")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {components.map((c) => (
                          <tr key={c.key} className="border-b border-[color:var(--border-subtle)]">
                            <td className="py-1.5 px-1.5">
                              <div className="text-[length:var(--fs-caption)]">{COMPONENT_LABELS(tr)[c.key] ?? c.key}</div>
                              <div className="font-mono text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{c.key}</div>
                            </td>
                            <td className="py-1.5 px-1.5 text-right tabular-nums font-semibold">{formatComponentValue(c.key, c.value)}</td>
                            <td className="py-1.5 px-1.5"><KindChip kind={c.kind} /></td>
                            <td className="py-1.5 px-1.5 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{c.sourceLabel ?? c.rationale ?? "—"}{c.anchorRef && <> <a href={c.anchorRef} className="text-[color:var(--accent)]" target="_blank" rel="noreferrer">{tc("linkLabel")}</a></>}</td>
                            <td className="py-1.5 px-1.5 text-[length:var(--fs-caption)]">{c.asOf ?? "—"}</td>
                          </tr>
                        ))}
                        <tr className="border-b border-[color:var(--border-subtle)] bg-[color:var(--primary-bg)] font-bold">
                          <td className="py-1.5 px-1.5 font-mono text-[0.8em]">{t("waccFinalConfirmation")}</td>
                          <td className="py-1.5 px-1.5 text-right tabular-nums">{pct(nOr(waccFinal))}</td>
                          <td className="py-1.5 px-1.5"><KindChip kind="user" /></td>
                          <td className="py-1.5 px-1.5 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("aPersonSFinalConfirmed")}</td>
                          <td className="py-1.5 px-1.5 text-[length:var(--fs-caption)]">—</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* 확정 저장 */}
              <h3 className="sizing-step-title mt-6">{t("saveConfirmation")} <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">{t("aPersonVerifiesAndConfirms")}</span></h3>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm">{t("waccRatioWithTheCapm")}
                  <input className="form-input" value={waccFinal} placeholder={computedWacc != null ? computedWacc.toFixed(4) : "0.095"} onChange={(e) => { setWaccFinal(e.target.value); setWaccTouched(true); }} />
                </label>
                <label className="grid gap-1 text-sm">{t("targetReturnOptional2")}
                  <input className="form-input" value={hurdle} placeholder="0.15" onChange={(e) => setHurdle(e.target.value)} />
                </label>
              </div>
              <label className="grid gap-1 text-sm mt-1">{t("evidenceApprovalMemo2")}
                <textarea className="form-input" rows={2} value={rationale} placeholder={t("eGEcos910")} onChange={(e) => setRationale(e.target.value)} />
              </label>
              {computedWacc != null && nOr(waccFinal) != null && (
                mismatch ? (
                  <p role="status" className="text-[color:var(--amber-fg)] bg-[color:var(--warning-bg)] rounded-md px-3 py-2 text-[length:var(--fs-caption)] mt-2">
                    {t("computedValue")} {pct(computedWacc)} {t("confirmedValue")} {pct(nOr(waccFinal))} {t("varianceEvidenceMustBeNoted")}
                  </p>
                ) : (
                  <p role="status" className="text-[color:var(--success)] bg-[color:var(--success-bg)] rounded-md px-3 py-2 text-[length:var(--fs-caption)] mt-2">
                    {t("confirmedValue2")} {pct(nOr(waccFinal))} {t("matchesTheCapmValue")}
                  </p>
                )
              )}
              <button className="primary-button justify-self-start mt-2" type="submit">{t("confirmWithThisValue2")}</button>
              <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("ifTheConfirmedValueDiffers")}</p>
            </form>
          )}
          </>
        )}
    </>
  );
}
