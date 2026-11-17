// @version 1.0.0
/**
 * S6 evaluation-target direction UI — design 2026-11-17-s6-universe-direction-review
 * §7 + test plan §8.6/§8.7 (house pattern: s6-universe-ui.test.ts, renderToStaticMarkup
 * under NextIntlClientProvider).
 *
 * Locked in:
 *   - the card is conclusion-first, the basis/evidence sit in a collapsed <details>, no
 *     truncation classes, every chip carries text, empty fields read `미제안`, the
 *     server-built support line is localized by key/kind (`성장률 S1 미기록`);
 *   - states: AI draft, deterministic fallback (all fields empty), legacy record (hint,
 *     no auto-convert), no-grounding note in the modal; proposal notice + counts in the
 *     modal preview; no PASS / verified wording anywhere;
 *   - universeDraft helpers: applying fills editable fields only, edits flip that group's
 *     origin to `person`, `definition` is the labelled direction text, caps, save payload;
 *   - the label rename (ko + en) at every inventoried key and the hardcoded tab label.
 */
import { describe, expect, test } from "bun:test";

const WEB = "../../app/web-next";
const { renderToStaticMarkup } = (await import(`${WEB}/node_modules/react-dom/server.js`)) as {
  renderToStaticMarkup: (el: unknown) => string;
};
const { createElement } = (await import(`${WEB}/node_modules/react/index.js`)) as {
  createElement: (type: unknown, props: unknown, ...c: unknown[]) => unknown;
};
const { NextIntlClientProvider } = (await import(`${WEB}/node_modules/next-intl`)) as {
  NextIntlClientProvider: unknown;
};
const ko = (await import(`${WEB}/locales/ko.json`)).default as Record<string, unknown>;
const en = (await import(`${WEB}/locales/en.json`)).default as Record<string, unknown>;
const { UniverseDirectionCard } = (await import(`${WEB}/components/stages/brownfield/UniverseDirectionCard.tsx`)) as {
  UniverseDirectionCard: unknown;
};
const { UniverseDraftPanel } = (await import(`${WEB}/components/stages/brownfield/UniverseDraftPanel.tsx`)) as {
  UniverseDraftPanel: unknown;
};
const { UniverseDirectionFields } = (await import(
  `${WEB}/components/stages/brownfield/UniverseDirectionFields.tsx`
)) as { UniverseDirectionFields: unknown };
const draftLib = (await import(
  `${WEB}/components/stages/brownfield/universeDraft.ts`
)) as typeof import("../../app/web-next/components/stages/brownfield/universeDraft.ts");
const { readFileSync } = require("node:fs") as typeof import("node:fs");

const render = (el: unknown, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" },
      el,
    ),
  );
const noop = () => {};

const field = (text: string, refs: string[] = [], unverified = false) => ({ text, refs, unverified });
const direction = (over: Record<string, unknown> = {}) => ({
  direction_version: 1 as const,
  headline: field("원자력 발전소 미드스트림 기자재 공급 기업을 본다", ["E1"]),
  scope: { industry: field("원전 기자재 제조", ["E1"]), region: field("국내·유럽", ["E3"]), size: field("", [], true) },
  value_chain: field("미드스트림 (기자재·부품 공급)", ["E4"]),
  prioritise: [{ type: "단조 부품 업체", why: "S1 체인의 병목 단계", refs: ["E4"], unverified: false }],
  exclude: [{ type: "원료 채굴 기업", why: "체인 밖", refs: [], unverified: true }],
  basis: field("S1 v7 체인과 세그먼트를 근거로", ["E1", "E4"]),
  support: {
    segments: [
      { key: "size", label: "Market size", kind: "anchor", value: "$39.88B (2026)", ref: "E2", grade: "B" },
      { key: "growth", label: "Growth rate", kind: "unrecorded", value: "", ref: "", grade: null },
      { key: "profitability", label: "Stage profitability", kind: "unverified", value: "", ref: "E9", grade: null },
    ],
  },
  grade: "C" as const,
  ...over,
});
const evidence = [
  { id: "E1", kind: "s1_identity", ref: "S1 v7", version_id: "v7", fact: "Nuclear equipment", grade: "B" },
  { id: "E4", kind: "s1_chain", ref: "S1 v7", version_id: "v7", fact: "Chain: forging -> assembly", grade: "C" },
];
const universe = (over: Record<string, unknown> = {}) => ({
  definition: "결론: 원자력 발전소 미드스트림 기자재 공급 기업을 본다",
  min_long_list: 5,
  direction_version: 1 as const,
  direction: direction(),
  evidence,
  origin: { headline: "ai", scope: "ai", value_chain: "ai", prioritise: "ai", exclude: "ai" },
  drafted: { prompt_version: "s6.universe_criteria_draft@3", generated_at: "2026-11-17T01:02:03.000Z" },
  ...over,
});
const card = (u: Record<string, unknown>, locale: "ko" | "en" = "ko") =>
  render(createElement(UniverseDirectionCard, { universe: u }), locale);

describe("UniverseDirectionCard — conclusion-first view", () => {
  const html = card(universe());
  test("rows are ordered conclusion, scope, value chain, prioritise, exclude, market support", () => {
    const at = (s: string) => html.indexOf(`>${s}</dt>`);
    const order = ["결론", "범위", "가치사슬", "우선", "제외", "시장 근거", "최소 후보 수"].map(at);
    expect(order.every((i) => i >= 0)).toBeTrue();
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("원자력 발전소 미드스트림 기자재 공급 기업을 본다");
  });
  test("basis and evidence are collapsed in one <details> that is not open", () => {
    expect(html).toContain("<details");
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).toContain("근거 보기");
    expect(html).toContain("근거 2건");
    expect(html).toContain("한 줄 근거");
    expect(html).toContain("</code> S1 가치사슬 · S1 v7 · Chain: forging -&gt; assembly · 신뢰도 C");
  });
  test("chips carry text (never colour alone): confidence grade and 검증 필요", () => {
    expect(html).toContain("신뢰도 C");
    expect(html).toContain("검증 필요");
    expect(html).toContain("⚠");
    expect(html).toContain('aria-hidden="true"');
  });
  test("empty fields read 미제안; refs render as citation codes", () => {
    expect(html).toContain("미제안");
    expect(html).toContain("[E3]");
  });
  test("the support line is localized from key/kind and is read-only text", () => {
    expect(html).toContain("시장 규모 $39.88B (2026)");
    expect(html).toContain("성장률 S1 미기록");
    expect(html).toContain("단계 수익성 검증 필요");
  });
  test("a recorded growth source is labelled by kind", () => {
    const d = direction({
      support: {
        segments: [
          { key: "growth", label: "Growth rate", kind: "external_forecast", value: "6.2%", ref: "E5", grade: "B" },
        ],
      },
    });
    expect(card(universe({ direction: d }))).toContain("성장률 6.2% (외부 전망)");
  });
  test("wraps long text fully: no truncate / line-clamp, anywhere-wrapping", () => {
    expect(html).not.toMatch(/truncate|line-clamp/);
    expect(html).toContain("[overflow-wrap:anywhere]");
    expect(html).toContain("whitespace-pre-wrap");
  });
  test("proposal-only: origin line, no PASS / verified wording", () => {
    expect(html).toContain("AI 초안 2026-11-17 · 사람이 저장");
    expect(html).not.toMatch(/PASS|verified|검증됨|통과/);
  });
  test("a person-edited group is shown as person origin", () => {
    const h = card(universe({ origin: { headline: "person", scope: "ai" } }));
    expect(h).toContain("사람이 수정");
  });
  test("en locale renders the English labels from the same keys", () => {
    const h = card(universe(), "en");
    expect(h).toContain(">Conclusion</dt>");
    expect(h).toContain("Growth rate not recorded in S1");
    expect(h).toContain("Confidence C");
    expect(h).toContain("Not proposed");
    expect(h).toContain("S1 value chain");
  });
});

describe("UniverseDirectionCard — fallback and legacy states", () => {
  test("deterministic fallback: every direction field is 미제안, support line and evidence remain", () => {
    const d = direction({
      headline: field(""),
      scope: { industry: field(""), region: field(""), size: field("") },
      value_chain: field(""),
      prioritise: [],
      exclude: [],
      basis: field(""),
      grade: null,
    });
    const h = card(universe({ direction: d, origin: { headline: "deterministic" } }));
    expect((h.match(/미제안/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(h).toContain("결정론 초안");
    expect(h).toContain("시장 규모 $39.88B (2026)");
    expect(h).not.toContain("status-not-started"); // no headline grade chip without a grade
  });
  test("a legacy record (no direction_version) renders the definition paragraph and the hint, no <dl>", () => {
    const h = card({ definition: "국내 상장 로봇 부품사 전체", scope: "국내", min_long_list: 3 });
    expect(h).toContain("국내 상장 로봇 부품사 전체");
    expect(h).toContain("커버리지 범위:");
    expect(h).toContain("이전 형식 — 초안을 다시 만들면 방향성이 먼저 표시됩니다");
    expect(h).not.toContain("<dl");
  });
});

const uniReco = (over: Record<string, unknown> = {}) => ({
  source: "llm" as const,
  provider: "test",
  note: null,
  criteria: { industry: "", region: "", size: "", viability: "", rationale: "" },
  draft: { ...direction(), origin: "ai" as const, evidence, checks: {} },
  counts: { emptied_fields: 2, dropped_refs: 1, clamped: 3 },
  manifest: ["S1 시장분석 (고정 버전 v7)"],
  prompt_version: "s6.universe_criteria_draft@3",
  ...over,
});
const panelCtx = (over: Record<string, unknown> = {}) => ({
  uniReco: uniReco(),
  uniBusy: false,
  uniRecoApplied: false,
  setUniReco: noop,
  setUniRecoApplied: noop,
  generateUniReco: () => Promise.resolve(),
  applyUniReco: noop,
  ...over,
});
const panel = (over: Record<string, unknown> = {}, locale: "ko" | "en" = "ko") =>
  render(createElement(UniverseDraftPanel, { ctx: panelCtx(over) }), locale);

describe("UniverseDraftPanel — modal preview", () => {
  test("AI draft: proposal notice, counts, preview and the apply action", () => {
    const h = panel();
    expect(h).toContain("AI 제안 — 사람이 검토하고 저장해야 기록됩니다");
    expect(h).toContain("비운 항목 2건 · 제외한 인용 1건 · 줄인 문구 3건");
    expect(h).toContain("방향성 입력에 적용");
    expect(h).toContain(">결론</dt>");
    expect(h).not.toContain("rationale");
    expect(h).not.toMatch(/PASS|verified|검증됨/);
  });
  test("applied state flips the chip and the button text", () => {
    const h = panel({ uniRecoApplied: true });
    expect(h).toContain("status-green");
    expect(h).toContain("다시 적용");
  });
  test("no draft (no-grounding / parse failure): the note and a retry, no preview", () => {
    const h = panel({
      uniReco: uniReco({ draft: null, criteria: null, note: "근거 산출물이 없어 초안을 만들 수 없습니다" }),
    });
    expect(h).toContain("근거 산출물이 없어 초안을 만들 수 없습니다");
    expect(h).not.toContain(">결론</dt>");
    expect(h).toContain("다시 시도");
  });
  test("before generation only the generate button shows", () => {
    const h = panel({ uniReco: null });
    expect(h).toContain("방향성 초안 생성");
    expect(h).not.toContain("<dl");
  });
});

describe("UniverseDirectionFields — editable conclusion fields", () => {
  const fieldsHtml = (d: unknown) => render(createElement(UniverseDirectionFields, { draft: d, setDraft: noop }));
  const base = draftLib.draftFromView(
    {
      ...direction(),
      origin: "ai",
      evidence,
      checks: { clamped: [], dropped_refs: [], untraced_numbers: [], forbidden_phrases: [] },
    } as never,
    "s6.universe_criteria_draft@3",
    draftLib.emptyUniverseDraft(),
  );
  test("renders the editable fields with the caps and add/remove controls", () => {
    const h = fieldsHtml(base);
    expect(h).toContain('maxLength="90"');
    expect(h).toContain("범위 · 산업");
    expect(h).toContain("원전 기자재 제조");
    expect(h).toContain("단조 부품 업체");
    expect(h).toContain("삭제");
    expect(h).toContain("+ 우선");
  });
  test("the add control disappears at three lines", () => {
    const full = draftLib.addItem(draftLib.addItem(base, "prioritise"), "prioritise");
    expect(full.direction?.prioritise.length).toBe(3);
    expect(fieldsHtml(full)).not.toContain("+ 우선");
  });
  test("a legacy draft (no direction) renders nothing here", () => {
    expect(fieldsHtml(draftLib.emptyUniverseDraft())).toBe("");
  });
});

describe("universeDraft helpers — apply, edit, save", () => {
  const view = {
    ...direction(),
    origin: "ai" as const,
    evidence,
    checks: { clamped: [], dropped_refs: [], untraced_numbers: [], forbidden_phrases: [] },
  };
  const prev = { ...draftLib.emptyUniverseDraft(), min_long_list: "7" };
  const applied = draftLib.draftFromView(view as never, "s6.universe_criteria_draft@3", prev);

  test("applying fills the editable fields only; the minimum count stays", () => {
    expect(applied.min_long_list).toBe("7");
    expect(applied.direction?.headline.text).toContain("원자력");
    expect(applied.evidence as unknown).toEqual(evidence);
    expect(applied.origin).toEqual({ headline: "ai", scope: "ai", value_chain: "ai", prioritise: "ai", exclude: "ai" });
    expect(applied.drafted?.prompt_version).toBe("s6.universe_criteria_draft@3");
    // The transient server-only keys never reach the stored direction.
    expect(applied.direction).not.toHaveProperty("checks");
    expect(applied.direction).not.toHaveProperty("origin");
    expect(applied.direction).not.toHaveProperty("evidence");
  });
  test("definition is the labelled direction text, not the rationale", () => {
    const lines = applied.definition.split("\n");
    expect(lines[0]).toBe("결론: 원자력 발전소 미드스트림 기자재 공급 기업을 본다");
    expect(lines).toContain("산업: 원전 기자재 제조");
    expect(lines).toContain("지역: 국내·유럽");
    expect(lines.some((l) => l.startsWith("규모:"))).toBeFalse(); // empty size line is skipped
    expect(lines).toContain("가치사슬: 미드스트림 (기자재·부품 공급)");
    expect(lines).toContain("우선: 1) 단조 부품 업체 — S1 체인의 병목 단계");
    expect(lines).toContain("제외: 1) 원료 채굴 기업 — 체인 밖");
  });
  test("an edit flips only that group's origin to person and recomposes the definition", () => {
    const edited = draftLib.editText(applied, "region", "국내");
    expect(edited.origin.scope).toBe("person");
    expect(edited.origin.headline).toBe("ai");
    expect(edited.definition).toContain("지역: 국내");
    expect(edited.direction?.scope.region.refs).toEqual(["E3"]); // refs stay visible
    const listEdit = draftLib.editItem(applied, "exclude", 0, { why: "범위 밖" });
    expect(listEdit.origin.exclude).toBe("person");
    expect(listEdit.definition).toContain("제외: 1) 원료 채굴 기업 — 범위 밖");
  });
  test("list edits respect the cap of three and removal", () => {
    let d = applied;
    for (let i = 0; i < 5; i++) d = draftLib.addItem(d, "prioritise");
    expect(d.direction?.prioritise.length).toBe(draftLib.MAX_ITEMS);
    expect(draftLib.removeItem(d, "prioritise", 0).direction?.prioritise.length).toBe(2);
  });
  test("save sends definition first, then the direction keys; a legacy draft sends none", () => {
    const p = draftLib.savePayload(applied);
    expect(Object.keys(p)[0]).toBe("definition");
    expect(p.min_long_list).toBe(7);
    expect("financial_criteria" in p).toBe(false);
    expect(p.direction).toBeTruthy();
    expect(p.evidence).toEqual(evidence);
    expect((p.drafted as { prompt_version: string }).prompt_version).toBe("s6.universe_criteria_draft@3");
    const legacy = draftLib.savePayload({ ...draftLib.emptyUniverseDraft(), definition: "  국내 전체 " });
    expect(legacy.definition).toBe("국내 전체");
    expect(legacy).not.toHaveProperty("direction");
    expect(legacy).not.toHaveProperty("evidence");
  });
  test("draftFromSaved reads direction records back and leaves legacy records without a direction", () => {
    const saved = draftLib.draftFromSaved(universe() as never);
    expect(saved.direction?.headline.text).toContain("원자력");
    expect(saved.evidence.length).toBe(2);
    expect(saved.origin.headline).toBe("ai");
    const legacy = draftLib.draftFromSaved({ definition: "x", min_long_list: 3 } as never);
    expect(legacy.direction).toBeNull();
    expect(legacy.definition).toBe("x");
    expect(draftLib.draftFromSaved(null).min_long_list).toBe("5");
  });
});

describe("useBrownfieldUniverse wiring (source pins)", () => {
  const src = (rel: string) => readFileSync(`${import.meta.dir}/${WEB}/${rel}`, "utf8");
  const hook = src("components/stages/brownfield/useBrownfieldUniverse.tsx");
  test("apply and save go through the pure helpers; the form switches on the direction", () => {
    expect(hook).toContain("draftFromView(view, res.prompt_version, prev)");
    expect(hook).toContain("savePayload(universeDraft)");
    expect(hook).toContain("draftFromSaved(selected?.universe)");
    expect(hook).toContain("universeDraft.direction ?");
    expect(hook).toContain("UniverseDirectionFields");
    expect(hook).not.toContain("c.rationale");
  });
});

describe("label rename — 목표 시장 정의 → 평가 대상 방향성 (§7.3)", () => {
  const get = (c: Record<string, unknown>, path: string): string =>
    path.split(".").reduce((o, k) => (o as Record<string, unknown>)[k], c as unknown) as string;
  const KEYS: Array<[string, string, string]> = [
    ["common.editTargetMarketDefinition", "평가 대상 방향성 수정", "Edit evaluation target direction"],
    ["stages.s67.universeSection.targetMarketDefinition", "평가 대상 방향성", "Evaluation target direction"],
    ["stages.s67.universeSection.targetMarketDefinition2", "평가 대상 방향성", "Evaluation target direction"],
    [
      "stages.s67.universeSection.startTargetMarketDefinition",
      "평가 대상 방향성 정하기",
      "Set evaluation target direction",
    ],
    [
      "stages.s67.useBrownfieldUniverse.failedToSaveTheTarget",
      "평가 대상 방향성 저장 실패",
      "Failed to save the evaluation target direction",
    ],
    ["stages.s67.useBrownfieldUniverse.saveTargetMarket", "방향성 저장", "Save direction"],
    [
      "processBlockers.s6_target_universe",
      "평가 대상 방향성(Target Universe)",
      "Evaluation target direction (Target Universe)",
    ],
    ["stages.s67.directionCard.title", "평가 대상 방향성", "Evaluation target direction"],
  ];
  for (const [key, koVal, enVal] of KEYS) {
    test(`${key} is renamed in ko and en`, () => {
      expect(get(ko, key)).toBe(koVal);
      expect(get(en, key)).toBe(enVal);
    });
  }
  test("the reworded sentences quote the new button and label", () => {
    expect(get(ko, "stages.s67.discoveryPanels.inputsOnlyTheCandidateEligibility")).toContain('"방향성 저장"');
    expect(get(en, "stages.s67.discoveryPanels.inputsOnlyTheCandidateEligibility")).toContain('"save direction"');
    expect(get(ko, "stages.s67.discoveryPanels.noCandidatesToProposeRefine")).toContain("평가 대상 방향성을 구체화한");
    expect(get(en, "stages.s67.discoveryPanels.noCandidatesToProposeRefine")).toContain(
      "refine the evaluation target direction",
    );
  });
  test("no catalog value still carries the old label", () => {
    for (const c of [JSON.stringify(ko), JSON.stringify(en)]) {
      expect(c).not.toContain("목표 시장 정의");
      expect(c).not.toContain("목표 시장 저장");
      expect(c.toLowerCase()).not.toContain("target market definition");
    }
  });
  test("the S6 flow-banner tab label keeps the (Target Universe) parenthetical; the key is unchanged", async () => {
    const { stageArtifactLabel } = (await import(`${WEB}/lib/review/stage-artifact-labels.ts`)) as {
      stageArtifactLabel: (k: string) => string;
    };
    expect(stageArtifactLabel("stage:S6:1")).toBe("S6 평가 대상 방향성(Target Universe)");
  });
  test("directionCard keys have ko/en parity and are non-empty", () => {
    const flat = (o: unknown, p = ""): string[] =>
      typeof o === "object" && o !== null ? Object.entries(o).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p];
    const kk = flat(get(ko, "stages.s67.directionCard") as never).sort();
    const ek = flat(get(en, "stages.s67.directionCard") as never).sort();
    expect(kk).toEqual(ek);
    for (const k of kk) {
      expect(get(ko, `stages.s67.directionCard.${k}`).length).toBeGreaterThan(0);
      expect(get(en, `stages.s67.directionCard.${k}`).length).toBeGreaterThan(0);
    }
  });
});
