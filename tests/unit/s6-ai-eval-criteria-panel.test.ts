// @version 1.0.0
/** S6 evaluation-criteria panel (ADR-0199): defaults vs adjusted badge, live rule sentences, score explanation,
 * viewer-disabled editing, the PATCH body, the technical rule block, version-panel threshold marker, ko/en parity. */
import { describe, expect, mock, test } from "bun:test";

// biome-ignore lint/suspicious/noExplicitAny: test reads untyped module namespaces and JSON catalogs
type Loose = any;
const WEB = "../../app/web-next";
const patchCalls: Array<[string, unknown]> = [];
mock.module(`${import.meta.dir}/../../app/web-next/lib/api.ts`, () => ({
  ApiError: class extends Error {},
  api: {
    patch: async (u: string, b: unknown) => void patchCalls.push([u, b]),
    get: async () => ({ data: {} }),
    post: async () => ({ data: {} }),
  },
}));
const { renderToStaticMarkup } = (await import(`${WEB}/node_modules/react-dom/server.js`)) as Loose;
const { createElement } = (await import(`${WEB}/node_modules/react/index.js`)) as Loose;
const { NextIntlClientProvider } = (await import(`${WEB}/node_modules/next-intl`)) as Loose;
const ko = (await import(`${WEB}/locales/ko.json`)).default as Record<string, Loose>;
const en = (await import(`${WEB}/locales/en.json`)).default as Record<string, Loose>;
const panel = (await import(`${WEB}/components/stages/brownfield/AiEvalCriteriaPanel.tsx`)) as Loose;
const rules = (await import(`${WEB}/components/stages/brownfield/AiEvalCriteriaRules.tsx`)) as Loose;
const helpers = (await import(`${WEB}/components/stages/brownfield/aiEvalRules.ts`)) as Loose;
const vp = (await import(`${WEB}/components/stages/brownfield/AiEvalVersionPanel.tsx`)) as Loose;
const repo = (await import("../../db/repositories/dart-evidence-cache.repository.ts")) as Loose;

const render = (el: unknown, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale, messages: locale === "ko" ? ko : en, timeZone: "Asia/Seoul" }, el),
  );
const row = (over: Record<string, unknown>) => ({
  id: "c1",
  category: "financial",
  source: "builtin",
  label: "매출액",
  data_ref: "revenue_5y",
  weight: 10,
  rubric_json: null,
  ...over,
});
const list = (criteria: unknown[], canAct = true, locale: "ko" | "en" = "ko") =>
  render(createElement(panel.CriteriaList, { criteria, canAct, savingId: null, onSave: () => {} }), locale);

describe("criteria list", () => {
  test("default vs adjusted badge, as text", () => {
    expect(list([row({})])).toContain("기본값");
    const adj = list([row({ rubric_json: JSON.stringify({ cagrPass: 8 }) })]);
    expect(adj).toContain("조정됨");
    expect(adj).not.toContain("기본값</span>");
  });
  test("rule sentence follows the live values", () => {
    expect(list([row({})])).toContain("CAGR ≥ +5%");
    const adj = list([row({ rubric_json: JSON.stringify({ cagrPass: 8, cagrPartial: 2 }) })]);
    expect(adj).toContain("CAGR ≥ +8%");
    expect(adj).toContain("CAGR ≥ +2%");
    expect(list([row({ id: "d", data_ref: "debt_5y" })])).toContain("자본잠식");
  });
  test("viewer cannot edit and sees the reason; editor sees save", () => {
    const v = list([row({})], false);
    expect(v).toContain("disabled");
    expect(v).toContain(ko.stages.s67.aiEval.criteriaPanel.viewerReason);
    expect(list([row({})], true)).not.toContain(ko.stages.s67.aiEval.criteriaPanel.viewerReason);
    expect(list([row({})], true, "en")).toContain("Save");
  });
  test("technical criteria show weight and the read-only rule block", () => {
    const html = list([row({ id: "t", category: "technical", source: "seeded", data_ref: null, label: "특허" })]);
    expect(html).toContain("특허");
    expect(html).toContain("가중치 10");
    expect(html).toContain("확인 안됨");
    expect(html).not.toContain("<form");
  });
});

describe("explanations + save", () => {
  test("score explanation text and DART window values match the repository constants", () => {
    const html = render(createElement(rules.ScoreExplanation, {}));
    expect(html).toContain("충족 1, 부분충족 0.5, 미충족 0");
    expect(html).toContain("순위에 반영되지 않습니다");
    expect(html).toContain("A = DART");
    expect(helpers.DART_REUSE_DAYS).toBe(repo.DART_FRESHNESS_DAYS);
    expect(helpers.DART_REUSE_DAYS_FILING_SEASON).toBe(repo.DART_FRESHNESS_DAYS_FILING_SEASON);
    expect(html).toContain("30일");
    expect(html).toContain("7일");
  });
  test("save sends the existing PATCH with { rubric }", async () => {
    await panel.saveRubricRequest("o 1", "c1", { cagrPass: 8 });
    expect(patchCalls[0]).toEqual(["/api/brownfield/o%201/eval-criteria/c1", { rubric: { cagrPass: 8 } }]);
  });
  test("notice states that old versions keep their thresholds", () => {
    expect(ko.stages.s67.aiEval.criteriaPanel.notice).toContain("기존 버전은 유지");
  });
});

describe("version comparison threshold marker", () => {
  const ver = (no: number, rubric: unknown) => ({
    id: `v${no}`,
    category: "financial",
    version_no: no,
    provisional_score: 50,
    proposed_count: 1,
    unverified_count: 0,
    evidence_grade: "A",
    created_at: "2026-11-16T00:00:00Z",
    confirmed_count: 0,
    payload: {
      criteria_snapshot: [{ criterion_id: "c1", label: "매출액", rubric }],
      items: [{ criterion_id: "c1", proposed_status: "pass" }],
      human_items: [],
    },
  });
  test("shows thresholds per version and marks 기준 변경 only on the newer, differing version", () => {
    const html = render(
      createElement(vp.VersionTable, {
        category: "financial",
        versions: [ver(2, { cagrPass: 8 }), ver(1, { cagrPass: 5 })],
      }),
    );
    expect(html).toContain("cagrPass 8");
    expect(html).toContain("cagrPass 5");
    expect(html.match(/기준 변경/g)?.length).toBe(1);
    const same = render(
      createElement(vp.VersionTable, {
        category: "financial",
        versions: [ver(2, { cagrPass: 5 }), ver(1, { cagrPass: 5 })],
      }),
    );
    expect(same).not.toContain("기준 변경");
  });
});

test("ko/en key parity for criteriaPanel", () => {
  const flat = (o: Loose, p = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  expect(flat(en.stages.s67.aiEval.criteriaPanel).sort()).toEqual(flat(ko.stages.s67.aiEval.criteriaPanel).sort());
  expect(en.stages.s67.aiEval.rubricChanged).toBeTruthy();
});
