/**
 * 이름 중복 판정 헬퍼 — 회사명·기회명 등의 실질 유사성 비교.
 * discover/route.ts의 인라인 헬퍼를 S6 웹검색 후보 제안에서도 쓰기 위해 추출.
 * (공백·구두점 정규화 뒤 완전일치·포함 관계·토큰 Jaccard ≥ 0.6으로 판정)
 */
import { canonicalCompanyName } from "./company-name.ts";

/** 이름 정규화 — 공백·구두점 제거, 소문자. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s\p{P}]/gu, "");
}

/** 법인 형태 표기 잔여 토큰 — canonicalCompanyName이 정규화하지 못하는 두 표기:
 *  `㈜`(단일 글리프)와 `주식회사`(단어형, 접두·접미 어느 쪽이든). canonical
 *  단계를 지난 뒤에 남아 있다면 그것은 표기 잔재다(design
 *  2026-11-13-proposal-ignore-suppression §3.2). */
const RESIDUAL_LEGAL_FORM = /㈜|주식회사/g;

/** 선행 법인 형태 마커 `(주)/(재)/(유)` — company-name.ts의 것과 동일한 패턴.
 *  canonicalCompanyName이 전체가 괄호인 입력에 대해 trim 원문을 돌려주는
 *  폴백(`(주)` → `(주)`) 때문에 마커가 살아남는 유일한 경우를 여기서 한 번 더
 *  벗긴다 — 그렇지 않으면 `"(주)"`가 빈 키가 아니라 유령 키 `주`가 된다. */
const LEADING_CORPORATE_FORM = /^\((주|재|유)\)/;

/** 억제 키 — 법인 형태 표기 차이를 흡수하는 결정론적 회사 키(design
 *  2026-11-13-proposal-ignore-suppression §3.2). canonicalCompanyName(트림·
 *  공백 축약·괄호 각주·선행 마커 제거) → 잔여 법인형 토큰 제거(`㈜`·`주식회사`)
 *  → normalizeName(소문자·공백·구두점 제거). `주식회사 X`, `X(주)`,
 *  `X 주식회사`, `X`는 모두 하나의 키로 합쳐진다. 억제 매칭은 이 키의
 *  완전 일치뿐이다 — 퍼지 유사성(isSimilar)은 억제에 절대 쓰지 않는다(거짓
 *  억제가 재등장보다 나쁘다). 빈 문자열 입력(예: `"(주)"`)은 빈 키 — 호출점이
 *  거부한다(company_required). DEC-20261113-04 폴백: 이 토큰 제거가 실제
 *  회사명에서 오동작하면 토큰 제거 없이 canonical+normalize만으로 키를
 *  만들고 그 불일치를 기록한다(퍼지 확대는 금지). */
export function companyKey(raw: string): string {
  const canonical = canonicalCompanyName(raw).replace(LEADING_CORPORATE_FORM, "").trim();
  const stripped = canonical.replace(RESIDUAL_LEGAL_FORM, " ").trim();
  return normalizeName(stripped);
}

/** 기존 이름 중 하나라도 유사하면 true — 완전일치·포함 관계·토큰 Jaccard ≥ 0.6. */
export function isSimilar(name: string, existingNames: string[]): boolean {
  const a = normalizeName(name);
  if (!a) return true;
  for (const existing of existingNames) {
    const b = normalizeName(existing);
    if (!b) continue;
    if (a === b || a.includes(b) || b.includes(a)) return true;
    // 공백이 제거된 정규화 형태라 split(" ")은 대개 1토큰 — 유의미한 토큰
    // 비교는 원문(정규화 전)에서 수행한다.
    const rawA = name.split(/\s+/);
    const rawB = existing.split(/\s+/);
    if (rawA.length > 1 && rawB.length > 1) {
      const bset = new Set(rawB.map((t) => normalizeName(t)));
      let inter = 0;
      for (const t of new Set(rawA.map((t) => normalizeName(t)))) if (bset.has(t)) inter++;
      const union = new Set([...rawA.map((t) => normalizeName(t)), ...rawB.map((t) => normalizeName(t))]).size;
      if (union > 0 && inter / union >= 0.6) return true;
    }
  }
  return false;
}
