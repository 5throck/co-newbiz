---
lang: ko
lang_reason: source-material
---

# S1 value-chain linkage — serial analysis queue, operator-perspective proposals, first-analysis scope

Date: 2026-09-13
Status: implemented
Review: design-review meeting 2026-09-13 (`memory/meeting-2026-09-13-s1-value-chain-linkage-design-review.md`, three persona panels — methodology, backend/data, UX/red-team — under the common meeting-facilitation flow)

## Problem

Three user-reported defects around the S1 "가치사슬 연계 산업" flow:

1. **Relation mislabeling** — the live `proxy_link` row 유압식 브레이커 → 건설기계(굴삭기·스키드로더) 장비 운용 was tagged `relation='전방'` with placeholder evidence (`.`). From the equipment-operator perspective (the industry's own name declares 장비 운용), the breaker is a procured attachment → 후방. The 1st-pass LLM proposal prompt had no perspective rule, so such flips are systematic, not incidental.
2. **Parallel spawn delay** — the re-analysis modal spawned every selected linked industry's analysis immediately alongside the target; with a large selection the target analysis competes for LLM/DB throughput and is delayed.
3. **First-analysis scope** — a brand-new industry's first analysis should size only the target; the pre-evidence LLM proposals should not invite analysis spend before an anchor exists.

## Review outcome (what the meeting changed)

The engine-based committee CLI could not deliberate substantively (deterministic member executor), so the review ran as persona panels under the common meeting-facilitation flow. Panel findings folded into this design:

- **Backend/data P0**: a rebuild-declared self-FK (`REFERENCES market_sizing_analysis_rebuilt`) survives RENAME dangling in this SQLite build — the self-reference is therefore added via `ALTER TABLE ADD COLUMN` after the RENAME (verified against a scratch DB with `foreign_key_list` + insert smoke tests).
- **Backend P0 + red-team RT-1**: queue liveness must not depend on the UI. Completion hooks drive the queue; a `watch:run` recovery pass heals stuck rows and claims ready pendings. The earlier GET-kick idea (heal on list read) was rejected by the panel — GET must stay side-effect-free (viewer-triggered LLM spend).
- **Backend P1-2**: the claim is ONE conditional UPDATE (`pending` + anchor completed + no group `in_progress` + oldest-demand-first) so concurrent kicks cannot double-start; verified by test that a second claim returns nothing.
- **Backend P1-4**: rerunning a root cancels its leftover pending dependents ("루트 재분석으로 대기 취소") — no zombie generations.
- **Methodology P0**: substitutes/complements must not vanish. The proposal sanitizer routes `대체`/`보완` relations to a separate `substitutes` list surfaced in the modal as "대체 위협 (검토 필요)" (6축 linkage territory, never chain candidates); only unusable entries are dropped. Verified separately: the sizing pipeline already consumes only 전방/전전방 curated edges for demand (`curatedForwardDemand`), so the corrected 후방 link cannot pollute sizing.
- **Methodology D1/D2 dissents**: spawned linked analyses are STANDALONE sizings of the linked industry's own data (path i) — no cross-industry hop bridging occurs, so the uncalibrated-hop grading concern does not arise; this is now stated explicitly.
- **UX P0/P1**: the report view gains the post-completion affordance (`연계 산업 이어서 분석` CTA), polling includes pending rows, the modal title/copy is mode-branched (미리보기 vs 선택), the pending chip shows queue position (`연계 대기 · N번째`), the proposal chip is relabeled `제안 (검증 전)`, the 403 branch gets its own copy, and the queue is capped at 5 selections.

## Decision

### Serial queue (migration 0094 + pipeline hooks)

`market_sizing_analysis` gains `'pending'` in its status CHECK plus nullable columns `after_analysis_id` (self-FK), `linked_relation` (전방|전전방|후방|후후방), `started_at`; partial unique index `uq_msa_one_active(industry_id) WHERE status IN ('in_progress','pending')` and `idx_msa_queue(after_analysis_id, status)`.

- `POST /api/market-overview/analyses` accepts `after_analysis_id` + `linked_relation`. Anchor must exist, must not be the target's own industry; `in_progress` anchor → row created `pending`, pipeline NOT started, `202` deferred; `completed` anchor → runs immediately (anchor kept for provenance); `failed`/`pending` anchor → `409 anchor_not_ready`. Duplicate guards reuse an existing `in_progress` or oldest `pending` row for the industry.
- Completion hooks: after the pipeline's version-insert transaction commits, `releaseQueueNext` resolves the queue root (`after_analysis_id ?? id`) and claims the next pending dependent; after a failure, a failed ROOT cancels its whole pending group (`queue_cancel` audit) while a failed DEPENDENT just lets the queue continue. The seed route fires the same hook.
- Liveness: `watch:run` gains `runMarketSizingQueuePass` — heals `in_progress` rows older than 30 minutes (`COALESCE(started_at, created_at)`) and claims pendings whose root completed (crash-window recovery). No in-process timers (house rule); audit actions `market_sizing_analysis.queue_claim` / `queue_cancel` / `queue_recover` use the system actor `market-sizing-queue`.
- Rerun of a root cancels leftover pendings before restarting; a `pending` row rerun request answers `alreadyQueued`.

### First analysis = target only

The new-analysis modal is preview-only: candidates and substitutes are listed read-only ("제안 (검증 전)"), checkboxes render only in the re-analysis modal, the primary button is `이 산업만 분석`. Selection therefore happens post-completion (report CTA or list 재분석), and every selected linked analysis queues behind the anchor — the target analysis is never delayed.

### Operator-perspective proposals + data correction

The `related-candidates` prompt now states the perspective rule explicitly (사업자가 조달·지불하는 산업=후방, 사업자의 산출물에 지불하는 수요처=전방, 2홉=후후방·전전방), injects the actor type inferred from the industry name (운용/제조/유통), requires trade-direction notes, and instructs substitutes/complements to be labeled `relation:"대체"`. The sanitizer enforces the stored taxonomy. The live link was corrected per the ADR-0129 contract — retire + re-register as 후방 with a real evidence_ref (`scripts/co-newbiz/fix-construction-machinery-link.ts`, idempotent, audited); a placeholder-evidence sweep is part of the script output (3 additional thin-evidence rows in other industries surfaced for human review, not auto-retired).

## Value-chain effectiveness notes (meeting synthesis, non-code)

Perspective declaration as a first-class industry attribute, demand-side-first staged expansion (S1 forward 1-hop; backward/2-hop deepening at FS/DD), evidence-grade-gated depth (uncalibrated hops cap RAG confidence), chain-as-master-data (approved proxy_link accumulation reduces per-run LLM guessing), strict topology vs 6-axis separation, and chain quality metrics (relation-flip rate, approval rate) are recorded as open roadmap items in the meeting transcript.

## Tests

- `tests/unit/linked-analysis-chaining.test.ts` — 202 deferred creation, duplicate reuse, anchor validation (missing/self/failed/invalid-relation), demand-first claim order + concurrency-1 + root-completed gating, group cancel, release gating, recovery pass (spawning disabled via the `CO_NEWBIZ_QUEUE_NO_SPAWN` test seam).
- `tests/unit/value-chain-proposal-sanitize.test.ts` — whitelist pass-through, substitute routing, drop rules, cap-6, name normalization.
- Full suite 1211 pass / 0 fail; `tsc --noEmit` clean; migration verified on a scratch DB and applied to the live DB with the checklist in the migration header (backup `co-newbiz.sqlite.bak-0094`).

## Out of scope

Rewriting historical payload chainDirection (re-analysis with the hardened prompt self-corrects), a DB perspective field, proposal-to-run pinning, grade-gated expansion, chain quality metrics dashboards, queue staleness surfacing in the UI, per-row cancel buttons, our-company page queueing.
