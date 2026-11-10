# Website Review — Outcome & Improvement Plan (2026-11-11)

**Date**: 2026-11-11
**Author**: docs-writer (dispatched by PM; documentation only — no code changes and no edits to other documents in this dispatch)
**Status**: Proposed — owner review required; Track A items await owner decisions
**Scope of record**: whole-site review outcome (two review panels + Journey Map audit) consolidated with the admin-account security review into one improvement plan

**Sources**

- `memory/meeting-2026-11-11-ui-review-panels.md` — panel transcripts, verdict tables #1–18, cross-panel agreements, handoffs
- `docs/security/2026-11-11-admin-account-review.md` — admin-account review (12 questions; 4 P2 findings, 4 P3 accepted-risks, 4 OK verdicts)
- Panel basis: screen inventory from the PM survey; Onyx 3.0 standard patterns P0–P5 (`docs/design-system/design-screens.md`); `DESIGN-CHECKLIST.md`; the two success criteria of the 2026-09-12 usability review (CRUD surfaces + stage-linkage strip); `flow.spec.yaml` v2.21.0 (stage/gate SSOT); FR-SYS-03/05; FR-SEC-01/02
- C3 status (handbook + flow console): handbook refresh landed in `docs/wiki/ko` (8 pages) — self-registration closure, committee minutes sections (S4 위원회 회의록 읽기 / S11 위원회 심의 세션 / hard-block row); flow console projections verified fresh (all `--check` exit 0, SPEC_VERSION 2.21.0); pending screenshot captures recorded in 82-변경이력 (login, S4 minutes dialog, S11 committee section)

---

## 1. Purpose & scope

This document captures the outcome of the 2026-11-11 whole-site review of the co-newbiz website and consolidates it into a single improvement plan. It merges three inputs:

1. **Panel 1 — UI/UX review** (2026-11-11). Participants: ux-designer-agent, design-system-agent, frontend-engineer. Facilitator: PM. Graded the site's composition against the Onyx 3.0 standard patterns (P0–P5), `DESIGN-CHECKLIST.md`, and the two success criteria of the 2026-09-12 usability review (CRUD surfaces + stage-linkage strip). Verdicts R1–R10.
2. **Panel 2 — Functional + Journey Map audit** (2026-11-11). Participants: process-governance-manager, risk-officer, market-intelligence-agent, financial-analyst, ux-designer-agent (panel-1 reporter). Facilitator: PM. Reviewed functionality against `flow.spec.yaml` v2.21.0 (stage/gate SSOT), FR-SYS-03/05 and FR-SEC-01/02, and audited the S1→S12 Journey Map from client request to final result check. Verdicts R11–R18.
3. **Admin-account security review** (2026-11-11, security-engineer, review-only). Applied the user-account baseline (`docs/security/security-model.md` §4/§7/§8) to the admin role mechanism by mechanism, answering the 12 questions from the PM pre-dispatch survey. Outcome: 4 P2 findings (SR1–SR4), 4 P3 accepted-risks requiring owner decisions (AR1–AR4), and 4 OK verdicts requiring no action.

The panels' cross-panel agreements and handoffs are incorporated: the improvement plan itself (this document), C2 (admin account review — completed, source cited above), and C3 (handbook + flow console — completed, recorded in Track D).

**Out of scope**: no code changes and no edits to other documents were made in this dispatch. This document is decision-support for the owner and the PM.

---

## 2. Findings summary

26 findings are captured: **R1–R18** are the panel verdicts (panel 1 #1–10, panel 2 #11–18), **SR1–SR4** are the admin review's P2 findings (its Q2/Q7/Q8/Q12), and **AR1–AR4** are its P3 accepted-risks (its Q1/Q4/Q10/Q11).

**Severity taxonomy (this plan)**: P1 = structural/governance (includes pending governance decisions); P2 = experience/consistency (includes planned security fixes); P3 = cosmetic/sync. Mapping note: the admin review's internal scale (P1 immediate / P2 planned / P3 accepted-risk) produced no P1 findings. Its four P2 findings are carried here as SR1–SR4 (P2). Its four P3 accepted-risks are carried as AR1–AR4 and marked P1 here because the *decision* to affirm or change each is an open governance item — the underlying risk itself is accepted, not open.

| ID | Area | Verdict | Owner agent | Severity |
|---|---|---|---|---|
| R1 | Deal board — single-landing + 4-band columns (`/deals`) | Pass — ADR-0120 choice fits the analyst JTBD; gate aging + paused widgets | — | — |
| R2 | Stage-tab integration (`/deals/[id]/[stage]`) | Pass — all S1–S12 have dedicated screens; StageFrame auto-renders handoff | — | — |
| R3 | Stage-linkage strip (STAGE_HANDOFF + StageFrame) | Pass w/ condition — S10Frame sub-tabs + wrapper-page mount coverage must be verified → B-5 | frontend-engineer | P2 |
| R4 | S6/S7 single shared component (`stages.s67`) | Improve required — two patterns in one component (S6 = P1 Registry sourced longlist; S7 = Registry + deal-shape evaluation, ADR-0195) → B-1 | frontend-engineer | P2 |
| R5 | CarrierGate — five flat stage redirect stubs | Improve required — auto-redirect paths should be server redirects; picker paths are valid destinations and stay → B-2 | frontend-engineer | P2 |
| R6 | Wiki viewer outside the P0 Shell | Improve required — unregistered variant unless design-screens.md documents the exemption → A-2 | design-system-agent → platform-lead (ADR) | P1 |
| R7 | Admin 13 surfaces — no standard-pattern mapping | Improve required — system gap; mapping decision + documentation via the ADR path → A-3 | design-system-agent + platform-lead | P1 |
| R8 | Recently changed surfaces (CommitteeMinutesView, S4) | Pass — design-lint clean, i18n parity tests, 400-line split honored | — | — |
| R9 | Handbook screenshots sync (86 captures, 2026-10-29) | Improve needed — resolved: C3 completed the refresh → D-1 | C3 | P3 |
| R10 | Entry surface (no S0/intake; two board CTAs) | Deferred by panel 1 to panel 2 (governance + Journey question) → A-1 | PM | P1 |
| R11 | Journey entry — client request | Improve required (governance) — no S0/intake stage in flow.spec; ADR-0074-path decision needed + auditable entry record (risk-officer requirement) → A-1 | PM → owner | P1 |
| R12 | Journey exit — kill-learning feedback loop | Pass w/ partial gap — S12 five-vocabulary transition + `/projects/[id]/process` full chain; the kill-learning → base-rate feedback loop is not visible in any screen → A-4 | PM → owner (then frontend-engineer) | P1 |
| R13 | Seven human-gate surfaces | Pass w/ check — GateDecisionPanel + GateSnapshotAck + kill-criteria UI unified; S11 hard-block reason must read on screen → B-6 | frontend-engineer | P2 |
| R14 | S11 IC surface | Pass w/ check — minutes links + DISPLAY-only snapshot + 409 `snapshot_stale` message legibility → B-6 | frontend-engineer | P2 |
| R15 | Source/grade rendering at S1/S2/S8 (FR-SYS-03) | Improve required — matrix version id + confidence grade (esp. grade U with chain hops), entry-market unset honest label, S5 pinned-reference tag — standardize as a per-surface checklist → B-4 | ux-designer-agent (proposal: market-intelligence-agent) | P2 |
| R16 | Board kill-signal display | Improve required — gate-aging widget should carry kill-evaluation three-state (triggered / false / unassessed) if the widget exists; absence is a gap; showing unassessed as pass would be a violation → B-3 | frontend-engineer | P2 |
| R17 | S10 brownfield tranche-conditions view | Check — record carrier exists (`venture_transition_decision.tranche_condition`); read-only view existence to confirm → B-6 | frontend-engineer | P2 |
| R18 | FR-SYS-03 per-surface checklist | Improve required — standardize so future panels regression-test instead of debating per screen → B-4 | ux-designer-agent + design-system-agent | P2 |
| SR1 | Admin initial-password generation (`POST /api/admin/users` fallback) | Finding — `Math.random()` fallback; unify to one shared CSPRNG helper → C-1 | backend-engineer | P2 |
| SR2 | Auth-event audit evidence | Finding — no IP/user-agent in `audit_log`; counted login failures unaudited until lockout; unknown-id attempts invisible; scope decision needed → C-2 | backend-engineer (security-engineer review: ADR-0039) | P2 |
| SR3 | Per-IP login throttle keying | Finding — keys on the client-controlled leftmost `x-forwarded-for` entry; in-memory Map; proxy semantics + durable-store decision needed → C-3 | backend-engineer | P2 |
| SR4 | `requireAdmin` guard coverage | Finding — 38/38 admin route files call it today, but no test asserts it; static tripwire test needed → C-4 | backend-engineer | P2 |
| AR1 | Bootstrap admin password in container stdout | Accepted-risk — owner affirm (CSPRNG one-time value, forced rotation at first login); revisit on aggregated-log deployment → A-5 | Owner (via PM, decision record) | P1 |
| AR2 | Admin personal read-tokens (≤180 days) reaching `/api/admin/**` GETs | Accepted-risk — owner decision: keep (affirm ADR-0146 amendment) or exclude admin from issuance → A-6 | Owner (via PM) | P1 |
| AR3 | No MFA; no periodic password rotation | Accepted-risk — rotation: do not add (NIST SP 800-63B); MFA: owner decision with revisit trigger → A-7 | Owner (via PM) | P1 |
| AR4 | Session policy absolute strength (12 h absolute, no idle timeout/cap/rotation) | Accepted-risk — user/admin parity confirmed; affirm for single-tenant posture; revisit on internet-facing exposure → A-8 | Owner (via PM) | P1 |

Straight passes with no work item: R1, R2, R8 (recorded above).

**Plan at a glance**

| Track | Work items | Findings covered | Status |
|---|---|---|---|
| A — Governance decisions (P1) | 8 | R6, R7, R10, R11, R12, AR1–AR4 | Owner input needed |
| B — Experience & consistency (P2) | 6 | R3, R4, R5, R13, R14, R15, R16, R17, R18 | Planned (B-1 sequenced after the next S7 round) |
| C — Security fixes (P2) | 4 | SR1–SR4 | Planned; C-2/C-3 need owner scope decisions before dispatch |
| D — Documentation & sync (P3) | 1 | R9 | Completed (screenshot follow-up pending) |

---

## 3. Improvement plan

### Track A — Governance decisions (P1, owner input needed)

All Track A items are governance decisions. Consistent with the workspace's non-negotiable boundaries, agent output here is decision-support: PM drafts the proposals, and every verdict (GO / HOLD / record as accepted-risk) is recorded by the owner, then lands through the normal ADR / decision-record path. Where an item changes `flow.spec.yaml`, the change must be re-projected to the flow console and handbook (current baseline: SPEC_VERSION 2.21.0).

**A-1 — Entry surface for client requests (R10 + R11).**
The site has no S0/intake stage: `flow.spec.yaml` (v2.21.0) starts at S1, and the deal board offers two CTAs with no defined client-request entry. Panel 1 deferred the question to panel 2, which ruled it improve required (governance).
Work item: draft an entry-path proposal through the ADR procedure — how a client request enters the pipeline (which surface, what record is created) and what the auditable entry record must contain (who entered the request, when, via which surface) so entry is reviewable like every later gate. If the decision adds or renames a stage, the flow.spec change and re-projection follow.
Owner: PM drafts; owner decides; process-governance-manager supports the spec side.

**A-2 — Wiki viewer outside the P0 Shell: exemption documentation (R6).**
As built, the wiki viewer is an unregistered variant of the shell pattern unless design-screens.md documents the exemption.
Work item: record the exemption decision in `docs/design-system/design-screens.md` via the system-gap procedure (token/component proposal → platform-lead → ADR) so the variant is registered rather than accidental.
Owner: design-system-agent; decision via platform-lead.

**A-3 — Admin surfaces have no standard-pattern mapping (R7).**
The 13 admin surfaces have no mapping to the Onyx 3.0 standard patterns — a system gap: admin is a system-console context the pattern library does not cover.
Work item: same system-gap procedure — propose the mapping (or an explicit admin-console exemption), document it in design-screens.md, decide via the ADR path.
Owner: design-system-agent + platform-lead.

**A-4 — Kill-learning feedback-loop visibility (R12).**
The Journey exit is otherwise complete (S12 five-vocabulary transition; full `/projects/[id]/process` chain), but the kill-learning → base-rate feedback loop is not visible in any screen.
Work item: decide at governance level whether and where the loop becomes visible (candidate surfaces and the minimal information to show), then hand the resulting requirement to frontend. Implementation is a follow-on item for a future round.
Owner: PM → owner (with process-governance-manager); then frontend-engineer.

**A-5 — AR1: first-boot admin password in container stdout (admin review Q1).**
Bootstrap generates a CSPRNG ~98-bit password, prints it once to stdout, and self-approves `admin` on a zero-user boot; the credential is dead after first login (the `must_change_password` gate blocks everything else).
Owner decision: affirm as accepted-risk. Revisit trigger: any deployment where logs ship to shared/aggregated storage — at that point prefer pre-provisioned initial credentials (env var or CLI seed; the CLI path already covers this).

**A-6 — AR2: admin personal read-tokens, up to 180 days, reaching `/api/admin/**` GETs (Q4).**
Write scope is verified refused at issue and stripped at every validation; the open question is whether admin should hold personal tokens at all, given admin surfaces are console-UI-only by design.
Owner decision: (a) keep, affirming the ADR-0146 amendment (2026-10-29) mitigations, or (b) exclude admin from token issuance (`canIssueToken` → analyst+viewer) with a migration grace period for existing admin tokens. Security-engineer recommendation: (b) unless an admin-owned script/integration exists today. Record the choice either way — not silence.

**A-7 — AR3: no MFA; no periodic password rotation (Q10).**
On rotation: the review recommends **not** adding forced periodic rotation — NIST SP 800-63B discourages it absent evidence of compromise, and the reset + `password_history` machinery covers the compromise case.
Owner decision: affirm "no expiry"; decide on MFA with an explicit revisit trigger (any exposure beyond the trusted network, or a second admin tenant). If affirmed, note in `docs/security/security-baseline.md` §"accepted risks".

**A-8 — AR4: session policy absolute strength (Q11).**
12-hour absolute expiry, no idle timeout, no concurrent-session cap, no mid-life rotation — user/admin parity confirmed, which answers the review question.
Owner decision: affirm for the single-tenant internal posture; revisit on multi-tenant or internet-facing exposure.

**Ops notes from the OK verdicts** (no decision required; carry as standing practice): keep ≥2 active admin accounts so a lockout never removes the last administrator, and record the CLI break-glass runbook (`newbiz.ts` `user:reset-password` / `user:create` / `user:approve`) in `docs/security/security-baseline.md` — it currently lives only in `newbiz.ts` help text.

### Track B — Experience & consistency (P2)

All items owner: frontend-engineer unless noted. Sequencing per section 5.

**B-1 — S6/S7 split (R4).**
S6 (P1 Registry, sourced longlist) and S7 (Registry + deal-shape evaluation, ADR-0195) are two patterns sharing one component (`stages.s67`). The fix is cheap for frontend: two thin wrappers over the shared component. Sequenced after the next S7 feature round to avoid ADR-0195 churn.

**B-2 — CarrierGate server-redirect (R5).**
Of the five flat stage redirect stubs, serverize only the auto-redirect paths (server redirects instead of client stubs); the picker paths are legitimate destinations and stay.

**B-3 — Board kill-signal three-state (R16).**
The gate-aging widget on `/deals` should carry the kill-evaluation three-state: **triggered / false / unassessed**. Add the state if the widget exists; absence of the signal is a gap; showing unassessed as pass would be a violation.

**B-4 — FR-SYS-03 per-surface checklist standardization (R15 + R18).**
Standardize source/grade rendering (matrix version id; confidence grade including honest grade U with chain hops; honest unset markers; source tooltips) as a per-surface checklist so future panels regression-test instead of debating per screen. Proposal by market-intelligence-agent, accepted by ux-designer-agent. The appendix below is the seed; codify the checklist in `docs/design-system/design-screens.md` (with design-system-agent).

**B-5 — StageFrame mount coverage (R3).**
Panel 1 passed the stage-linkage strip with one condition: verify S10Frame sub-tabs and wrapper-page mount coverage. Acceptance: zero unmounted wrapper pages, enforced by a test.

**B-6 — Confirmation checks (R13 + R14 + R17).** Small checks; run first.
- S11 hard-block reason must read on screen (R13; the seven gate surfaces are otherwise unified: GateDecisionPanel + GateSnapshotAck + kill-criteria UI).
- 409 `snapshot_stale` message legibility on the S11 IC surface (R14; minutes links + DISPLAY-only snapshot otherwise pass).
- S10 brownfield tranche-conditions read-only view: the record carrier exists (`venture_transition_decision.tranche_condition`); confirm whether a read-only view exists (R17). If absent, raise as a small build item.

### Track C — Security fixes (P2, from the admin review)

All four items come from the admin-account review's priority-ordered fix list. No P1 findings. Owner for all: backend-engineer; security-engineer reviews where flagged. **C-2 and C-3 need an owner decision on scope before dispatch.**

**C-1 — SR1: unify initial-password generation to one CSPRNG helper.**
`POST /api/admin/users` falls back to a `Math.random()`-derived password (`app/web-next/app/api/admin/users/route.ts` L32); the PUT reset path already uses a CSPRNG `randomBase36` helper (`app/web-next/app/api/admin/users/[userId]/route.ts` L12-16, used at L82). Hoist the helper to a shared module (e.g. `app/web-next/lib/password-gen.ts`) and use it in both routes. Exposure is bounded — the value is returned once inside the admin's authenticated response, never logged or stored, and dies at first login — so this is hardening, not an incident.

**C-2 — SR2: audit-evidence gap — failed/unknown-id logins unaudited; no IP/user-agent.**
`appendAudit` writes only `id, actor_user_id, action, target, created_at` — no IP, no user-agent. The 1st–4th counted password failures leave no durable trace (only the 5th writes `account_locked`); unknown-id attempts return before any audit write; the per-IP throttle counts live in an in-memory Map that is never persisted. For an admin-compromise investigation the trail answers who/what/when but not from where, and password-spray reconnaissance is invisible until the 5th attempt.
Proposed fix: add optional `ip` / `user_agent` columns to `audit_log` populated on auth events only (`login`, `account_locked`, a new `login_failed` action for counted failures, and a throttled `login_failed_unknown` so spraying is visible in aggregate), with retention aligned to the existing `retention_registry` pattern. ADR-0012 append-only is unaffected (additive columns, INSERT-only). Security-engineer review for ADR-0039 data-minimization.
**Owner scope decision needed before dispatch**: which events carry IP/UA, and the retention window.

**C-3 — SR3: per-IP login throttle keys on the leftmost `x-forwarded-for` entry.**
The throttle (`app/web-next/app/api/auth/login/route.ts` L14-27) keys on the **first** XFF entry, which is client-controlled whenever any proxy appends to the header — an attacker rotates fake XFF values and the per-IP limit never binds (and can be weaponized to lock out a victim's real address by spraying with the victim's IP spoofed). State is an in-process Map: a restart clears it, and each worker would hold its own Map beyond one process. The brute-force control that actually matters — per-account lockout — is not bypassable, so this is defense-in-depth that currently fails its one job against a deliberate attacker.
Proposed fix: key on the rightmost untrusted-proxy hop (the last XFF entry appended by *your* proxy) or on the socket remote address; treat the Map as best-effort; if a trusted-proxy deployment is formalized, derive the client IP once in a helper shared with `requestIsSecure` (which already reads `x-forwarded-proto` correctly).
**Owner scope decision needed before dispatch**: proxy semantics (is there a trusted proxy in this deployment?) and whether a durable store is warranted for the current profile.

**C-4 — SR4: `requireAdmin` tripwire test.**
All 38 `app/web-next/app/api/admin/**/route.ts` files import and call `requireAdmin` today — a manual observation with no test asserting it. No test walks the admin route directory, and `scripts/co-newbiz/route-audit-scan.ts` checks audit tokens on write handlers, not auth guards. One forgotten guard in a future admin route would ship silently.
Proposed fix: add a static tripwire test in the existing style (cf. `business-write-gating-static.test.ts`) that walks `app/web-next/app/api/admin/**/route.ts` and asserts every file contains `requireAdmin` — no allowlist needed (none of the 38 should ever be public). This converts a review-time check into a CI invariant. Full runtime centralization is not recommended: blocked by ADR-0070 (Next.js edge middleware cannot reach the bun:sqlite client) and would reintroduce the path-prefix-policy risk ADR-0146 explicitly rejected (its Alternative (b)).

### Track D — Documentation & sync (P3, mostly done)

**D-1 — R9: handbook refresh — completed by C3.**
Panel 1 flagged the handbook out of sync (86 captures dated 2026-10-29; committee screens and S4 fixes not reflected). C3 has since landed the refresh in `docs/wiki/ko` (8 pages): self-registration closure, and the committee minutes sections (S4 위원회 회의록 읽기 / S11 위원회 심의 세션 / hard-block row). Flow console projections verified fresh: all `--check` exit 0 at SPEC_VERSION 2.21.0.
Owner follow-up (pending): the screenshot captures recorded in 82-변경이력 — login, S4 minutes dialog, S11 committee section.

---

## 4. Journey Map audit

Panel 2 audited the S1→S12 Journey Map — client request to final result check. Conclusion: **the journey is designed end to end**:

- every stage S1–S12 has a dedicated screen (`/deals/[id]/[stage]`) (R2, pass);
- the stage-linkage strip (STAGE_HANDOFF + StageFrame) auto-renders handoffs (R3, pass with the mount-coverage condition → B-5);
- the seven human gates have unified surfaces (GateDecisionPanel + GateSnapshotAck + kill-criteria UI) (R13, pass w/ check);
- the exit is complete: the S12 five-vocabulary transition and the full `/projects/[id]/process` chain (R12).

Two open points:

1. **Entry** — no S0/intake stage exists in `flow.spec.yaml`; the client-request surface is undefined (R10/R11 → A-1).
2. **Feedback-loop visibility** — the kill-learning → base-rate loop is not visible in any screen (R12 → A-4).

Resolved during the review cycle: the promotion confusion (how an opportunity becomes a project at S7→S8) was a known handbook item and was resolved by the C3 handbook refresh (Track D).

---

## 5. Sequencing & cadence

Recommended order:

1. **Done — C3 items / Track D.** Handbook refresh and flow-console projections landed (SPEC_VERSION 2.21.0); screenshot follow-up pending with C3.
2. **Confirmation checks first.** B-6 (S11 hard-block reason, 409 message legibility, S10 tranche-view existence) and B-5 (StageFrame mount coverage): small, cheap, and they convert three pass-w/-check verdicts into clean passes.
3. **Track B and Track C execution.** B-1 is sequenced after the next S7 feature round (ADR-0195 churn); B-2, B-3, B-4 start when frontend capacity allows; B-4's checklist is seeded by the appendix below. On Track C: C-1 and C-4 are ready to dispatch immediately; **C-2 and C-3 require owner decisions on scope before dispatch** (event/retention scope for SR2; proxy semantics and the durable-store question for SR3).
4. **Track A owner decisions.** Governance proposals (A-1..A-4) are drafted by PM for owner decisions; AR1–AR4 are one-line decisions each. They gate no code work in Tracks B–C, so they can be recorded whenever the owner is available; A-1 should precede any future intake-surface feature work.

**Cadence**: re-run the review panels quarterly using the embedded FR-SYS-03 per-surface checklist (Appendix) as the regression basis — that is the purpose R18 assigns it. Re-check the admin surface at the same cadence: C-4's tripwire test keeps SR4 green by construction, and the AR1–AR4 revisit triggers (log-aggregation deployment, admin token-integration needs, exposure-scope change) are re-verified each run.

---

## 6. Appendix — FR-SYS-03 per-surface checklist

Seed for B-4, derived from panel 2's R15/R18 discussion. One row per surface in scope; one column per check. At each panel run, mark each cell PASS / FAIL / n/a — n/a requires evidence that the surface does not render source/grade data. B-4 codifies this checklist in `docs/design-system/design-screens.md`.

| Surface | Check 1: matrix version id visible | Check 2: confidence grade visible (incl. honest grade U with chain hops) | Check 3: unset markers honest | Check 4: source tooltips | Panel 2 notes (R15) |
|---|---|---|---|---|---|
| S1 | check | check | check — entry-market unset honest label | check | Explicitly flagged in R15 |
| S2 | check | check | check — entry-market unset honest label | check | Explicitly flagged in R15 |
| S4 | check | check | check | check | Applies via the R18 standardization |
| S8 | check | check — grade U must disclose chain hops | check | check | Explicitly flagged in R15 |
| S9 | check | check | check | check | Applies via the R18 standardization |
| S11 | check | check | check | check | Applies via the R18 standardization |
| S12 | check | check | check | check | Applies via the R18 standardization |
| Deal board | check | check | check | check | Applies via the R18 standardization; the kill-signal three-state is tracked separately under B-3 (R16) |

Notes:

- A cell marked "check" means the element must be present and legible wherever that surface renders source/grade data; the run records the outcome. Per-surface expression for the rows marked "applies via the R18 standardization" is pinned at the first quarterly re-run.
- The S5 pinned-reference tag named in R15 belongs to the same standardization and is checked under the confidence-grade column whenever S5 surfaces are in a run's scope; it is not a table row in this seed per the agreed surface scope.
