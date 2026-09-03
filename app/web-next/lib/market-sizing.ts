// Market-sizing matrix schema + the frozen hydraulic-breaker dataset.
//
// `SizingMatrix` is THE contract between the systematic-market-sizing
// pipeline (which generates a matrix for a new industry via LLM + persisted
// data) and the /market report UI (which renders any matrix with the same
// rich charts). The hydraulic-breaker analysis is final/frozen (see
// docs/research/hydraulic-breaker-market-2026-driver-analysis.md §4) and is
// embedded here as HYD_BRK_MATRIX — post-Epiroc-calibration values
// (source #22: global construction −2pp / mining +2pp; NA construction −8pp
// / other +8pp).

export const SIZING_SOURCE_DOC = "docs/research/hydraulic-breaker-market-2026-driver-analysis.md";

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

/* ── Frozen hydraulic-breaker matrix (analysis of record, 2026-08) ── */

const HYD_REGIONS: MatrixRegion[] = [
  { code: "china", label: "중국", weight: 26, mix: { construction: 46, mining: 36, other: 18 }, adjustment: "글로벌 조정: 건설 −2%p / 광산 +2%p (Epiroc FY2025)" },
  { code: "apac_ex_china", label: "아시아(중국 제외)", weight: 14, mix: { construction: 29, mining: 57, other: 14 }, adjustment: "글로벌 조정 + 호주 광산 가중" },
  { code: "north_america", label: "북미", weight: 18, mix: { construction: 28, mining: 42, other: 30 }, adjustment: "건설 −8%p / 기타 +8%p (Stanley Infrastructure 인수)" },
  { code: "europe", label: "유럽", weight: 24, mix: { construction: 35, mining: 15, other: 50 }, adjustment: "글로벌 조정 + EU Stage V 규제 프리미엄(기타)" },
  { code: "mea", label: "중동·아프리카", weight: 8, mix: { construction: 45, mining: 42, other: 13 }, adjustment: "가중치 10%→8% 하향(권역 비중 4.9% 확인)" },
  { code: "latam_row", label: "중남미/기타", weight: 9, mix: { construction: 23, mining: 67, other: 10 }, adjustment: "최고 광산 집중(칠레/페루 구리)" },
];

export const HYD_BRK_MATRIX: SizingMatrix = {
  industryLabel: "유압브레이커",
  provenance: "frozen-research",
  anchor: {
    sources: [
      { label: "소스 #1 (밴더 리포트 A)", estimate: 2.18, status: "consensus", note: "컨센서스 밴드 상단" },
      { label: "소스 #2 (밴더 리포트 B)", estimate: 2.0, status: "consensus", note: "컨센서스 밴드 하단 — 앵커로 채택" },
      { label: "소스 #3 (외삽 추정치)", estimate: 3.83, status: "excluded", note: "이상치 — 앵커에서 제외" },
    ],
    total: 2.0,
  },
  regions: HYD_REGIONS,
  baseline2026: {
    china: { construction: 0.239, mining: 0.187, other: 0.094 },
    apac_ex_china: { construction: 0.081, mining: 0.16, other: 0.039 },
    north_america: { construction: 0.101, mining: 0.151, other: 0.108 },
    europe: { construction: 0.168, mining: 0.072, other: 0.24 },
    mea: { construction: 0.072, mining: 0.067, other: 0.021 },
    latam_row: { construction: 0.041, mining: 0.121, other: 0.018 },
  },
  cagrBase: {
    china: { construction: 0.06, mining: 0.05, other: 0.05 },
    apac_ex_china: { construction: 0.07, mining: 0.09, other: 0.06 },
    north_america: { construction: 0.05, mining: 0.06, other: 0.05 },
    europe: { construction: 0.05, mining: 0.04, other: 0.06 },
    mea: { construction: 0.07, mining: 0.06, other: 0.05 },
    latam_row: { construction: 0.04, mining: 0.08, other: 0.04 },
  },
  bandOverrides: {
    "north_america|mining": { down: 0.02, up: 0.11, reason: "문서화된 소스 불일치 — 권역 최대 수요 세그먼트에 대한 소스 클래스 상충" },
  },
  chainGrade: {
    grade: "B",
    statisticalHops: 3,
    note: "프록시 체인 통계 hop 3개 — 스킬(proxy-industry-chain) 규정상 상한 B. 이 매트릭스의 어떤 결론도 Green 확신도로 표현될 수 없음.",
  },
  chainDirection: {
    position: "midstream",
    note: "유압브레이커는 건설·광산 장비의 어태치먼트(중류) — 수요 구조가 지배적이므로 전방(장비 제조·보유)과 전전방(인프라·광산 개발 수요)을 분석한다.",
    relatedIndustries: [
      { relation: "전방", name: "건설·광산 장비 제조 (Epiroc, Sandvik, HD Hyundai 등)", note: "어태치먼트 수요의 직접 수요처" },
      { relation: "전방", name: "장비 임대·렌탈업", note: "기계장착형 수요의 실질 보유 주체" },
      { relation: "전전방", name: "인프라 건설·광산 개발", note: "최종 수요 발생지 — 구리·금 광산 캐펙스가 핵심 드라이버" },
    ],
  },
  competitive: {
    structure:
      "과점형 니치 어태치먼트 시장 — CR4(Epiroc·Sandvik·Caterpillar·Atlas Copco) 합산 점유율 약 15~20% (source #21). 장비 제조사 자사 브랜드 번들과 독립 어태치먼트 브랜드가 공존하며, 광산(대형)은 글로벌 브랜드·건설(중소)은 지역 브랜드로 이원화.",
    players: [
      {
        name: "Epiroc (Stanley·AT)",
        tier: "leader",
        note: "어태치먼트 카테고리 리더 — FY2025 매출 SEK 62.0bn, Stanley Infrastructure 인수(2024)로 북미 특수 어태치먼트 확대 (source #22, 1차 공시)",
      },
      {
        name: "Sandvik / Rammer",
        tier: "leader",
        note: "광산·채석장 세그먼트 강자 — 파트·서비스 매출 비중이 높은 프리미엄 포지션",
      },
      {
        name: "Caterpillar",
        tier: "challenger",
        note: "자사 굴착장비(H 라인) 번들 중심 — CR4 구성원 (source #21)",
      },
      {
        name: "Atlas Copco 계열",
        tier: "challenger",
        note: "CR4 구성원 (source #21)",
      },
      {
        name: "Komatsu / Montabert",
        tier: "challenger",
        note: "자사 굴착장비 번들 — Montabert 브랜드 (문서 §6 top-10 목록)",
      },
      {
        name: "HD Hyundai / Develon (현대중공업그룹)",
        tier: "niche",
        note: "한국·아시아권 자사 장비 번들 중심 (문서 §6 top-10 목록)",
      },
    ],
  },
  qualitative: {
    opportunityFactors: [
      "광산 캐펙스 회복(구리·금) — 기계장착형 브레이커 수요 직결",
      "EU Stage V 등 배출 규제 — 구형 장비 교체 수요 촉발",
      "장비 임대 시장 성장 — 중고 시장 보유효율 개선에 따른 신규 수요",
    ],
    riskFactors: [
      "중국 인프라 경기 둔화 — 물량 최대 권역의 수요 급변 위험",
      "장비 제조사 자체 어태치먼트 사업 확대(수직계열화) — 독립 부품 수요 잠식",
      "중고 브레이커 유통 확대 — 신규 판매 대체",
    ],
    sources: [{ title: "Epiroc Annual and Sustainability Report 2025", url: "https://www.epirocgroup.com/", snippet: "1차 공시 — 광산 강세/인프라 약세 확인" }],
  },
  consistency: {
    bottomUpCagr: 5.7,
    topDownCagr: 6.3,
    tolerance: "허용 오차 내 — 내부 정합성 확인으로만 사용. 양쪽 모두 같은 부류(밴더 리포트)로 소급되므로 독립적 확인이 아님.",
  },
  crossValidation: [
    { claim: "광산(D3)이 2025년 건설(D1)보다 높은 성장", status: "confirmed", evidence: "Epiroc FY2025: \"mining customers remained strong, driven by copper and gold… infrastructure customers remained at a low level, mainly explained by a weak market for attachments\"" },
    { claim: "중국·서유럽·북미가 상위 가중 권역", status: "directional", evidence: "Epiroc 최대 시장 = 미국·서유럽·중국·인도 (상대 서열·비중은 미확인)" },
    { claim: "MEA·중남미는 마이너 권역", status: "confirmed", evidence: "Epiroc '최대 시장' 목록에서 부재" },
    { claim: "북미 '기타'(특수철거 어태치먼트) 실재·성장 포켓", status: "confirmed", evidence: "Stanley Infrastructure 인수(2024, ~SEK 4.7bn) — 미국 특수 어태치먼트 확장 목적" },
    { claim: "지역×세그먼트 교차 매출 정밀 검증", status: "impossible", evidence: "구조적 공시 한계 — 카테고리가 상위 보고 단위에 묻힘. Off-Highway Research·KHL Yellow Table 등 유료 소스로만 해소 가능" },
  ],
  limitations: [
    "권역 가중치는 더 넓은 건설장비 시장의 프록시 — 브레이커 특화 권역 매출 분할은 공개 소스에 없음.",
    "권역별 세그먼트 믹스는 글로벌 교차검증치에 맞춘 정성적 배분 — 소스 기반 바텀업 합산이 아님.",
    "북미 광산 밴드(2–11% CAGR)는 모델링 불확실성이 아닌 실제 소스 불일치 — 유료 데이터 확보 시 첫 번째 해소 대상.",
    "유럽 규제 프리미엄(EU Stage V)은 특정 규제 일정에 연동되지 않은 판단적 보정.",
    "중국 2025–2026 반등(굴삭기 판매 +17~27% YoY)은 저기저 반등 — 기본 CAGR(6%)는 정규화를 가정, 현 반등율 선형 외삽 금지.",
    "체인 등급 B 상한(통계 hop 3개) — 본 매트릭스 기반 결론은 Green 확신도로 표현 불가.",
  ],
};

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
