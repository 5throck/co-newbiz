---
lang: ko
lang_reason: source-material
---

# Competitor Follow-ups and Sidebar S6/S7 Split

- Spec ID: `2026-09-18-competitor-followup-nav-split`
- Date: 2026-09-18
- Status: implemented
- Depends on: `2026-09-18-company-competitor-registry-design` (ADR-0142) — must
  land on top of PR #343.

## Scope

Three deferred items from the competitor-registry review, delivered as one
stacked batch:

1. **On-demand web-search re-proposal endpoint** — until now payload
   competitors refreshed only via profile re-analysis. New
   `POST .../competitor-proposals/web-search` (member + company subjects)
   reuses the brownfield web-search ladder: real research first
   (`researchSourcesDetailed` → `playwrightSearch` fallback), LLM proposes
   only candidates citing valid evidence indices
   (`normalizeWebSuggestions` — names without `source_indices` are dropped as
   fabrication), environment failure degrades to an LLM-knowledge proposal
   with forced `[미검증]` labels. Stateless; audit
   `competitor_proposal.web_search{,_llm_knowledge}`. Prompt registered as
   `company_profile.competitor_web_search` (prompts.json → regenerated
   `prompts.generated.ts`).
2. **md_company competitor management UI** — the brownfield target-detail
   경쟁 포지셔닝 section gains `CompetitorRegistryBlock`: confirmed list
   (source chip, inline exclusion with mandatory reason, excluded-restore
   disclosure), payload proposals with per-item 수용, manual form. Company
   lifecycle routes (PATCH / exclude / restore) added to match the member
   routes; company `GET competitors?includeExcluded=1` returns all statuses
   for the block. Registered in `openapi.yaml`.
3. **Sidebar S6/S7 split** — the brownfield entry gains anchor children
   (`/brownfield#s6s7-universe` = S6 대상 후보 발굴, `/brownfield#s6s7-shortlist`
   = S7 대상 선정); the section divs already carry those ids with
   scroll-margin. AppShell parent-active now falls back to the item href so
   the parent highlights on `/brownfield`. Navigation test updated to strip
   the hash when resolving menu hrefs to pages (top-level order array and the
   duplicate check are unchanged).

## Requirements (ASD-STE100)

- R1: Web-search proposals are never persisted; a candidate without valid
  evidence indices is dropped. Accept remains a person's action through the
  existing POST competitors route (evidence array now accepted and snapshotted
  onto the row).
- R2: The company-subject registry surface supports edit/exclude/restore with
  the same audit actions as the member surface.
- R3: Anchor children resolve to real pages after stripping the hash; the
  parent link still opens the full S6/S7 screen.

## Out of scope (unchanged)

- ADR-0120 Wave 2 `/deals/[id]/[stage]` workspaces; deterministic CAGR-scaling
  escalation; Playwright-click root-cause investigation (needs a production
  build pass).
