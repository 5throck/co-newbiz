"use client";

// S8 WACC 입력 세션 — FS 게이트 할인율 확정 (ADR-0115).
// 직접 입력(기존) + CAPM 분해 모드: 시장 수치는 외부 출처(AlphaSpread,
// 한국은행 ECOS 등)에서 인용해 값·출처·기준일을 남기고, 인용값이 없으면
// CAPM(자기자본비용)과 신용등급 기반 타인자본비용으로 WACC를 산출한다.
// 산식 분해 표·워터폴은 db/lib/wacc-components.ts의 assembleDerivation 하나로
// 그린다 — 서버가 저장하는 derivation과 같은 구현이므로 화면과 DB가 drift하지
// 않는다. 화면 구성은 승인된 목업
// docs/designs/mockups/2026-09-10-wacc-capm-ui-mockup_ko.html 기준.

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ProjectSubNav } from "../../../../components/ProjectSubNav.tsx";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { SourceTooltip } from "../../../../components/SourceTooltip.tsx";
import { RoicWaterfallChart } from "../../../../components/RoicWaterfallChart.tsx";
import { BetaPanel, type PeerRow } from "../../../../components/wacc/BetaPanel.tsx";
import { DerivationTable } from "../../../../components/wacc/DerivationTable.tsx";
import { api } from "../../../../lib/api.ts";
import {
  assembleDerivation,
  capmComponentGaps,
  hamadaRelever,
  hamadaUnlever,
  type WaccComponentInput,
  type WaccDerivation,
} from "../../../../../../db/lib/wacc-components.ts";
import { medianBetaUnlevered, regressionFromText, type BetaRegressionResult } from "../../../../../../db/lib/beta-regression.ts";

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
interface View {
  wacc: WaccResolution;
  hurdle_irr: WaccResolution | null;
  components: WaccComponentRecord[];
  derivation: WaccDerivation | null;
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

function KindChip({ kind }: { kind: "live" | "user" | "derived" }) {
  const map = {
    live: "live · 인용",
    user: "user · 판단",
    derived: "derived · 산출",
  } as const;
  const cls = {
    live: "bg-[color:var(--success-bg)] text-[color:var(--success)]",
    user: "bg-[color:var(--primary-bg)] text-[color:var(--accent)]",
    derived: "bg-[color:var(--muted-bg)] text-[color:var(--muted-fg)]",
  } as const;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[0.68rem] font-bold whitespace-nowrap ${cls[kind]}`}>{map[kind]}</span>;
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
}) {
  const kind: "live" | "user" = forceKind ?? (field.source.trim() !== "" ? "live" : "user");
  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-[9.5rem_7rem_1fr_1fr_7.5rem_6.5rem] gap-2 items-end py-2 border-t border-[color:var(--border-subtle)] text-sm">
      <div>
        <div className="text-[0.85rem] font-semibold">{name}</div>
        {sub && <div className="text-[color:var(--muted-fg)] text-[0.72rem]">{sub}</div>}
      </div>
      <label className="grid gap-1 text-[0.78rem] text-[color:var(--muted-fg)]">값
        <input className="form-input" value={field.value} onChange={(e) => onChange({ ...field, value: e.target.value })} />
      </label>
      <label className="grid gap-1 text-[0.78rem] text-[color:var(--muted-fg)]">출처명
        <input className="form-input" value={field.source} placeholder="한국은행 ECOS — 국고채(3년)" onChange={(e) => onChange({ ...field, source: e.target.value })} />
      </label>
      <label className="grid gap-1 text-[0.78rem] text-[color:var(--muted-fg)]">출처 URL (근거 참조)
        <input className="form-input" value={field.url} placeholder="https://…" onChange={(e) => onChange({ ...field, url: e.target.value })} />
      </label>
      <label className="grid gap-1 text-[0.78rem] text-[color:var(--muted-fg)]">기준일
        <input className="form-input" value={field.asOf} placeholder="2026-09-10" onChange={(e) => onChange({ ...field, asOf: e.target.value })} />
      </label>
      <div><KindChip kind={kind} /></div>
    </div>
  );
}

function StatCard({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)]">
      <div className="text-[color:var(--muted-fg)] text-[0.72rem]">{k}</div>
      <div className="font-bold text-[1.05rem] tabular-nums">{children}</div>
    </div>
  );
}

const COMPONENT_LABELS: Record<string, string> = {
  "wacc.risk_free": "무위험이자율 (Rf)",
  "wacc.erp": "주식위험프리미엄 (ERP)",
  "wacc.size_premium": "규모 프리미엄",
  "wacc.beta_levered": "베타 (레버드)",
  "wacc.beta_unlevered": "베타 (비레버드 βU)",
  "wacc.observed_de": "관측 D/E",
  "wacc.target_de": "목표 D/E",
  "wacc.tax_rate": "한계 세율",
  "wacc.cost_of_debt": "타인자본비용 (Kd)",
  "wacc.debt_spread": "신용등급 가산금리",
  "wacc.beta_r2": "베타 회귀 R²",
  "wacc.beta_alpha": "베타 회귀 α (연율)",
  "wacc.beta_vol_asset": "연율화 변동성 (자산)",
  "wacc.beta_vol_market": "연율화 변동성 (시장)",
};

/** 컴포넌트 키별 표시 포맷 — 비율은 %, 베타·D/E·R²는 배수/지수 그대로. */
function formatComponentValue(key: string, v: number): string {
  if (key === "wacc.beta_levered" || key === "wacc.beta_unlevered") return v.toFixed(2);
  if (key === "wacc.observed_de" || key === "wacc.target_de") return v.toFixed(2);
  if (key === "wacc.beta_r2") return v.toFixed(2);
  if (key === "wacc.beta_alpha") return `${(v * 100).toFixed(2)}%`;
  if (key === "wacc.beta_vol_asset" || key === "wacc.beta_vol_market") return `${(v * 100).toFixed(1)}%`;
  return pct(v);
}

export default function ProjectWaccPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── 모드 ──
  const [mode, setMode] = useState<"direct" | "capm">("direct");

  // ── 참조값 (ADR-0116 Phase 4; 제안일 뿐 — 확정은 사람) ──
  interface Sugg { key: string; value: number | null; as_of?: string; anchor_ref?: string; source_label?: string; reason?: string }
  const [sugg, setSugg] = useState<{ subject: { name_ko: string | null } | null; suggestions: Sugg[] } | null>(null);
  const loadSugg = useCallback(() => {
    api.get<{ subject: { name_ko: string | null } | null; suggestions: Sugg[] }>(`/api/projects/${encodeURIComponent(projectId)}/wacc/suggestions`)
      .then((r) => setSugg(r.data))
      .catch(() => setSugg(null));
  }, [projectId]);
  useEffect(() => { loadSugg(); }, [loadSugg]);
  const applyRef = useCallback((key: string, e: Sugg) => {
    // ECOS reference values are percent numbers (3.788 = 3.788%); the session
    // inputs take ratios (0.03788) — convert on apply.
    const ratio = e.value !== null ? e.value / 100 : null;
    const cited = { value: ratio !== null ? String(ratio) : "", source: e.source_label ?? "", url: e.anchor_ref ?? "", asOf: e.as_of ?? "" };
    if (key === "risk_free") setRf(cited);
    if (key === "credit_spread") setKdSpread(cited);
    if (key === "observed_de") setObsDe({ value: cited.value, source: cited.source, asOf: cited.asOf });
  }, []);
  const APPLY_LABEL: Record<string, string> = { risk_free: "Rf 적용", credit_spread: "가산금리 적용", observed_de: "D/E 적용" };

  // ── 직접 입력 ──
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
    api.get<View>(`/api/projects/${encodeURIComponent(projectId)}/wacc`)
      .then((r) => {
        setView(r.data);
        setDirectWacc(String(r.data.wacc.value));
        if (r.data.hurdle_irr) setHurdle(String(r.data.hurdle_irr.value));
        if (r.data.components.length > 0) setMode("capm");
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "WACC 정보를 불러오지 못했습니다."));
  }, [projectId]);
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
        rationale: `시계열 회귀 · R² ${regResult.r2.toFixed(2)} · ${regResult.n}일 (${regResult.windowStart}~${regResult.windowEnd})`,
      });
      comps.push({ key: "wacc.beta_r2", value: regResult.r2, kind: "derived", rationale: "회귀 스탯" });
      comps.push({ key: "wacc.beta_alpha", value: regResult.annualAlpha, kind: "derived", rationale: "회귀 스탯 (연율)" });
      comps.push({ key: "wacc.beta_vol_asset", value: regResult.annualVolAsset, kind: "derived", rationale: "연율화 변동성 (자산)" });
      comps.push({ key: "wacc.beta_vol_market", value: regResult.annualVolMarket, kind: "derived", rationale: "연율화 변동성 (시장)" });
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
            rationale: `동종사 중앙값 — ${usable.map((p) => `${p.name} β${p.beta}/D-E ${p.de}${p.source ? ` (${p.source})` : ""}`).join(", ")}`,
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
      { step: "무위험이자율", value: rfN, kind: "delta" },
      { step: "β×ERP", value: (d.computed.betaLevered ?? 0) * erpN, kind: "delta" },
    ];
    if (spN) steps.push({ step: "규모프리미엄", value: spN, kind: "delta" });
    steps.push({ step: "자기자본비용 Ke", value: d.computed.ke, kind: "total" });
    return steps;
  }, [derivation, rfN, erpN, spN]);
  const waccSteps = useMemo(() => {
    const d = derivation;
    if (!d || d.computed.wacc == null || d.computed.ke == null || d.computed.kd == null || d.computed.we == null || d.computed.wd == null || taxN == null) return [];
    const steps: { step: string; value: number; kind: "delta" | "total" }[] = [
      { step: "자기자본 기여 (We·Ke)", value: d.computed.we * d.computed.ke, kind: "total" },
      { step: "타인자본 기여 (세후)", value: d.computed.wd * d.computed.kd * (1 - taxN), kind: "delta" },
      { step: "WACC", value: d.computed.wacc, kind: "total" },
    ];
    return steps;
  }, [derivation, taxN]);

  // Hamada 체인 표시 (② 패널 하단)
  const chain = useMemo(() => {
    const t = taxN;
    const de = targetDeN;
    if (t == null || de == null) return null;
    if (betaTab === "regression" && regResult) {
      if (obsDeN == null) return { text: "관측 D/E를 입력하면 βU 환산 → 타겟 재레버 체인이 표시됩니다.", path: "시계열 회귀" };
      const u = hamadaUnlever(regResult.beta, obsDeN, t);
      const l = hamadaRelever(u, de, t);
      return {
        path: "시계열 회귀 (βL → βU → βL*)",
        text: `βU = ${num2(regResult.beta)} / (1 + ${(t * 100).toFixed(0)}%×${num2(obsDeN)}) = ${num2(u)}  →  βL* = ${num2(u)} × (1 + ${(t * 100).toFixed(0)}%×${num2(de)}) = ${num2(l)}`,
      };
    }
    const medianComponents = components.find((c) => c.key === "wacc.beta_unlevered");
    if (betaTab === "peer" && medianComponents) {
      const l = hamadaRelever(medianComponents.value, de, t);
      return {
        path: "동종사 인용 (βU 중앙값 → βL*)",
        text: `βL* = ${num2(medianComponents.value)} × (1 + ${(t * 100).toFixed(0)}%×${num2(de)}) = ${num2(l)}`,
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
      setRegError(e instanceof Error ? e.message : "회귀에 실패했습니다.");
    }
  }

  async function submitCapm(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    const w = nOr(waccFinal);
    if (w === null) {
      setError("확정 WACC 값을 입력하세요.");
      return;
    }
    if (gaps.length > 0) {
      setError(`CAPM 컴포넌트가 부족합니다: ${gaps.join(", ")}`);
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
        },
      );
      const mismatchNote = res.data.computed_mismatch && res.data.wacc_computed != null
        ? ` ⚠ CAPM 계산값 ${pct(res.data.wacc_computed)} ≠ 확정값 ${pct(w)} — 차이 근거를 메모에 기재하세요.`
        : "";
      setMessage(`저장 완료 — run ${res.data.run_id}${mismatchNote}`);
      setWaccTouched(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "WACC 입력 세션 저장에 실패했습니다.");
    }
  }

  async function submitDirect(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    try {
      const res = await api.post<{ run_id: string }>(`/api/projects/${encodeURIComponent(projectId)}/wacc`, {
        wacc: Number(directWacc),
        hurdle_irr: directHurdle.trim() ? Number(directHurdle) : undefined,
        mode: "direct",
        rationale: directRationale,
      });
      setMessage(`저장 완료 — run ${res.data.run_id}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "WACC 입력 세션 저장에 실패했습니다.");
    }
  }

  return (
    <main className="market-page">
      <ProjectSubNav projectId={projectId} />
      <StageFrame stageId="S8" heading="WACC 입력 세션 — FS 게이트 할인율 확정">
        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem]">✕ {error}</p>}
        {message && <p className="text-[color:var(--green-fg)] text-[0.82rem]">✓ {message}</p>}

        {/* 현재 확정값 */}
        <section className="market-section sizing-step">
          <h3 className="sizing-step-title">현재 확정값</h3>
          {!view ? <p>불러오는 중...</p> : (
            <dl className="grid gap-2 md:grid-cols-2 text-sm">
              <div>
                <dt className="text-[color:var(--muted-fg)]">WACC</dt>
                <dd className="font-semibold">
                  <SourceTooltip provenance={{ as_of: view.wacc.as_of, source: view.wacc.rationale, anchor_ref: view.wacc.anchor_ref, run_id: view.wacc.run_id, assumption_key: "wacc" }}>
                    {pct(view.wacc.value)} ({view.wacc.source})
                  </SourceTooltip>
                </dd>
              </div>
              <div><dt className="text-[color:var(--muted-fg)]">Hurdle IRR</dt><dd className="font-semibold">{pct(view.hurdle_irr?.value)}</dd></div>
              <div><dt className="text-[color:var(--muted-fg)]">Run</dt><dd className="font-mono">{view.wacc.run_id ?? "—"}</dd></div>
              <div><dt className="text-[color:var(--muted-fg)]">As of</dt><dd>{view.wacc.as_of ?? "—"}</dd></div>
            </dl>
          )}
        </section>

        {/* WACC 참조값 — 두 모드 모두에서 보이는 가져오기 액션 (ADR-0116 Phase 4).
            제안일 뿐이며, 적용 후 값·출처를 확인하고 사람이 확정한다 (kind=user). */}
        {sugg && sugg.suggestions.length > 0 && (
          <section className="market-section sizing-step mt-3" aria-label="WACC 참조값">
            <h3 className="sizing-step-title">
              WACC 참조값
              <span className="status-chip status-info">{sugg.subject?.name_ko ?? "대상 회사"} 기준 · 제안 — 확정은 사람</span>
            </h3>
            <div className="flex flex-wrap gap-5 items-start text-[0.85rem]">
              {sugg.suggestions.filter((x) => x.value !== null).map((x) => (
                <div key={x.key}>
                  <div className="font-bold tabular-nums text-[1.05rem]">{x.key === "observed_de" ? x.value.toFixed(2) : `${x.value.toFixed(2)}%`}</div>
                  <div className="text-[color:var(--muted-fg)] text-[0.74rem]">
                    {x.key === "risk_free" ? "Rf (국고채 3년)" : x.key === "credit_spread" ? "가산금리 (AA− − 국고채)" : "관측 D/E"} · {x.as_of}
                  </div>
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
                CAPM 분해에 모두 적용
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => void loadSugg()}>새로고침</button>
            </div>
            <p className="note-line">참조값은 제안입니다 — 적용 후 값·출처를 확인하고 사람이 확정합니다 (확정값은 kind=user). 출처: 한국은행 ECOS 시장금리 · DART 연결재무제표.</p>
          </section>
        )}
        {sugg && sugg.suggestions.every((x) => x.value === null) && (
          <p className="text-[0.82rem] text-[color:var(--muted-fg)] mt-3">
            참조값을 가져올 데이터가 없습니다 — {sugg.missing.join(" · ")}
          </p>
        )}

        {/* 저장된 CAPM 세션 — 계산 과정은 저장 후에도 레지스트리에서 재현된다 (ADR-0115) */}
        {view && view.derivation && view.components.length > 0 && (
          <section className="market-section sizing-step">
            <h3 className="sizing-step-title">
              저장된 세션 — 산식 분해
              <span className="text-[color:var(--muted-fg)] font-normal text-[0.8rem]">— assumption registry의 wacc.* 행에서 재계산된 값입니다</span>
            </h3>
            <DerivationTable derivation={view.derivation} />
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-[0.85rem]">
                <thead>
                  <tr className="text-left text-[color:var(--muted-fg)] text-[0.75rem] border-b border-[color:var(--border-bright)]">
                    <th className="py-1.5 px-1.5">가정 키</th>
                    <th className="py-1.5 px-1.5 text-right">값</th>
                    <th className="py-1.5 px-1.5">kind</th>
                    <th className="py-1.5 px-1.5">출처 / 근거</th>
                    <th className="py-1.5 px-1.5">기준일</th>
                  </tr>
                </thead>
                <tbody>
                  {view.components.map((c) => (
                    <tr key={c.key} className="border-b border-[color:var(--border-subtle)]">
                      <td className="py-1.5 px-1.5">
                        <div className="text-[0.82rem]">{COMPONENT_LABELS[c.key] ?? c.key}</div>
                        <div className="font-mono text-[0.7rem] text-[color:var(--muted-fg)]">{c.key}</div>
                      </td>
                      <td className="py-1.5 px-1.5 text-right tabular-nums font-semibold">
                        <SourceTooltip provenance={{ assumption_key: c.key, as_of: c.as_of, source: c.rationale, anchor_ref: c.anchor_ref, run_id: c.run_id }}>
                          {formatComponentValue(c.key, c.value)}
                        </SourceTooltip>
                      </td>
                      <td className="py-1.5 px-1.5"><KindChip kind={c.kind as "live" | "user" | "derived"} /></td>
                      <td className="py-1.5 px-1.5 text-[0.8rem] text-[color:var(--muted-fg)]">
                        {c.rationale ?? "—"}
                        {c.anchor_ref && <> <a href={c.anchor_ref} className="text-[color:var(--accent)]" target="_blank" rel="noreferrer">링크</a></>}
                      </td>
                      <td className="py-1.5 px-1.5 text-[0.8rem]">{c.as_of}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 모드 탭 */}
        <div className="flex gap-1.5 mt-6" role="tablist" aria-label="입력 모드">
          <button role="tab" aria-selected={mode === "direct"} type="button"
            className={`rounded-t-lg border border-b-0 px-4 py-2 text-[0.88rem] font-semibold ${mode === "direct" ? "bg-[color:var(--surface)] text-[color:var(--accent)]" : "bg-[color:var(--muted-bg)] text-[color:var(--muted-fg)]"}`}
            onClick={() => setMode("direct")}>직접 입력</button>
          <button role="tab" aria-selected={mode === "capm"} type="button"
            className={`rounded-t-lg border border-b-0 px-4 py-2 text-[0.88rem] font-semibold ${mode === "capm" ? "bg-[color:var(--surface)] text-[color:var(--accent)]" : "bg-[color:var(--muted-bg)] text-[color:var(--muted-fg)]"}`}
            onClick={() => setMode("capm")}>CAPM 분해</button>
        </div>

        {mode === "capm" && sugg && sugg.suggestions.some((x) => x.value !== null) && (
          <section className="market-section sizing-step mt-3" aria-label="WACC 참조값">
            <h3 className="sizing-step-title">WACC 참조값 <span className="status-chip status-info">{sugg.subject?.name_ko ?? "대상 회사"} 기준 · 제안 — 확정은 사람</span></h3>
            <table className="data-table">
              <thead><tr><th scope="col">파라미터</th><th scope="col" className="num">참조값</th><th scope="col">출처 · 기준일</th><th scope="col"></th></tr></thead>
              <tbody>
                {sugg.suggestions.map((x) => (
                  <tr key={x.key}>
                    <td>{x.key === "risk_free" ? "무위험이자율 (Rf) — 국고채 3년" : x.key === "credit_spread" ? "신용등급 가산금리 (회사채 AA− − 국고채)" : "관측 D/E (부채/자본, 최근 결산)"}</td>
                    <td className="num mono-num">{x.value === null ? "N/A" : x.key === "observed_de" ? x.value.toFixed(2) : `${x.value.toFixed(2)}%`}</td>
                    <td className="text-[color:var(--muted-fg)] text-[0.76rem]">{x.value !== null ? `${x.source_label ?? ""} · ${x.as_of ?? ""}` : x.reason ?? ""}</td>
                    <td>{x.value !== null && <button type="button" className="btn-ghost btn-sm" onClick={() => applyRef(x.key, x)}>{APPLY_LABEL[x.key]}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {mode === "direct" ? (
          <form className="sizing-step grid gap-3 mt-0 rounded-tl-none" style={{ maxWidth: 460 }} onSubmit={submitDirect}>
            <h3 className="sizing-step-title">직접 입력</h3>
            <label className="grid gap-1 text-sm">WACC (비율)<input className="form-input" value={directWacc} onChange={(e) => setDirectWacc(e.target.value)} placeholder="0.095" /></label>
            <label className="grid gap-1 text-sm">Hurdle IRR (선택)<input className="form-input" value={directHurdle} onChange={(e) => setDirectHurdle(e.target.value)} placeholder="0.15" /></label>
            <label className="grid gap-1 text-sm">근거/승인 메모<textarea className="form-input" value={directRationale} onChange={(e) => setDirectRationale(e.target.value)} placeholder="Treasury 확인, IC 가이드라인 등" /></label>
            <button className="primary-button justify-self-start" type="submit">이 값으로 확정</button>
            <p className="text-[color:var(--muted-fg)] text-[0.78rem]">확정하면 이 값이 사람이 확인한 최종 값(출처 등급 user)으로 기록됩니다. 저장 시 최신 run을 복사한 새 run_input 스냅샷과 assumption(wacc/hurdle_irr) 행이 함께 생성됩니다.</p>
          </form>
        ) : (
          <form className="sizing-step mt-0 rounded-tl-none" onSubmit={submitCapm}>
            {/* ① 시장 수치 */}
            <h3 className="sizing-step-title"><span className="sizing-step-badge">1</span>시장 수치 <span className="text-[color:var(--muted-fg)] font-normal text-[0.8rem]">— 공신력 있는 외부 출처에서 확인한 값을 인용합니다 (AlphaSpread, 한국은행 ECOS 등)</span></h3>
            <div>
              <CitedRow name="무위험이자율 (Rf)" sub="국고채 3년물 기준" field={rf} onChange={setRf} />
              <CitedRow name="주식위험프리미엄 (ERP)" sub="시장 위험 프리미엄" field={erp} onChange={setErp} />
              <CitedRow name="규모 프리미엄" sub="선택 — 중소규모 할증" field={sp} onChange={setSp} forceKind="user" />
            </div>

            {/* ② 베타 추정 */}
            <h3 className="sizing-step-title mt-6"><span className="sizing-step-badge">2</span>베타 추정 <span className="text-[color:var(--muted-fg)] font-normal text-[0.8rem]">— 시장 평균 대비 변동성까지 함께 산출합니다</span></h3>
            <BetaPanel
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
              <div className="mt-3 rounded-lg border border-dashed border-[color:var(--primary-border)] bg-[color:var(--primary-bg)] p-3 text-[0.85rem]">
                <b>선택된 베타 경로:</b> {chain.path}
                {chain.text.startsWith("관측") ? (
                  <div className="text-[color:var(--muted-fg)]">{chain.text}</div>
                ) : (
                  <div className="font-mono text-[0.8rem] mt-1">{chain.text}</div>
                )}
              </div>
            )}

            {/* ③ 타인자본비용 */}
            <h3 className="sizing-step-title mt-6"><span className="sizing-step-badge">3</span>타인자본비용 (Kd) <span className="text-[color:var(--muted-fg)] font-normal text-[0.8rem]">— 회사 신용등급 기준 대출금리 또는 실제 조달금리</span></h3>
            <div className="flex gap-1.5 mb-1">
              <button type="button" onClick={() => setKdMode("rating")}
                className={`rounded-full border px-3 py-1 text-[0.8rem] ${kdMode === "rating" ? "border-[color:var(--primary-border)] bg-[color:var(--primary-bg)] text-[color:var(--accent)] font-bold" : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-fg)]"}`}>
                신용등급 + 가산금리
              </button>
              <button type="button" onClick={() => setKdMode("direct")}
                className={`rounded-full border px-3 py-1 text-[0.8rem] ${kdMode === "direct" ? "border-[color:var(--primary-border)] bg-[color:var(--primary-bg)] text-[color:var(--accent)] font-bold" : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-fg)]"}`}>
                실제 대출금리 직접 입력
              </button>
            </div>
            {kdMode === "rating" ? (
              <>
                <CitedRow name="신용등급 가산금리" sub="Rf에 가산 — 출처명에 등급 포함" field={kdSpread} onChange={setKdSpread} />
                {rfN != null && nOr(kdSpread.value) != null && (
                  <div className="grid gap-2 md:grid-cols-2 mt-2 text-sm">
                    <StatCard k="타인자본비용 Kd = Rf + 가산금리">{pct(rfN)} + {pct(nOr(kdSpread.value))} = <b>{pct(rfN + nOr(kdSpread.value)!)}</b></StatCard>
                  </div>
                )}
              </>
            ) : (
              <CitedRow name="조달금리 (실제)" sub="실행 대출금리" field={kdDirect} onChange={setKdDirect} forceKind="user" />
            )}

            {/* ④ 자본구조·세율 */}
            <h3 className="sizing-step-title mt-6"><span className="sizing-step-badge">4</span>자본구조·세율 <span className="text-[color:var(--muted-fg)] font-normal text-[0.8rem]">— 목표(target) 자본구조 기준</span></h3>
            <div className="grid md:grid-cols-2 xl:grid-cols-[9.5rem_7rem_1fr_6.5rem] gap-2 items-end py-2 border-t border-[color:var(--border-subtle)] text-sm">
              <div>
                <div className="text-[0.85rem] font-semibold">목표 D/E</div>
                <div className="text-[color:var(--muted-fg)] text-[0.72rem]">부채/자기자본</div>
              </div>
              <label className="grid gap-1 text-[0.78rem] text-[color:var(--muted-fg)]">값
                <input className="form-input" value={targetDe.value} placeholder="0.60" onChange={(e) => setTargetDe({ ...targetDe, value: e.target.value })} />
              </label>
              <label className="grid gap-1 text-[0.78rem] text-[color:var(--muted-fg)]">출처명
                <input className="form-input" value={targetDe.source} placeholder="재무계획 — 인허가 직후 목표 레버리지" onChange={(e) => setTargetDe({ ...targetDe, source: e.target.value })} />
              </label>
              <div><KindChip kind="user" /></div>
            </div>
            <div className="grid md:grid-cols-2 xl:grid-cols-[9.5rem_7rem_1fr_6.5rem] gap-2 items-end py-2 border-t border-[color:var(--border-subtle)] text-sm">
              <div>
                <div className="text-[0.85rem] font-semibold">한계 세율</div>
                <div className="text-[color:var(--muted-fg)] text-[0.72rem]">법인세 + 지방세</div>
              </div>
              <label className="grid gap-1 text-[0.78rem] text-[color:var(--muted-fg)]">값
                <input className="form-input" value={taxRate.value} placeholder="0.22" onChange={(e) => setTaxRate({ ...taxRate, value: e.target.value })} />
              </label>
              <label className="grid gap-1 text-[0.78rem] text-[color:var(--muted-fg)]">출처명
                <input className="form-input" value={taxRate.source} placeholder="법인세법 표준세율" onChange={(e) => setTaxRate({ ...taxRate, source: e.target.value })} />
              </label>
              <div><KindChip kind="user" /></div>
            </div>
            {derivation?.computed.we != null && derivation?.computed.wd != null && (
              <div className="grid gap-2 md:grid-cols-2 mt-2 text-sm">
                <StatCard k="자기자본 가중치 We = 1/(1+D/E)">{pct(derivation.computed.we)}</StatCard>
                <StatCard k="타인자본 가중치 Wd = D/E/(1+D/E)">{pct(derivation.computed.wd)}</StatCard>
              </div>
            )}

            {/* 산식 분해 */}
            <h3 className="sizing-step-title mt-6">▍산식 분해 <span className="text-[color:var(--muted-fg)] font-normal text-[0.8rem]">— 어떻게 이 값이 나왔는지 한눈에</span></h3>
            {derivation && derivation.steps.length > 0 ? (
              <>
                {derivation.missing.length > 0 && (
                  <p className="text-[color:var(--warning)] text-[0.8rem] mb-2">미입력: {derivation.missing.join(" · ")}</p>
                )}
                <DerivationTable derivation={derivation} />
                {keSteps.length > 0 && (
                  <div className="grid gap-4 lg:grid-cols-2 mt-4">
                    <div className="border border-[color:var(--border-subtle)] rounded-lg p-3">
                      <h4 className="text-[0.82rem] font-semibold text-[color:var(--muted-fg)] mb-1">자기자본비용 (CAPM) 빌드업</h4>
                      <RoicWaterfallChart steps={keSteps} numberFormat="percent" />
                    </div>
                    {waccSteps.length > 0 && (
                      <div className="border border-[color:var(--border-subtle)] rounded-lg p-3">
                        <h4 className="text-[0.82rem] font-semibold text-[color:var(--muted-fg)] mb-1">WACC 가중 혼합</h4>
                        <RoicWaterfallChart steps={waccSteps} numberFormat="percent" />
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-[color:var(--muted-fg)] text-[0.82rem]">시장 수치(①), 베타(②), 타인자본비용(③), 자본구조·세율(④)을 입력하면 산식 분해가 표시됩니다.</p>
            )}

            {/* 기록될 컴포넌트·출처 */}
            {components.length > 0 && (
              <>
                <h3 className="sizing-step-title mt-6">기록될 컴포넌트·출처 <span className="text-[color:var(--muted-fg)] font-normal text-[0.8rem]">— assumption registry에 <span className="font-mono">wacc.*</span> 키로 함께 저장됩니다</span></h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-[0.85rem]">
                    <thead>
                      <tr className="text-left text-[color:var(--muted-fg)] text-[0.75rem] border-b border-[color:var(--border-bright)]">
                        <th className="py-1.5 px-1.5">가정 키</th>
                        <th className="py-1.5 px-1.5 text-right">값</th>
                        <th className="py-1.5 px-1.5">kind</th>
                        <th className="py-1.5 px-1.5">출처 / 근거</th>
                        <th className="py-1.5 px-1.5">기준일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {components.map((c) => (
                        <tr key={c.key} className="border-b border-[color:var(--border-subtle)]">
                          <td className="py-1.5 px-1.5">
                            <div className="text-[0.82rem]">{COMPONENT_LABELS[c.key] ?? c.key}</div>
                            <div className="font-mono text-[0.7rem] text-[color:var(--muted-fg)]">{c.key}</div>
                          </td>
                          <td className="py-1.5 px-1.5 text-right tabular-nums font-semibold">{formatComponentValue(c.key, c.value)}</td>
                          <td className="py-1.5 px-1.5"><KindChip kind={c.kind} /></td>
                          <td className="py-1.5 px-1.5 text-[0.8rem] text-[color:var(--muted-fg)]">{c.sourceLabel ?? c.rationale ?? "—"}{c.anchorRef && <> <a href={c.anchorRef} className="text-[color:var(--accent)]" target="_blank" rel="noreferrer">링크</a></>}</td>
                          <td className="py-1.5 px-1.5 text-[0.8rem]">{c.asOf ?? "—"}</td>
                        </tr>
                      ))}
                      <tr className="border-b border-[color:var(--border-subtle)] bg-[color:var(--primary-bg)] font-bold">
                        <td className="py-1.5 px-1.5 font-mono text-[0.8em]">wacc (최종 확정)</td>
                        <td className="py-1.5 px-1.5 text-right tabular-nums">{pct(nOr(waccFinal))}</td>
                        <td className="py-1.5 px-1.5"><KindChip kind="user" /></td>
                        <td className="py-1.5 px-1.5 text-[0.8rem] text-[color:var(--muted-fg)]">사람이 최종 확정한 값 — FS 게이트 진입 필수 요건</td>
                        <td className="py-1.5 px-1.5 text-[0.8rem]">—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* 확정 저장 */}
            <h3 className="sizing-step-title mt-6">확정 저장 <span className="text-[color:var(--muted-fg)] font-normal text-[0.8rem]">— 사람이 최종 값을 확인·확정합니다 (출처 등급: user = 사람 확정)</span></h3>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm">WACC (비율) — CAPM 계산값이 미리 채워짐
                <input className="form-input" value={waccFinal} placeholder={computedWacc != null ? computedWacc.toFixed(4) : "0.095"} onChange={(e) => { setWaccFinal(e.target.value); setWaccTouched(true); }} />
              </label>
              <label className="grid gap-1 text-sm">Hurdle IRR (선택)
                <input className="form-input" value={hurdle} placeholder="0.15" onChange={(e) => setHurdle(e.target.value)} />
              </label>
            </div>
            <label className="grid gap-1 text-sm mt-1">근거/승인 메모
              <textarea className="form-input" rows={2} value={rationale} placeholder="예: ECOS 9/10 마감값, ERP는 Damodaran 2026-01판, 회귀 표본 250일 — 확정" onChange={(e) => setRationale(e.target.value)} />
            </label>
            {computedWacc != null && nOr(waccFinal) != null && (
              mismatch ? (
                <p role="status" className="text-[color:var(--warning)] bg-[color:var(--warning-bg)] rounded-md px-3 py-2 text-[0.8rem] mt-2">
                  ⚠ 계산값 {pct(computedWacc)} ≠ 확정값 {pct(nOr(waccFinal))} — 차이 근거를 메모에 기재해야 합니다.
                </p>
              ) : (
                <p role="status" className="text-[color:var(--success)] bg-[color:var(--success-bg)] rounded-md px-3 py-2 text-[0.8rem] mt-2">
                  ✓ 확정값 {pct(nOr(waccFinal))} 가 CAPM 계산값과 일치합니다.
                </p>
              )
            )}
            <button className="primary-button justify-self-start mt-2" type="submit">이 값으로 확정</button>
            <p className="text-[color:var(--muted-fg)] text-[0.78rem]">확정값이 계산값과 다르면 ⚠ 경고가 표시되고, 차이 근거를 메모에 기재해야 합니다. 저장 시 컴포넌트·산식 분해 전체가 하나의 run 스냅샷으로 기록되어 FS 게이트 산출물에서 재현됩니다.</p>
          </form>
        )}
      </StageFrame>
    </main>
  );
}
