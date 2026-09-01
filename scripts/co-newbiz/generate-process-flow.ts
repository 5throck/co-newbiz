// Process Flow Spec → docs/process-flow.md generator (ADR-0074).
// process/flow.spec.yaml is the SSOT; this script regenerates the markdown
// reference. The drift test (tests/unit/process-flow.test.ts) validates the
// spec and asserts the generated document is up to date.
//
// Usage: bun scripts/co-newbiz/generate-process-flow.ts [--check]
//   --check : exit 1 if docs/process-flow.md would change (CI mode).
import { readFileSync, writeFileSync } from "node:fs";
import * as yaml from "js-yaml";

const SPEC_PATH = "process/flow.spec.yaml";
const DOC_PATH = "docs/process-flow.md";

interface Gate {
  id: string;
  name: string;
  decisionCriteria: string[];
  killCriteria: string[];
  fundingDecision: string;
}
interface Activity {
  id: string;
  agent: string;
  skills: string[];
  procedure: string[];
}
interface Stage {
  id: string;
  name: string;
  objective: string;
  inputs: string[];
  outputs: string[];
  entryCriteria: string[];
  activities: Activity[];
  requiredArtifacts: string[];
  completionCriteria: string[];
  applicableTracks: string[];
  stateTransitions: { onComplete: string; onHold: string; onKill: string };
  gates: string[];
}
interface FlowSpec {
  meta: { id: string; name: string; version: string; entity_lifecycles: Record<string, string[]> };
  gates: Gate[];
  stages: Stage[];
}

const spec = yaml.load(readFileSync(SPEC_PATH, "utf8")) as FlowSpec;

const HEADER = `# Process Flow — 신규사업 검토 프로세스 (생성 문서)

> **⚠ 이 문서는 생성물입니다.** \`process/flow.spec.yaml\`(SSOT, ADR-0074)에서
> \`bun scripts/co-newbiz/generate-process-flow.ts\`로 생성됩니다. 이 파일을
> 직접 수정하지 마세요 — 수정은 사양에서, 본 문서는 참조용으로.
> 설계 철학·원칙·베스트 프랙티스는 \`docs/design-guide.md\`와 ADR-0074를 참고하세요.

`;

function list(items: string[]): string {
  return items.length ? items.map((i) => `- ${i}`).join("\n") : "- (없음)";
}

function stageSection(s: Stage): string {
  const gates = s.gates.map((g) => {
    const gd = spec.gates.find((x) => x.id === g);
    if (!gd) return `### Gate: ${g} (정의 없음!)`;
    return [
      `### Gate: ${gd.name} (${gd.id})`,
      "",
      "**판정 기준**",
      list(gd.decisionCriteria),
      "",
      "**Kill 기준**",
      list(gd.killCriteria),
      "",
      `**자원 결정**: ${gd.fundingDecision}`,
    ].join("\n");
  });
  return [
    `## ${s.id} — ${s.name}${trackTag(s)}`,
    "",
    `**목표**: ${s.objective}`,
    "",
    "**입력**",
    list(s.inputs),
    "",
    "**Activities**",
    s.activities
      .map((a) => `- ${a.id} · agent: \`${a.agent}\` · skills: ${a.skills.map((x) => `\`${x}\``).join(", ")} · procedure: ${a.procedure.map((x) => `\`${x}\``).join(", ")}`)
      .join("\n"),
    "",
    "**필수 산출물**",
    list(s.requiredArtifacts),
    "",
    "**완료 기준**",
    list(s.completionCriteria),
    "",
    `**적용 트랙**: ${s.applicableTracks.join(", ")}`,
    "",
    "### 게이트",
    gates.join("\n\n"),
  ].join("\n");
}

function trackTag(s: Stage): string {
  if (s.applicableTracks.length === 1) {
    return s.applicableTracks[0] === "greenfield" ? " (greenfield 전용)" : " (brownfield 전용)";
  }
  return "";
}

function generate(spec: FlowSpec): string {
  const parts: string[] = [HEADER];
  parts.push("## 프로세스 흐름 요약\n");
  parts.push(spec.stages.map((s) => `${s.id} ${s.name}${trackTag(s)}`).join(" → ") + "\n");
  parts.push("엔티티 라이프사이클:");
  for (const [entity, stages] of Object.entries(spec.meta.entity_lifecycles)) {
    parts.push(`- ${entity}: ${stages.join(" → ")}`);
  }
  parts.push("");
  parts.push("## 게이트 정의\n");
  for (const g of spec.gates) {
    parts.push(
      `### ${g.name} (${g.id})\n` +
        `**판정 기준**\n${list(g.decisionCriteria)}\n\n**Kill 기준**\n${list(g.killCriteria)}\n\n**자원 결정**: ${g.fundingDecision}\n`,
    );
  }
  parts.push("## 설계 원칙 및 에이전트 오케스트레이션\n");
  parts.push("이 프로세스는 Agentic-first, Human-final 원칩으로 운영된다 — 에이전트가 스테이지를 실행·권고하고, 사람은 IC 승인과 예외 개입만 수행한다 (docs/design-guide.md, ADR-0074).\n");
  parts.push("**스테이지별 담당 에이전트(오케스트레이터가 Activities의 agent 필드를 실행)**\n");
  for (const st of spec.stages) {
    const agents = [...new Set(st.activities.map((a) => a.agent))];
    parts.push("- " + st.id + " " + st.name + ": " + agents.map((a) => "`" + a + "`").join(", "));
  }
  parts.push("");
  parts.push("스킬·프로시저 대응은 각 스테이지의 Activities 표를, 전체 매핑 근거는 ADR-0074를 참고한다.\n");
  parts.push("## 스테이지 상세\n");
  for (const s of spec.stages) parts.push(stageSection(s) + "\n");
  return parts.join("\n");
}

const markdown = generate(spec);

if (process.argv.includes("--check")) {
  const current = readFileSync(DOC_PATH, "utf8");
  if (current !== markdown) {
    console.error("docs/process-flow.md is stale — regenerate with: bun scripts/co-newbiz/generate-process-flow.ts");
    process.exit(1);
  }
  console.log("docs/process-flow.md is up to date.");
} else {
  writeFileSync(DOC_PATH, markdown, "utf8");
  console.log(`docs/process-flow.md generated (${spec.stages.length} stages, ${spec.gates.length} gates).`);
}
