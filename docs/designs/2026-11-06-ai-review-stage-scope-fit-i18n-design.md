# AI review stage scope, S3 fit predicate, and review-text locale

- Spec ID: `2026-11-06-ai-review-stage-scope-fit-i18n`
- Date: 2026-11-06
- Status: approved (design) — implementation pending (PR1 → PR2 → PR3, sequential)
- Author: platform-lead (Row 0, Design Gate, ADR-0074)
- Trigger: opportunity `01M6JN4YGJXD0BYT7DFH9MWKQ0` (S3, status `assessed`,
  `synergy_score` confirmed, `fit_verdict` null)

## Problem

1. **AI 1st flags future stages as defects.** The screening gate spans S1–S4
   (`app/web-next/lib/process-flow.ts` `STAGES[].gateIds`). `buildGateArtifact`
   (`lib/review/gate-artifacts.ts`) includes every gate stage, and
   `runAiFirstChecks` (`lib/review/ai-first.ts` ~L57–64) puts each `locked`
   stage into `could_not_verify` with `structural: true`. That both reads as a
   defect and makes `hasStructuralGaps()` (~L82) true, so AI 2nd is skipped for
   any entity that has not yet reached the gate's last stage.
2. **S3 completion predicate reads the wrong field.** `process-flow.ts` S3
   (~L341) satisfies "strategic fit judgement" with `opp.rationale`, which is
   the S2 attractiveness rationale. Synergy confirmation
   (`app/api/opportunities/[id]/synergy-confirm`) does not set `status =
   selected`, so S3 keeps showing the "opportunity selection (selected) required" blocker — users read this
   as "confirmed but not connected".
3. **AI review text ignores the locale.** `ReviewItem`
   (`db/repositories/review.repository.ts` L21) stores English `claim`/`reason`;
   `lib/review-display.ts` `localizeItem` regex-translates to Korean only;
   `components/ReviewBuckets.tsx` hardcodes Korean labels. English users see
   mixed text; new claim wording silently escapes the regex table.

## Decisions

### Fix 1 — future stages are informational, not structural (PR1)

- Add a fourth, non-structural classification: a stage whose status is
  `locked` **and** whose sequence is after the entity's current stage becomes
  a `could_not_verify` item with `scope: "not_reached"` and
  `structural: false`. It is not omitted: the review-model rule that AI must
  declare what it did not check still holds, and there is no PASS stamp.
- `ReviewItem` gains optional `scope?: "not_reached"` (additive JSON field in
  `buckets_json`; no column change).
- A `locked` stage that is **before or at** the current stage (true predecessor
  breakage) keeps `structural: true`. `current` incomplete and `terminated`
  are unchanged.
- `hasStructuralGaps` is unchanged in code; it naturally stops counting
  not-reached stages. Consequence: AI 2nd may now run on an S3 entity for the
  screening gate. The AI 2nd prompt (`lib/review/ai-second.ts`) is told that
  `not_reached` stages are out of scope and must not be graded.
- UI (`components/ReviewBuckets.tsx`): `not_reached` items render in a
  collapsed sub-group "Not reached yet" (Korean UI label) at the end of
  the could-not-verify bucket, neutral tone (not the warning tone), with a
  count in the summary. Human final ack lists them so the reviewer still sees
  them.

- Guard (added in implementation): when every stage of a gate artifact is
  `not_reached`, `runAiSecond` records "not performed" with reason "No stage of
  this gate has been reached yet" instead of calling the LLM on an empty payload.

### Fix 2 — S3 predicate and explicit human selection (PR2, ADR required)

**Finding that changes the brief:** `lib/opportunity-screening.ts` L1–7
records that the separate fit verdict (`opportunity.fit_verdict`, migration
0052) was **removed by user decision on 2026-09-15** as a duplicate of the
attractiveness + synergy signals. Reviving `fit_verdict`/`fit_rationale`
would reverse a recorded decision. Two options:

| Option | Predicate "strategic fit judgement" reads | Cost |
|---|---|---|
| A (recommended) | the confirmed synergy rationale (`synergy_rationale`, set by synergy-confirm) — the S3 judgement the 2026-09-15 decision kept | no schema change; no new UI field |
| B | `fit_verdict` + `fit_rationale` (columns already exist, migration 0052) | reverses the 2026-09-15 decision; needs a write path in PATCH and an S3 form |

Common to both options:
- Grandfathering: opportunities with `created_at < ADR_0192_PREDICATE_DATE`
  keep the legacy predicate (`opp.rationale`), following the
  `ADR_0151_MIGRATION_DATE` / `ADR_0180_PREDICATE_DATE` pattern in
  `process-flow.ts` (L69–84, L324). No backfill.
- Selection stays a human action: synergy-confirm never sets `selected`. The
  S3 screen shows a three-step guide — (1) confirm synergy, (2) fit judgement
  satisfied, (3) primary action "Select
  this opportunity" which calls existing `PATCH /api/opportunities/[id]`
  `{status: "selected"}` (route.ts L53–90, already validated and terminal).
  The button is enabled only when (1) and (2) are met; the blocker text
  changes from a defect phrasing to the next-step phrasing.
- One primary action per screen (Onyx 3.0); the select button replaces, not
  adds to, the current primary once synergy is confirmed.

### Fix 3 — locale-keyed review items (PR3)

- `ReviewItem` gains optional `key?: string` and
  `params?: Record<string, string | number>` (additive JSON inside
  `buckets_json`; English `claim`/`reason` stay as the canonical stored text
  for audit and MCP consumers).
- AI 1st emits keys for every item it builds (`review.ai1.stageIncomplete`,
  `review.ai1.stageNotReached`, `review.ai1.stageSkipped`, ...). AI 2nd
  (`lib/review/ai-second.ts`) items are free LLM text: they carry
  `key: "review.ai2.freeText"` with no params, and the LLM is asked to answer
  in the request locale; the stored English is kept as fallback.
- Rendering: `ReviewBuckets.tsx` resolves `t(key, params)` via next-intl
  (ADR-0184) messages `ko`/`en`; bucket labels move to messages too. Items
  without `key` (legacy rows) fall back to `localizeItem` for `ko` and raw
  text for `en`.
- MCP `get_review_buckets` keeps returning `claim`/`reason` unchanged; `key`
  and `params` pass through additively.
- Follow-up landed (2026-11-07): the UI-sent `locale` is now validated
  (`/^[a-z]{2}(-[A-Z]{2})?$/`, advisory — never a 4xx) in
  `lib/review/http.ts`, threaded through `ReviewRunContext` → `Ai2ndRequest`,
  and `buildAi2ndMessages` appends a BCP-47 writing directive to the system
  prompt when set (spec 2026-11-06-ai-review-stage-scope-fit-i18n; prompt is
  byte-identical when absent).

## PR split (sequential; merge each before the next per the Sequential Branch Dependency Rule)

| PR | Scope | Files |
|---|---|---|
| PR1 | Fix 1 | `lib/review/ai-first.ts`, `db/repositories/review.repository.ts` (type only), `lib/review/ai-second.ts` (prompt scope line), `components/ReviewBuckets.tsx`, `lib/review-display.ts` |
| PR2 | Fix 2 + ADR-0192 | `docs/adr/0192-*.md`, `lib/process-flow.ts`, `process/flow.spec.yaml` (S3 completionCriteria wording + version bump), S3 stage component (`components/stages/synergy/*`), `app/api/opportunities/[id]/route.ts` (only if option B) |
| PR3 | Fix 3 | `db/repositories/review.repository.ts` (type), `lib/review/ai-first.ts`, `lib/review/ai-second.ts`, `lib/review-display.ts`, `components/ReviewBuckets.tsx`, `messages/ko.json`, `messages/en.json` |

## Tests

- PR1: unit — S3 entity on screening gate yields not-reached items for S4 with
  `structural: false`, `hasStructuralGaps` false; a predecessor-locked stage
  stays structural; terminated stays structural. Component test for the
  collapsed group and count.
- PR2: unit — new predicate (fit satisfied by option-A/B field), grandfathered
  opportunity still passes on `opp.rationale`, synergy-confirm leaves status
  untouched; route test for `selected` transition and audit row; e2e — confirm
  → select → S4 unlocked.
- PR3: unit — key/params rendering ko/en, legacy item fallback, AI 2nd free
  text; snapshot of MCP `get_review_buckets` shape (additive only).

## Accessibility (ADR-0065)

- The not-reached group uses a native `<details>/<summary>` (keyboard and
  screen-reader expandable) with a text label and count; state is never
  conveyed by colour alone (icon + text).
- The S3 select button is a real `<button>` with a text label; when disabled,
  `aria-describedby` points to the visible next-step text explaining why.
- Locale change sets `lang` on rendered review text; no truncation of Korean
  or English strings (i18n-layout).

## Preview verification (ADR-0070)

Each PR is verified in the running app at ≥2 breakpoints (mobile 375, desktop)
with ≥1 interaction: PR1 expand the not-reached group; PR2 confirm synergy then
click Select; PR3 the same review panel in **both ko and en**.

## ADR determination

| Fix | ADR? | Reason |
|---|---|---|
| 1 | No | Review classification + additive JSON field; no schema, procedure, or predicate change. Recorded here. |
| 2 | **Yes — ADR-0192 (drafted in PR2)** | Changes a stage completion predicate and `flow.spec` S3 criteria; if option B, also reverses the 2026-09-15 decision. PM approves; human sign-off. |
| 3 | No | Additive optional JSON keys in `buckets_json`; no column/migration (verified: `buckets_json` is a TEXT JSON column, migration 0124). Follows ADR-0184. |

## Risks and grandfathering

- PR1 makes AI 2nd run earlier (cost and noise). Mitigation: not-reached
  stages are excluded from the AI 2nd artifact payload, not just labelled.
- PR2 tightening could block in-flight S3 opportunities; grandfathering by
  `created_at` prevents retroactive blocking (ADR-0151 precedent).
- PR3 LLM output in the request locale may differ from the stored English;
  English remains the audit record.
- Existing stored buckets have no `scope`/`key`; all new fields are optional
  and render via legacy fallbacks.

## Resolved questions

1. Fix 2: **option A chosen** by the user on 2026-11-06 — the confirmed synergy
   rationale is the strategic-fit judgement; `fit_verdict`/`fit_rationale` stay removed.
2. S3 Select action: no mandatory selection note — the click plus the audit row
   suffice (PM default; user did not request a note).
