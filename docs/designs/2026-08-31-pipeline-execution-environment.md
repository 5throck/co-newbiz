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
