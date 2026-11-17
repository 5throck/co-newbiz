// @version 1.0.0
/** S6 AI evaluation queue UI (ADR-0200 part B, design 2026-11-17 §10.9 / TB11): the summary line in full wording, row
 * states identical for bulk and single runs, 대기 취소, skipped / cancelled rows, the start notice and estimate, the
 * ko/en parity and the removal of the frontend concurrency gating. Static-render pattern of s6-ai-eval-render.test.ts. */
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
const q = (await import(`${WEB}/components/stages/brownfield/aiEvalQueueState.ts`)) as Loose;
const active = (await import(`${WEB}/components/stages/brownfield/aiEvalActive.ts`)) as Loose;
const panel = (await import(`${WEB}/components/stages/brownfield/AiEvalQueuePanel.tsx`)) as Loose;
const chips = (await import(`${WEB}/components/stages/brownfield/AiEvalChips.tsx`)) as Loose;
const hook = (await import(`${WEB}/components/stages/brownfield/useAiEval.ts`)) as Loose;

const render = (el: unknown, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale, messages: locale === "ko" ? ko : en, timeZone: "Asia/Seoul" }, el),
  );
/** Real translator over the catalog, for the pure formatters. */
const tr =
  (locale: "ko" | "en" = "ko") =>
  (key: string, values: Record<string, string | number> = {}): string => {
    const node = key.split(".").reduce((o: Loose, k) => o?.[k], (locale === "ko" ? ko : en).stages.s67.aiEval);
    return String(node).replace(/\{(\w+)\}/g, (_, n) => String(values[n]));
  };

const item = (id: string, state: string, over: Record<string, unknown> = {}) => ({
  id: `i-${id}`,
  brownfield_target_id: id,
  company_name: `회사${id}`,
  seq: 0,
  state,
  financial_outcome: null,
  technical_outcome: null,
  error_message: null,
  ...over,
});
const run = (id: string, items: ReturnType<typeof item>[], counts?: Loose) => ({
  run: {
    id,
    status: "running",
    total_targets: items.length,
    pause_reason: null,
    error_message: null,
    web_evidence: 0,
    force_refresh: 0,
  },
  items,
  progress: { done: 0, total: items.length },
  counts,
  budget: { calls: 0, budget: 0, reserve: 0 },
});

describe("runCounts / queueSummaryText", () => {
  test("uses the server counts block when present", () => {
    const c = { done: 3, running: 2, queued: 15, skipped: 0, failed: 0, cancelled: 0, total: 20 };
    expect(q.runCounts({ counts: c, items: [], progress: { done: 0, total: 0 } })).toBe(c);
    expect(q.queueSummaryText(tr(), c)).toBe("3/20 완료 · 2건 진행 중 · 15건 대기");
    expect(q.queueSummaryText(tr("en"), c)).toBe("3/20 done · 2 running · 15 waiting");
  });
  test("derives the counts from items for an older payload", () => {
    const v = run("r", [
      item("a", "done"),
      item("b", "technical_draft"),
      item("c", "pending"),
      item("d", "skipped_active"),
    ]);
    expect(q.runCounts(v)).toEqual({ done: 1, running: 1, queued: 1, skipped: 1, failed: 0, cancelled: 0, total: 4 });
  });
  test("items that ended without a result are appended, zero counts omitted", () => {
    const c = { done: 1, running: 0, queued: 0, skipped: 2, failed: 0, cancelled: 3, total: 6 };
    expect(q.queueSummaryText(tr(), c)).toBe("1/6 완료 · 0건 진행 중 · 0건 대기 · 건너뜀 2건 · 취소 3건");
  });
});

describe("progress panel lists every active run in full wording", () => {
  const two = [
    run("r1", [item("a", "technical_draft")], {
      done: 0,
      running: 1,
      queued: 0,
      skipped: 0,
      failed: 0,
      cancelled: 0,
      total: 1,
    }),
    run("r2", [item("b", "done"), item("c", "pending"), item("d", "financial_draft")], {
      done: 1,
      running: 1,
      queued: 1,
      skipped: 0,
      failed: 0,
      cancelled: 0,
      total: 3,
    }),
  ];
  const html = render(
    createElement(chips.AiEvalRunsPanel, {
      activeRuns: two,
      latest: null,
      canAct: true,
      busy: false,
      onResume: () => {},
      onCancel: () => {},
    }),
  );
  test("one line per run, a single-candidate run names the company, the panel is aria-live polite", () => {
    expect(html.match(/<li>/g)?.length).toBe(2);
    expect(html).toContain("<strong>회사a</strong>");
    expect(html).toContain("0/1 완료 · 1건 진행 중 · 0건 대기");
    expect(html).toContain("1/3 완료 · 1건 진행 중 · 1건 대기");
    expect(html).toContain('aria-live="polite"');
  });
  test("no truncation classes in the new queue files", () => {
    for (const f of ["AiEvalQueuePanel.tsx", "aiEvalQueueState.ts"]) {
      expect(readFileSync(`${DIR}/${f}`, "utf8")).not.toMatch(/className="[^"]*(truncate|line-clamp)|text-overflow/);
    }
  });
});

describe("rowQueueState: bulk and single rows map identically", () => {
  const live = (it: ReturnType<typeof item>, runId = "r1") => ({ runActive: true, runId, item: it });
  test("pending -> queued with the run and item id", () => {
    expect(q.rowQueueState(live(item("a", "pending")))).toEqual({
      kind: "queued",
      runId: "r1",
      itemId: "i-a",
      pausedRunId: null,
    });
  });
  test("running, done and idle rows have no queue state", () => {
    expect(q.rowQueueState(live(item("a", "technical_draft")))).toBeNull();
    expect(q.rowQueueState(live(item("a", "done")))).toBeNull();
    expect(q.rowQueueState(null)).toBeNull();
  });
  test("skipped_active and cancelled; a paused_run holder is parsed from the item message", () => {
    expect(q.rowQueueState(live(item("a", "skipped_active")))?.kind).toBe("skipped_active");
    expect(q.rowQueueState(live(item("a", "cancelled")))?.kind).toBe("cancelled");
    expect(q.rowQueueState(live(item("a", "skipped_active", { error_message: "paused_run:RUN9" })))?.pausedRunId).toBe(
      "RUN9",
    );
    expect(
      q.rowQueueState(live(item("a", "skipped_active", { error_message: "taken_over_by:RUN2" })))?.pausedRunId,
    ).toBeNull();
  });
  test("liveFor prefers the queued / running item over a skipped item of another run", () => {
    const runs = [run("rA", [item("a", "skipped_active")]), run("rB", [item("a", "pending")])];
    expect(active.liveFor(runs, null, "a")?.item.state).toBe("pending");
    expect(active.liveFor(runs, null, "a")?.runId).toBe("rB");
  });
});

describe("row chips (icon + text), 대기 취소 and the row chip of a running item", () => {
  const chipsHtml = (state: Loose, onCancelQueued: unknown = () => {}, locale: "ko" | "en" = "ko") =>
    render(createElement(panel.RowQueueChips, { state, companyName: "삼미", busy: false, onCancelQueued }), locale);
  test("queued: 대기 중 chip plus a labelled 대기 취소 button that starts with its visible text", () => {
    const html = chipsHtml({ kind: "queued", runId: "r1", itemId: "i1", pausedRunId: null });
    expect(html).toContain("대기 중");
    expect(html).toContain('aria-hidden="true">… </span>');
    expect(html).toContain(">대기 취소</button>");
    expect(html).toContain('aria-label="대기 취소: 삼미"');
    expect(chipsHtml({ kind: "queued", runId: "r1", itemId: "i1", pausedRunId: null }, null, "en")).not.toContain(
      "<button",
    );
    expect(chipsHtml({ kind: "queued", runId: "r1", itemId: "i1", pausedRunId: null }, () => {}, "en")).toContain(
      'aria-label="Cancel waiting: 삼미"',
    );
  });
  test("a viewer (no cancel handler) sees the waiting chip without the button", () => {
    const html = chipsHtml({ kind: "queued", runId: "r1", itemId: "i1", pausedRunId: null }, null);
    expect(html).toContain("대기 중");
    expect(html).not.toContain("<button");
  });
  test("skipped_active shows 이미 진행 중; with a paused holder it points to resume / cancel; cancelled shows 취소됨", () => {
    const a = chipsHtml({ kind: "skipped_active", runId: "r1", itemId: "i1", pausedRunId: null });
    expect(a).toContain("이미 진행 중");
    expect(a).not.toContain("이어서 실행");
    const p = chipsHtml({ kind: "skipped_active", runId: "r1", itemId: "i1", pausedRunId: "r9" });
    expect(p).toContain("이어서 실행하거나 중단한 뒤");
    expect(chipsHtml({ kind: "cancelled", runId: "r1", itemId: "i1", pausedRunId: null })).toContain("취소됨");
    expect(chipsHtml(null)).toBe("");
  });
  test("a queued item is not an 'in progress' chip; a running one still is (step text kept)", () => {
    const rs = (state: string) =>
      render(
        createElement(chips.RunStateChips, {
          draft: undefined,
          dartCorpCode: "0012",
          activeRunIds: ["r1"],
          live: { runActive: true, runId: "r1", item: item("a", state) },
        }),
      );
    expect(rs("pending")).toBe("");
    expect(rs("technical_draft")).toContain("기술 초안 작성 중");
  });
});

describe("start response notice", () => {
  const resp = (over: Loose = {}) => ({
    run_id: "r1",
    status: "running",
    queued: 5,
    skipped: [],
    taken_over: [],
    ...over,
  });
  test("queued with skipped reasons in catalog order", () => {
    const s = q.summarizeStart(
      resp({
        queued: 5,
        skipped: [
          { target_id: "a", reason: "not_dart" },
          { target_id: "b", reason: "already_active" },
          { target_id: "c", reason: "already_active" },
        ],
      }),
    );
    expect(q.formatStartNotice(tr(), s)).toBe(
      "5곳을 평가 대기열에 넣었습니다. 건너뜀 3곳: 이미 진행 중 2곳 · DART 미등록 1곳.",
    );
    expect(q.formatStartNotice(tr("en"), s)).toContain("5 candidates were added to the evaluation queue.");
  });
  test("200 with a null run: nothing to enqueue, reasons shown, paused_run points to resume / cancel", () => {
    const s = q.summarizeStart(
      resp({
        run_id: null,
        status: null,
        queued: 0,
        skipped: [{ target_id: "a", reason: "paused_run", run_id: "r9" }],
      }),
    );
    expect(s.nothingEnqueued).toBe(true);
    expect(s.hasPausedRun).toBe(true);
    const text = q.formatStartNotice(tr(), s);
    expect(text).toContain("평가 대기열에 넣을 후보가 없습니다.");
    expect(text).toContain("일시 정지된 실행에 묶임 1곳");
    expect(text).toContain("이어서 실행하거나 중단하세요");
  });
  test("taken-over candidates and unknown reasons", () => {
    const s = q.summarizeStart(
      resp({ taken_over: [{ target_id: "a", from_run_id: "rb" }], skipped: [{ target_id: "x", reason: "weird" }] }),
    );
    const text = q.formatStartNotice(tr(), s);
    expect(text).toContain("1곳은 일괄 평가 대기열에서 가져와");
    expect(text).toContain("기타 1곳");
  });
});

describe("pre-start estimate and error parameters", () => {
  test("estimateBulkStart skips candidates already queued/running and not-DART candidates", () => {
    const runs = [run("r1", [item("b", "pending"), item("c", "done")])];
    const est = q.estimateBulkStart(
      [
        { id: "a", hasDart: true },
        { id: "b", hasDart: true },
        { id: "c", hasDart: true },
        { id: "d", hasDart: false },
      ],
      runs,
    );
    expect(est).toEqual({ queued: 2, skippedActive: 1, skippedNotDart: 1 });
  });
  test("queue_full details become message parameters; 429 text is localized with the numbers", () => {
    expect(q.errorParams({ queued: 195, limit: 200, nested: { x: 1 } })).toEqual({ queued: 195, limit: 200 });
    expect(q.errorParams(undefined)).toEqual({});
    expect(tr()("callErrors.queue_full", q.errorParams({ queued: 195, limit: 200 }))).toContain(
      "대기 195건 / 한도 200건",
    );
    expect(en.stages.s67.aiEval.callErrors.queue_full).toContain("{queued} waiting, limit {limit}");
  });
  test("item_running tells the user the evaluation already started", () => {
    expect(ko.stages.s67.aiEval.callErrors.item_running).toContain("이미 평가가 시작되어");
  });
});

describe("wiring and cleanup", () => {
  test("the hook polls every 3 s only while a run is active, clears the timer, and exposes cancelItem / notice", () => {
    const src = readFileSync(`${DIR}/useAiEval.ts`, "utf8");
    expect(hook.AI_EVAL_POLL_MS).toBe(3000);
    expect(src).toContain("window.setInterval(() => void refreshActive(), AI_EVAL_POLL_MS)");
    expect(src).toContain("return () => window.clearInterval(id)");
    expect(src).toContain("if (!hasActive) return;");
    expect(src).toContain("cancelItem:");
    expect(src).toContain("/items/$" + "{encodeURIComponent(itemId)}/cancel");
    expect(src).toContain("notice");
  });
  test("the frontend no longer gates starts: no cap constant, no bulk_block / concurrency_cap handling", () => {
    for (const f of [
      "aiEvalActive.ts",
      "aiEvalTypes.ts",
      "AiEvalRowButton.tsx",
      "useAiEval.ts",
      "LonglistSection.tsx",
    ]) {
      const src = readFileSync(`${DIR}/${f}`, "utf8");
      expect(src).not.toMatch(/MAX_CONCURRENT_RUNS|bulk_block|concurrency_cap|isBulkRun/);
    }
  });
  test("every new queue key exists in both locales", () => {
    const flat = (o: Loose, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
    expect(flat(en.stages.s67.aiEval).sort()).toEqual(flat(ko.stages.s67.aiEval).sort());
    for (const k of ["queued", "skippedActive", "itemCancelled", "queueSummary", "cancelQueued", "queueEstimate"]) {
      expect(ko.stages.s67.aiEval[k]).toBeTruthy();
      expect(en.stages.s67.aiEval[k]).toBeTruthy();
    }
    expect(ko.stages.s67.aiEval.queued).toBe("대기 중");
    expect(ko.stages.s67.aiEval.skippedActive).toBe("이미 진행 중");
    expect(ko.stages.s67.aiEval.itemCancelled).toBe("취소됨");
    expect(ko.stages.s67.aiEval.cancelQueued).toBe("대기 취소");
  });
});
