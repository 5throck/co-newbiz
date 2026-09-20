# Calibration Escalation — Deterministic CAGR Scaling

- Spec ID: `2026-09-20-calibration-escalation`
- Date: 2026-09-20
- Status: **Implemented**
- Related: `2026-09-18-s1-growth-gap-calibration-design` (loop), `2026-09-19-sim-engine-runtime-separation-design` §P3 (escalation trigger: 3 cycles below the ≤15% line → deterministic CAGR scaling as a human decision)

## Requirements

- REQ-E1: When the recorded gap stays above the 15% convergence line, an analyst (role ≥ analyst) can apply the deterministic CAGR scaling escalation for an industry with a mandatory rationale. The decision is a person's (boundary #2); the arithmetic is transparent.
- REQ-E2: The scaled value is `externalCagrPct × (1 − CONVERGENCE_TARGET_PCT/100)` — the external reference adopted with a documented conservatism haircut, leaving exactly the 15% residual gap. Inputs come from the LATEST completed version's `matrix.calibration` block; re-applying re-reads the latest state (append-only decisions, no payload rewrites).
- REQ-E3: The `보정 루프` panel shows the applied escalation (base → scaled CAGR, residual gap, decided_by/at, rationale) and offers the apply action only while the latest gap exceeds the line.
- REQ-E4: Escalations persist in `calibration_escalation` (migration 0119) and surface through the existing calibration GET (new `escalation` field).

## Design

- `computeDeterministicScaling(ourCagrPct, externalCagrPct)` in `lib/market-calibration.ts` (pure; `CONVERGENCE_TARGET_PCT = 15` — the same line `calibration-sweep.ts` uses; the ≥20% trigger stays untouched, so 15–20% remains the "in progress" band).
- `POST /api/market-overview/industry/{id}/calibration/escalate` — analyst+; body `{ rationale }`; 409 when the latest gap already ≤ 15% (nothing to escalate); audit-logged via the row itself (decided_by/at).
- `GET .../calibration` gains `escalation` (latest row or null).
- Panel (CalibrationPanel in `MarketAnalysisStage.tsx`): an apply disclosure (rationale textarea + button) gated on `latestGap > 15`, and an applied-state card showing base → scaled with the decision metadata.

## Verification

- [x] `tests/unit/calibration-escalation.test.ts`: scaling math (exact 15% residual), route roundtrip, ≤15% rejection, mandatory rationale
- [x] `bunx tsc --noEmit` clean; `bun run test:unit` green
