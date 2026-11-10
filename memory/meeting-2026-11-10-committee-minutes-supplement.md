# Meeting transcript — committee minutes supplement review

- **meeting-id**: 2026-11-10-committee-minutes-supplement
- **date**: 2026-11-10
- **purpose**: Review the rejected fix plan for committee minutes (per-issue conclusions defaulting to "unresolved"; discussions centered on internal-management criteria instead of deal business substance) and derive supplements.
- **facilitator**: PM (inline role-play per agents/pm.md Meeting Facilitation; PM voiced only the opening and this closing record)
- **participants**: process-governance-manager, risk-officer, market-intelligence-agent, financial-analyst, backend-engineer, platform-lead, ux-designer-agent
- **trigger**: user observed on dev deal `01M6JN4YGJXD0BYT7DFH9MWKQ0` S4 minutes that conclusions read "결론: unresolved" throughout and topics look internal-management-ish; the v1 fix plan was not approved and the user asked for a meeting to find gaps.

## Confirmed facts on the table (from code exploration, plan mode)

1. S4 convenes with no `briefMd` — topic is the one-liner "route_decision 심의 (진행 pre_fs)" (`committee-session.ts:423-427`); round-1 members see only that (`deliberation.ts:235-263`). Both web (`RouteDecisionStage.tsx:178-187`) and pipeline (`pipeline.ts:280-293`) paths omit the brief.
2. The minutes pass discards the topic entirely (`committee-session.ts:308`, `_topic`); material = agenda titles + position texts + meta tails (`committee-chair.ts:307-323`).
3. Resolution defaults to "unresolved" through three stacked causes: (a) prompt gives a bare enum with no decision rule (`prompts.json` key `committee.minutes`); (b) `normalizeMinutesDraft` silently fills missing resolution with "unresolved" (`committee-minutes-schema.ts:106`); (c) deterministic fallback keys off `responds_to` tails which are OFF by default (`committee-flags.ts:14-17`) so exchanges are empty and every issue stays "unresolved" (`committee-chair.ts:245-286`).
4. Agenda is derived from criterion-score disagreement over 5 capability/integration criteria (`committee-chair.ts:111-158`; `committee.agenda` prompt).
5. View and markdown renderer print the raw English enum (`CommitteeMinutesView.tsx:161`; `committee-scorecard.ts:229`).
6. S6/S7 brownfield already passes `briefMd` (`buildEvalBriefMd`) — precedent exists; S4 has none.

## Round 1 — positions

**process-governance-manager**: Committee session mechanics are ADR-0196 product code, not procedure `agent_key` steps — no `process/flow.spec.yaml` (ADR-0074) change is in scope. Rules-as-they-should-be: default brief injection and a `degraded_resolutions` meta field are semantic changes to session behavior and need the Design Gate design doc plus a gate-moment decision record (ADR-0061); the ADR-0196 amendment goes through PM approval. One unverified fact flagged, not asserted: whether flow.spec's S4 entry criteria require upstream artifacts — the plan must carry an explicit "check flow.spec S4 definition" item. Question to platform-lead: any dissent on committee mechanics living outside procedures?

**risk-officer**: Attacks the plan's assumption that "unresolved everywhere = LLM failure". Half true: the committee roster includes a red-team seat (`committee-agents.ts:145-158`) that structurally produces rebut/veto, so a decision rule of the form "any rebut ⇒ unresolved" (exactly the fallback rule at `committee-chair.ts:273-274`) guarantees permanent unresolved even for successful LLM minutes. Recorded dissent and issue convergence are orthogonal: dissent is preserved verbatim in `dissent_json` (ADR-0096); the minutes resolution should record *convergence*. Rule proposal: convergence with a recorded minority dissent = agreed/narrowed; **unresolved only when rounds were exhausted without convergence**, and every unresolved must bind to an open question with an owner. Kill-criteria duty: no registered kill criterion applies to this work item — status **unassessed**. Sharpest risk: brief injection causes anchoring bias — the brief must be framed as judgment evidence (including counter-evidence), never judgment direction. Question to backend-engineer: can the dissent≠unresolved distinction be enforced in code, or prompt-only?

**market-intelligence-agent**: The brief needs content discipline. Every figure in the brief must carry its S1 matrix version id and data-confidence grade; unset states render honestly ("시장 근거 미산출", "진입시장 미확정" per ADR-0181) — silent defaults are forbidden in this domain. Sharpest gap: nobody has verified that the target deal actually has S1 sizing / S2 entry market / S3 scores stored. If artifacts are absent the brief is empty and the reconvene validation spins idle. Proposes extending the audit step with an artifact-presence check (to backend-engineer and PM).

**financial-analyst**: Scope-honesty first: at pre_fs neither S5 investment-plan lines nor S8 business cases exist — both follow the route decision. So "business-viability discussion" at pre_fs can only mean route/scope questions grounded in S1 market size/growth and S3 fit/synergy screening scores (which are gate proposals per ADR-0090, not verdicts). Supplement: the brief carries an explicit line "quantitative financial evidence is produced at S5/S8" to stop minutes resolution_notes from imitating viability conclusions without basis (same logic as the no-backfill rule for missing S5 data). Confirmation request to market-intelligence-agent: S3 score rows in the brief carry grade tags too — agreed?

**backend-engineer**: Four implementation supplements. (1) Prompt edits must live inside the existing 5-section skeleton (D3 machine bar in `generate-prompt-registry.ts` fails on undeclared headings) — the decision-rule text goes inside `# Task` / `# Output contract`; codegen rerun is mandatory. (2) `degraded_resolutions` must be a sibling key of `minutes_draft` meta (NOT inside the zod-validated JSON) to keep the stored shape stable; `resolveMinutesDraft` signature changes to return the count — tests must follow. (3) Adding topic to the inputHash makes ALL stored sessions regeneration-eligible — blast radius to be confirmed as intended. (4) The audit runs as ad-hoc read-only queries at validation time, not as a new permanent script (script-registry discipline). No new REST endpoints, so no openapi drift-gate work. Question to platform-lead: confirm (3) intent and landing order.

**platform-lead**: Seam view: this change crosses lib (schema/session/chair) + prompts SSOT + UI + locales — one change-set with landing order **design doc (Row 0) → schema + prompt codegen → lib → UI + locales → tests → QA**. Anchors: Design Gate ADR-0074; language policy docs/context.md (display labels Korean = product content; JSON enums stay English per prompt language rules); record vehicle = DEC + design doc. QA output must split verified / could-not-verify / needs-judgement and name unexamined surfaces (project review model). Whether to change `computeMinutesFallback` semantics is a design-doc decision, not a code-review decision — plan already states "keep fallback; fix via LLM pass quality"; this will be checked in the doc. Agrees with process-governance-manager: committee mechanics are outside procedures.

**ux-designer-agent**: JTBD: persona = deal analyst reading minutes post-session; job = "per issue, what was decided and what remains open, at a glance". Supplements: (1) locale-keyed labels (`agreed→합의 / narrowed→일부 합의 / unresolved→미합의`) via ko.json/en.json — payload enum stays English (consistent with prompt language rules); (2) unresolved issues must not be dead ends — bind an open-questions count badge to the conclusion line (satisfies risk-officer's requirement at the UI layer); (3) degraded chip wording "일부 결론 자동 대체(N건)" reusing existing `status-chip` patterns — no design-system escalation needed; (4) success criterion: an analyst can state each issue's outcome within 30 seconds without opening raw JSON. Sequencing: UI edits land after the currently staged CommitteeMinutesView field-names commit to avoid churn.

## Round 2 — cross-discussion

- **risk-officer** → **backend-engineer**: accepts the distinction is prompt-level + generation quality; demands a **before/after resolution-distribution comparison** — the pre-fix audit becomes the reference class; claiming improvement without measurement is the optimism bias this role audits.
- **market-intelligence-agent** ↔ **financial-analyst**: agreed — S3 score rows carry proposal+grade tags; entry-market unset renders honestly; no financial figures without basis anywhere in the brief.
- **process-governance-manager** → **platform-lead**: confirmed — no flow.spec/procedure divergence; DEC + design doc is the right vehicle; and NO gate-blocking is imposed — minutes are an AI draft on a proposal-only surface already confirmed by humans under ADR-0104. The flow.spec S4 definition check stays in the plan (no-assertion-without-evidence principle).
- **backend-engineer** → **platform-lead**: hash blast radius confirmed as intended; documented in the design doc; adds the "artifacts absent → brief omitted, convening proceeds, no fabrication" test case.
- **financial-analyst** → **ux-designer-agent**: suggests "미합의(보류)" as the more accurate label; final wording stays a user call, default proposed.
- **ux-designer-agent** → **risk-officer**: the open-questions badge closes the "unresolved as dead end" risk at the UI layer; the regeneration chip (`fallbackDraft`) already exists.
- **platform-lead** (closing review note): verdict — direction is approvable provided supplements A–G land in the design doc; QA reviewer must come from a different domain than the author (backend author → functional reviewer) per the three-stage review.

## Synthesis — agreed supplements

| ID | Supplement | Origin |
|----|------------|--------|
| A | Brief carries version ids + data-confidence grades per figure; honest unset rendering; no silent defaults; `undefined` when artifacts absent (no fabrication) | market-intelligence |
| B | Prompt decision rule: recorded dissent ≠ unresolved; unresolved only after rounds exhausted without convergence; unresolved must bind an owner-carrying open question | risk-officer |
| C | Brief carries the scope line "quantitative financial evidence arrives at S5/S8" — pre_fs discussion is route/scope only; S3 scores are proposals with grade tags | financial-analyst |
| D | DEC record + ADR-0196 amendment via design doc; flow.spec S4 definition check item; fallback-keep decision stated in the doc | process-governance / platform-lead |
| E | Audit extended: target-deal artifact presence (S1/S2/S3) + resolution distribution compared before/after deploy as reference classes | market-intelligence / risk-officer |
| F | `degraded_resolutions` as minutes_draft meta sibling key; `resolveMinutesDraft` returns count; absent-artifact brief test case | backend-engineer |
| G | UI: locale labels (합의 / 일부 합의 / 미합의(보류)), open-questions count badge, existing status-chip reuse, UI lands after the staged field-names commit | ux-designer |

## Action items

1. PM: revise the plan with supplements A–G → user approval. (done — approved same day)
2. Row 0 design specialist: update `docs/designs/2026-11-08-committee-minutes-as-meeting-design.md` (registered spec `2026-11-08-committee-minutes-as-meeting-design`) + DEC record; flow.spec S4 check included.
3. Audit (read-only): resolution distribution + fallback/brief flags + target-deal artifact presence — report to user as the quantitative "are other meetings the same" answer.
4. Existing data: fix-forward + one reconvene validation on the target deal (default). No bulk regeneration of stored minutes (form-only improvement violates the honesty rule).
5. Human decisions pending: reconvene validation execution (default: yes), final label wording (default: 합의 / 일부 합의 / 미합의(보류)).
