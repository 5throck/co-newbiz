# Project Review — co-newbiz — 2026-11-22

**Date**: 2026-11-22
**Scope**: full (variant project; four paired review slots + machine battery)
**Method**: 4 parallel review agents (Architecture/Scaffolding = platform-lead, Standards/Lifecycle = process-governance-manager, Automation = automation-engineer, Docs/Security = docs-writer + security-engineer) + the project's own validator battery
**Tree**: PR #965 branch (main 34105abb + the dual-reviewed leftover batch)

> Analysis only — no files modified in this report. All fixes route through the PM Gateway in follow-up sessions; action wiring is recorded in the Action Wiring section.

## Baseline (machine battery, 2026-11-22)

| Validator | Result |
| --- | --- |
| scripts/audit.ts | PASS (all checks; 1 SKIP — Design-lint gate: scan roots configured for L0 (templates/co-design/playground/src) absent in variant; judged fail-open posture, see F-18) |
| scripts/validate-templates.ts | N/A — variant context (no templates/common) |
| scripts/verify-scripts.ts --verify | PASS — 311 registered scripts, 0 warnings |
| agent-lifecycle-audit | ⚠ 45 agents scanned, 44 warnings (stale last_updated frontmatter vs last commit) |
| skill-lifecycle-audit | ⚠ 109 skills scanned, 49 warnings (active skills missing lifecycle records) |
| L1↔L2 drift (propagate-to-templates --check-drift) | N/A — L0-only script absent in variant |
| ticket.ts | absent in variant → deferred items recorded in this report + memory log (skill Step 5 variant rule) |

## Findings

Dedup: 1 cross-domain duplicate merged (ADR-index gap: Slot B-H2 ≡ Slot D DOC-1; credited to both). Severity 🔴 Critical = fix immediately; 🟡 High ≤ 1 week; 🟢 Moderate ≤ 2 weeks. Class drives wiring: one-time / systemic / script-gap (script-gap → validator-hardening loop per the skill's ratchet principle; in this variant recorded here until a standing check lands).

### 🔴 Critical (fix immediately)
| # | Issue | Agent | File:Line | Class | Fix |
| --- | --- | --- | --- | --- | --- |
| F-1 | ADR-0070 server-boundary gate silently lost in the 2026-08-29 upgrade wave (commit 4d6793e6 removed what 0a701b29 added); lint-server-boundary.ts referenced by nothing; live tree carries 5 page-level `db/client.ts` imports outside app/api (greenfield/opportunities/market/synergy/brownfield page.tsx — landed #862, 2026-11-11, design never mentions ADR-0070); ADR-0070:3 + SCRIPTS.md:95 still claim "CI-wired" | platform-lead | docs/adr/0070…md:3; scripts/audit.ts (0 hits); scripts/co-newbiz/lint-server-boundary.ts (exit 1: 5 violations) | systemic | Re-home the gate as a blocking entry in scripts/co-newbiz/audit-variant.ts (upgrade-proof); decide the open question FIRST — record ADR-0070 amendment sanctioning read-only all-authenticated carrier resolution (#862) vs moving the 5 pages behind Route Handlers; then correct ADR-0070:3 + SCRIPTS.md:95 |
| F-2 | FR-SYS-02 / ADR-0040 MNPI MCP default-exclusion is not wired to any live surface: every production call site passes excludeMnpi:false; the audited override hook mnpiScopeOverrideBy has no production caller; security-model.md §7 evidence cites tests/files that do not exist (api.test.ts/mcp.test.ts contain zero MNPI references; app/server/ removed by ADR-0069) | security-engineer | app/web-next/lib/project-visibility.ts:23; app/api/projects/route.ts:23; db/repositories/project.repository.ts:446-450; docs/security/security-model.md:92 | systemic | Wire exclusion by principal (MCP/bearer path → excludeMnpi:true unless scoped override; pass mnpiScopeOverrideBy so the audit row fires); add an MCP-path control test that fails today; regenerate security-model §7 evidence against the live stack |

### 🟡 High (fix within 1 week)
| # | Issue | Agent | File:Line | Class | Fix |
| --- | --- | --- | --- | --- | --- |
| F-3 | committee-registry.generated.ts has no generator and no drift gate — its own "regenerate" instruction is unfulfillable; currently in sync (latent risk) | platform-lead | app/web-next/lib/committee-registry.generated.ts:1-2; tests/unit/committee-registry.test.ts (0 refs) | script-gap | Dedicated generator (or extend generate-process-flow.ts) + --check + PROJECTION_GENERATORS row + unit pin vs procedures/_committees.yaml |
| F-4 | spec-activities.generated.ts + stage-guides.generated.ts + docs/process-flow.md have --check modes but are absent from audit-variant's blocking PROJECTION_GENERATORS — stale projections pass /sync locally, fail only in CI unit job (the exact late-failure class v1.10.0 exists to kill) | platform-lead | scripts/co-newbiz/audit-variant.ts:300-319; scripts/dev-sync.ts:972 | script-gap | Append the two generators to PROJECTION_GENERATORS; bump audit-variant 1.11.0 |
| F-5 | Core scripts audit.ts/dev-sync.ts carry unresolved ERROR-severity CONFLICT dispositions (2 LOCAL-PATCHes: U-20261107-003, U-20261108-001); L0 six minor versions behind L1; no upstream promotion tracker (docs/upstream-fix-list.md absent) — the same loss class as F-1 | platform-lead | .claude/last-upgrade-delivery.json; scripts/verify-scripts.ts --check-drift | systemic | Create the promotion tracker; land the 2 LOCAL-PATCHes upstream; adopt next wave |
| F-6 | skills/strategic-fit-screening still teaches the removed Go/Kill/Hold/Recycle decision surface (removed 2026-09-15, ADR-0192; flow.spec calls it a removed duplicate layer) — skill predates the removal and was never swept | process-governance-manager | skills/strategic-fit-screening/SKILL.md:8,80-84,90-92 | systemic | Revise to the current surface (rationale + recommendation chips + human selection per ADR-0192); sweep sibling screen skills (portfolio-fit-assessment, stage-gate-governance) |
| F-7 | docs/adr/README.md missing 23 of 206 ADR rows (0114–0123, 0152–0154, 0156–0158, 0178–0183, 0197) — incl. amendment targets of indexed ADRs (ADR-0114←ADR-0191, ADR-0154←ADR-0203) | process-governance-manager + security/docs pair | docs/adr/README.md:129-130,157-159,177-178,195-196 boundaries | systemic | Backfill 23 rows; add an ADR-index completeness gate (every docs/adr/NNNN-*.md has an [NNNN] row) |
| F-8 | docs/specs/registry.json missing 25 design docs (210 registered vs 236 on disk), incl. designs of record for Accepted ADRs (ADR-0168…0172, ADR-0193); drift stopped after 2026-11-08 but never backfilled; DEC-20261113-04/06 confirm landing-time registration is a manual PM step with no gate | process-governance-manager | docs/specs/registry.json; docs/designs/ (25 files) | script-gap | Bookkeeping PR: spec-register the 25 (explicit allowlist for minutes/benchmarks) + extend audit spec-check with an unregistered-design check |
| F-9 | Agent lifecycle records actively WRONG (content drift, not just date staleness) for the two most-operated agents: pm (record stops 2026-08-19 vs agent v1.2.0/2026-11-18 — misses the Nov 19 clause that fired the mirror gate) and i18n-specialist (stops 2026-09-15 vs Nov 10 changes); other 42 flagged agents are date-only staleness | process-governance-manager | docs/lifecycle/agents/pm.md, i18n-specialist.md | systemic | Rewrite both records' phase history; extend validate-agents to WARN when record-newest-date < frontmatter last_updated |
| F-10 | The 49 skills missing lifecycle records are exactly the pipeline-active Wave 5.8 cohort (S3–S12 spine incl. strategic-fit-screening, stage-gate-governance, monte-carlo-simulation); the record generator's gate only hooks common/template-delivered skills — variant-own pre-gate cohort never backfilled | process-governance-manager | docs/lifecycle/skills/ (44 records vs 94 active) | systemic | Run generate-skill-lifecycle-records.ts --project . --write; add the project arm to the audit gate (error, not warn) |
| F-11 | Share-link creation has no MNPI gate: POST /api/projects/[id]/share-links checks role+visibility only; public GET /api/share/[token] serves flagged projects unauthenticated with no data_access_log | security-engineer | app/api/projects/[id]/share-links/route.ts:28-54; app/api/share/[token]/route.ts | systemic | Refuse share_link.create when mnpi_flag=1 (403 mnpi_share_blocked) or require live insider status + audit; state the rule in security-model §4 + api-spec |
| F-12 | deal-deletion-playbook omits the ADR-0133 production-mode gate: documented procedure fails with undocumented 403 production_mode_delete_blocked (system_setting seeds production, fail-closed) | security/docs pair | docs/runbooks/deal-deletion-playbook.md:37-41,89-101 | systemic | Add system-mode prerequisite note + 403 row + ADR-0133 citation (en+ko counterparts) |
| F-13 | Visual smoke geometry gate failing in scheduled CI (run 43860220505: 0 pass/1 fail) while continue-on-error:true paints the workflow green — red gate structurally indistinguishable from green | automation-engineer | .github/workflows/visual-smoke.yml:32 | systemic | Split job: geometry assertions blocking, continue-on-error only on the screenshot aHash-diff step; annotate on geometry failure |
| F-14 | main has no branch protection/rulesets (public repo): web-UI merges bypass the entire gate battery; setup-github-branch-protection.ts exists but was never applied | automation-engineer | gh api branches/main/protection → 404 | script-gap | Apply the script (--check CI --check quality minimum) or record the accepted solo-repo risk in governance docs |
| F-15 | CI_SKIP_DEFAULT_UNIT_TESTS=true has been the steady state since 2026-10-01: the 7191-test unit suite's only CI execution is quality.yml coverage; ci.yml "Unit + Script Tests" runs script tests only (misleading name) | automation-engineer | gh variable list; ci.yml:114-121,175-176 | systemic | Decide deliberately: unset the variable or delete the dead job + rename honestly |
| F-16 | contrast:check is registry-claimed "CI-wired" (SCRIPTS.md:123) but wired to nothing — WCAG AA regression in styles.css would land silently | automation-engineer | scripts/SCRIPTS.md:123; grep contrast in workflows/audit/dev-sync/hooks → 0 | script-gap | Add a --check gate to audit-variant or correct the registry wording to manual cadence |
| F-17 | Real-tree locale-jargon scan has no automated caller; its unit test covers fixtures only (contrast: i18n-lint's test runs the real tree) | automation-engineer | tests/unit/locale-jargon-lint.test.ts:8-18 | script-gap | Add a real-tree test (scanLocales → [] honoring allowlist) mirroring the i18n-lint pattern |
| F-18 | Design-lint posture fail-open for this variant: the blocking token-SSOT gate is a permanent honest SKIP (scan roots configured for L0), and scripts/co-newbiz/design-lint.ts (which scans the real styles) has no automated caller — baseline-judgment row | automation-engineer | scripts/audit.ts:1989-2001; scripts/helpers/design-lint-roots.ts:104-110 | systemic | variant.json designLint override naming real roots, or wire co-newbiz/design-lint.ts into audit-variant |

### 🟢 Moderate (fix within 2 weeks)
| # | Issue | Agent | File:Line | Class | Fix |
| --- | --- | --- | --- | --- | --- |
| F-19 | prompts.generated.ts generator has no --check and no gate; deep-equality unit test is the only net (CI-unit only) | platform-lead | scripts/co-newbiz/generate-prompt-registry.ts | script-gap | Add --check + PROJECTION_GENERATORS row when next touching the area |
| F-20 | Dual generator mechanism footgun: dev-sync 3.86 generators.json (absent here) regenerates but only audit-variant enforces — one governance sentence needed | platform-lead | scripts/dev-sync.ts:808-832 | script-gap | Note in scripts/README.md or audit-variant header |
| F-21 | 15 SKILLS.md rows carry last_reviewed dates with no anchor in the artifact (engine writes recorded as reviews — violates the project's own doctrine) | process-governance-manager | skills/SKILLS.md (15 rows) | systemic | Real review pass or set cells to —. Narrowed 2026-11-22: the reproducible criterion (registry date with no matching last_reviewed anchor in the artifact frontmatter, verified at 34105abb) yields 4 rows — ip-fto-review, partnership-health-scorecard, waiver-management, assumption-audit — all set to —; the remaining dated rows without in-repo artifacts are variant-exclusive/retired tables whose artifacts live at L0 (outside this tree) and were left untouched; owner reconciliation of the original 15-row list is a recorded follow-up. |
| F-22 | Pipeline-dispatched skills still labeled experimental/draft (assumption-audit = S3 activity per owner decision D6'; waiver-management = compliance-officer core per ADR-0036) — deliberate but unrecorded | process-governance-manager | skills/assumption-audit, waiver-management SKILL.md frontmatter | one-time | Promote or record the disposition in the registry notes cell |
| F-23 | SCRIPTS.md removal-date column overloaded as free text on ~15 rows (flags/prose in a date column) | process-governance-manager | scripts/SCRIPTS.md:61,182,191,206,224,226,231,246,281,295 | script-gap | verify-scripts WARN on non-date/non-dash values; move prose to the Guide section |
| F-24 | AGENTS.md §7 says "All 40 specialist agents"; roster is 44 specialists + pm | process-governance-manager | AGENTS.md:145 | one-time | De-number or correct |
| F-25 | Registry cosmetics: SKILLS.md:4 mirror list omits .codex/.hermes; 14 non-padded table rows; strategic-fit-screening relates_to duplicate | process-governance-manager | skills/SKILLS.md:4; skills/strategic-fit-screening/SKILL.md:33,41 | one-time | Mechanical cleanup |
| F-26 | api-spec.md stale for the tombstone-DELETE surface (openapi.yaml correct): /api/projects/:id lists GET only; opportunities DELETE row + production-mode 403 absent | docs-writer | docs/architecture/api-spec.md:35 | systemic | Add DELETE rows + 403; extend the existing openapi↔handler drift check to api-spec.md method sets (script-gap candidate) |
| F-27 | Language gate allowlist skips docs/architecture, manuals, runbooks, security, dd, planning — policy-shaded Korean prose invisible (ui-spec.md: 240 Hangul lines, no lang frontmatter; security-model 22; api-spec 23) | docs-writer | scripts/validate-md-language.ts:226-244 | script-gap | Extend allowlist or document a UI-string carve-out; give ui-spec.md an explicit lang declaration |
| F-28 | Mojibake in docs/security/security-model.md: `짠` ×21 (section marks), `??` for —, `횞` for × (only file in docs/ affected) | docs-writer | docs/security/security-model.md:9,10,32,35 +18 | one-time | One encoding-repair pass; flag 2 ambiguous `??` spots to the author |
| F-29 | business-manual §1 Pre-FS gate row predates ADR-0205 (missing the human Pre-FS GO duty; §7 is fresh) | docs-writer | docs/manuals/business-manual.md:24 | systemic | Extend the row: human GO at opportunity scope; HOLD-after-GO relocks (en+ko) |
| F-30 | No dependabot config; dependency freshness rides the manual CI audit job (waiver-aware, fail-closed) | security-engineer | .github/ (absent) | one-time | Enable Dependabot or record the explicit decision + cadence in security-baseline.md |
| F-31 | Missing timeout-minutes on most quality/docker/mcp-package jobs (360m GitHub default) | automation-engineer | .github/workflows/quality.yml:17-77; docker.yml; mcp-package.yml | one-time | Add 10-30m timeouts per ci.yml convention |
| F-32 | ci.yml has no concurrency group (quality.yml has one) — 3 redundant full runs observed in 7 minutes | automation-engineer | .github/workflows/ci.yml | one-time | Add the same concurrency block |
| F-33 | test:visual bypasses the test-runner (no timeout, no budgets, one monolithic test() over 24 paths — the CI kill shape matches the missing ceiling) | automation-engineer | package.json test:visual; tests/e2e-visual/stage-visual-smoke.test.ts:215 | systemic | Add a visual suite to test-runner.ts (sequential + budget) or explicit per-test timeout |
| F-34 | Stale workflow references in pre-push.ts (test.yml "Workspace audit"/"Run integration tests" — neither exists) | automation-engineer | scripts/hooks/pre-push.ts:243,256-257 | one-time | Update comments to ci/quality reality |
| F-35 | quality.yml stale "Hosted runs are blocked by billing" note — e2e ran on hosted runners successfully | automation-engineer | .github/workflows/quality.yml:104 | one-time | Delete the sentence |
| F-36 | integration suite is a configured permanently-empty gate (tests/*.test.ts = 0 files; survives via --allow-empty) | automation-engineer | scripts/test-runner.ts:168 | script-gap | Remove the suite or move the flag decision into the registry with intent comment |
| F-37 | check-wiki-nav has no package.json alias (enforcement intact via unit suite; convenience only) | automation-engineer | package.json | one-time | Add wiki:nav-check alias |

### ℹ️ Low / Improvements
- SKILLS.md header mirror list, non-padded rows, relates_to duplicate (folded into F-25).
- design-lint SKIP verdict honesty itself is good post-U-20261006-004 (never fakes Pass) — the fix is posture, not honesty (F-18).
- Roster tier distribution 19 high / 26 medium / 0 low matches the review-lead posture (platform-lead observation, no action).

### ✅ Strengths (verified by the slots, not assumed)
1. MCP REST-only (ADR-0011/0070 code side): zero db imports in mcp/co-newbiz (comments only).
2. Append-only audit (ADR-0012) enforced at the DDL layer (triggers) + retention exclusion; no delete/update code paths.
3. FR-SEC-03 membership-as-access verified at db/lib/access-control.ts:85-131,188-211.
4. Spec registry: 210 entries, 0 missing files, 0 duplicate ids.
5. All nine generator --check gates green today; agent-mirror parity exit 0; process-ssot-check 8/8; validate-agents 91 files 0 errors.
6. SCRIPTS.md registry ↔ disk exact sync (both directions).
7. Single shared E2E harness (scenarios/visual/capture/demo all import one boot path) — the duplication concern does not exist.
8. dev-sync fail-closed pipeline exemplary (branch gate pre-staging, full audit at 4.9, tmp sweep, scoped-staging re-derivation); hooks portable (no sed -i/grep -P/readlink -f), rev-list token allowlist.
9. Auth sweep: 371 route files — only 13 lack authenticate() and all are public by design; 404-not-403 held in every sampled path; all 38 /api/admin/* use requireAdmin; ADR-0146 admin seam holds.
10. PBKDF2 210k iterations reused via import (FR-SEC-09); no md5/sha1 outside git content addressing; no hardcoded credential-shaped strings; .env gitignored.
11. insider_list grant→enrollment same-transaction; requireInsiderIfMnpi wired on pre-IC/post-management routes; MNPI reads logged.
12. CI least-privilege throughout: top-level contents:read, SHA-pinned actions, persist-credentials:false, fail-closed mcp-package guard.
13. Bilingual manuals/runbooks frontmatter + counterpart chains all correct; openapi.yaml current for sampled surfaces with a drift-gate backstop.
14. Decision records (DEC-20261113-*, DEC-20261121-01) cited as model specimens of ADR-0061 discipline.
15. Registry row accuracy: all 109 SKILLS.md rows match frontmatter exactly; flow.spec reference integrity 100% (67 skills / 24 agents / 24 procedures resolve).

## Action wiring (Step 5 — variant rule: recorded here + memory log; ticket.ts absent)

Fix-now candidates (require PM Gateway dispatch in follow-up sessions, in recommended order):
1. F-1 — needs the owner ruling first (ADR-0070 amendment vs Route-Handler move), then audit-variant wiring + doc corrections. Security-engineer ruling + backend-engineer implementation.
2. F-2, F-11 — security control fixes (MNPI exclusion wiring + share-link gate) + live control tests. backend-engineer + security-engineer review.
3. F-13, F-14 — outer-ring CI truthfulness (visual smoke split; branch protection decision).
4. F-3/F-4/F-16/F-17/F-18 (+F-19/F-20 opportunistically) — validator-hardening wave: audit-variant/PROJECTION_GENERATORS extensions + real-tree lint callers. automation-engineer/backend-engineer.
5. F-6..F-10 — records/bookkeeping PR (ADR index backfill, spec registrations, skill lifecycle backfill, pm/i18n records, strategic-fit-screening revision).
6. F-5 — upstream promotion (release-engineer; workspace-root coordination).
7. F-12/F-21/F-22/F-24..F-29/F-31..F-35/F-37 — docs/workflow hygiene batch (docs-writer + automation-engineer).
8. F-30 — dependabot decision (owner decision required).

Deferred (no ticket tool in variant — tracked here and in memory log): F-15 and F-30 need an owner decision before any code moves; F-14 alternative (accept solo-repo risk in writing) likewise.

## Verification (2026-11-22)

Landed findings of the three-wave remediation batch (F-1..F-37), one line each with commit-wave attribution (Wave 2 security / Wave 3 hardening / Wave 4 records — commit order 1–3; the memory log is commit 4). Deferred items stay in Action Wiring above.

| Item | Wave | Landed as |
| --- | --- | --- |
| F-1 | Wave 2 security | DEC-20261122-01 amends ADR-0070 (allowlist mode: exactly the 5 carrier flat-route pages, frozen module set, no write-SQL shapes); lint-server-boundary v1.1.0 re-homed as a blocking audit-variant gate; stale "CI-wired" wording corrected in ADR-0070 + SCRIPTS.md; CR-3 predicate parity pinned by carrier-resolve.test.ts. |
| F-2 | Wave 2 security | MNPI exclusion wired by principal (machine principals → excludeMnpi) on the projects route via project-visibility + mnpiScopeOverrideBy; security-model §7 evidence regenerated against the live stack; pinned by mnpi-mcp-exclusion.test.ts. |
| F-11 | Wave 2 security | share-link creation refuses MNPI-flagged projects (403 mnpi_share_blocked); rule stated in security-model §4 + api-spec + openapi 403 response; pinned by share-link-mnpi-gate.test.ts. |
| F-3 | Wave 3 hardening | generate-committee-registry.ts (new) + PROJECTION_GENERATORS row + byte-stability unit pin; its first run healed real drift (the ADR-0202 wording never reached the projection). |
| F-4 | Wave 3 hardening | generate-spec-activities + generate-process-flow joined the blocking PROJECTION_GENERATORS — audit-variant now runs all 6 projections. |
| F-13 | Wave 3 hardening | visual-smoke.yml split: geometry assertions blocking, continue-on-error scoped to the screenshot aHash step, annotation on geometry failure. |
| F-14 | Wave 3 hardening | branch protection applied via setup-github-branch-protection.ts with the 7 real check-run names (ground-truthed via the checks API, not guessed) — see battery row. |
| F-15 | Wave 3 hardening | dead unit-tests job deleted, the surviving job renamed honestly ("Script Tests") with the coverage-job pointer; CI_SKIP_DEFAULT_UNIT_TESTS variable removal is a residual owner web-UI action. |
| F-16 | Wave 3 hardening | contrast-check v1.1.0 (--check) wired as a blocking audit-variant gate; the false "CI-wired" registry claim corrected. |
| F-17 | Wave 3 hardening | real-tree locale-jargon test added (scanLocales → [] honoring the allowlist), mirroring the i18n-lint pattern. |
| F-18 | Wave 3 hardening | variant-owned design-lint wired blocking (clean on the tree); the core audit.ts gate keeps its honest SKIP — the 197-finding token burn-down is a recorded design-system follow-up. |
| F-20 | Wave 3 hardening | generator governance sentence in the audit-variant header: a new generator needs BOTH the generators.json entry (regeneration) and a PROJECTION_GENERATORS entry (enforcement). |
| F-23 | Wave 3 hardening | verify-scripts v1.15.0 Check 5c WARNs on overloaded removal-date cells (5 fixture cases). |
| F-31 | Wave 3 hardening | timeout-minutes added across the quality/docker/mcp-package jobs. |
| F-32 | Wave 3 hardening | ci.yml gains the quality.yml-style concurrency group. |
| F-34 | Wave 3 hardening | pre-push.ts stale workflow references updated to ci/quality reality. |
| F-35 | Wave 3 hardening | stale hosted-runner billing note deleted from quality.yml. |
| F-36 | Wave 3 hardening | permanently-empty integration suite removed (test-runner v1.12.0: no default suite, test:integration alias gone; --allow-empty mechanism untouched). |
| F-37 | Wave 3 hardening | wiki:nav-check alias added to package.json. |
| F-6 | Wave 4 records | strategic-fit-screening v1.2.0 revised to the ADR-0192 surface (rationale + deterministic recommendation chip, human records the gate decision); all 5 platform mirrors synced. |
| F-7 | Wave 4 records | ADR index backfilled — the 23 missing rows added (index now covers all 206 ADRs). |
| F-8 | Wave 4 records | spec registry gap closed: 233/236 designs registered (22 backfill entries + the Wave 2 security design); the 3 remaining are the explicit minutes/benchmark/matrix allowlist. |
| F-9 | Wave 4 records | pm and i18n-specialist lifecycle records rewritten to current (content drift, not just dates). |
| F-10 | Wave 4 records | skill lifecycle records backfilled — 65 records generated, 35 updated; 109/109 active skills now recorded (skill-lifecycle-audit 0 warnings). |
| F-12 | Wave 4 records | deal-deletion playbook gains the ADR-0133 production-mode prerequisite + the 403 production_mode_delete_blocked row (en + ko). |
| F-21 | Wave 4 records | narrowed criterion applied: the 4 verifiable rows set to —; owner reconciliation of the original 15-row list is a recorded follow-up. |
| F-22 | Wave 4 records | dispositions recorded in registry notes cells (waiver-management deliberately experimental per ADR-0036; assumption-audit per D6'). |
| F-24 | Wave 4 records | AGENTS.md §7 roster count corrected (de-numbered). |
| F-25 | Wave 4 records | SKILLS.md cosmetics: mirror list gains .codex/.hermes, non-padded rows normalized, relates_to duplicate removed. |
| F-26 | Wave 2 commit (rides with api-spec.md) | api-spec.md gains the /api/projects/:id and /api/opportunities/:id DELETE rows + production-mode 403 (openapi was already correct). |
| F-27 | Wave 4 records | ui-spec.md + api-spec.md gain explicit lang frontmatter (validate:language passes; no gate weakening). |
| F-28 | Wave 2 commit (rides with security-model.md) | mojibake repaired across security-model.md (section marks, dashes, multiplication signs). |
| F-29 | Wave 4 records | business-manual §1 Pre-FS gate row extended per ADR-0205 (en + ko). |
| F-30 | Wave 4 records | no-Dependabot decision recorded in security-baseline §3.1 (the CI dependency-audit job is the freshness SSOT; monthly review cadence). |
| Rulings | — | DEC-20261122-01 (security-engineer: ADR-0070 amendment + CR-1..CR-6) and DEC-20261122-02 (automation-engineer: five validator rulings incl. the ground-truthed branch-protection check names) recorded per ADR-0061 before dispatch; validate-decisions: 0 errors. |
| Gate battery | — | audit-variant exit 0 (ADR-0070 boundary allowlist: 5 pages, 0 violations; WCAG AA contrast; Onyx design-lint; all 6 projections fresh); audit.ts --spec-check exit 0; verify-scripts: 312 scripts, 0 warnings; validate:language PASS (751 files); wiki:nav-check PASS; validate-decisions 0 errors; test:unit green (full suite); typecheck 66 vs baseline 84 (delta -18, exit 0); skill-lifecycle-audit: 109 skills, 0 warnings; branch protection live with 7 required checks; new suites: 33 security-control tests + 15 hardening-gate tests, 0 fail. |

Residual work stays in Action Wiring and is not closed by this batch: F-5 (upstream promotion — filed as U-20261122-011, with LOCAL-PATCH markers now on both patch sites in dev-sync.ts and audit.ts; the docs/upstream-fix-list.md tracker and the upstream adoption itself are next-wave release-engineer work), F-19 (prompts.generated --check; opportunistic), F-33 (visual suite under test-runner), F-15's repository-variable removal (owner web-UI action), F-18's 197-finding token burn-down (design-system dispatch), F-21's owner reconciliation, F-26's api-spec↔openapi method-set drift-check extension, and the two gate extensions from the F-7/F-8 fix columns that were not built (ADR-index completeness gate; unregistered-design spec-check gate). Dual review PASS: formal + cross-domain, with the review's closure items applied — the F-3 premise correction (the committee projection was NOT in sync; the gate caught real drift on its first run) and DEC-02's ground-truthing of branch-protection check names were folded back into the landed work before this section was written.

Wave attribution above is the commit where the file landed: dev-sync scoped staging stages whole files, so audit-variant.ts (carrying both the DEC-01 and DEC-02 changes) landed wholly in the Wave 2 commit, and SCRIPTS.md (the CR-5 row, the Guide/registry rows, and the removal-date cleanup) landed wholly in the Wave 2 commit as well — the lifecycle compliance gate requires same-commit SCRIPTS.md coverage of staged @version bumps; the F-26 and F-28 rows ride the Wave 2 commit inside api-spec.md / security-model.md; docs/VERSION_MANIFEST.md and the memory log join commits as pipeline-generated dev-sync output. Branch protection was re-verified via the GitHub API at landing time (7 required checks, enforce_admins false — owner bypass preserved).

## Ratchet note (skill Step 6 quarterly check)
This is the first full review since 2026-11-04. The dominant Class is script-gap (F-3, F-4, F-7-gate, F-8-gate, F-16, F-17, F-19, F-20, F-23, F-26-gate, F-27, F-36) and systemic outer-ring drift (F-13..F-15, F-18) — i.e., the November gate family (projection drift, mirror parity, spec-check) is working, but the seams it does not cover (committee-registry projection, spec-activities/process-flow projections, ADR index, spec registrations, design/contrast/jargon lint family, GitHub-side enforcement, CI truthfulness) are exactly where every High finding entered. Landing the hardening wave above should make the next review's found-by-agent count drop by roughly this table's High/script-gap mass.
