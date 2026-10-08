// Provider token usage parsing and cost math (Wave B / B-1, design §5.2 #6, §6).
//
// Normalisation: `inputTokens` is always the NON-cached input. Anthropic
// already reports it that way; OpenAI (prompt_tokens) and Gemini
// (promptTokenCount) include cached tokens, so the cached part is subtracted
// to keep one cost formula for every provider.

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
  provider: string;
  /** true only when the provider sent no usage and chars/4 was used instead. */
  estimated?: boolean;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Parse provider-reported usage from a response (or stream event) body. Null when absent. */
export function parseUsage(
  provider: string,
  model: string,
  json: Record<string, unknown>,
): LlmUsage | null {
  if (provider === "gemini") {
    const u = json.usageMetadata;
    if (!isObj(u)) return null;
    const cached = num(u.cachedContentTokenCount);
    return {
      inputTokens: Math.max(0, num(u.promptTokenCount) - cached),
      outputTokens: num(u.candidatesTokenCount) + num(u.thoughtsTokenCount),
      cacheReadTokens: cached,
      cacheWriteTokens: 0,
      model,
      provider,
    };
  }
  const u = json.usage;
  if (!isObj(u)) return null;
  // Anthropic shape (also used by Anthropic-compatible custom endpoints).
  if ("input_tokens" in u || "output_tokens" in u) {
    return {
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens),
      cacheReadTokens: num(u.cache_read_input_tokens),
      cacheWriteTokens: num(u.cache_creation_input_tokens),
      model,
      provider,
    };
  }
  // OpenAI-compatible shape.
  if ("prompt_tokens" in u || "completion_tokens" in u) {
    const details = isObj(u.prompt_tokens_details) ? u.prompt_tokens_details : {};
    const cached = num(details.cached_tokens);
    return {
      inputTokens: Math.max(0, num(u.prompt_tokens) - cached),
      outputTokens: num(u.completion_tokens),
      cacheReadTokens: cached,
      cacheWriteTokens: 0,
      model,
      provider,
    };
  }
  return null;
}

/** chars/4 fallback — callers must flag the record `usage_estimated`. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export function estimatedUsage(provider: string, model: string, promptText: string, completionText: string): LlmUsage {
  return {
    inputTokens: estimateTokens(promptText),
    outputTokens: estimateTokens(completionText),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    model,
    provider,
    estimated: true,
  };
}

export const totalTokens = (u: LlmUsage): number =>
  u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;

// ── pricing ────────────────────────────────────────────────────────────────

export interface ModelPrice {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

export function parsePricingTable(raw: unknown): Record<string, ModelPrice> {
  const out: Record<string, ModelPrice> = {};
  const models = isObj(raw) && isObj(raw.models) ? raw.models : {};
  for (const [id, entry] of Object.entries(models)) {
    if (!isObj(entry) || typeof entry.input !== "number" || typeof entry.output !== "number") continue;
    out[id] = {
      input: entry.input,
      output: entry.output,
      cache_read: typeof entry.cache_read === "number" ? entry.cache_read : undefined,
      cache_write: typeof entry.cache_write === "number" ? entry.cache_write : undefined,
    };
  }
  return out;
}

let pricingCache: Record<string, ModelPrice> | null = null;
const warnedModels = new Set<string>();

/** Test hook: inject (or clear with null) the price table. */
export function setPricingTableForTests(table: Record<string, ModelPrice> | null): void {
  pricingCache = table;
  warnedModels.clear();
}

function loadPricing(): Record<string, ModelPrice> {
  if (pricingCache) return pricingCache;
  let table: Record<string, ModelPrice> = {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
    const { existsSync, readFileSync } = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- node built-ins only
    const { dirname, join } = require("node:path") as typeof import("node:path");
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- yaml parser
    const yaml = require("js-yaml") as typeof import("js-yaml");
    let dir = /*turbopackIgnore: true*/ process.cwd();
    for (let i = 0; i < 5; i++) {
      const p = join(dir, "config", "llm-pricing.yaml");
      if (existsSync(p)) {
        table = parsePricingTable(yaml.load(readFileSync(p, "utf-8")));
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // an unreadable table means every cost is null — never a guess
  }
  pricingCache = table;
  return table;
}

/** USD cost for a usage record; null (plus one warning per model) when the model has no price. */
export function costUsd(usage: LlmUsage): number | null {
  const price = loadPricing()[usage.model];
  const needsCache = usage.cacheReadTokens > 0 || usage.cacheWriteTokens > 0;
  if (!price || (usage.cacheReadTokens > 0 && price.cache_read === undefined) || (usage.cacheWriteTokens > 0 && price.cache_write === undefined)) {
    if (!warnedModels.has(usage.model)) {
      warnedModels.add(usage.model);
      console.warn(`llm cost: no ${needsCache ? "complete " : ""}price for model "${usage.model}" in config/llm-pricing.yaml; cost recorded as null`);
    }
    return null;
  }
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * (price.cache_read ?? 0) +
      usage.cacheWriteTokens * (price.cache_write ?? 0)) /
    1_000_000
  );
}
