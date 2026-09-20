#!/usr/bin/env bun
/**
 * @version 1.1.0
 */
// generate-agent-registry.ts — agents/*.md 로스터를 런타임 레지스트리로 투영한다
// (ADR-0128 2단계). 기존 generated 패턴(spec-activities, library)과 동일한 규율:
// SSOT는 agents/*.md이고, 이 스크립트는 읽어 정적 TS로 내보낼 뿐이다.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const AGENTS_DIR = join(ROOT, "agents");
const OUT = join(ROOT, "app", "web-next", "lib", "agent-registry.generated.ts");

interface Entry { key: string; name: string; role: string; domain: string | null }

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

const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md")).sort();
const entries: Entry[] = [];
for (const f of files) {
  const fm = parseFrontmatter(readFileSync(join(AGENTS_DIR, f), "utf-8"));
  if (!fm.name) continue;
  entries.push({
    key: fm.name,
    name: fm.formal_name ?? fm.name,
    role: fm.role ?? "",
    domain: fm.domain ?? null,
  });
}

const banner = `// GENERATED from agents/*.md — do not edit by hand; edit the agent md and
// regenerate via: bun scripts/co-newbiz/generate-agent-registry.ts
// ADR-0128 — 런타임 에이전트 레지스트리 (PM 라우터가 작업 수행 에이전트를
// 고르고, 시스템 프롬프트에 역할을 주입할 때 사용한다).
`;
const body = `export interface AgentRegistryEntry { key: string; name: string; role: string; domain: string | null }

export const AGENT_REGISTRY: AgentRegistryEntry[] = ${JSON.stringify(entries, null, 2)};

export const AGENT_KEYS = new Set(AGENT_REGISTRY.map((a) => a.key));
`;
const next = banner + body;
if (process.argv.includes("--check")) {
  const current = readFileSync(OUT, "utf-8");
  if (current !== next) {
    console.error(`agent-registry.generated.ts drift detected (${entries.length} agents parsed)`);
    process.exit(1);
  }
  console.log(`agent-registry.generated.ts up to date (${entries.length} agents)`);
} else {
  writeFileSync(OUT, next);
  console.log(`agent-registry.generated.ts written (${entries.length} agents)`);
}
