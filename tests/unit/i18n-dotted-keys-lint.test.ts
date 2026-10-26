// H2 static check (review W1): label maps that yield raw dotted catalog keys
// must not be rendered without a translator call.
import { describe, expect, test } from "bun:test";
import { findLabelKeyMaps, findRawMapUsages, scanUnresolvedDottedKeys } from "../../scripts/co-newbiz/i18n-lint.ts";

const BAD_MAP = `const STAKE_LABEL = (tr: TranslatorFn): Record<string, string> => ({ full: "stages.s10.stage.fullAcquisition" });`;
const GOOD_MAP = `const A = (tr: TranslatorFn) => ({ full: tr("stages.s10.stage.fullAcquisition") });
const B = (tr: TranslatorFn) => resolveLabels(tr, { full: "stages.s10.stage.fullAcquisition" });`;

describe("i18n dotted-key lint (H2)", () => {
  test("flags a translator-taking map that stores raw dotted keys", () => {
    expect(findLabelKeyMaps(BAD_MAP)).toEqual(["STAKE_LABEL"]);
  });

  test("accepts maps that resolve through tr() or resolveLabels(tr, ...)", () => {
    expect(findLabelKeyMaps(GOOD_MAP)).toEqual([]);
  });

  test("seeded raw render is reported, tr()-wrapped and tr(v) usages pass", () => {
    const raw = `${BAD_MAP}\nconst x = <b>{STAKE_LABEL(tr)[k] ?? k}</b>;`;
    expect(findRawMapUsages(raw, "STAKE_LABEL")).toEqual([2]);
    const wrapped = `${BAD_MAP}\nconst x = tr(STAKE_LABEL(tr)[k]);`;
    expect(findRawMapUsages(wrapped, "STAKE_LABEL")).toEqual([]);
    const entries = `${BAD_MAP}\nconst o = Object.entries(STAKE_LABEL(tr)).map(([k, v]) => <i>{tr(v)}</i>);`;
    expect(findRawMapUsages(entries, "STAKE_LABEL")).toEqual([]);
  });

  test("the fixed tree has no unresolved dotted keys", () => {
    expect(scanUnresolvedDottedKeys()).toEqual([]);
  });
});
