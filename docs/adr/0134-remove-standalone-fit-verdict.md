# ADR-0134 — Remove standalone strategic-fit verdict (fit_verdict)

- Date: 2026-09-15
- Status: accepted (implemented same day)

## Context

A user wiring gap led to auditing every place the app computes a Go/Hold/Kill-shaped recommendation. The audit found four distinct mechanisms drawing from overlapping S1–S3 evidence (attractiveness, synergy, capability gap) with no cross-links between the screens that show them:

1. `fit_verdict` (적합성 판정) — `runFitAnalysis()` in `lib/opportunity-screening.ts`, a standalone LLM knock-out/portfolio-fit judgment, persisted to `opportunity.fit_verdict/fit_rationale/fit_source`.
2. `gateRecommendation()` — the "screening 진행 권고", a threshold combination of attractiveness + `fit_verdict` + synergy.
3. `computeTrackAdvisory()` — the S4 "진출방식 추천" (Greenfield vs Brownfield), combining market-growth/competitive-structure/synergy/capability signals.
4. The S4 5-criteria scoring table — the human's own input, LLM-draftable but not automated.

(1) and (2) were two layers of the same screening gate; (3) answered a different question but recomputed much of the same evidence. The user judged (1) specifically to be redundant clutter: it duplicated the "Go/Hold/Kill" shape of (2) without its own screen, was found to have never been wired to any UI action (a separate gap fixed and then reverted within this same session), and its removal was the user's explicit design call — not all four mechanisms, just this one.

## Decision

Remove `fit_verdict` as a standalone concept:

1. **`lib/opportunity-screening.ts`** — deleted `runFitAnalysis()` and its `industryContext()` helper (dead after removal). `ScreeningState` no longer carries `fit_verdict`/`fit_rationale`. `gateRecommendation()` now combines **only** attractiveness + synergy: Go if both ≥ 60, Kill if either falls below its floor (attractiveness < 60 or synergy < 40), Hold otherwise — the same thresholds as before, minus the `fit_verdict` clause.
2. **`app/api/opportunities/[id]/screening/route.ts`** — removed the `POST { kind: "fit" }` handler entirely (GET-only now); the OpenAPI spec entry was updated to match.
3. **UI removal**: the "적합성 판정 (Go/Hold/Kill)" block on `/synergy` (added earlier in this same session to close the wiring gap) was removed rather than kept, since the user's design call supersedes the interim fix. The `/opportunities/{id}` "S3 시너지·전략적 적합성" panel and the S4 route-decision fact-grid both drop their `적합성 {verdict}` chips; `screening 진행 권고` is now computed inline from attractiveness+synergy only.
4. **Context builders** (`route-recommendation`, `greenfield/[oppId]/recommendation`, `agents/query`, `gate-brief.ts`'s `s3Summary`) drop `fit_verdict`/`fit_rationale` from their SQL selects and prompt/context strings.
5. **No migration**: `opportunity.fit_verdict`, `fit_rationale`, `fit_source` columns are left in place per this repo's additive-only convention — historical rows stay inert and inspectable, nothing reads or writes them going forward.

## Consequences

- One fewer LLM call and one fewer Go/Hold/Kill badge competing for the user's attention per opportunity; `screening 진행 권고` is now a pure function of two already-visible scores (매력도, 시너지), making its math easy to verify by eye on the same screen.
- `computeTrackAdvisory()` (S4 진출방식 추천) is untouched — it answers a different question (트랙 선택) and was explicitly kept; this ADR does not claim the four-mechanism overlap is fully resolved, only that the (1)/(2) duplication is.
- Historical `fit_verdict` data is frozen, not deleted — any prior gate brief or audit trail referencing a recorded "적합성 Go/Hold/Kill" verdict remains readable directly from the `opportunity` table if ever needed, just no longer surfaced.

## Related

ADR-0051 (original 15-step chain concretization that introduced strategic-fit-screening as its own step), ADR-0118 (gate-brief deterministic fallback, whose `gateRecommendation()` reuse this ADR simplifies), ADR-0104 (track-advisory — the mechanism explicitly kept, not folded into this cleanup).
