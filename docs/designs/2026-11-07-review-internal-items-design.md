---
lang: ko
lang_reason: source-material
---

# AI 2nd review: keep system-internal items off the human decision surface

Status: proposed (design only, no code). Spec id: `2026-11-07-review-internal-items`. Owner: platform-lead (review); implementers: backend-engineer (`lib/review/*`), frontend-engineer (bucket rendering), under PM dispatch.

## 1. Problem

On `/deals/[id]/s3` (decision tab, gate review buckets) the AI 2nd review asks the human to decide on system plumbing, for example:

- "entity_id 01M6..., track field is null — intended or a missing-data error?"
- "Allow the gate to proceed with track unset?"
- "The coordinating agent was excluded from author-domain judgement."

Root causes:

1. `app/web-next/lib/review/ai-second.ts` — `SYSTEM_PROMPT` (~L117) and `ai2ndPayloadContent()` forward the gate artifact from `lib/review/gate-artifacts.ts` (~L144 `track: ev.track`, plus entity ids) raw to the LLM. The model treats ids and nulls as findings. `track` is legitimately `null` at opportunity gates before the S4 route decision.
2. `ai-second.ts` ~L360-395 appends routing-provenance claims (fallback reviewer, orchestrator-exempt agents, unresolved agents) into `buckets.could_not_verify`; `review-display.ts` localizes them. These describe how the review was routed, not what about the deal could not be verified.

## 2. Constraints (non-negotiable)

- No PASS stamp; output stays split into verified / could not verify / needs judgement.
- The AI must declare what it could not check: `could_not_verify` is never empty — if filtering empties it, keep/insert a real scope item (e.g. "source documents behind the artifact were not inspected").
- Silence is never approval: filtering may only remove items that carry no deal content.
- Provenance stays visible and auditable (stored, rendered), just not as a decision item.
- Onyx 3.0 (`docs/design-system`), next-intl ko/en, design:lint clean.

## 3. Decision

### 3.1 Payload sanitization (`gate-artifacts.ts` / `ai2ndPayloadContent`)
- Opaque identifiers (`*_id`, ULIDs, `entity_id`, run ids): omit from the LLM payload. Where an id is needed for cross-reference, emit it under an `identifiers` block labelled "system identifiers — not review subjects".
- `track` null before the route decision: replace with an explicit annotation `track: "not yet decided — set at the S4 route decision"` (derived from stage order, not hardcoded per gate). After S4, a null track stays null and is a legitimate finding.
- Generic rule: a field null because its owning stage has not run yet is annotated with that stage; unknown nulls pass through unchanged.

### 3.2 Prompt rule (`SYSTEM_PROMPT`)
Add: do not raise items about system identifiers, schema/plumbing fields, data-model nullability explained by an annotation, or reviewer routing/agent assignment. Raise only matters about the deal's substance and its evidence.

### 3.3 Provenance list
- Review result gains `provenance: ProvenanceItem[]` (`{ code, params }`, e.g. `fallback_reviewer`, `orchestrator_exempt`, `unresolved_agent`). Routing claims are written there instead of `could_not_verify`.
- UI renders it as a collapsed disclosure "검토 경위" / "Review provenance" below the three buckets; excluded from bucket counts and from any gate-blocking logic.

### 3.4 Deterministic post-filter (conservative)
Drop an LLM item only if ALL hold after removing identifier tokens (ULID regex `[0-9A-HJKMNP-TV-Z]{26}`, UUIDs, and tokens matching known internal field names from a fixed allowlist such as `entity_id`, `track`, `run_id`, `agent_key`):
- the item references at least one such token, AND
- the item contains no deal-content term (no number/amount, no reference to evidence, finding, risk, market, financial or regulatory term from a fixed list), AND
- the item matches one of the plumbing patterns (null/missing field, intended-vs-error, routing/agent exclusion).
The same predicate applies to `verified` items: a verified item that is ONLY about identifiers or schema fields (e.g. "entity_id, entity_type, gate fields are stated in the artifact") carries no deal content and moves to `provenance` too (PM decision 2026-11-07, from the real cached review). Korean-locale output is matched with a Korean vocabulary kept in `lib/review/internal-item-patterns.json` (matching data, not UI text). "근거" (rationale) is deliberately not a deal-content term on its own; real evidence is recognised via the subject terms and 증빙/증거/출처.
Dropped items are not discarded silently: they are recorded in `provenance` as `filtered_internal_item` with the original text, so the audit trail is intact. When in doubt, keep the item.

### 3.5 Backward compatibility
Stored reviews are not migrated. At read time (`review-display.ts`), items in `could_not_verify` matching the known provenance claim strings/codes (the exact strings currently emitted at ai-second.ts ~L360-395, ko and en) are reclassified into `provenance`. The never-empty rule is applied after reclassification (display a "scope not declared in this legacy review" item if needed). Stored LLM items in `could_not_verify` and `needs_judgement` also pass through the same conservative `filterInternalItems` at read time (PM decision 2026-11-07: the reported complaint is a cached legacy review); dropped items appear in `provenance` as `filtered_internal_item` with `legacy: true`. This is display-only: the stored row, its content hash and `unverified_items_json` are never mutated, so the audit record of what was originally written is intact.

## 4. Seams
- API/lib: payload, prompt, filter, provenance field (JSON column, no schema change if stored inside existing review JSON — confirm; if a column is needed, ADR + data-architect).
- UI: disclosure component, counts. No new tokens; reuse existing disclosure/`details` pattern.
- DB/ops: none expected.

## 5. Accessibility
- Disclosure uses native `<details>/<summary>` (or existing Onyx disclosure) — keyboard operable, state announced.
- Summary text includes count, e.g. "검토 경위 (3)"; not color-only.
- Bucket counts exclude provenance and their accessible names say so.
- Focus order: buckets then provenance; no focus trap.

## 6. Preview verification
- Breakpoints: desktop (≥1280) and 375px mobile.
- Interaction: expand/collapse 검토 경위 by mouse and keyboard (Enter/Space); verify counts unchanged.
- Check on `/deals/01M6JN4YGJXD0BYT7DFH9MWKQ0/s3` decision tab (legacy review → reclassification path) and a freshly requested review.

## 7. Test plan
- Unit: payload sanitizer (ids omitted/labelled; pre-S4 null track annotated; post-S4 null unchanged).
- Unit: post-filter — the three reported strings are dropped into provenance; items mixing an id with a deal finding are kept; never-empty `could_not_verify` invariant.
- Unit: legacy reclassification by known strings (ko/en).
- Component: provenance disclosure renders collapsed, excluded from counts.
- i18n: ko/en keys present (i18n lint); design:lint passes.

## 8. Files to touch
- `app/web-next/lib/review/ai-second.ts` (prompt, provenance emission, post-filter hook)
- `app/web-next/lib/review/gate-artifacts.ts` (sanitization/annotation)
- `app/web-next/lib/review/review-display.ts` (legacy reclassification, provenance localization)
- new `app/web-next/lib/review/internal-item-filter.ts` (+ tests)
- bucket UI component under `app/web-next/app/(...)/deals/[id]/` that renders review buckets
- `app/web-next/messages/{ko,en}.json`
- tests alongside the above

## 9. Addendum (2026-11-07): standing scope items are keyed
The never-empty scope items carry catalog keys `review.ai2.sourcesNotInspected` and `review.ai2.legacyScopeNotDeclared` (+ `…Reason`) in `locales/{ko,en}.json`, so no Korean literal lives in `lib/` (i18n-lint).
