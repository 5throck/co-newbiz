// U2 — design 2026-11-21-s67-completion-visibility § Defect Remediation: the collapsed
// `3단계 검토` strip ignored the recorded gate decision — after a Pre-FS GO the card still
// counted the judgment as 판단 필요. The fix carries the parents' existing gate state into
// ReviewBuckets (new optional `gateStates` prop) and, when a terminal decision exists for the
// strip's gate, renders the state copy (review.strip.gate{Go,Hold,Kill}Recorded) instead of the
// stale 판단 필요 count. None-state (no decision / pending) renders byte-identically.
// D-c follow-up (2026-11-22): on a terminated process the killed gate resolves from decision
// history (lib/gate-kill-scope.ts killedGateOf) — a kill AT the strip's gate keeps the labeled
// KILL chip; a kill at any other gate (or none resolvable) renders the gate-neutral
// review.strip.processTerminated copy instead of a misattributed KILL chip.
// Pins: CountStrip render in all strip states (ko/en), the stripGateStateOf resolution rules,
// the killedGateOf resolution, the ko/en catalog parity, and source-level pins on the parent
// threading (revert-sensitive).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

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
const enCatalog = (await import(`${WEB}/locales/en.json`)).default as Record<string, unknown>;
const { CountStrip, stripGateStateOf } = (await import(`${WEB}/components/ReviewBuckets.tsx`)) as {
  CountStrip: unknown;
  stripGateStateOf: (
    gateStates: Record<string, "go" | "hold" | "kill" | "pending"> | undefined,
    active: string,
  ) => { gate: string; state: "go" | "hold" | "kill" } | undefined;
};
const { killedGateOf } = (await import(`${WEB}/lib/gate-kill-scope.ts`)) as {
  killedGateOf: (
    decisions: Record<string, string> | Array<{ gate: string; decision: string | null }> | null | undefined,
  ) => string | null;
};

const PRE_FS_LABEL_KO = "예비타당성 검토(Pre-FS)";
const PRE_FS_LABEL_EN = "Preliminary feasibility study (Pre-FS)";

const localeOf = (catalog: Record<string, unknown>, key: string): string => {
  const v = key
    .split(".")
    .reduce<unknown>(
      (acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
      catalog,
    );
  if (typeof v !== "string") throw new Error(`catalog key not found: ${key}`);
  return v;
};

const counts = { verified: 2, could_not_verify: 1, needs_judgement: 1 };
const renderStrip = (extra: Record<string, unknown> = {}, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : enCatalog, now: new Date(), timeZone: "Asia/Seoul" },
      createElement(CountStrip, { counts, ...extra }),
    ),
  );

describe("collapsed review strip state copy (U2)", () => {
  test("none-state: the 판단 필요 count renders and no state chip appears (ko)", () => {
    const html = renderStrip();
    expect(html).toContain("판단 필요 1건");
    expect(html).toContain("확인됨 2건");
    expect(html).not.toContain("GO 기록됨");
    expect(html).not.toContain("HOLD 기록됨");
    expect(html).not.toContain("KILL 기록됨");
    expect(html).not.toContain("review-count-state");
    expect(html).not.toContain("data-gate-state");
  });

  test("GO recorded: the state copy replaces the stale count (ko)", () => {
    const html = renderStrip({ recordedState: "go", recordedGateLabel: PRE_FS_LABEL_KO });
    expect(html).toContain(`✓ ${PRE_FS_LABEL_KO} GO 기록됨`);
    expect(html).not.toContain("판단 필요");
    // glyph + text chip, status-green pair, state word readable by assistive tech
    expect(html).toContain('data-gate-state="go"');
    expect(html).toContain("status-green");
  });

  test("HOLD recorded: the amber re-decision line replaces the count (ko)", () => {
    const html = renderStrip({ recordedState: "hold", recordedGateLabel: PRE_FS_LABEL_KO });
    expect(html).toContain(`◐ ${PRE_FS_LABEL_KO} HOLD 기록됨 — 재결정 필요`);
    expect(html).not.toContain("판단 필요");
    expect(html).toContain('data-gate-state="hold"');
    expect(html).toContain("status-amber");
  });

  test("KILL recorded: the red terminated line replaces the count (ko)", () => {
    const html = renderStrip({ recordedState: "kill", recordedGateLabel: PRE_FS_LABEL_KO });
    expect(html).toContain(`✕ ${PRE_FS_LABEL_KO} KILL 기록됨 — 프로세스가 종료되었습니다`);
    expect(html).not.toContain("판단 필요");
    expect(html).toContain('data-gate-state="kill"');
    expect(html).toContain("status-red");
  });

  test("en parity: same three state copies with the en gate label", () => {
    const go = renderStrip({ recordedState: "go", recordedGateLabel: PRE_FS_LABEL_EN }, "en");
    expect(go).toContain(`✓ ${PRE_FS_LABEL_EN} GO recorded`);
    expect(go).not.toContain(localeOf(enCatalog, "review.counts.needsJudgement").replace("{count}", "1"));
    const hold = renderStrip({ recordedState: "hold", recordedGateLabel: PRE_FS_LABEL_EN }, "en");
    expect(hold).toContain(`◐ ${PRE_FS_LABEL_EN} HOLD recorded — re-decision needed`);
    const kill = renderStrip({ recordedState: "kill", recordedGateLabel: PRE_FS_LABEL_EN }, "en");
    expect(kill).toContain(`✕ ${PRE_FS_LABEL_EN} KILL recorded — the process is terminated`);
  });

  test("catalog parity: the three strip keys exist in both locales and carry {gate}", () => {
    for (const catalog of [ko, enCatalog]) {
      for (const key of ["gateGoRecorded", "gateHoldRecorded", "gateKillRecorded"]) {
        const v = localeOf(catalog, `review.strip.${key}`);
        expect(typeof v).toBe("string");
        expect(v).toContain("{gate}");
      }
    }
  });
});

describe("stripGateStateOf — which recorded decision governs the strip", () => {
  test("active gate tab resolves its own gate's state", () => {
    expect(stripGateStateOf({ pre_fs: "go" }, "gate:pre_fs")).toEqual({ gate: "pre_fs", state: "go" });
    expect(stripGateStateOf({ entity_ic: "go", group_ic: "kill" }, "gate:group_ic")).toEqual({
      gate: "group_ic",
      state: "kill",
    });
  });

  test("artifact-tab active + single-entry map (stage screens scope one gate): the entry governs", () => {
    expect(stripGateStateOf({ pre_fs: "go" }, "stage:S6:1")).toEqual({ gate: "pre_fs", state: "go" });
  });

  test("artifact-tab active + multi-entry map: ambiguous, none-state", () => {
    expect(stripGateStateOf({ entity_ic: "go", group_ic: "kill" }, "stage:S11:2")).toBeUndefined();
  });

  test("pending or absent decision: none-state — the count stays honest", () => {
    expect(stripGateStateOf({ pre_fs: "pending" }, "gate:pre_fs")).toBeUndefined();
    expect(stripGateStateOf({ pre_fs: "go" }, "gate:dd")).toBeUndefined();
    expect(stripGateStateOf(undefined, "gate:pre_fs")).toBeUndefined();
    expect(stripGateStateOf({}, "stage:S6:1")).toBeUndefined();
  });
});

describe("parent threading (source pins — reverting the wiring fails these)", () => {
  // readFileSync is cwd-relative (bun test runs from the repo root), unlike the dynamic
  // imports above which resolve relative to this file.
  const src = (p: string) => readFileSync(`./app/web-next/${p}`, "utf8");

  test("BrownfieldStage derives the Pre-FS state from its one engine read and passes gateStates", () => {
    const s = src("components/stages/brownfield/BrownfieldStage.tsx");
    expect(s).toContain("gateStates={preFsGateState ? { pre_fs: preFsGateState } : undefined}");
    expect(s).toContain("s6.pre_fs_go");
    expect(s).toContain("terminated");
    expect(s).toContain("s6Exempt"); // exempt is NOT a GO — never a false GO copy
  });

  test("IcReviewStage passes both IC gates' recorded decisions", () => {
    const s = src("components/stages/IcReviewStage.tsx");
    expect(s).toContain("gateState(pkg.gates.latest");
    expect(s).toContain("gateStates=");
  });

  test("the summary strip consumes the resolved state (ReviewBuckets)", () => {
    const s = src("components/ReviewBuckets.tsx");
    expect(s).toContain("recordedState={stripGate?.state}");
    expect(s).toContain("recordedGateLabel={stripGateLabel}");
    expect(s).toContain("gateStates?: Record<string, GateState>");
  });
});

describe("gate-neutral terminated copy (D-c follow-up, 2026-11-22)", () => {
  // The glyph renders as its own aria-hidden span, so the catalog copy asserts WITHOUT the glyph.
  const NEUTRAL_KO = "프로세스가 종료되었습니다 — 기록을 확인하세요";
  const NEUTRAL_EN = "Process terminated — see the record";
  const NEUTRAL_GLYPH = '<span aria-hidden="true">■</span>';

  test("(b) terminated, kill at ANOTHER gate: the gate-neutral copy replaces the count — no gate word (ko)", () => {
    // Parent mapping under test: killedGateOf({screening:"kill"}) = "screening" ≠ "pre_fs" →
    // preFsGateState undefined, processTerminated true → the strip renders terminated only.
    const html = renderStrip({ terminated: true });
    expect(html).toContain(NEUTRAL_GLYPH); // neutral end glyph, hidden from assistive tech
    expect(html).toContain(NEUTRAL_KO);
    expect(html).toContain('data-gate-state="terminated"');
    expect(html).toContain("status-red"); // reuse of the existing red pair
    expect(html).not.toContain("판단 필요"); // the stale count is replaced
    expect(html).not.toContain("KILL 기록됨"); // no gate-attributed chip
    expect(html).not.toContain("Pre-FS"); // no gate word anywhere
    expect(html).not.toContain("GO 기록됨");
    expect(html).not.toContain("HOLD 기록됨");
  });

  test("(b/en) en parity: the gate-neutral copy with no gate word", () => {
    const html = renderStrip({ terminated: true }, "en");
    expect(html).toContain(NEUTRAL_GLYPH);
    expect(html).toContain(NEUTRAL_EN);
    expect(html).toContain('data-gate-state="terminated"');
    expect(html).not.toContain(localeOf(enCatalog, "review.counts.needsJudgement").replace("{count}", "1"));
    expect(html).not.toContain("KILL recorded");
    expect(html).not.toContain("Pre-FS");
  });

  test("(a) terminated + kill AT this gate: the labeled KILL chip wins over the neutral copy (ko)", () => {
    // Parent mapping under test: killedGateOf({pre_fs:"kill"}) = "pre_fs" → preFsGateState "kill".
    const html = renderStrip({ recordedState: "kill", recordedGateLabel: PRE_FS_LABEL_KO, terminated: true });
    expect(html).toContain(`✕ ${PRE_FS_LABEL_KO} KILL 기록됨 — 프로세스가 종료되었습니다`);
    expect(html).toContain('data-gate-state="kill"');
    expect(html).not.toContain('data-gate-state="terminated"');
    expect(html).not.toContain(NEUTRAL_KO);
  });

  test("(c) terminated, kill UNRESOLVABLE: the neutral copy renders (source-mapped, same render path)", () => {
    // killedGateOf({}) = null → parent passes processTerminated (terminated is true) with no
    // recordedState — exactly the render under test in (b); pinned here with the empty history.
    expect(killedGateOf({})).toBeNull();
    const html = renderStrip({ terminated: true });
    expect(html).toContain(NEUTRAL_GLYPH);
    expect(html).toContain(NEUTRAL_KO);
    expect(html).not.toContain("KILL 기록됨");
  });

  test("catalog parity: review.strip.processTerminated exists in both locales and is gate-neutral", () => {
    for (const catalog of [ko, enCatalog]) {
      const v = localeOf(catalog, "review.strip.processTerminated");
      expect(typeof v).toBe("string");
      expect(v).not.toContain("{gate}"); // gate-neutral: no interpolation slot
      expect(v).not.toContain("KILL");
    }
    // The three gate-attributed keys are untouched (same assertions as above, restated).
    for (const key of ["gateGoRecorded", "gateHoldRecorded", "gateKillRecorded"]) {
      expect(localeOf(ko, `review.strip.${key}`)).toContain("{gate}");
      expect(localeOf(enCatalog, `review.strip.${key}`)).toContain("{gate}");
    }
  });
});

describe("killedGateOf — which recorded decision killed the process (D-c follow-up)", () => {
  test("record shape (process read gateStatus): the killed gate resolves", () => {
    expect(killedGateOf({ screening: "kill" })).toBe("screening");
    expect(killedGateOf({ pre_fs: "kill" })).toBe("pre_fs");
    expect(killedGateOf({ target_screening: "kill" })).toBe("target_screening");
    expect(killedGateOf({ group_ic: "kill" })).toBe("group_ic");
  });

  test("non-kill decisions are not kills; absent history resolves to null", () => {
    expect(killedGateOf({ pre_fs: "go" })).toBeNull();
    expect(killedGateOf({ pre_fs: "hold" })).toBeNull();
    expect(killedGateOf({ pre_fs: "pending" })).toBeNull();
    expect(killedGateOf({})).toBeNull();
    expect(killedGateOf(undefined)).toBeNull();
    expect(killedGateOf(null)).toBeNull();
  });

  test("a kill AFTER a go still resolves (GO at one gate, kill at a later one)", () => {
    expect(killedGateOf({ pre_fs: "go", dd: "kill" })).toBe("dd");
    expect(killedGateOf({ screening: "go", pre_fs: "go", target_screening: "kill" })).toBe("target_screening");
  });

  test("pathological multiple kills: the EARLIEST gate in GATE_ORDER wins (the one that ended the process)", () => {
    expect(killedGateOf({ pre_fs: "kill", screening: "kill" })).toBe("screening");
    expect(killedGateOf({ group_ic: "kill", dd: "kill" })).toBe("dd");
  });

  test("array shape (IC latest rows): per-row resolution, null decisions ignored", () => {
    expect(
      killedGateOf([
        { gate: "entity_ic", decision: "go" },
        { gate: "group_ic", decision: "kill" },
      ]),
    ).toBe("group_ic");
    expect(killedGateOf([{ gate: "entity_ic", decision: "kill" }])).toBe("entity_ic");
    expect(
      killedGateOf([
        { gate: "entity_ic", decision: null },
        { gate: "group_ic", decision: "hold" },
      ]),
    ).toBeNull();
    expect(killedGateOf([])).toBeNull();
  });
});

describe("D-c parent threading (source pins — reverting the wiring fails these)", () => {
  const src = (p: string) => readFileSync(`./app/web-next/${p}`, "utf8");

  test("useS6Gate carries the killed gate from the same process read (no new fetch)", () => {
    const s = src("components/stages/brownfield/S6CriteriaPanel.tsx");
    expect(s).toContain("gateStatus?: Record<string, string>"); // ProcessResponse carries the history
    expect(s).toContain("killedGate: string | null"); // S6GateState field
    expect(s).toContain("killedGate: terminated ? killedGateOf(data.gateStatus ?? {}) : null");
    expect(s).toContain("killedGate: null,"); // EMPTY_S6_GATE fail-quiet default
  });

  test("BrownfieldStage attributes KILL only to a kill recorded AT pre_fs; cross-gate kills go neutral", () => {
    const s = src("components/stages/brownfield/BrownfieldStage.tsx");
    expect(s).toContain('s6Gate.killedGate === "pre_fs"');
    // The blind mapping (terminated → KILL regardless of gate) is gone — reverting to it fails here.
    expect(s).not.toContain('s6Gate.terminated\n      ? ("kill" as const)');
    expect(s).toContain('processTerminated={s6Gate.ready && s6Gate.terminated && s6Gate.killedGate !== "pre_fs"}');
  });

  test("IcReviewStage resolves the killed gate from its existing IC decision history", () => {
    const s = src("components/stages/IcReviewStage.tsx");
    expect(s).toContain("killedGateOf(pkg?.gates.latest)");
    expect(s).toContain("processTerminated={icKilledGate !== null}");
  });

  test("the summary strip threads processTerminated into CountStrip (ReviewBuckets)", () => {
    const s = src("components/ReviewBuckets.tsx");
    expect(s).toContain("terminated={processTerminated}");
    expect(s).toContain('data-gate-state="terminated"');
    expect(s).toContain('tr("review.strip.processTerminated")');
  });
});
