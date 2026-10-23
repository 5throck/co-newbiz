#!/usr/bin/env bun
/**
 * @version 1.0.0
 */
// generate-pm-catalog.ts — 3 SSOT 조인(prompts.json × flow.spec.yaml × agents/*.md)을
// 런타임 PM 활동 카탈로그(app/web-next/lib/pm-catalog.generated.ts)로 투영한다
// (ADR-0183 D1, design 2026-09-15-runtime-pm-agent-orchestration §6.2).
// generate-spec-activities.ts와 동일한 규율: 결정론 출력 + --check 드리프트 게이트,
// 생성 시점 참조 무결성 검증(프롬프트 에이전트·활동 에이전트·활동 매핑 모두 로스터/스펙에 존재).
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
