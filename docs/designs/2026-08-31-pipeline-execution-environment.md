# Design: Pipeline Execution Environment (2026-08-31)

**Status**: Implemented (ADR-0075)
**Scope**: co-newbiz S1–S7 pipeline runs, any shell/subagent calling KOSIS/DART/K-LAW/CO_NEWBIZ APIs
**Procedure of record**: `memory/pipeline-s1-s7-execution-procedure.md` (§4)
**Origin**: `deliverables/samsung-robotics-rainbow/governance/00-governance-summary.md` Appendix A

## 1. Problem

A fresh tool shell starts with an empty project environment. Two coupled defects
caused every external-API stage of the 2026-08-31 pipeline check to misreport
"API key missing":

- **Shell impermanence**: `device_bash` (and each dispatched subagent) is a new
  process per call. Nothing sourced in a previous call survives.
- **CRLF contamination**: this project's `.env` has Windows line endings. Naive
  sourcing appends `\r` to every value; the corrupted key authenticates as
  garbage and the API fails without a distinguishing message.

A third defect amplified the first two: the "key missing" subagent report was
accepted without reproducible evidence, producing false data-confidence
downgrades in S1/S5/S6 deliverables.

## 2. Design

### 2.1 Canonical load preamble (the only sanctioned loading path)

```bash
set -a; source <(tr -d '\r' < .env); set +a
```

Rules:

- Executed **inside the same shell invocation** that performs the API call.
- Repeated for every such invocation — no caching, no assumptions.
- Stated verbatim in any dispatch prompt that tasks a subagent with API work.
- Direct `source .env` is prohibited in all workspace procedures and skills.

### 2.2 Evidence probe before any "key missing" conclusion

Before an agent records an environment/credential limitation:

1. Run a minimal authenticated request with `curl -sS -o /dev/null -w '%{http_code}'`.
2. Record the command and HTTP status in the deliverable's limitation note.
3. Only a verified failure may lower data confidence or set a RAG limitation.

### 2.3 Pre-flight tooling

`scripts/co-newbiz/env-check.ts` (registry: `scripts/SCRIPTS.md`):

- `bun scripts/co-newbiz/env-check.ts` — verifies `.env` exists, reports CRLF
  state, confirms required keys are present (names only, values never printed),
  exits non-zero with remediation text on failure.
- `--exports` — prints shell-safe `export KEY=...` lines (CRLF-stripped) for
  environments without process substitution: `eval "$(bun scripts/co-newbiz/env-check.ts --exports)"`.

### 2.4 Skill integration

`k-dart`, `k-law`, `k-kosis` step 1 (Verify Prerequisites) references the
preamble and the probe. A skill may now never conclude "credential absent"
without the probe output.

### 2.5 Env value parsing (inline comments)

Three of this repo's four `.env` readers parse values themselves, and all three
disagree with the dotenv-compatible parser that Next.js — the surface operators
actually use — runs as the server (`app/web-next/node_modules/@next/env/dist/index.js`,
dotenv 16.3.1: unquoted values are `[^#\r\n]+`, followed by `\s*(?:#.*)?`):

| Reader | Parse (pre-change line cites) | Inline `# comment` after a value |
|---|---|---|
| Next.js server (`app/web-next/.env`) | dotenv 16.3.1 | stripped |
| `scripts/lib/env-keys.ts:31-34` (pre-change) | `/^([A-Z_]+)=(.*)$/`, then `m[2].trim().replace(/^["']\|["']$/g, "")` | NOT stripped |
| `app/web-next/lib/root-env.ts:50-54` (pre-change) | `/^([A-Z_0-9]+)=(.*)$/`, same trim/replace | NOT stripped |
| `app/web-next/prisma.config.ts:10-17` (pre-change) | `/^([A-Z_]+)="?([^"\n]*)"?$/`, no trim | NOT stripped |

Measured 2026-11-04: with
`CO_NEWBIZ_LLM_PROVIDER=custom  # openai-compatible | anthropic | gemini | custom | none`
on disk, `loadRootEnvPipelineKeys()` set a 64-character value while the dotenv
path set `custom`. This is a wrong value, not noise: `llm.ts:59-60` compares the
string only against emptiness and `"none"`, so the 64-character form entered
`getProviderConfig()` as a configured provider whose name matches no branch —
`isLlmConfigured()` true, dispatch silently inert. The env files were corrected
to drop the inline comment, so today's breakage is gone; the parser divergence
is not, and it recurs on the next operator who annotates a line.

**Decision — one shared parser.** `scripts/lib/env-value.ts` exports
`parseEnvValue(raw: string, keyName?: string): string`; `scripts/lib/env-keys.ts:35`,
`app/web-next/lib/root-env.ts:53`, and `app/web-next/prisma.config.ts:17` call it
in place of their own value handling (the Prisma
loader carries the same defect, and its `"?…"?` wrapper cannot express a quoted
value at all). Cross-directory import is an established pattern, not new
coupling — `app/web-next/lib/safe-fetch-text.ts:17` already imports
`scripts/lib/ssrf.ts`, and `root-env.ts:15` already imports
`scripts/co-newbiz/source-adapters.ts`. `scripts/SCRIPTS.md` gains a sibling
`lib/env-value.ts` row per the `lib/env-keys.ts` precedent.

**Semantics — mirror dotenv, because Next is the consumer operators see.**

- Trim `raw`. If it starts with `"`, `'`, or a backtick, return the content up
  to the matching closing quote: a `#` inside quotes is literal. No closing
  quote returns the remainder verbatim — dotenv's regex fails to match such a
  line at all, and a best-effort loader should echo the operator's text rather
  than throw.
- Otherwise cut at the first `#` and trim. dotenv's unquoted alternative stops
  at *any* `#`, whitespace-preceded or not, so `K=a#b` is `a` there too. The
  rule is copied, deliberately, not invented.
- **Corollary and its cost**: a value that must contain a literal `#` has to be
  quoted (`KOSIS_API_KEY="abc#def"`). Stated so no one rediscovers it as a bug;
  the alternative — a third parsing rule on top of dotenv's — is the defect
  being closed.
- **Truncation warns, it does not happen silently**: when the unquoted branch
  cuts a value at a `#`, `parseEnvValue(raw, keyName)` emits one `console.warn`
  naming the key and saying the value was truncated (never the value itself),
  because a silent value mismatch is the exact failure class this change closes
  — and `NOTIFY_SMTP_PASS` is the key family where a literal `#` in a password
  is plausible.

**Row 1 closure — key charset `[A-Z_0-9]+` (DEC-20261104-04).** The deferred
key-charset defect is closed under this spec by PM gate ruling 2026-11-04;
implementation (Row 1) is a separate dispatch:

- Line match: `scripts/lib/env-keys.ts:33` (pre-change) `/^([A-Z_]+)=(.*)$/`
  → `/^([A-Z_0-9]+)=(.*)$/`, matching the other two readers —
  `app/web-next/lib/root-env.ts` and `app/web-next/prisma.config.ts:16`
  (already `[A-Z_0-9]+`, untouched).
- Family sub-patterns widen to `[A-Z_0-9]+` in the same change, because a
  line-regex-only fix has zero observable behaviour — the allowlist would
  still reject every digit key, so no fails-before/passes-after test could
  exist: `PIPELINE_ENV_KEYS` `CO_NEWBIZ_LLM_[A-Z_]+` →
  `CO_NEWBIZ_LLM_[A-Z_0-9]+` (env-keys.ts, pre-change `:17-18`); `LLM_KEY`
  likewise (root-env.ts, pre-change `:19`); `NOTIFY_KEY`
  `/^NOTIFY_[A-Z_]+$/` → `/^NOTIFY_[A-Z_0-9]+$/` (root-env.ts, pre-change
  `:24`) — the prefix rule's stated purpose is that channel names grow, so a
  digit-suffixed channel name must not be a silent trap.
- Named adapter credentials in `PIPELINE_ENV_KEYS` (DART/ECOS/KRX/KOSIS/
  DATA_GO_KR/LAW_OC/TAVILY) stay exact-name.
- Security framing: the widening stays inside families that are already
  prefix-wildcarded (`CO_NEWBIZ_LLM_*`, `NOTIFY_*`); no new family is
  admitted; no live key on disk has digits (0 digit-bearing key lines in
  `.env`, `.env.prod`, `app/web-next/.env`, grep-verified 2026-11-04).

**Deliberately out of scope** (so a later reader does not assume support):
dotenv also takes lowercase and dotted keys, none of which exist on disk;
`export ` prefixes, `key: value` colon form, YAML containers/anchors, and
multiline values are not supported (0 occurrences of each in `.env`,
`.env.prod`, `app/web-next/.env`).

## 3. Non-goals

- Normalizing `.env` to LF in the repository (platform-dependent; the fault
  class is neutralized at load time instead).
- Secret management beyond `.env` (vault/SSO is out of scope).
- Resolving the missing `bun` runtime — a pre-existing workspace prerequisite
  tracked separately.

## 4. Verification

- Run `env-check.ts` in a fresh shell: passes with keys present, fails with an
  actionable message when a key is removed or `\r` contamination is simulated.
- A dispatch-prompt audit of future pipeline runs must show the preamble in
  every subagent API task.
- `parseEnvValue()` (§2.5) is verified by three cases per loader — `K=abc  # note`
  → `abc`, `K="abc#def"` → `abc#def`, and an uncommented value unchanged — across
  **three loaders**: `tests/unit/root-env.test.ts`,
  `tests/unit/env-keys.test.ts` (driving the same three through
  `loadPipelineKeys()` — no test existed for that module before), and
  `tests/unit/prisma-env-loader.test.ts` (the Prisma config's loop, replicated
  with a source-drift guard). The 2026-11-04 divergence must fail before the
  change and pass after.
- Row 1 (DEC-20261104-04): a digit-bearing family key loads through each
  loader — `CO_NEWBIZ_LLM_MODEL_V2` via root-env and env-keys;
  `NOTIFY_WEBHOOK_URL_OPS_2` admitted by root-env's NOTIFY rule — while a
  non-family digit key (`FOO_2_API_KEY`) stays rejected, and the existing
  suite stays green. The digit-key cases must fail before the charset change
  and pass after.
