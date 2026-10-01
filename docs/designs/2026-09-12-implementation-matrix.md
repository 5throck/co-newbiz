# Implementation Matrix — v5 Baseline ↔ Build Tracking

- **Baseline (frozen)**: `docs/designs/mockups/baseline-v5.html` + `docs/designs/mockups/previews/<id>.png` (56 screens, captured 2026-09-12)
- **Status snapshot**: audited 2026-10-01 (spec 2026-10-01-s1-s12-process-alignment-design). The prior snapshot was 2026-09-12 (post Wave 1): 36 of 56 baseline screens mapped to implemented surfaces (legacy screens + Wave 0 APIs + Wave 1 /deals skeleton), with 7 new-tool UIs (Wave 2), 8 round-2/3 surfaces (Wave 3), and a legacy restyle pass still open.
- **Rule**: development is built to the v5 baseline. Each wave updates Status here; the all-agent quality review judges conformance using this matrix (mockup preview vs implemented screen, side by side).

| # | Screen | Baseline preview | Implementation route | Status | Notes |
|---|--------|------------------|----------------------|--------|-------|
| 1 | `dashboard` | previews/dashboard.png | / (dashboard) | implemented | |
| 2 | `login` | previews/login.png | /login | implemented | |
| 3 | `register` | previews/register.png | /register | implemented | |
| 4 | `password-change` | previews/password-change.png | /password-change | implemented | |
| 5 | `deal-board` | previews/deal-board.png | /deals (new; absorbs /pipeline) | implemented (wave1 /deals) | |
| 6 | `deal-list` | previews/deal-list.png | /deals/list (new; from /projects) | planned | |
| 7 | `deal-overview` | previews/deal-overview.png | /deals/{id} (new) | implemented (wave1 /deals/[id]) | |
| 8 | `s1` | previews/s1.png | /deals/{id}/s1 (from /market) | implemented (legacy /market) | |
| 9 | `s2` | previews/s2.png | /deals/{id}/s2 (from /opportunities) | implemented (legacy /opportunities) | 2026-09-13: ADR-0127 — opportunity detail screen /opportunities/{id} (factors, attractiveness score, business-model review history, promotion panel), minimal row actions, funnel KPI stage filters |
| 10 | `s3` | previews/s3.png | /deals/{id}/s3 (from /synergy) | implemented (legacy /synergy) | 2026-09-13: ADR-0125 human curation layer (linkage add, shortlist verdict editing, origin badges); ADR-0126/0128 company-grouped list, /agents PM query surface |
| 11 | `s4` | previews/s4.png | /deals/{id}/s4 (from /route-decision) | implemented (/deals/{id}/s4) | 2026-09-13: rewritten to baseline card/tab structure in `components/stages/RouteDecisionStage.tsx`; `/route-decision` now redirects |
| 12 | `s5` | previews/s5.png | /deals/{id}/s5 (from /greenfield) | implemented (legacy /greenfield) | |
| 13 | `s6s7` | previews/s6s7.png | /deals/{id}/s6+s7 (from /brownfield) | implemented (legacy /brownfield) | |
| 14 | `s8` | previews/s8.png | /deals/{id}/s8 (from business-case) | implemented (legacy business-case) | |
| 15 | `s9` | previews/s9.png | /deals/{id}/s9 (from dd) | implemented (legacy dd) | |
| 16 | `s10` | previews/s10.png | /deals/{id}/s10 (from deal-structure) | implemented (legacy deal-structure) | |
| 17 | `s11` | previews/s11.png | /deals/{id}/s11 (from ic-review) | implemented (legacy ic-review) | |
| 18 | `s12` | previews/s12.png | /deals/{id}/s12 (from portfolio) | implemented (legacy portfolio) | |
| 19 | `t-wacc` | previews/t-wacc.png | /projects/[id]/wacc | implemented (legacy wacc) | |
| 20 | `t-financial` | previews/t-financial.png | /projects/[id]/financial-analysis | implemented (legacy financial-analysis) | |
| 21 | `t-charter` | previews/t-charter.png | /projects/[id]/charter | implemented (legacy charter) | |
| 22 | `t-proxy` | previews/t-proxy.png | /projects/[id]/proxy-chain | implemented (legacy proxy-chain) | |
| 23 | `t-reports` | previews/t-reports.png | /projects/[id]/reports | implemented (legacy reports) | |
| 24 | `t-partnership` | previews/t-partnership.png | /projects/[id]/partnership | implemented (legacy partnership) | |
| 25 | `t-pmi` | previews/t-pmi.png | /projects/[id]/pmi | implemented (legacy pmi) | |
| 26 | `t-process` | previews/t-process.png | /projects/[id]/process | implemented (legacy process) | |
| 27 | `r-our-company` | previews/r-our-company.png | /our-company | implemented (legacy our-company) | |
| 28 | `r-companies` | previews/r-companies.png | /companies | implemented (legacy companies) | |
| 29 | `r-company-detail` | previews/r-company-detail.png | /companies/[companyId] | implemented (legacy companies/[companyId]) | |
| 30 | `r-benchmarks` | previews/r-benchmarks.png | /benchmarks | implemented (legacy benchmarks) | |
| 31 | `r-library` | previews/r-library.png | /library | implemented (legacy library) | |
| 32 | `r-glossary` | previews/r-glossary.png | /glossary | implemented (legacy glossary) | |
| 33 | `r-strategy` | previews/r-strategy.png | /strategy | implemented (legacy strategy) | |
| 34 | `archives` | previews/archives.png | /projects/archives | implemented (legacy archives) | |
| 35 | `a-users` | previews/a-users.png | /admin/users | implemented (legacy admin/users) | |
| 36 | `a-master` | previews/a-master.png | /admin/master-data | implemented (legacy admin/master-data) | |
| 37 | `a-targets` | previews/a-targets.png | /admin/business-targets | planned (wave3) | |
| 38 | `a-schedule` | previews/a-schedule.png | /admin/schedule | implemented (legacy admin/schedule) | |
| 39 | `a-audit` | previews/a-audit.png | /admin/audit | implemented (legacy admin/audit) | |
| 40 | `a-notifications` | previews/a-notifications.png | /admin/notifications (+retention/data-sources/glossary-lint/governance) | implemented (legacy admin/notifications) | |
| 41 | `committee` | previews/committee.png | /deals/{id}/committee (new; committee-sessions REST) | planned (wave3) | |
| 42 | `t-incentive` | previews/t-incentive.png | /deals/{id}/tools/incentives (new REST B3) | implemented (/projects/[id]/incentives) | |
| 43 | `t-site` | previews/t-site.png | /deals/{id}/tools/sites (new REST B4) | implemented (/projects/[id]/sites) | |
| 44 | `t-permits` | previews/t-permits.png | /deals/{id}/tools/permits (new REST B5) | implemented (/projects/[id]/permits) | |
| 45 | `t-debt` | previews/t-debt.png | /deals/{id}/tools/debt (new REST B6) | implemented (/projects/[id]/debt) | |
| 46 | `t-interviews` | previews/t-interviews.png | /deals/{id}/tools/interviews (new REST B7) | implemented (/projects/[id]/interviews) | |
| 47 | `t-coc` | previews/t-coc.png | /deals/{id}/tools/customer-coc (new REST B8) | implemented (/projects/[id]/customer-coc) | |
| 48 | `t-comp` | previews/t-comp.png | /deals/{id}/tools/comp-parity (new REST B9) | implemented (/projects/[id]/comp-parity) | |
| 49 | `ds-gallery` | previews/ds-gallery.png | TBD | planned | |
| 50 | `t-timeline` | previews/t-timeline.png | /deals/{id}/timeline (new; SLA policy table required) | implemented (/projects/[id]/timeline) | |
| 51 | `risk-heatmap` | previews/risk-heatmap.png | /deals/{id}/risk-heatmap (new; aggregates existing risk data) | implemented (/projects/[id]/risk-heatmap) | |
| 52 | `portfolio-view` | previews/portfolio-view.png | /portfolio-view (new view over existing aggregates) | planned (wave3) | |
| 53 | `onboarding` | previews/onboarding.png | /onboarding (empty-workspace guide) | implemented (/onboarding) | |
| 54 | `agent-runs` | previews/agent-runs.png | /deals/{id}/agent-runs (new; surfaces agent_run/activity_run/gate_evaluation) | implemented (/projects/[id]/agent-runs) | |
| 55 | `backtest` | previews/backtest.png | /portfolio/backtest (new; needs forecast-actual fact view) | implemented (/projects/[id]/backtest) | |
| 56 | `share` | previews/share.png | /deals/{id}/share (new; security design sign-off required) | UI implemented (/projects/[id]/share); security-gate note kept | |

> **Route audit note (2026-10-01, Row 5 audit — spec 2026-10-01-s1-s12-process-alignment-design)**: rows carrying "implemented (legacy ...)" are thin wrappers over the shared `components/stages/*Stage.tsx` components, integrated into `/deals/{id}/s1..s12`; `/route-decision` redirects with a no-deal-id picker; `/opportunities/[id]` is a standalone S2 detail surface (ADR-0127). Flat-route redirects (`/market`, `/synergy`, `/greenfield`, `/brownfield`, ...) are a follow-up PR touching `lib/navigation.ts`, `lib/pipeline.ts`, `components/StageFrame.tsx`, and `components/AppShell.tsx`; removal of the dead `STAGE_LINK` map is a follow-up. `/route-decision` and `/opportunities/[id]` need a human decision before any change.

## Comparison protocol (at completion)

1. Re-capture implemented screens as `previews/impl-<id>.png` (same 1440x950 viewport).
2. Side-by-side review per screen: layout, actions, states vs baseline.
3. Differences logged in Notes with severity; P1 differences become revision PRs before sign-off.
4. The all-agent quality review scores the four journeys using this matrix.