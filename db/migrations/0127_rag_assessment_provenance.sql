-- @reversible: true (additive ADD COLUMN x2 — rollback is pre-migration backup
-- restore, scripts/co-newbiz/restore.ts; ADR-0014. SQLite >= 3.35 can also
-- ALTER TABLE ... DROP COLUMN each added column.)
--
-- Wave F-5 (design 2026-10-08-wave-f-process-closure §5): rag_assessment rows
-- written by the web-side recompute (db/lib/rag-service.ts) carry their
-- provenance — which trigger produced them (ic_package_get /
-- gate_package_assembly / explicit POST recompute) and the SHA-256 inputs hash
-- used for idempotency (unchanged inputs -> no new row). CLI-written rows
-- (scripts/co-newbiz/rag.ts) leave both NULL, preserving historic semantics.

ALTER TABLE rag_assessment ADD COLUMN trigger_source TEXT;
ALTER TABLE rag_assessment ADD COLUMN inputs_hash TEXT;
