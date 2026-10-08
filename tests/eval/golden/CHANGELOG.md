# Golden Dataset Changelog

## 1.0.0 — 2026-10-08

- Initial set: 14 cases (`pilot-001` … `pilot-014`), one per pilot doc in `docs/pilots/`. Author: risk-officer (Wave B-2). Needs second-domain review before the next version bump (design §3.3).
- Outcome labels on 003 (suspended), 008 (KFTC conditional approval), 009 (closed) and 010 (KFTC prohibition) only, per design §3.3. Each cites the pilot doc section that states the outcome.
- Added `post_decision_inputs_ref` and `input_basis` to the case shape. Several pilot RAG grades (001, 002, 008, 010 Regulatory/Permit) are derived from the regulator's decision itself. They test the engine's grading rules, but the decision is an outcome. So they read a separate post-decision fixture, which is exempt from the leakage lint and never used for calibration.
