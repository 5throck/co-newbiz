---
title: User Manual Wiki — Journey-Map-Driven Design
date: 2026-10-13
status: implemented
owner: ux-designer-agent
reviewers: docs-writer, process-governance-manager, design-system-agent
lang: ko
lang_reason: source-material
---

# User Manual Wiki — Design

Korean appears only as UI labels and page names in backticks; prose is English. The wiki itself (`docs/wiki/ko/`) is a Korean locale zone.

## 1. Goal and scope

Build a repo-hosted Markdown wiki at `docs/wiki/ko/` that teaches each persona what to do, screen by screen, in the order the S1–S12 pipeline requires. The wiki is organised by the user journey, not by the code's route tree. It must be mirrorable 1:1 to a GitHub Wiki (flat-ish names, `Home.md`, `_Sidebar.md`, `_Footer.md`, relative links without `.md` suffix problems — see §7.4).

Out of scope: fixing product or doc defects (logged in `docs/reports/2026-10-13-user-manual-defect-log.md`), creating app data, and re-stating procedure steps (`procedures/*.yaml` stays authoritative for what/when; the wiki explains *where to click*).

## 2. Sources read

- `process/flow.spec.yaml` — 12 stages, 7 gates (`screening`, `pre_fs`, `target_screening`, `fs`, `dd`, `entity_ic`, `group_ic`), `applicableTracks`, entity lifecycles (opportunity S1–S7, project S8–S12), `subjectScope` S8 (greenfield single / brownfield shortlist).
- `docs/process-flow.md`, `docs/context.md`.
- `app/web-next/app/**/page.tsx` — 73 page files (see §8).
- `app/web-next/components/stages/**` — one stage component per stage (S1 `MarketAnalysisStage` … S12 `PostManagementPanel`), plus `GreenfieldScopePanel` / `BrownfieldScopePanel` / `ExecutionBaselinePanel` / `EstablishmentPanel`.
- `docs/manuals/{business,admin,operations,archive}-manual{,_ko}.md` — role/gate-centred, not screen-centred; the wiki complements and links them rather than replacing them.

## 3. Personas

Derived from roles (`admin`, project `lead`/`member`, `viewer`) and the human-only boundaries (gate approval, investment decision, target selection, route decision, WACC confirmation are human acts; AI produces proposals).

| ID | Persona | System role | Primary jobs | Human-only acts they own |
|---|---|---|---|---|
| P1 | Deal analyst | project `member` | Run S1–S3 analysis, enter data, request AI drafts, record DD findings | none (proposes only) |
| P2 | Project lead | project `lead` | Own the deal, decide route (S4), select targets (S7), confirm baselines, submit gates | route decision, target selection, gate submission, baseline confirmation |
| P3 | IC reviewer / approver | `member` or `viewer` on the project, committee seat | Read the IC package, judge verified / could-not-verify / needs-judgement buckets, record decision | gate approval, investment decision |
| P4 | Viewer | `viewer` | Read status, reports, portfolio view | none |
| P5 | Operator / admin | `admin` | Users, master data, data sources, schedule, system mode, audit, governance | user/role grants, system mode |

## 4. Journey map (NN/g five-element structure: actor, scenario, phases, actions/mindset, opportunities)

Scenario: a group company evaluates a new business from market signal to post-investment monitoring.

| Phase | Stages | Lead persona | User goal | Key actions | Touchpoints (screens) | Pain points (observed) | Opportunity for the manual |
|---|---|---|---|---|---|---|---|
| 0. Onboard | — | all | Get in and orient | log in, change password, onboarding, settings | `/login`, `/password-change`, `/onboarding`, `/`, `/settings`, `/inbox` | role effects not explained on screen | "First 15 minutes" tutorial page |
| 1. Find where the opportunity is | S1 | P1 | Size and structure the market | run/seed market analysis, review gap vs external outlook | `/deals/{id}/s1`, `/market` | proxy-chain confidence caps are invisible to newcomers | explain the confidence cap callout |
| 2. Discover and screen opportunities | S2–S3 | P1 | Turn signals into a scored opportunity; check fit/synergy | create opportunity, record factors, synergy run, our-company profile | `/opportunities`, `/opportunities/{id}`, `/deals/{id}/s2`, `/deals/{id}/s3`, `/our-company` | two entry points (flat routes vs deal tabs) | one canonical path per task |
| 3. Choose the entry route | S4 (gate `screening` → `pre_fs`) | P2 | Decide Green Field vs Brown Field | read route advisory, save draft, record route decision | `/deals/{id}/s4` | the fork is the most consequential click | track-fork page with decision checklist |
| 4a. Green Field: build it ourselves | S5 | P2 + P1 | Capability gap, sites, permits, incentives | capability assessment, site/permit/incentive records | `/deals/{id}/s5`, `/projects/{id}/sites`, `permits`, `incentives`, `partnership` | S6/S7 tabs still visible-but-skipped? (verify) | Green Field lane pages |
| 4b. Brown Field: find and pick a target | S6–S7 (gate `target_screening`) | P2 + P1 | Long List → Short List → selection | universe criteria, add/exclude candidates, screening, shortlist, target selection | `/deals/{id}/s6`, `/deals/{id}/s7`, `/brownfield/targets/{targetId}`, `/companies/{id}` | heavy tables, English labels (`Long List`) | Brown Field lane pages |
| 5. Prove the economics | S8 (gate `fs`) | P1 → P2 | Business case, WACC, valuation | set params, run case, record WACC, adopt case | `/deals/{id}/s8`, `/projects/{id}/business-case`, `wacc`, `financial-analysis`, `debt`, `proxy-chain` | single vs per-target scope differs by track | track callout boxes |
| 6. Verify | S9 (gate `dd`) | P1 + P2 | Close DD checklist | tailor checklist, record findings, waivers, interviews, customer CoC, comp parity | `/deals/{id}/s9`, `/projects/{id}/dd`, `interviews`, `customer-coc`, `comp-parity`, `risk-heatmap` | Brown Field six mandatory validators | M&A validator order page |
| 7. Structure | S10 | P2 | Deal / JV / financing structure; Green Field execution baseline | record structure, capex tranches, confirm baseline | `/deals/{id}/s10`, `/projects/{id}/deal-structure` | baseline confirmation is irreversible-feeling | confirm-dialog walkthrough |
| 8. Decide and execute | S11 (gates `entity_ic`, `group_ic`) | P3, P2 | Committee decision; closing / establishment | IC package review, gate decisions, establishment steps | `/deals/{id}/s11`, `/projects/{id}/ic-review`, `/proposals/{id}/confirm`, `/inbox` | "no PASS stamp" model needs explanation | reviewer how-to on three buckets |
| 9. Manage after | S12 | P2, P4 | Monitor vs plan, PMI | monitoring brief, PMI synergy/talent, baseline variance | `/deals/{id}/s12`, `/projects/{id}/pmi`, `portfolio`, `timeline`, `reports`, `/portfolio-view` | — | — |
| X. Operate | — | P5 | Keep the system healthy | users, master data, sources, schedule, audit | `/admin/**` | admin manual is prose-only | admin section mirrors `admin-manual_ko.md` |

## 5. Track lanes (verified from `flow.spec.yaml` `applicableTracks`)

```
            shared                     fork        Green Field lane            Brown Field lane              shared
S1 ─ S2 ─ S3 ──[screening]── S4 ──[pre_fs]──┬── S5 (track=greenfield) ──────────────┐
                                             └── S6 ──[target_screening]── S7 ─────┴── S8 ─[fs]─ S9 ─[dd]─ S10 ─ S11 ─[entity_ic]─[group_ic]─ S12
```

| Stage | Green Field | Brown Field | Notes for the manual |
|---|---|---|---|
| S1–S4 | yes | yes | Divergence point is the S4 `route_decision` (track mandatory; greenfield needs `sub_track`, brownfield needs Route type). |
| S5 | yes | skipped | Spec comment: on greenfield S6/S7 are skipped and the flow proceeds to S8. |
| S6, S7 | skipped | yes | Gate `target_screening` after S6/S7. |
| S8 | `subjectScope: single` | `subjectScope: shortlist` (per-target, plus human `target_selection` before `fs`) | Same screen, different content → callout box. |
| S9 | `greenfield-dd` | `brownfield-dd` + six mandatory M&A validators | DD per target is optional; mandatory scope = selected target (memory 2026-10-09). |
| S10 | execution baseline + capex tranches | deal structure / JV / financing | `investment-structuring` single id, owner differs. |
| S11 | establishment | closing | `EstablishmentPanel` vs closing steps. |
| S12 | variance vs execution baseline | PMI | |

Each stage page carries a track callout box (§7.2). Two lane overview pages (`20-그린필드-여정`, `30-브라운필드-여정`) narrate the full path end-to-end and link to shared pages.

## 6. External benchmark

| # | Source | Pattern observed (own words) | Decision we adopt |
|---|---|---|---|
| 1 | Diátaxis — tutorials vs how-to, https://diataxis.fr/tutorials-how-to/ | Separate learning-oriented tutorials from task-oriented how-to guides; how-tos need not be end-to-end | Stage pages are **how-to** (task at work); one **tutorial** only: `01-시작하기` walking DEMO-S1-S12. Reference = glossary/roles; explanation = existing manuals linked, not copied. |
| 2 | Diátaxis start page, https://diataxis.fr/start-here/ | Four types along action/cognition axes | Every page declares its type in frontmatter (`doc_type: how-to|tutorial|reference|explanation`). |
| 3 | NN/g Journey Mapping 101, https://www.nngroup.com/articles/journey-mapping-101/ | Actor, scenario, phases, actions/mindsets, opportunities | §4 table uses those columns; `Home.md` shows the phase strip and links into phases. |
| 4 | GitHub Docs/Gollum wiki conventions via https://github.com/plantinformatics/pretzel/wiki/Wiki-Sidebars-and-subfolders and https://github.com/practicalseries/GitHub-Wiki-Design-and-Implementation | `_Sidebar`/`_Footer` per directory, inherited; Home.md is the root | Ship `Home.md`, `_Sidebar.md`, `_Footer.md` at `docs/wiki/ko/` root; keep pages in one folder (prefix numbers give order) so mirroring is lossless; images in `images/`. |
| 5 | Nimble Compass GitHub Wiki guide, https://nimblehq.co/compass/development/documentation/github-wiki/ | Default sidebar is a flat alphabetical list; a custom sidebar adds hierarchy | Hand-maintained `_Sidebar.md` grouped by journey phase with track sub-groups; numeric prefixes keep alphabetical fallback sane. |
| 6 | Stripe Docs guides/quickstarts, https://docs.stripe.com/quickstarts and teardown https://document360.com/blog/tear-down-of-stripe-knowledge-base/ | Headings are instructions; one task per page | Page and step headings are imperative Korean verbs (e.g. `진출방식 결정하기`); one screen-task per page; long screens split by tab. |
| 7 | Salesforce Trailhead, https://www.salesforce.com/blog/what-is-trailhead/ | Trails made of bite-size modules plus hands-on project in a sandbox | Lane pages act as "trails"; each stage page ends with a "check yourself" item verifiable on DEMO-S1-S12 (read-only). |
| 8 | GitLab Handbook, https://handbook.gitlab.com/handbook/about/ | Single public handbook, change by merge request | Wiki lives in repo, changes go through `/sync` PRs; GitHub Wiki is a one-way mirror, never edited there. |
| 9 | Intapp DealCloud University, https://www.intapp.com/dealcloud/university/ | Role-tiered learning (getting started / power user / platform manager) | Persona entry pages: `분석가`, `프로젝트 리드`, `투자심의 위원`, `운영자` each list the pages in their order. |
| 10 | Datasite Assist, https://www.datasite.com/en/company/datasite-assist | Deal help bundles FAQs, how-tos, and set-up help in one portal | Add `FAQ`, `문제 해결` (troubleshooting by symptom), and `변경 이력` pages to the same wiki. |

## 7. Information architecture

### 7.1 Page tree (`docs/wiki/ko/`)

```
Home.md                       journey phase strip, track fork, persona entry links
_Sidebar.md  _Footer.md       (footer: disclaimer + "last verified against app build <sha>")
01-시작하기.md                 tutorial: login → onboarding → open DEMO-S1-S12 → read a stage
02-화면-구성.md                 global nav, deal tab bar, inbox, AI proposal badges, review buckets
03-역할과-권한.md               personas × roles × human-only acts
10-공통-S1-시장분석.md
11-공통-S2-기회-발굴.md
12-공통-S3-시너지-전략적합성.md
13-공통-S4-진출방식-결정.md       ← fork page
20-그린필드-여정.md              lane overview
21-그린필드-S5-자체-진출.md
22-그린필드-부지-인허가-인센티브.md
30-브라운필드-여정.md            lane overview
31-브라운필드-S6-대상-후보-발굴.md
32-브라운필드-S7-대상-선정.md
33-브라운필드-대상-상세.md
40-공통-S8-사업성-분석.md
41-공통-S9-실사-검증.md
42-공통-S10-투자구조-설계.md
43-공통-S11-투자심사-실행.md
44-공통-S12-사후-관리.md
50-게이트와-투자심의.md          gates, three-bucket review, proposal confirm
60-페르소나-분석가.md  61-페르소나-프로젝트-리드.md  62-페르소나-투자심의-위원.md  63-페르소나-운영자.md
70-관리자-*.md                  one page per /admin screen group (users, master data, data sources, schedule, system mode, audit/ADR/governance, glossary, notifications, database)
80-FAQ.md  81-문제-해결.md  82-용어집.md (links /glossary + glossary/)  90-변경-이력.md
images/
```

### 7.2 Page template

```markdown
---
doc_type: how-to
stage: S7
tracks: [brownfield]
personas: [P2, P1]
route: /deals/{id}/s7
verified_on: YYYY-MM-DD
verified_build: <git sha>
---
# 대상 선정하기
**목적** — one sentence.  **누가/언제** — persona, entry gate.  **사전 조건** — prior stage/gate, role.
> [!NOTE] **트랙** — Green Field: … / Brown Field: …   (GitHub alert syntax renders in both repo and wiki)
![S7 대상 선정 화면](images/s7-01-target-selection.png)
*캡션: what the screen shows, which sample project.*
## 단계
1. Click `<exact on-screen label>` …   (each step keyed to a label in backticks; one action per step; sub-captures for dialogs)
## 결과 확인   expected state change, where it shows up
## 자주 하는 실수
## 다음 단계   link to next page in the lane
```

### 7.3 Naming
Pages: `NN-<track-or-area>-<Sx>-<slug>.md`, Korean slug, hyphens. Images: `images/<stage>-<nn>-<slug>.png` with `<stage>` = `s1`…`s12`, `common`, `admin`; ASCII slug.

### 7.4 Mirroring
Links written as `[text](13-공통-S4-진출방식-결정)` without `.md` break on repo view; decision needed (Q3). Proposed: write `.md` links in repo and let a mirror script strip the suffix.

## 8. Screenshot standards

- Viewport 1440×900, light theme, browser zoom 100 %, Korean locale, built-in browser against `http://localhost:7748` (dev). Never port 7749.
- PNG, optimised to ≤ ~250 KB (pngquant/oxipng); crop to the relevant region when the full page exceeds the budget; full-page only on overview captures.
- Redaction: real person names, emails, phone numbers, and non-sample company identifiers are blurred or replaced via DevTools text edit **in the browser only** (no data writes). Admin `users` captures are always redacted.
- Sample projects (read-only): `PRJ-DSE4PW` (greenfield), `PRJ-QGB2W5` and `PRJ-T7T81A` (brownfield), `DEMO-S1-S12` (end-to-end). Never create, edit, or submit data to reach a state; if a state does not exist on these projects, log it as a gap (Q1).
- Annotation: numbered red circles matching step numbers, added post-capture; no arrows inside the app.

## 9. Capture inventory

Columns: id · URL pattern · state needed · steps shown. Counts per group at the end.

### 9.1 Shared (30)
| id | URL | state | shows |
|---|---|---|---|
| common-01 | `/login` | logged out | sign-in |
| common-02 | `/password-change` | first login | change password |
| common-03 | `/onboarding` | new user | onboarding steps |
| common-04 | `/` | logged in | home / dashboard |
| common-05 | `/deals` | ≥1 deal | deal list, search |
| common-06 | `/deals/{id}` | DEMO-S1-S12 | deal overview + tab bar |
| common-07 | `/inbox` | pending items | inbox, proposals |
| common-08 | `/proposals/{id}/confirm` | open proposal (existing) | human confirm screen (do not click confirm) |
| common-09 | `/settings` | — | settings |
| common-10 | `/settings/connected-apps` | — | OAuth apps |
| common-11 | `/glossary` | — | glossary lookup |
| s1-01..03 | `/deals/{id}/s1` | DEMO | market sizing, competition, value chain/gap |
| s1-04 | `/market` | — | market workspace |
| s2-01..02 | `/deals/{id}/s2`, `/opportunities` | DEMO | funnel, opportunity list |
| s2-03 | `/opportunities/{id}` | DEMO | opportunity detail / factors |
| s3-01..02 | `/deals/{id}/s3` | DEMO | synergy, strategic fit |
| s3-03 | `/our-company` | — | subsidiary profile |
| s4-01..03 | `/deals/{id}/s4` | DEMO + PRJ-DSE4PW + PRJ-QGB2W5 | route advisory, draft, recorded decision (each track) |
| s8-01 | `/deals/{id}/s8` | both tracks | business case |
| s9-01 | `/deals/{id}/s9` | — | DD checklist |
| s11-01 | `/deals/{id}/s11` | — | IC review buckets |
| s12-01 | `/deals/{id}/s12` | DEMO | post management |

### 9.2 Green Field (14)
s5-01..03 `/deals/{id}/s5` (capability gap, scope panel, recommendation) · gf-sites `/projects/{id}/sites` · gf-permits `/projects/{id}/permits` · gf-incentives `/projects/{id}/incentives` · gf-partnership `/projects/{id}/partnership` · s8-gf-01 single-scope business case (PRJ-DSE4PW) · s9-gf-01 greenfield DD · s10-gf-01..02 execution baseline + capex tranches · s10-gf-03 `BaselineConfirmDialog` (open only, cancel) · s11-gf-01 `EstablishmentPanel` · s12-gf-01 baseline variance.

### 9.3 Brown Field (20)
s6-01..03 `/deals/{id}/s6` (universe criteria, Long List, candidate add/exclude dialog — open only) · s7-01..03 `/deals/{id}/s7` (screening, Short List, target selection) · bf-target `/brownfield/targets/{targetId}` · bf-company `/companies`, `/companies/{id}` (2) · s8-bf-01 per-target comparison · s9-bf-01 M&A validator order · bf-customer-coc · bf-comp-parity · bf-interviews · s10-bf-01 `/projects/{id}/deal-structure` · s10-bf-02 debt · s11-bf-01 closing · s12-bf-01 `/projects/{id}/pmi`.

### 9.4 Project-scoped and admin (20)
Project: `wacc`, `financial-analysis`, `proxy-chain`, `risk-heatmap`, `timeline`, `reports`, `share`, `agent-runs`, `backtest`, `portfolio`, `ic-review`, `charter` (12). Admin: `/admin`, `users`, `master-data`, `data-sources`, `schedule`, `system-mode`, `audit`+`adr`+`governance`, `notifications` (8; glossary/database/business-targets folded into neighbours or verify-only).

**Total planned captures: 84** (30 shared + 14 Green Field + 20 Brown Field + 20 project/admin). Flat redirect stubs (`/greenfield`, `/brownfield`, `/synergy`, `/route-decision`, `/strategy`, `/process/[stage]` …) are not captured; they are documented as aliases in `02-화면-구성`.

## 10. Writing and QA plan

1. **Draft** (docs-writer, Korean, 순우리말-first): one page per row of §7.1, from the template.
2. **Live verification** (ux-designer-agent): open each route on the sample projects read-only; every step's label must match the on-screen text exactly; record `verified_on`/`verified_build`. Mismatches go to the defect log, not into wording workarounds.
3. **Procedure check** (process-governance-manager, different domain): no page restates `procedures/*.yaml` steps; gates and human-only acts are described correctly.
4. **Design check** (design-system-agent): captures meet §8; terminology matches glossary (glossary-lint on wiki pages).
5. **Human final**: one P2-type user walks the Green Field lane and one the Brown Field lane on DEMO data and reports "could not complete" points.

Definition of done per page: frontmatter complete; ≥1 capture with caption; numbered steps each keyed to a visible label; track callout present on S4–S12 pages; next-step link; zero broken relative links (link check script); verified within the current release.

## 11. Open questions (human decider)

1. If a needed state exists on none of the sample projects (e.g. open `BaselineConfirmDialog`, a pending proposal), may a disposable demo project be seeded, or do we leave the capture as a text-only step?
2. Is the wiki the new primary manual (deprecating `docs/manuals/*_ko.md` screen content) or a companion?
3. Link style for GitHub Wiki mirroring: `.md` links + mirror script, or wiki-style links only?
4. Who acts as the human final walker for each lane?
5. Should S6/S7 tabs be shown (disabled) or hidden for greenfield deals — the manual must describe one behaviour (see defect log D-03).
6. English-only docs policy: confirm `docs/wiki/ko/` is accepted as a locale zone by the language lint.

## 12. Refresh log

- **2026-10-23** — refresh round 1 of 2: reflects the 2026-10-21~22 app changes. Updated page groups:
  - Stage shared pages `31`/`32`/`33`/`34-공통-*`: S9–S12 IA overhaul (backtest → S12, DD tool cards, heatmap pending-strip + risk register, charter project-common, review-ack saving), depth-closure features (debt schedule, incentive NPV units, site columns, permits pre-review, IC steps 4.5/4.6, report sections §8–§12), head-action screen standard (`다음: … →` navigation, strip order, `🤖 … (AI)` buttons), terminology renames (부채 → `차입·여신`, 트랜치 → `집행 단계(트랜치)`, 원본기회 → `사업기회`).
  - Green Field lane pages `43`/`44`/`45-그린필드-*` and Brown Field lane pages `54`/`55`/`56-브라운필드-*`: only the portions the above changes touch.
  - Project screen guide `60-프로젝트-화면-안내.md`: `/projects` list columns, backtest location, charter common link, milestone common page + sidebar badge, report section expansion.
  - Round 2 of 2 (this change set): `Home.md`, `01-*`, `11-*`, `12-*`, `22-*`, `30-공통-S8*`, `40-*`, `80-*`, `81-*`, `90-*`, `91-*`, `82-변경-이력.md` received the minimal terminology / orphaned-reference sweep in this round, not a full rewrite (rename follows the on-screen `사업 기회 보기`; the `/projects` 사업 기회 column itself was removed 2026-10-22). `30-공통-S8*` was audited only (financial-prose `부채` kept, no edit needed). On `12-*` the deeper anatomy items (head nav `다음: … →`, strip order, `🤖 … (AI)` buttons, font scale) had no target — the page does not describe stage-screen anatomy — so only its stale pointers were fixed.
