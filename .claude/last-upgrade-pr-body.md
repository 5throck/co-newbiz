## Upgrade delivery

Auto-composed from `.claude/last-upgrade-delivery.json` at delivery time — this body describes exactly the merged content.

- Variant: co-newbiz
- Template: 0.30.0 → 0.30.0
- Delivered: 109 file(s) at 2026-11-23T05:35:53.960Z

### Delivery footprint

- scripts/ — 22 file(s)
- .claude/ — 14 file(s)
- skills/ — 14 file(s)
- .agents/ — 13 file(s)
- .codex/ — 13 file(s)
- .gemini/ — 13 file(s)
- .hermes/ — 13 file(s)
- (root) — 4 file(s)
- docs/ — 2 file(s)
- .githooks/ — 1 file(s)

### Decisions

- INFO: 223 / WARN: 121 / ERROR: 28

**Unresolved ERROR dispositions** (CONFLICT/TOMBSTONED: delivery skipped, project copy preserved; BEHAVIOR_REGRESSION: delivered, new sibling-test failure):
- `.gitignore` (MERGE) — delivery would lower the LOCAL-PATCH marker count 1 → 0 (1 marker(s) lost) — MARKER_LOSS: write SKIPPED, project copy preserved (re-run with --disposition adopt-template[=glob] only once the template carries the patch hunk); lost LOCAL-PATCH ids: U-20261119-001
- `scripts/evidence-backport-scan.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/external-deps.ts` (SYNC_IF_NEWER: scripts/) — equal-version drift with no provenance (project-evolved since the last delivery) — CONFLICT disposition: restore SKIPPED, project copy preserved (a content change must bump the version template-side; re-run with --disposition adopt-template[=glob] to take the template copy)
- `scripts/generate-raci.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/generate-skill-graph.ts` (SYNC_IF_NEWER: scripts/) — delivery would lower the LOCAL-PATCH marker count 2 → 0 (2 marker(s) lost) — MARKER_LOSS: write SKIPPED, project copy preserved (re-run with --disposition adopt-template[=glob] only once the template carries the patch hunk); lost LOCAL-PATCH ids: U-20261108-001
- `scripts/handbook/check-authoring.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/helpers/hub-topology.ts` (SYNC_IF_NEWER: scripts/) — equal-version drift with no provenance (project-evolved since the last delivery) — CONFLICT disposition: restore SKIPPED, project copy preserved (a content change must bump the version template-side; re-run with --disposition adopt-template[=glob] to take the template copy)
- `scripts/helpers/memory-union-verify.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/helpers/security-validator.ts` (SYNC_IF_NEWER: scripts/) — delivery would lower the LOCAL-PATCH marker count 1 → 0 (1 marker(s) lost) — MARKER_LOSS: write SKIPPED, project copy preserved (re-run with --disposition adopt-template[=glob] only once the template carries the patch hunk); lost LOCAL-PATCH ids: U-20261108-001
- `scripts/helpers/ticket-drift.ts` (SYNC_IF_NEWER: scripts/) — delivery would lower the LOCAL-PATCH marker count 1 → 0 (1 marker(s) lost) — MARKER_LOSS: write SKIPPED, project copy preserved (re-run with --disposition adopt-template[=glob] only once the template carries the patch hunk); lost LOCAL-PATCH ids: U-20261108-001
- `scripts/hooks/delete-guard.ts` (SYNC_IF_NEWER: scripts/) — equal-version drift with no provenance (project-evolved since the last delivery) — CONFLICT disposition: restore SKIPPED, project copy preserved (a content change must bump the version template-side; re-run with --disposition adopt-template[=glob] to take the template copy)
- `scripts/hooks/pre-commit.ts` (SYNC_IF_NEWER: scripts/) — equal-version drift with no provenance (project-evolved since the last delivery) — CONFLICT disposition: restore SKIPPED, project copy preserved (a content change must bump the version template-side; re-run with --disposition adopt-template[=glob] to take the template copy)
- `scripts/hooks/pre-push.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/lib/constitution-scrub.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/lib/external-deps.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/lib/fleet.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/lib/git-aware-scan.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/lib/platform-skeleton-merge.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/lib/self-managed-tools.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/lib/trail-block-parity.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/lib/upgrade-policy.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/lifecycle-sync-audit.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/skill-lifecycle-audit.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/test-runner.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/validate-doc-folder.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/validate-raci.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/validate-templates.ts` (SYNC_IF_NEWER: scripts/) — project-evolved since the last delivery AND template changed — CONFLICT disposition: delivery SKIPPED, project copy preserved
- `scripts/verify-scripts.ts` (SYNC_IF_NEWER: scripts/) — equal-version drift with no provenance (project-evolved since the last delivery) — CONFLICT disposition: restore SKIPPED, project copy preserved (a content change must bump the version template-side; re-run with --disposition adopt-template[=glob] to take the template copy)

_Full inventory: `.claude/last-upgrade-delivery.json` (dev-sync Step 3.9 auto-E5 diff attribution; ERROR dispositions block auto-E5 until resolved)._
