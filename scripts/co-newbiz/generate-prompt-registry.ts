#!/usr/bin/env bun
/**
 * @version 2.1.0
 *
 * Changelog:
 *   2.1.0 (2026-10-25, design addendum §13 / DEC-20261025-05) — SECTION_MARKERS
 *     drops "# Role" (5-section skeleton); NEW hard rule: closed heading
 *     vocabulary — any /^#\s+\S/ heading line outside the 5 markers dies as
 *     "undeclared section marker" (blocks # Role reintroduction and rogue
 *     persona headings).
 *   2.0.0 (2026-10-25, design §5 + Addendum §A) — initial D3 machine bar.
 */
// generate-prompt-registry.ts — prompts/prompts.json SSOT를 런타임 레지스트리로 투영한다.
// agent-registry.generated.ts와 동일한 규율: SSOT는 prompts/prompts.json이고,
// 이 스크립트는 읽어 정적 TS로 내보낼 뿐이다. 문구 수정은 SSOT에서 하고 재생성한다.
//
// D3 machine bar (design 2026-10-25-agent-assignment-prompt-standard-design
// §13.2 + §A-1–§A-3; §5.1's 6-section skeleton is superseded by §13) — hard
// failures before projection:
//   (a) the 5-section skeleton markers, in order (# Proposal-only disclaimer
//       omittable only for the GATE_UNLINKED set),
//   (e) closed heading vocabulary — a line matching /^#\s+\S/ whose heading
//       text is not one of the 5 markers dies as "undeclared section marker"
//       (no # Role, no persona headings).
//   (b) Hangul only inside the # Language and # Output contract sections,
//   (c) JSON-output prompts state ONE-JSON + no-code-fence in # Output contract,
//   (d) PROSE_OUTPUT (A-3 Tier A) members carry an "Explanation style" clause.
// Advisory (never blocking, ADR-0079/0098 enforcement model): a >25-word
// sentence heuristic prints warns to stderr and exits 0.
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

// ── D3 machine bar ───────────────────────────────────────────────────────────

/** Skeleton section markers, in the exact mandated order (design §13.2 — the
 * 5-section skeleton; "# Role" is removed per DEC-20261025-05). */
const SECTION_MARKERS = [
  "# Evidence boundary",
  "# Task",
  "# Output contract",
  "# Language",
  "# Proposal-only disclaimer",
] as const;
const LAST_MARKER = SECTION_MARKERS[SECTION_MARKERS.length - 1];

/** (e) Closed heading vocabulary — the ONLY legal /^#\s+\S/ heading lines.
 * Anything else (a reintroduced "# Role", a rogue "# Persona") dies as an
 * undeclared section marker (design addendum §13.6). */
const HEADING_VOCAB: ReadonlySet<string> = new Set<string>(SECTION_MARKERS);

/** Gate-unlinked prompts — the ONLY set that may omit the disclaimer
 * (design §5.1: internal classification with no gate linkage). */
const GATE_UNLINKED = new Set<string>(["pm.query_classify", "s1.ksic_classify"]);

/** A-3 Tier A — declared prose/narrative-output keys. Single source of the
 * enumeration (design Addendum §A-2): each member's # Output contract MUST
 * carry an "Explanation style" sub-clause. */
const PROSE_OUTPUT = new Set<string>([
  "s1.sizing_summarize",
  "s8.business_case_prose",
  "committee.position",
  "company_profile.qualitative",
  "company_profile.competitive",
]);

/** A-3 full exemption — the single router-internal key that is never rendered
 * to a human (design Addendum §A-3). */
const STYLE_EXEMPT = new Set<string>(["pm.query_classify"]);

/** Consumer-verified JSON-output keys (Row 2 verification; consumer file:line
 * per key recorded in the dispatch report). Each member's # Output contract
 * MUST state ONE-JSON output and the no-code-fence rule (design §5.4 (c)).
 * company_profile.qualitative and company_profile.competitive are design-listed
 * Tier A but consumer-verified JSON (company-profile-pipeline.ts JSON.parse) —
 * they carry both the ONE-JSON and the Explanation-style checks. */
const JSON_OUTPUT = new Set<string>([
  "s2.discover",
  "s1.sizing_ask_json",
  "s1.ksic_classify",
  "market.related_candidates",
  "s3.opportunity_factors",
  "company_profile.qualitative",
  "company_profile.competitive",
  "company_profile.crosscheck",
  "company_profile.competitor_web_search",
  "s4.synergy_fa",
  "s4.synergy_synergy",
  "s4.synergy_ic",
  "s3.attractiveness_recommendation",
  "s3.capability_gap_draft",
  "s5.capability_judgement_draft",
  "s5.entry_strategy_draft",
  "opportunity.gate_brief",
  "project.gate_brief",
  "s4.route_recommendation",
  "opportunity.sketch",
  "s5.greenfield_recommendation",
  "s6.universe_criteria_draft",
  "s6.target_proposal_web_search",
  "s7.screening_draft",
  "s8.business_case_adoption",
  "s8.deal_structure_recommendation",
  "s9.dd_tailor",
  "s11.monitoring_brief",
  "pm.query_classify",
  "s8.price_evidence",
  "s2.entry_market_draft",
  "s8.ev_band_recommend",
  "s11.integrated_insight",
  "s10.site_regulatory_draft",
  "s11.report_narration",
  "s12.milestone_suggest",
  "pm.flow_suggest",
]);

const HANGUL_RE = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/;

function die(message: string): never {
  console.error(`prompt-registry: ${message}`);
  process.exit(1);
}

interface SectionSlice {
  marker: string;
  body: string;
}

/** Slice a system text into its present sections, in marker order. */
function sliceSections(system: string): SectionSlice[] {
  const found = SECTION_MARKERS.map((marker) => {
    const first = system.indexOf(marker);
    return { marker, first, last: system.lastIndexOf(marker) };
  }).filter((m) => m.first !== -1);
  found.sort((a, b) => a.first - b.first);
  return found.map((m, i) => {
    const start = m.first + m.marker.length;
    const end = i + 1 < found.length ? found[i + 1].first : system.length;
    return { marker: m.marker, body: system.slice(start, end) };
  });
}

// Advisory sentence-length heuristic (warn-only — ADR-0079/0098 §2.8 advisory
// enforcement model; the design Addendum §A-1 rules structure linting out of
// the hard bar). Crude splitter; JSON/meta example lines are skipped.
const sentenceWarnings: string[] = [];
function collectSentenceWarnings(key: string, system: string): void {
  for (const rawLine of system.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("{") || line.startsWith("}") || line.startsWith("<!--")) continue;
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      const words = sentence.trim().split(/\s+/).filter(Boolean);
      if (words.length > 25) {
        sentenceWarnings.push(`  ${key}: ${words.length} words — "${sentence.trim().slice(0, 90)}${sentence.trim().length > 90 ? "…" : ""}"`);
      }
    }
  }
}

for (const p of prompts) {
  const system = p.system;

  // (a) required markers, present exactly once and in skeleton order.
  for (const marker of SECTION_MARKERS) {
    if (system.indexOf(marker) !== system.lastIndexOf(marker)) {
      die(`'${p.key}' has section marker '${marker}' more than once.`);
    }
  }
  const missing = SECTION_MARKERS.filter((m) => !system.includes(m));
  const requiredMissing = missing.filter((m) => !(m === LAST_MARKER && GATE_UNLINKED.has(p.key)));
  if (requiredMissing.length > 0) {
    die(`'${p.key}' is missing required section marker(s): ${requiredMissing.join(", ")}.`);
  }
  if (missing.includes(LAST_MARKER) && GATE_UNLINKED.has(p.key) === false) {
    die(`'${p.key}' omits '${LAST_MARKER}' but is not in the gate-unlinked set.`);
  }
  const positions = SECTION_MARKERS.filter((m) => system.includes(m)).map((m) => ({ marker: m, at: system.indexOf(m) }));
  for (let i = 1; i < positions.length; i++) {
    if (positions[i].at <= positions[i - 1].at) {
      die(`'${p.key}' section markers are out of skeleton order at '${positions[i].marker}'.`);
    }
  }

  // (e) closed heading vocabulary — the skeleton's heading set is closed.
  for (const rawLine of system.split("\n")) {
    if (!/^#\s+\S/.test(rawLine)) continue;
    const heading = rawLine.trim();
    if (!HEADING_VOCAB.has(heading)) {
      die(`'${p.key}' has an undeclared section marker: "${heading}" (closed heading vocabulary — design addendum §13.6).`);
    }
  }

  // (b) Hangul allowed only in # Language and # Output contract.
  const slices = sliceSections(system);
  for (const s of slices) {
    if (s.marker === "# Language" || s.marker === "# Output contract") continue;
    const hit = s.body.match(HANGUL_RE);
    if (hit) {
      const at = s.body.indexOf(hit[0]);
      die(`'${p.key}' has Hangul outside # Language / # Output contract (section '${s.marker}'): "...${s.body.slice(Math.max(0, at - 30), at + 30)}...".`);
    }
  }
  const bodyOf = (marker: string): string => slices.find((s) => s.marker === marker)?.body ?? "";

  // (c) JSON-output prompts pin ONE-JSON + no-code-fence in # Output contract.
  if (JSON_OUTPUT.has(p.key)) {
    const contract = bodyOf("# Output contract");
    if (!/one json/i.test(contract)) {
      die(`'${p.key}' is a JSON-output prompt but its # Output contract lacks the ONE-JSON statement.`);
    }
    if (!/code fence/i.test(contract)) {
      die(`'${p.key}' is a JSON-output prompt but its # Output contract lacks the no-code-fence rule.`);
    }
  }

  // (d) Tier A members carry the Explanation style sub-clause.
  if (PROSE_OUTPUT.has(p.key) && !STYLE_EXEMPT.has(p.key)) {
    if (!bodyOf("# Output contract").includes("Explanation style")) {
      die(`'${p.key}' is a PROSE_OUTPUT (Tier A) member but its # Output contract lacks the 'Explanation style' sub-clause.`);
    }
  }

  collectSentenceWarnings(p.key, system);
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

// Advisory channel — never blocks (exit 0). Aids the AI-1st controlled-language
// review (design Addendum §A-1, §A-5).
if (sentenceWarnings.length > 0) {
  console.error(`prompt-registry: advisory — ${sentenceWarnings.length} sentence(s) exceed 25 words (controlled-language review aid):`);
  for (const w of sentenceWarnings) console.error(w);
}
