// @version 1.0.0
/**
 * Competitive-positioning disclosure cross-check (schemaVersion 3, ADR-0113).
 * Network-independent pure-logic tests only: disclosure context extraction,
 * business-report selection, claim building, verdict→ledger mapping, and the
 * deterministic section-grade rules. The LLM/DART/Tavily execution paths are
 * exercised by the pipeline status test's offline branches (keys blanked).
 */
import { test, expect, describe } from "bun:test";
import {
  buildClaims,
  extractDisclosureContext,
  mapVerdictToLedger,
  deriveCompetitiveSectionGrade,
  type CompetitiveCrossCheck,
} from "../../app/web-next/lib/company-profile-crosscheck.ts";
import { selectBusinessReport, type DisclosureRow } from "../../app/web-next/lib/dart-client.ts";

const row = (rceptNo: string, reportNm: string, rceptDt: string): DisclosureRow => ({
  rcept_no: rceptNo,
  corp_name: "테스트",
  report_nm: reportNm,
  rcept_dt: rceptDt,
  preset: "business",
});

describe("selectBusinessReport", () => {
  test("비정정본을 우선하고 최신 접수를 고른다", () => {
    const picked = selectBusinessReport([
      row("1", "사업보고서 (2025.12)", "20260331"),
      row("2", "정정사업보고서 (2025.12)", "20260430"),
      row("3", "사업보고서 (2024.12)", "20250331"),
    ]);
    expect(picked?.rcept_no).toBe("1");
  });

  test("정정뿐이면 정정본을 돌려준다", () => {
    const picked = selectBusinessReport([
      row("1", "정정사업보고서 (2025.12)", "20260430"),
      row("2", "정정사업보고서 (2025.12)", "20260510"),
    ]);
    expect(picked?.rcept_no).toBe("2");
  });

  test("사업보고서가 없으면 null", () => {
    expect(selectBusinessReport([row("1", "감사보고서", "20260331")])).toBeNull();
    expect(selectBusinessReport([])).toBeNull();
    // rcept_no 누락 행은 후보에서 제외
    expect(selectBusinessReport([row("", "사업보고서", "20260331")])).toBeNull();
  });
});

describe("extractDisclosureContext", () => {
  test("키워드 히트 주변 창을 추출한다", () => {
    const pad = "가".repeat(5000);
    const text = `${pad}경쟁사는 두산밥캣 등이다.${pad}`;
    const ctx = extractDisclosureContext(text, { window: 400, maxWindows: 3 });
    expect(ctx).toContain("경쟁사는 두산밥캣");
    expect(ctx.length).toBeLessThanOrEqual(400 * 3);
  });

  test("겹치는 창은 병합되고 창 수 상한을 지킨다", () => {
    const pad = "나".repeat(300);
    const text = Array.from({ length: 20 }, (_, i) => `${pad}경쟁 ${i}${pad}`).join(" / ");
    const ctx = extractDisclosureContext(text, { window: 500, maxWindows: 2 });
    expect(ctx).toContain("경쟁");
    // maxWindows 이후 히트는 절단될 수 있다 — 총 길이 상한은 창 상한 × window
    expect(ctx.length).toBeLessThanOrEqual(500 * 2);
  });

  test("키워드 미히트 시 앞부분 폴백, 빈 텍스트는 빈 문자열", () => {
    expect(extractDisclosureContext("가나다라마바사")).toBe("가나다라마바사");
    expect(extractDisclosureContext("")).toBe("");
  });
});

describe("buildClaims", () => {
  test("경쟁사별 주장 + 포지셔닝 서술 1건", () => {
    const claims = buildClaims({
      competitors: [{ name: "한전KPS", note: "발전소 정비 경쟁 [1]" }, { name: "두산밥캣", note: "" }],
      positioning: "정비 시장 1위 [2]",
    });
    expect(claims).toEqual([
      "경쟁사 한전KPS: 발전소 정비 경쟁 [1]",
      "경쟁사 두산밥캣: 경쟁 관계 존재",
      "경쟁 포지셔닝: 정비 시장 1위 [2]",
    ]);
  });

  test("경쟁사 6개 상한", () => {
    const claims = buildClaims({
      competitors: Array.from({ length: 9 }, (_, i) => ({ name: `경쟁사${i}`, note: "" })),
      positioning: "",
    });
    expect(claims).toHaveLength(6);
  });
});

describe("mapVerdictToLedger", () => {
  test("판정 4단 → 원장 3단 (상충은 판단필요 — 자동 판정 없음)", () => {
    expect(mapVerdictToLedger("confirmed")).toBe("confirmed");
    expect(mapVerdictToLedger("directional")).toBe("needs_judgement");
    expect(mapVerdictToLedger("contradicted")).toBe("needs_judgement");
    expect(mapVerdictToLedger("unverified")).toBe("could_not_verify");
    expect(mapVerdictToLedger(undefined)).toBe("needs_judgement");
  });
});

describe("deriveCompetitiveSectionGrade", () => {
  const competitive = { competitors: [{ name: "한전KPS", note: "경쟁" }], positioning: "1위" };

  test("미생성·폴백은 D", () => {
    expect(deriveCompetitiveSectionGrade(undefined, undefined).grade).toBe("D");
    expect(deriveCompetitiveSectionGrade({ competitors: [], positioning: "", degraded: "파싱 실패" }, undefined).grade).toBe("D");
  });

  test("대조 전(구버전)은 C — 기존 노트 유지", () => {
    const g = deriveCompetitiveSectionGrade(competitive, undefined);
    expect(g.grade).toBe("C");
    expect(g.note).toContain("대조 전");
  });

  test("DART 대조 + confirmed 존재 → B-", () => {
    const cc: CompetitiveCrossCheck = {
      status: "cross_checked",
      checkedAt: "2026-09-10T00:00:00Z",
      claims: [
        { claim: "경쟁사 한전KPS: 경쟁", verdict: "confirmed", source: "dart", evidence: "원문 발췌" },
        { claim: "경쟁 포지셔닝: 1위", verdict: "directional", source: "research", evidence: "스니펫" },
      ],
    };
    const g = deriveCompetitiveSectionGrade(competitive, cc);
    expect(g.grade).toBe("B-");
    expect(g.note).toContain("원문 대조 완료");
    expect(g.note).toContain("확인 1");
  });

  test("DART 대조 완료였지만 직접 확인 0건 → C", () => {
    const cc: CompetitiveCrossCheck = {
      status: "cross_checked",
      checkedAt: "2026-09-10T00:00:00Z",
      claims: [{ claim: "경쟁사 한전KPS: 경쟁", verdict: "directional", source: "dart", evidence: "원문 발췌" }],
    };
    expect(deriveCompetitiveSectionGrade(competitive, cc).grade).toBe("C");
  });

  test("상충이 있으면 노트에 분석가 판단 필요가 명시된다", () => {
    const cc: CompetitiveCrossCheck = {
      status: "cross_checked",
      checkedAt: "2026-09-10T00:00:00Z",
      claims: [{ claim: "경쟁사 한전KPS: 경쟁", verdict: "contradicted", source: "dart", evidence: "원문과 상충" }],
    };
    const g = deriveCompetitiveSectionGrade(competitive, cc);
    expect(g.note).toContain("상충 1건");
  });

  test("비상장(research_only)은 C, 공시 대조 실패(dart_unavailable)는 C-", () => {
    const ro: CompetitiveCrossCheck = { status: "research_only", checkedAt: "2026-09-10T00:00:00Z", claims: [] };
    expect(deriveCompetitiveSectionGrade(competitive, ro).grade).toBe("C");
    const du: CompetitiveCrossCheck = { status: "dart_unavailable", checkedAt: "2026-09-10T00:00:00Z", claims: [], note: "원문이 ZIP이 아닙니다" };
    const g = deriveCompetitiveSectionGrade(competitive, du);
    expect(g.grade).toBe("C-");
    expect(g.note).toContain("원문이 ZIP이 아닙니다");
  });
});
