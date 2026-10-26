---
title: "Follow-up batch (F-14 alignment, milestone fallback, skill overlap, dry-run a11y) — design"
date: 2026-10-26
status: approved
author: process-governance-manager
design_of_record:
  - "docs/adr/0185-agent-and-skill-placement-realignment-s1-s12.md"
lang: en
---

# Follow-up batch — design

Scopes four residual follow-ups recorded 2026-10-26 after ADR-0185. No new ADR: A and B follow the ADR-0185 follow-up precedent. No stage, gate, track, activity-lead or agent-roster change. No gate verdict is recorded anywhere. The Lightbox remains out of scope (needs its own ADR).

## A — Resolve warn-only F-14 (activity/skill alignment)

- Files: `process/flow.spec.yaml`, `procedures/_validate.ts` (`checkActivitySkillAlignment`, read only unless the rule needs a code exemption list), generated flow artifacts.
- Rule: every `skill_key` used by a procedure step hosted by an activity is listed in that activity's `skills:`. Authority order (AGENTS.md section 7): procedures govern steps, flow.spec dispatch lists follow.
- Change: add each missing skill to the hosting activity's `skills:` list (about 61 warnings). Where a step skill should not surface at stage level (cross-cutting utilities such as `k-law`, `evidence-ledger`, `decision-record`, or a skill shared by a sibling activity), record a justified exception in a single listed exception block with the rule stated: "a skill is exempt only if it is cross-cutting and not the activity's primary method". Exceptions are enumerated, never wildcarded.
- Version: flow.spec patch/minor bump with a version-history comment citing this design and the ADR-0185 follow-up precedent.
- Acceptance: F-14 warnings 0 (or only the listed exceptions); process-flow tests and flow generators green; `git diff` shows no change to stage, gate, track or activity lead fields.

## B — Remove brownfield PMI items from the milestone fallback

- File: `app/web-next/app/api/projects/[id]/milestones/suggest/route.ts` (deterministic fallback, lines ~64-65) plus its tests.
- Change: delete the key-talent retention item and the synergy phase-1 certification item from the fallback. S12 brownfield integration milestones belong to `pmi-agent` / `integration-monitoring` (ADR-0185 D). Also drop the PMI wording (the due-diligence-and-PMI perspective phrase covering key talent and integration) in the brownfield track hint on line 36 if it asserts S12 integration scope; keep the DD-closing perspective.
- Acceptance: tests updated and green; `tsc` clean; fallback still returns at least the track-neutral items.

## C — Skill overlap review and compliance-officer Legal Basis

- Skills: `skills/evidence-ledger`, `skills/decision-record`, `skills/stage-gate-governance`.
- Decision (proposal): KEEP DISTINCT, sharpen triggers. The three have different artifacts: evidence-ledger = claim-to-source rows; decision-record = `docs/decisions/DEC-*.md` file; stage-gate-governance = 7-gate sequence and 6 Kill Criteria. Overlap is the phrases "gate ruling" (decision-record vs stage-gate-governance) and "claim verification before a gate ruling" (evidence-ledger). Changes: remove "gate ruling" from decision-record triggers in favor of "record a gate ruling"; scope evidence-ledger triggers to ledger/citation wording and drop gate-ruling language from its description; keep stage-gate-governance triggers on "kill criteria / gate sequence". Add `relates_to` links between the three. Version bump per skill. No merge, so no deprecation; if the review later finds a merge is warranted, use the skill lifecycle (deprecate, never hard-delete).
- Agent: `agents/compliance-officer.md` `## Legal Basis`. Keep every bullet; refocus the section's framing on the external rules this agent operates (statutes and regulator rules reached through the interpretation registry, with `legal-counsel` owning interpretation) and relabel ADR-0037/0048/0053 and `governance-operations.md` as internal gate prose under a clearly named subheading, per DEC-20261026-01. No content lost; persona sync script rerun if the agent is generated.
- Acceptance: skill lint and handbook-sync pass; no trigger string appears in two of the three skills; compliance-officer diff is restructure-only.

## D — Dry-run console accessibility and design-system registration

- Scope: `app/web-next/app/flows/dry-run/**` (page, `agent-combobox.tsx`, `suggestion-panel.tsx`, `[sessionId]`).
- Audit: axe (accessibility-audit skill) in light and dark at 1280 and 320 widths; fix every violation (contrast, names, focus, reflow at 320). Record results (counts before/after) in the PR description.
- AgentCombobox: register in `docs/design-system/design-components.md` (and `_ko` counterpart) if it has a second consumer or generic props; otherwise record in that file why it stays local (single consumer, domain-specific agent list). Decision recorded either way.
- Token: decide whether the component-local `--doc-figure-max: 40rem` (`app/web-next/app/styles.css:2160`) becomes a design token. Proposal: promote to a named layout token only if used by 2+ surfaces; else keep local and note in design-components.md. `design:lint` must pass.
- Acceptance: axe 0 violations in all four mode/width combinations; design-lint clean; catalog decision and token decision documented.

## Out of scope

Lightbox (needs ADR); any gate verdict; new agents or skills; stage/gate/track changes; hard-deleting any skill.

## A — result (2026-10-26)

- F-14 warnings 60 before, 0 after (procedure-validation total warnings 137 to 77; remainder are unrelated design-6.8 skill-prose warnings).
- flow.spec 2.11.0 to 2.12.0: 39 missing (procedure, skill) pairs added to the `skills:` of the best-fit hosting activity (S3 strategic-fit-screening, S4 route-strategy, S3 our-company-profile, S8 business-case-modeling, S9 technical-dd/financial-dd/dd-waiver-review, S10 financing-plan, S11 ic-preparation/group-review/pmi-kickoff/greenfield-execution-baseline, S12 partnership-monitoring). No stage, gate, track, lead or agent field changed.
- Exception (enumerated in `F14_CROSS_CUTTING_SKILLS`, `procedures/_validate.ts`): `stage-gate-governance` only. It is the closing gate-assembly/Kill-Criteria step of 14 procedures; cross-cutting and not any activity's primary method.
- `tests/unit/process-flow.test.ts`: two skills-list pins updated (S9 financial-dd, S11 greenfield-execution-baseline). Generated files (`docs/process-flow.md`, `spec-activities.generated.ts`) need PM regeneration.

## B — result (2026-10-26)

- The PMI items (key-talent retention, synergy phase-1 certification) were removed from the milestone fallback; only the DD closing item remains for the brownfield track.

## C — result (2026-10-26)

- The three skills are kept distinct, with de-collided triggers (no trigger string appears in two of the three). `compliance-officer` Legal Basis was restructured with no bullet lost.

## D — result (2026-10-26)

- axe: 0 dry-run violations across 8 page/theme/width combinations. One shared-shell `LocaleSwitcher` violation is being fixed in this batch.
- `AgentCombobox` stays local (not registered in the catalog).
- `--doc-figure-max` is not promoted to a token.
