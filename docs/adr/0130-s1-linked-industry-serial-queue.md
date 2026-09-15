---
lang: ko
lang_reason: source-material
---

# ADR-0130 — S1 linked-industry serial queue, operator-perspective proposals, first-analysis scope

- Date: 2026-09-13
- Status: accepted (implemented same day)
- Design of record: [docs/designs/2026-09-13-value-chain-linkage-queue-design.md](../designs/2026-09-13-value-chain-linkage-queue-design.md)
- Review: `memory/meeting-2026-09-13-s1-value-chain-linkage-design-review.md` (common meeting-facilitation flow, three persona panels) + committee-engine transcript (deterministic — recorded for the audit trail only)

## Context

User-reported on 2026-09-13 against the live S1 surface: (1) the 유압식 브레이커 → 건설기계(굴삭기·스키드로더) 장비 운용 link was tagged `relation='전방'` although the operator procures the breaker (후방); (2) selected linked industries' analyses spawned in parallel with the target, so a large selection delays the target analysis; (3) a new industry's first analysis should size only the target. The 1st-pass proposal prompt carried no perspective rule — the mislabeling was systematic.

## Decision

1. **Serial queue.** `market_sizing_analysis` gains a `'pending'` status, `after_analysis_id` (self-FK), `linked_relation`, `started_at`, a partial unique index (one active analysis per industry), and a queue index (migration 0094). Linked analyses are created `pending` against a running anchor (202 deferred) and start ONE AT A TIME after the anchor completes, demand-side (전방/전전방) first. The claim is a single conditional UPDATE (anchor completed + no group in_progress), so concurrent kicks cannot double-start. A failed anchor cancels its pending group; a failed dependent lets the queue continue. Liveness is server-owned: pipeline completion hooks + a `watch:run` recovery pass (`runMarketSizingQueuePass`) heal stale runs and claim ready pendings — the queue never depends on anyone opening the UI, and GET routes stay side-effect-free.
2. **First analysis = target only.** The new-analysis modal is preview-only (`이 산업만 분석`); linked industries are added after completion from the report CTA `연계 산업 이어서 분석` or the re-analysis modal, and every selection queues behind the anchor. Selection cap: 5.
3. **Operator-perspective proposals.** The 1st-pass prompt states the judgment rule from the operating-business perspective and consumes the actor type inferred from the industry name; the returned proposals are sanitized against the stored relation taxonomy, with 대체/보완 findings routed to a visible "대체 위협 (검토 필요)" surface instead of being dropped (they belong to the 6-axis linkage analysis, ADR-0025).
4. **Data correction under the ADR-0129 contract.** The mislabeled breaker link was retired (rationale recorded) and re-registered as 후방 with a real evidence_ref; relation overwrite remains forbidden.

## Consequences

- The target analysis can no longer be delayed by linked selections; total LLM spend becomes predictable (anchor first, then one linked run at a time, capped at 5 queued).
- Queue state is user-visible (`연계 대기 · N번째` chip, `시작 취소` chip with recovery guidance) and auditable (`queue_claim`/`queue_cancel`/`queue_recover` with system actor).
- Historical payload chainDirection entries keep the old label until each industry is re-analyzed; the corrected link governs new proposals.
- Deferred (roadmap): perspective as a stored industry attribute, proposal-to-run pinning, grade-gated expansion depth, chain quality metrics.

## Related

- ADR-0126 (가치사슬 연계 surface), ADR-0128 (1st-pass proposal), ADR-0129 (relation/hop_distance curation + retire contract), ADR-0096/0097 (deliberation engine — split into `lib/deliberation.ts` the same day so the committee skill and the common meeting skill no longer share a name).
