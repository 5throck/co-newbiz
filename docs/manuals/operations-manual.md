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

### 3.2 External data-source keys

In-app collection and the scheduled collectors read their keys (`DART_API_KEY`, `KRX_API_KEY`, `ECOS_API_KEY`, `LAW_API_OC`, `KOSIS_API_KEY`, `DATA_GO_KR_API_KEY`) from the repo-root `.env` at server start; restart the server after a change. A missing key makes the in-app collection answer `503 <source>_api_key_missing` and makes the scheduled job skip with `credential_missing`. A set key can still fail when the source has not approved the account or dataset. The per-source application steps, approval notes, and the data.go.kr dataset registry are in the [admin manual](admin-manual.md) section 6.

### 3.3 GPU acceleration for the Monte Carlo engine (`CO_NEWBIZ_SIM_GPU`)

The S8 Monte Carlo engine (`python/sim_engine`) always works on CPU (numpy). A GPU is optional and is only worth it for large simulations: the engine uses it only when `iterations x cases` reaches **200,000** (`GPU_WORK_THRESHOLD`); below that, transfer overhead makes CPU faster even on a GPU host. So a GPU pays off only when `bc.iterations` is raised well above the default.

**Setup is automatic.** `bun run setup:python` (`scripts/co-newbiz/setup-python-env.ts`) creates or updates the repo-root `.venv`, installs `python/requirements.txt`, detects the accelerator, and installs the matching `python/requirements-gpu-<cuda|mps|rocm|xpu>.txt`. The app's `bun run dev` runs it first (`predev`, soft mode: a failure never blocks the dev server, and a failed attempt is not retried for 6 hours). When nothing changed it is a no-op that costs one Python start (a stamp in `.venv/.co-newbiz-setup.json` hashes the requirement files, accelerator, and interpreter). It never uses `sudo`; everything stays inside `.venv`.

| Detected on the host | Accelerator |
|---|---|
| macOS on Apple Silicon | `mps` (float32 only) |
| `nvidia-smi` on PATH (Linux/Windows) | `cuda` |
| Intel `xpu-smi` / `sycl-ls` / `ONEAPI_ROOT` (Linux/Windows) | `xpu` |
| `rocminfo` / `rocm-smi` on PATH (Linux) | `rocm` |
| none of the above | CPU only |

Precedence is the engine's own order: cuda, mps, xpu, rocm.

- **Force or disable**: `bun run setup:python --gpu=cuda|mps|rocm|xpu` forces one, `--gpu=none` installs CPU packages only. Set `CO_NEWBIZ_SIM_GPU=auto|none|cuda|mps|rocm|xpu` in `.env` to make the choice persistent (the flag wins over the variable). Switching accelerator replaces the installed torch build. The variable only selects what is **installed**: it does not force the run-time device. The engine still chooses per job (the job-spec `device`, and a GPU only above the 200,000 threshold), so `none` or an unset variable never blocks a GPU job on a host that already has torch with a GPU.
- **Preview / verify**: `--dry-run` prints the plan and changes nothing. `--check` changes nothing and exits 1 when the selected accelerator is not usable by torch in `.venv`; it ends with the engine's own probe (`python -m sim_engine --device-info`).
- **Misconfiguration warning**: when `CO_NEWBIZ_SIM_GPU` asks for a GPU but the engine reports CPU for lack of torch, the server logs one warning pointing to `bun run setup:python`.
- **Docker**: the production image is CPU-only and carries no Python by default. Build-arg `SIM_GPU` (`none` default, `cpu`, `cuda`, `rocm`, `xpu`) adds the engine layer: `docker build -f docker/Dockerfile --build-arg SIM_GPU=cuda -t co-newbiz-web:cuda .`. GPU variants are separate images and the GPU must be passed through at run time.

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
