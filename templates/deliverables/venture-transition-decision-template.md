---
governance_doc_id: tpl-venture-transition-decision
layer: template
title: "Venture Transition Decision Record Template"
scope: shared
enforceability: recommended
owner_agent: docs-writer
version: "1.0.0"
effective_from: "2026-08-23"
output_type: venture_transition_decision
---

<!--
  output_type: venture_transition_decision — "Portfolio monitoring — human
  tranche + kill/graduate decision: next_tranche_released |
  held_evidence_incomplete | graduate_to_core | reduce_or_divest |
  kill_with_learning_captured (ADR-0052 §E.2/E.3)". Produced at
  portfolio-venture-monitoring step 3 — a HUMAN-authority step
  (venture-portfolio-ic, procedures/_human-roles.yaml). The tranche call
  AND the kill/graduate call are taken in one sitting, on the step-2
  evidence pack. A kill is a governed decision with learning capture, not
  a silent starve. This template IS the signature surface — no PASS stamp;
  the human surface is verified / could not verify / needs judgement.
-->

# [Venture Name] — Venture Transition Decision

**Run ID**: [run_id] · **Review cycle**: [review_cycle] · **Evidence pack**: [venture_transition_evidence ref] · **As of**: [as_of]

## 1. Decision (closed vocabulary — exactly one)

**Decision**: [ ] next_tranche_released · [ ] held_evidence_incomplete · [ ] graduate_to_core · [ ] reduce_or_divest · [ ] kill_with_learning_captured

**Rationale** (citing the evidence-pack rows that drove it, not restating them): [2-4 sentences]

## 2. Tranche disposition (completed in the same sitting as the kill/graduate call)

- **Tranche in question**: [stage / amount] · **Preconditions status**: [n met / n total, per evidence pack §1]
- **If held_evidence_incomplete**: the named missing evidence: [items] · the re-review window: [date]

## 3. If kill_with_learning_captured — Learning Record (mandatory section on a kill)

- **What the venture validated before the kill**: [learning, with evidence refs]
- **What the portfolio now knows that it did not when the tranche was released**: [statement]
- **Where the learning is stored for future gates**: [ref — assumption registry / review model input]

## 4. If graduate_to_core — handover record

- **Receiving core organization**: [org] · **BAU-exit preconditions status**: [refs] · **Open obligations transferred**: [list]

## 5. Human sign-off (this is a human-authority step — ADR-0053)

| Member (venture-portfolio-ic) | Surface | Note |
|---|---|---|
| [member] | verified / could not verify / needs judgement | [what could not be verified, if anything] |

Silence is never read as approval; an unverified item is carried into the record explicitly.
