---
title: Env single-source unification — repo-root .env as SSOT, app/web-next/.env shrinks to Prisma tooling, drift guard
date: 2026-11-13
status: Implemented (Design Gate ADR-0074 — Row 0 determination accepted per DEC-20261113-01; implementation and §3.5 value-neutral migration executed on this machine, verified 2026-11-13; registered implemented in docs/specs/registry.json — entry 2026-11-13-env-single-source-design)
owner: backend-engineer (design; PM dispatch per DEC-20261113-01)
reviewers_required: process-governance-manager (AI-2nd, functional domain — author is technical domain), owner (human approval)
decision_record: docs/decisions/DEC-20261113-01.md
related: ADR-0074 (Design Gate), ADR-0075 (pipeline environment pre-flight / env-check), design 2026-08-31-pipeline-execution-environment (§2.5 shared env parser), DEC-20261104-04 (digit-bearing env key charset), ADR-0189/0190 (scheduler notification transport), ADR-0196 amendment (committee mode env var removal), ADR-0131 (protected-rerun), design 2026-11-10-db-path-resolver-marker (db/client.ts path resolution)
---

# Env single-source unification — repo-root .env as SSOT, app/web-next/.env shrinks to Prisma tooling, drift guard

## 1. Conclusion (the chosen architecture)

The repo-root `.env` becomes the **Single Source of Truth (SSOT)** for every co-newbiz runtime
configuration value — the LLM block, web-search keys and flags, executor agent modes, scheduler
NOTIFY keys, `CO_NEWBIZ_DB_PATH`, and dev origins. `app/web-next/.env` shrinks to the one value the
Next.js/Prisma tooling cannot take from root today (`DATABASE_URL` for the Prisma 7 CLI, read only
from that file by `prisma.config.ts`). "Root wins" is achieved **by deleting the duplicated active
keys from `app/web-next/.env` in a value-neutral migration — not by changing loader precedence**:
the existing no-override discipline (`root-env.ts:52` — a root value is imported only when
`process.env` does not already hold the key) stays intact, because it is what protects explicitly
provided spawn/prod env. A **drift guard** closes the loop: `env-check.ts` (the ADR-0075 pre-flight)
FAILS when the same SSOT key is defined in both files with different values and WARNS on same-value
duplication, while `loadRootEnvPipelineKeys` emits a boot-time `console.warn` when an auto-loaded
app value shadows a root value — boot stays warn-only; the CLI gate is the hard stop.

Mental model: think of the two files as **inventory and overrides**. The root `.env` is the
warehouse — every key has exactly one shelf there. `app/web-next/.env` is a local pocket for the
one item the Prisma CLI insists on carrying itself. The drift guard is the stock-take that fails
the shift (env-check) when the same item is found on two shelves with different labels, and taps
the operator on the shoulder (boot warn) when it happens while the shop is open.

## 2. Problem: the duplication and precedence state today (verified 2026-11-13)

Every claim below was re-verified against the working tree on 2026-11-13; anchors are file:line.

### 2.1 Two files hold overlapping active config

Active (non-comment) keys and their locations:

| Key | Root `.env` | `app/web-next/.env` | Read by |
|---|---|---|---|
| `CO_NEWBIZ_LLM_PROVIDER` | :89 | :18 (**trailing space**) | `llm.ts` provider dispatch |
| `CO_NEWBIZ_LLM_BASE_URL` | :90 | :19 | `llm.ts` |
| `CO_NEWBIZ_LLM_API_KEY` | :91 | :20 | `llm.ts` |
| `CO_NEWBIZ_LLM_MODEL` | :92 (**trailing space**) | :21 | `llm.ts` |
| `TAVILY_API_KEY` | :99 | :44 | `web-research.ts` |
| `CO_NEWBIZ_DD_TAILOR_AGENTS` | :108 | :40 | `dd-checklist-tailor.ts:380` |
| `CO_NEWBIZ_BUSINESS_CASE_AGENTS` | :121 | :34 | `business-case-generator.ts:2717` |

Seven active keys are defined in BOTH files (values semantically identical; the two trailing-space
variants are the only textual difference). App-only active keys: `DATABASE_URL` (:5),
`CO_NEWBIZ_DB_PATH` (:7), `BRAVE_SEARCH_API_KEY` (:45), `WEB_SEARCH_DDG_ENABLED` (:47),
`WEB_SEARCH_PLAYWRIGHT_ENABLED` (:50). Root-only active keys: the six source-adapter credentials
(:7–:30), `CO_NEWBIZ_API_BASE_URL` (:51), `CO_NEWBIZ_API_TOKEN` (:61), and — a leftover —
`CO_NEWBIZ_COMMITTEE_AGENTS=llm` (:120, dead: the mode env var was removed entirely by the ADR-0196
amendment decision 10, PR #845 2026-11-09; no consumer exists anywhere in the repo).

### 2.2 Effective precedence is the opposite of what the root file implies

The loaders:

1. **Next auto-load** — `next dev/start` runs with cwd `app/web-next`, and Next 16.2.2 loads
   `.env*` from that directory **before** evaluating `next.config.ts` (verified:
   `app/web-next/node_modules/next/dist/server/config.js:1182` calls `loadEnvConfig(dir, ...)`
   before the config-module import). Every app-file value therefore lands in `process.env` before
   any project code runs.
2. **`app/web-next/lib/root-env.ts`** (`loadRootEnvPipelineKeys`, :41–65) — walks up from cwd
   (max 6 dirs), imports ONLY allowlisted keys (`isPipelineEnvKey` :33–35: LLM regex
   `^CO_NEWBIZ_LLM_[A-Z_0-9]+$` :19, NOTIFY regex :24, `EXTRA_KEYS` TAVILY/BRAVE/SERPER :18, plus
   `SOURCE_ADAPTERS[*].credentialEnv` — DART, KOSIS, ECOS, KRX, LAW_API_OC, DATA_GO_KR per
   `scripts/co-newbiz/source-adapters.ts:157,237,354,887,948,1001`) and ONLY when
   `process.env[name] === undefined` (:52) — never overrides. Called at server boot
   (`instrumentation.ts:17-18`) and lazily by `llm.ts:58,85`, `web-research.ts:41,133,142,162,223`,
   `dart-client.ts:54`, the admin data-sources route (:15), and the scheduler/CLI runners
   (`job-worker.ts:56`, `schedule-tick.ts:134`, `run-job.ts:333`).
3. **`scripts/lib/env-keys.ts`** (`loadPipelineKeys`, :22–46) — the CLI-side twin used by
   `source-adapters.ts`; a narrower regex (:21) with the same no-override walk.

Consequence: the effective precedence is **spawn env / app auto-load > root `.env` (allowlisted,
no-override) > code defaults** — while the root file's own comment says "put working values in
app/web-next/.env" (`root .env:80`), silently conceding that the app copy is the live one. Today's
S1 failure ran on exactly this split: both files held the same (broken) provider config, and any
future edit to one file but not the other diverges silently.

### 2.3 The trailing spaces are hygiene, not corruption

`parseEnvValue` trims before returning (`scripts/lib/env-value.ts:45-46`), and the bundled dotenv
16.3.1 inside `@next/env` also trims every parsed value. `readKeyFromEnvFile` (`dev-origins.ts:58`)
and `env-check.ts`'s parser (:46) trim too. **No current reader propagates the trailing space**;
the fix is file normalization in the migration, not parser changes.

### 2.4 The `next.config.ts` evaluation window

`CO_NEWBIZ_DIST_DIR` is read directly from `process.env` at config evaluation
(`next.config.ts:13`), and `allowedDevOrigins: resolveAllowedDevOrigins(repoRoot)` (:38 area) reads
`CO_NEWBIZ_ALLOWED_DEV_ORIGINS` from process env FIRST, else from the root `.env` directly
(`dev-origins.ts:74-84`). Because root-env loading happens only in instrumentation — after config
eval — **the root `.env` cannot feed `CO_NEWBIZ_DIST_DIR`**, while the app `.env` CAN (§2.2 item 1).
`CO_NEWBIZ_ALLOWED_DEV_ORIGINS` needs no loader change: its own reader already looks at the root
file.

## 3. Design

### 3.1 Precedence contract (stated once)

```
1. process env at spawn/prod        (compose env_file .env.prod, E2E harness env, shell exports)
2. app/web-next/.env                (Next auto-load — only the Prisma-tooling remnant lives here)
3. repo-root .env                   (SSOT — imported by root-env.ts / env-keys.ts, allowlisted, never overriding)
4. code defaults                    (deterministic fallbacks: "deterministic" agent modes, no-search degradation)
```

Layer 2 sits ABOVE layer 3 mechanically (auto-load populates `process.env` first, and the root
loader never overrides) — the design accepts this and neutralizes it by **deleting every overlapping
key from layer 2**. After the migration no key exists in both files except via operator error, which
the drift guard makes visible. This preserves the no-override rule that protects layer 1, avoids
origin-tracking machinery (was the value set by spawn, by dotenv, or by root?), and reaches the
same observable outcome as a precedence flip: one editing surface.

How the no-override rule interacts: for a key present only in root, layer 3 fills `process.env` at
boot (`instrumentation.ts:17-18`) and lazily at each consumer. For a key present only in the app
remnant, layer 2 fills it and the root loader skips it. For a key in both, layer 2 wins AND the
boot shadow warning fires (§3.4).

### 3.2 Allowlist widening in `root-env.ts` (Rows 1+ change)

`isPipelineEnvKey` / the SSOT inventory gain the following key classes (exact names unless noted):

| Key class | Rationale | Consumer verified |
|---|---|---|
| `CO_NEWBIZ_DB_PATH` | Root .env documents it (:123–125, commented); app `.env:7` moves here | `db/client.ts:70` |
| `^CO_NEWBIZ_[A-Z_0-9]+_AGENTS$` (family) | Executor agent modes (BUSINESS_CASE :121, DD_TAILOR :108); family regex matches the LLM/NOTIFY prefix-wildcard style (DEC-20261104-04) so future executor seams need no loader edit | `business-case-generator.ts:2717`, `dd-checklist-tailor.ts:380` |
| `WEB_SEARCH_DDG_ENABLED` | App `.env:47` moves here | `web-research.ts:35` |
| `WEB_SEARCH_PLAYWRIGHT_ENABLED` | App `.env:50` moves here | `web-research.ts:189` |
| `CHROME_PATH` | Documented in app `.env:49` and root `.env:104` (commented) | `playwright-search.ts:25` |
| `CO_NEWBIZ_BOOTSTRAP_MIGRATIONS` | Root `.env:69` documents it (commented); SSOT means an uncommented root line must reach the server | bootstrap migration policy (instrumentation path) |
| `CO_NEWBIZ_ALLOW_REGISTER` | Root `.env:77` documents it (commented) | auth register route |

Explicitly NOT added, with reasons:

- **`CO_NEWBIZ_ALLOWED_DEV_ORIGINS`** — already handled by its own reader at next.config eval time
  (`dev-origins.ts:80` reads the root `.env` directly); adding it to the root-env loader would be a
  redundant second path.
- **`CO_NEWBIZ_DIST_DIR`** — read at config eval, before instrumentation; must stay in spawn env or
  the app file. Documented in the root `.env` as such, not loaded.
- **`CO_NEWBIZ_API_BASE_URL` / `CO_NEWBIZ_API_TOKEN`** — consumed by the external MCP stdio client
  config and `env-check --exports`, not by the Next server; loader scope is "keys the server/CLI
  processes need in `process.env`".
- **`DATABASE_URL`** — Prisma-CLI tooling key; the deliberate app-file remnant (§3.3).

Inventory shape: export one `ssotEnvKeys(): Set<string>` from `root-env.ts` (= `pipelineEnvKeys()`
∪ LLM family ∪ NOTIFY family ∪ the exact keys above) and have `scripts/lib/env-keys.ts` derive its
regex from the same source (import, not a second copy) — one inventory, two consumers. The CLI twin
keeps its own walk; only the key set is shared.

Note on scheduler/CLI runners: `job-worker.ts`/`schedule-tick.ts`/`run-job.ts` import the WEB
loader (`app/web-next/lib/llm.ts` re-export), so after widening they pick agent modes and web-search
flags from the root `.env` too — previously the scheduler never saw `CO_NEWBIZ_BUSINESS_CASE_AGENTS`
unless it was exported at spawn. INFERRED behavior change, benign: the values are identical to what
the server uses.

### 3.3 What remains in `app/web-next/.env` and why

Exactly one active line: `DATABASE_URL` (plus its explanatory comments).

- `prisma.config.ts:12-19` loads `app/web-next/.env` explicitly (Prisma 7's CLI does not auto-load
  `.env` for the config file itself) and reads only that file (`new URL("./.env", import.meta.url)`
  resolves to `app/web-next/.env`).
- The Prisma CLI is used only by `app/web-next/package.json` scripts `prisma:pull` / `prisma:generate`
  (cwd `app/web-next`). There is NO PrismaClient at runtime (verified: no non-node_modules
  `PrismaClient` reference in `app/web-next`) — the runtime DB handle is bun:sqlite in
  `db/client.ts`, keyed on `CO_NEWBIZ_DB_PATH` (:70), which MOVES TO ROOT (§3.2).
- Removing `DATABASE_URL` from the app file would require extending `prisma.config.ts` to walk to
  root — a code change validated against `prisma db pull`; recorded as follow-up §8.2, not this
  batch.
- `bun run db:migrate` / `db:status` / `db:integrity` run the analysis-engine CLI from the repo root
  (`package.json:53-55`) and go through `db/client.ts` + root-env/env-keys — unaffected by the app
  file shrinking.

### 3.4 Drift guard design

One inventory (§3.2 `ssotEnvKeys()`), two enforcement surfaces:

**A. CLI/CI — extend `scripts/co-newbiz/env-check.ts` (hard gate).**

- New pure module `scripts/lib/env-drift.ts`: `collectEnvDrift(rootText, appText)` parses both
  files with `parseEnvValue` (line regex `^([A-Z_0-9]+)=(.*)$`, skip comments/blank lines) and
  returns: (a) `divergent` — keys in `ssotEnvKeys()` defined in BOTH files with different normalized
  values; (b) `duplicate` — same key, same normalized value; (c) `whitespace` — active unquoted
  values with leading/trailing whitespace in either file. Never returns or prints values.
- env-check integration: in default check mode, `divergent` entries are FAILURES (exit 1, message
  naming the key and both files, e.g. `env drift: CO_NEWBIZ_LLM_MODEL differs between repo-root
  .env and app/web-next/.env — root .env is the SSOT; keep the value in root and delete the app
  copy`); `duplicate` entries are WARNINGS (exit stays 0); `whitespace` entries are WARNINGS.
  Justification: same-key different-value is exactly the failure class that produced two divergent
  LLM blocks; env-check is the designated machine gate (ADR-0075) and a divergent file must not
  pass a pipeline pre-flight. Same-value duplication is redundancy, not divergence — a warning
  nudges cleanup without breaking unrelated runs.
- REQUIRED_KEYS, CRLF check, and the probes are unchanged.

**B. Boot — shadow warning in `loadRootEnvPipelineKeys` (warn-only).**

While walking the root `.env` (:50-56), when a line's key is allowlisted AND
`process.env[key] !== undefined` AND `parseEnvValue(value) !== process.env[key]` (string compare on
trimmed values), emit one `console.warn` per key: `[root-env] KEY: a value provided by the
environment (app/web-next/.env auto-load or spawn env) shadows a different value in the repo-root
.env — root .env is the SSOT; align or remove the shadowing copy`. Same-value shadows stay silent.
No values are ever printed (the loader's existing discipline, root-env.ts header). Justification: a
dev server must not refuse to boot on config hygiene, but the operator who edits the root file and
sees no effect must be told why within the same terminal session — the warn fires at boot, before
any pipeline work.

**C. Test coverage.**

Existing suites to extend (all verified present):

- `tests/unit/root-env.test.ts` — allowlist admission for every new key class; loader walk imports
  the new keys; the shadow-warning case (warn fired on divergent shadow, silent on equal shadow)
  via a `console.warn` spy; the never-override rule re-asserted for the new keys.
- `tests/unit/env-keys.test.ts` — the CLI twin admits the shared inventory (env-keys.ts deriving
  from the shared source).
- `tests/unit/prisma-env-loader.test.ts` — unchanged (no prisma.config.ts change in this batch);
  rerun as a regression guard.
- NEW `tests/unit/env-drift.test.ts` — `collectEnvDrift` cases: divergent / duplicate / disjoint /
  commented-line-is-invisible / whitespace detection / non-SSOT keys ignored (e.g. DATABASE_URL in
  both files must NOT be flagged — it is a legitimate app-file remnant... it will not be in both
  files after migration, but the guard must not false-positive on tooling keys if an operator adds
  one).

### 3.5 Migration steps for THIS dev machine (value-neutral, Row 1+)

Env files are gitignored (`.gitignore:3-4`), so this is a local-file edit executed by the operator
or a Row 1+ script; nothing secret lands in git. The current `openai-compatible` /
`https://api.openai.com/v1` / `gpt-6.1-terra` values are the config that broke today's S1 — they
are copied AS-IS; correcting them is a separate decision, out of scope here.

Root `.env` edits:

| Line | Action |
|---|---|
| :79–92 (LLM block) | KEEP as-is; strip trailing space on :92 (`gpt-6.1-terra ` → `gpt-6.1-terra`); REWRITE the :80 comment "put working values in app/web-next/.env" to state the root-file SSOT rule |
| :99 (TAVILY) | KEEP |
| :108 (DD_TAILOR) | KEEP |
| :120 (`CO_NEWBIZ_COMMITTEE_AGENTS=llm`) | DELETE — dead since ADR-0196 amendment decision 10 (PR #845); no consumer exists |
| :121 (BUSINESS_CASE) | KEEP |
| :123–125 (DB_PATH, commented) | UNCOMMENT with the app value `/Users/techcross/git/ai_workspace/Projects/co-newbiz/db/data/co-newbiz.sqlite` (value-neutral copy of app `.env:7`) |
| after :121 | ADD active lines: `BRAVE_SEARCH_API_KEY=…` (app :45), `WEB_SEARCH_DDG_ENABLED=true` (app :47), `WEB_SEARCH_PLAYWRIGHT_ENABLED=true` (app :50) |
| :117 (DEV_ORIGINS) | KEEP commented (already root-read by dev-origins.ts) |

`app/web-next/.env` edits:

| Line | Action |
|---|---|
| :5 (DATABASE_URL) | KEEP — the sole active remnant |
| :7 (CO_NEWBIZ_DB_PATH) | DELETE (moved to root) |
| :9–:21 (LLM block) | DELETE entirely (root owns it) |
| :24–:40 (agent-mode comments + BUSINESS_CASE, DD_TAILOR) | DELETE (root owns them) |
| :42–:50 (TAVILY, BRAVE, SERPER comment, DDG, CHROME comment, PLAYWRIGHT) | DELETE (root owns them; root `.env:100-104` already documents SERPER/CHROME) |
| :18 | (deleted with the block; trailing space gone with it) |
| Header comment | REWRITE to state the file's new contract: "Prisma CLI tooling values only (DATABASE_URL for prisma.config.ts). All co-newbiz runtime config lives in the repo-root .env." |

Also update in the same Rows 1+ change (documentation, not runtime): the env sample files — the
root `.env.sample` and `app/web-next/.env.sample` if present — so samples describe the SSOT split
(the 2026-11-09 sample cleanup already removed `CO_NEWBIZ_COMMITTEE_AGENTS` documentation).

### 3.6 Explicitly out of scope

- `.env.prod` and the compose env_file channel — untouched; the design must not and does not change
  production boot.
- The `max_tokens` → `max_completion_tokens` fix in `llm.ts:548` (and the anthropic-path
  equivalent) — separate task; it is the actual S1 break.
- The LLM provider/model choice (`openai.com` / `gpt-6.1-terra`) — separate owner decision; the
  migration copies the values as-is.
- `env-check.ts`'s LLM probe hitting the Anthropic-style `/v1/messages` endpoint regardless of
  provider (:101-104) — observed during verification, unrelated to this design; candidate for its
  own ticket.
- Extending `prisma.config.ts` to read the root `.env` (follow-up §8.2).

## 4. Risks and mitigations

| Risk | Assessment | Mitigation |
|---|---|---|
| Silent precedence change for operators who relied on app `.env` winning | None by construction: the no-override rule is untouched; after migration there are no overlapping keys, so layer 2 can no longer shadow layer 3 | Drift guard makes any recurrence visible (env-check FAIL + boot warn) |
| Template-upgrade interaction with the root `.env` | The upgrade pipeline preserves the root `.env` "project-specific variables" section (file header :40) — new SSOT keys must live inside it; env files are gitignored so sync cannot clobber or recreate the deleted app keys | Row 1+ puts new keys in the preserved section and updates the env samples in the same change |
| Turbopack/next.config reads values before project code | Verified: app `.env` loads BEFORE next.config eval (next 16.2.2 config.js:1182); root `.env` loads after (instrumentation) | `CO_NEWBIZ_DIST_DIR` stays spawn-env/app-file only (documented, not in the SSOT set); `CO_NEWBIZ_ALLOWED_DEV_ORIGINS` already has its root-reader at config eval |
| Scheduler/CLI runners start importing agent modes from root | INFERRED benign change: job-worker/schedule-tick/run-job gain `CO_NEWBIZ_*_AGENTS` from root where they previously defaulted to `deterministic` unless spawned with the var | Values match what the server uses; covered by extending `root-env.test.ts` loader-walk cases |
| `DATABASE_URL` is an absolute path today (app `.env:5`) | Prisma tooling breaks if the checkout moves | Out of scope (kept as-is, value-neutral); follow-up §8.2 can make prisma.config.ts fall back to root, where the operator may express the path portably |
| Boot warn noise if an operator keeps a legitimate spawn-env override that differs from root | A spawn/prod override that intentionally differs would warn on every boot | The warning names the mechanism ("spawn env or app auto-load"), so prod (env_file) operators can recognize intentional overrides; values never printed |
| Same-value duplicates slip back in and rot | The guard catches them as warnings, not failures | Acceptable: identical duplicates are behavior-neutral; the warning keeps them from becoming divergent unnoticed |

## 5. Accessibility

No user-facing interaction surface changes — this is configuration-file and console-output work;
the design-lint/UI surface is untouched. Operator-facing output (boot warn, env-check messages) is
plain text in plain language, states the problem and the remedy in the message itself, and never
relies on color alone to convey severity. Exemption from the WCAG screen checklist is stated here
per docs/context.md.

## 6. Alternatives considered

1. **Flip precedence (root overrides app remnants)** — rejected: breaks the no-override discipline
   protecting spawn/prod env, needs origin tracking to distinguish spawn env from auto-load, and is
   moot once duplicates are deleted (DEC-20261113-01 alternatives item 1).
2. **Delete `app/web-next/.env` entirely** by making `prisma.config.ts` walk to root — the cleaner
   end-state, but a Prisma-tooling code change needing validation; recorded as follow-up, not this
   batch.
3. **Symlink the app file to root** — rejected: force-feeds all root keys (adapter credentials
   included) into Next auto-load, obscures channels, breaks if either file moves.
4. **Document the split, change nothing** — rejected: the user asked for unification; the two-file
   duplication is the demonstrated drift mechanism.
5. **Centralize in spawn env only (shell profile)** — rejected: machine-specific, invisible to
   env-check, violates the ADR-0075 premise that environment readiness must be checkable.

## 7. Acceptance criteria

1. After migration, `app/web-next/.env` contains exactly one active key (`DATABASE_URL`) and no key
   is defined in both files.
2. `bun scripts/co-newbiz/env-check.ts` passes on the migrated machine; on a fixture with a
   divergent duplicate it exits 1 naming the key and both files; on an identical duplicate it
   exits 0 with a warning; on trailing-whitespace values it warns.
3. With the app file emptied of runtime keys, a dev server boot resolves the LLM block, agent
   modes, `CO_NEWBIZ_DB_PATH`, `BRAVE_SEARCH_API_KEY`, and the web-search flags from the root
   `.env` alone (loader-walk unit cases + one manual boot probe).
4. The boot shadow warning fires when a divergent shadow exists and stays silent when values match
   (unit-tested via console.warn spy).
5. `bun run db:migrate`, `db:status`, and `app/web-next` `prisma:pull` still succeed after the
   migration (DATABASE_URL path intact; db/client.ts unchanged).
6. Unit suites green: `root-env`, `env-keys`, `prisma-env-loader`, the new `env-drift`.
7. Behavior is value-neutral: the effective configuration (provider, model, search providers, agent
   modes, DB path) is identical before and after, modulo the stripped trailing spaces that no
   reader ever propagated.
8. `.env.prod`, `docker compose` boot, and the MCP client env contract (`CO_NEWBIZ_API_*`) are
   unchanged.

## 8. Follow-ups (registered, not this batch)

1. **env-check LLM probe provider-awareness** — the probe speaks Anthropic `/v1/messages`
   (`env-check.ts:101-104`) while the provider may be openai-compatible; a probe that always 404s
   the wrong endpoint undermines ADR-0075's "never conclude without evidence" for non-Anthropic
   providers.
2. **`prisma.config.ts` root fallback** — extend the loader (:12-19) to walk up to the root `.env`
   when the app file lacks `DATABASE_URL`, then delete `app/web-next/.env` entirely and update this
   design's §3.3.
3. **`CO_NEWBIZ_COMMITTEE_AGENTS` sample-doc residue** — already cleaned in samples (PR #845); the
   live root `.env:120` line is removed by §3.5's migration.

## 9. KNOWN / INFERRED / ASSUMED / UNKNOWN

- **KNOWN** (verified today, file:line): all anchors in §2; dotenv 16.3.1 trims; Next 16.2.2 loads
  the app `.env` before next.config eval; no PrismaClient runtime usage; `CO_NEWBIZ_COMMITTEE_AGENTS`
  removed by ADR-0196 amendment (no consumer); env files gitignored; `env-check.ts` reads only the
  root file; `prisma.config.ts` reads only the app file.
- **INFERRED**: the trailing spaces are behavior-neutral today (every reader trims — derived from
  §2.3); scheduler runners will start importing agent modes from root after the allowlist widening
  (§3.2 note); same-value duplicates are behavior-neutral (identical strings through the same
  parsers).
- **ASSUMED**: `.env.prod` on this machine does not carry the app-file runtime keys (PM states the
  compose env_file is a separate channel; the compose file contents were not re-read for this
  design).
- **UNKNOWN**: whether any operator workflow outside the repo (cron entries, launchd, shell
  profiles) exports these keys with values that would shadow the root file — must be checked at
  Row 1 before editing the files; whether any untracked local `.env.<env>.local` files exist in
  `app/web-next` (the Next load order §2.2 item 1 would honor them above `.env`).
