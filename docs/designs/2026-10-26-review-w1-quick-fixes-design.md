---
title: "Project review wave W1 (quick fixes, no ADR) — design"
date: 2026-10-26
status: approved
author: process-governance-manager
design_of_record:
  - "docs/reports/2026-10-26-project-review-s1-s12.md"
lang: en
---

# Project review wave W1 — quick fixes (no ADR)

## Background and scope

The 2026-10-26 S1-S12 project review (`docs/reports/2026-10-26-project-review-s1-s12.md`) proposed three waves. This design scopes wave W1: defects fixable without an ADR. No stage, gate, track, activity-lead or procedure change, and no gate verdict is recorded anywhere. All outputs remain proposals until a human merges the PR.

Out of scope (W2/W3): gate-integrity items (C1, C2, C3, H5, H6, M16), the Group IC human-role change (H10, because it edits `procedures/**` and needs an ADR), decision-evidence data (H7, H11), and SSOT/process items (H8, H9, M1-M9, M14, M15, M17). M13 (terminology normalisation) is deferred to the glossary-curator unless it falls out of the H2/H4 copy edits.

Rule for every row: fix a real product defect in the product; never weaken a test assertion to hide a regression.

## Items

### H2 - Raw i18n keys rendered (S6/S7, S10, S11)

- Files: `components/stages/brownfield/constants.ts:8`, `LonglistSection.tsx:133`, `DealStructureStage.tsx:84-88`, `IcReviewStage.tsx:37-38`, `locales/ko.json`, `locales/en.json`.
- Change: translate every affected label through the locale files in both locales.
- Check: add a lint or runtime check that fails on unresolved dotted keys (patterns `stages.*`, `common.*`, `pages.*`) found in rendered label maps or DOM text. Extend the existing i18n lint (`lint:i18n`) for the static part and add a DOM-text assertion to the scenario harness for the runtime part.
- Acceptance: both locales render no dotted key on S6/S7, S10, S11; the new check fails on a seeded unresolved key and passes on the fixed tree.

### H3 - Journey navigation

- File anchor: `components/StageFrame.tsx:266`, the stage frames for S6-S12, the brownfield S5 N/A page, the deal overview page.
- Changes:
  1. S6/S7 self-link fixed: the S7 next action points to promote or S8, never to itself.
  2. Forward "next stage" CTA on S8-S12, enabled only when the stage predicate from engine state is met; otherwise disabled with a visible statement of what is missing.
  3. Brownfield S5 N/A page: a single correct CTA to S6 and the dynamic track.
  4. Deal overview "current stage" derived from process state, consistent with the project view.
  5. The entry-market-not-linked notice links to the S2 entry-market surface.
- Acceptance: each item has a scenario or unit assertion; the CTA and current stage derive from one engine-state source, not a duplicated computation. One primary action per surface.

### H4 - Internal jargon in user copy

- Files: `locales/ko.json` (lines named in the review: 1082, 1128, 3565, 3898, 3946, 8049) and `locales/en.json` counterparts.
- Change: remove or replace in visible ko/en copy: the numbered boundary reference (18 occurrences), ADR numbers, flow.spec versions, agent keys, checklist ids, and the developer-facing labels. Where the reference matters, move it to a tooltip or a reference disclosure.
- Lint: add a locale-file lint flagging those patterns, with an allowlist mechanism (an explicit file of key paths with a stated reason per entry; wildcard entries are not allowed).
- Acceptance: lint passes on the fixed tree, fails on a seeded sample of each pattern; the allowlist contains only reasoned entries.

### M10 - Persona drift after ADR-0185

- Files: personas for ip-agent, certification-agent, region-lead, valuation-agent, site-facility-agent, the PGM agent (procedure count and step descriptions), compliance-officer (waiver wording), and `docs/governance/process-map.md` (flow.spec version).
- Change: refresh each to match flow.spec and the procedures as of ADR-0185. flow.spec and procedures are authoritative (AGENTS.md section 7); personas follow.
- Follow-up: run `bun run agents:personas --check`; a persona-vs-flow.spec check is a validator-hardening candidate recorded for W3, not built here.
- Acceptance: persona check green; process-map version equals the current flow.spec version.

### M11 - Competitor registry writes audit-logged

- Files: the four routes under `app/web-next/app/api/our-company/members/[memberId]/competitors/**`.
- Change: write an audit record on every state-changing handler, using the existing audit helper and the same record shape as sibling write routes.
- Check: an audit-token scan for state-changing routes (POST, PUT, PATCH, DELETE) added as an audit-variant check; it fails on a write route without an audit call, with an explicit, reasoned exemption list.
- Acceptance: the four routes log; the scan passes on the tree and fails on a seeded write route without audit.

### L1 - Self-registration rate limit

- Change: derive the client address only from a trusted proxy header (CF-Connecting-IP via the tunnel); ignore X-Forwarded-For; bound the in-memory map (size cap plus eviction).
- Acceptance: unit tests cover spoofed X-Forwarded-For ignored, missing trusted header handled safely, and map size bounded.

### L2 - Deprecated MCP aliases

- File: `mcp/co-newbiz/tools/decision-tools.ts:229-249`.
- Change: remove the `record_gate_decision` and `create_route_decision` aliases. Update the MCP coverage inventory, docs and tests that reference them. The human-only boundary is unchanged: the proposal tools remain.
- Acceptance: mcp-coverage check passes; no remaining references.

### H1 - Repair S1-S12 journey scenarios

- File: `tests/scenarios/_support/ui.ts` and the failing scenario specs (19 of 49).
- Four failure signatures: gate forms hidden inside tabs (open the owning tab first), portfolio close button not found, hidden S11 step heading, hidden duplicate text (scope selectors).
- Rule: triage each failure as a test-helper defect or a real product defect. Fix helpers for the former; fix the product for the latter (H2/H3 fixes may resolve some). Never weaken an assertion.
- Acceptance: scenario suite green (49/49) or each remaining failure documented as a product bug with an owner.

## Sequencing and verification

Order: H2 and H4 (copy and lint) then H3 (navigation) then H1 (scenarios, which depend on the earlier fixes) with M10, M11, L1, L2 independent and parallelisable.

Gates: unit suite, `lint:i18n`, `design:lint`, mcp-coverage, OpenAPI parity, `bun run agents:personas --check`, `bun run validate:language`, and `bun scripts/audit.ts`. Lifecycle follow-ups: `agents/**` edits update the roster and README per project lifecycle rules; routes keep OpenAPI parity.

## Risks and open points

- M13 terminology normalisation is not scheduled here; flag to glossary-curator.
- The PM default for the lint allowlist format (key-path file with reasons) is overridable at PR review.
- L1 assumes all production traffic arrives through the Cloudflare tunnel; direct access on the dev port has no trusted header and falls back to a shared bucket.
