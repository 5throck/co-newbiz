// Market-sizing matrix schema.
//
// `SizingMatrix` is THE contract between the systematic-market-sizing
// pipeline (which generates a matrix for a new industry via LLM + persisted
// data) and the /market report UI (which renders any matrix with the same
// rich charts). The historical hydraulic-breaker research matrix is not a
// code constant — it is persisted as a regular analysis version
// (scripts/co-newbiz/backfill-hyd-brk-report.ts, ADR-0112).

export const SEGMENTS = [
  { code: "construction", label: "건설" },
  { code: "mining", label: "광산" },
  { code: "other", label: "기타(철거·리노베이션)" },
] as const;
export type SegmentCode = (typeof SEGMENTS)[number]["code"];

export interface AnchorSource {
  label: string;
  estimate: number;
  status: "consensus" | "excluded";
  note: string;
  /** 추정 방법론 (선택) — 톱다운/바텀업/프록시 등, 있으면 앵커 신뢰도 판단에 사용 */
  methodology?: string;
  /** 소스 원문 URL (선택) */
  sourceUrl?: string;
  /** 소스 기준 시점 (선택, ISO 날짜) */
  asOf?: string;
}

/** 수요 파이프라인 항목 — 향후 착공/발주가 예정된 개별 프로젝트 (S1 근거 강화용, 선택). */
export interface DemandPipelineEntry {
  /** 1(확정) ~ 4(초기 검토) 등 신뢰도 티어 */
  tier: 1 | 2 | 3 | 4;
  project: string;
  status: string;
  /** 상업운전(가동) 목표 시점 (선택) */
  codTarget?: string;
  sourceUrl?: string;
}

/** 규제 환경 비교 항목 — 국가/관할권별 규제 상태 (선택). */
export interface RegulatoryComparisonEntry {
  jurisdiction: string;
  item: string;
  status: string;
  /** 1차 소스로 직접 확인했는지 여부 — false면 추정/간접 확인 */
  confirmedDirectly: boolean;
  sourceUrl?: string;
  asOf?: string;
}

/** 섹션별 신뢰도 등급 (선택) — 리포트 섹션 단위로 근거 품질을 표기한다. */
export interface SectionConfidenceEntry {
  section: string;
  grade: "A" | "B" | "B-" | "C" | "C-" | "D";
  note?: string;
}

/** Kill criteria 제안 — 분석가가 검토할 조기 중단/보류 기준 후보 (선택). */
export interface KillCriteriaProposal {
  name: string;
  thresholdText: string;
  rationale: string;
  severity: "low" | "medium" | "high";
}

/** 검증 원장 항목 — 개별 주장에 대한 확인/미확인/판단필요 상태 (선택). */
export interface VerificationEntry {
  claim: string;
  status: "confirmed" | "could_not_verify" | "needs_judgement";
  note?: string;
}
export interface MatrixRegion {
  code: string;
  label: string;
  weight: number; // regional weight, %
  mix: Record<string, number>; // segment mix, % (keyed by matrix segment code)
  adjustment: string;
}
export interface CrossValidationClaim {
  claim: string;
  status: "confirmed" | "directional" | "impossible";
  evidence: string;
}
export interface ChainGrade { grade: string; statisticalHops: number; note: string }

/**
 * 산업 사슬 방향 분석 — 산업이 가치사슬에서 어디에 위치하는지에 따라 분석
 * 방향이 갈린다. Downstream(완제품·수요처 쪽) 산업은 전방/전전방(수요처의
 * 수요처)을, Upstream(원자재·부품 쪽) 산업은 후방/후후방(공급처의 공급처)을
 * 분석해야 수요·공급 구조가 온전히 파악된다.
 */
export interface ChainDirection {
  position: "upstream" | "midstream" | "downstream";
  note: string;
  /** 분석 대상 인접 산업 (relation은 산업 위치에 따라 전방계 또는 후방계) */
  relatedIndustries: Array<{ relation: string; name: string; note?: string }>;
}
/**
 * 경쟁 구조 (S1 competitive-intelligence activity 산출) — 시장 집중도와
 * 주요 플레이어. LLM 추정이며 공시 대조 전 상태임을 note에 명시한다.
 */
export interface CompetitiveStructure {
  /** 시장 구조 요약 (독점/과점/독과점/경쟁 정도, 집중도 정성 코멘트) */
  structure: string;
  players: Array<{
    name: string;
    tier: "leader" | "challenger" | "niche";
    note: string;
    /** 기술 유형 (선택, 예: PWR/BWR/SMR 등 산업별 기술 분류) */
    techType?: string;
    /** 설비용량 MWe (선택) */
    capacityMWe?: number;
    /** 프로젝트/사업 진행 상태 (선택) */
    projectStatus?: string;
    /** 근거 참조 (선택) */
    evidenceRef?: string;
    /** 산업별 특성 속성 (동적 컬럼 — 예: 공정 노드, 상용화 단계, 주력 시장. ADR-0092 확장) */
    attributes?: Array<{ label: string; value: string }>;
  }>;
}

export interface QualitativeFactors {
  /** 정성 분석 — 기회 요인 (수요 촉발, 규제, 기술 전환 등) */
  opportunityFactors: string[];
  /** 정성 분석 — 위험 요인 (공급 제약, 대체재, 가격 변동성, 지정학 등) */
  riskFactors: string[];
  /** 입수 출처 (글로벌 기관·증권사·통계·뉴스) — 출처 명기 필수 */
  sources?: Array<{ title: string; url: string; snippet?: string }>;
}

/**
 * 외부 미래 전망 대비 격차 분석 (step 5-B). 과거 데이터 기반 CAGR 외삽과
 * 입수된 외부 미래 추정치가 갈리는 경우, 어떤 요인(신규·강화 드라이버)이
 * 그 격차를 만드는지 기록한다. 외부 전망이 없으면 undefined — 기존 CAGR
 * 외삽 방식을 그대로 사용한다.
 */
export interface ExternalForecastGap {
  sourceLabel: string;
  targetYear: number;
  marketSize: number; // $B, external estimate at targetYear
  cagr?: number; // external implied/stated CAGR (fraction)
  note: string;
  /** Our base-scenario projection at targetYear, $B (computed, not asked). */
  ourMarketSize?: number;
  /** (external / ours - 1) × 100 at targetYear. */
  gapPct?: number;
  /** LLM analysis: which drivers explain the gap (incl. new drivers). */
  gapAnalysis?: string;
  newDrivers?: string[];
}

export interface SizingMatrix {
  industryLabel: string;
  provenance: "frozen-research" | "llm-estimate";
  anchor: { sources: AnchorSource[]; total: number };
  regions: MatrixRegion[];
  baseline2026: Record<string, Record<string, number>>; // $B
  cagrBase: Record<string, Record<string, number>>; // fraction
  /** Documented wider-band overrides, key = "region|segment" (down/up CAGR fractions). */
  bandOverrides?: Record<string, { down: number; up: number; reason?: string }>;
  chainGrade: ChainGrade;
  chainDirection: ChainDirection;
  qualitative: QualitativeFactors;
  consistency: { bottomUpCagr: number; topDownCagr: number; tolerance: string };
  externalForecast?: ExternalForecastGap;
  crossValidation: CrossValidationClaim[];
  limitations: string[];
  /** 경쟁 구조 — 1단계에서 산업별로 도출 (구형 매트릭스에는 없음) */
  competitive?: CompetitiveStructure;
  /** 최종수요 세그먼트 정의 — 산업별로 달라질 수 있다. 없으면 기본 SEGMENTS(琦설/광산/기타) 사용. */
  segments?: Array<{ code: string; label: string }>;
  /** 수요 파이프라인 — 향후 예정 프로젝트 목록 (선택, S1 근거 강화용). */
  demandPipeline?: DemandPipelineEntry[];
  /** 규제 환경 비교 — 관할권×항목 (선택). */
  regulatoryComparison?: RegulatoryComparisonEntry[];
  /** 섹션별 신뢰도 등급 (선택). */
  sectionConfidence?: SectionConfidenceEntry[];
  /** Kill criteria 제안 목록 (선택, 분석가 검토용). */
  killCriteriaProposals?: KillCriteriaProposal[];
  /** 검증 원장 — 주장별 확인 상태 (선택). */
  verificationLedger?: VerificationEntry[];
  /** RAG 상한 권고 (선택) — 데이터 신뢰도가 캡핑하는 등급과 근거. */
  ragCapRecommendation?: { grade: "green" | "amber" | "red"; rationale: string };
}

// ── helpers shared by UI + pipeline ──

export function bandFor(m: SizingMatrix, code: string, segment: string): { down: number; base: number; up: number } {
  const base = m.cagrBase[code]?.[segment] ?? 0.05;
  const o = m.bandOverrides?.[`${code}|${segment}`];
  if (o) return { down: o.down, base, up: o.up };
  return { down: base * 0.5, base, up: base * 1.55 };
}

/** 매트릭스의 세그먼트 정의 — 산업 축을 따라 달라질 수 있다. */
export function segmentsOf(m: Pick<SizingMatrix, "segments">): ReadonlyArray<{ code: string; label: string }> {
  return m.segments ?? SEGMENTS;
}

/** Region total in year `yearIndex` (0 = baseline 2026), compounding per-cell CAGRs. */
export function regionTotal(m: SizingMatrix, code: string, yearIndex: number, scenario: "down" | "base" | "up" = "base"): number {
  return segmentsOf(m).reduce((sum, seg) => {
    const cagr = bandFor(m, code, seg.code)[scenario];
    return sum + (m.baseline2026[code]?.[seg.code] ?? 0) * Math.pow(1 + cagr, yearIndex);
  }, 0);
}

export function global2026(m: SizingMatrix): Record<string, number> {
  const t: Record<string, number> = { total: 0 };
  for (const seg of segmentsOf(m)) t[seg.code] = 0;
  for (const r of m.regions) {
    for (const seg of segmentsOf(m)) {
      const v = m.baseline2026[r.code]?.[seg.code] ?? 0;
      t[seg.code] += v;
      t.total += v;
    }
  }
  return t;
}

/** 2030 base-scenario projection per region (4-year compound). */
export function projection2030(m: SizingMatrix): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const r of m.regions) {
    out[r.code] = {};
    for (const seg of segmentsOf(m)) {
      out[r.code][seg.code] = (m.baseline2026[r.code]?.[seg.code] ?? 0) * Math.pow(1 + (m.cagrBase[r.code]?.[seg.code] ?? 0), 4);
    }
  }
  return out;
}

export const VALIDATION_STATUS_META: Record<string, { label: string; chip: string }> = {
  confirmed: { label: "확인", chip: "status-green" },
  directional: { label: "방향성 일치", chip: "status-in-progress" },
  impossible: { label: "검증 불가", chip: "status-red" },
};

export const STEPS = [
  { id: "step-1", title: "축·프록시 구조 정의", short: "축 정의" },
  { id: "step-2", title: "기준 시장규모 산정 (다중 소스 교차)", short: "기준 규모" },
  { id: "step-3", title: "권역·세그먼트 배분", short: "배분" },
  { id: "step-4", title: "셀별 CAGR·시나리오 밴드", short: "CAGR·밴드" },
  { id: "step-5", title: "성장률 정합성 확인 (바텀업 vs 탑다운)", short: "정합성" },
  { id: "step-6", title: "기업 공시 교차검증", short: "공시 검증" },
  { id: "step-7", title: "분석 한계 목록", short: "한계" },
  { id: "step-8", title: "가정 레지스트리 등록", short: "등록" },
];


/* ── Step-2 anchor notes for the frozen analysis (rendered as a list) ── */
export const REGISTRY = {
  runLabel: "hydraulic-breaker-matrix-seed",
  keyPrefix: "hb.",
  expectedRows: { baseline: 18, cagr: 54, total: 72 },
  ttlDays: 365,
  referenceImplementation: "scripts/co-newbiz/register-hydraulic-breaker-assumptions.ts",
};

export const AXES = [
  { axis: "권역 (Region)", values: "중국 / APAC-exCN / 북미 / 유럽 / MEA / 중남미·기타 (6개)" },
  { axis: "최종수요 세그먼트", values: "건설 / 광산 / 기타·철거·리노베이션 (3개)" },
  { axis: "시나리오", values: "비관 / 기본 / 낙관 (3개, CAGR 밴드)" },
];
