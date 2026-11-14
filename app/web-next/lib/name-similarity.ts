/**
 * 이름 중복 판정 헬퍼 — 회사명·기회명 등의 실질 유사성 비교.
 * discover/route.ts의 인라인 헬퍼를 S6 웹검색 후보 제안에서도 쓰기 위해 추출.
 * (공백·구두점 정규화 뒤 완전일치·포함 관계·토큰 Jaccard 판정 — 표면별 임계값:
 *  isSimilar는 응답 내 근접 중복용 0.6, 드라이버 제안 중복 필터는 실행 간
 *  의역 포착용 0.25(design 2026-11-14-driver-proposal-dedupe-overshoot §5))
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

/** 드라이버명 중복 판정 토큰 유사도 임계값 — isSimilar의 토큰 Jaccard 선과 같은
 *  0.6(design 2026-11-14-driver-proposal-dedupe-overshoot §5: 임계값은 상수로
 *  문서화한다). 회사 억제가 아닌 제안 중복 판정에도 같은 선을 쓴다 — 선이
 *  갈라지면 두 표면이 같은 이름을 다르게 판정한다. */
export const NAME_SIMILARITY_JACCARD_THRESHOLD = 0.6;

/** 기존 이름 중 하나라도 유사하면 true — 완전일치·포함 관계·토큰 Jaccard ≥
 *  NAME_SIMILARITY_JACCARD_THRESHOLD. */
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
      if (union > 0 && inter / union >= NAME_SIMILARITY_JACCARD_THRESHOLD) return true;
    }
  }
  return false;
}

/** 드라이버명 정규화 키 — normalizeName과 동일 규칙(소문자·공백·구두점 제거).
 *  companyKey와 달리 법인형 흡수가 없다 — 드라이버명에는 법인형 표기가 없다.
 *  동의어 통합(운영비/운용비류)은 의도적으로 제외 — 포함·토큰 Jaccard면
 *  충분하다(design 2026-11-14-driver-proposal-dedupe-overshoot §5). */
export function driverKey(raw: string): string {
  return normalizeName(raw);
}

/** 드라이버 중복 판정 토큰 유사도 임계값 — design
 *  2026-11-14-driver-proposal-dedupe-overshoot §5. isSimilar의 0.6(응답 내
 *  근접 중복용)과 의도적으로 다른 선이다: 이 필터는 실행 간(세션을 넘어)
 *  의역 재제안을 걸러야 하고, 라이브 관찰(2026-11-14 드론 루프)의 실제 중복
 *  쌍은 Jaccard 0.50(운영비 절감 쌍)·0.29(수요 확대 쌍)였다. 0.25는 그 쌍들을
 *  놓치지 않으면서 별개 메커니즘(관측 0.00-0.20)을 살린다. 0.13-0.20의 느슨한
 *  의역은 어휘 판정의 한계다 — 그 층은 프롬프트 금지 블록(D-A)과 과잉 신호
 *  (D-C)이 담당한다. */
export const DRIVER_DEDUPE_JACCARD_THRESHOLD = 0.25;

/** 드라이버명 유사 판정 — 정규화 일치·포함·토큰 Jaccard ≥
 *  DRIVER_DEDUPE_JACCARD_THRESHOLD. isSimilar(0.6)과 같은 골격에 임계값만
 *  이 필터의 관측 근거치를 쓴다. */
function driverNameSimilar(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = a.split(/\s+/);
  const tb = b.split(/\s+/);
  if (ta.length <= 1 && tb.length <= 1) return false;
  const sa = new Set(ta.map((t) => normalizeName(t)));
  const sb = new Set(tb.map((t) => normalizeName(t)));
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = new Set([...sa, ...sb]).size;
  return union > 0 && inter / union >= DRIVER_DEDUPE_JACCARD_THRESHOLD;
}

/** 수용 드라이버와 같은 이름(정규화 일치·포함·토큰 Jaccard ≥ 임계값)인 후보를
 *  거른다 — 삽입 전 하드 필터(design 2026-11-14-driver-proposal-dedupe-
 *  overshoot §5 D-B 보증). 프롬프트 블록(D-A)은 어드바이저리일 뿐이다. 드롭
 *  집합을 그대로 돌려준다 — 호출점이 건수를 요약에 정직히 쓴다. 정규화 결과가
 *  빈 후보는 중복 판정 대상이 아니라 입력 결함 — 호출점의 기존 검증에 맡기고
 *  살린다(isSimilar의 빈 입력=true와 다른 계약). */
export function filterDuplicateDriverProposals<T extends { driver: string }>(
  candidates: T[],
  acceptedDriverNames: string[],
): { survivors: T[]; dropped: T[] } {
  const survivors: T[] = [];
  const dropped: T[] = [];
  for (const c of candidates) {
    const isDup = driverKey(c.driver) !== "" && acceptedDriverNames.some((n) => driverNameSimilar(c.driver, n));
    if (!isDup) survivors.push(c);
    else dropped.push(c);
  }
  return { survivors, dropped };
}
