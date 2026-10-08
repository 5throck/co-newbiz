# Golden Dataset Changelog

## 1.1.0 — 2026-10-08

- Added the optional `known_disagreement` field (`ref` to a `docs/audits/` record + `summary`) to every expectation. A suite reports such an expectation under "could not evaluate" and does not score it until a human ADR resolves the disagreement. The labelled answer itself is not changed.
- `pilot-008` S7 `kill_criteria` (`hits: []`) is marked `known_disagreement`. The registry predicate for `preliminary_hhi_flags_certain_block` is the rebuttable 2023 presumption zone, and pilot 008 (HHI about 7,900, delta about 3,730) sits deep inside it, yet the KFTC cleared it with a structural remedy (pilot-008 §1; pilot-010 §2 classes it as high-but-resolvable). The golden label and the fixture are correct; the rule's naming/threshold semantics are the open question. Finding: `docs/audits/2026-10-08-pilot-008-hhi-presumption-vs-certain-block.md`. Author: quant-methodologist (Wave B-3). Second-domain review (antitrust-agent / risk-officer) still owed before the next bump.
- The `kill` suite regression threshold rises from 0.85 to 1.0 (the new recorded baseline).

## 1.0.0 — 2026-10-08

- Initial set: 14 cases (`pilot-001` … `pilot-014`), one per pilot doc in `docs/pilots/`. Author: risk-officer (Wave B-2). Needs second-domain review before the next version bump (design §3.3).
- Outcome labels on 003 (suspended), 008 (KFTC conditional approval), 009 (closed) and 010 (KFTC prohibition) only, per design §3.3. Each cites the pilot doc section that states the outcome.
- Added `post_decision_inputs_ref` and `input_basis` to the case shape. Several pilot RAG grades (001, 002, 008, 010 Regulatory/Permit) are derived from the regulator's decision itself. They test the engine's grading rules, but the decision is an outcome. So they read a separate post-decision fixture, which is exempt from the leakage lint and never used for calibration.
