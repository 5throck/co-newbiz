-- 0164_risk_assessment_sidecar_to_ledger.sql (2026-10-21, decider: proceed
-- with the remaining work). The 0156 sidecar
-- (md_project.risk_heatmap_assessment_json) was kept for two days as the
-- latest-per-key projection of the 0160 risk_assessment_ledger. The ledger is
-- now the only store: copy every sidecar assessment that has no ledger row yet
-- (so no person's judgement is lost), then drop the column. Sidecar entries
-- carry no mitigation; `by`/`at` are preserved when present.
INSERT INTO risk_assessment_ledger (id, project_id, item_key, likelihood, impact, mitigation, recorded_by, recorded_at)
SELECT
  lower(hex(randomblob(13))),
  p.id,
  j.key,
  json_extract(j.value, '$.likelihood'),
  json_extract(j.value, '$.impact'),
  NULL,
  COALESCE(NULLIF(json_extract(j.value, '$.by'), ''), 'migration-0164'),
  COALESCE(NULLIF(json_extract(j.value, '$.at'), ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM md_project p, json_each(p.risk_heatmap_assessment_json) j
WHERE p.risk_heatmap_assessment_json IS NOT NULL
  AND json_valid(p.risk_heatmap_assessment_json)
  AND json_extract(j.value, '$.likelihood') IN (1, 2, 3)
  AND json_extract(j.value, '$.impact') IN (1, 2, 3)
  AND NOT EXISTS (SELECT 1 FROM risk_assessment_ledger l WHERE l.project_id = p.id AND l.item_key = j.key);

ALTER TABLE md_project DROP COLUMN risk_heatmap_assessment_json;
