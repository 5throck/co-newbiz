// @version 1.0.0
/**
 * S6 bulk AI evaluation UI (ADR-0199, spec 2026-11-16-s6-bulk-ai-eval-versioning §10/§11 T16): rendered under
 * NextIntlClientProvider via renderToStaticMarkup (pattern: calibration-panel-render.test.ts). Pins: web evidence is
 * OFF by default and shows its MNPI warning only when checked; provisional chips are textually distinct from the
 * confirmed score; stale / non-DART / failed-code chips; the version comparison table; the confirm dialog item
 * lists; no longlist-wide confirm-all; ko + en key parity for every fixed API code.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

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
const active = (await import(`${WEB}/components/stages/brownfield/aiEvalActive.ts`)) as Record<string, Loose>;

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
    expect(html).toContain("AI 결과는 바로 판정에 반영되며, 사람이 항목별로 검토합니다");
    expect(html).not.toContain("판정 확정은 사람이 합니다");
  });
  test("checking web evidence shows the provider warning (ko + en)", () => {
    expect(startForm({ web_evidence: true })).toContain(ko.stages.s67.aiEval.webEvidenceWarning);
    expect(startForm({ web_evidence: true }, "en")).toContain("sent to the web search provider");
  });
});

describe("run-state chips (ADR-0200: no provisional chip layer)", () => {
  const view = (draft: unknown, dart: string | null = "00123456", active: string | null = null) =>
    render(createElement(chips.RunStateChips, { draft, dartCorpCode: dart, activeRunIds: active ? [active] : [] }));
  test("version history alone renders nothing: no AI 잠정 chip, no dashed draft chip, no v{n} 유지", () => {
    const html = view({ financial: chip(), technical: chip({ version_no: 2 }) });
    expect(html).toBe("");
    expect(html).not.toContain("AI 잠정");
    expect(html).not.toContain("ai-draft-chip");
  });
  test("non-DART candidate shows 확인 안됨 · DART 미등록", () => {
    expect(view({}, null)).toContain("확인 안됨 · DART 미등록");
  });
  test("failed item names the error code in friendly text", () => {
    const html = view({ financial: chip(), run_item: { run_id: "r1", state: "failed", error: "dart_error" } });
    expect(html).toContain("실패 · DART 조회 오류");
    expect(html).not.toContain("v3 유지");
    expect(view({ run_item: { run_id: "r1", state: "failed", error: "llm_error" } })).toContain("AI 응답 오류");
  });
  test("in-progress shows only for the active run", () => {
    const item = { run_id: "r1", state: "financial_sync", error: null };
    expect(view({ run_item: item }, "00123456", "r1")).toContain("진행 중");
    expect(view({ run_item: item }, "00123456", null)).not.toContain("진행 중");
  });
});

describe("row run progress chips (S1-style, live run item)", () => {
  const liveView = (draft: unknown, item: unknown, runActive: boolean, dart = "00123456") =>
    render(createElement(chips.RunStateChips, { draft, dartCorpCode: dart, live: { runActive, item } }));
  test("in-flight item shows 평가 진행 중 as a full phrase per state, with glyph + text marks", () => {
    const at = (state: string, over: Record<string, unknown> = {}) =>
      liveView(
        { financial: chip(), technical: chip() },
        { run_id: "r1", state, financial_outcome: null, technical_outcome: null, error_message: null, ...over },
        true,
      );
    const sync = at("financial_sync");
    expect(sync).toContain("평가 진행 중");
    expect(sync).toContain("DART 재무 동기화 중");
    expect(at("financial_draft")).toContain("재무 초안 작성 중");
    expect(at("financial_draft")).toContain("기술 초안 대기 중");
    const mid = at("technical_draft", { financial_outcome: "versioned" });
    expect(mid).toContain('<span aria-hidden="true">✓ </span>재무 초안 완료');
    expect(mid).toContain('<span aria-hidden="true">⋯ </span>기술 초안 작성 중(LLM 분석)');
    expect(at("versioning")).toContain("버전 기록 중");
    // The words are in the DOM text (not only a tooltip) and the chip is not truncated by an inline style.
    expect(mid).not.toContain("text-overflow");
    expect(mid).not.toContain("truncate");
  });
  test("phaseSegments: one full phrase per state, glyph + key", () => {
    const seg = (st: string) => active.phaseSegments(st).map((x: Loose) => `${x.glyph}${x.key}`);
    expect(seg("pending")).toEqual(["⋯pending"]);
    expect(seg("financial_sync")).toEqual(["⋯syncing"]);
    expect(seg("financial_draft")).toEqual(["⋯finDraft", "○techWait"]);
    expect(seg("technical_draft")).toEqual(["✓finDone", "⋯techDraft"]);
    expect(seg("versioning")).toEqual(["⋯versioning"]);
    expect(seg("done")).toEqual(["✓done"]);
    expect(seg("something_else")).toEqual(["⋯pending"]);
  });
  test("unchanged outcomes show 재평가 · 변경 없음, not silence", () => {
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
    expect(html).toContain("재평가 · 변경 없음");
    expect(html).not.toContain("유지)");
    const en_ = render(
      createElement(chips.RunStateChips, {
        draft: { financial: chip(), technical: chip() },
        dartCorpCode: "1",
        live: { runActive: false, item: { state: "done", financial_outcome: "unchanged", technical_outcome: null } },
      }),
      "en",
    );
    expect(en_).toContain("Re-evaluated · no change");
  });
  test("failed live item names the error", () => {
    const html = liveView(
      { financial: chip() },
      { run_id: "r1", state: "failed", financial_outcome: null, technical_outcome: null, error_message: "dart_error" },
      false,
    );
    expect(html).toContain("DART 조회 오류");
    expect(html).not.toContain("v3 유지");
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
const ver = (no: number, score: number | null, p: unknown, applied = 0, reviewed = 0) => ({
  id: `v${no}`,
  category: "financial",
  version_no: no,
  provisional_score: score,
  proposed_count: 2,
  unverified_count: 1,
  evidence_grade: "A",
  created_at: "2026-11-16T01:00:00Z",
  applied_count: applied,
  reviewed_count: reviewed,
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
    1,
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
    expect(html).toContain("점수");
    expect(html).not.toContain("잠정 점수");
    expect(html).toContain("(+12)");
    expect(html).toContain("적용 2건 · 사람 검토 1건");
  });
  test("per-item verdict text; changed cell is marked in text, unchanged is not", () => {
    expect(html).toContain("부분충족");
    expect(html).toContain("미충족");
    expect(html).toContain("확인 안됨");
    expect(html.match(/변경/g)?.length).toBe(1); // only c2 changed (v1 -> v2); oldest column never marked
  });
  test("each cell names its origin: 자동 규칙 (financial) / AI (technical) / 사람 (human item)", () => {
    const h = ver(2, 80, payload([["c1", "pass"]], [["c2", "pass"]]));
    const fin = render(createElement(panel.VersionTable, { category: "financial", versions: [h] }));
    expect(fin).toContain("자동 규칙 · 충족");
    expect(fin).toContain("사람 · 충족");
    const tech = render(createElement(panel.VersionTable, { category: "technical", versions: [h] }));
    expect(tech).toContain("AI · 충족");
  });
});

describe("version panel is a read-only audit history (no confirm path)", () => {
  const src = (f: string) => readFileSync(new URL(`${WEB}/components/stages/brownfield/${f}`, import.meta.url), "utf8");
  test("no confirm control, route call, confirm dialog or confirm-plan helper remains", () => {
    const vp = src("AiEvalVersionPanel.tsx");
    expect(vp).not.toMatch(/\/confirm|confirmVersion|AiEvalConfirmBody|buildConfirmPlan|onConfirmed|<button/);
    expect(src("LonglistSection.tsx")).not.toContain("/confirm");
    // the table markup moved to LonglistTable.tsx (split for the 400-line cap) — the guard follows it
    expect(src("LonglistTable.tsx")).not.toContain("/confirm");
    expect(existsSync(new URL(`${WEB}/components/stages/brownfield/AiEvalRowConfirm.tsx`, import.meta.url))).toBe(
      false,
    );
    expect(types.buildConfirmPlan).toBeUndefined();
    expect(dialogs.AiEvalConfirmBody).toBeUndefined();
  });
  test("catalogs carry no confirm / provisional wording any more", () => {
    const flat = JSON.stringify(ko.stages.s67.aiEval);
    for (const w of [
      "제안 확정",
      "전체 확정",
      "AI 잠정",
      "판정 확정은 사람이 합니다",
      "rowConfirm",
      "confirmVersion",
    ]) {
      expect(flat).not.toContain(w);
    }
    expect(JSON.stringify(en.stages.s67.aiEval)).not.toContain("provisional draft");
  });
  test("the longlist drives promotion from the explicit complete flag, never from AI verdicts alone", () => {
    // the table markup lives in LonglistTable.tsx (split from LonglistSection.tsx for the 400-line cap)
    expect(src("LonglistTable.tsx")).toContain(
      'canPromote = tgt.status === "pending" && tgt.eval_summary?.complete === true',
    );
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
