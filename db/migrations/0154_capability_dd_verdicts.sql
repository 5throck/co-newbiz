-- 0154_capability_dd_verdicts.sql (2026-10-19 decider direction — Brownfield
-- 필요 역량 검증은 S9 실사·검증에서 수행한다; greenfield는 S5 capability-assessment).
--
-- The S3 필요 역량 register (capability_gap_json) is the input; the S9 DD
-- verdicts ride in a SIDECAR keyed by register row id — NOT inside the
-- register itself, so an S3-side re-save can never drop a DD verdict and the
-- register's own invalidation linkage (persistGapRegister) stays untouched.
-- Null = no capability DD recorded yet (the dd gate warning surfaces that
-- honestly instead of blocking).
ALTER TABLE opportunity ADD COLUMN capability_dd_verdicts_json TEXT;
