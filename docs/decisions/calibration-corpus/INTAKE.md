# Calibration Corpus — Case Intake Template (Green-Cap-Lift Gate)

> **Purpose**: the Decision-9 Green cap lifts only on calibration evidence —
> the bounded-analogy corpus defined by `docs/decisions/2026-08-24-class-c-decisions.md`
> (§ Calibration corpus) and grounded in `docs/research/residual-decisions-best-practice.md`
> §5. **5–10 real cases** are required to open a recalibration pass. This file
> is the intake schema: copy one block per case into
> `docs/decisions/calibration-corpus/cases.yaml` (create the directory on first
> case). **Never fabricate a case** — every field below must trace to a real,
> verifiable source; unverifiable realized outcomes make the case inadmissible.

## Per-case fields (all mandatory)

```yaml
case:
  case_id: CAL-001                # sequential
  title: "[anonymized deal label — no counterparty names unless public record]"
  source:                         # verifiable provenance of the realized outcome
    kind: public_filing | audited_internal | pilot_record   # pilot_record = docs/pilots/*.md
    ref: "[URL / filing id / pilot filename]"
  regime_context: "[deal window, rate environment, regulatory posture]"
  class_membership:               # ≥2 of these must match the rule's declared class
    industry: "[KSIC-aligned label]"
    deal_shape: "full_acquisition | majority_stake | spv | holdco_route | joint_venture | minority_stake | license_in | co_development"
    size_band: "[KRW commitment band]"
    intent: "integration | capability_access"
  gate_reached: "screening | pre_fs | fs | dd | entity_ic | group_ic | closed"
  estimates:                      # ORIGINAL gate-stage estimates — never revised ones
    - dimension: market           # one per calibrated dimension present at the gate
      var_key: "[e.g. market.tam]"
      original_estimate: [value]
      evidence_tier: direct_data | proxy_chain | expert_only
    - dimension: risk
      var_key: "[e.g. risk.contingent_expected_value]"
      original_estimate: [value]
      evidence_tier: proxy_chain
  realized:                       # outcome per estimated dimension, same keys
    - dimension: market
      var_key: "[same key as the estimate above]"
      realized_value: [value]
  decision_taken: "go | kill | hold | recycle"
  kill_or_risk_criteria_fired: "[ids or 'none']"
  case_date: YYYY-MM-DD           # cases older than 5–7 years are retired per the guards
```

## Acceptance guards (enforced at recalibration, restated here for intake)

1. A case joins a rule's reference class only on **≥2 pre-declared membership properties**.
2. If **<3 cases** match a rule, widen the class instead of fitting the rule.
3. Only pre-registered rules may calibrate: **Green-cap lift + threshold nudges — never new kill criteria**.
4. No rule is fitted to a single case; corpus evidence moves the Green cap **at most one confidence tier per revision**.
5. Realized outcomes cite their original approved baseline — later re-baselines are not outcomes.

## Status

- [ ] Cases collected: 0 / 5 (minimum) — **the Green cap stands until this reaches 5 with the guards satisfied**
- Intake convention adopted 2026-08-24 (Class C decisions); collection is an operational task owned by process-governance-manager with market-intelligence-agent support.
