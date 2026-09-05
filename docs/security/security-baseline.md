# Security Baseline — co-newbiz

**Owner**: security-engineer
**Design of record**: design v1.0 §4-12 (task 4.5), `docs/security/security-model.md`
**Status**: Stage 5 — executable and first-executed Wave 5.9. §1's weekly dependency/secrets scan (`gitleaks detect`, 0 leaks across 98 commits) and §1's quarterly threat-model refresh (`docs/security/security-model.md` §8, re-walked against every schema/API change through Wave 5.7A) both ran for real this wave, not only documented as intent. The remaining Stage-5-marked rows (monthly/annual cadence items, scheduler-dependent) activate on their own calendar per `docs/governance/ops-cadence.md` and are not yet due for a first real execution.

## 1. Recurring Cadence (Reuses `docs/governance/ops-cadence.md` §1's Table Structure)

| Cadence | Task | Owner |
|---|---|---|
| Weekly | Dependency vulnerability scan (`security-scan` skill), secrets scan (gitleaks), false-positive alert review | security-engineer |
| Monthly | Access-permission review (who has membership on which projects, is it still justified) | security-engineer, compliance-officer |
| Quarterly | Threat model refresh (`docs/security/security-model.md` STRIDE matrix re-walked against any schema/API changes since last review), DR drill | security-engineer, platform-lead |
| On every dependency bump | CVE check before merge | release-engineer |
| On every schema change touching §9 tables (`docs/architecture/db-schema.md`) | Security review required before merge — not optional for information-protection tables specifically | security-engineer + data-architect joint sign-off |

## 2. Pre-Deployment Gate

- `security-scan` — 0 Critical findings required to proceed (design §12 verification item).
- `stride-threat-matrix` — re-run against the STRIDE matrix in `docs/security/security-model.md` §2 for any change touching a trust boundary.
- `sarif-exporter` — findings exported in SARIF for tracking.
- Secrets: no API key ever committed; `.env`/`.env.sample` split enforced by the workspace's existing pre-commit hook.

## 3. Vulnerability Management

- Dependency updates tracked via the workspace's `update-bun-packages` tooling, applied on the weekly cadence above.
- A Critical/High CVE with no available patch triggers an immediate risk-acceptance decision by security-engineer, recorded (not silently deferred).

## 4. Access Control Review

- Monthly: every active `project_member` row cross-checked against whether the person still has an active need — stale memberships revoked, not left to expire passively.
- `wall_group` assignments reviewed for continued relevance (e.g. a since-resolved conflict of interest).
- Admin-role holders list reviewed quarterly — admin count should stay minimal by design, not grow by default.

## 5. Incident Response

1. `sre` triages and classifies severity (reused from `docs/governance/ops-cadence.md` context, since incident response spans both operational and security concerns).
2. If the incident touches an `mnpi_flag=true` project, `data_access_log` and `insider_list` records become part of the incident record — not an afterthought.
3. Post-incident analysis mandatory for any production security incident; findings feed the quarterly threat-model refresh.
4. A security incident affecting the audit log's integrity (however unlikely, given append-only enforcement) is treated as Critical-severity by default, given the log's role as the system's accountability backbone.

## 6. Webhook and Outbound Payload Review

- Webhook payloads (RAG-transition alerts, batch-failure notifications) reviewed to ensure no sensitive financial figures or compensation data are included — summary-level content only, detail requires an authenticated follow-up API call.

## 7. Related

- `docs/security/security-model.md` — the threat model this baseline operationally sustains
- `docs/governance/ops-cadence.md` — the broader operating rhythm this baseline's cadence is embedded within
