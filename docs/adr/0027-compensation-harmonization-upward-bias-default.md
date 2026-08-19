# ADR-0027: Compensation harmonization: upward-bias default

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: hr-integration-agent, legal-counsel

## Context

Naively averaging acquirer and target compensation levels ignores that Korean labor law (근로기준법 §94, unfavorable-change-to-employment-rules restrictions) generally prevents lowering compensation post-integration regardless of which side is higher.

## Decision

Model compensation harmonization with an explicit upward bias: whichever side is higher sets the post-integration floor for that job family/grade, in both directions of comparison.

## Consequences

Verification requires that both a target-higher and an acquirer-higher input case each raise the modeled labor cost — if only one direction rises, the unfavorable-change-restriction logic is not actually implemented (design §12).
