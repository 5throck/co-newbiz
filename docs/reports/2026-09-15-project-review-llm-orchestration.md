# Project Review — co-newbiz — 2026-09-15 (scoped: runtime LLM orchestration)
**Date**: 2026-09-15
**Scope**: scoped — external LLM API usage at runtime vs PM-agent orchestration (ADR-0078/0118/0128)
**Method**: machine battery + 2 parallel Explore agents (runtime surface, governance) + PM remediation

## Baseline
audit.ts PASS · verify-scripts 157/0 · agent-lifecycle-audit 41 healthy · skill-lifecycle 147/147

## Review Results — co-newbiz — 2026-09-15 (scoped)

### 🔴 Critical
(none — no CI/script/MCP surface calls LLMs; no path persists an LLM verdict as final)

### 🟡 High — all fixed in-session
| # | Issue | Agent | File:Line | Class | Fix |
|---|---|---|---|---|---|
| H1 | LLM run-ledger (ADR-0128 §1) incomplete: pipeline calls omitted `agent` meta; `complete()` bypassers (llm-executors, committee-llm) unledgered | Runtime | `lib/synergy-pipeline.ts:295`, `lib/market-sizing-pipeline.ts:230,256`, `lib/llm-executors.ts`, `lib/committee-llm.ts` | systemic | Ledger logging moved into `complete()` itself (single-write, no double-log); agent meta threaded through all bypass sites ✅ |
| H2 | `GET /api/synergy/web-search` exposed paid Tavily search to viewers — ADR-0118 analyst+ floor violation, no cost control | Runtime | `app/api/synergy/web-search/route.ts` | one-time | Added viewer `forbidden("role_required")` guard matching sibling routes ✅ |
| H3 | ADR-0128 runtime PM orchestration (commit 355c56eb) shipped with no design doc / registry entry — Universal Design Gate violation | Governance | `docs/specs/registry.json` (absent) | script-gap (spec-check did not block the commit) | Backfilled `docs/designs/2026-09-15-runtime-pm-agent-orchestration-design.md` + registered ✅ |

### 🟢 Moderate — fixed in-session
| # | Issue | Agent | File:Line | Class | Fix |
|---|---|---|---|---|---|
| M5 | `classifyIndustryKsic` wrote an LLM-chosen KSIC code to `md_industry` with no audit provenance | Governance | `lib/market-sizing-pipeline.ts:296` | one-time | Added `appendAudit` `md_industry.ksic_llm_fill` ✅ |
| M6 | S6 web-search proposal ledger key (`brownfield-agent`) mismatched flow.spec activity owner (`market-intelligence-agent`) | Governance | `target-proposals/web-search/route.ts:117` | one-time | Key aligned to SSOT owner ✅ |
| M7 | AGENTS.md ADR-0078 citation path ambiguous vs this repo's own different ADR-0078 | Governance | `AGENTS.md:181` | one-time | Qualified as workspace-root with explicit note ✅ |
| M2 | Tavily errors swallowed silently — outage indistinguishable from "no evidence" | Runtime | `lib/web-research.ts:46,51` | one-time | `console.error` with reason ✅ |
| M4 | `.env` parser kept surrounding quotes → silent 401s | Runtime | `lib/llm.ts:66` | one-time | Quote-stripping added ✅ |

### ℹ️ Low / deferred (variant project — recorded here + memory log for workspace-root triage)
- **validator-hardening: audit.ts should flag `completeOrFallback(`/`complete(` call sites without `agent` meta** (H1 class) — structural enforcement instead of convention.
- Cost controls: LLM retry quadruples `maxTokens` (5× worst-case budget); no per-day token/call budget; unbounded parallel fan-out in `researchSources`. Suggested: cap retry multiplier, daily budget check backed by `llm_call_log`.
- Stage routes bypass the PM router (by design per ADR-0128 §1) — consider a shared registration so the `/agents` surface can enumerate stage-scoped LLM surfaces.
- Tavily calls are not in `llm_call_log` — consider a `web-research` ledger agent key.

### ✅ Strengths
- Single LLM egress choke point (`lib/llm.ts`) with a disciplined `completeOrFallback` envelope; deterministic fallback never fabricates.
- S6/S7 web-search features are exemplary ADR-0118 implementations (evidence-grounded, human-applies, audited).
- Secrets stay server-side; append-only ledger schema with cost/audit index.
- Runtime PM router (`lib/pm-router.ts`, `/api/agents/query`) is a faithful port of the PM-gateway principle with provenance.

## Verification
- `bun scripts/test-runner.ts unit` — pass (103 files)
- `bun scripts/audit.ts` — all checks passed (incl. spec-check with two newly registered design docs)

## Action wiring
- Fixed in-session: H1–H3, M2/M4/M5/M6/M7. Design docs registered: `2026-09-15-runtime-pm-agent-orchestration-design`, `2026-09-15-llm-orchestration-hardening-design`.
- Deferred: the validator-hardening ticket + cost-control items above.
