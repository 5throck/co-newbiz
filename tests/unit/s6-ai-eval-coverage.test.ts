// @version 1.0.0
/** S6 coverage markers and untruncated progress wording (ADR-0199, 2026-11-16 user report): a score computed from a
 * few judged items must show how many were judged; progress states are full phrases with elapsed time; none of it is
 * cut by CSS or tooltip-only. Static-render pattern as s6-ai-eval-render.test.ts. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// biome-ignore lint/suspicious/noExplicitAny: test reads untyped module namespaces and JSON catalogs
type Loose = any;
const WEB = "../../app/web-next";
const DIR = `${import.meta.dir}/../../app/web-next/components/stages/brownfield`;
const { renderToStaticMarkup } = (await import(`${WEB}/node_modules/react-dom/server.js`)) as Loose;
const { createElement } = (await import(`${WEB}/node_modules/react/index.js`)) as Loose;
const { NextIntlClientProvider } = (await import(`${WEB}/node_modules/next-intl`)) as Loose;
const ko = (await import(`${WEB}/locales/ko.json`)).default as Record<string, Loose>;
const en = (await import(`${WEB}/locales/en.json`)).default as Record<string, Loose>;
const active = (await import(`${WEB}/components/stages/brownfield/aiEvalActive.ts`)) as Loose;
const chips = (await import(`${WEB}/components/stages/brownfield/AiEvalChips.tsx`)) as Loose;
const cov = (await import(`${WEB}/components/stages/brownfield/AiEvalCoverage.tsx`)) as Loose;
const phase = (await import(`${WEB}/components/stages/brownfield/AiEvalPhase.tsx`)) as Loose;
const rules = (await import(`${WEB}/components/stages/brownfield/AiEvalCriteriaRules.tsx`)) as Loose;
const vp = (await import(`${WEB}/components/stages/brownfield/AiEvalVersionPanel.tsx`)) as Loose;

const render = (el: unknown, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date("2026-11-16T00:00:00Z"), timeZone: "Asia/Seoul" },
      el,
    ),
  );

describe("coverage helpers", () => {
  test("weightCoverage: judged over total weight, partial only when judged < total, null without weights", () => {
    expect(active.weightCoverage({ scoredWeight: 30, totalWeight: 100 })).toEqual({
      scored: 30,
      total: 100,
      partial: true,
    });
    expect(active.weightCoverage({ scoredWeight: 100, totalWeight: 100 })).toEqual({
      scored: 100,
      total: 100,
      partial: false,
    });
    expect(active.weightCoverage({ scoredWeight: 0, totalWeight: 0 })).toBeNull();
    expect(active.weightCoverage({})).toBeNull();
    expect(active.weightCoverage(undefined)).toBeNull();
  });
  test("draftCoverage: judged = proposed, total = proposed + unverified, null when counts are absent", () => {
    expect(active.draftCoverage({ proposed_count: 3, unverified_count: 7 })).toEqual({ judged: 3, total: 10 });
    expect(active.draftCoverage({ proposed_count: 0, unverified_count: 0 })).toBeNull();
    expect(active.draftCoverage({})).toBeNull();
  });
  test("elapsedParts and parseUtcMs", () => {
    expect(active.elapsedParts(42_000)).toMatchObject({ unit: "s", s: 42 });
    expect(active.elapsedParts(65_000)).toMatchObject({ unit: "ms", m: 1, s: 5 });
    expect(active.elapsedParts(3_725_000)).toMatchObject({ unit: "hm", h: 1, m: 2 });
    expect(active.elapsedParts(-5)).toMatchObject({ unit: "s", s: 0 });
    expect(active.parseUtcMs("2026-11-16T00:00:00Z")).toBe(Date.parse("2026-11-16T00:00:00Z"));
    expect(active.parseUtcMs("2026-11-16 00:00:00")).toBe(Date.parse("2026-11-16T00:00:00Z"));
    expect(active.parseUtcMs(null)).toBeNull();
    expect(active.parseUtcMs("garbage")).toBeNull();
  });
});

describe("a. provisional chips show judged/total items", () => {
  const chip = (over: Record<string, unknown> = {}) => ({
    version_no: 3,
    created_at: "2026-11-16T01:00:00Z",
    checked_at: "2026-11-16T01:00:00Z",
    provisional_score: 50,
    stale: false,
    evidence_grade: "A",
    ...over,
  });
  const view = (c: unknown, locale: "ko" | "en" = "ko") =>
    render(createElement(chips.ProvisionalChips, { draft: { technical: c }, dartCorpCode: "00123456" }), locale);
  test("score with counts: AI 잠정 기술 50 · 판정 3/10 항목 · v3", () => {
    const html = view(chip({ proposed_count: 3, unverified_count: 7 }));
    expect(html).toContain("AI 잠정 기술 50 · 판정 3/10 항목 · v3");
    expect(view(chip({ proposed_count: 3, unverified_count: 7 }), "en")).toContain("judged 3/10 items");
  });
  test("fully judged still shows the count; counts absent keep the old wording; null score keeps 확인 안됨", () => {
    expect(view(chip({ proposed_count: 10, unverified_count: 0 }))).toContain("판정 10/10 항목");
    expect(view(chip())).toContain("AI 잠정 기술 50 · v3");
    expect(view(chip())).not.toMatch(/판정 \d/);
    expect(view(chip({ provisional_score: null, proposed_count: 0, unverified_count: 10 }))).toContain(
      "AI 잠정 기술 · 확인 안됨 10/10 · v3",
    );
  });
});

describe("b + c. confirmed chips and rank cell", () => {
  const sum = (over: Record<string, unknown> = {}) => ({
    financial: { score: 80, scoredWeight: 60, totalWeight: 60, excludedWeight: 0 },
    technical: { score: 50, scoredWeight: 30, totalWeight: 100, excludedWeight: 0 },
    combined: 65,
    complete: false,
    ...over,
  });
  const chipsHtml = (s: unknown, locale: "ko" | "en" = "ko") =>
    render(createElement(cov.ConfirmedScoreChips, { summary: s }), locale);
  test("partial category: score, judged weight over total, and the 일부 항목 미평가 marker as text", () => {
    const html = chipsHtml(sum());
    expect(html).toContain("기술 50 · 평가 30/100");
    expect(html).toContain("기술 일부 항목 미평가");
    expect(html).toContain("재무 80 · 평가 60/60");
    expect(html).not.toContain("재무 일부 항목 미평가"); // the fully judged category has no marker
    expect(html).toContain('aria-hidden="true">⚠ ');
    expect(chipsHtml(sum(), "en")).toContain("Technology"[0] === "T" ? "Judged 30/100" : "");
    expect(chipsHtml(sum(), "en")).toContain("some items not evaluated");
  });
  test("complete evaluation shows coverage numbers but no partial marker", () => {
    const html = chipsHtml(
      sum({
        technical: { score: 90, scoredWeight: 100, totalWeight: 100, excludedWeight: 0 },
        complete: true,
      }),
    );
    expect(html).toContain("기술 90 · 평가 100/100");
    expect(html).not.toContain("일부 항목 미평가");
  });
  test("no weights (older payload) or nothing judged: no coverage text, no crash", () => {
    const old = chipsHtml({ financial: { score: 70 }, technical: { score: null }, combined: 70 });
    expect(old).toContain("재무 70");
    expect(old).not.toMatch(/평가 \d+\/\d+/);
    expect(old).not.toContain("일부 항목 미평가");
    expect(chipsHtml(undefined)).toContain("재무 —");
  });
  test("the chip row wraps (no clipped chips at the 730 px pane)", () => {
    expect(readFileSync(`${DIR}/AiEvalCoverage.tsx`, "utf8")).toContain("flex flex-wrap");
  });
  test("rank marker: only when the summary is explicitly incomplete and has a combined score", () => {
    const m = (s: unknown, locale: "ko" | "en" = "ko") =>
      render(createElement(cov.RankPartialMarker, { summary: s }), locale);
    expect(m(sum())).toContain("일부 항목 미평가 · 잠정");
    expect(m(sum(), "en")).toContain("Some items not evaluated · provisional");
    expect(m(sum({ complete: true }))).toBe("");
    expect(m(sum({ complete: undefined }))).toBe("");
    expect(m(sum({ combined: null }))).toBe("");
    expect(m(undefined)).toBe("");
  });
  test("the longlist renders both from eval_summary", () => {
    const src = readFileSync(`${DIR}/LonglistSection.tsx`, "utf8");
    expect(src).toContain("<ConfirmedScoreChips summary={es} />");
    expect(src).toContain("<RankPartialMarker summary={es} />");
  });
});

describe("d. version comparison shows judged n/m and not-evaluated k", () => {
  const ver = (no: number, proposed: number, unverified: number) => ({
    id: `v${no}`,
    category: "technical",
    version_no: no,
    provisional_score: 50,
    proposed_count: proposed,
    unverified_count: unverified,
    evidence_grade: "C",
    created_at: "2026-11-16T00:00:00Z",
    confirmed_count: 0,
    payload: { criteria_snapshot: [], items: [], human_items: [] },
  });
  test("per version column in the score row", () => {
    const html = render(
      createElement(vp.VersionTable, { category: "technical", versions: [ver(2, 3, 7), ver(1, 10, 0)] }),
    );
    expect(html).toContain("판정 3/10 · 미평가 7");
    expect(html).toContain("판정 10/10 · 미평가 0");
    expect(render(createElement(vp.VersionTable, { category: "technical", versions: [ver(1, 3, 7)] }), "en")).toContain(
      "Judged 3/10 · not evaluated 7",
    );
  });
});

describe("e. score explanation states what a score covers", () => {
  test("ko + en sentence in the criteria modal explanation", () => {
    expect(render(createElement(rules.ScoreExplanation, {}))).toContain(
      "확인 안됨·미판정 항목은 충족으로도 미충족으로도 세지 않으므로",
    );
    expect(render(createElement(rules.ScoreExplanation, {}), "en")).toContain(
      "count neither as passes nor as failures",
    );
  });
});

describe("progress panel: names, full step, elapsed time, cancel, nothing truncated", () => {
  const view = (over: Record<string, unknown> = {}, items?: unknown[]) => ({
    run: {
      id: "r1",
      status: "running",
      total_targets: 1,
      pause_reason: null,
      error_message: null,
      web_evidence: 0,
      force_refresh: 0,
      started_at: "2026-11-16T00:00:00Z",
      ...over,
    },
    items: items ?? [
      {
        id: "i1",
        brownfield_target_id: "t1",
        company_name: "삼미금속",
        seq: 0,
        state: "technical_draft",
        financial_outcome: "versioned",
        technical_outcome: null,
        error_message: null,
      },
    ],
    progress: { done: 0, total: 1 },
    budget: { calls: 0, budget: 0, reserve: 0 },
  });
  const prog = (v: unknown, nowMs = Date.parse("2026-11-16T00:01:05Z"), locale: "ko" | "en" = "ko") =>
    render(
      createElement(chips.AiEvalProgress, {
        view: v,
        canAct: true,
        busy: false,
        onResume: () => {},
        onCancel: () => {},
        nowMs,
      }),
      locale,
    );
  test("candidate, the step as a full phrase, progress count, elapsed 1분 05초 and a cancel button", () => {
    const html = prog(view());
    expect(html).toContain("<strong>삼미금속</strong> — ");
    expect(html).toContain("재무 초안 완료");
    expect(html).toContain("기술 초안 작성 중(LLM 분석)");
    expect(html).toContain("진행 0/1");
    expect(html).toContain("경과 1분 05초");
    expect(html).toContain('aria-label="삼미금속 평가 중단"');
    expect(html).toContain(">중단</button>");
  });
  test("elapsed formats: seconds, hours, en", () => {
    expect(prog(view(), Date.parse("2026-11-16T00:00:42Z"))).toContain("경과 42초");
    expect(prog(view(), Date.parse("2026-11-16T01:02:03Z"))).toContain("경과 1시간 02분");
    expect(prog(view(), Date.parse("2026-11-16T00:01:05Z"), "en")).toContain("Elapsed 1m 05s");
  });
  test("a run without started_at simply omits the elapsed time", () => {
    expect(prog(view({ started_at: undefined }))).not.toContain("경과");
  });
  test("a bulk run names the in-flight candidate and how many more", () => {
    const item = (id: string, state: string) => ({
      id,
      brownfield_target_id: id,
      company_name: `회사${id}`,
      seq: 0,
      state,
      financial_outcome: null,
      technical_outcome: null,
      error_message: null,
    });
    const html = prog(
      view({ total_targets: 3 }, [item("a", "done"), item("b", "financial_sync"), item("c", "pending")]),
    );
    expect(html).toContain("회사b 외 2곳");
    expect(html).toContain("DART 재무 동기화 중");
  });
  test("ElapsedTime renders nothing without a parsable start", () => {
    expect(render(createElement(phase.ElapsedTime, { startedAt: null, nowMs: 1 }))).toBe("");
  });
});

describe("no truncation source on the evaluation progress UI", () => {
  const css = readFileSync(`${import.meta.dir}/../../app/web-next/app/styles.css`, "utf8");
  const rule = (sel: string) => {
    const i = css.indexOf(`${sel} {`);
    return i < 0 ? "" : css.slice(i, css.indexOf("}", i));
  };
  test("chip rules wrap and never clip", () => {
    for (const sel of [".ai-draft-chip", ".longlist-table .ai-draft-chip", ".ai-eval-progress"]) {
      const r = rule(sel);
      expect(r).not.toBe("");
      expect(r).not.toContain("nowrap");
      expect(r).not.toContain("ellipsis");
      expect(r).not.toMatch(/overflow:\s*hidden/);
      expect(r).not.toContain("line-clamp");
    }
    expect(rule(".ai-draft-chip")).toContain("white-space: normal");
  });
  test("the <=640px nowrap rule for table chips is overridden for the longlist", () => {
    expect(css).toMatch(/\.table-scroll \.longlist-table \.status-chip[^{]*\{[^}]*white-space: normal/);
  });
  test("components use no truncate / clamp / ellipsis on progress or coverage text", () => {
    for (const f of ["AiEvalChips.tsx", "AiEvalPhase.tsx", "AiEvalCoverage.tsx"]) {
      const src = readFileSync(`${DIR}/${f}`, "utf8");
      expect(src).not.toMatch(/className="[^"]*(truncate|line-clamp|cell-clamp)|text-overflow|textOverflow/);
    }
  });
});

test("ko/en parity for the coverage and progress keys", () => {
  const flat = (o: Loose, p = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  expect(flat(en.stages.s67.aiEval).sort()).toEqual(flat(ko.stages.s67.aiEval).sort());
  for (const k of [
    "chipScoreCoverage",
    "coverageWeight",
    "coveragePartial",
    "coverageRankPartial",
    "versionCoverage",
    "runCount",
    "elapsed",
    "runNames",
  ]) {
    expect(ko.stages.s67.aiEval[k]).toBeTruthy();
    expect(en.stages.s67.aiEval[k]).toBeTruthy();
  }
});
