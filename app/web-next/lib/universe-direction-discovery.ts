// Candidate discovery reads the S6 evaluation-target direction (design 2026-11-17-s6-universe-direction-review): the
// prioritised candidate types steer the web-search queries and the proposal prompts, the excluded directions are told to the
// model as "do not propose". Pure functions; the Korean literals live in universe-direction-labels.json (record/prompt
// content, not UI chrome).
import labels from "./universe-direction-labels.json" with { type: "json" };
import type { StoredDirection } from "./universe-direction.ts";

export interface DirectionHints {
  priorities: { type: string; why: string }[];
  excludes: { type: string; why: string }[];
  valueChain: string;
}

const MAX_QUERY_PRIORITIES = 2;

/** Non-empty prioritise / exclude lines of a stored direction; all-empty when the record has no direction. */
export function directionHints(universe: { direction?: Partial<StoredDirection> | null }): DirectionHints {
  const d = universe.direction;
  const clean = (list: unknown) =>
    (Array.isArray(list) ? list : [])
      .map((x) => ({ type: String(x?.type ?? "").trim(), why: String(x?.why ?? "").trim() }))
      .filter((x) => x.type.length > 0)
      .slice(0, 3);
  return {
    priorities: clean(d?.prioritise),
    excludes: clean(d?.exclude),
    valueChain: String(d?.value_chain?.text ?? "").trim(),
  };
}

/** Search queries for the prioritised candidate types (most important first). */
export function directionQueries(base: string, hints: DirectionHints): string[] {
  return hints.priorities.slice(0, MAX_QUERY_PRIORITIES).map((p) => `${base} ${p.type} ${labels.query_suffix}`);
}

/** Prompt lines: prioritised types, excluded directions, the value-chain position and the rule for using them. */
export function directionPromptLines(hints: DirectionHints): string[] {
  const line = (x: { type: string; why: string }) => `- ${x.type}${x.why ? ` (${x.why})` : ""}`;
  const out: string[] = [];
  if (hints.valueChain) out.push(`${labels.discovery_value_chain}: ${hints.valueChain}`);
  if (hints.priorities.length > 0)
    out.push(`${labels.discovery_priority_header}\n${hints.priorities.map(line).join("\n")}`);
  if (hints.excludes.length > 0) out.push(`${labels.discovery_exclude_header}\n${hints.excludes.map(line).join("\n")}`);
  if (hints.priorities.length > 0 || hints.excludes.length > 0) out.push(labels.discovery_rule);
  return out;
}
