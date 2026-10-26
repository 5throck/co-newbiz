// @version 1.0.0
/**
 * ADR-0186 D2 / design 3.13 - validateRationale, the script-aware form check.
 * Boundary tests use exactly-at and one-below each threshold; the accepted
 * strings are the REAL rationales from tests/scenarios and the DB seeds
 * (design 3.11: every scenario string must meet the profile).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeForDenylist, validateRationale } from "../../app/web-next/lib/rationale-check.ts";

const reason = (text: string, profile: "decision" | "ack" = "decision") => {
  const r = validateRationale(text, profile);
  return r.ok ? "ok" : r.reason;
};

// Real strings from tests/scenarios/*.test.ts and _support/ui.ts.
const REAL_SCENARIO_DECISION_STRINGS = [
  "채택 사례의 NPV/BEP가 투자 기준을 충족함",
  "Entity IC: 투자 구조와 DD 결과를 검토하고 승인함",
  "실사에서 인증 이전 불가 사실이 확인되어 중단 권고",
  "Entity IC 제안: DD와 투자구조가 승인 기준을 충족함",
  "RAG 산정 전이지만 위원회가 정성 판단으로 진행하기로 함",
  "E2E: 누락 산출물을 인지하고 예외로 GO를 기록함",
];
const REAL_SCENARIO_ACK_STRINGS = [
  "대상 기업의 임원 보상 자료가 데이터룸에 없어 면제를 요청함",
  "확인 필요 항목 근거: 검토했고 사람이 확인함",
  "1순위 대상과 같은 체크리스트로 위험 수준을 직접 비교하기 위함",
];

describe("validateRationale - accepts genuine reasoning", () => {
  test("every real scenario decision rationale passes the decision profile", () => {
    for (const s of REAL_SCENARIO_DECISION_STRINGS) expect(reason(s), s).toBe("ok");
  });
  test("every real scenario ack/waiver reason passes the ack profile", () => {
    for (const s of REAL_SCENARIO_ACK_STRINGS) expect(reason(s, "ack"), s).toBe("ok");
  });
  test("a genuine ~150 character Korean rationale passes", () => {
    const ko = "대상 회사의 최근 3개년 영업이익률이 업종 평균을 웃돌고 핵심 인증이 지배권 변경 후에도 유지됨을 인증기관 규정으로 확인했으므로, 조건부 없이 다음 단계로 진행하는 것이 타당하다고 판단함";
    expect([...ko].length).toBeGreaterThan(80);
    expect(reason(ko)).toBe("ok");
  });
  test("a genuine ~150 character English rationale passes", () => {
    const en = "The target's operating margin has exceeded the sector median for three consecutive years, and the key certification survives a change of control per the certifying body's own rules, so we proceed.";
    expect(en.length).toBeGreaterThan(150);
    expect(reason(en)).toBe("ok");
  });
});

describe("validateRationale - rejects placeholders", () => {
  test.each([".", "ok", "OK", "n/a", "N/A", "test", "lgtm", "approved", "-", "   ", ""])("%p", (s) => {
    expect(reason(s)).not.toBe("ok");
  });
  test("a bare Korean approval word is a placeholder or too short (any inflection)", () => {
    for (const s of ["승인", "승인합니다", "승인함", "동의합니다", "확인했습니다", "문제없음", "ㅇㅋ", "ㅇㅇㅇㅇ"]) {
      expect(reason(s), s).not.toBe("ok");
    }
    expect(reason("승인합니다")).toBe("placeholder");
    expect(reason("ㅇㅇㅇㅇ")).toBe("jamo_only");
  });
  test("a run of placeholder words does not slip past the length thresholds", () => {
    expect(reason("승인 승인 승인 승인")).toBe("placeholder");
    expect(reason("동의 승인 확인 완료")).toBe("placeholder");
    expect(reason("ok ok ok ok ok ok")).toBe("placeholder");
    expect(reason("검토결과 검토결과 검토결과 검토결과")).toBe("repetitive");
    expect(reason("approved lgtm fine good done ok")).toBe("placeholder");
  });
  test("jamo-only text is rejected with its own reason", () => {
    expect(reason("ㅋㅋㅋ ㅎㅎㅎ ㅇㅇㅇ ㅅㅅㅅ ㄱㄱㄱ ㄴㄴㄴ")).toBe("jamo_only");
  });
  test("a single character repeated beyond 70 percent is repetitive", () => {
    expect(reason("aaaaaaaaaaaaaaaaaaaaaaaa bbb")).toBe("repetitive");
    expect(reason("하하하하하하하하하하하하하하 좋다")).toBe("repetitive");
  });
});

describe("validateRationale - Hangul thresholds (decision 12 syllables / 3 eojeol, ack 8 / 2)", () => {
  test("decision: exactly 12 syllables and 3 eojeol passes; 11 syllables is too_short", () => {
    expect(reason("가나다라 마바사아 자차카타")).toBe("ok");
    expect(reason("가나다라 마바사아 자차카")).toBe("too_short");
  });
  test("decision: 12 syllables in 2 eojeol is too_few_words", () => {
    expect(reason("가나다라마바 사아자차카타")).toBe("too_few_words");
  });
  test("ack: exactly 8 syllables and 2 eojeol passes; 7 syllables is too_short; 1 eojeol is too_few_words", () => {
    expect(reason("가나다라 마바사아", "ack")).toBe("ok");
    expect(reason("가나다라 마바사", "ack")).toBe("too_short");
    expect(reason("가나다라마바사아", "ack")).toBe("too_few_words");
  });
  test("a real scenario string one syllable short of the decision profile is rejected", () => {
    // "실사에서 인증 이전 불가 사실이 확인되어 중단 권고" has 25 syllables; 11 syllables over 3 eojeol must fail.
    expect(reason("실사에서 인증 이전 불가 사실이 확인")).toBe("ok"); // 4 eojeol-less guard: 15 syllables
    expect(reason("실사에서 인증 이전 불가")).toBe("too_short"); // 9 syllables
  });
  test("the short scenario strings of the dialog tests fail the profile (withdrawal dialog reason)", () => {
    expect(reason("너무 짧음")).toBe("too_short");
  });
});

describe("validateRationale - Latin thresholds (decision 20 chars / 4 words, ack 12 / 3)", () => {
  test("decision: exactly 20 letters over 4 words passes; 19 is too_short", () => {
    expect(reason("alpha bravo delta gamma")).toBe("ok"); // 5+5+5+5 = 20
    expect(reason("alpha bravo delta gamm")).toBe("too_short"); // 19
  });
  test("decision: 20+ letters in 3 words is too_few_words", () => {
    expect(reason("alphabravo deltagamma epsilon")).toBe("too_few_words");
  });
  test("ack: exactly 12 letters over 3 words passes; 11 is too_short; 2 words is too_few_words", () => {
    expect(reason("four word item", "ack")).toBe("ok"); // 4+4+4 = 12
    expect(reason("four word ite", "ack")).toBe("too_short"); // 11
    expect(reason("fourwordsitem here", "ack")).toBe("too_few_words");
  });
});

describe("validateRationale - dominant script and the cross-gate duplicate rule", () => {
  test("mixed text is judged by its dominant script (Latin acronyms do not rescue thin Hangul)", () => {
    expect(reason("NPV BEP IRR WACC 좋음")).toBe("too_short");
    expect(reason("채택 사례의 NPV/BEP가 투자 기준을 충족함")).toBe("ok");
  });
  test("a tie between scripts goes to Hangul", () => {
    expect(reason("가나다라 마바사아 자차카타 abcdefghijkl")).toBe("ok");
  });
  test("decision rationale identical (normalized) to another gate's rationale is rejected", () => {
    const text = "투자 구조와 DD 결과를 검토하고 승인함";
    expect(validateRationale(text, "decision", { otherRationales: ["Other text entirely here now", text.toUpperCase() + "!"] })).toEqual({ ok: false, reason: "duplicate_of_other_gate" });
    expect(validateRationale(text, "decision", { otherRationales: ["다른 근거로 충분히 길게 작성한 문장입니다"] })).toEqual({ ok: true });
    // the ack profile never applies the duplicate rule
    expect(validateRationale(text, "ack", { otherRationales: [text] })).toEqual({ ok: true });
  });
});

describe("denylist data file", () => {
  test("is a data file with ko and en entries and Korean endings", () => {
    const d = JSON.parse(readFileSync(join(import.meta.dirname, "../../app/web-next/lib/rationale-denylist.json"), "utf8")) as { ko: string[]; en: string[]; ko_endings: string[] };
    expect(d.ko.length).toBeGreaterThan(10);
    expect(d.en).toContain("lgtm");
    expect(d.ko_endings.length).toBeGreaterThan(5);
  });
  test("normalizeForDenylist folds polite and plain endings onto the stem", () => {
    expect(normalizeForDenylist("승인합니다.")).toBe(normalizeForDenylist("승인함"));
    expect(normalizeForDenylist("OK!")).toBe("ok");
  });
});
