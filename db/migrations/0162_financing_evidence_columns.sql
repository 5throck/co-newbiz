-- 0162_financing_evidence_columns.sql (2026-10-21 S10 "자금 확정성 증빙").
-- flow.spec S10 outputs: "자금조달 계획(sources & uses 균형·자금 확정성 증빙)";
-- procedures/_shared/deal-structuring steps 3 and 5: "Certainty of funds is
-- evidenced, never assumed: commitment papers or internal-funds approvals are
-- referenced". Until now that reference lived (if at all) in the free-text
-- note, so nothing could check it and S11 entity-ic-review step 4
-- (financing_readiness_check — FAIL without commitment papers) had no fact
-- source. Two nullable columns; the S10 completion predicate still requires
-- only the balance — certainty is S11's precondition, reported not enforced here.
ALTER TABLE financing_sources_uses ADD COLUMN evidence_kind TEXT
  CHECK (evidence_kind IS NULL OR evidence_kind IN ('commitment_letter', 'internal_approval', 'term_sheet', 'subsidy_grant', 'other'));
ALTER TABLE financing_sources_uses ADD COLUMN evidence_ref TEXT;
