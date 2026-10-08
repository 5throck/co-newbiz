# Eval scoreboard — 2026-10-08 — offline-baseline

> Evidence for people, not a pass stamp. Scores come from deterministic comparison against the golden set (no LLM judge). Pilot outcomes are public and likely in model training data; that contamination cannot be removed.

| Field | Value |
|---|---|
| Golden version | 1.0.0 |
| Git SHA | 6b024b5e |
| Provider | none (offline, deterministic suites only) |
| Base URL host | - |
| Model id | - |
| Temperature | - |
| Repeat | 1 |
| Tokens (input / output / cache-read / cache-write) | 0 / 0 / 0 / 0 |
| Cost (USD) | 0 (no LLM calls) |
| LLM calls | 0 |

## Prompt hashes (SHA-256 of the system prompt)

| Function | Hash |
|---|---|
| review-ai2 | `8650469afb562f54dd398aec8fa3f4b641a6ef7ff404d8a99a2a9da7f1208d5f` |
| committee | `b71b296b8d6fe22de7b67ecb3d162b876d1933d72100f59c0da7e13738fb0c19` |
| dd-tailor | `cf73892d80d39af2045d3c33ca8b9e709e235e7c1af3971f302f39ffa95ae10d` |
| business-case | `45b1f093eb30e0753283a923a6921121c8e42223e43965c2e8b6a1e9005cc14e` |
| stage-reco | `ca6961ad571c972a648401a626c91234c9ae2e8776c3b12de47d6445127d8e5b` |

## Summary

| Suite | Kind | Cases scored | Mean score | Could not evaluate |
|---|---|---|---|---|
| rag | deterministic | 15 | 100.0% | 1 |
| kill | deterministic | 7 | 85.7% | 2 |
| antitrust | deterministic | 1 | 100.0% | 33 |

## Suite: rag

| Case | Stage | Function | Score | Failures |
|---|---|---|---|---|
| pilot-001 | S9 | rag_dimensions | 100.0% | - |
| pilot-001 | S9 | rag_overall | 100.0% | - |
| pilot-001 | S9 | confidence_cap | 100.0% | - |
| pilot-002 | S9 | rag_dimensions | 100.0% | - |
| pilot-002 | S9 | rag_overall | 100.0% | - |
| pilot-002 | S9 | confidence_cap | 100.0% | - |
| pilot-003 | S11 | rag_overall | 100.0% | - |
| pilot-004 | S11 | rag_overall | 100.0% | - |
| pilot-006 | S8 | rag_dimensions | 100.0% | - |
| pilot-008 | S9 | rag_dimensions | 100.0% | - |
| pilot-008 | S9 | rag_overall | 100.0% | - |
| pilot-009 | S8 | rag_dimensions | 100.0% | - |
| pilot-009 | S8 | rag_overall | 100.0% | - |
| pilot-010 | S9 | rag_dimensions | 100.0% | - |
| pilot-011 | S8 | rag_dimensions | 100.0% | - |

## Suite: kill

| Case | Stage | Function | Score | Failures |
|---|---|---|---|---|
| pilot-001 | S7 | kill_criteria | 100.0% | - |
| pilot-002 | S7 | kill_criteria | 100.0% | - |
| pilot-005 | S5 | kill_criteria | 100.0% | - |
| pilot-007 | S5 | kill_criteria | 100.0% | - |
| pilot-008 | S7 | kill_criteria | 0.0% | unexpected hit preliminary_hhi_flags_certain_block (golden expects []) |
| pilot-009 | S7 | kill_criteria | 100.0% | - |
| pilot-010 | S7 | kill_criteria | 100.0% | - |

## Suite: antitrust

| Case | Stage | Function | Score | Failures |
|---|---|---|---|---|
| pilot-008 | S6 | antitrust_flags | 100.0% | - |

## Could not evaluate

These expectations were NOT scored (neither pass nor fail): the fixture does not carry the structured input the engine needs.

| Suite | Case | Function | Reason |
|---|---|---|---|
| rag | pilot-010 | rag_overall | expected red needs structured inputs (kill-criteria var or graded dimensions) the fixture lacks |
| kill | pilot-005 | kill_criteria.infrastructure_plan_not_finalized_at_site_announcement | predicate variable not supplied by the fixture (UNASSESSED) |
| kill | pilot-010 | kill_criteria.preliminary_hhi_flags_certain_block | predicate variable not supplied by the fixture (UNASSESSED) |
| antitrust | pilot-001 | antitrust_flags.jurisdictions | fixture has no `jurisdictions` list |
| antitrust | pilot-001 | antitrust_flags.multi_jurisdiction | fixture has no `jurisdictions` list |
| antitrust | pilot-001 | antitrust_flags.hhi_flag | fixture lacks the two merging parties' individual pre-deal shares |
| antitrust | pilot-001 | antitrust_flags.filing_required | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-001 | antitrust_flags.combination_type | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-001 | antitrust_flags.product_overlap | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-001 | antitrust_flags.certain_block | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-002 | antitrust_flags.multi_jurisdiction | fixture has no `jurisdictions` list |
| antitrust | pilot-002 | antitrust_flags.filing_required | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-002 | antitrust_flags.combination_type | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-002 | antitrust_flags.product_overlap | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-002 | antitrust_flags.certain_block | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-003 | antitrust_flags.product_overlap | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-004 | antitrust_flags.product_overlap | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-006 | antitrust_flags.hhi_flag | fixture lacks the two merging parties' individual pre-deal shares |
| antitrust | pilot-006 | antitrust_flags.combination_type | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-006 | antitrust_flags.product_overlap | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-006 | antitrust_flags.certain_block | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-008 | antitrust_flags.filing_required | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-008 | antitrust_flags.combination_type | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-008 | antitrust_flags.product_overlap | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-008 | antitrust_flags.certain_block | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-009 | antitrust_flags.hhi_flag | fixture lacks the two merging parties' individual pre-deal shares |
| antitrust | pilot-009 | antitrust_flags.combination_type | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-009 | antitrust_flags.product_overlap | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-009 | antitrust_flags.certain_block | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-010 | antitrust_flags.jurisdictions | fixture has no `jurisdictions` list |
| antitrust | pilot-010 | antitrust_flags.hhi_flag | fixture lacks the two merging parties' individual pre-deal shares |
| antitrust | pilot-010 | antitrust_flags.filing_required | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-010 | antitrust_flags.combination_type | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-010 | antitrust_flags.product_overlap | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-010 | antitrust_flags.certain_block | judgement/threshold input not in fixture; no deterministic engine to score |
| antitrust | pilot-010 | antitrust_flags.relevant_markets | judgement/threshold input not in fixture; no deterministic engine to score |

## Skipped

- review-ai2 (LLM suites skipped: pass --llm with CO_NEWBIZ_EVAL_LLM=1 and a configured provider)
- stage-reco (LLM suites skipped: pass --llm with CO_NEWBIZ_EVAL_LLM=1 and a configured provider)
- committee (LLM suites skipped: pass --llm with CO_NEWBIZ_EVAL_LLM=1 and a configured provider)
- dd-tailor (LLM suites skipped: pass --llm with CO_NEWBIZ_EVAL_LLM=1 and a configured provider)
- business-case (LLM suites skipped: pass --llm with CO_NEWBIZ_EVAL_LLM=1 and a configured provider)

## Gates

Deterministic thresholds: held.

LLM call-site inventory: complete.
