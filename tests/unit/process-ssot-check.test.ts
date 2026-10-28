// ADR-0187 P1: one failing fixture (reproducing the finding) and one clean case per validator.
// ADR-0187 P2: blocking mode, verified declared consumers, exemptions, the
// ADR-backed allowlist and the flow.spec procedureSteps scope.
import { describe, expect, test } from "bun:test";
import {
  ACTIVITY_AGENT_ALLOWLIST,
  BLOCKING_CHECKS,
  CHECK_IDS,
  activityStepScope,
  checkActivityAgentInProcedure,
  checkChecklistConsumers,
  checkEngineSpecParity,
  checkKillRegistryParity,
  checkReviewCoverage,
  checkS12Coverage,
  checkStageInputs,
  checkStagesDerived,
  extractEngineBlockers,
  isBlocking,
  policyGapRows,
  policySectionKeys,
  runAll,
  type FlowSpec,
  type Procedure,
} from "../../scripts/co-newbiz/process-ssot-check.ts";

const proc = (
  name: string,
  steps: Partial<Procedure["steps"][number]>[],
  applies_when?: Procedure["applies_when"],
): Procedure => ({
  name,
  applies_when,
  steps: steps.map((s, i) => ({ id: String(i + 1), text: "", ...s })),
});

describe("check-engine-spec-parity (H8)", () => {
  const src = [
    "const X = {",
    "  S8: ({ project }) => {",
    '    missing.push("Business Case");',
    '    missing.push("채택 Business Case");',
    "    missing.push(...est.missing);",
    "  },",
    "};",
  ].join("\n");
  test("undeclared engine blocker, unenforced artifact, computed label", () => {
    const spec: FlowSpec = { stages: [{ id: "S8", requiredArtifacts: ["Business Case", "NPV"] }] };
    const msgs = checkEngineSpecParity(spec, extractEngineBlockers(src)).map((f) => f.message);
    expect(msgs.some((m) => m.includes('"채택 Business Case" is not a flow.spec requiredArtifact'))).toBe(true);
    expect(msgs.some((m) => m.includes('"NPV" has no engine blocker'))).toBe(true);
    expect(msgs.some((m) => m.includes("1 engine missing.push"))).toBe(true);
  });
  test("clean", () => {
    const clean = 'const X = {\n  S8: () => {\n    missing.push("Business Case");\n  },\n};';
    expect(
      checkEngineSpecParity(
        { stages: [{ id: "S8", requiredArtifacts: ["Business Case"] }] },
        extractEngineBlockers(clean),
      ),
    ).toEqual([]);
  });
});

describe("check-checklist-consumers (H9)", () => {
  const chk = [{ stem: "legal-regulatory-checklist", docId: "chk-legal-regulatory", hasMandatory: true }];
  test("checklist with no producer and no consumer", () => {
    const f = checkChecklistConsumers(
      chk,
      [proc("legal-dd", [{ text: "legal_basis chk-legal-regulatory" }])],
      new Map([["lib/a.ts", "nothing"]]),
    );
    expect(f.length).toBe(2);
  });
  test("clean", () => {
    const f = checkChecklistConsumers(
      chk,
      [proc("bf-screening", [{ text: "per checklists/legal-regulatory-checklist.yaml" }])],
      new Map([["lib/gate.ts", 'const ids = ["chk-legal-regulatory"];']]),
    );
    expect(f).toEqual([]);
  });
});

describe("check-checklist-consumers declarations (P2)", () => {
  const chk = [{ stem: "legal-dd-checklist", docId: "chk-legal-dd", hasMandatory: true }];
  const hosted = [proc("dd", [{ text: "per checklists/legal-dd-checklist.yaml" }])];
  const decl = [{ docId: "chk-legal-dd-checklist", module: "lib/library.ts", symbol: "DD_WORKSPACE_CHECKLISTS", gate: "dd" }];
  test("a verified declared consumer counts", () => {
    const src = 'export const DD_WORKSPACE_CHECKLISTS = { legal: "chk-legal-dd-checklist" };';
    const f = checkChecklistConsumers(chk, hosted, new Map(), { consumers: decl, exemptions: [], moduleSource: () => src });
    expect(f).toEqual([]);
  });
  test("a declaration the module does not hold is itself a finding", () => {
    const f = checkChecklistConsumers(chk, hosted, new Map(), { consumers: decl, exemptions: [], moduleSource: () => "nothing" });
    expect(f.map((x) => x.message).join("\n")).toContain("declared consumer of chk-legal-dd-checklist does not hold");
    expect(f.some((x) => x.message.includes("no gate consumer"))).toBe(true);
  });
  test("an exemption silences only its side", () => {
    const f = checkChecklistConsumers(chk, [], new Map(), {
      consumers: [],
      exemptions: [{ docId: "chk-legal-dd", side: "consumer", reason: "human-judged" }],
      moduleSource: () => undefined,
    });
    expect(f.map((x) => x.message)).toEqual([
      "legal-dd-checklist (chk-legal-dd): no producer - no step of a flow.spec-hosted procedure cites checklists/legal-dd-checklist.yaml",
    ]);
  });
});

describe("activity-agent-in-procedure (M2)", () => {
  const spec: FlowSpec = {
    stages: [
      { id: "S9", activities: [{ id: "financial-dd", agent: "financial-analyst", procedure: ["brownfield-dd"] }] },
    ],
  };
  test("activity agent holds no step", () => {
    const f = checkActivityAgentInProcedure(
      spec,
      new Map([["brownfield-dd", proc("brownfield-dd", [{ agent_key: "legal-counsel" }])]]),
    );
    expect(f[0].message).toContain("'financial-analyst' holds no step in procedure 'brownfield-dd'");
  });
  test("clean", () => {
    expect(
      checkActivityAgentInProcedure(
        spec,
        new Map([["brownfield-dd", proc("brownfield-dd", [{ agent_key: "financial-analyst" }])]]),
      ),
    ).toEqual([]);
  });
});

describe("activity-agent-in-procedure allowlist (P2)", () => {
  test("every entry is a pm lead-only activity with an ADR reference", () => {
    expect(ACTIVITY_AGENT_ALLOWLIST.length).toBe(10);
    for (const e of ACTIVITY_AGENT_ALLOWLIST) expect(e.adr).toMatch(/ADR-0(104|185)/);
    const spec: FlowSpec = {
      stages: [{ id: "S4", activities: [{ id: "route-strategy", agent: "pm", procedure: ["deal-shape-chain"] }] }],
    };
    expect(checkActivityAgentInProcedure(spec, new Map([["deal-shape-chain", proc("deal-shape-chain", [])]]))).toEqual([]);
  });
});

describe("check-kill-registry-parity (M4)", () => {
  const policy = "## 4. Kill\n| 1 | a | `p__a` |\n| 4 | b | Green Field: no registry entry yet |\n## 5. Next\n`p__z`";
  test("policy, registry and spec disagree", () => {
    const f = checkKillRegistryParity({
      registryKeys: ["p__a", "p__orphan"],
      specKeys: ["p__a", "p__missing"],
      policyKeys: policySectionKeys(policy),
      policyGapRows: policyGapRows(policy),
      policyKoKeys: [],
    });
    const msgs = f.map((x) => x.message).join("\n");
    expect(msgs).toContain("'p__missing', which has no registry entry");
    expect(msgs).toContain("'p__orphan' binds at no flow.spec gate");
    expect(msgs).toContain("row 4");
    expect(msgs).toContain("en/ko drift");
    expect(policySectionKeys(policy)).toEqual(["p__a"]);
  });
  test("clean", () => {
    expect(
      checkKillRegistryParity({
        registryKeys: ["p__a"],
        specKeys: ["p__a"],
        policyKeys: ["p__a"],
        policyKoKeys: ["p__a"],
        policyGapRows: [],
      }),
    ).toEqual([]);
  });
});

describe("check-stage-inputs (M9)", () => {
  const stages = (withMarket: boolean) =>
    ["S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12"].map((id) => ({
      id,
      inputs: withMarket || id !== "S5" ? ["진입시장 산정 (S2)"] : ["기타"],
    }));
  test("S5 lacks the entry market", () => {
    const f = checkStageInputs({ stages: stages(false) });
    expect(f.map((x) => x.message)).toEqual(["S5: inputs do not declare the S2 entry market"]);
  });
  test("clean", () => expect(checkStageInputs({ stages: stages(true) })).toEqual([]));
});

describe("check-review-coverage (M7/M8)", () => {
  const spec: FlowSpec = {
    gates: [{ id: "screening" }, { id: "target_screening" }, { id: "fs" }],
    stages: [
      {
        id: "S3",
        outputs: ["시너지 평가", "시너지 점수"],
        requiredArtifacts: ["시너지 평가"],
        activities: [{ id: "a", agent: "financial-analyst" }],
      },
    ],
  };
  const domains = new Map([["financial-analyst", "functional"]]);
  test("unregistered output, uncovered gate, fallback resolution", () => {
    const msgs = checkReviewCoverage({
      spec,
      agentDomains: domains,
      reviewGates: ["screening"],
      namedExceptions: ["target_screening"],
      matrix: null,
    }).map((f) => f.message);
    expect(msgs.length).toBe(3);
    expect(msgs.join("\n")).toContain('"시너지 점수" is not in the review registry');
    expect(msgs.join("\n")).toContain("gate 'fs'");
    expect(msgs.join("\n")).toContain("matrix file absent");
  });
  test("clean", () => {
    const clean: FlowSpec = {
      gates: [{ id: "screening" }],
      stages: [{ ...spec.stages![0], outputs: ["시너지 평가"] }],
    };
    expect(
      checkReviewCoverage({
        spec: clean,
        agentDomains: domains,
        reviewGates: ["screening"],
        namedExceptions: [],
        matrix: [{ author_domain: "functional", reviewer: "risk-officer" }],
      }),
    ).toEqual([]);
  });
});

describe("check-s12-coverage (M17)", () => {
  const spec: FlowSpec = {
    stages: [
      { id: "S12", activities: [{ id: "portfolio-monitoring", agent: "group-review-agent", procedure: ["pvm"] }] },
    ],
  };
  const cell = { case_type: "brownfield", origin: "external", sub_track: "minority_investment" };
  test("brownfield external minority matches no S12 activity", () => {
    const pvm = proc("pvm", [{}], { op: "in", var: "project.origin", values: ["internal", "hybrid", "joint"] });
    expect(checkS12Coverage(spec, new Map([["pvm", pvm]]), [cell]).length).toBe(1);
  });
  test("clean once applies_when is widened (D8)", () => {
    const pvm = proc("pvm", [{}], {
      op: "any_of",
      of: [
        { op: "in", var: "project.origin", values: ["internal", "hybrid", "joint"] },
        { op: "in", var: "project.sub_track", values: ["minority_investment", "rbd", "corporate_venture"] },
      ],
    });
    expect(checkS12Coverage(spec, new Map([["pvm", pvm]]), [cell])).toEqual([]);
  });
});

describe("check-s12-coverage step scope from flow.spec procedureSteps (P2)", () => {
  const cell = { case_type: "brownfield", origin: "external", sub_track: "m_and_a" };
  const pmi = proc("pmi", [
    { id: "1", applies_when: { op: "cmp", var: "project.sub_track", cmp: "eq", value: "m_and_a" } },
    { id: "6", applies_when: { op: "cmp", var: "project.sub_track", cmp: "eq", value: "jv" } },
  ]);
  const spec = (steps?: Record<string, string[]>): FlowSpec => ({
    stages: [{ id: "S12", activities: [{ id: "integration-monitoring", agent: "pmi-agent", procedure: ["pmi"], procedureSteps: steps }] }],
  });
  test("a declared scope restricts the match to those steps", () => {
    expect(activityStepScope({ id: "x", agent: "a", procedureSteps: { pmi: [6] } }, "pmi")).toEqual(["6"]);
    expect(checkS12Coverage(spec({ pmi: ["6"] }), new Map([["pmi", pmi]]), [cell]).length).toBe(1);
  });
  test("no declared scope = the whole procedure", () => {
    expect(checkS12Coverage(spec(), new Map([["pmi", pmi]]), [cell])).toEqual([]);
  });
});

describe("blocking mode (P2)", () => {
  test("parity (P3) and review coverage (P4) stay report-only; the rest block", () => {
    expect([...BLOCKING_CHECKS].sort()).toEqual(
      CHECK_IDS.filter((c) => c !== "check-engine-spec-parity" && c !== "check-review-coverage").sort(),
    );
    expect(isBlocking({ check: "check-review-coverage", message: "" })).toBe(false);
    expect(isBlocking({ check: "check-s12-coverage", message: "" })).toBe(true);
  });
  test("the repository tree has zero blocking findings", () => {
    expect(runAll().filter(isBlocking)).toEqual([]);
  });
});

describe("check-stages-derived (M3)", () => {
  const spec: FlowSpec = { gates: [{ id: "screening" }, { id: "pre_fs" }] };
  const aliases = { Screening: { stage: "G1" }, "Pre-FS": { stage: "G3" }, post_close: { stage: "G8" } };
  test("pre-v2 order is reported", () => {
    const f = checkStagesDerived(spec, aliases, [
      { id: "G1", title: "Screening", order: 1 },
      { id: "G3", title: "Pre-FS", order: 3 },
      { id: "G8", title: "Post-Close", order: 2 },
    ]);
    expect(f.length).toBe(2);
  });
  test("clean", () => {
    expect(
      checkStagesDerived(spec, aliases, [
        { id: "G1", title: "Screening", order: 1 },
        { id: "G3", title: "Pre-FS", order: 2 },
        { id: "G8", title: "Post-Close", order: 3 },
      ]),
    ).toEqual([]);
  });
});
