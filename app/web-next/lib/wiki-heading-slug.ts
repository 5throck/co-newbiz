// wiki-heading-slug — 위키 본문 헤딩의 앵커 슬러그 규칙 (단일 구현).
// 렌더러(lib/wiki.ts)와 생성기(scripts/co-newbiz/sync-wiki-projection.ts)가
// 같은 함수를 써야 한다 — 생성기가 "렌더러가 만들 슬러그"를 기준으로 원본
// 앵커를 검증하기 때문(2026-10-23 위키 인앱 뷰어 설계 §5c). 어느 한쪽만
// 고치면 드리프트 테스트가 잡는다.
//
// github-slugger 호환 규칙: 소문자화, 구두점 제거, 공백→하이픈, 한글 보존.
// 원본 계측과의 한 가지 차이: `&`는 제거가 아니라 하이픈으로 치환한다 —
// 53번 페이지의 실측 앵커 `#m-a-필수-검증-여섯-가지`(헤딩 "M&A 필수 검증
// 여섯 가지")가 이 규칙으로만 재현되기 때문이다(설계 §5c가 이 앵커를
// 첫 실측 케이스로 명시). stock github-slugger라면 `ma-…`가 되어 원본
// 앵커와 어긋난다.

/** 헤딩 텍스트에서 인라인 마크다운 장식(링크·강조·코드)을 벗긴다 — 슬러그는 렌더된 텍스트 기준. */
export function stripInlineMarkdown(text: string): string {
  return (
    text
      // 링크/이미지: [텍스트](대상) → 텍스트
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      // 강조·코드 기호 제거
      .replace(/[*_`~]/g, "")
  );
}

/** 헤딩 텍스트(마크다운 인라인 포함) → 앵커 슬러그. 위 규칙 참고. */
export function wikiHeadingSlug(text: string): string {
  return (
    stripInlineMarkdown(text)
      .trim()
      .toLowerCase()
      // `&` → 하이픈(위 주석 참고). 나머지 구두점은 제거.
      .replace(/&/g, "-")
      // 문자·숫자·공백·하이픈·밑줄만 남긴다(한글 등 유니코드 문자는 \p{L}로 보존).
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-")
  );
}

/**
 * 문서 전체 헤딩의 슬러그 목록. github-slugger와 같이 중복 슬러그에는
 * `-1`, `-2` 접미사를 붙인다. 생성기의 앵커 검증과 렌더러의 id 부여가
 * 같은 카운터 규칙을 공유한다.
 */
export function wikiHeadingSlugs(headings: string[]): string[] {
  const seen = new Map<string, number>();
  return headings.map((h) => {
    const base = wikiHeadingSlug(h);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  });
}
