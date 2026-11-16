// @version 1.0.0
/**
 * S6 bulk AI evaluation UI (ADR-0199, spec 2026-11-16-s6-bulk-ai-eval-versioning §10/§11 T16): rendered under
 * NextIntlClientProvider via renderToStaticMarkup (pattern: calibration-panel-render.test.ts). Pins: web evidence is
 * OFF by default and shows its MNPI warning only when checked; provisional chips are textually distinct from the
 * confirmed score; stale / non-DART / failed-code chips; the version comparison table; the confirm dialog item
 * lists; no longlist-wide confirm-all; ko + en key parity for every fixed API code.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// biome-ignore lint/suspicious/noExplicitAny: test reads untyped module namespaces and JSON catalogs
type Loose = any;

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
const ko = (await import(`${WEB}/locales/ko.json`)).default as Record<string, Loose>;
const en = (await import(`${WEB}/locales/en.json`)).default as Record<string, Loose>;
const chips = (await import(`${WEB}/components/stages/brownfield/AiEvalChips.tsx`)) as Record<string, Loose>;
const dialogs = (await import(`${WEB}/components/stages/brownfield/AiEvalDialogs.tsx`)) as Record<string, Loose>;
const panel = (await import(`${WEB}/components/stages/brownfield/AiEvalVersionPanel.tsx`)) as Record<string, Loose>;
const types = (await import(`${WEB}/components/stages/brownfield/aiEvalTypes.ts`)) as Record<string, Loose>;

const render = (el: unknown, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date("2026-11-16T00:00:00Z"), timeZone: "Asia/Seoul" },
      el,
    ),
  );

const chip = (over: Record<string, unknown> = {}) => ({
  version_no: 3,
  created_at: "2026-11-16T01:00:00Z",
  checked_at: "2026-11-16T01:00:00Z",
  provisional_score: 72,
  stale: false,
  evidence_grade: "A",
  ...over,
});
const noop = () => {};
const startForm = (value: Record<string, unknown>, locale: "ko" | "en" = "ko") =>
  render(
    createElement(dialogs.AiEvalStartForm, {
      value: { categories: "both", web_evidence: false, force_refresh: false, ...value },
      onChange: noop,
      stats: { candidates: 20, dartEligible: 15, estimatedCalls: 210 },
      busy: false,
      onSubmit: noop,
      onCancel: noop,
    }),
    locale,
  );

describe("start dialog", () => {
  test("web evidence and force refresh are OFF by default; no warning is shown", () => {
    const html = startForm({});
    expect(html).toContain("웹 검색 근거 포함");
    expect(html).toContain("DART 최신 재조회");
    // Only the default category radio is checked; both opt-in checkboxes are unchecked.
    expect(html.match(/<input type="checkbox"[^>]*>/g)).toEqual([
      '<input type="checkbox"/>',
      '<input type="checkbox"/>',
    ]);
    expect(html).not.toContain(ko.stages.s67.aiEval.webEvidenceWarning);
    expect(html).toContain("판정 확정은 사람이 합니다");
  });
  test("checking web evidence shows the provider warning (ko + en)", () => {
    expect(startForm({ web_evidence: true })).toContain(ko.stages.s67.aiEval.webEvidenceWarning);
    expect(startForm({ web_evidence: true }, "en")).toContain("sent to the web search provider");
  });
});

describe("provisional chips", () => {
  const view = (draft: unknown, dart: string | null = "00123456", active: string | null = null) =>
    render(createElement(chips.ProvisionalChips, { draft, dartCorpCode: dart, activeRunId: active }));
  test("chip carries the literal AI 잠정 text, an icon with a text label, and the dashed-outline class", () => {
    const html = view({ financial: chip(), technical: chip({ provisional_score: 55, version_no: 2 }) });
    expect(html).toContain("AI 잠정 재무 72 · v3");
    expect(html).toContain("AI 잠정 기술 55 · v2");
    // Compact: the long explanation and date live in the tooltip, not in the visible chip text.
    expect(html).toContain('title="AI 잠정 초안 (사람 판정 전) · ');
    expect(html).not.toContain("AI 잠정 v3 ·");
    expect(html).toContain("ai-draft-chip");
    expect(html).toContain("AI 잠정 초안 (사람 판정 전)");
    expect(html).toContain("재무");
    expect(html).toContain("72");
    expect(html).toContain('aria-hidden="true">✎');
  });
  test("score-less draft shows unverified counts, never a bare dash", () => {
    const draft = { technical: chip({ provisional_score: null, proposed_count: 0, unverified_count: 10 }) };
    const html = view(draft);
    expect(html).toContain("AI 잠정 기술 · 확인 안됨 10/10 · v3");
    expect(html).not.toContain("기술 —");
    const en_ = render(createElement(chips.ProvisionalChips, { draft, dartCorpCode: "1" }), "en");
    expect(en_).toContain("unverified 10/10");
  });
  test("chips sit on one wrapping line (no stacked column)", () => {
    expect(view({ financial: chip(), technical: chip() })).toContain("flex flex-wrap gap-1 mt-1");
  });
  test("a confirmed score chip is not produced by the provisional chips (separate row)", () => {
    expect(view({ financial: chip() })).not.toContain("status-green");
  });
  test("stale chip reads 갱신 권장 as text", () => {
    expect(view({ financial: chip({ stale: true }) })).toContain("갱신 권장");
    expect(view({ financial: chip() })).not.toContain("갱신 권장");
  });
  test("non-DART candidate shows 확인 안됨 · DART 미등록 with no draft chip", () => {
    const html = view({}, null);
    expect(html).toContain("확인 안됨 · DART 미등록");
    expect(html).not.toContain("ai-draft-chip");
  });
  test("failed item keeps the previous version and names the error code in friendly text", () => {
    const html = view({ financial: chip(), run_item: { run_id: "r1", state: "failed", error: "dart_error" } });
    expect(html).toContain("v3 유지");
    expect(html).toContain("DART 조회 오류");
    expect(html).toContain("AI 잠정 재무 72 · v3");
    const nov = view({ run_item: { run_id: "r1", state: "failed", error: "llm_error" } });
    expect(nov).toContain("AI 응답 오류");
  });
  test("in-progress shows only for the active run", () => {
    const item = { run_id: "r1", state: "financial_sync", error: null };
    expect(view({ run_item: item }, "00123456", "r1")).toContain("진행 중");
    expect(view({ run_item: item }, "00123456", null)).not.toContain("진행 중");
  });
});

describe("row run progress chips (S1-style, live run item)", () => {
  const liveView = (draft: unknown, item: unknown, runActive: boolean, dart = "00123456") =>
    render(createElement(chips.ProvisionalChips, { draft, dartCorpCode: dart, live: { runActive, item } }));
  test("in-flight item shows 평가 진행 중 with per-category marks and 이전 버전 유지", () => {
    const html = liveView(
      { financial: chip(), technical: chip() },
      { run_id: "r1", state: "financial_sync", financial_outcome: null, technical_outcome: null, error_message: null },
      true,
    );
    expect(html).toContain("평가 진행 중");
    expect(html).toContain("재무");
    expect(html).toContain("기술");
    expect(html).toContain("대기");
    expect(html).toContain("이전 버전 유지");
    const mid = liveView(
      { financial: chip(), technical: chip() },
      {
        run_id: "r1",
        state: "technical_draft",
        financial_outcome: "versioned",
        technical_outcome: null,
        error_message: null,
      },
      true,
    );
    expect(mid).toContain('재무 <span aria-hidden="true">✓</span>');
    expect(mid).toContain('기술 <span aria-hidden="true">…</span>');
  });
  test("unchanged outcomes show 재평가 · 변경 없음 (v{n} 유지) per category, not silence", () => {
    const html = liveView(
      { financial: chip(), technical: chip({ version_no: 4 }) },
      {
        run_id: "r1",
        state: "done",
        financial_outcome: "unchanged",
        technical_outcome: "unchanged",
        error_message: null,
      },
      false,
    );
    expect(html).toContain("재평가 · 변경 없음 (v3 유지)");
    expect(html).toContain("재평가 · 변경 없음 (v4 유지)");
    const en_ = render(
      createElement(chips.ProvisionalChips, {
        draft: { financial: chip(), technical: chip() },
        dartCorpCode: "1",
        live: { runActive: false, item: { state: "done", financial_outcome: "unchanged", technical_outcome: null } },
      }),
      "en",
    );
    expect(en_).toContain("no change (v3 kept)");
  });
  test("failed live item names the error and keeps the previous version", () => {
    const html = liveView(
      { financial: chip() },
      { run_id: "r1", state: "failed", financial_outcome: null, technical_outcome: null, error_message: "dart_error" },
      false,
    );
    expect(html).toContain("DART 조회 오류");
    expect(html).toContain("v3 유지");
  });
  test("categoryMarks helper", () => {
    expect(chips.categoryMarks("financial_sync", null, null)).toEqual({ financial: "waiting", technical: "waiting" });
    expect(chips.categoryMarks("technical_draft", "versioned", null)).toEqual({
      financial: "done",
      technical: "waiting",
    });
    expect(chips.categoryMarks("done", "unchanged", "unchanged")).toEqual({ financial: "done", technical: "done" });
  });
});

describe("progress panel budget line", () => {
  const prog = (budget: { calls: number; budget: number; reserve: number } | null) =>
    render(
      createElement(chips.AiEvalProgress, {
        view: {
          run: {
            id: "r1",
            status: "running",
            total_targets: 2,
            pause_reason: null,
            error_message: null,
            web_evidence: 0,
            force_refresh: 0,
          },
          items: [],
          progress: { done: 1, total: 2 },
          budget,
        } as never,
        canAct: true,
        busy: false,
        onResume: () => {},
        onCancel: () => {},
      }),
    );
  test("shows DART 조회 {used}/{est} when the payload carries budget data; absent when not", () => {
    expect(prog({ calls: 12, budget: 40, reserve: 5 })).toContain("DART 조회 12/40");
    expect(prog(null)).not.toContain("DART 조회");
  });
});

const payload = (items: Array<[string, string | null]>, human: Array<[string, string]> = []) => ({
  criteria_snapshot: [
    { criterion_id: "c1", label: "매출 CAGR" },
    { criterion_id: "c2", label: "영업이익률" },
    { criterion_id: "c3", label: "R&D 투자" },
  ],
  items: items.map(([criterion_id, proposed_status]) => ({ criterion_id, proposed_status })),
  human_items: human.map(([criterion_id, status]) => ({ criterion_id, status })),
});
const ver = (no: number, score: number | null, p: unknown, confirmed = 0) => ({
  id: `v${no}`,
  category: "financial",
  version_no: no,
  provisional_score: score,
  proposed_count: 2,
  unverified_count: 1,
  evidence_grade: "A",
  created_at: "2026-11-16T01:00:00Z",
  confirmed_count: confirmed,
  payload: p,
});

describe("version comparison table", () => {
  const v2 = ver(
    2,
    72,
    payload([
      ["c1", "pass"],
      ["c2", "partial"],
      ["c3", null],
    ]),
    2,
  );
  const v1 = ver(
    1,
    60,
    payload([
      ["c1", "pass"],
      ["c2", "fail"],
      ["c3", null],
    ]),
  );
  const html = render(createElement(panel.VersionTable, { category: "financial", versions: [v2, v1] }));
  test("columns newest first with score row and delta", () => {
    expect(html.indexOf("v2")).toBeLessThan(html.indexOf("v1"));
    expect(html).toContain("잠정 점수");
    expect(html).toContain("(+12)");
    expect(html).toContain("확정 근거 2건");
  });
  test("per-item verdict text; changed cell is marked in text, unchanged is not", () => {
    expect(html).toContain("부분충족");
    expect(html).toContain("미충족");
    expect(html).toContain("확인 안됨");
    expect(html.match(/변경/g)?.length).toBe(1); // only c2 changed (v1 -> v2); oldest column never marked
  });
  test("human-judged cell is labelled 사람 판정", () => {
    const h = ver(2, 80, payload([["c1", "pass"]], [["c2", "pass"]]));
    const out = render(createElement(panel.VersionTable, { category: "financial", versions: [h] }));
    expect(out).toContain("사람 판정");
  });
});

describe("confirm dialog", () => {
  const plan = types.buildConfirmPlan(
    payload(
      [
        ["c1", "pass"],
        ["c2", null],
        ["c3", "fail"],
      ],
      [["c2", "pass"]],
    ),
  );
  test("plan separates written, human-judged and unverified items", () => {
    expect(plan.write.map((w: Loose) => w.criterion_id)).toEqual(["c1", "c3"]);
    expect(plan.skippedHuman.map((w: Loose) => w.criterion_id)).toEqual(["c2"]);
    expect(plan.skippedUnverified).toEqual([]);
    const p2 = types.buildConfirmPlan(
      payload([
        ["c1", null],
        ["c2", "pass"],
      ]),
    );
    expect(p2.skippedUnverified.map((w: Loose) => w.criterion_id)).toEqual(["c1"]);
  });
  const html = render(
    createElement(dialogs.AiEvalConfirmBody, {
      versionNo: 3,
      plan,
      statusLabel: (s: string) => ko.stages.s67.aiEval.verdict[s],
      busy: false,
      onSubmit: noop,
      onCancel: noop,
    }),
  );
  test("lists items to write and skipped items, with the human-confirms notice", () => {
    expect(html).toContain("기록할 항목 (2)");
    expect(html).toContain("매출 CAGR");
    expect(html).toContain("충족");
    expect(html).toContain("건너뛸 항목 — 사람이 이미 판정 (1)");
    expect(html).toContain("영업이익률");
    expect(html).toContain("판정 확정은 사람이 합니다");
    expect(html).toContain("2건 확정");
  });
});

describe("no confirm-all, provisional isolation", () => {
  const long = readFileSync(
    new URL(`${WEB}/components/stages/brownfield/LonglistSection.tsx`, import.meta.url),
    "utf8",
  );
  test("no longlist-wide confirm action exists in code or catalogs", () => {
    expect(JSON.stringify(ko.stages.s67.aiEval)).not.toContain("전체 확정");
    expect(JSON.stringify(en.stages.s67.aiEval).toLowerCase()).not.toContain("confirm all");
    expect(long).not.toContain("/confirm");
    expect(
      readFileSync(new URL(`${WEB}/components/stages/brownfield/AiEvalVersionPanel.tsx`, import.meta.url), "utf8"),
    ).toMatch(/eval-draft-versions\/\$\{[^}]*\}\/confirm/);
  });
  test("provisional chips never feed rank, promotion or confirmed counts", () => {
    expect(long).not.toMatch(/eval_draft[^\n]*(evalRank|canPromote|combined|complete)/);
    expect(long).toContain('canPromote = tgt.status === "pending" && tgt.eval_summary?.complete === true');
  });
});

describe("i18n parity", () => {
  const flat = (o: Loose, p = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  test("ko and en carry identical aiEval key sets with non-empty values", () => {
    expect(flat(en.stages.s67.aiEval).sort()).toEqual(flat(ko.stages.s67.aiEval).sort());
    for (const k of flat(ko.stages.s67.aiEval)) {
      const get = (o: Loose) => k.split(".").reduce((a, c) => a?.[c], o);
      expect(String(get(ko.stages.s67.aiEval)).length).toBeGreaterThan(0);
      expect(String(get(en.stages.s67.aiEval)).length).toBeGreaterThan(0);
    }
  });
  test("every fixed API code has friendly text in both locales", () => {
    for (const c of types.KNOWN_ITEM_CODES) {
      expect(ko.stages.s67.aiEval.itemErrors[c]).toBeTruthy();
      expect(en.stages.s67.aiEval.itemErrors[c]).toBeTruthy();
    }
    for (const c of types.KNOWN_PAUSE_REASONS) {
      expect(ko.stages.s67.aiEval.pauseReason[c]).toBeTruthy();
      expect(en.stages.s67.aiEval.pauseReason[c]).toBeTruthy();
    }
    for (const c of types.KNOWN_CALL_ERRORS) {
      expect(ko.stages.s67.aiEval.callErrors[c]).toBeTruthy();
      expect(en.stages.s67.aiEval.callErrors[c]).toBeTruthy();
    }
  });
  test("progress panel renders paused-budget and interrupted states with resume", () => {
    const base = { progress: { done: 3, total: 10 }, budget: { calls: 0, budget: 1, reserve: 0 }, items: [] };
    const run = (status: string, extra = {}) => ({
      id: "r1",
      status,
      total_targets: 10,
      pause_reason: null,
      error_message: null,
      web_evidence: 0,
      force_refresh: 0,
      ...extra,
    });
    const r = (view: unknown) =>
      render(createElement(chips.AiEvalProgress, { view, canAct: true, busy: false, onResume: noop, onCancel: noop }));
    const paused = r({ ...base, run: run("paused_budget", { pause_reason: "dart_budget_reserve" }) });
    expect(paused).toContain("DART 일일 한도 보호로 일시 정지 — 3/10 완료");
    expect(paused).toContain("이어서 실행");
    expect(paused).toContain('aria-live="polite"');
    expect(r({ ...base, run: run("interrupted") })).toContain("중단됨");
    expect(r({ ...base, run: run("running") })).not.toContain("이어서 실행");
    expect(r({ ...base, run: run("completed") })).toBe("");
  });
});
