"use client";

// S8 WACC 입력 세션 — FS 진행 할인율 확정 (ADR-0115).
// 직접 입력(기존) + CAPM 분해 모드: 시장 수치는 외부 출처(AlphaSpread,
// 한국은행 ECOS 등)에서 인용해 값·출처·기준일을 남기고, 인용값이 없으면
// CAPM(자기자본비용)과 신용등급 기반 타인자본비용으로 WACC를 산출한다.
// 산식 분해 표·워터폴은 db/lib/wacc-components.ts의 assembleDerivation 하나로
// 그린다 — 서버가 저장하는 derivation과 같은 구현이므로 화면과 DB가 drift하지
// 않는다. 화면 구성은 승인된 목업
// docs/designs/mockups/2026-09-10-wacc-capm-ui-mockup_ko.html 기준.

import { type TranslatorFn, resolveLabels } from "../../i18n/config.ts";
import { suggestionToInputValue } from "../../lib/wacc-suggestion-convert.ts";
import {
  type AppliedCreditRef,
  type AppliedErpRef,
  type AppliedTaxRef,
  type ApplyAllExcluded,
  type ReferenceSuggestion,
  appliedCreditRefFrom,
  appliedErpRefFrom,
  appliedTaxRefFrom,
  applicableSuggestions,
  creditCollectUrl,
  creditReferenceFields,
  creditSourceLabel,
  erpReferenceFields,
  formatCreditAnchorPct,
  kdKeWarning,
  missingReferenceItems,
  observedDeAsTarget,
  observedDeSourceDetail,
  reasonByCode,
  safeHttpsUrl,
  taxReferenceFields,
  toWaccComponentPayload,
} from "../../lib/wacc-reference-items.ts";
import { KO_DATA } from "../../lib/ko-data-values.ts";
import { type MouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import { SourceTooltip } from "../SourceTooltip.tsx";
import { WaccStatusBadge } from "../WaccStatusBadge.tsx";
import { ParamTable } from "../ui.tsx";
import { RoicWaterfallChart } from "../RoicWaterfallChart.tsx";
import { BetaPanel, type PeerRow } from "./BetaPanel.tsx";
import { CreditRatingEvidence } from "./CreditRatingEvidence.tsx";
import { DerivationTable } from "./DerivationTable.tsx";
import { api } from "../../lib/api.ts";
import TargetSelector, { type AnalysisTarget } from "../TargetSelector.tsx";
import { resolveTargetScope } from "../../lib/target-default.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteProject } from "../../lib/project-write-access.ts";
import { useCollectRun } from "../../lib/use-collect-run.ts";
import { formatDateTimeHm } from "../../lib/format.ts";
import {
  COLLECT_BLOCK_ID,
  type CollectRowKey,
  collectEmphasis,
  collectRowId,
  creditCollectAvailable,
  creditCollectNeeded,
  creditReasonLinksToCollect,
  creditRowStatus,
  ecosCollectNeeded,
  ecosRowStatus,
} from "../../lib/wacc-collect-rows.ts";
import {
  assembleDerivation,
  capmComponentGaps,
  hamadaRelever,
  hamadaUnlever,
  type WaccComponentInput,
  type WaccDerivation,
} from "../../../../db/lib/wacc-components.ts";
import {
  medianBetaUnlevered,
  regressionFromText,
  type BetaRegressionResult,
} from "../../../../db/lib/beta-regression.ts";
import { useLocale, useTranslations } from "next-intl";

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

function KindChip({ kind }: { kind: "live" | "user" | "derived" }) {
  const t = useTranslations("stages.s8.wacc.waccPanel");
  const map = {
    live: t("liveCited"),
    user: t("userJudgement"),
    derived: t("derivedComputed"),
  } as const;
  const cls = {
    live: "bg-[color:var(--success-bg)] text-[color:var(--green-fg)]",
    user: "bg-[color:var(--primary-bg)] text-[color:var(--accent)]",
    derived: "bg-[color:var(--muted-bg)] text-[color:var(--muted-fg)]",
  } as const;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[length:var(--fs-caption)] font-bold whitespace-nowrap ${cls[kind]}`}
    >
      {map[kind]}
    </span>
  );
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
  const t = useTranslations("stages.s8.wacc.waccPanel");
  const tc = useTranslations("common");
  const kind: "live" | "user" = forceKind ?? (field.source.trim() !== "" ? "live" : "user");
  return (
    <div className="grid md:grid-cols-[9.5rem_7rem_1fr_1fr] lg:grid-cols-[9.5rem_7rem_1fr_1fr_7.5rem_6.5rem] gap-2 items-end py-2 border-t border-[color:var(--border-subtle)] text-sm">
      <div>
        <div className="text-[length:var(--fs-body)] font-semibold">{name}</div>
        {sub && <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{sub}</div>}
      </div>
      <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
        {tc("value")}
        <input
          className="form-input"
          value={field.value}
          onChange={(e) => onChange({ ...field, value: e.target.value })}
        />
      </label>
      <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
        {tc("sourceName")}
        <input
          className="form-input"
          value={field.source}
          placeholder={t("bankOfKoreaEcosGovernment")}
          onChange={(e) => onChange({ ...field, source: e.target.value })}
        />
      </label>
      <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
        {t("sourceUrlEvidenceReference")}
        <input
          className="form-input"
          value={field.url}
          placeholder="https://…"
          onChange={(e) => onChange({ ...field, url: e.target.value })}
        />
      </label>
      <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] md:col-start-3 lg:col-start-auto">
        {tc("asOfDate")}
        <input
          className="form-input"
          value={field.asOf}
          placeholder="2026-09-10"
          onChange={(e) => onChange({ ...field, asOf: e.target.value })}
        />
      </label>
      <div>
        <KindChip kind={kind} />
      </div>
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

const COMPONENT_LABELS = (tr: TranslatorFn): Record<string, string> =>
  resolveLabels(tr, {
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

export function WaccPanel({ projectId }: { projectId: string }) {
  const tr = useTranslations();
  const t = useTranslations("stages.s8.wacc.waccPanel");
  const tc = useTranslations("common");
  const locale = useLocale();
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
  const [saveWarnings, setSaveWarnings] = useState<string[]>([]);

  // ── 모드 ──
  // CAPM decomposition is the structured default (the parameters analysts tune live there);
  // a project whose saved WACC is a direct user input keeps opening in direct mode.
  const [mode, setMode] = useState<"direct" | "capm">("capm");

  // ── 참조값 (ADR-0116 Phase 4; 제안일 뿐 — 확정은 사람) ──
  type Sugg = ReferenceSuggestion;
  interface SuggPayload {
    subject: { name_ko: string | null } | null;
    suggestions: Sugg[];
    // ADR-0207: published ERP alternatives (never part of apply-all) and the items apply-all skips.
    erp_alternatives?: Sugg[];
    apply_all_excluded?: ApplyAllExcluded[];
    missing?: string[];
  }
  const [sugg, setSugg] = useState<SuggPayload | null>(null);
  // ERP reference the human applied to the form (null = typed manually / none applied).
  const [erpRef, setErpRef] = useState<AppliedErpRef | null>(null);
  // Statutory tax-rate reference the human applied (ADR-0207 addendum); its bracket id + basis travel with the confirmation.
  const [taxRef, setTaxRef] = useState<AppliedTaxRef | null>(null);
  // ADR-0208: credit-spread reference the human applied (rating basis + ECOS month); null = typed manually / legacy AA- applied.
  const [creditRef, setCreditRef] = useState<AppliedCreditRef | null>(null);
  const targetQuery = selectedTarget ? `?target_id=${encodeURIComponent(selectedTarget)}` : "";
  const loadSugg = useCallback(() => {
    api
      .get<SuggPayload>(`/api/projects/${encodeURIComponent(projectId)}/wacc/suggestions${targetQuery}`)
      .then((r) => setSugg(r.data)) // 제안은 선택 대상(기본: 게이트 기준 회사)을 따라 갱신 — 확정은 사람
      .catch(() => setSugg(null));
  }, [projectId, targetQuery]);
  useEffect(() => {
    loadSugg();
  }, [loadSugg]);
  // ECOS 수집 실행 — 위험무풍수익률·신용스프레드 참조값이 비어 있을 때(ECOS 시계열 미수집). 202 + 폴링은
  // useCollectRun 이 맡고, 실행이 끝나면(성공·실패 모두) 참조값을 다시 불러온다.
  const ecos = useCollectRun(`/api/projects/${encodeURIComponent(projectId)}/wacc/ecos/collect`, () => {
    loadSugg();
  });
  const ecosMessage =
    ecos.phase === "done"
      ? t("collectEcosDone")
      : ecos.phase === "failed"
        ? t("collectEcosFailed", { p1: ecos.run?.error ?? "" })
        : ecos.startError !== null
          ? ecos.startError || t("collectEcosStartFailed")
          : null;
  // 신용등급 수집 실행 (ADR-0208) — DART 사업보고서에서 공시 신용등급을 읽어 캐시에 채운다. 제안 GET 은 캐시만
  // 읽으므로, 실행이 끝나면(성공·실패 모두) 참조값을 다시 불러온다. 선택 대상(target_id)을 따라간다.
  const creditCollect = useCollectRun(creditCollectUrl(projectId, selectedTarget), () => {
    loadSugg();
  });
  const creditCollectMessage =
    creditCollect.phase === "done"
      ? t("collectCreditDone")
      : creditCollect.phase === "failed"
        ? t("collectCreditFailed", { p1: creditCollect.run?.error ?? "" })
        : creditCollect.startError !== null
          ? creditCollect.startErrorCode === "no_subject_company"
            ? t("collectCreditNoSubject")
            : creditCollect.startError || t("collectCreditStartFailed")
          : null;
  useEffect(() => {
    api
      .get<{ targets: AnalysisTarget[] }>(`/api/projects/${encodeURIComponent(projectId)}/targets`)
      .then((r) => setTargets(r.data.targets ?? []))
      .catch(() => setTargets([]));
  }, [projectId]);
  const applyRef = useCallback((key: string, e: Sugg) => {
    // ECOS percent points (risk_free, credit_spread) become ratios; observed_de is already a multiple.
    const ratio = suggestionToInputValue(key, e.value);
    const cited = {
      value: ratio !== null ? String(ratio) : "",
      source: e.source_label ?? "",
      url: e.anchor_ref ?? "",
      asOf: e.as_of ?? "",
    };
    if (key === "risk_free") setRf(cited);
    // ADR-0208: the citation names the rating and how the spread was mapped; the basis and ECOS month travel with the confirmation.
    if (key === "credit_spread") {
      setKdSpread({ ...cited, source: creditSourceLabel(e) });
      setCreditRef(appliedCreditRefFrom(e, ratio));
    }
    if (key === "observed_de") setObsDe({ value: cited.value, source: cited.source, asOf: cited.asOf });
    // ADR-0207: an applied ERP reference replaces any earlier one; its id travels with the confirmation.
    if (key === "erp") {
      setErp(cited);
      setErpRef(appliedErpRefFrom(e, ratio));
    }
    // ADR-0207 addendum: the statutory rate fills the marginal tax-rate input; a later edit is flagged on confirmation.
    if (key === "tax_rate") {
      setTaxRate({ value: cited.value, source: cited.source });
      setTaxRef(appliedTaxRefFrom(e, ratio));
    }
  }, []);
  const REF_LABEL: Record<string, string> = {
    risk_free: t("rfGovernmentBond"),
    credit_spread: t("creditSpreadMinusGovernmentBond"),
    observed_de: tc("observedDE"),
    erp: t("equityRiskPremiumErp2"),
    tax_rate: t("taxRatePublishedLabel"),
  };
  const missingItems = missingReferenceItems(sugg?.suggestions ?? [], sugg?.apply_all_excluded);
  const applicable = applicableSuggestions(sugg?.suggestions ?? [], sugg?.apply_all_excluded);
  const applicableCount = applicable.length;
  const APPLY_LABEL: Record<string, string> = {
    risk_free: t("applyRf"),
    credit_spread: t("applyCreditSpread"),
    observed_de: t("applyDE"),
    erp: t("applyErp"),
    tax_rate: t("applyTaxRate"),
  };
  const TAX_BASIS_LABEL: Record<string, string> = {
    bracket_estimate: t("taxBasisBracketEstimate"),
    top_bracket_fallback: t("taxBasisTopFallback"),
  };
  const TAX_NULL_REASON_LABEL: Record<string, string> = {
    tax_rate_market_not_kr: t("taxReasonNotKr"),
    tax_rate_no_registry: t("taxReasonNoRegistry"),
    tax_rate_registry_error: t("taxReasonRegistryError"),
  };
  const TAX_FALLBACK_LABEL: Record<string, string> = {
    tax_income_no_company: t("taxFallbackNoCompany"),
    tax_income_no_financials: t("taxFallbackNoFinancials"),
    tax_income_not_positive: t("taxFallbackNotPositive"),
  };
  const ERP_BASIS_LABEL: Record<string, string> = {
    implied: t("erpBasisImplied"),
    historical: t("erpBasisHistorical"),
    survey: t("erpBasisSurvey"),
    recommended: t("erpBasisRecommended"),
  };
  const ERP_REASON_LABEL: Record<string, string> = {
    erp_reference_stale: t("erpReasonStale"),
    erp_market_not_kr: t("erpReasonNotKr"),
    erp_no_registry: t("erpReasonNoRegistry"),
    erp_registry_error: t("erpReasonRegistryError"),
  };
  /** 기본 표시 + 오래됨 칩 — 상태는 글자로 전달한다 (색만으로 구분하지 않음, FR-SYS-05). */
  const erpChips = (x: Sugg) => (
    <>
      {x.is_default && (
        <span className="status-chip status-info" data-testid="erp-default-marker">
          {t("erpDefaultMarker")}
        </span>
      )}
      {x.stale && (
        <span className="status-chip status-amber" data-testid="erp-stale-badge">
          {t("erpStaleBadge")}
        </span>
      )}
    </>
  );
  const CREDIT_SOURCE_LABEL: Record<string, string> = {
    default: t("creditSourceDefault"),
    disclosed: t("creditSourceDisclosed"),
    bureau: t("creditSourceBureau"),
    synthetic: t("creditSourceSynthetic"),
  };
  const CREDIT_BASIS_LABEL: Record<string, string> = {
    ecos_interpolated: t("creditBasisInterpolated"),
    ecos_clamped: t("creditBasisClamped"),
    aa_minus_legacy: t("creditBasisLegacy"),
  };
  const CREDIT_FLAG_LABEL: Record<string, string> = {
    interpolated: t("creditFlagInterpolated"),
    above_upper_anchor_clamped: t("creditFlagAboveUpperClamped"),
    below_investment_grade_series_understates: t("creditFlagBelowInvestmentGrade"),
    clamped_fallback: t("creditFlagClampedFallback"),
  };
  // Backend reason codes of the credit_spread entry (rating rung, spread map, apply-all exclusions) -> localized text.
  const CREDIT_REASON_LABEL: Record<string, string> = {
    no_disclosed_rating_and_synthetic_unavailable: t("creditReasonNoRatingEvidence"),
    credit_rating_default_basis: t("creditReasonDefaultBasis"),
    credit_rating_stale: t("creditReasonStale"),
    rating_not_collected: t("creditReasonNotCollected"),
    disclosed_rating: t("creditReasonDisclosed"),
    bureau_issuer_rating: t("creditReasonBureauRating"),
    credit_rating_bureau_basis: t("creditReasonBureauBasis"),
    credit_spread_legacy_basis: t("creditReasonLegacyBasis"),
    credit_rating_no_registry: t("creditReasonNoRegistry"),
    credit_rating_registry_error: t("creditReasonRegistryError"),
    no_ecos_observations: t("creditReasonNoEcos"),
    rating_not_in_scale: t("creditReasonNotInScale"),
    anchor_missing: t("creditReasonAnchorMissing"),
    spread_not_positive: t("creditReasonSpreadNotPositive"),
    anchors_inverted: t("creditReasonAnchorsInverted"),
  };
  // Why the disclosed rung produced no rating (disclosed_status) -> localized text; "parsed" is the success value.
  const CREDIT_STATUS_LABEL: Record<string, string> = {
    parsed: t("creditStatusParsed"),
    rating_not_collected: t("creditStatusNotCollected"),
    not_disclosed: t("creditStatusNotDisclosed"),
    section_present_no_bond_rating: t("creditStatusSectionPresentNoBondRating"),
    section_absent: t("creditStatusSectionAbsent"),
    parse_failed: t("creditStatusParseFailed"),
    not_zip: t("creditStatusNotZip"),
    no_bond_rating: t("creditStatusNoBondRating"),
    no_dart_corp_code: t("creditStatusNoDartCode"),
  };
  const creditReasonText = (code: string | null | undefined, fallback: string | null | undefined) =>
    reasonByCode(CREDIT_REASON_LABEL, code, fallback);
  /** 등급·근거·보간 방식 칩 — 상태는 글자로 전달한다 (색만으로 구분하지 않음, FR-SYS-05). */
  const creditChips = (x: Sugg) => (
    <>
      {x.rating && (
        <span className="status-chip status-info" data-testid="credit-rating-chip">
          {t("creditRatingChip", { rating: x.rating })}
        </span>
      )}
      {x.rating_source && (
        <span
          className={`status-chip ${x.rating_source === "default" || x.rating_source === "bureau" ? "status-amber" : "status-info"}`}
          data-testid="credit-source-chip"
        >
          {CREDIT_SOURCE_LABEL[x.rating_source] ?? x.rating_source}
        </span>
      )}
      {x.rating_stale && (
        <span className="status-chip status-amber" data-testid="credit-stale-chip">
          {t("creditStaleChip")}
        </span>
      )}
      {x.spread_basis && (
        <span className="status-chip status-info" data-testid="credit-basis-chip">
          {CREDIT_BASIS_LABEL[x.spread_basis] ?? x.spread_basis}
        </span>
      )}
      {x.derived && (
        <span className="status-chip status-info" data-testid="credit-derived-chip">
          {t("creditDerivedChip")}
        </span>
      )}
    </>
  );
  /** 앵커 한 줄(AA− · BBB− · 기준월). 앵커가 없으면(기존 AA− 유지) 줄을 만들지 않는다. */
  const creditAnchorsText = (x: Sugg) =>
    x.anchors
      ? t("creditAnchorsLine", {
          aa: formatCreditAnchorPct(x.anchors.aa_minus_pct),
          bbb: formatCreditAnchorPct(x.anchors.bbb_minus_pct),
          asOf: x.anchors.as_of,
        })
      : null;
  const creditNoteLines = (x: Sugg): string[] => {
    const lines: string[] = [];
    const rating = creditReasonText(x.reason_code, x.reason);
    if (rating) lines.push(rating);
    // rating_not_collected already has its own reason (with the collect hint); the other misses add their own line.
    if (x.disclosed_status && x.disclosed_status !== "rating_not_collected") {
      lines.push(CREDIT_STATUS_LABEL[x.disclosed_status] ?? x.disclosed_status);
    }
    for (const f of x.flags ?? []) lines.push(CREDIT_FLAG_LABEL[f] ?? f);
    const spread = creditReasonText(x.spread_reason_code, x.spread_reason);
    if (spread) lines.push(spread);
    return lines;
  };
  const creditSugg = sugg?.suggestions.find((x) => x.key === "credit_spread");
  const ecosSuggested = !!sugg?.suggestions.some((x) => x.key === "risk_free" || x.key === "credit_spread");
  /** ECOS row status line - what the reference data currently holds (suggestion fields only). */
  const ecosStatusText = () => {
    const s = ecosRowStatus(sugg?.suggestions ?? []);
    if (s.kind === "missing") return t("collectStatusEcosMissing");
    return s.asOf ? t("collectStatusEcosCollected", { asOf: s.asOf }) : t("collectStatusEcosCollectedNoDate");
  };
  /** Credit-rating row status line - rating, its source/date, or why there is none. */
  const creditStatusText = () => {
    const s = creditRowStatus(creditSugg);
    switch (s.kind) {
      case "no_dart_code":
        return t("collectStatusCreditNoDartCode");
      case "not_collected":
        return t("collectStatusCreditNotCollected");
      case "rated": {
        const head =
          s.source === "disclosed"
            ? t("collectStatusCreditDisclosed", { rating: s.rating })
            : s.bondRatingMissing
              ? t("collectStatusCreditBureauNoBond", { rating: s.rating })
              : t("collectStatusCreditBureau", { rating: s.rating });
        return [
          head,
          s.ratedOn ? t("collectStatusRatedOn", { ratedOn: s.ratedOn }) : null,
          s.stale ? t("collectStatusStale") : null,
        ]
          .filter(Boolean)
          .join(" · ");
      }
      case "no_rating":
        return (s.statusCode && CREDIT_STATUS_LABEL[s.statusCode]) || t("collectStatusCreditNotCollected");
      default:
        return t("collectStatusCreditDefault");
    }
  };
  /** Jump from a reason text to its collect row (moves focus so keyboard users land on it). */
  const goToCollectRow = (key: CollectRowKey) => (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const el = document.getElementById(collectRowId(key));
    el?.scrollIntoView({ block: "center" });
    el?.focus();
  };
  const collectLink = (key: CollectRowKey) => (
    <a
      href={`#${collectRowId(key)}`}
      onClick={goToCollectRow(key)}
      className="ml-1 text-[color:var(--accent)] underline"
      data-testid={`wacc-collect-link-${key}`}
    >
      {t("collectGoToArea")}
    </a>
  );
  /** One source row of the collect block: name, what it fills, source, status, then the (emphasis-ruled) button. */
  const collectRow = (o: {
    key: CollectRowKey;
    name: string;
    fills: string;
    source: string;
    status: string;
    needed: boolean;
    runCollect: ReturnType<typeof useCollectRun>;
    message: string | null;
    runLabel: string;
    rerunLabel: string;
    runningText: string;
    actionTestId?: string;
    noAction?: boolean;
  }) => {
    const { runCollect: rc } = o;
    const primary = collectEmphasis(o.needed) === "primary";
    const finishedAt = rc.phase === "done" || rc.phase === "failed" ? rc.run?.finished_at : null;
    return (
      <li
        key={o.key}
        id={collectRowId(o.key)}
        tabIndex={-1}
        className="min-w-0 flex flex-wrap items-start justify-between gap-2 p-3 rounded-lg border border-[color:var(--border)]"
        data-testid={`wacc-collect-row-${o.key}`}
        data-emphasis={primary ? "primary" : "secondary"}
      >
        <div className="min-w-0 flex-1 basis-[16rem] [overflow-wrap:anywhere]">
          <div className="font-semibold text-[length:var(--fs-body)]">{o.name}</div>
          <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
            {t("collectFillsLabel")}: {o.fills}
          </div>
          <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
            {t("collectSourceLabel")}: {o.source}
          </div>
          <div className="text-[length:var(--fs-caption)]" data-testid={`wacc-collect-status-${o.key}`}>
            {t("collectStatusLabel")}: {o.status}
            {finishedAt ? ` · ${t("collectLastRun", { when: formatDateTimeHm(finishedAt, locale) })}` : ""}
          </div>
        </div>
        {!o.noAction && (
          <div className="flex flex-col items-start gap-1 shrink-0" aria-live="polite" data-testid={o.actionTestId}>
            <button
              type="button"
              className={primary ? "btn-primary btn-sm" : "btn-ghost btn-sm"}
              aria-label={primary ? o.runLabel : o.rerunLabel}
              disabled={rc.busy}
              aria-busy={rc.busy}
              onClick={() => void rc.start()}
            >
              {rc.busy ? tc("loadingEllipsis") : primary ? t("collectRowRun") : t("collectRowRerun")}
            </button>
            {rc.phase === "running" && (
              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{o.runningText}</span>
            )}
          </div>
        )}
        {o.message && (
          <p
            role={rc.phase === "done" ? undefined : "alert"}
            className={`basis-full m-0 text-[length:var(--fs-caption)] font-semibold ${rc.phase === "done" ? "text-[color:var(--accent)]" : "text-[color:var(--red-fg)]"}`}
            data-testid={`wacc-collect-message-${o.key}`}
          >
            {rc.phase === "done" ? "✓" : "✕"} {o.message}
          </p>
        )}
      </li>
    );
  };
  const erpSourceLink = (x: Sugg) => {
    const href = safeHttpsUrl(x.anchor_ref);
    const label = x.source_label ?? "";
    return href ? (
      <a href={href} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">
        {label}
        <span className="sr-only"> {t("erpOpensInNewTab")}</span>
      </a>
    ) : (
      label
    );
  };
  const erpReasonText = (code: string | undefined, fallback: string | undefined) =>
    (code ? ERP_REASON_LABEL[code] : undefined) ?? fallback ?? "";
  const taxReasonText = (code: string | undefined, fallback: string | undefined) =>
    (code ? TAX_NULL_REASON_LABEL[code] : undefined) ?? fallback ?? "";
  /** 구간 텍스트 — 과세표준 구간(백만원). 상한이 없으면 "초과" 표기. */
  const taxBracketText = (x: Sugg) =>
    x.bracket
      ? x.bracket.upper_krw_million === null
        ? t("taxBracketRangeOpen", { lower: x.bracket.lower_krw_million.toLocaleString("en-US") })
        : t("taxBracketRange", {
            lower: x.bracket.lower_krw_million.toLocaleString("en-US"),
            upper: x.bracket.upper_krw_million.toLocaleString("en-US"),
          })
      : "";
  const taxSourceLink = (x: Sugg) => {
    const href = safeHttpsUrl(x.anchor_ref);
    const label = [x.statute_ref, x.local_statute_ref].filter(Boolean).join(" · ") || (x.source_label ?? "");
    return href ? (
      <a href={href} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">
        {label}
        <span className="sr-only"> {t("erpOpensInNewTab")}</span>
      </a>
    ) : (
      label
    );
  };
  /** 소득 근거·대체 사유·회계이익≠과세표준 주의 — 영업이익 기준일 때는 세전이익 미수집 사실을 함께 밝힌다. */
  const taxNoteLines = (x: Sugg): string[] => {
    const lines: string[] = [];
    if (x.basis === "bracket_estimate" && x.income_period && x.estimated_income_krw_million != null) {
      const args = {
        period: x.income_period,
        income: x.estimated_income_krw_million.toLocaleString("en-US"),
      };
      lines.push(
        x.income_account === "operating_income"
          ? t("taxNoteEstimatedOperating", args)
          : t("taxNoteEstimatedPretax", args),
      );
    } else if (x.fallback_reason_code || x.fallback_reason) {
      lines.push(
        t("taxNoteFallback", {
          reason:
            (x.fallback_reason_code ? TAX_FALLBACK_LABEL[x.fallback_reason_code] : undefined) ??
            x.fallback_reason ??
            "",
        }),
      );
    }
    lines.push(t("taxNoteCaveat", { pct: x.local_rate_adjustment_pct ?? 50 }));
    return lines;
  };

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
    api
      .get<View>(`/api/projects/${encodeURIComponent(projectId)}/wacc${targetQuery}`)
      .then((r) => {
        setView(r.data);
        setDirectWacc(String(r.data.wacc.value));
        if (r.data.hurdle_irr) setHurdle(String(r.data.hurdle_irr.value));
        setMode(r.data.components.length === 0 && r.data.wacc.source === "user" ? "direct" : "capm");
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("failedToLoadWaccInformation")));
  }, [projectId, targetQuery, t]);
  useEffect(() => {
    load();
  }, [load]);

  const taxN = nOr(taxRate.value);
  const targetDeN = nOr(targetDe.value);
  const rfN = nOr(rf.value);
  const erpN = nOr(erp.value);
  const spN = nOr(sp.value);
  const obsDeN = nOr(obsDe.value);
  // 관측 D/E를 목표 D/E로 준용 — apply-all 대상이 아니며, 사람이 버튼으로만 채운다.
  const observedForTarget = observedDeAsTarget(
    obsDe,
    (sugg?.suggestions ?? []).find((x) => x.key === "observed_de"),
  );
  const applyObservedDeAsTarget = () => {
    if (!observedForTarget) return;
    setTargetDe({
      value: String(observedForTarget.value),
      source: t("targetDeFromObserved", { detail: observedDeSourceDetail(observedForTarget) }),
    });
  };

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
    // ERP is a user judgement (ADR-0115) — a cited or applied reference never makes it 'live'.
    cited("wacc.erp", erp, "user");
    const erpComp = comps.find((c) => c.key === "wacc.erp");
    if (erpComp) Object.assign(erpComp, erpReferenceFields(erpRef, erpComp.value));
    cited("wacc.size_premium", sp, "user");
    if (betaTab === "regression" && regResult) {
      comps.push({
        key: "wacc.beta_levered",
        value: regResult.beta,
        kind: "derived",
        rationale: t("regressionP1P2DaysP3", {
          p1: regResult.r2.toFixed(2),
          p2: regResult.n,
          p3: regResult.windowStart,
          p4: regResult.windowEnd,
        }),
      });
      comps.push({ key: "wacc.beta_r2", value: regResult.r2, kind: "derived", rationale: t("regressionStats") });
      comps.push({
        key: "wacc.beta_alpha",
        value: regResult.annualAlpha,
        kind: "derived",
        rationale: t("regressionStatsAnnualized"),
      });
      comps.push({
        key: "wacc.beta_vol_asset",
        value: regResult.annualVolAsset,
        kind: "derived",
        rationale: t("annualizedVolatilityAsset2"),
      });
      comps.push({
        key: "wacc.beta_vol_market",
        value: regResult.annualVolMarket,
        kind: "derived",
        rationale: t("annualizedVolatilityMarket2"),
      });
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
            usable.map((p) => ({
              label: p.name,
              betaLevered: nOr(p.beta)!,
              deRatio: nOr(p.de) ?? 0,
              taxRate: taxN ?? 0,
            })),
          );
          comps.push({
            key: "wacc.beta_unlevered",
            value: median,
            kind: "derived",
            rationale: t("peerMedianP1", {
              p1: usable.map((p) => `${p.name} β${p.beta}/D-E ${p.de}${p.source ? ` (${p.source})` : ""}`).join(", "),
            }),
          });
        } catch {
          // out-of-range peer input — no beta component until fixed
        }
      }
    }
    if (kdMode === "rating") {
      cited("wacc.debt_spread", kdSpread);
      const spreadComp = comps.find((c) => c.key === "wacc.debt_spread");
      if (spreadComp) Object.assign(spreadComp, creditReferenceFields(creditRef, spreadComp.value));
    } else cited("wacc.cost_of_debt", kdDirect);
    if (targetDeN !== null) {
      comps.push({
        key: "wacc.target_de",
        value: targetDeN,
        kind: "user",
        sourceLabel: targetDe.source.trim() || undefined,
      });
    }
    if (taxN !== null) {
      comps.push({
        key: "wacc.tax_rate",
        value: taxN,
        kind: "user",
        sourceLabel: taxRate.source.trim() || undefined,
        ...taxReferenceFields(taxRef, taxN),
      });
    }
    return comps;
  }, [
    rf,
    erp,
    erpRef,
    sp,
    betaTab,
    regResult,
    obsDe,
    obsDeN,
    peers,
    taxN,
    taxRef,
    creditRef,
    kdMode,
    kdSpread,
    kdDirect,
    targetDe,
    targetDeN,
    taxRate,
    t,
  ]);

  const derivation = useMemo(() => (components.length > 0 ? assembleDerivation(components) : null), [components]);
  const computedWacc = derivation?.computed.wacc ?? null;
  const gaps = useMemo(() => capmComponentGaps(components), [components]);
  // ADR-0208: Kd at or above Ke is a warning only (the BBB- ECOS series can run extreme) - it never blocks confirmation.
  const kdKe = kdKeWarning(
    { kd: derivation?.computed.kd ?? null, ke: derivation?.computed.ke ?? null },
    kdMode === "rating" ? (sugg?.suggestions ?? []).find((x) => x.key === "credit_spread")?.kd_indicative_pct : null,
  );

  useEffect(() => {
    if (!waccTouched && computedWacc != null) setWaccFinal(computedWacc.toFixed(4));
  }, [computedWacc, waccTouched]);

  const mismatch =
    computedWacc != null && nOr(waccFinal) !== null && Math.abs(computedWacc - nOr(waccFinal)!) > 0.00005;

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
  }, [derivation, rfN, erpN, spN, t]);
  const waccSteps = useMemo(() => {
    const d = derivation;
    if (
      !d ||
      d.computed.wacc == null ||
      d.computed.ke == null ||
      d.computed.kd == null ||
      d.computed.we == null ||
      d.computed.wd == null ||
      taxN == null
    )
      return [];
    const steps: { step: string; value: number; kind: "delta" | "total" }[] = [
      { step: t("equityContribution"), value: d.computed.we * d.computed.ke, kind: "total" },
      { step: t("debtContributionAfterTax"), value: d.computed.wd * d.computed.kd * (1 - taxN), kind: "delta" },
      { step: "WACC", value: d.computed.wacc, kind: "total" },
    ];
    return steps;
  }, [derivation, taxN, t]);

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
  }, [betaTab, regResult, obsDeN, taxN, targetDeN, components, t]);

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
      const res = await api.post<{
        run_id: string;
        wacc_computed: number | null;
        computed_mismatch: boolean;
        wacc: WaccResolution;
        hurdle_irr: WaccResolution | null;
        warnings?: string[];
      }>(`/api/projects/${encodeURIComponent(projectId)}/wacc`, {
        wacc: w,
        hurdle_irr: hurdle.trim() || undefined,
        mode: "capm",
        rationale,
        components: components.map(toWaccComponentPayload),
        target_id: selectedTarget ?? undefined,
      });
      const mismatchNote =
        res.data.computed_mismatch && res.data.wacc_computed != null
          ? t("capmValueP1ConfirmedValue", { p1: pct(res.data.wacc_computed), p2: pct(w) })
          : "";
      setMessage(t("savedRunP1P2", { p1: res.data.run_id, p2: mismatchNote }));
      setSaveWarnings(res.data.warnings ?? []);
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
      const res = await api.post<{ run_id: string; warnings?: string[] }>(
        `/api/projects/${encodeURIComponent(projectId)}/wacc`,
        {
          wacc: Number(directWacc),
          hurdle_irr: directHurdle.trim() ? Number(directHurdle) : undefined,
          mode: "direct",
          rationale: directRationale,
          subject: selectedTarget ? undefined : subject || undefined,
          subject_rationale: selectedTarget ? undefined : subject ? subjectRationale : undefined,
          target_id: selectedTarget ?? undefined,
        },
      );
      setSaveWarnings(res.data.warnings ?? []);
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
            <p
              className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]"
              data-testid="no-gate-basis-note"
            >
              {t("s8TargetSelectionIsPending")}
            </p>
          )}
        </section>
      )}
      <WaccStatusBadge status={saveWarnings.length > 0 ? { status: "confirmed", warnings: saveWarnings } : null} />
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">
          ✕ {error}
        </p>
      )}
      {message && <p className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)]">✓ {message}</p>}

      {/* 현재 확정값 */}
      <section className="market-section sizing-step">
        <h3 className="sizing-step-title">{t("currentConfirmedValue")}</h3>
        {!view ? (
          <p>{tc("loading")}</p>
        ) : (
          <ParamTable
            caption={t("currentlyConfirmedWaccValue")}
            labelHeader={tc("items")}
            rows={[
              {
                label: "WACC",
                value: (
                  <SourceTooltip
                    provenance={{
                      as_of: view.wacc.as_of,
                      source: view.wacc.rationale,
                      anchor_ref: view.wacc.anchor_ref,
                      run_id: view.wacc.run_id,
                      assumption_key: "wacc",
                    }}
                  >
                    {pct(view.wacc.value)}
                  </SourceTooltip>
                ),
                source: <span className="status-chip status-info">{view.wacc.source}</span>,
              },
              { label: t("targetReturn"), value: pct(view.hurdle_irr?.value) },
              {
                label: t("waccApplyingEntity"),
                value:
                  view.subject.subject === "promoter"
                    ? t("investingEntityPromoter")
                    : view.subject.subject === "target"
                      ? t("targetCompanyTarget")
                      : t("newlyEstablishedEntity"),
                source: (
                  <>
                    <span className="status-chip status-info">
                      {view.subject.source === "user" ? t("humanConfirmationFinal") : t("trackDefault")}
                    </span>
                    {view.subject.source === "user" && view.subject.rationale ? (
                      <span className="block">{view.subject.rationale}</span>
                    ) : null}
                  </>
                ),
              },
              ...(view.relevering
                ? [
                    {
                      label: t("releveredBetaReference"),
                      value: view.relevering.beta_levered.toFixed(3),
                      source: `= βu ${view.relevering.beta_unlevered.toFixed(2)} × (1 + (1−t) × D/E ${view.relevering.target_de.toFixed(2)})`,
                    },
                  ]
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
                <span className="status-chip status-info">
                  {sugg.subject?.name_ko ?? t("targetCompany")} {t("baselineAndProposalAPerson")}
                </span>
              </h3>
              <div className="flex flex-wrap gap-5 items-start text-[length:var(--fs-body)]">
                {sugg.suggestions
                  .filter((x): x is Sugg & { value: number } => x.value !== null)
                  .map((x) => (
                    <div key={x.key} className="min-w-0 max-w-full [overflow-wrap:anywhere]">
                      <div className="font-bold tabular-nums text-[1.05rem]">
                        {x.key === "observed_de" ? x.value.toFixed(2) : `${x.value.toFixed(2)}%`}
                      </div>
                      <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                        {x.key === "risk_free"
                          ? t("rfGovernmentBond")
                          : x.key === "credit_spread"
                            ? t("creditSpreadMinusGovernmentBond")
                            : x.key === "erp"
                              ? t("erpPublishedLabel")
                              : x.key === "tax_rate"
                                ? t("taxRatePublishedLabel")
                                : tc("observedDE")}{" "}
                        · {x.as_of}
                      </div>
                      {x.key === "erp" && (
                        <div className="flex flex-wrap items-center gap-1 text-[length:var(--fs-caption)]">
                          {erpChips(x)}
                        </div>
                      )}
                      {x.key === "credit_spread" && (
                        <>
                          <div className="flex flex-wrap items-center gap-1 text-[length:var(--fs-caption)]">
                            {creditChips(x)}
                          </div>
                          {creditAnchorsText(x) && (
                            <div
                              className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] max-w-[22rem]"
                              data-testid="credit-anchors-line"
                            >
                              {creditAnchorsText(x)}
                            </div>
                          )}
                        </>
                      )}
                      {x.note && x.key !== "tax_rate" && x.key !== "credit_spread" ? (
                        <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] max-w-[22rem]">
                          {x.note}
                        </div>
                      ) : null}
                    </div>
                  ))}
              </div>
              {missingItems.length > 0 && (
                <div className="mt-3" data-testid="wacc-reference-missing">
                  <h4 className="font-semibold text-[length:var(--fs-caption)]">{t("referenceMissingTitle")}</h4>
                  <ul className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] list-disc pl-5">
                    {missingItems.map((x) => {
                      const reason =
                        x.key === "erp"
                          ? erpReasonText(x.reason_code, x.reason)
                          : x.key === "tax_rate"
                            ? taxReasonText(x.reason_code, x.reason)
                            : x.key === "credit_spread"
                              ? creditReasonText(x.reason_code, x.reason)
                              : x.reason;
                      return (
                        <li key={x.key}>
                          <span className="font-semibold">{REF_LABEL[x.key] ?? x.key}</span>
                          {reason ? ` — ${reason}` : ""}
                          {x.key === "credit_spread" && creditReasonLinksToCollect(creditSugg) && collectLink("credit")}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {(ecosSuggested || creditSugg) && (
                <section
                  id={COLLECT_BLOCK_ID}
                  className="mt-3"
                  aria-labelledby={`${COLLECT_BLOCK_ID}-title`}
                  data-testid="wacc-collect-block"
                >
                  <h4 id={`${COLLECT_BLOCK_ID}-title`} className="font-semibold text-[length:var(--fs-caption)]">
                    {t("collectBlockTitle")}
                  </h4>
                  <p className="m-0 text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                    {t("collectBlockHint")}
                  </p>
                  <ul className="list-none m-0 p-0 mt-2 grid gap-3 md:grid-cols-2">
                    {ecosSuggested &&
                      collectRow({
                        key: "ecos",
                        name: t("collectEcosName"),
                        fills: t("collectEcosFills"),
                        source: t("collectEcosSource"),
                        status: ecosStatusText(),
                        needed: ecosCollectNeeded(sugg.suggestions),
                        runCollect: ecos,
                        message: ecosMessage,
                        runLabel: t("collectEcosRun"),
                        rerunLabel: t("collectEcosRerun"),
                        runningText: t("collectEcosRunning"),
                      })}
                    {creditSugg &&
                      collectRow({
                        key: "credit",
                        name: t("collectCreditName"),
                        fills: t("collectCreditFills"),
                        source: t("collectCreditSource"),
                        status: creditStatusText(),
                        needed: creditCollectNeeded(creditSugg),
                        runCollect: creditCollect,
                        message: creditCollectMessage,
                        runLabel: t("collectCreditRun"),
                        rerunLabel: t("collectCreditRerun"),
                        runningText: t("collectCreditRunning"),
                        actionTestId: "credit-collect",
                        noAction: !creditCollectAvailable(creditSugg),
                      })}
                  </ul>
                </section>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={applicableCount === 0}
                  onClick={() => {
                    setMode("capm");
                    for (const x of applicable) applyRef(x.key, x);
                  }}
                >
                  {t("applyApplicableCount", { n: applicableCount, total: sugg.suggestions.length })}
                </button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => void loadSugg()}>
                  {t("refresh")}
                </button>
              </div>
              <p className="note-line">{t("referenceValuesAreProposalsAfter")}</p>
            </section>
          )}
          {sugg && sugg.suggestions.length === 0 && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-3">
              {t("noDataToFetchReference")} {(sugg.missing ?? []).join(" · ")}
            </p>
          )}
        </>
      )}

      {canAct && (
        <>
          {/* 모드 탭 */}
          <div className="flex gap-1.5 mt-6" role="tablist" aria-label={t("inputMode")}>
            <button
              role="tab"
              aria-selected={mode === "direct"}
              type="button"
              className={`rounded-t-lg border border-b-0 px-4 py-2 text-[length:var(--fs-body)] font-semibold ${mode === "direct" ? "bg-[color:var(--surface)] text-[color:var(--accent)]" : "bg-[color:var(--muted-bg)] text-[color:var(--muted-fg)]"}`}
              onClick={() => setMode("direct")}
            >
              {t("enterDirectly")}
            </button>
            <button
              role="tab"
              aria-selected={mode === "capm"}
              type="button"
              className={`rounded-t-lg border border-b-0 px-4 py-2 text-[length:var(--fs-body)] font-semibold ${mode === "capm" ? "bg-[color:var(--surface)] text-[color:var(--accent)]" : "bg-[color:var(--muted-bg)] text-[color:var(--muted-fg)]"}`}
              onClick={() => setMode("capm")}
            >
              {t("capmBreakdown")}
            </button>
          </div>

          {mode === "capm" &&
            sugg &&
            (sugg.suggestions.some((x) => x.value !== null) || (sugg.erp_alternatives ?? []).length > 0) && (
              <section className="market-section sizing-step mt-3" aria-label={tc("waccReference")}>
                <h3 className="sizing-step-title">
                  {tc("waccReference")}{" "}
                  <span className="status-chip status-info">
                    {sugg.subject?.name_ko ?? t("targetCompany2")} {t("baselineAndProposalAPerson2")}
                  </span>
                </h3>
                <table className="data-table">
                  <caption className="sr-only">{t("waccReferenceParametersReferenceValues")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("parameters")}</th>
                      <th scope="col" className="num">
                        {t("referenceValue")}
                      </th>
                      <th scope="col">{t("sourceAndDate")}</th>
                      <th scope="col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sugg.suggestions.flatMap((x) => {
                      const isErp = x.key === "erp";
                      const isTax = x.key === "tax_rate";
                      const rowsFor = (r: Sugg, alt: boolean) => (
                        <tr
                          key={alt ? `erp-alt-${r.id ?? r.source_label}` : r.key}
                          data-testid={alt ? "erp-alt-row" : undefined}
                        >
                          <td className={alt ? "pl-6" : undefined}>
                            {alt
                              ? t("erpAlternativeLabel")
                              : r.key === "risk_free"
                                ? t("rateRfGovernmentBond")
                                : r.key === "credit_spread"
                                  ? t("creditRatingSpreadCorporateBond")
                                  : r.key === "erp"
                                    ? t("erpPublishedRowLabel")
                                    : r.key === "tax_rate"
                                      ? t("taxRatePublishedRowLabel")
                                      : t("observedDEDebtEquity")}
                          </td>
                          <td className="num mono-num">
                            {r.value === null
                              ? "N/A"
                              : r.key === "observed_de"
                                ? r.value.toFixed(2)
                                : `${r.value.toFixed(2)}%`}
                          </td>
                          <td className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                            {r.value === null ? (
                              isErp ? (
                                erpReasonText(r.reason_code, r.reason)
                              ) : isTax ? (
                                taxReasonText(r.reason_code, r.reason)
                              ) : (
                                (r.reason ?? "")
                              )
                            ) : isTax ? (
                              <>
                                <div className="flex flex-wrap items-center gap-1">
                                  {taxSourceLink(r)}
                                  {r.basis && (
                                    <span
                                      className={`status-chip ${r.basis === "top_bracket_fallback" ? "status-amber" : "status-info"}`}
                                      data-testid="tax-basis-chip"
                                    >
                                      {TAX_BASIS_LABEL[r.basis] ?? r.basis}
                                    </span>
                                  )}
                                </div>
                                <div data-testid="tax-bracket-text">{taxBracketText(r)}</div>
                                <div>
                                  {t("erpAsOfVerified", {
                                    asOf: r.effective_from ?? r.as_of ?? "",
                                    verifiedOn: r.verified_on ?? "",
                                  })}
                                </div>
                                {taxNoteLines(r).map((line) => (
                                  <div key={line}>{line}</div>
                                ))}
                              </>
                            ) : isErp ? (
                              <>
                                <div className="flex flex-wrap items-center gap-1">
                                  {erpSourceLink(r)}
                                  {erpChips(r)}
                                </div>
                                <div>
                                  {r.basis ? `${ERP_BASIS_LABEL[r.basis] ?? r.basis} · ` : ""}
                                  {t("erpAsOfVerified", { asOf: r.as_of ?? "", verifiedOn: r.verified_on ?? "" })}
                                </div>
                                {r.note ? <div>{r.note}</div> : null}
                              </>
                            ) : r.key === "credit_spread" ? (
                              <div className="min-w-0 [overflow-wrap:anywhere]" data-testid="credit-spread-detail">
                                <div>{`${r.source_label ?? ""} · ${r.as_of ?? ""}`}</div>
                                <div className="flex flex-wrap items-center gap-1">{creditChips(r)}</div>
                                {creditAnchorsText(r) && (
                                  <div data-testid="credit-anchors-line">{creditAnchorsText(r)}</div>
                                )}
                                {creditNoteLines(r).map((line) => (
                                  <div key={line}>{line}</div>
                                ))}
                                {creditReasonLinksToCollect(r) && <div>{collectLink("credit")}</div>}
                                <CreditRatingEvidence suggestion={r} />
                              </div>
                            ) : (
                              `${r.source_label ?? ""} · ${r.as_of ?? ""}`
                            )}
                          </td>
                          <td>
                            {r.value !== null && (
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                aria-label={
                                  isErp
                                    ? t("erpApplyAria", { source: r.source_label ?? "", value: r.value.toFixed(2) })
                                    : isTax
                                      ? t("taxRateApplyAria", { source: taxBracketText(r), value: r.value.toFixed(2) })
                                      : r.key === "credit_spread" && r.rating
                                        ? t("creditApplyAria", {
                                            rating: r.rating,
                                            value: r.value.toFixed(2),
                                            source: CREDIT_SOURCE_LABEL[r.rating_source ?? ""] ?? "",
                                          })
                                        : undefined
                                }
                                onClick={() => applyRef(r.key, r)}
                              >
                                {APPLY_LABEL[r.key]}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                      return isErp
                        ? [rowsFor(x, false), ...(sugg.erp_alternatives ?? []).map((alt) => rowsFor(alt, true))]
                        : [rowsFor(x, false)];
                    })}
                  </tbody>
                </table>
              </section>
            )}
          {mode === "direct" ? (
            <form
              className="sizing-step grid gap-3 mt-0 rounded-tl-none"
              style={{ maxWidth: 460 }}
              onSubmit={submitDirect}
            >
              <h3 className="sizing-step-title">
                {t("enterDirectly2")}
                {selectedTarget ? t("individualTarget") : ""}
              </h3>
              <label className="grid gap-1 text-sm">
                {t("waccRatio")}
                <input
                  className="form-input"
                  value={directWacc}
                  onChange={(e) => setDirectWacc(e.target.value)}
                  placeholder="0.095"
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t("targetReturnOptional")}
                <input
                  className="form-input"
                  value={directHurdle}
                  onChange={(e) => setDirectHurdle(e.target.value)}
                  placeholder="0.15"
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t("evidenceApprovalMemo")}
                <textarea
                  className="form-input"
                  value={directRationale}
                  onChange={(e) => setDirectRationale(e.target.value)}
                  placeholder={t("treasuryCheckIcGuidelinesEtc")}
                />
              </label>
              {selectedTarget ? (
                <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                  {t("theWaccApplyingEntityIs")}
                </p>
              ) : (
                <>
                  <label className="grid gap-1 text-sm">
                    {t("waccApplyingEntityOptionalTrack")}
                    <select
                      className="form-input"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value as typeof subject)}
                    >
                      <option value="">{t("followTheTrackDefault")}</option>
                      <option value="promoter">{t("investingEntityPromoter2")}</option>
                      <option value="target">{t("targetCompanyTargetAcquisitionOr")}</option>
                      <option value="project_newco">{t("newlyEstablishedEntity2")}</option>
                    </select>
                  </label>
                  {subject && (
                    <label className="grid gap-1 text-sm">
                      {t("entityEvidenceRequired")}
                      <textarea
                        className="form-input"
                        value={subjectRationale}
                        onChange={(e) => setSubjectRationale(e.target.value)}
                        placeholder={t("cashFlowRiskAttributedTo")}
                      />
                    </label>
                  )}
                </>
              )}
              <button className="primary-button justify-self-start" type="submit">
                {t("confirmWithThisValue")}
              </button>
              <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                {t("onConfirmationThisValueIs")}
              </p>
            </form>
          ) : (
            <form className="sizing-step mt-0 rounded-tl-none" onSubmit={submitCapm}>
              {/* ① 시장 수치 */}
              <h3 className="sizing-step-title">
                <span className="sizing-step-badge">1</span>
                {t("marketFigures")}{" "}
                <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">
                  {t("citesValuesVerifiedAgainstCredible")}
                </span>
              </h3>
              <div>
                <CitedRow name={t("rateRf2")} sub={t("basedOnGovernmentBonds")} field={rf} onChange={setRf} />
                <CitedRow
                  name={t("equityRiskPremiumErp2")}
                  sub={t("marketRiskPremium")}
                  field={erp}
                  onChange={setErp}
                  forceKind="user"
                />
                <CitedRow
                  name={t("scalePremium2")}
                  sub={t("optionalPremium")}
                  field={sp}
                  onChange={setSp}
                  forceKind="user"
                />
              </div>

              {/* ② 베타 추정 */}
              <h3 className="sizing-step-title mt-6">
                <span className="sizing-step-badge">2</span>
                {t("betaEstimation")}{" "}
                <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">
                  {t("alsoComputesVolatilityVsThe")}
                </span>
              </h3>
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
              <h3 className="sizing-step-title mt-6">
                <span className="sizing-step-badge">3</span>
                {t("costOfDebtKd2")}{" "}
                <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">
                  {t("loanRateBasedOnThe")}
                </span>
              </h3>
              <div className="flex gap-1.5 mb-1">
                <button
                  type="button"
                  onClick={() => setKdMode("rating")}
                  className={`rounded-full border px-3 py-1 text-[length:var(--fs-caption)] ${kdMode === "rating" ? "border-[color:var(--primary-border)] bg-[color:var(--primary-bg)] text-[color:var(--accent)] font-bold" : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-fg)]"}`}
                >
                  {t("creditRatingPlusSpread")}
                </button>
                <button
                  type="button"
                  onClick={() => setKdMode("direct")}
                  className={`rounded-full border px-3 py-1 text-[length:var(--fs-caption)] ${kdMode === "direct" ? "border-[color:var(--primary-border)] bg-[color:var(--primary-bg)] text-[color:var(--accent)] font-bold" : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-fg)]"}`}
                >
                  {t("enterTheActualLoanRate")}
                </button>
              </div>
              {kdMode === "rating" ? (
                <>
                  <CitedRow
                    name={t("creditRatingSpread2")}
                    sub={t("addedToRfIncludeThe")}
                    field={kdSpread}
                    onChange={setKdSpread}
                  />
                  {rfN != null && nOr(kdSpread.value) != null && (
                    <div className="grid gap-2 md:grid-cols-2 mt-2 text-sm">
                      <StatCard k={t("costOfDebtKdRf")}>
                        {pct(rfN)} + {pct(nOr(kdSpread.value))} = <b>{pct(rfN + nOr(kdSpread.value)!)}</b>
                      </StatCard>
                    </div>
                  )}
                </>
              ) : (
                <CitedRow
                  name={t("fundingRateActual")}
                  sub={t("actualLoanRate")}
                  field={kdDirect}
                  onChange={setKdDirect}
                  forceKind="user"
                />
              )}

              {kdKe && (
                <p
                  role="note"
                  className="mt-2 flex min-w-0 flex-wrap items-center gap-1 text-[length:var(--fs-caption)] [overflow-wrap:anywhere]"
                  data-testid="kd-ge-ke-warning"
                >
                  <span className="status-chip status-amber">
                    <span aria-hidden="true">⚠</span> {t("kdGeKeChip")}
                  </span>
                  <span className="min-w-0 text-[color:var(--muted-fg)]">
                    {t(kdKe.indicative ? "kdGeKeDetailIndicative" : "kdGeKeDetail", {
                      kd: pct(kdKe.kd),
                      ke: pct(kdKe.ke),
                    })}
                  </span>
                </p>
              )}

              {/* ④ 자본구조·세율 */}
              <h3 className="sizing-step-title mt-6">
                <span className="sizing-step-badge">4</span>
                {t("capitalStructureAndTaxRate")}{" "}
                <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">
                  {t("basedOnTheTargetCapital")}
                </span>
              </h3>
              <div className="grid md:grid-cols-[9.5rem_7rem_1fr_6.5rem] gap-2 items-end py-2 border-t border-[color:var(--border-subtle)] text-sm">
                <div>
                  <div className="text-[length:var(--fs-body)] font-semibold">{t("targetDE2")}</div>
                  <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("debtEquity")}</div>
                </div>
                <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {tc("value")}
                  <input
                    className="form-input"
                    value={targetDe.value}
                    placeholder="0.60"
                    onChange={(e) => setTargetDe({ ...targetDe, value: e.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {tc("sourceName")}
                  <input
                    className="form-input"
                    value={targetDe.source}
                    placeholder={t("financialPlanTargetLeverageRight")}
                    onChange={(e) => setTargetDe({ ...targetDe, source: e.target.value })}
                  />
                </label>
                <div className="grid gap-1 justify-items-start">
                  <KindChip kind="user" />
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={observedForTarget === null}
                    data-testid="apply-observed-de-as-target"
                    onClick={applyObservedDeAsTarget}
                  >
                    {t("applyObservedDeAsTarget")}
                  </button>
                </div>
              </div>
              <div className="grid md:grid-cols-[9.5rem_7rem_1fr_6.5rem] gap-2 items-end py-2 border-t border-[color:var(--border-subtle)] text-sm">
                <div>
                  <div className="text-[length:var(--fs-body)] font-semibold">{t("marginalTaxRate2")}</div>
                  <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                    {t("corporateTaxPlusLocalTax")}
                  </div>
                </div>
                <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {tc("value")}
                  <input
                    className="form-input"
                    value={taxRate.value}
                    placeholder="0.22"
                    onChange={(e) => setTaxRate({ ...taxRate, value: e.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {tc("sourceName")}
                  <input
                    className="form-input"
                    value={taxRate.source}
                    placeholder={t("standardCorporateTaxRate")}
                    onChange={(e) => setTaxRate({ ...taxRate, source: e.target.value })}
                  />
                </label>
                <div>
                  <KindChip kind="user" />
                </div>
              </div>
              {derivation?.computed.we != null && derivation?.computed.wd != null && (
                <div className="grid gap-2 md:grid-cols-2 mt-2 text-sm">
                  <StatCard k={t("equityWeightWe11")}>{pct(derivation.computed.we)}</StatCard>
                  <StatCard k={t("debtWeightWdDE")}>{pct(derivation.computed.wd)}</StatCard>
                </div>
              )}

              {/* 산식 분해 */}
              <h3 className="sizing-step-title mt-6">
                {t("breakdown")}{" "}
                <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">
                  {t("seeAtAGlanceHow")}
                </span>
              </h3>
              {derivation && derivation.steps.length > 0 ? (
                <>
                  {derivation.missing.length > 0 && (
                    <p className="text-[color:var(--amber-fg)] text-[length:var(--fs-caption)] mb-2">
                      {t("notEntered")} {derivation.missing.join(" · ")}
                    </p>
                  )}
                  <DerivationTable derivation={derivation} />
                  {keSteps.length > 0 && (
                    <div className="grid gap-4 lg:grid-cols-2 mt-4">
                      <div className="border border-[color:var(--border-subtle)] rounded-lg p-3">
                        <h4 className="text-[length:var(--fs-caption)] font-semibold text-[color:var(--muted-fg)] mb-1">
                          {t("costOfEquityCapm")}
                        </h4>
                        <RoicWaterfallChart steps={keSteps} numberFormat="percent" />
                      </div>
                      {waccSteps.length > 0 && (
                        <div className="border border-[color:var(--border-subtle)] rounded-lg p-3">
                          <h4 className="text-[length:var(--fs-caption)] font-semibold text-[color:var(--muted-fg)] mb-1">
                            {t("waccWeightedBlend")}
                          </h4>
                          <RoicWaterfallChart steps={waccSteps} numberFormat="percent" />
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                  {t("enterMarketFigures1Beta")}
                </p>
              )}

              {/* 기록될 컴포넌트·출처 */}
              {components.length > 0 && (
                <>
                  <h3 className="sizing-step-title mt-6">
                    {t("componentsAndSourcesToRecord")}{" "}
                    <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">
                      {t("inTheAssumptionRegistry")} <span className="font-mono">wacc.*</span>{" "}
                      {t("savedTogetherAsKeys")}
                    </span>
                  </h3>
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
                              <div className="text-[length:var(--fs-caption)]">
                                {COMPONENT_LABELS(tr)[c.key] ?? c.key}
                              </div>
                              <div className="font-mono text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                {c.key}
                              </div>
                            </td>
                            <td className="py-1.5 px-1.5 text-right tabular-nums font-semibold">
                              {formatComponentValue(c.key, c.value)}
                            </td>
                            <td className="py-1.5 px-1.5">
                              <KindChip kind={c.kind} />
                            </td>
                            <td className="py-1.5 px-1.5 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                              {c.sourceLabel ?? c.rationale ?? "—"}
                              {c.anchorRef && (
                                <>
                                  {" "}
                                  <a
                                    href={c.anchorRef}
                                    className="text-[color:var(--accent)]"
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {tc("linkLabel")}
                                  </a>
                                </>
                              )}
                            </td>
                            <td className="py-1.5 px-1.5 text-[length:var(--fs-caption)]">{c.asOf ?? "—"}</td>
                          </tr>
                        ))}
                        <tr className="border-b border-[color:var(--border-subtle)] bg-[color:var(--primary-bg)] font-bold">
                          <td className="py-1.5 px-1.5 font-mono text-[0.8em]">{t("waccFinalConfirmation")}</td>
                          <td className="py-1.5 px-1.5 text-right tabular-nums">{pct(nOr(waccFinal))}</td>
                          <td className="py-1.5 px-1.5">
                            <KindChip kind="user" />
                          </td>
                          <td className="py-1.5 px-1.5 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                            {t("aPersonSFinalConfirmed")}
                          </td>
                          <td className="py-1.5 px-1.5 text-[length:var(--fs-caption)]">—</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* 확정 저장 */}
              <h3 className="sizing-step-title mt-6">
                {t("saveConfirmation")}{" "}
                <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">
                  {t("aPersonVerifiesAndConfirms")}
                </span>
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  {t("waccRatioWithTheCapm")}
                  <input
                    className="form-input"
                    value={waccFinal}
                    placeholder={computedWacc != null ? computedWacc.toFixed(4) : "0.095"}
                    onChange={(e) => {
                      setWaccFinal(e.target.value);
                      setWaccTouched(true);
                    }}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  {t("targetReturnOptional2")}
                  <input
                    className="form-input"
                    value={hurdle}
                    placeholder="0.15"
                    onChange={(e) => setHurdle(e.target.value)}
                  />
                </label>
              </div>
              <label className="grid gap-1 text-sm mt-1">
                {t("evidenceApprovalMemo2")}
                <textarea
                  className="form-input"
                  rows={2}
                  value={rationale}
                  placeholder={t("eGEcos910")}
                  onChange={(e) => setRationale(e.target.value)}
                />
              </label>
              {computedWacc != null &&
                nOr(waccFinal) != null &&
                (mismatch ? (
                  <p
                    role="status"
                    className="text-[color:var(--amber-fg)] bg-[color:var(--warning-bg)] rounded-md px-3 py-2 text-[length:var(--fs-caption)] mt-2"
                  >
                    {t("computedValue")} {pct(computedWacc)} {t("confirmedValue")} {pct(nOr(waccFinal))}{" "}
                    {t("varianceEvidenceMustBeNoted")}
                  </p>
                ) : (
                  <p
                    role="status"
                    className="text-[color:var(--green-fg)] bg-[color:var(--success-bg)] rounded-md px-3 py-2 text-[length:var(--fs-caption)] mt-2"
                  >
                    {t("confirmedValue2")} {pct(nOr(waccFinal))} {t("matchesTheCapmValue")}
                  </p>
                ))}
              <button className="primary-button justify-self-start mt-2" type="submit">
                {t("confirmWithThisValue2")}
              </button>
              <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                {t("ifTheConfirmedValueDiffers")}
              </p>
            </form>
          )}
        </>
      )}
      {/* 저장된 CAPM 세션 — 계산 과정은 저장 후에도 레지스트리에서 재현된다 (ADR-0115) */}
      {view && view.derivation && view.components.length > 0 && (
        <section className="market-section sizing-step">
          <h3 className="sizing-step-title">
            {t("savedSessionFormulaBreakdown")}
            <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">
              {t("recomputedFromTheWaccRows")}
            </span>
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
                      <div className="font-mono text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                        {c.key}
                      </div>
                    </td>
                    <td className="py-1.5 px-1.5 text-right tabular-nums font-semibold">
                      <SourceTooltip
                        provenance={{
                          assumption_key: c.key,
                          as_of: c.as_of,
                          source: c.rationale,
                          anchor_ref: c.anchor_ref,
                          run_id: c.run_id,
                        }}
                      >
                        {formatComponentValue(c.key, c.value)}
                      </SourceTooltip>
                    </td>
                    <td className="py-1.5 px-1.5">
                      <KindChip kind={c.kind as "live" | "user" | "derived"} />
                    </td>
                    <td className="py-1.5 px-1.5 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                      {c.rationale ?? "—"}
                      {c.anchor_ref && (
                        <>
                          {" "}
                          <a
                            href={c.anchor_ref}
                            className="text-[color:var(--accent)]"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {tc("linkLabel")}
                          </a>
                        </>
                      )}
                    </td>
                    <td className="py-1.5 px-1.5 text-[length:var(--fs-caption)]">{c.as_of}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
