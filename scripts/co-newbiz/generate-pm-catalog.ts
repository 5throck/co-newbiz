#!/usr/bin/env bun
/**
 * @version 1.1.0
 */
// generate-pm-catalog.ts — 3 SSOT 조인(prompts.json × flow.spec.yaml × agents/*.md)을
// 런타임 PM 활동 카탈로그(app/web-next/lib/pm-catalog.generated.ts)로 투영한다
// (ADR-0183 D1, design 2026-09-15-runtime-pm-agent-orchestration §6.2).
// generate-spec-activities.ts와 동일한 규율: 결정론 출력 + --check 드리프트 게이트,
// 생성 시점 참조 무결성 검증(프롬프트 에이전트·활동 에이전트·활동 매핑 모두 로스터/스펙에 존재).
//
// v1.1.0 (design 2026-10-25-agent-assignment-prompt-standard, DEC-20261025-01/02):
//  - D2 정합 강제: 프롬프트 agent ≠ flow.spec 활동 agent면 die — 문서화된
//    DUAL_ASSIGNMENTS 예외(근거 필수)로만 통과한다. 프로세스 권위 위계상 spec이 지배.
//  - SPECIALIST_TRACK_AFFINITY(DEC-20261025-02 §11.3): 트랩 전문가×공통 단계 4곳의
//    표시 전용 큐레이션 배열 — die 검증(spec 일치 강제) 후 생성물에 투영.
//
// Usage: bun scripts/co-newbiz/generate-pm-catalog.ts [--check]
//   --check : exit 1 if the generated file would change (CI mode).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { die } from "../lib/error-handling.ts";

const ROOT = join(import.meta.dir, "..", "..");
const PROMPTS_PATH = join(ROOT, "app", "web-next", "prompts", "prompts.json");
const SPEC_PATH = join(ROOT, "process", "flow.spec.yaml");
const AGENTS_DIR = join(ROOT, "agents");
const OUT = join(ROOT, "app", "web-next", "lib", "pm-catalog.generated.ts");
const CATALOG_VERSION = "1.0.0";

interface PromptDoc {
  prompts: Array<{ key: string; agent: string | null; purpose: string; system: string; activity?: string }>;
}
interface SpecActivity { id: string; agent: string }
interface SpecStage {
  id: string;
  activities: SpecActivity[];
  applicableTracks?: string[];
}
interface FlowSpec { meta: { version: string }; stages: SpecStage[] }

function sha256(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);
}

// ── SSOT 로드 ────────────────────────────────────────────────────────────────
const promptsDoc = JSON.parse(readFileSync(PROMPTS_PATH, "utf8")) as PromptDoc;
const spec = yaml.load(readFileSync(SPEC_PATH, "utf8")) as FlowSpec;

function parseFrontmatter(text: string): Record<string, string> {
  const normalized = text.replace(/\r\n/g, "\n");
  const m = normalized.match(/^---\n([\s\S]*?)\n---/);
  const fm: Record<string, string> = {};
  if (!m) return fm;
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return fm;
}
// agents/*.md 로스터 — generate-agent-registry.ts와 동일한 파싱 규칙.
const roster = new Set<string>();
for (const f of readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md")).sort()) {
  const fm = parseFrontmatter(readFileSync(join(AGENTS_DIR, f), "utf-8"));
  if (fm.name) roster.add(fm.name);
}

// ── flow.spec 인덱스 ────────────────────────────────────────────────────────
const activityIndex = new Map<string, { stageId: string; agent: string; trackScope: string[] }>();
for (const stage of spec.stages) {
  const trackScope = stage.applicableTracks ?? [];
  for (const a of stage.activities) {
    const qualified = `${stage.id}.${a.id}`;
    if (activityIndex.has(qualified)) die(`flow.spec 중복 활동 id: ${qualified}`);
    activityIndex.set(qualified, { stageId: stage.id, agent: a.agent, trackScope });
  }
}

// ── 참조 무결성 검증 (die on violation) ─────────────────────────────────────
const dynamic: string[] = [];
for (const p of promptsDoc.prompts) {
  if (p.agent === null) dynamic.push(p.key);
  else if (!roster.has(p.agent)) die(`프롬프트 '${p.key}'의 agent '${p.agent}'가 agents/ 로스터에 없습니다.`);
  if (p.activity !== undefined) {
    const hit = activityIndex.get(p.activity);
    if (!hit) die(`프롬프트 '${p.key}'의 activity '${p.activity}'가 flow.spec.yaml 활동이 아닙니다.`);
    if (!roster.has(hit.agent)) die(`flow.spec 활동 '${p.activity}'의 agent '${hit.agent}'가 agents/ 로스터에 없습니다.`);
  }
}
for (const [qualified, hit] of activityIndex) {
  if (!roster.has(hit.agent)) die(`flow.spec 활동 '${qualified}'의 agent '${hit.agent}'가 agents/ 로스터에 없습니다.`);
}

// ── DUAL_ASSIGNMENTS (D2, design 2026-10-25-agent-assignment-prompt-standard §4.1,
//    DEC-20261025-01 (c)) ──────────────────────────────────────────────────────
// 프롬프트 agent는 flow.spec 활동 agent와 일치해야 한다(프로세스 권위 위계 — spec이
// 지배한다). 불일치는 die하며, 아래 배열의 (promptKey, activity) 쌍만 예외다 —
// "보조 관점"의 유일하게 인가된 이중 배정이며 근거(rationale)가 필수다. 새 예외는
// 게이트 모멘트 결정 기록을 요구한다 — 목록은 무성히 늘어나지 않는다.
export interface DualAssignment {
  promptKey: string;
  /** 매핑된 flow.spec 활동 ("S11.ic-preparation" 형 stage.activity 키). */
  activity: string;
  rationale: string;
}

const DUAL_ASSIGNMENTS: DualAssignment[] = [
  {
    promptKey: "s11.integrated_insight",
    activity: "S11.ic-preparation",
    rationale: "Cross-domain integrated insight is the process-governance-manager charter (auxiliary review lens) layered on the pm-owned ic-preparation activity; procedure schema supports one agent_key per step (ADR-0161 Q6 pattern).",
  },
];

/** D2 검증 (순수 함수 — 위반 문언 배열 반환, 호출자가 die한다). */
export function validateDualAssignments(
  prompts: Array<{ key: string; agent: string | null; activity?: string }>,
  index: Map<string, { agent: string }>,
  dual: DualAssignment[],
): string[] {
  const violations: string[] = [];
  const listed = new Set(dual.map((d) => `${d.promptKey}\u0000${d.activity}`));
  for (const p of prompts) {
    if (p.activity === undefined || p.agent === null) continue;
    const hit = index.get(p.activity);
    if (!hit || p.agent === hit.agent) continue;
    if (!listed.has(`${p.key}\u0000${p.activity}`)) {
      violations.push(
        `프롬프트 '${p.key}'의 agent '${p.agent}'가 flow.spec 활동 '${p.activity}'의 agent '${hit.agent}'와 다릅니다 — spec이 지배합니다. 이중 배정이면 DUAL_ASSIGNMENTS에 근거와 함께 등록하세요.`,
      );
    }
  }
  for (const d of dual) {
    if (!d.rationale || d.rationale.trim().length === 0) {
      violations.push(`이중 배정 '${d.promptKey}'의 rationale이 비어 있습니다.`);
    }
    const prompt = prompts.find((p) => p.key === d.promptKey);
    if (!prompt || prompt.activity !== d.activity) {
      violations.push(`이중 배정 '${d.promptKey}'가 prompts.json의 실제 매핑(activity='${d.activity}')과 어긋납니다 — stale 예외입니다.`);
    }
    if (!index.has(d.activity)) {
      violations.push(`이중 배정 '${d.promptKey}'의 활동 '${d.activity}'가 flow.spec.yaml에 없습니다.`);
    }
  }
  return violations;
}

// ── SPECIALIST_TRACK_AFFINITY (DEC-20261025-02 §11.3, design addendum §11) ──
// 트랙 전문가×공통 단계 4곳의 판정(전부 K — 유지)을 표면화하는 표시·인지 전용
// 큐레이션 배열이다. 적용 범위·술어·라우팅 키를 갖지 않는다(ADR-0161 기계적 보증)
// — 파이프라인 엔진·단계 applicableTracks·절차 applies_when은 불변. die 검증이
// 스펙 일치를 강제한다: ref 실재·활동 agent 일치·트랙 전문가 로스터·양트랙 단계.
// kind 어휘: affinity=공통 산출에 대한 전문 렌즈 / scoped=절차 스코프에 의한 트랙
// 전용 / override=활동 필드 소유와 트랙별 실효 소유의 분기. 집합 변경은 게이트
// 모멘트 결정 기록을 요구한다.
export interface SpecialistTrackAffinity {
  /** flow.spec 활동 참조 ("S2.business-model-sketch" 형 stage.activity 키). */
  ref: string;
  agent: string;
  kind: "affinity" | "scoped" | "override";
  track: "greenfield" | "brownfield";
  /** 한국어 툴팁 1문장 (/flows 마커). */
  note: string;
  /** 판정 기록 id. */
  decision: string;
}

const SPECIALIST_TRACK_AFFINITY: SpecialistTrackAffinity[] = [
  {
    ref: "S2.business-model-sketch",
    agent: "greenfield-agent",
    kind: "affinity",
    track: "greenfield",
    note: "S2는 트랙 미결정 — 모든 기회가 후보 신사업이며 스케치는 트랙 중립 가설 산출물(requiredCapabilities→S3→S4)이다",
    decision: "DEC-20261025-02",
  },
  {
    ref: "S4.deal-shape-evaluation",
    agent: "brownfield-agent",
    kind: "affinity",
    track: "brownfield",
    note: "딜 형태 평가는 외부 결합 구조의 전문 렌즈 — greenfield 대안은 pm의 route-strategy·route-advisory와 ADR-0104 동일 5기준 채점이 운반한다",
    decision: "DEC-20261025-02",
  },
  {
    ref: "S9.capability-dd",
    agent: "brownfield-agent",
    kind: "scoped",
    track: "brownfield",
    note: "brownfield 전용 실행(절차 [brownfield-dd]) — greenfield는 S5 capability-assessment에서 답한다",
    decision: "DEC-20261025-02",
  },
  {
    ref: "S11.investment-structuring",
    agent: "brownfield-agent",
    kind: "override",
    track: "brownfield",
    note: "활동 필드 소유는 Q6상 brownfield-agent — greenfield 실효 소유는 entity-ic-review step 3.1(greenfield-agent + financing-agent 공동검토)",
    decision: "DEC-20261025-02",
  },
];

const TRACK_SPECIALIST_AGENTS = new Set(["greenfield-agent", "brownfield-agent"]);
const AFFINITY_KINDS = new Set(["affinity", "scoped", "override"]);
const AFFINITY_TRACKS = new Set(["greenfield", "brownfield"]);

/** SPECIALIST_TRACK_AFFINITY die 검증 (순수 함수 — 위반 문언 배열 반환). */
export function validateSpecialistTrackAffinity(
  entries: SpecialistTrackAffinity[],
  index: Map<string, { stageId: string; agent: string; trackScope: string[] }>,
): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.ref)) violations.push(`SPECIALIST_TRACK_AFFINITY ref '${e.ref}'가 중복됩니다.`);
    seen.add(e.ref);
    if (!AFFINITY_KINDS.has(e.kind)) violations.push(`SPECIALIST_TRACK_AFFINITY '${e.ref}'의 kind '${e.kind}'는 affinity|scoped|override 중 하나여야 합니다.`);
    if (!AFFINITY_TRACKS.has(e.track)) violations.push(`SPECIALIST_TRACK_AFFINITY '${e.ref}'의 track '${e.track}'는 greenfield|brownfield 중 하나여야 합니다.`);
    if (!e.note || e.note.trim().length === 0) violations.push(`SPECIALIST_TRACK_AFFINITY '${e.ref}'의 note가 비어 있습니다.`);
    if (!e.decision || e.decision.trim().length === 0) violations.push(`SPECIALIST_TRACK_AFFINITY '${e.ref}'의 decision이 비어 있습니다.`);
    const hit = index.get(e.ref);
    if (!hit) {
      violations.push(`SPECIALIST_TRACK_AFFINITY ref '${e.ref}'가 flow.spec.yaml 활동이 아닙니다.`);
      continue;
    }
    if (hit.agent !== e.agent) {
      violations.push(`SPECIALIST_TRACK_AFFINITY '${e.ref}'의 agent '${e.agent}'가 flow.spec 활동 agent '${hit.agent}'와 다릅니다 — 배열은 스펙 위의 주석 계층이며 배정을 발명할 수 없습니다.`);
    }
    if (!TRACK_SPECIALIST_AGENTS.has(e.agent)) {
      violations.push(`SPECIALIST_TRACK_AFFINITY '${e.ref}'의 agent '${e.agent}'는 트랙 전문가(greenfield-agent|brownfield-agent)여야 합니다.`);
    }
    for (const t of ["greenfield", "brownfield"]) {
      if (!hit.trackScope.includes(t)) {
        violations.push(`SPECIALIST_TRACK_AFFINITY '${e.ref}'의 단계(${hit.stageId}) applicableTracks에 '${t}'가 없습니다 — 양트랙 공통 단계만 마커 대상이다.`);
      }
    }
  }
  return violations;
}

// ── 정합 강제 (D2 · DEC-20261025-02) — 위반 시 hard fail ─────────────────────
for (const violation of [
  ...validateDualAssignments(promptsDoc.prompts, activityIndex, DUAL_ASSIGNMENTS),
  ...validateSpecialistTrackAffinity(SPECIALIST_TRACK_AFFINITY, activityIndex),
]) {
  die(violation);
}

// ── 카탈로그 조인 (결정론 — prompts.json 순서 유지) ──────────────────────────
const entries = promptsDoc.prompts.map((p) => {
  const hit = p.activity ? activityIndex.get(p.activity) : undefined;
  return {
    promptKey: p.key,
    agentKey: p.agent,
    activityId: hit ? p.activity!.split(".").slice(1).join(".") : null,
    stageId: hit?.stageId ?? null,
    purpose: p.purpose,
    trackScope: hit?.trackScope ?? [],
  };
});

const banner = `// GENERATED from prompts/prompts.json × process/flow.spec.yaml × agents/*.md —
// do not edit by hand; edit the SSOTs (prompt activity mapping lives in prompts.json)
// and regenerate via: bun scripts/co-newbiz/generate-pm-catalog.ts
// (--check mode exits 1 on drift; tests/unit/pm-catalog.test.ts asserts this
// catalog mirrors the SSOTs and the roster.)
// ADR-0183 D1 — PM 활동 카탈로그 (design 2026-09-15-runtime-pm-agent-orchestration §6.2).
// pm-router의 허용 목록·규칙 에이전트 대상·LLM 분류 로스터 문자열은 이 카탈로그에서
// 유도된다 — 코드에 에이전트 목록을 두지 않는다.
// D2/DEC-20261025-01: 프롬프트 agent ≠ 활동 agent는 DUAL_ASSIGNMENTS 예외로만
// 허용된다(제너레이터 die 검증). DEC-20261025-02 §11.3: SPECIALIST_TRACK_AFFINITY는
// 표시·인지 전용 큐레이션 배열이다(적용 범위·술어·라우팅 키 없음 — ADR-0161).
`;
const body = `import type { PromptKey } from "./prompts.generated.ts";

export interface PmCatalogEntry {
  /** prompts.json 프롬프트 키 (PromptKey와 1:1). */
  promptKey: PromptKey;
  /** 프롬프트 소유 에이전트 키. null = 동적 항목 — 호출 시점 에이전트 선언으로 귀속된다. */
  agentKey: string | null;
  /** 매핑된 flow.spec 활동 id (예: "target-screening"). 자연 매핑이 없으면 null. */
  activityId: string | null;
  /** 활동이 속한 단계 id (예: "S7"). 미매핑 null. */
  stageId: string | null;
  purpose: string;
  /** 단계 applicableTracks (greenfield/brownfield). 미매핑 []. */
  trackScope: string[];
}

/** 문서화된 이중 배정 — 프롬프트 관점 ≠ 활동 소유의 유일하게 인가된 예외 (D2). */
export interface DualAssignment {
  promptKey: PromptKey;
  /** 매핑된 flow.spec 활동 ("S11.ic-preparation" 형 stage.activity 키). */
  activity: string;
  rationale: string;
}

/** 트랙 전문가×공통 단계 마커 — 표시·인지 전용 (DEC-20261025-02 §11.3). */
export type SpecialistAffinityKind = "affinity" | "scoped" | "override";
export interface SpecialistTrackAffinity {
  /** flow.spec 활동 참조 ("S2.business-model-sketch" 형 stage.activity 키). */
  ref: string;
  agent: string;
  kind: SpecialistAffinityKind;
  track: "greenfield" | "brownfield";
  /** 한국어 툴팁 1문장 (/flows 마커). */
  note: string;
  /** 판정 기록 id. */
  decision: string;
}

export const CATALOG_VERSION = ${JSON.stringify(CATALOG_VERSION)};
export const SPEC_VERSION = ${JSON.stringify(spec.meta.version)};
/** SSOT 원문 해시(앞 16자) — 드리프트 원인 규명용. */
export const CATALOG_SOURCES = ${JSON.stringify(
  {
    promptsJson: sha256(readFileSync(PROMPTS_PATH, "utf8")),
    flowSpecYaml: sha256(readFileSync(SPEC_PATH, "utf8")),
    agentRoster: sha256([...roster].sort().join("\n")),
  },
  null,
  2,
).replace(/"/g, '"')};

export const PM_CATALOG: Record<PromptKey, PmCatalogEntry> = ${JSON.stringify(
  Object.fromEntries(entries.map((e) => [e.promptKey, e])),
  null,
  2,
)};

/** agent=null 동적 항목 — 실행 시점 활동 맥락(호출자가 선언한 agent 메타)으로 귀속된다. */
export const DYNAMIC_AGENT_PROMPTS: PromptKey[] = ${JSON.stringify(dynamic)};

/** 문서화된 이중 배정 — 유일한 "보조 관점" 예외 (근거 필수, 신규는 게이트 판정 요구). */
export const DUAL_ASSIGNMENTS: DualAssignment[] = ${JSON.stringify(DUAL_ASSIGNMENTS, null, 2)};

/** 트랙 전문가×공통 단계 마커 4곳 — 표시 전용, die 검증으로 스펙 일치 강제됨. */
export const SPECIALIST_TRACK_AFFINITY: SpecialistTrackAffinity[] = ${JSON.stringify(SPECIALIST_TRACK_AFFINITY, null, 2)};
`;

const next = banner + body;

function normalizeForCheck(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

if (process.argv.includes("--check")) {
  if (normalizeForCheck(readFileSync(OUT, "utf8")) !== normalizeForCheck(next)) {
    die(`pm-catalog.generated.ts stale (${entries.length} prompts, spec ${spec.meta.version}) — regenerate with: bun scripts/co-newbiz/generate-pm-catalog.ts`);
  }
  console.log(`pm-catalog.generated.ts is up to date (${entries.length} prompts, ${dynamic.length} dynamic).`);
} else {
  writeFileSync(OUT, next, "utf8");
  console.log(`${OUT} written (${entries.length} prompts, ${dynamic.length} dynamic, spec ${spec.meta.version}).`);
}
