// @version 1.2.0
// Process Flow Spec → docs/process-flow.md generator (ADR-0074).
// process/flow.spec.yaml is the SSOT; this script regenerates the markdown
// reference. The drift test (tests/unit/process-flow.test.ts) validates the
// spec and asserts the generated document is up to date.
//
// Usage: bun scripts/co-newbiz/generate-process-flow.ts [--check]
//   --check : exit 1 if docs/process-flow.md would change (CI mode).
//
// v1.2.0 — appends a hand-authored ADDENDUM (S8–S11 automation surfaces,
// steering committees, e2e pipeline, deferred capabilities) after the
// generated spec reference. The addendum lives HERE, not in the output file,
// so the generated-vs-file equality check above still holds.
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

const ADDENDUM = `

---

# Addendum — Implemented automation state (v2.0.0, ADR-0095~0102)

> 이 부분은 사양에서 생성되지 않는 **hand-maintained addendum**이다. 본문(S1~S11
> stage/gate reference)은 flow.spec.yaml의 생성물이고, 이 아래 단락은 구현된
> 자동화 표면(ADR-0095~0102, PRs #191~#199)을 문서화한다. 수정은 이 상수
> (\`scripts/co-newbiz/generate-process-flow.ts\`의 \`ADDENDUM\`)에서 한다.

## Process engine and stage evaluation

Stage state is **derived, never stored**: there is no persisted \`current_stage\`.
UI and the agent orchestrator both call \`evaluateProcess(entity)\` in
\`app/web-next/lib/process-flow.ts:330\`, which recomputes the full
\`ProcessEvaluation\` (currentStage, completedStages, blockedStages, nextStage,
blockers, requiredArtifacts, gateStatus, track/subTrack, terminated) from
persisted artifacts and the latest \`gate_decision\` rows.

Two entity lifecycles (ADR-0094/0095):

- **opportunity** carries S1–S7. Track is derived from the S4
  \`route_decision\` (process-flow.ts:353); track-inapplicable stages render as
  \`skipped\`, downstream siblings of an incomplete stage as \`locked\`.
- **project** carries S8–S11. The **S7→S8 handoff is promotion**
  (\`promoteOpportunity\`, \`db/repositories/project.repository.ts\`; wired by
  \`app/web-next/lib/pipeline.ts:290\`) — preconditions verify the track-specific
  S5 output (greenfield) or S7 Short List (brownfield) before the project row
  exists (ADR-0095).

### Completion predicates as implemented (file:line as of 2026-09-04)

| Stage | Predicate | Location |
|---|---|---|
| S1 | market size·growth + value-chain node, substitutable by an industry-level completed \`market_sizing_analysis\` / \`proxy_link\` | process-flow.ts:99–132 |
| S2 | opportunity attractiveness score recorded | process-flow.ts:133–135 |
| S3 | synergy_score + rationale + status \`selected\` (dropped blocks S4) | process-flow.ts:136–148 |
| S4 | \`route_decision\` with track; brownfield additionally sub_track + all 5 criteria scores | process-flow.ts:149–161 |
| S5 | greenfield capability gaps (≥1), entry strategy, alternatives considered | process-flow.ts:162–175 |
| S6 | brownfield Target Universe JSON + Long List ≥ min coverage (default 3) | process-flow.ts:176–191 |
| S7 | every target shortlisted (knock-outs passed) or excluded with reason; 0 knock-out-passed candidates surfaces the target_screening KILL criterion | process-flow.ts:192–212 |
| S8 | ≥1 \`business_case_model\` for the project AND ≥1 \`valuation_simulation\` row (NPV percentiles) — ADR-0098 | process-flow.ts:236–258 |
| S9 | \`ddCompletionSummary\`: total > 0, pending = 0, mandatoryUnmet = 0 — ADR-0099 | process-flow.ts:259–275 |
| S10 | \`entity_ic\` AND \`group_ic\` gate decisions both \`go\` (human record only); for origin ∈ {internal, joint}, \`establishmentProgress\` = 5/5 — ADR-0100 | process-flow.ts:276–294 |
| S11 | \`venture_scorecard\` exists with a fresh review cycle (current or previous quarter, \`isFreshReviewCycle\`) — ADR-0101 | process-flow.ts:295–311 |

Gate semantics: every gate verdict is a human-recorded \`gate_decision\` row
(ADR-0053 \`decision_authority: human\`; ADR-0094 — the sole human-confirmation
ledger). HOLD blocks re-evaluation of the current stage's gate, not the work
itself (process-flow.ts:394–399, 463–472); any \`kill\` terminates the entity.

## Automation surfaces per stage (S8–S11)

- **S8 — 3-scenario business-case generation (ADR-0098)**:
  \`generateBusinessCases\` runs the FS scenario contract (downside / base /
  upside) as one \`runActivityChain\` per scenario, writing per-scenario
  \`business_case_model\` + \`business_case_line\` + \`valuation_simulation\`
  percentiles, and flags a RECOMMENDED case. The scenario→case binding is
  **human adoption** — agents generate, a person adopts one case for the FS gate.
- **S9 — tailored DD checklists (ADR-0099)**: the standard commercial/technical/
  legal checklists stay authoritative; \`tailorDdChecklist\` proposes
  project-specific custom items. The default executor is deterministic; a
  WebSearch-backed benchmarking executor is available via the
  \`CO_NEWBIZ_DD_TAILOR_AGENTS\` seam. Honesty constraint: an unsourced proposal
  (no source URL / real source) is recorded with reliability grade **C** — the
  seam's limits stay legible to the human reviewer instead of fabricating
  authority.
- **S10 — IC package, dual gates, establishment (ADR-0100)**: the IC package
  surface assembles the project evidence for \`entity_ic\` → \`group_ic\`
  (both human gates). For origin ∈ {internal, joint}, establishment execution is
  tracked as **project-keyed** 5 steps (setup → registration/permit
  classification → personnel transfer → completion check; \`chk-entity-formation\`
  evidence); the opportunity-keyed ADR-0057 pattern is deprecated.
- **S11 — scorecard and transitions (ADR-0101)**: the portfolio scorecard view
  reads \`venture_scorecard\` per project; kill/graduate outcomes are recorded in
  a human transition-decision ledger using the venture-portfolio-ic vocabulary
  (next_tranche_released / held_evidence_incomplete / graduate_to_core /
  reduce_or_divest / kill_with_learning_captured) — portfolio governance, a
  different category from the S1–S10 kill criteria.

## Steering committee system (ADR-0097, \`procedures/_committees.yaml\`)

Two registered committees — \`route-steering-committee\` (S4 route decision) and
\`target-longlist-shortlist-committee\` (S6/S7 shortlist promotion).

- **Composition**: the fixed 5-role skeleton (domain expert — the only
  track-swapping seat; industry; region; quantitative rigor; red team) plus six
  standing functional seats (financing, site & facility, legal, HR & labor, IR,
  IP). \`risk-officer\` is the red team with \`veto_dissent: true\` — mandatory on
  every committee; removing the seat requires a new ADR.
- **Chair**: \`process-governance-manager\` under the recorder pattern —
  synthesizes and votes nothing.
- **Decision modes** (closed enum): \`human_only\`, \`agent_team\`, \`hybrid\`. The
  mode never changes who confirms: in \`agent_team\` mode the chair synthesis is
  recorded as a \`gate_evaluation\` **PROPOSAL — never a \`gate_decision\`**
  (design boundary #2, ADR-0053/0094).
- \`rounds: 2\` for every member today; see the deferred list below.

## End-to-end auto pipeline (ADR-0102)

\`app/web-next/lib/pipeline.ts\` is the state machine that consumes
\`evaluateProcess\`'s rule table in a loop: given an industry (\`md_industry\`)
and an initiating company (\`md_company\`), \`advancePipeline\`
(pipeline.ts:386) executes the current stage's automation, re-evaluates, and
**pauses only at human decision points** (gate go/hold/kill, business-case
adoption, checklist final approval, track/route confirmation, S11 transition).
\`pipeline_run\` (migration 0072) carries status \`running\` /
\`paused_for_human\` / \`completed\` / \`failed\` / \`killed\`; a pause writes a
\`pipeline_paused\` notification (pipeline.ts:497). The OS-scheduler batch
\`scripts/co-newbiz/watch-run.ts\` runs a pipeline-resume pass
(watch-run.ts:203–239): \`resumePausedPipelines\` (pipeline.ts:586) auto-resumes
runs whose blocker cleared and leaves the rest paused. Promotions happen inside
the pipeline when preconditions are met (pipeline.ts:276–290).

## Deferred / env-seamed capabilities

Declared gaps, not hidden ones:

- **LLM-backed executors** — all generation executors default to deterministic
  behavior; LLM modes exist behind env seams and are opt-in:
  \`CO_NEWBIZ_BUSINESS_CASE_AGENTS=llm\` (S8, business-case-generator.ts:18,
  \`setExecutorFactory\` pattern), \`CO_NEWBIZ_DD_TAILOR_AGENTS\` (S9 WebSearch
  tailoring), \`CO_NEWBIZ_COMMITTEE_AGENTS\` (committee deliberation), and the
  \`CO_NEWBIZ_LLM_PROVIDER / _MODEL / _BASE_URL / _API_KEY\` family.
- **Round-1-only functional-seat participation** — with 12 members,
  per-member \`rounds: 1\` for functional seats was considered and deferred;
  expressing it cleanly requires touching both the hybrid path in
  \`committee-session.ts\` and \`runDeliberationRounds\` in
  \`agent-orchestrator.ts\`, so all members keep \`rounds: 2\`
  (\`_committees.yaml\` follow-up note).
- **Scorecard weights / cadence (ADR-0052 open question b)** — the exact
  venture-scorecard weighting scheme and revisit cadence remain an open
  question; S11 currently pins only the quarterly freshness predicate.
`;

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
  parts.push(ADDENDUM);
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
