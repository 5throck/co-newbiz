/**
 * 이름 중복 판정 헬퍼 — 회사명·기회명 등의 실질 유사성 비교.
 * discover/route.ts의 인라인 헬퍼를 S6 웹검색 후보 제안에서도 쓰기 위해 추출.
 * (공백·구두점 정규화 뒤 완전일치·포함 관계·토큰 Jaccard ≥ 0.6으로 판정)
 */

/** 이름 정규화 — 공백·구두점 제거, 소문자. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s\p{P}]/gu, "");
}

/** 기존 이름 중 하나라도 유사하면 true — 완전일치·포함 관계·토큰 Jaccard ≥ 0.6. */
export function isSimilar(name: string, existingNames: string[]): boolean {
  const a = normalizeName(name);
  if (!a) return true;
  for (const existing of existingNames) {
    const b = normalizeName(existing);
    if (!b) continue;
    if (a === b || a.includes(b) || b.includes(a)) return true;
    const at = a.split(" ");
    const bt = b.split(" ");
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
