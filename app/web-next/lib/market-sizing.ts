// Frozen market-sizing dataset for the hydraulic-breaker analysis, mirroring
// docs/research/hydraulic-breaker-market-2026-driver-analysis.md §1–§7 (the
// analysis is final/frozen — see its §4 header note). The /market page's
// 8-step sizing report renders from this file; registered rows (step 8) come
// live from the assumption registry via the industry detail API.
// Figures are the post-Epiroc-calibration values (source #22: global
// construction −2pp / mining +2pp; NA construction −8pp / other +8pp).

export const SIZING_SOURCE_DOC = "docs/research/hydraulic-breaker-market-2026-driver-analysis.md";

export interface RegionRow {
  code: string;
  label: string;
  weight: number; // regional weight, %
  mix: { construction: number; mining: number; other: number }; // segment mix, %
  adjustment: string;
}

export const REGIONS: RegionRow[] = [
  { code: "china", label: "중국", weight: 26, mix: { construction: 46, mining: 36, other: 18 }, adjustment: "글로벌 조정: 건설 −2%p / 광산 +2%p (Epiroc FY2025)" },
  { code: "apac_ex_china", label: "아시아(중국 제외)", weight: 14, mix: { construction: 29, mining: 57, other: 14 }, adjustment: "글로벌 조정 + 호주 광산 가중" },
  { code: "north_america", label: "북미", weight: 18, mix: { construction: 28, mining: 42, other: 30 }, adjustment: "건설 −8%p / 기타 +8%p (Stanley Infrastructure 인수)" },
  { code: "europe", label: "유럽", weight: 24, mix: { construction: 35, mining: 15, other: 50 }, adjustment: "글로벌 조정 + EU Stage V 규제 프리미엄(기타)" },
  { code: "mea", label: "중동·아프리카", weight: 8, mix: { construction: 45, mining: 42, other: 13 }, adjustment: "가중치 10%→8% 하향(권역 비중 4.9% 확인)" },
  { code: "latam_row", label: "중남미/기타", weight: 9, mix: { construction: 23, mining: 67, other: 10 }, adjustment: "최고 광산 집중(칠레/페루 구리)" },
];

export const SEGMENTS = [
  { code: "construction", label: "건설" },
  { code: "mining", label: "광산" },
  { code: "other", label: "기타(철거·리노베이션)" },
] as const;
export type SegmentCode = (typeof SEGMENTS)[number]["code"];

// §4.2 2026 baseline, $B. Anchor total $2.00B (rounded consensus).
export const BASELINE_2026: Record<string, Record<SegmentCode, number>> = {
  china: { construction: 0.239, mining: 0.187, other: 0.094 },
  apac_ex_china: { construction: 0.081, mining: 0.16, other: 0.039 },
  north_america: { construction: 0.101, mining: 0.151, other: 0.108 },
  europe: { construction: 0.168, mining: 0.072, other: 0.24 },
  mea: { construction: 0.072, mining: 0.067, other: 0.021 },
  latam_row: { construction: 0.041, mining: 0.121, other: 0.018 },
};
export const GLOBAL_2026 = { construction: 0.702, mining: 0.758, other: 0.52, total: 1.98, anchor: 2.0 };

// §4.4 2030 projection, base scenario, $B.
export const PROJECTION_2030: Record<string, Record<SegmentCode, number>> = {
  china: { construction: 0.302, mining: 0.227, other: 0.114 },
  apac_ex_china: { construction: 0.106, mining: 0.226, other: 0.049 },
  north_america: { construction: 0.123, mining: 0.191, other: 0.131 },
  europe: { construction: 0.204, mining: 0.084, other: 0.303 },
  mea: { construction: 0.094, mining: 0.085, other: 0.026 },
  latam_row: { construction: 0.048, mining: 0.165, other: 0.021 },
};
export const GLOBAL_2030 = { construction: 0.877, mining: 0.977, other: 0.644, total: 2.499 };

// §4.3 base CAGR per region×segment (fraction).
export const CAGR_BASE: Record<string, Record<SegmentCode, number>> = {
  china: { construction: 0.06, mining: 0.05, other: 0.05 },
  apac_ex_china: { construction: 0.07, mining: 0.09, other: 0.06 },
  north_america: { construction: 0.05, mining: 0.06, other: 0.05 },
  europe: { construction: 0.05, mining: 0.04, other: 0.06 },
  mea: { construction: 0.07, mining: 0.06, other: 0.05 },
  latam_row: { construction: 0.04, mining: 0.08, other: 0.04 },
};

// §4.5 band shape: down = base×0.5, up = base×1.55 — except North America
// mining, the documented 2–11% override (source classes disagree on the
// region's largest end-use segment).
export function band(code: string, segment: SegmentCode): { down: number; base: number; up: number } {
  const base = CAGR_BASE[code][segment];
  if (code === "north_america" && segment === "mining") return { down: 0.02, base, up: 0.11 };
  return { down: base * 0.5, base, up: base * 1.55 };
}

// §4.5 global scenario roll-up.
export const SCENARIO_ROLLUP = [
  { scenario: "비관", cagr: 2.8, total2030: 2.23 },
  { scenario: "기본", cagr: 5.8, total2030: 2.52 },
  { scenario: "낙관", cagr: 8.8, total2030: 2.79 },
];

// Step 2 — anchor triangulation (§4.2). The $3.83B outlier is excluded.
export const ANCHOR_SOURCES = [
  { label: "소스 #1 (밴더 리포트 A)", estimate: 2.18, status: "consensus" as const, note: "컨센서스 밴드 상단" },
  { label: "소스 #2 (밴더 리포트 B)", estimate: 2.0, status: "consensus" as const, note: "컨센서스 밴드 하단 — 앵커로 채택" },
  { label: "소스 #3 (외삽 추정치)", estimate: 3.83, status: "excluded" as const, note: "이상치 — 앵커에서 제외" },
];
export const ANCHOR_TOTAL = 2.0;

// Step 1 — axes and proxy structure.
export const AXES = [
  { axis: "권역 (Region)", values: "중국 / APAC-exCN / 북미 / 유럽 / MEA / 중남미·기타 (6개)" },
  { axis: "최종수요 세그먼트", values: "건설 / 광산 / 기타·철거·리노베이션 (3개)" },
  { axis: "시나리오", values: "비관 / 기본 / 낙관 (3개, CAGR 밴드)" },
];

export const CHAIN_GRADE = {
  grade: "B",
  statisticalHops: 3,
  note: "프록시 체인 통계 hop 3개 — 스킬(proxy-industry-chain) 규정상 상한 B. 이 매트릭스의 어떤 결론도 Green 확신도로 표현될 수 없음.",
};

// Step 5 — bottom-up vs top-down consistency check (§4.4 note).
export const CONSISTENCY = {
  bottomUpCagr: 5.7,
  topDownCagr: 6.3,
  tolerance: "허용 오차 내 — 내부 정합성 확인으로만 사용. 양쪽 모두 같은 부류(밴더 리포트)로 소급되므로 독립적 확인이 아님.",
};

// Step 6 — first-party cross-validation (§5.2, source #22 Epiroc FY2025).
export const CROSS_VALIDATION = [
  { claim: "광산(D3)이 2025년 건설(D1)보다 높은 성장", status: "confirmed" as const, evidence: "Epiroc FY2025: \"mining customers remained strong, driven by copper and gold… infrastructure customers remained at a low level, mainly explained by a weak market for attachments\"" },
  { claim: "중국·서유럽·북미가 상위 가중 권역", status: "directional" as const, evidence: "Epiroc 최대 시장 = 미국·서유럽·중국·인도 (상대 서열·비중은 미확인)" },
  { claim: "MEA·중남미는 마이너 권역", status: "confirmed" as const, evidence: "Epiroc '최대 시장' 목록에서 부재" },
  { claim: "북미 '기타'(특수철거 어태치먼트) 실재·성장 포켓", status: "confirmed" as const, evidence: "Stanley Infrastructure 인수(2024, ~SEK 4.7bn) — 미국 특수 어태치먼트 확장 목적" },
  { claim: "지역×세그먼트 교차 매출 정밀 검증", status: "impossible" as const, evidence: "구조적 공시 한계 — 카테고리가 상위 보고 단위에 묻힘. Off-Highway Research·KHL Yellow Table 등 유료 소스로만 해소 가능" },
];

export const VALIDATION_STATUS_META: Record<string, { label: string; chip: string }> = {
  confirmed: { label: "확인", chip: "status-green" },
  directional: { label: "방향성 일치", chip: "status-in-progress" },
  impossible: { label: "검증 불가", chip: "status-red" },
};

// Step 7 — known limitations (§6).
export const LIMITATIONS = [
  "권역 가중치는 더 넓은 건설장비 시장의 프록시 — 브레이커 특화 권역 매출 분할은 공개 소스에 없음.",
  "권역별 세그먼트 믹스는 글로벌 교차검증치에 맞춘 정성적 배분 — 소스 기반 바텀업 합산이 아님.",
  "북미 광산 밴드(2–11% CAGR)는 모델링 불확실성이 아닌 실제 소스 불일치 — 유료 데이터 확보 시 첫 번째 해소 대상.",
  "유럽 규제 프리미엄(EU Stage V)은 특정 규제 일정에 연동되지 않은 판단적 보정.",
  "중국 2025–2026 반등(굴삭기 판매 +17~27% YoY)은 저기저 반등 — 기본 CAGR(6%)는 정규화를 가정, 현 반등율 선형 외삽 금지.",
  "체인 등급 B 상한(통계 hop 3개) — 본 매트릭스 기반 결론은 Green 확신도로 표현 불가.",
];

// Step 8 — registry contract metadata.
export const REGISTRY = {
  runLabel: "hydraulic-breaker-matrix-seed",
  keyPrefix: "hb.",
  expectedRows: { baseline: 18, cagr: 54, total: 72 },
  ttlDays: 365,
  referenceImplementation: "scripts/co-newbiz/register-hydraulic-breaker-assumptions.ts",
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
