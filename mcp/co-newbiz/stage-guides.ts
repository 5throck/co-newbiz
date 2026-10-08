// @version 1.0.0
/**
 * MCP stage guides and flow-spec resources — ADR-0154 §7, design 2026-10-08
 * wave-m-mcp-parity §7 (Wave M M-3).
 *
 * The prompts stage_guide_s1..s12 and the flowspec:// resources are generated
 * from process/flow.spec.yaml (stage-guides.generated.ts, drift-gated). A guide
 * names the stage, its activities, required artifacts, procedure keys and gates,
 * and maps each to the tools that serve it. It never restates procedure steps:
 * boundary #3 says procedures/*.yaml is authoritative for what and when, so the
 * guide points to get_procedure.
 */

import { GUIDE_SPEC_VERSION, GUIDE_STAGES } from "./stage-guides.generated.ts";

export interface StageGuideSpec {
  id: string;
  name: string;
  objective: string;
  applicableTracks: string[];
  gates: string[];
  activities: Array<{ id: string; agent: string; procedure: string[] }>;
  requiredArtifacts: string[];
  completionCriteria: string[];
}

/** The tool facts a guide needs; RegistryTool satisfies this structurally. */
export interface GuideTool {
  name: string;
  kind: string;
  stageActivities: readonly string[];
  stageArtifacts: readonly string[];
}

export const STAGE_IDS: readonly string[] = GUIDE_STAGES.map((s) => s.id);

export function promptName(stageId: string): string {
  return `stage_guide_${stageId.toLowerCase()}`;
}

export function getStageSpec(stageId: string): StageGuideSpec | undefined {
  return GUIDE_STAGES.find((s) => s.id.toLowerCase() === stageId.toLowerCase());
}

function toolNames(tools: readonly GuideTool[], pick: (t: GuideTool) => boolean): string {
  const names = tools.filter(pick).map((t) => t.name);
  return names.length > 0 ? names.join(", ") : "(no tool: a person does this in the web app)";
}

/** Render the guide for one stage. Pure: spec slice + tool metadata in, text out. */
export function renderStageGuide(stage: StageGuideSpec, tools: readonly GuideTool[]): string {
  const lines: string[] = [];
  lines.push(`# ${stage.id} ${stage.name}`, "", `Objective: ${stage.objective}`);
  lines.push(`Tracks: ${stage.applicableTracks.join(", ") || "all"}`, "");

  lines.push("## Activities");
  for (const a of stage.activities) {
    lines.push(
      `- ${a.id} (agent: ${a.agent})`,
      `  procedure keys: ${a.procedure.join(", ") || "none"}`,
      `  tools: ${toolNames(tools, (t) => t.stageActivities.includes(a.id))}`,
    );
  }

  lines.push("", "## Required artifacts");
  stage.requiredArtifacts.forEach((artifact, i) => {
    const key = `${stage.id}:${i + 1}`;
    lines.push(`- ${artifact}`, `  tools: ${toolNames(tools, (t) => t.stageArtifacts.includes(`stage:${key}`))}`);
  });

  if (stage.completionCriteria.length > 0) {
    lines.push("", "## Completion criteria", ...stage.completionCriteria.map((c) => `- ${c}`));
  }

  lines.push("", "## Gates");
  if (stage.gates.length === 0) lines.push("- none");
  for (const g of stage.gates) {
    lines.push(`- ${g}: a person decides. Use propose_gate_decision to submit a proposal; it is only recorded after a human confirms it in the web app.`);
  }

  const procedures = [...new Set(stage.activities.flatMap((a) => a.procedure))];
  lines.push(
    "",
    "## How to work this stage",
    `1. Call get_process_evaluation to see where the deal stands (spec ${GUIDE_SPEC_VERSION}).`,
    `2. For the steps of each procedure key (${procedures.join(", ") || "none"}), call get_procedure; this guide does not restate them.`,
    "3. Call the tools above to produce evidence; every output is a proposal that a person reviews.",
    "4. Gate approval, the investment decision and project closure belong to people. Never present a draft as decided.",
  );
  return lines.join("\n");
}

export function flowspecIndex(): { spec_version: string; stages: Array<{ id: string; name: string; prompt: string }> } {
  return {
    spec_version: GUIDE_SPEC_VERSION,
    stages: GUIDE_STAGES.map((s) => ({ id: s.id, name: s.name, prompt: promptName(s.id) })),
  };
}
