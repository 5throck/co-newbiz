/**
 * ADR-0193 PR-A: kill-criteria registry stage scoping (`evaluable_from` / `reevaluate_at`).
 * Data + validator only - the snapshot classifier that reads the fields is PR-B.
 * Covers design 2026-11-07 section 7 test 9 and the risk-officer C-2 condition:
 * missing fields, unknown stage, compound reevaluate_at, reevaluate_at earlier than
 * evaluable_from, evaluable_from earlier than the var->stage map, plus the real registry
 * and flow.spec staying consistent.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import {
  OPEN_MONITORING,
  checkReevaluateBinding,
  checkStageScopingFields,
  flowShapeFromSpec,
  gateStage,
  type RegistryEntry,
} from "../../packages/core-scoring/src/kill-criteria.ts";
import { KILL_VAR_MIN_STAGE } from "../../db/lib/kill-var-stages.ts";
import { collectPredicateVars } from "../../db/lib/applies-when.ts";
import { parsePredicate } from "../../db/lib/predicate.ts";
import { checkKillRegistryParity, type FlowSpec } from "../../scripts/co-newbiz/process-ssot-check.ts";

const ROOT = join(import.meta.dir, "..", "..");
const REG_DIR = join(ROOT, "procedures", "_kill-criteria");
const spec = yamlLoad(readFileSync(join(ROOT, "process", "flow.spec.yaml"), "utf8")) as FlowSpec;
const flow = flowShapeFromSpec(spec);

const registry = readdirSync(REG_DIR)
  .filter((f) => f.includes("__") && f.endsWith(".json"))
  .map((f) => ({ key: f.replace(/\.json$/, ""), entry: JSON.parse(readFileSync(join(REG_DIR, f), "utf8")) as RegistryEntry }));

describe("checkStageScopingFields (ADR-0193 section 4.1)", () => {
  const ok = { evaluable_from: "S6", reevaluate_at: "pre_fs", evaluable_from_evidence: "screening.viable_targets <- longlist" };

  test("a complete entry is clean", () => {
    expect(checkStageScopingFields(ok, ["screening.viable_targets"], KILL_VAR_MIN_STAGE)).toEqual([]);
  });
  test("missing evaluable_from and reevaluate_at are each rejected", () => {
    expect(checkStageScopingFields({ reevaluate_at: "pre_fs" }).join("|")).toMatch(/missing required field 'evaluable_from'/);
    expect(checkStageScopingFields({ evaluable_from: "S6" }).join("|")).toMatch(/missing required field 'reevaluate_at'/);
    expect(checkStageScopingFields({ evaluable_from: "", reevaluate_at: " " })).toHaveLength(2);
  });
  test("an unknown stage id is rejected", () => {
    for (const bad of ["S0", "S13", "s6", "stage6", "screening"]) {
      expect(checkStageScopingFields({ ...ok, evaluable_from: bad }).join("|")).toMatch(/not a flow stage/);
    }
  });
  test("compound reevaluate_at values are rejected (risk-officer C-2)", () => {
    for (const compound of ["screening|pre_fs", "screening,pre_fs", "screening/pre_fs", "screening or pre_fs", "screening pre_fs", "pre_fs;dd", "Pre_FS"]) {
      expect(checkStageScopingFields({ ...ok, reevaluate_at: compound }).join("|")).toMatch(/not a single gate id/);
    }
  });
  test("open_monitoring is reserved for S12", () => {
    expect(checkStageScopingFields({ evaluable_from: "S12", reevaluate_at: OPEN_MONITORING })).toEqual([]);
    expect(checkStageScopingFields({ evaluable_from: "S9", reevaluate_at: OPEN_MONITORING }).join("|")).toMatch(/reserved for S12/);
  });
  test("evaluable_from earlier than the var->stage map minimum is rejected", () => {
    const early = checkStageScopingFields({ ...ok, evaluable_from: "S3" }, ["screening.viable_targets"], KILL_VAR_MIN_STAGE);
    expect(early.join("|")).toMatch(/earlier than S6/);
    // at least as late as the latest variable
    const multi = checkStageScopingFields({ ...ok, evaluable_from: "S5" }, ["infra.plan_finalized", "screening.viable_targets"], KILL_VAR_MIN_STAGE);
    expect(multi).toHaveLength(1);
  });
  test("a predicate variable absent from the var->stage map is rejected", () => {
    expect(checkStageScopingFields(ok, ["brand.new_var"], KILL_VAR_MIN_STAGE).join("|")).toMatch(/no stage in the kill-criteria var->stage map/);
  });
  test("empty evidence string is rejected when the field is present", () => {
    expect(checkStageScopingFields({ ...ok, evaluable_from_evidence: "  " }).join("|")).toMatch(/evaluable_from_evidence/);
  });
});

describe("checkReevaluateBinding (flow.spec binding)", () => {
  test("a gate that does not exist in flow.spec is rejected", () => {
    expect(checkReevaluateBinding({ evaluable_from: "S5", reevaluate_at: "no_such_gate" }, flow).join("|")).toMatch(/names no gate/);
  });
  test("reevaluate_at earlier than evaluable_from is rejected", () => {
    expect(checkReevaluateBinding({ evaluable_from: "S9", reevaluate_at: "screening" }, flow).join("|")).toMatch(/earlier than evaluable_from/);
    expect(checkReevaluateBinding({ evaluable_from: "S7", reevaluate_at: "pre_fs" }, flow).join("|")).toMatch(/earlier than evaluable_from/);
  });
  test("a gate at or after evaluable_from is accepted; deal-shape #9 binds the single gate pre_fs", () => {
    expect(checkReevaluateBinding({ evaluable_from: "S4", reevaluate_at: "pre_fs" }, flow)).toEqual([]);
    expect(checkReevaluateBinding({ evaluable_from: "S11", reevaluate_at: "entity_ic" }, flow)).toEqual([]);
  });
  test("open_monitoring binds no gate", () => {
    expect(checkReevaluateBinding({ evaluable_from: "S12", reevaluate_at: OPEN_MONITORING }, flow)).toEqual([]);
  });
  test("a gate's stage is its last hosting stage", () => {
    expect(gateStage(flow, "screening")).toBe("S4");
    expect(gateStage(flow, "pre_fs")).toBe("S6");
    expect(gateStage(flow, "dd")).toBe("S9");
  });
});

describe("the real registry (44 entries)", () => {
  test("every entry declares valid evaluable_from / reevaluate_at, var map respected, bound to flow.spec", () => {
    expect(registry).toHaveLength(44);
    const problems: string[] = [];
    for (const { key, entry } of registry) {
      const vars = entry.predicate == null ? [] : [...collectPredicateVars(parsePredicate(entry.predicate))];
      for (const p of [...checkStageScopingFields(entry, vars, KILL_VAR_MIN_STAGE), ...checkReevaluateBinding(entry, flow)]) problems.push(`${key}: ${p}`);
      expect(typeof entry.evaluable_from_evidence).toBe("string");
    }
    expect(problems).toEqual([]);
  });

  test("design section 8 / section 12 rulings are in the data", () => {
    const at = (k: string) => registry.find((r) => r.key === k)!.entry;
    // #35 clean-team breach: S9 (C-6)
    expect(at("pmi-integration-execution__clean_team_protocol_breach")).toMatchObject({ evaluable_from: "S9", reevaluate_at: "dd" });
    // #36/#37 S12 monitoring carries
    for (const k of ["key_talent_attrition_above_threshold_at_90d", "synergy_run_rate_uncertified_at_bau_handover"])
      expect(at(`pmi-integration-execution__${k}`)).toMatchObject({ evaluable_from: "S12", reevaluate_at: "open_monitoring" });
    // #9 single gate pre_fs (C-2)
    expect(at("deal-shape-chain__no_viable_deal_shape")).toMatchObject({ evaluable_from: "S4", reevaluate_at: "pre_fs" });
    // #6/#10/#11 partner criteria at S5 (Q3); re-scoped to fs by ruling 14.1/14.2 (project-scoped sources, no proxy)
    for (const k of ["greenfield-screening__partner_dependency_unconfirmed_and_no_alternative", "deal-shape-chain__partner_dd_red_financial_distress", "deal-shape-chain__partner_dd_red_ip_chain"])
      expect(at(k)).toMatchObject({ evaluable_from: "S5", reevaluate_at: "fs" });
    expect(at("brownfield-dd__partner_dependency_unconfirmed_and_no_alternative")).toMatchObject({ evaluable_from: "S9", reevaluate_at: "dd" });
    // the S3 screening acks the design moves to not_reached; #4/#5/#6/#8 re-scoped to fs (ruling 14.1), #7 keeps pre_fs (opportunity-scope source)
    const five: Array<[string, string, string]> = [
      ["brownfield-screening__no_viable_target_in_longlist", "S6", "pre_fs"],
      ["brownfield-screening__preliminary_hhi_flags_certain_block", "S7", "fs"],
      ["greenfield-screening__zero_site_clears_infrastructure_minimums", "S5", "fs"],
      ["greenfield-screening__infrastructure_plan_not_finalized_at_site_announcement", "S5", "fs"],
      ["greenfield-screening__partner_dependency_unconfirmed_and_no_alternative", "S5", "fs"],
    ];
    for (const [k, from, to] of five) expect(at(k)).toMatchObject({ evaluable_from: from, reevaluate_at: to });
    // ruling 14.1 RESCOPE-2: #12/#13 (project-scoped wacc / certification sources) are re-evaluated at fs, evaluable_from unchanged; #9 stays at pre_fs
    for (const t of ["greenfield", "brownfield"]) {
      expect(at(`${t}-pre-fs__wacc_hurdle_still_assumed`)).toMatchObject({ evaluable_from: "S4", reevaluate_at: "fs" });
      expect(at(`${t}-pre-fs__certification_transferability_unconfirmed_and_load_bearing`)).toMatchObject({ evaluable_from: "S4", reevaluate_at: "fs" });
    }
    // every re-scoped entry says why (project-scoped source, first project gate fs)
    for (const k of [
      "greenfield-screening__zero_site_clears_infrastructure_minimums", "greenfield-screening__infrastructure_plan_not_finalized_at_site_announcement",
      "greenfield-screening__partner_dependency_unconfirmed_and_no_alternative", "brownfield-screening__preliminary_hhi_flags_certain_block",
      "deal-shape-chain__partner_dd_red_financial_distress", "deal-shape-chain__partner_dd_red_ip_chain",
      "greenfield-pre-fs__wacc_hurdle_still_assumed", "brownfield-pre-fs__wacc_hurdle_still_assumed",
      "greenfield-pre-fs__certification_transferability_unconfirmed_and_load_bearing", "brownfield-pre-fs__certification_transferability_unconfirmed_and_load_bearing",
    ]) expect(String(at(k).evaluable_from_evidence)).toMatch(/project-scoped source.*fs, the first project gate|deferred to fs, the first project gate/);
    // S3-reached criteria stay at the screening gate (no ack lost)
    for (const k of ["market_structurally_unattractive", "data_confidence_not_judgeable", "strategic_fit_knock_out_failed"])
      for (const t of ["greenfield", "brownfield"]) expect(at(`${t}-screening__${k}`)).toMatchObject({ evaluable_from: "S3", reevaluate_at: "screening" });
  });

  test("no entry evaluates before its gate: reevaluate_at is never an earlier stage than evaluable_from", () => {
    for (const { entry } of registry) expect(checkReevaluateBinding(entry, flow)).toEqual([]);
  });
});

describe("check-kill-registry-parity scoping extension", () => {
  const base = { registryKeys: ["p__a"], specKeys: ["p__a"], policyKeys: [] };
  test("clean when reevaluate_at names a gate at/after evaluable_from", () => {
    expect(checkKillRegistryParity({ ...base, spec, registryScoping: [{ key: "p__a", evaluable_from: "S5", reevaluate_at: "pre_fs" }] })).toEqual([]);
  });
  test("flags a missing gate, an early gate, and missing fields", () => {
    const f = checkKillRegistryParity({
      ...base,
      spec,
      registryScoping: [
        { key: "p__a", evaluable_from: "S5", reevaluate_at: "nope" },
        { key: "p__b", evaluable_from: "S9", reevaluate_at: "screening" },
        { key: "p__c" },
      ],
    });
    expect(f.map((x) => x.message).join("\n")).toMatch(/p__a.*names no gate/s);
    expect(f.map((x) => x.message).join("\n")).toMatch(/p__b.*earlier than evaluable_from/s);
    expect(f.map((x) => x.message).join("\n")).toMatch(/p__c.*lacks evaluable_from/s);
  });
  test("callers that omit the scoping inputs keep the old behaviour", () => {
    expect(checkKillRegistryParity(base)).toEqual([]);
  });
});
