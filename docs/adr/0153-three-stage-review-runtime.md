# ADR-0153 — 3-stage review runtime (AI 1st, cross-domain AI 2nd, human final)

- Status: Accepted (2026-10-08, approved by the user in chat)
- Date: 2026-10-08
- Deciders: Human reviewer (user, approved in chat 2026-10-08). Drafted by platform-lead (Wave F Row 0). AI review alone cannot accept this ADR (schema change, security model, and boundary #2).
- Design of record: `docs/designs/2026-10-08-wave-f-process-closure-design.md` §4
- Related: migrations 0011/0033 (`review_stage`) and 0038 (`review_audit_sample`)

## Context

The Review Model in CLAUDE.md requires AI 1st → AI 2nd (different domain) → human final, with no PASS stamp. The tables exist, but no runtime writes them.

## Decision

1. Extend `review_stage` additively (migration 0124) with `artifact_key`, entity keys, `stage_id`, `content_hash`, `buckets_json` (verified / could_not_verify / needs_judgement), `author_domain`, `model_id`, and `cost_tokens`.
2. AI 1st is deterministic: predicates, Zod contracts, and checklists. AI 2nd is an LLM reviewer whose domain differs from the authoring agent's domain. It returns Zod-validated buckets with a non-empty `could_not_verify`. If the reviewer cannot be resolved or the LLM is unavailable, that is recorded as not performed.
3. Human final rows are written only as a side effect of the human gate decision, approval, or transition POST. AI stages can never set a decision-like `result`, and there is no PASS stamp.
4. The reviewer module must not write `gate_decision`, `approval`, or `venture_transition_decision`. This is enforced by tests (import graph, repository spies) and by repository guards.
5. Cost control: a content-hash cache, AI 2nd gated on a clean AI 1st, on-demand triggers, and a per-project monthly token cap.
6. The KPI is the agreement rate from human-recorded `review_audit_sample` rows.
7. Rollout order: the 7 gate proposals → S8–S11 → S1–S7, as separate PRs. Artifacts accepted before rollout are grandfathered.

## Consequences

- LLM spend becomes a governed, bounded cost.
- Reviewer domain resolution depends on agent domain metadata. It must be machine-readable.
- Humans see explicit gaps instead of an implied approval.

## Resolved questions (approved 2026-10-08)

1. Agent domain resolution uses a `domain:` frontmatter field added to `agents/*.md` in PR F-2.
2. The AI 2nd token cap comes from env `REVIEW_MONTHLY_TOKEN_CAP`, default 200k tokens per project per month. A capped review is recorded as "not performed".
