# Readiness Audit — R&BD / Internal Venture / M&A across Brown Field and Green Field (2026-08-23)

> Question audited (user directive, 2026-08-22): whether the workflows, agent team, skills, and scripts needed to run Brown Field / Green Field new-business review — including the R&BD, internal-venture, and M&A tracks — are properly in place; where they are not, external best practice is researched and reflected into the design.
>
> Verdict in one line: **ready for the coverage ADR-0052 §A–E defines, with an explicit residual register** — the gaps that remain are recorded, classified, and (this round) either remediated, designed, or registered as blocked/deferred. Nothing found contradicts the landed design; the residuals were already known to it or are new hygiene items.

## 1. Scope and Method

Four axes audited against the post-PR-12e baseline (main `2b61403`, clean):

- **Method**: one completed roster-audit sub-agent (agent-team axis) plus PM inline inventories (read-only) covering procedures, skills, scripts, DB, checklists, research docs, pilots, templates, and the app runtime. Two exploration sub-agents died on API 429 (5-hour window, reset 2026-08-23 13:20) — their scope was completed inline; recorded as a deviation, not a coverage loss.
- **External channel test**: built-in WebFetch verified working (GAO-20-48G product page fetched). The Z.ai search / web-reader quota is exhausted until 2026-09-01; the same WebFetch fallback was already proven by the `rbd-research2` research pass (2026-08-23, ~15 canonical URLs). Research results: [`docs/research/readiness-gap-best-practice.md`](../research/readiness-gap-best-practice.md).
- **Baseline gates at audit time**: `bun test` 825/825, `procedures/_validate.ts --strict` 0 errors, output_type registry 59/59, graph-map human-authority pin at 4 steps.

## 2. Verdict

| Axis | Verdict | Basis |
|---|---|---|
| Workflows (procedures) | **Ready** | 15 shared procedures + EU region + ent-a entity override layers; full gate span screening → pre-FS → FS → DD → Entity IC → Group IC → `post_close`; ADR-0052 §A–E all landed (deal-shape chain, PMI, JV lifecycle, R&BD gating, portfolio monitoring); 59 output types all registered; 16 checklists |
| Agent team | **Ready** | 34 roster files = AGENTS.md roster claim; 21 agents dispatched across 85 AI steps; 13 zero-dispatch agents all justified by design (3 leads, 8 build/run, 2 non-deal); the "deal-review agent never dispatched" class is **empty**; 3 human roles registered |
| Skills | **Ready** | 122 skills, 44 distinct dispatched (top: stage-gate-governance ×13); procedure↔skill bidirectional contract (`procedure_keys`) enforced by graph-map and pinned by tests; 2 domain skills deliberately prose-wired (§F residuals — see R4) |
| Scripts / runtime | **Partially ready** | Governance tooling green (validate / graph-map / audit / sync-skills / test-runner); `newbiz` CLI 10 commands; `app/server` (hono, 12 modules) + `app/web` (Vite) exist; DB at 23 migrations / 9 repositories. Residuals: scorecard storage un-built (open question (e)), kill criteria 2/29 executable, deliverable templates 1/59 |

## 3. Findings per Axis

### 3.1 Workflows

- **Track coverage is complete at the procedure layer.** Brown Field and Green Field each run screening → pre-FS → FS → DD → their IC; the deal-shape chain (P0–P5) routes license-in / co-development / minority / JV / M&A shapes; `pmi-integration-execution` owns post-close integration through BAU exit; `jv-lifecycle-governance` owns operate/monitor/restructure/exit for `origin = joint`; `portfolio-venture-monitoring` gives venture-character cells post-IC visibility; `entity-establishment-execution` covers internal-origin formation. Override layers are real and validated (EU region, ent-a entity).
- **Human authority is pinned, not asserted**: exactly 4 human steps (entity-ic-review#5, group-investment-review#5, pmi-integration-execution#5, portfolio-venture-monitoring#3), regression-tested.
- **Kill criteria: 29 declared / 2 executable / 2 enabled.** The registry discipline is right (ADR-0058 lineage); executability waits on evidence-var thresholds (blocked-on-user). See R5.

### 3.2 Agent team

- 34 roster files, all 3-Section structure, AGENTS.md roster consistent (34). 21 agents carry `agent_key` dispatches in 85 AI steps.
- The 13 zero-dispatch agents fall into three justified classes: **leads** (pm, platform-lead, industry-lead — design/review owners per the team-axes design; note process-governance-manager IS dispatched ×16 and region-lead ×1 via the EU override), **build/run** (data-architect, dba, backend-engineer, frontend-engineer, release-engineer, sre, infra-automation-engineer, security-engineer — needed only when a runtime-hardening round starts), and **non-deal support** (glossary-curator, docs-writer).
- Human roles are properly separated from the agent roster: `procedures/_human-roles.yaml` (entity-ic-reviewer, bau-exit-certifier, venture-portfolio-ic).
- Hygiene gap found: `agents/README.md` / `README_ko.md` were TODO stubs — fixed in this change (R2).

### 3.3 Skills

- 122 skills; 44 distinct skills dispatched through procedure steps. The bidirectional contract (every graph edge present in the skill's `metadata.procedure_keys`) is machine-enforced and test-pinned — this is the strongest anti-drift control in the repo.
- Unwired domain skills are a **recorded design decision, not an oversight**: `proxy-industry-chain` (named confidence input of the distributional-valuation step + greenfield-pre-fs prose) and `expert-interview` (R&BD validation evidence rows) per ADR-0052 §D landing notes. Re-evaluated this round against research (R4 → PR-2 verdict).
- Knowledge/reference skills without procedure_keys (company-intelligence, competitive-intelligence, peer-benchmarking, k-dart, k-law, …) are consumed as inputs inside dispatched skills' steps — consistent with boundary #3 (procedures own what/when; skills own how).

### 3.4 Scripts / runtime

- **Governance tooling is the strongest layer**: `_validate.ts --strict`, `graph-map.ts --check`, `audit.ts`, `sync-skills.ts`, `test-runner.ts` — all green, all wired into the sync pipeline.
- **Domain runtime exists**: `newbiz.ts` CLI (db:migrate, status, proc:resolve, fin:analyze, fin:pipeline, fin:driver-tree, simulate, rag, watch:run, model); `app/server` hono API (admin, analysis, auth, deal-review, envelope, glossary, governance, monitoring, projects) + `app/web` Vite UI; 23 migrations, 9 repositories.
- **Three genuine residuals** (audit-time): (1) no table stores JV/venture scorecards — the prerequisite for the portfolio script and view (open question (e); cells 5/6/9 of the classification matrix stay thin until it completes) — **closed 2026-08-24**: the full chain landed (migration 0024 `venture_scorecard`, venture-scorecard repository, `scorecard:rollup` CLI, portfolio-view server routes + web page — see R8); (2) kill-criteria executability 2/29; (3) deliverable templates cover 1 of 59 output types (`ic-memo` only).

## 4. Residual Register

Classes: **A** = remediated this round · **B** = designed this round (docs only) · **C** = blocked on user input · **D** = explicitly deferred to a later round.

| ID | Gap | Axis | Class | Disposition |
|---|---|---|---|---|
| R1 | Deliverable templates 1/59 output types | scripts | A | PR-2 sets selection criteria + list; PR-3 lands the templates |
| R2 | `agents/README.md` / `README_ko.md` TODO stubs | agents | A | Filled in this change (PR-1) |
| R3 | JV/venture scorecard storage schema (ADR-0052 open question (e)) | scripts | B (+D impl.) | Schema ADR drafted this round (design only); migration/script/view stay deferred (E.4 chain) |
| R4 | §F residuals: `proxy-industry-chain`, `expert-interview` prose-wired | skills | B | PR-2 verdict with research basis (elicitation protocols / reference-class method) |
| R5 | Kill criteria 29 declared / 2 executable | workflows | A (step 2 landed via ADR-0060) + C (thresholds) | ADR-0060 classifies all 29 (3 class (i) / 1 (ii) / 25 (iii)); greenfield partner-dependency twin activated (baseline 2→3); the 25 proposed vars = the explicit registry-extension backlog, nothing seeded. Thresholds themselves stay class C (calibration meeting) |
| R6 | D.5 Korea co-funding (TIPS / KONEX / KOSDAQ) unverified | workflows | B | Verification-pending flag restated in PR-2; nothing depends on it |
| R7 | Thresholds (a)–(d) + market/technical/risk RAG thresholds + Green cap | workflows | C | [corrected 2026-08-24 — stale on arrival: the market/technical-execution/risk RAG thresholds and the substitution vocabulary were already APPROVED by the user on 2026-08-23 ("go"; #86 `dbed8f1`, which predates this audit's baseline `2b61403`) and the rule layer is active (migration 0022, 18/19 rows `enabled=1`, Green cap preserved). Remaining open: ADR-0052 (a)–(d), calibration corpus → Green-cap lift, antitrust reversal — assembled as `docs/decisions/2026-08-24-residual-decisions-pack.md`] |
| R8 | E.4 full chain: scorecard migration → portfolio script → portfolio view; cells 5/6/9 thin | scripts | A | Chain complete (2026-08-24) — storage + rollup script landed (E.4 PR-2: migration 0024, venture-scorecard repository, `scorecard:rollup` CLI), then the portfolio view (E.4 PR-3: server routes `app/server/scorecard.ts` + web page `app/web/src/pages/PortfolioScorecard.tsx`); cells 5/6/9 closure annotated in the track-coverage design §G |
| R9 | Procedure execution orchestrator (proc:resolve merges but does not run) | scripts | D | Runtime-hardening round; build/run agent class activates there |
| R10 | Calibration on 5–10 historical cases | workflows | C | User-supplied cases; gates the Green-cap lift |

## 5. Blocked-on-User Register

Registered here so the state is auditable; none blocks this round's PRs:

1. **Open questions (a)–(d)** (ADR-0052): TRL/MRL cutoffs; JV scorecard weights/cadence; synergy certification criteria + 90-day attrition threshold; deal-shape selection thresholds. All ILLUSTRATIVE until the thresholds meeting.
2. **market / technical-execution / risk RAG thresholds** — `docs/decisions/open/` drafts awaiting approval. [corrected 2026-08-24 — false at audit time: approved by the user 2026-08-23 (#86, in the audit's baseline); the approved records are `docs/decisions/{market,risk,technical-execution}-thresholds.md` + `substitution-threat-vocabulary.md`, and the `open/` agendas were superseded and removed in that change. See the decision pack `docs/decisions/2026-08-24-residual-decisions-pack.md` for what genuinely remains blocked on the user]
3. **Calibration corpus** — 5–10 historical cases; without it the unverified-dimension Green cap stays.
4. **Green-cap lift** — contingent on (3).

## 6. Remediation Mapping (this round)

| PR | Lands | Residuals addressed |
|---|---|---|
| PR-1 (this change) | This audit report; research addendum; ADR-0052 status/consequence sync; agents README fill | R2, register publication |
| PR-2 | Gap-remediation design doc + scorecard-storage schema ADR (design only) | R1 (selection), R3, R4, R5, R6 |
| PR-3 | Deliverable templates under `templates/deliverables/` | R1 (implementation) |
| D-round PR-1 (2026-08-24) | ADR-0060 kill-criteria executability classification + registry classification landing (29 entries, greenfield twin activation, baseline 2→3) | R5 (step 2 → class A) |
| D-round PR-2 (2026-08-24) | E.4 storage + rollup script — migration 0024 (`venture_scorecard`), venture-scorecard repository, `scorecard:rollup` CLI, 36 tests | R8 (storage + script links of the chain), R3 (implementation landed) |
| D-round PR-3 (2026-08-24) | E.4 portfolio view — server routes (`app/server/scorecard.ts` 1.0.0: membership-filtered `GET /api/portfolio-scorecard` + `GET /api/projects/:id/scorecard`), web page + route/nav (`app/web/src/pages/PortfolioScorecard.tsx`), openapi spec entries (`info.version` 1.4.0), 8 api tests | R8 (view link — chain closed) |

Deferred (class D): R9 (procedure execution orchestrator — runtime-hardening round). R8 is fully closed — the portfolio view, its last link, landed 2026-08-24 (E.4 PR-3).

## 7. Sources

- Inventories: `procedures/` tree + `_validate.ts --strict` baseline; `AGENTS.md`; `procedures/_human-roles.yaml`; `procedures/_output-types.yaml`; `skills/*/SKILL.md` frontmatter scan (122) + dispatch grep (44 distinct / 85 steps); `scripts/` + `scripts/co-newbiz/`; `db/migrations/` + `db/repositories/`; `checklists/` (16); `templates/deliverables/`; `app/server` + `app/web`; `package.json`.
- Roster-audit sub-agent report (2026-08-23, completed; the other two exploration agents died on API 429 — scope completed inline).
- External best practice: [`docs/research/readiness-gap-best-practice.md`](../research/readiness-gap-best-practice.md) (7 sources fetched this session; failures recorded).
- Prior committed research: `docs/research/ma-dd-best-practice.md`, `pmi-jv-lifecycle-best-practice.md`, `rbd-partnership-best-practice.md`, `venture-governance-best-practice.md`.
