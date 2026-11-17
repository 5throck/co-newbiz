// @version 1.0.0
/** S6 parallel AI evaluation runs (ADR-0199, 2026-11-16): per-row blocking from the active-run list, row chips from
 * any active run, the multi-run progress list, 409 message mapping, the modal shell (focus hook placement, close
 * button, aria-labelledby), ko/en keys. Same static-render pattern as s6-ai-eval-render.test.ts.
 * NOTE: the repo has no DOM test environment (no jsdom/happy-dom), so initial focus + Escape on the real portal
 * dialog are verified in the browser, and the structural cause is guarded here by rendering AiEvalModalPanel. */
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
const types = (await import(`${WEB}/components/stages/brownfield/aiEvalTypes.ts`)) as Loose;
const chips = (await import(`${WEB}/components/stages/brownfield/AiEvalChips.tsx`)) as Loose;
const rowBtn = (await import(`${WEB}/components/stages/brownfield/AiEvalRowButton.tsx`)) as Loose;
const start = (await import(`${WEB}/components/stages/brownfield/AiEvalStart.tsx`)) as Loose;
const dialogs = (await import(`${WEB}/components/stages/brownfield/AiEvalDialogs.tsx`)) as Loose;

const render = (el: unknown, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale, messages: locale === "ko" ? ko : en, timeZone: "Asia/Seoul" }, el),
  );

const item = (targetId: string, state: string, name = targetId) => ({
  id: `i-${targetId}`,
  brownfield_target_id: targetId,
  company_name: name,
  seq: 0,
  state,
  financial_outcome: null,
  technical_outcome: null,
  error_message: null,
});
/** One active run over `targetIds` (a single id = a single-candidate run). */
const run = (id: string, targetIds: string[], state = "financial_draft", done = 0) => ({
  run: {
    id,
    status: "running",
    total_targets: targetIds.length,
    pause_reason: null,
    error_message: null,
    web_evidence: 0,
    force_refresh: 0,
  },
  items: targetIds.map((t) => item(t, state)),
  progress: { done, total: targetIds.length },
  budget: { calls: 0, budget: 0, reserve: 0 },
});

describe("rowBlock: what disables a row", () => {
  const two = [run("r1", ["a"]), run("r2", ["b"], "financial_sync")];
  test("idle with no active run, and an idle third row next to two single runs", () => {
    expect(active.rowBlock([], "c")).toBeNull();
    expect(active.rowBlock(two, "c")).toBeNull();
  });
  test("the candidate with its own in-flight item is blocked, the others are not", () => {
    expect(active.rowBlock(two, "a")).toBe("target");
    expect(active.rowBlock(two, "b")).toBe("target");
  });
  test("a finished item of an active run does not block its candidate", () => {
    expect(active.rowBlock([run("r1", ["a"], "done")], "a")).toBeNull();
  });
  test("cap: three active runs block every other row; two do not", () => {
    const three = [...two, run("r3", ["c"])];
    expect(active.MAX_CONCURRENT_RUNS).toBe(3);
    expect(active.rowBlock(three, "d")).toBe("cap");
    expect(active.rowBlock(three, "c")).toBe("target"); // own run wins over the cap
    expect(active.rowBlock(two, "d")).toBeNull();
  });
  test("a bulk run (more than one candidate) blocks idle rows with the bulk reason", () => {
    const bulk = [run("rb", ["a", "b", "c"], "pending")];
    expect(active.isBulkRun(bulk[0])).toBe(true);
    expect(active.rowBlock(bulk, "d")).toBe("bulk");
    expect(active.rowBlock([run("rb", ["a", "b"], "done")], "a")).toBe("bulk"); // done item, still a bulk run
  });
});

describe("rows rendered from two simultaneous runs plus an idle row", () => {
  const runs = [run("r1", ["a"], "financial_draft"), run("r2", ["b"], "technical_draft")];
  const row = (id: string, name: string) =>
    render(
      createElement(rowBtn.AiEvalRowButton, {
        companyName: name,
        targetId: id,
        excluded: false,
        hasDart: true,
        block: active.rowBlock(runs, id),
        busy: false,
        onStart: async () => true,
      }),
    );
  const chipsFor = (id: string) =>
    render(
      createElement(chips.RunStateChips, {
        draft: undefined,
        dartCorpCode: "00123456",
        activeRunIds: ["r1", "r2"],
        live: active.liveFor(runs, null, id),
      }),
    );
  test("both running rows show progress and a disabled button with the own-run reason", () => {
    for (const [id, name] of [
      ["a", "Alpha"],
      ["b", "Beta"],
    ]) {
      expect(row(id, name)).toContain("disabled");
      expect(row(id, name)).toContain(ko.stages.s67.aiEval.rowTargetRunning);
      expect(chipsFor(id)).toContain("평가 진행 중");
    }
    // step wording differs per run: a is still drafting financials, b already finished them
    expect(chipsFor("a")).toContain("재무 초안 작성 중");
    expect(chipsFor("b")).toContain("재무 초안 완료");
  });
  test("the idle third row stays enabled and shows no progress", () => {
    const html = row("c", "Gamma");
    expect(html).not.toContain("disabled");
    expect(html).toContain('aria-label="Gamma AI 평가 실행"');
    expect(chipsFor("c")).toBe("");
  });
  test("cap reached: the idle row is disabled with the cap reason (ko + en)", () => {
    const three = [...runs, run("r3", ["z"])];
    const btn = (locale: "ko" | "en") =>
      render(
        createElement(rowBtn.AiEvalRowButton, {
          companyName: "Gamma",
          targetId: "c",
          excluded: false,
          hasDart: true,
          block: active.rowBlock(three, "c"),
          busy: false,
          onStart: async () => true,
        }),
        locale,
      );
    expect(btn("ko")).toContain("동시에 실행할 수 있는 AI 평가 3건에 도달했습니다");
    expect(btn("en")).toContain("limit of 3 concurrent AI evaluations");
    expect(btn("ko")).toContain("disabled");
  });
  test("liveFor falls back to the latest run's item (not active) once nothing is running", () => {
    const latest = run("r9", ["c"], "done");
    expect(active.liveFor([], latest, "c")).toEqual({ runActive: false, item: latest.items[0] });
    expect(active.liveFor([], latest, "x")).toBeNull();
  });
  test("the longlist wires rowBlock / liveFor / the runs panel from useAiEval's activeRuns", () => {
    const src = readFileSync(`${DIR}/LonglistSection.tsx`, "utf8");
    expect(src).toContain("rowBlock(ai.activeRuns, tgt.id)");
    expect(src).toContain("liveFor(ai.activeRuns, ai.view, tgt.id)");
    expect(src).toContain("<AiEvalRunsPanel");
    expect(src).toContain("disabled={anyRunActive}");
    expect(src).not.toContain("activeRunId !== null");
  });
});

describe("toolbar bulk button", () => {
  const bulk = (disabled: boolean) =>
    render(
      createElement(start.AiEvalStartButton, {
        candidates: 5,
        dartEligible: 4,
        disabled,
        busy: false,
        onStart: async () => true,
      }),
    );
  test("disabled while any run is active, with the reason as title", () => {
    const html = bulk(true);
    expect(html).toContain("disabled");
    expect(html).toContain(ko.stages.s67.aiEval.bulkBlocked);
    expect(bulk(false)).not.toContain("disabled");
    expect(bulk(false)).toContain(ko.stages.s67.aiEval.actionHint);
  });
});

describe("runs panel lists every active run compactly", () => {
  const panel = (activeRuns: unknown[], latest: unknown = null) =>
    render(
      createElement(chips.AiEvalRunsPanel, {
        activeRuns,
        latest,
        canAct: true,
        busy: false,
        onResume: () => {},
        onCancel: () => {},
      }),
    );
  test("two runs: one list item each with the candidate name, step and a per-run cancel", () => {
    const html = panel([run("r1", ["a"], "financial_sync"), run("r2", ["b"], "technical_draft")]);
    expect(html.match(/<li>/g)?.length).toBe(2);
    expect(html).toContain("<strong>a</strong> — ");
    expect(html).toContain("DART 재무 동기화 중");
    expect(html).toContain("기술 초안 작성 중(LLM 분석)");
    expect(html).toContain('aria-label="a 평가 중단"');
    expect(html).toContain('aria-label="b 평가 중단"');
    expect(html.match(/<progress/g)?.length).toBe(2);
  });
  test("a single run keeps the former one-run panel (no list)", () => {
    const html = panel([run("r1", ["a"])]);
    expect(html).not.toContain("<li>");
    expect(html).toContain("ai-eval-progress sizing-grade-card");
  });
  test("a paused latest run joins the list with resume; a finished or already-listed one does not", () => {
    const paused = { ...run("rp", ["p"], "pending"), run: { ...run("rp", ["p"]).run, status: "paused_budget" } };
    const html = panel([run("r1", ["a"])], paused);
    expect(html).toContain("<li>");
    expect(html).toContain("이어서 실행");
    const done = { ...run("rd", ["d"], "done"), run: { ...run("rd", ["d"]).run, status: "completed" } };
    expect(panel([run("r1", ["a"])], done)).not.toContain("<li>");
    expect(panel([], done)).toBe("");
    expect(panel([run("r1", ["a"])], run("r1", ["a"])).match(/<progress/g)?.length).toBe(1);
  });
});

describe("409 engine_active reasons", () => {
  test("details.reason maps to a specific catalog key, everything else keeps the code", () => {
    expect(active.callErrorKey("engine_active", { reason: "bulk_block" })).toBe("engine_active_bulk_block");
    expect(active.callErrorKey("engine_active", { reason: "concurrency_cap" })).toBe("engine_active_concurrency_cap");
    expect(active.callErrorKey("engine_active", { reason: "other" })).toBe("engine_active");
    expect(active.callErrorKey("engine_active", undefined)).toBe("engine_active");
    expect(active.callErrorKey("start_cooldown", { reason: "bulk_block" })).toBe("start_cooldown");
  });
  test("both new keys are known codes with ko + en text", () => {
    for (const k of ["engine_active_bulk_block", "engine_active_concurrency_cap"]) {
      expect(types.KNOWN_CALL_ERRORS).toContain(k);
      expect(ko.stages.s67.aiEval.callErrors[k]).toBeTruthy();
      expect(en.stages.s67.aiEval.callErrors[k]).toBeTruthy();
    }
  });
  test("a run leaving the active set is detected (drives the chip refresh)", () => {
    expect(active.finishedRunIds(["r1", "r2"], ["r2"])).toEqual(["r1"]);
    expect(active.finishedRunIds([], ["r2"])).toEqual([]);
    expect(active.finishedRunIds(["r1"], [])).toEqual(["r1"]);
  });
});

describe("modal shell: focus hook lives in the mounted panel, close button, labelling", () => {
  const panel = (props: Record<string, unknown> = {}, locale: "ko" | "en" = "ko") =>
    render(
      createElement(
        dialogs.AiEvalModalPanel,
        { title: "평가 기준", onClose: () => {}, titleId: "t1", ...props },
        createElement("p", {}, "body"),
      ),
      locale,
    );
  test("dialog is labelled by its heading; close button has icon + text + aria-label (ko + en)", () => {
    const html = panel({ showClose: true });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="t1"');
    expect(html).toContain('<h2 id="t1"');
    expect(html).toContain('aria-label="닫기"');
    expect(html).toContain('aria-hidden="true">✕ </span>닫기');
    expect(panel({ showClose: true }, "en")).toContain('aria-label="Close"');
  });
  test("no close button unless requested; plain title falls back to aria-label", () => {
    const html = panel({ titleId: undefined });
    expect(html).not.toContain("✕");
    expect(html).toContain('aria-label="평가 기준"');
  });
  test("regression guard: useModalFocus is called by the panel, never by the mount-gated shell", () => {
    const src = readFileSync(`${DIR}/AiEvalDialogs.tsx`, "utf8");
    const shell = src.slice(src.indexOf("export function AiEvalModal("), src.indexOf("export interface StartStats"));
    expect(shell).not.toContain("useModalFocus");
    expect(shell).toContain("<AiEvalModalPanel");
    expect(src.slice(src.indexOf("export function AiEvalModalPanel"))).toContain("useModalFocus(onClose)");
    expect(readFileSync(`${DIR}/AiEvalCriteriaPanel.tsx`, "utf8")).toContain("showClose");
  });
});

test("ko/en parity for the new keys", () => {
  for (const k of ["rowTargetRunning", "rowCapReached", "bulkBlocked", "cancelRun"]) {
    expect(ko.stages.s67.aiEval[k]).toBeTruthy();
    expect(en.stages.s67.aiEval[k]).toBeTruthy();
  }
});
