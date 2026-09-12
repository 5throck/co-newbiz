# Implementation Matrix — v5 Baseline ↔ Build Tracking

- **Baseline (frozen)**: `docs/designs/mockups/baseline-v5.html` + `docs/designs/mockups/previews/<id>.png` (56 screens, captured 2026-09-12)
- **Rule**: development is built to the v5 baseline. Each wave updates Status here; the all-agent quality review judges conformance using this matrix (mockup preview vs implemented screen, side by side).

| # | Screen | Baseline preview | Implementation route | Status | Notes |
|---|--------|------------------|----------------------|--------|-------|
| 1 | `dashboard` | previews/dashboard.png | / (dashboard) | planned | |
| 2 | `login` | previews/login.png | /login | planned | |
| 3 | `register` | previews/register.png | /register | planned | |
| 4 | `password-change` | previews/password-change.png | /password-change | planned | |
| 5 | `deal-board` | previews/deal-board.png | /deals (new; absorbs /pipeline) | planned | |
| 6 | `deal-list` | previews/deal-list.png | /deals/list (new; from /projects) | planned | |
| 7 | `deal-overview` | previews/deal-overview.png | /deals/{id} (new) | planned | |
| 8 | `s1` | previews/s1.png | /deals/{id}/s1 (from /market) | planned | |
| 9 | `s2` | previews/s2.png | /deals/{id}/s2 (from /opportunities) | planned | |
| 10 | `s3` | previews/s3.png | /deals/{id}/s3 (from /synergy) | planned | |
| 11 | `s4` | previews/s4.png | /deals/{id}/s4 (from /route-decision) | planned | |
| 12 | `s5` | previews/s5.png | /deals/{id}/s5 (from /greenfield) | planned | |
| 13 | `s6s7` | previews/s6s7.png | /deals/{id}/s6+s7 (from /brownfield) | planned | |
| 14 | `s8` | previews/s8.png | /deals/{id}/s8 (from business-case) | planned | |
| 15 | `s9` | previews/s9.png | /deals/{id}/s9 (from dd) | planned | |
| 16 | `s10` | previews/s10.png | /deals/{id}/s10 (from deal-structure) | planned | |
| 17 | `s11` | previews/s11.png | /deals/{id}/s11 (from ic-review) | planned | |
| 18 | `s12` | previews/s12.png | /deals/{id}/s12 (from portfolio) | planned | |
| 19 | `t-wacc` | previews/t-wacc.png | /deals/{id}/tools/wacc | planned | |
| 20 | `t-financial` | previews/t-financial.png | /deals/{id}/tools/financial-analysis | planned | |
| 21 | `t-charter` | previews/t-charter.png | /deals/{id}/tools/charter | planned | |
| 22 | `t-proxy` | previews/t-proxy.png | /deals/{id}/tools/proxy-chain | planned | |
| 23 | `t-reports` | previews/t-reports.png | /deals/{id}/tools/reports | planned | |
| 24 | `t-partnership` | previews/t-partnership.png | /deals/{id}/tools/partnership | planned | |
| 25 | `t-pmi` | previews/t-pmi.png | /deals/{id}/tools/pmi | planned | |
| 26 | `t-process` | previews/t-process.png | /deals/{id}/process (from /projects/[id]/process) | planned | |
| 27 | `r-our-company` | previews/r-our-company.png | /our-company | planned | |
| 28 | `r-companies` | previews/r-companies.png | /companies | planned | |
| 29 | `r-company-detail` | previews/r-company-detail.png | /companies/[companyId] | planned | |
| 30 | `r-benchmarks` | previews/r-benchmarks.png | /benchmarks | planned | |
| 31 | `r-library` | previews/r-library.png | /library | planned | |
| 32 | `r-glossary` | previews/r-glossary.png | /glossary | planned | |
| 33 | `r-strategy` | previews/r-strategy.png | /strategy | planned | |
| 34 | `archives` | previews/archives.png | /deals/archives (from /projects/archives) | planned | |
| 35 | `a-users` | previews/a-users.png | /admin/users | planned | |
| 36 | `a-master` | previews/a-master.png | /admin/master-data | planned | |
| 37 | `a-targets` | previews/a-targets.png | /admin/business-targets | planned | |
| 38 | `a-schedule` | previews/a-schedule.png | /admin/schedule | planned | |
| 39 | `a-audit` | previews/a-audit.png | /admin/audit | planned | |
| 40 | `a-notifications` | previews/a-notifications.png | /admin/notifications (+retention/data-sources/glossary-lint/governance) | planned | |
| 41 | `committee` | previews/committee.png | /deals/{id}/committee (new; committee-sessions REST) | planned | |
| 42 | `t-incentive` | previews/t-incentive.png | /deals/{id}/tools/incentives (new REST B3) | planned | |
| 43 | `t-site` | previews/t-site.png | /deals/{id}/tools/sites (new REST B4) | planned | |
| 44 | `t-permits` | previews/t-permits.png | /deals/{id}/tools/permits (new REST B5) | planned | |
| 45 | `t-debt` | previews/t-debt.png | /deals/{id}/tools/debt (new REST B6) | planned | |
| 46 | `t-interviews` | previews/t-interviews.png | /deals/{id}/tools/interviews (new REST B7) | planned | |
| 47 | `t-coc` | previews/t-coc.png | /deals/{id}/tools/customer-coc (new REST B8) | planned | |
| 48 | `t-comp` | previews/t-comp.png | /deals/{id}/tools/comp-parity (new REST B9) | planned | |
| 49 | `ds-gallery` | previews/ds-gallery.png | TBD | planned | |
| 50 | `t-timeline` | previews/t-timeline.png | /deals/{id}/timeline (new; SLA policy table required) | planned | |
| 51 | `risk-heatmap` | previews/risk-heatmap.png | /deals/{id}/risk-heatmap (new; aggregates existing risk data) | planned | |
| 52 | `portfolio-view` | previews/portfolio-view.png | /portfolio (new view over existing aggregates) | planned | |
| 53 | `onboarding` | previews/onboarding.png | /onboarding (empty-workspace guide) | planned | |
| 54 | `agent-runs` | previews/agent-runs.png | /deals/{id}/agent-runs (new; surfaces agent_run/activity_run/gate_evaluation) | planned | |
| 55 | `backtest` | previews/backtest.png | /portfolio/backtest (new; needs forecast-actual fact view) | planned | |
| 56 | `share` | previews/share.png | /deals/{id}/share (new; security design sign-off required) | planned | |

## Comparison protocol (at completion)

1. Re-capture implemented screens as `previews/impl-<id>.png` (same 1440x950 viewport).
2. Side-by-side review per screen: layout, actions, states vs baseline.
3. Differences logged in Notes with severity; P1 differences become revision PRs before sign-off.
4. The all-agent quality review scores the four journeys using this matrix.