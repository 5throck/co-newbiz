// External research helpers for S2/S3 pipelines.
//  - tavilySearch: web search via TAVILY_API_KEY (global reports, broker
//    notes, statistics sites, news). Returns [] when the key is absent —
//    callers degrade to LLM-knowledge-only with "출처 미확보" marking.
//  - dart helpers live in dart-client.ts.

export interface WebSource {
  title: string;
  url: string;
  snippet: string;
}

import { loadRootEnvPipelineKeys } from "./llm.ts";

export function isWebResearchConfigured(): boolean {
  loadRootEnvPipelineKeys();
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}

export async function tavilySearch(query: string, opts: { maxResults?: number } = {}): Promise<WebSource[]> {
  loadRootEnvPipelineKeys();
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "basic",
        max_results: opts.maxResults ?? 5,
        include_answer: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
    return (json.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({ title: r.title ?? r.url!, url: r.url!, snippet: (r.content ?? "").slice(0, 400) }));
  } catch {
    return [];
  }
}

/** Run several queries and merge results (deduped by URL), max `limit` items. */
export async function researchSources(queries: string[], limit = 10): Promise<WebSource[]> {
  const results = await Promise.all(queries.map((q) => tavilySearch(q, { maxResults: 4 })));
  const seen = new Set<string>();
  const merged: WebSource[] = [];
  for (const list of results) {
    for (const s of list) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      merged.push(s);
      if (merged.length >= limit) return merged;
    }
  }
  return merged;
}
