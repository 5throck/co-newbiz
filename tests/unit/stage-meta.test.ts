// T-20261022-009: stage-meta's gate vocabulary is the glossary Korean set — one
// vocabulary across the rail, decision panels, process chips and the deals page.
// i18n re-pin (T3-6): the vocabulary is `common.gate.*` catalog keys (lib/label-keys.ts),
// resolved with the ROOT translator at render; ko catalog values must keep the glossary wording.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { STAGE_META } from "../../app/web-next/lib/stage-meta.ts";
import { GATE_LABEL_KEY } from "../../app/web-next/lib/label-keys.ts";

const ko = JSON.parse(readFileSync("app/web-next/locales/ko.json", "utf8")) as Record<string, any>;
const tr = (key: string): string => key.split(".").reduce<unknown>((acc, k) => (acc as Record<string, any>)[k], ko) as string;

describe("stage-meta gate labels", () => {
  test("every flow.spec gate has a common.gate.* key whose ko wording keeps the glossary term", () => {
    // glossary terms (glossary/*.yaml ko): Pre-FS, Entity IC, Group IC
    expect(tr("common.gate.pre_fs")).toContain("예비타당성");
    expect(tr("common.gate.entity_ic")).toContain("투자심의위원회");
    expect(tr("common.gate.group_ic")).toContain("투자심의위원회");
    for (const g of Object.keys(GATE_LABEL_KEY)) expect(tr(GATE_LABEL_KEY[g])).toBeTruthy();
  });

  test("flow.spec gates are keyed exactly (no transition in the flow vocabulary)", () => {
    const specGates = [...new Set(STAGE_META.flatMap((s) => s.gateIds))].sort();
    expect(Object.keys(GATE_LABEL_KEY).filter((k) => k !== "transition").sort()).toEqual(specGates);
    // The S12 review pseudo-gate has its own key but never leaks into STAGE_META gateIds.
    expect(GATE_LABEL_KEY.transition).toBe("common.gate.transition");
  });
});
