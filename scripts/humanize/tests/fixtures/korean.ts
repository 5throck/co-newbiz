// @version 1.0.0
/**
 * Korean fixtures for the humanize tests: an original paragraph and scripted
 * candidate rewrites standing in for the LLM. Source text only (no markdown).
 */

/** Sentence carrying every anchor class: date, number+unit, statute, law name, acronym. */
export const ANCHOR_SENTENCE =
  "2026년 3월 5일 기준 시장 규모는 3.5조원이며 「외국환거래법」 제3조에 따라 LNG 설비 반입 신고가 필요하다.";

export const FILLER_ORIGINAL = [
  "이 보고서는 대상 사업의 외부 환경을 먼저 살펴본다.",
  "수요는 상류 산업의 발주량에 따라 움직이는 구조라고 할 수 있다.",
  "공급 측에서는 소수 업체가 생산 능력의 대부분을 차지하고 있다.",
  "가격은 원자재 비용과 환율의 영향을 함께 받는다.",
  "고객 집중도는 다른 업종보다 높은 편으로 보인다.",
  "규제 환경은 비교적 안정적이나 변화 가능성은 남아 있다.",
  "인증 절차는 사업 개시 이후에도 일정 기간 이어진다.",
  "현지 인력 확보는 초기 단계의 주요 제약으로 꼽힌다.",
  "설비 투자는 단계적으로 집행하는 편이 안전하다.",
  "이상의 내용은 추정에 기반하므로 확정적으로 읽어서는 안 된다.",
];

export const FILLER_REWRITTEN = [
  "본 문서는 해당 사업을 둘러싼 외부 여건부터 짚어 본다.",
  "수요의 방향은 전방 산업의 주문 규모가 좌우한다고 보면 된다.",
  "공급은 몇몇 기업이 설비 능력의 태반을 쥐고 있는 형국이다.",
  "단가는 재료비와 환율 변동에 나란히 흔들린다.",
  "거래처 쏠림은 타 업종에 견주어 큰 듯하다.",
  "제도 환경은 대체로 안정되어 있으나 바뀔 여지가 있다.",
  "인증 절차는 영업을 시작한 뒤에도 한동안 계속된다.",
  "현지 인력을 구하는 일이 초기에 가장 큰 걸림돌이다.",
  "설비 투자는 나누어 집행하는 쪽이 안전하다.",
  "위 내용은 추정이라 단정하여 받아들이면 곤란하다.",
];

/** Wholesale replacement wording: pushes the change rate past the abort limit. */
export const FILLER_HEAVY = [
  "먼저 사업을 감싼 바깥 사정을 훑어보자.",
  "주문이 늘고 줄어드는 폭에 따라 판이 요동치는 시장이다.",
  "소수의 큰 회사가 공장 가동의 거의 전부를 맡는다.",
  "값이 오르내리는 배경에는 재료와 외환이 있다.",
  "몇몇 거래처에 매출이 몰려 있어 흔들릴 위험이 크다.",
  "법과 제도는 잠잠하지만 언제든 손질될 수 있다.",
  "허가와 인증은 문을 연 다음에도 한참 따라온다.",
  "일할 사람을 현지에서 찾는 것이 처음엔 가장 어렵다.",
  "돈은 한꺼번에 쓰지 말고 몫을 나눠 쓰는 편이 낫다.",
  "여기까지는 어림짐작이니 그대로 믿기는 어렵다.",
];

/** Build a paragraph: `rewritten` of the filler sentences replaced, anchors kept or altered. */
export function paragraph(opts: { rewritten: number; anchor?: string; heavy?: boolean }): string {
  const repl = opts.heavy ? FILLER_HEAVY : FILLER_REWRITTEN;
  const filler = FILLER_ORIGINAL.map((s, i) => (i < opts.rewritten ? repl[i] : s));
  return [opts.anchor ?? ANCHOR_SENTENCE, ...filler].join(" ");
}

export const ORIGINAL_PARAGRAPH = paragraph({ rewritten: 0 });

/** A document with two prose paragraphs separated by a protected table. */
export function twoUnitDocument(): string {
  return [
    "# 시장 개요",
    "",
    ORIGINAL_PARAGRAPH,
    "",
    "| 항목 | 값 |",
    "|---|---|",
    "| 규모 | 3.5조원 |",
    "",
    "두 번째 문단은 별도의 단위로 다뤄진다. " + FILLER_ORIGINAL.join(" "),
    "",
  ].join("\n");
}

/** Candidate with a changed number. */
export const ANCHOR_NUMBER_CHANGED = ANCHOR_SENTENCE.replace("3.5조원", "3.6조원");
/** Candidate with a changed date. */
export const ANCHOR_DATE_CHANGED = ANCHOR_SENTENCE.replace("3월 5일", "3월 6일");
/** Candidate dropping the article reference. */
export const ANCHOR_STATUTE_DROPPED = ANCHOR_SENTENCE.replace(" 제3조에", "에");
/** Candidate altering the acronym. */
export const ANCHOR_ACRONYM_CHANGED = ANCHOR_SENTENCE.replace("LNG", "천연가스");
