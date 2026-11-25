// ADR-0206 / design 2026-11-24-s8-excluded-target-handling §5-§6: stale S8 target UI.
// Pure view helpers (banner messages, GO-disabled decision) + source pins for the banner placements,
// the GateDecisionPanel GO reason, the admin `target` family and the ko/en catalog entries.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { S8Staleness } from "../../app/web-next/lib/business-case.ts";
import { TARGET_GO_GATES } from "../../app/web-next/lib/gate-decision-contract.ts";
import { FAMILY_ORDER, isKnownFamily } from "../../app/web-next/lib/gate-integrity-kpis-view.ts";
import {
  STALE_TARGET_GO_GATES,
  staleTargetBlocksGo,
  staleTargetMessages,
} from "../../app/web-next/lib/s8-stale-target-view.ts";
import en from "../../app/web-next/locales/en.json";
import ko from "../../app/web-next/locales/ko.json";

const WEB = join(import.meta.dirname, "../../app/web-next");
const read = (p: string) => readFileSync(join(WEB, p), "utf8");

const NONE: S8Staleness = {
  selection: null,
  adoption: null,
  any: false,
  selected_target: { id: "t1", name: "태웅" },
  adopted_target: { id: "t1", name: "태웅" },
  target_ids: [],
};

describe("staleTargetMessages", () => {
  test("empty when nothing is stale or the read is missing", () => {
    expect(staleTargetMessages(null)).toEqual([]);
    expect(staleTargetMessages(undefined)).toEqual([]);
    expect(staleTargetMessages(NONE)).toEqual([]);
  });

  test("selected target excluded names the selected target", () => {
    const st: S8Staleness = { ...NONE, selection: "selected_target_excluded", any: true, target_ids: ["t1"] };
    expect(staleTargetMessages(st)).toEqual([{ kind: "selectionExcluded", name: "태웅" }]);
  });

  test("adopted target excluded names the adopted target; mismatch names none", () => {
    const excluded: S8Staleness = {
      ...NONE,
      adoption: "adopted_target_excluded",
      adopted_target: { id: "t2", name: "대성" },
      any: true,
    };
    expect(staleTargetMessages(excluded)).toEqual([{ kind: "adoptionExcluded", name: "대성" }]);
    const mismatch: S8Staleness = { ...NONE, adoption: "adopted_target_mismatch", any: true };
    expect(staleTargetMessages(mismatch)).toEqual([{ kind: "adoptionMismatch", name: null }]);
  });

  test("both stale records give two messages, selection first; a missing name stays null", () => {
    const st: S8Staleness = {
      ...NONE,
      selection: "selected_target_excluded",
      adoption: "adopted_target_excluded",
      selected_target: { id: "t1", name: null },
      any: true,
    };
    expect(staleTargetMessages(st).map((m) => m.kind)).toEqual(["selectionExcluded", "adoptionExcluded"]);
    expect(staleTargetMessages(st)[0]?.name).toBeNull();
  });
});

describe("staleTargetBlocksGo", () => {
  const stale: S8Staleness = { ...NONE, selection: "selected_target_excluded", any: true };

  test("the client gate list equals the server's TARGET_GO_GATES", () => {
    expect([...STALE_TARGET_GO_GATES].sort()).toEqual([...TARGET_GO_GATES].sort());
  });

  test("blocks GO at fs, dd, entity_ic and group_ic only while stale", () => {
    for (const g of ["fs", "dd", "entity_ic", "group_ic"]) {
      expect(staleTargetBlocksGo(stale, g)).toBe(true);
      expect(staleTargetBlocksGo(NONE, g)).toBe(false);
    }
    expect(staleTargetBlocksGo(stale, "pre_fs")).toBe(false);
    expect(staleTargetBlocksGo(stale, "screening")).toBe(false);
    expect(staleTargetBlocksGo(null, "fs")).toBe(false);
  });
});

describe("source pins", () => {
  test("banner is a polite status with an icon, a text label and static catalog keys", () => {
    const src = read("components/stages/StaleTargetBanner.tsx");
    expect(src).toContain('role="status"');
    expect(src).toContain('aria-hidden="true">▲');
    expect(src).toContain('useTranslations("stages.s8.staleTarget")');
    expect(src).not.toMatch(/[가-힣]/);
  });

  test("banner shows on the decision tab (via the lens strip) and in the target comparison", () => {
    const strip = read("components/stages/S8LensStrip.tsx");
    expect(strip).toContain('data.state === "stale_target"');
    expect(strip).toContain("<StaleTargetBanner");
    const stage = read("components/stages/BusinessCaseStage.tsx");
    expect(stage).toContain("<StaleTargetBanner staleness={data?.staleness} />");
    expect(stage).toContain("<S8LensStrip projectId={projectId} onOpenSelection={openTargetsTab} />");
  });

  test("GateDecisionPanel disables GO with the stale reason and localizes the 409", () => {
    const src = read("components/GateDecisionPanel.tsx");
    expect(src).toContain('<option value="go" disabled={goStaleBlocked}>');
    expect(src).toContain('err.code === "target_not_shortlisted"');
    expect(src).toContain("stages.s8.staleTarget.goBlocked");
    expect(src).toContain("entityBase}/business-case");
  });

  test("admin KPI view knows the `target` family", () => {
    expect(FAMILY_ORDER).toContain("target");
    expect(isKnownFamily("target")).toBe(true);
  });
});

type Catalog = Record<string, unknown>;
const lookup = (obj: Catalog, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Catalog)[k] : undefined), obj);

describe("catalog entries (ko + en)", () => {
  const keys = [
    ...[
      "adoptionExcluded",
      "adoptionMismatch",
      "figuresHidden",
      "goBlocked",
      "label",
      "openSelection",
      "selectionExcluded",
      "unnamedTarget",
    ].map((k) => `stages.s8.staleTarget.${k}`),
    "admin.gateIntegrity.family.target.name",
    "admin.gateIntegrity.family.target.desc",
    "errors.codes.target_not_shortlisted",
  ];
  for (const [locale, cat] of [
    ["ko", ko],
    ["en", en],
  ] as const) {
    test(`${locale}: every key is a non-empty string`, () => {
      for (const k of keys) {
        const v = lookup(cat as Catalog, k);
        expect([locale, k, typeof v]).toEqual([locale, k, "string"]);
        expect(v as string).not.toBe("");
      }
    });
  }

  test("the name placeholder is present where the copy names a target", () => {
    for (const cat of [ko, en] as const) {
      for (const k of ["selectionExcluded", "adoptionExcluded"]) {
        expect(lookup(cat as Catalog, `stages.s8.staleTarget.${k}`) as string).toContain("{name}");
      }
    }
  });

  test("ko copy uses the user-manual term 최종 후보 목록, never the English 'Short List'", () => {
    expect(lookup(ko as Catalog, "stages.s8.staleTarget.goBlocked")).toBe(
      "최종 후보 목록에서 제외된 대상이 선택·채택되어 있어 GO를 기록할 수 없습니다. HOLD·KILL은 기록할 수 있습니다.",
    );
    const koKeys = [
      ...[
        "adoptionExcluded",
        "adoptionMismatch",
        "figuresHidden",
        "goBlocked",
        "label",
        "openSelection",
        "selectionExcluded",
        "unnamedTarget",
      ].map((k) => `stages.s8.staleTarget.${k}`),
      "errors.codes.target_not_shortlisted",
    ];
    for (const k of koKeys)
      expect([k, lookup(ko as Catalog, k) as string]).not.toEqual([k, expect.stringContaining("Short List")]);
    expect(lookup(ko as Catalog, "stages.s8.staleTarget.selectionExcluded") as string).toContain(
      "최종 후보 목록에 없습니다",
    );
    expect(lookup(ko as Catalog, "errors.codes.target_not_shortlisted") as string).toContain("최종 후보 목록");
  });

  test("the finalized banner strings are pinned as written", () => {
    expect(lookup(ko as Catalog, "stages.s8.staleTarget.label")).toBe("대상 기업 확인 필요");
    expect(lookup(ko as Catalog, "stages.s8.staleTarget.openSelection")).toBe("대상 비교·선정으로 이동");
    expect(lookup(ko as Catalog, "stages.s8.staleTarget.unnamedTarget")).toBe("이름 없는 대상");
    expect(lookup(ko as Catalog, "stages.s8.staleTarget.figuresHidden")).toBe(
      "대상을 다시 선택하고 분석안을 다시 채택할 때까지 이 요약의 수치는 표시하지 않습니다.",
    );
  });

  test("en copy follows the en catalog's Final Candidate List term", () => {
    for (const k of ["adoptionExcluded", "goBlocked", "selectionExcluded"]) {
      const v = lookup(en as Catalog, `stages.s8.staleTarget.${k}`) as string;
      expect(v).toContain("Final Candidate List");
      expect(v).not.toContain("Short List");
    }
  });

  test("the banner call sites carry no INTERIM-WORDING marker for the finalized strings", () => {
    expect(read("components/stages/StaleTargetBanner.tsx")).not.toContain("INTERIM-WORDING");
    expect(read("components/stages/S8LensStrip.tsx")).not.toContain("INTERIM-WORDING");
  });
});
