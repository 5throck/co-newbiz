---
lang: ko
lang_reason: source-material
---

# S6/S7 Brownfield — Tab Restructure and LLM-Assisted Discovery (ADR-0118 activation)

- Date: 2026-09-15
- Status: Implemented (mockup-approved process, same as the 2026-09-14 S4 redesign)
- Mockup: `docs/designs/mockups/2026-09-15-s6s7-brownfield-tabs-redesign.html` (interactive, click-through)
- Related: ADR-0118 (stage-scoped LLM decision support — §5 explicitly deferred S6 web-search candidate suggestion pending live-search grounding), ADR-0094 (S6/S7 completion criteria), ADR-0127/0120 (list/tab conventions)

## Problem

User review of `/brownfield` (2026-09-15) found two gaps: (1) nothing in 주요 평가항목 도출 → Long List 발굴 → Short List 선정 offered LLM support, and (2) the whole S6/S7 flow was one flat scroll — the gate/committee/promotion panels that DO carry LLM decision support were buried under a 600-line page.

## Decisions (user-confirmed)

1. **Universe definition criteria stay human-owned, but get an LLM draft.** The t-01~t-09 checklist itself stays FIXED (governance standard, identical across deals) — only "who fills the answers" gains an LLM draft.
2. **Long List discovery gets web-search-grounded LLM proposals now.** ADR-0118 §5's blocker (no live-search evidence source) is gone: `lib/web-research.ts` (Tavily) already serves DD tailoring and synergy search. `brownfield_target.discovery_source='web_proposal'` (migration 0087) was pre-defined but never written — no schema change needed.

## What shipped

- **Tabs**: universe / longlist / shortlist with `?tab=` deep-link sync (TabNav, deal-structure pattern). Opportunity chips stay above the tabs.
- **B — web-search candidate proposals** (`POST /api/brownfield/[oppId]/target-proposals/web-search`): Tavily evidence first (2-4 queries from market_scope + universe), then `completeOrFallback` proposing ONLY companies present in the numbered snippets with `source_indices` back-references; candidates without evidence citations are discarded; synthesis fallback (deterministic md_company suggestions) when search is unconfigured or empty. Audit: `target_proposal.web_search`. Acceptance reuses the existing registration route with `discovery_source=web_proposal` + evidence breadcrumb in `universe_note`.
- **D — universe criteria draft** (`POST .../universe-criteria-draft`): manifest = S1 latest completed analysis + S3 capability-gap register + Long List status, disclosed in the UI ("이 제안이 본 산출물"). With zero S1/S3 grounding the LLM is not called at all. "적용" fills the UniverseForm only — saving stays a human click. Audit: `universe_criteria.draft`.
- **E — screening verdict draft** (`POST .../targets/[targetId]/screening-draft`): per-checklist-item web search; only evidence-backed items get a draft verdict + rationale + source link; ungrounded items stay 미판정 with an explicit "사람이 직접 판단" note. UI fills only unjudged selects, tags them "LLM 제안 · 미확정" (tag clears on human edit), and the save/score/knock-out/promotion path is untouched by the LLM. Audit: `target_screening.llm_draft`.
- **Pre-existing bug fixed**: the proposal route was keyed by PROJECT id and resolved the opportunity through `md_project.source_opportunity_id` — before S7→S8 promotion (exactly when S6 runs) GET always 404'd and POST rejected, so the deterministic proposal section was silently empty. Moved to `POST/GET /api/brownfield/[oppId]/target-proposals`, opportunity-keyed.
- **Second bug fixed**: the screening POST returned `screening_summary` as a sibling of `target`; the client merge overwrote the row's summary with undefined, leaving the Short List promotion button locked after 판정 저장 until reload. The route now embeds the summary in the returned row (GET shape).
- Testability seam: `setWebResearchOverrideForTests` in `lib/web-research.ts` (same pattern as dd-checklist-tailor's executor factory) so fallback/grounding paths are hermetic even on machines with a real Tavily key.

## Boundary #2

All three LLM surfaces are on-demand POST, labeled 제안, show their input manifest or source URLs, and never write decisions — universe save, target registration, verdict save, promotion, and gate decisions remain human clicks.
