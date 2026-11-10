/**
 * Design §9.3 (F3, amendment 2026-11-11) — resolution-label drift guard.
 *
 * The server-rendered minutes markdown (committee-scorecard.ts) carries its
 * own inline Korean label map because there is no next-intl path for server
 * markdown, while the minutes VIEW (CommitteeMinutesView.tsx) reads the
 * locale bundles. The two sources must never disagree: this test pins the
 * inline map's equality with ko.json common.committeeMinutes.resolution* and
 * asserts the en.json keys exist, so a future label edit that changes only
 * one side fails the build. Deliberately a TEST, not a runtime coupling —
 * the lib must stay independent of the client i18n bundle (§9.3).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { committeeResolutionLabel } from "../../app/web-next/lib/committee-scorecard.ts";

const ko = JSON.parse(readFileSync(new URL("../../app/web-next/locales/ko.json", import.meta.url), "utf8")) as {
  common: { committeeMinutes: Record<string, string> };
};
const en = JSON.parse(readFileSync(new URL("../../app/web-next/locales/en.json", import.meta.url), "utf8")) as {
  common: { committeeMinutes: Record<string, string> };
};

const KO_LABELS = ko.common.committeeMinutes;
const EN_LABELS = en.common.committeeMinutes;

describe("committeeResolutionLabel — locale drift guard (design §9.3)", () => {
  test("the inline server map equals the ko.json committeeMinutes labels for all three enums", () => {
    expect(committeeResolutionLabel("agreed")).toBe(KO_LABELS.resolutionAgreed);
    expect(committeeResolutionLabel("narrowed")).toBe(KO_LABELS.resolutionNarrowed);
    expect(committeeResolutionLabel("unresolved")).toBe(KO_LABELS.resolutionUnresolved);
  });

  test("the en.json triple exists — deleting a key fails the build", () => {
    expect(typeof EN_LABELS.resolutionAgreed).toBe("string");
    expect(EN_LABELS.resolutionAgreed.length).toBeGreaterThan(0);
    expect(typeof EN_LABELS.resolutionNarrowed).toBe("string");
    expect(EN_LABELS.resolutionNarrowed.length).toBeGreaterThan(0);
    expect(typeof EN_LABELS.resolutionUnresolved).toBe("string");
    expect(EN_LABELS.resolutionUnresolved.length).toBeGreaterThan(0);
  });

  test("unknown enum values fall back to the raw string, never blank (§8.7)", () => {
    expect(committeeResolutionLabel("some_new_enum")).toBe("some_new_enum");
  });
});
