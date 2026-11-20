---
lang: en
counterpart: operations-manual_ko.md
---

# Operations Manual — System Operators

> **Language**: **English** · [한국어](operations-manual_ko.md)

**Audience**: dba, sre, release-engineer, infra-automation-engineer (or their human counterparts)
**Not for**: analysts (see `business-manual.md`) or administrators (see `admin-manual.md`)

## What This Manual Covers

Batch operations, backup/recovery, incident response, and deployment/rollback — the standing operational rhythm that keeps the system running, distinct from the business process it runs.

## 1. Operating Rhythm (per meeting M7)

| Owner | Cadence | Task |
|---|---|---|
| dba | Daily | Backup-success confirmation |
| dba | Weekly | Capacity and query-performance review |
| dba | Monthly | **Recovery drill** — a backup that has never been restored is not a verified backup. First drill: one month after go-live. |
| sre | Daily | Fetch-failure triage |
| sre | Continuous | Alert pipeline — cooldown 24h per (project, trigger_type) pair, hysteresis mirrors the RAG 7-day hold |
| sre | On incident | Incident response + post-incident analysis |
| security-engineer | Weekly/Quarterly | See `docs/security/security-baseline.md` *(Stage 4)* |

## 2. Deployment & Rollback

1. Every migration is tagged **reversible or not at write time** — never inferred after the fact.
2. Backup runs immediately before any migration.
3. Health check runs immediately after.
4. Rollback is rehearsed at least once per release cycle on reversible-tagged migrations.
5. **Irreversible migrations require joint release-engineer + dba sign-off** before shipping — this is a higher bar than the default review, deliberately.

## 3. Batch Operations

The scheduled data-collection pipeline (`newbiz.ts watch:run`, `scripts/co-newbiz/newbiz.ts`) runs at the OS level (Task Scheduler / systemd timer), **not** as an in-process timer — an in-process timer dies with the app, which defeats the purpose of scheduled monitoring.

Pipeline: fetch (cache-first) → impact detection → auto-rerun → RAG re-evaluation → notification. `job_run` is the operational audit trail for this pipeline — check it first when a scheduled run appears to have not fired.

### 3.1 Committee Meeting Engine (`CO_NEWBIZ_COMMITTEE_ENGINE`)

The committee pre-review engine is chosen per new session (ADR-0204). The turn-based dialogue meeting is the default since the 2026-11-21 owner decision.

| Setting | Effect on new sessions |
|---|---|
| unset or empty (default) | `turns` - turn-based dialogue meeting |
| `CO_NEWBIZ_COMMITTEE_ENGINE=turns` | Same as the default, stated explicitly |
| `CO_NEWBIZ_COMMITTEE_ENGINE=rounds` | Opt-out - the earlier round engine (one position paper per seat per round) |
| any other value | Convening is refused with an error; the value is never coerced |

- **Opt out**: set `CO_NEWBIZ_COMMITTEE_ENGINE=rounds` in the server environment (see `.env.sample`) and restart. For the CLI, pass `--engine rounds` to `scripts/co-newbiz/committee-deliberation.ts`; an explicit flag beats the environment variable.
- **Existing sessions** keep the engine stored in their session meta. Changing the variable never moves a session that is already convened, and no rows are rewritten.
- **No silent fallback**: an LLM failure stops convening. It never drops to `rounds`. Without a configured LLM provider, convening refuses with `llm_required`.
- **Rollback**: set `rounds` as above. Turn rows already written stay readable as history.

## 4. Access Control (Operator-Facing)

The CLI, run by a human operator, still resolves to a real `project_member` context (operator account or an audited `--as-user` flag) — **there is no trusted-operator exemption from need-to-know** (meeting M7-1 D-M7-1... / M7 D-M7-1). Do not treat local CLI access as a bypass.

## 5. Incident Response

1. sre triages and classifies severity.
2. If the incident touches an MNPI-flagged project, `data_access_log` and `insider_list` records are part of the incident record, not incidental detail.
3. Post-incident analysis is mandatory for any production incident, feeding the governance KPI set (rework rate, if applicable) alongside the operations-specific postmortem.

## 6. Related

- `docs/governance/governance-operations.md` — the *business* governance operation (compliance, waivers), distinct from this document's *system* operation.
- `docs/security/security-baseline.md` *(Stage 4)*.
- [`mcp-admin-guide.md`](mcp-admin-guide.md) — MCP package release and the 90-day `NPM_TOKEN` rotation.

## 7. Related Screens

- `/flows` — stage-flow visualization with a dry-run lane (ADR-0183).
- UI language switch — ko/en message catalogs behind cookie-based locale negotiation (ADR-0184).
- `/wiki` — in-app viewer for the user-manual wiki.
