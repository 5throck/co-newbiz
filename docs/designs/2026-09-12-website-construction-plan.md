# Website Construction Plan — PM-led Build to the v5 Baseline, All-Agent Quality Review, Revision Cycle

- **Spec ID**: 2026-09-12-website-construction-plan
- **Date**: 2026-09-12
- **Status**: accepted (execution plan of record)
- **Chair**: New Business Review Lead (PM) — orchestrates all dispatch per the PM Gateway
- **Development basis**: **the frozen v5 baseline** — `docs/designs/mockups/baseline-v5.html` + `docs/designs/mockups/previews/` (56 screens) + `docs/designs/2026-09-12-implementation-matrix.md`. Development is built TO the v5 baseline and compared AGAINST it at each wave and at the quality review.
- **Scope adders**: Round-3 review — all 8 improvement plans (ADR-0123 items) + advancement ideas 1/2/4/7/10 (backtest, reliability score, safe-share, e-approval hub, resource calendar); Round-2 outcomes (ADR-0122) are already inside the v5 baseline.

## 1. Waves

### Wave 0 — Backend foundation (data contract first)
- Migrations per `2026-09-12-mockup-v3-data-contract.md` (+ v4/v5 addenda): `discovery_source`/`proposal_accepted_at`, `deal_comment`, `stage_sla`, `gate_decision.erp_ref`, share-link tables, backtest forecast-actual view
- REST: contract gaps B1–B9 (target proposals, antitrust, incentives, sites, permits+DAG, debt+covenants, interviews, customer-CoC, comp-parity) plus agent-run listing, source-health, share links, approval mirror stub
- Every writer: repository tests, `route()`-wrapped, audit-logged, OpenAPI entry
- Gate: data-architect schema sign-off → backend-engineer implementation → tests

### Wave 1 — Deal-centric skeleton
- Shared primitives: Button (primary/ghost/danger), chip separation, Tabs, DataTable, PageState, Toast (ADR-0119/0121)
- `/deals` board, `/deals/{id}` overview, `/deals/{id}/s1…s12` tabs; sidebar re-plane; navigation-test update; `pauseLinkFor` remap
- Legacy pages become wrappers

### Wave 2 — v5 parity (56 screens)
- All baseline screens implemented: stages, tools (15), process chain, references, archives, admin, design-system gallery, round-2 surfaces (timeline/heatmap/portfolio/onboarding)
- Content max width, ≤880px responsive minimum, dark theme parity
- Exit: every baseline screen reachable; matrix Status column updated; test/lint/contrast/build green

### Wave 3 — Round-3 layer (ADR-0123)
- agent-run viewer · flow.spec version badge · backtest viewer · LLM reliability score · safe-share (security sign-off gate) · e-approval cross-ref (+hub POC) · source-health badges · group isolation + storage tiers · copy dictionary
- ux-designer-agent produces mini-mockups for the genuinely new surfaces before implementation

### Wave 4 — Legacy redirect sweep + regression

## 2. PM dispatch matrix

| Role | Assignment |
|---|---|
| PM | Orchestration, wave gates, quality-review chair |
| ux-designer-agent | Wave-3 mini-mockups; screen acceptance checklists |
| data-architect | Schema sign-off (Wave 0 gate) |
| backend-engineer | Migrations + REST + writer tests |
| frontend-engineer | Screen implementation (Waves 1–3) |
| design-system-agent | Token/lint/contrast verification per PR |
| security-engineer | Safe-share design sign-off; role-matrix review |
| sre | Health badges, monitoring, capacity |
| process-governance-manager | flow.spec conformance (version badge gate) |
| group-review-agent | Portfolio view + resource calendar review |
| i18n-specialist / docs-writer | Copy dictionary (R3-8) |

## 3. Quality review (all-agent scoring) — after Wave 4

- Chair: PM; participants: all 41 agents scoring from their charters.
- Journeys: ① empty workspace → first deal to S4 ② brownfield S1→S8 promotion ③ project S8→S12 with gates/HOLD ④ admin + external share.
- Scoring: usability 25% · spec conformance 20% · data trust 15% · security/roles 15% · design/accessibility 15% · operations 10%.
- Conformance evidence: the implementation matrix — implemented screens re-captured as `previews/impl-<id>.png` and compared side by side with the frozen baseline previews.
- Output: ranked improvement backlog → revision PRs. Dissent preserved verbatim.

## 4. Risks & preconditions

| Risk | Mitigation |
|---|---|
| E-approval hub external dependency | POC first; cross-reference field ships regardless |
| Safe-share security | No implementation before security-engineer design sign-off |
| Quality-review scope creep | Findings become a ranked backlog; P1 only enters the immediate revision cycle |
| Uncommitted tree | Precondition: /sync commit (M0) before Wave 0 |

## 5. Milestones

M0 commit + contract sign-off → M1 Wave 0 → M2 Wave 1 → M3 Wave 2 → M4 Wave 3 → M5 Wave 4 → M6 quality review + revision cycle. Gates per milestone: `test:unit`, both design lints, `contrast:check`, build, design docs + `spec-register`, /sync PR per wave.
