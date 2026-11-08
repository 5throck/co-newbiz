import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolveLabelTokens, SUB_TRACK_KEY, subTrackLabelKey } from "../../app/web-next/lib/label-keys.ts";
import { BF_SUB, GF_SUB } from "../../app/web-next/components/stages/route-decision/constants.ts";

const load = (loc: string) =>
  JSON.parse(readFileSync(`app/web-next/locales/${loc}.json`, "utf8")) as Record<string, unknown>;
const trFor =
  (cat: Record<string, unknown>) =>
  (key: string): string =>
    key.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], cat) as string;

describe("route (sub-track) option labels", () => {
  test("known code maps to its common.subTrack key", () => {
    expect(subTrackLabelKey("m_and_a")).toBe("common.subTrack.m_and_a");
    expect(subTrackLabelKey("corporate_venture")).toBe(SUB_TRACK_KEY.corporate_venture);
  });

  test("unknown code falls back to the raw code and renders unchanged", () => {
    expect(subTrackLabelKey("new_route")).toBe("new_route");
    expect(resolveLabelTokens(subTrackLabelKey("new_route"), trFor(load("ko")))).toBe("new_route");
  });

  for (const loc of ["ko", "en"]) {
    test(`every select option code renders a localized label in ${loc} (not the raw code)`, () => {
      const tr = trFor(load(loc));
      for (const code of [...GF_SUB, ...BF_SUB]) {
        const label = resolveLabelTokens(subTrackLabelKey(code), tr);
        expect(label.trim().length).toBeGreaterThan(0);
        expect(label).not.toBe(code);
      }
    });
  }
});
