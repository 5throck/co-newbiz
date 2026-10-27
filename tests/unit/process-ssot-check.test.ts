// ADR-0187 P1: one failing fixture (reproducing the finding) and one clean case per validator.
import { describe, expect, test } from "bun:test";
import {
  checkActivityAgentInProcedure,
  checkChecklistConsumers,
  checkEngineSpecParity,
  checkKillRegistryParity,
  checkReviewCoverage,
  checkS12Coverage,
  checkStageInputs,
  checkStagesDerived,
  extractEngineBlockers,
  policyGapRows,
  policySectionKeys,
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
