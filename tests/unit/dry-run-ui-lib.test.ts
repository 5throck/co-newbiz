// @version 1.0.0
// Dry-run UX overhaul (2026-10-26-dryrun-ux-wiki-image-design): pure helper tests — primary-action
// selection by session state (§3 table), hash tabs, agent grouping (§5), list filters (§6) — plus
// catalog hygiene (§4/§10: no internal references in visible copy, ko/en key parity).
import { test, expect, describe } from "bun:test";
import {
  agentGroupOf,
  defaultTab,
  filterSessions,
  groupAgents,
  planActions,
  shortId,
  statusCounts,
  tabForAction,
  tabFromHash,
} from "../../app/web-next/app/flows/dry-run/dry-run-ui-lib.ts";
import ko from "../../app/web-next/locales/ko.json";
import en from "../../app/web-next/locales/en.json";

describe("planActions — one state-dependent primary (design §3)", () => {
  test("no runs yet -> Run primary; export + apply in More", () => {
    expect(planActions(false, false)).toEqual({ primary: "run", secondary: ["export", "apply"] });
    expect(planActions(false, true).primary).toBe("run");
  });
  test("runs + unsaved edit -> Apply primary", () => {
    expect(planActions(true, true)).toEqual({ primary: "apply", secondary: ["run", "export"] });
  });
  test("runs + no pending edit -> Export primary", () => {
    expect(planActions(true, false)).toEqual({ primary: "export", secondary: ["run", "apply"] });
  });
  test("apply lives in the edit tab; run/export live in the run tab", () => {
    expect(tabForAction("apply")).toBe("edit");
    expect(tabForAction("run")).toBe("run");
    expect(tabForAction("export")).toBe("run");
  });
});

describe("tabs", () => {
  test("hash maps to a tab; unknown hash is null", () => {
    expect(tabFromHash("#history")).toBe("history");
    expect(tabFromHash("suggest")).toBe("suggest");
    expect(tabFromHash("#nope")).toBeNull();
    expect(tabFromHash("")).toBeNull();
  });
  test("default tab: run when runs exist, else edit", () => {
    expect(defaultTab(true)).toBe("run");
    expect(defaultTab(false)).toBe("edit");
  });
});

describe("agent grouping", () => {
  const a = (key: string, domain: string | null) => ({ key, name: key, role: null, domain });
  const roster = [a("b-ind", "industry"), a("a-fun", "functional"), a("c-shared", "_shared"), a("d-null", null), a("e-reg", "region"), a("f-tech", "technical")];
  test("unknown / shared / null domains go to other", () => {
    expect(agentGroupOf("_shared")).toBe("other");
    expect(agentGroupOf(null)).toBe("other");
    expect(agentGroupOf("other")).toBe("other");
    expect(agentGroupOf("region")).toBe("region");
  });
  test("groups come in the fixed domain order and empty groups are dropped", () => {
    expect(groupAgents(roster, "").map((g) => g.group)).toEqual(["functional", "technical", "industry", "region", "other"]);
    expect(groupAgents([a("x", "region")], "").map((g) => g.group)).toEqual(["region"]);
  });
  test("type-to-filter on key/name", () => {
    const hit = groupAgents(roster, "e-r");
    expect(hit).toHaveLength(1);
    expect(hit[0].agents.map((x) => x.key)).toEqual(["e-reg"]);
    expect(groupAgents(roster, "zzz")).toEqual([]);
  });
});

describe("list helpers", () => {
  const rows = [
    { id: "dr_01AAAAAAAAAAAAAAAAAAAAAAAA", status: "active", purpose: "Tune screening", prompt_key: "p.screen", activity_id: "S3.screen" },
    { id: "dr_01BBBBBBBBBBBBBBBBBBBBBBBB", status: "closed", purpose: "Other", prompt_key: "p.other", activity_id: null },
    { id: "dr_01CCCCCCCCCCCCCCCCCCCCCCCC", status: "expired", purpose: "Old", prompt_key: "p.old", activity_id: null },
  ];
  test("counts use the real status set", () => {
    expect(statusCounts(rows)).toEqual({ all: 3, active: 1, closed: 1, expired: 1 });
  });
  test("filter by status and by purpose / id / activity", () => {
    expect(filterSessions(rows, "closed", "")).toHaveLength(1);
    expect(filterSessions(rows, "all", "screening")).toHaveLength(1);
    expect(filterSessions(rows, "all", "S3.screen")).toHaveLength(1);
    expect(filterSessions(rows, "all", "bbbb")).toHaveLength(1);
    expect(filterSessions(rows, "active", "other")).toHaveLength(0);
  });
  test("shortId uses the random ULID tail, not the shared timestamp head", () => {
    expect(shortId("dr_01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe("Q69G5FAV");
  });
});

describe("catalog hygiene (design §4 / §10)", () => {
  const BANNED = /§|벤치|bench\s|llm_call_log|is_dry_run|dry_run_group_id/i;
  const flatten = (o: unknown, prefix = ""): Record<string, string> =>
    Object.entries(o as Record<string, unknown>).reduce<Record<string, string>>((acc, [k, v]) => {
      if (typeof v === "string") acc[prefix + k] = v;
      else if (v && typeof v === "object") Object.assign(acc, flatten(v, `${prefix}${k}.`));
      return acc;
    }, {});
  for (const [name, cat] of [["ko", ko], ["en", en]] as const) {
    test(`${name}: dryRunSession + chips carry no internal references`, () => {
      const fl = (cat as any).pages.flows;
      for (const [k, v] of Object.entries({ ...flatten(fl.dryRunSession, "dryRunSession."), ...flatten(fl.chips, "chips.") })) {
        expect(v, k).not.toMatch(BANNED);
      }
    });
  }
  test("ko and en have identical key sets for touched namespaces", () => {
    const keys = (c: any) => ({
      dry: Object.keys(c.pages.flows.dryRunSession).sort(),
      chips: Object.keys(c.pages.flows.chips).sort(),
      wiki: Object.keys(c.pages.wiki).sort(),
    });
    expect(keys(ko)).toEqual(keys(en));
  });
});
