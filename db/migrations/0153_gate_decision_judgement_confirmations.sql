-- 0153_gate_decision_judgement_confirmations.sql (ADR-0182 §5)
--
-- The "판단 필요" review items the human explicitly reviewed ride WITH the
-- gate decision as a sidecar JSON array of claim texts — no new table
-- (ADR-0153 minimalism: the confirmation is provenance of the decision, not
-- a workflow object). Null = decision recorded without per-item
-- confirmations (checking is never required — it must not block a decision).
ALTER TABLE gate_decision ADD COLUMN judgement_confirmations_json TEXT;
