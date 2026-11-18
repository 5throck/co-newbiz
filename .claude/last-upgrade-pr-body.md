## Upgrade delivery

Auto-composed from `.claude/last-upgrade-delivery.json` at delivery time — this body describes exactly the merged content.

- Variant: co-newbiz
- Template: 0.30.0 → 0.30.0
- Delivered: 340 file(s) at 2026-11-18T21:51:49.736Z

### Delivery footprint

- scripts/ — 155 file(s)
- docs/ — 42 file(s)
- .claude/ — 23 file(s)
- skills/ — 23 file(s)
- .agents/ — 22 file(s)
- .codex/ — 22 file(s)
- .gemini/ — 22 file(s)
- .hermes/ — 22 file(s)
- (root) — 7 file(s)
- .githooks/ — 1 file(s)
- agents/ — 1 file(s)

### Decisions

- INFO: 398 / WARN: 165 / ERROR: 27

**Unresolved ERROR dispositions** (CONFLICT/TOMBSTONED: delivery skipped, project copy preserved; BEHAVIOR_REGRESSION: delivered, new sibling-test failure):
- `.gitignore` (MERGE) — delivery would lower the LOCAL-PATCH marker count 1 → 0 (1 marker(s) lost) — MARKER_LOSS: write SKIPPED, project copy preserved (re-run with --disposition adopt-template[=glob] only once the template carries the patch hunk)
- `.github/workflows/ci.yml` (MERGE) — delivery would lower the LOCAL-PATCH marker count 14 → 6 (8 marker(s) lost) — MARKER_LOSS: write SKIPPED, project copy preserved (re-run with --disposition adopt-template[=glob] only once the template carries the patch hunk)
- `scripts/audit.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/dev-sync.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/evidence-backport-scan.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/external-deps.ts` (SYNC_IF_NEWER: scripts/) — equal-version drift with no provenance (project-evolved since the last delivery) — CONFLICT disposition: restore SKIPPED, project copy preserved (a content change must bump the version template-side; re-run with --disposition adopt-template[=glob] to take the template copy)
- `scripts/generate-skill-graph.ts` (SYNC_IF_NEWER: scripts/) — delivery would lower the LOCAL-PATCH marker count 2 → 0 (2 marker(s) lost) — MARKER_LOSS: write SKIPPED, project copy preserved (re-run with --disposition adopt-template[=glob] only once the template carries the patch hunk)
- `scripts/handbook/check-authoring.ts` (SYNC_IF_NEWER: scripts/) — delivery would lower the LOCAL-PATCH marker count 2 → 0 (2 marker(s) lost) — MARKER_LOSS: write SKIPPED, project copy preserved (re-run with --disposition adopt-template[=glob] only once the template carries the patch hunk)
- `scripts/helpers/hub-topology.ts` (SYNC_IF_NEWER: scripts/) — equal-version drift with no provenance (project-evolved since the last delivery) — CONFLICT disposition: restore SKIPPED, project copy preserved (a content change must bump the version template-side; re-run with --disposition adopt-template[=glob] to take the template copy)
- `scripts/helpers/memory-union-verify.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/helpers/security-validator.ts` (SYNC_IF_NEWER: scripts/) — delivery would lower the LOCAL-PATCH marker count 1 → 0 (1 marker(s) lost) — MARKER_LOSS: write SKIPPED, project copy preserved (re-run with --disposition adopt-template[=glob] only once the template carries the patch hunk)
- `scripts/helpers/ticket-drift.ts` (SYNC_IF_NEWER: scripts/) — delivery would lower the LOCAL-PATCH marker count 1 → 0 (1 marker(s) lost) — MARKER_LOSS: write SKIPPED, project copy preserved (re-run with --disposition adopt-template[=glob] only once the template carries the patch hunk)
- `scripts/hooks/delete-guard.ts` (SYNC_IF_NEWER: scripts/) — equal-version drift with no provenance (project-evolved since the last delivery) — CONFLICT disposition: restore SKIPPED, project copy preserved (a content change must bump the version template-side; re-run with --disposition adopt-template[=glob] to take the template copy)
- `scripts/hooks/pre-commit.ts` (SYNC_IF_NEWER: scripts/) — equal-version drift with no provenance (project-evolved since the last delivery) — CONFLICT disposition: restore SKIPPED, project copy preserved (a content change must bump the version template-side; re-run with --disposition adopt-template[=glob] to take the template copy)
- `scripts/hooks/pre-push.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/lib/external-deps.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/lib/fleet.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/lib/git-aware-scan.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/lib/self-managed-tools.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/lib/trail-block-parity.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/lib/upgrade-policy.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/lifecycle-sync-audit.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/skill-lifecycle-audit.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/test-runner.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/validate-doc-folder.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/validate-templates.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/verify-scripts.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved

_Full inventory: `.claude/last-upgrade-delivery.json` (dev-sync Step 3.9 auto-E5 diff attribution; ERROR dispositions block auto-E5 until resolved)._
