---
lang: ko
lang_reason: source-material
---

# DuckDuckGo Web-Search Fallback (Provider Chain in web-research)

- Spec ID: `2026-09-16-ddg-web-search-fallback`
- Date: 2026-09-16
- Status: implemented

## Problem

`app/web-next/lib/web-research.ts` was single-provider (Tavily). Two failure
modes silently emptied evidence downstream (S6 candidate proposals, S7
screening/eval drafts, profile cross-check, DD tailor): no `TAVILY_API_KEY`
(`isWebResearchConfigured() === false`), or quota exhaustion (HTTP 432) —
both surfaced as "0 proposals / 근거 부족" without a recovery path. The
`quotaExceeded` flag existed but no fallback consumed it.

## Design

Provider chain inside `web-research.ts` — no caller changes:

1. **Tavily stays primary** when `TAVILY_API_KEY` is set.
2. **DuckDuckGo fallback** engages when Tavily is unconfigured, quota-exceeded,
   or returned zero results: `html.duckduckgo.com/html/?q=` fetched with a
   browser User-Agent (default UA gets blocked), parsed by an exported pure
   function `parseDdgResults` — `result__a` anchors for title/link,
   `result__snippet` for snippets paired by order, `uddg` redirect params
   decoded to real source URLs, non-http(s) (ads/internal) dropped. Best-effort
   by contract: markup drift, rate-limiting, or CAPTCHA degrade to empty
   results and never block the calling flow.
3. **Config surface:** `WEB_SEARCH_DDG_ENABLED` (default on; `false|0|off`
   disables). `isWebResearchConfigured()` now means "Tavily key present OR DDG
   enabled" — with DDG on by default, evidence search is effectively always
   available, which is the point: the anti-fabrication boundary (ADR-0118)
   stays intact because un-judgeable items still go un-proposed, but the
   *ability to propose* no longer depends on a paid key.

## Trade-offs accepted

- DDG scraping is a ToS gray area and fragile — accepted for an internal
  analysis tool, mitigated by best-effort semantics, 15s timeout, and the
  disable switch.
- DDG snippets are shorter than Tavily's LLM-oriented content — acceptable for
  a fallback role; the primary engine is unchanged.

## Verification

- `tests/unit/web-research-ddg.test.ts`: parser decoding/tag-stripping/limit,
  Tavily-432 → DDG fallback (with `quotaExceeded` preserved), keyless+disabled
  stays "unconfigured" with zero network calls, Tavily success skips DDG.
- Existing consumers untouched; `setWebResearchOverrideForTests` semantics
  preserved.
