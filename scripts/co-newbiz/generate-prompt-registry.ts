#!/usr/bin/env bun
/**
 * @version 1.0.0
 */
// generate-prompt-registry.ts — prompts/prompts.json SSOT를 런타임 레지스트리로 투영한다.
// agent-registry.generated.ts와 동일한 규율: SSOT는 prompts/prompts.json이고,
// 이 스크립트는 읽어 정적 TS로 내보낼 뿐이다. 문구 수정은 SSOT에서 하고 재생성한다.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const SRC = join(ROOT, "app", "web-next", "prompts", "prompts.json");
const OUT = join(ROOT, "app", "web-next", "lib", "prompts.generated.ts");

interface PromptEntry {
  key: string;
  agent: string | null;
  purpose: string;
  system: string;
}

const doc = JSON.parse(readFileSync(SRC, "utf-8")) as { prompts: PromptEntry[] };
const prompts = doc.prompts;

const keys = prompts.map((p) => p.key);
if (new Set(keys).size !== keys.length) {
  console.error("duplicate prompt keys:", keys.filter((k, i) => keys.indexOf(k) !== i));
  process.exit(1);
}
for (const p of prompts) {
  if (!p.key || !p.purpose || !p.system) {
    console.error(`incomplete prompt entry: ${p.key}`);
    process.exit(1);
  }
}

function tsStr(s: string): string {
  return JSON.stringify(s);
}

const lines: string[] = [
  "// GENERATED from prompts/prompts.json — do not edit by hand; edit the JSON and",
  "// regenerate via: bun scripts/co-newbiz/generate-prompt-registry.ts",
  "// 프롬프트 레지스트리 — 시스템 프롬프트·소유 에이전트·장부 purpose의 단일 SSOT 투영.",
  "",
  "export interface PromptEntry {",
  "  key: string;",
  "  /** null이면 호출 시점에 에이전트 키를 지정해야 한다(promptAgent 오버라이드). */",
  "  agent: string | null;",
  "  purpose: string;",
  "  system: string;",
  "}",
  "",
  `export type PromptKey = ${keys.map((k) => JSON.stringify(k)).join(" | ")};`,
  "",
  "export const PROMPTS: Record<PromptKey, PromptEntry> = {",
];
for (const p of prompts) {
  lines.push(`  ${JSON.stringify(p.key)}: {`);
  lines.push(`    key: ${tsStr(p.key)},`);
  lines.push(`    agent: ${p.agent === null ? "null" : tsStr(p.agent)},`);
  lines.push(`    purpose: ${tsStr(p.purpose)},`);
  lines.push(`    system: ${tsStr(p.system)},`);
  lines.push("  },");
}
lines.push("};");
lines.push("");

writeFileSync(OUT, lines.join("\n"));
console.log(`prompt registry: ${prompts.length} entries -> ${OUT}`);
