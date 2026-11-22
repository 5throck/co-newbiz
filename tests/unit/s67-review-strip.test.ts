// U2 — design 2026-11-21-s67-completion-visibility § Defect Remediation: the collapsed
// `3단계 검토` strip ignored the recorded gate decision — after a Pre-FS GO the card still
// counted the judgment as 판단 필요. The fix carries the parents' existing gate state into
// ReviewBuckets (new optional `gateStates` prop) and, when a terminal decision exists for the
// strip's gate, renders the state copy (review.strip.gate{Go,Hold,Kill}Recorded) instead of the
// stale 판단 필요 count. None-state (no decision / pending) renders byte-identically.
// Pins: CountStrip render in all four states (ko/en), the stripGateStateOf resolution rules,
// the ko/en catalog parity, and source-level pins on the parent threading (revert-sensitive).
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
