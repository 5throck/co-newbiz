# ADR-0075: Pipeline execution environment discipline — per-shell secret loading, CRLF normalization, and evidence-based failure verification

**Status**: Accepted (2026-08-31)
**Deciders**: pm, process-governance-manager (proposal), platform-lead (execution plane)
**Design of record**: `docs/designs/2026-08-31-pipeline-execution-environment.md`,
`memory/pipeline-s1-s7-execution-procedure.md` (§4)
**First observed**: `deliverables/samsung-robotics-rainbow/governance/00-governance-summary.md` §2.2 #4 and Appendix A

## Context

During the 2026-08-31 S1–S7 pipeline process-check run
(`samsung-robotics-rainbow`), every stage that called an external API
(KOSIS, DART, K-LAW) initially reported "API key not set". That report was a
**misdiagnosis**:

1. Each tool-shell invocation (`device_bash` and equivalent subagent shells) starts a
   **fresh process environment** — nothing sourced earlier persists across calls, and
   subagents inherit nothing from the dispatcher's shell.
2. The project `.env` uses **CRLF line endings** (Windows checkout). A naive
   `source .env` embeds a trailing `\r` in every value, so requests authenticate
   with a corrupted key and fail with no distinguishing error.
3. The "key missing" conclusion was accepted from a subagent report without
   reproducible evidence. When re-verified with an explicit `curl` and the HTTP
   status code, all four keys (`DART_API_KEY`, `LAW_API_OC`, `KOSIS_API_KEY`,
   `CO_NEWBIZ_API_TOKEN`) were present and returned HTTP 200.

The consequence was material: S1/S5/S6 downgraded their data-confidence and
recorded limitations that did not exist, and remediation effort was misdirected
at credential provisioning instead of shell hygiene.

The only genuine infrastructure gap confirmed by the same run was the absence of
the `bun` runtime, which blocks `procedures/_validate.ts` automatic validation —
a separate, pre-existing prerequisite.

Alternatives considered: (a) convert `.env` to LF and commit it — rejected, the
checkout platform controls line endings and any future CRLF re-materialization
would silently reintroduce the fault; (b) require agents to export secrets into
each command line — rejected, leaks values into shell history and process lists;
(c) treat this as a one-off session note — rejected, the same failure mode will
recur in every future fresh-shell run until it is encoded in procedure, skill,
and tooling.

## Decision

1. **Per-shell loading is mandatory.** Any shell or subagent that calls an
   external API must load project secrets in that same invocation:
   `set -a; source <(tr -d '\r' < .env); set +a`. Dispatch prompts to subagents
   must state this explicitly; a dispatcher never assumes the subagent's
   environment.
2. **CRLF normalization is part of loading.** `.env` is always read through
   `tr -d '\r'` regardless of its current on-disk state. No workflow may source
   `.env` directly.
3. **Evidence-based failure verification.** An "API key missing/unset" report
   from any agent or subagent is provisional until re-verified with a
   reproducible probe (curl command + HTTP status code). Analyses must not
   downgrade data confidence or record access limitations on unverified
   environment claims.
4. **Tooling enforcement.** A project-local check script
   (`scripts/co-newbiz/env-check.ts`, registered in `scripts/SCRIPTS.md`)
   verifies required keys exist and CRLF contamination is absent, and can emit
   shell-safe `export` lines for `eval`-based loading in contexts where process
   substitution is unavailable.
5. **Skills encode the procedure.** `k-dart`, `k-law`, and `k-kosis` step 1
   (Verify Prerequisites) must direct the executor through the per-shell
   normalized load and the evidence probe before declaring a key absent.

## Consequences

- Positive: eliminates the recurring silent-failure class; subagent
  environment misreports become detectable in one probe; data-confidence
  downgrades regain their meaning (they now only record real access limits).
- Positive: `bun run co-newbiz/env-check` gives a pre-flight gate any run can
  execute before stage S1.
- Cost: every API-calling command carries the load preamble (minor token/latency
  overhead); `.env` CRLF remains intentionally unnormalized on disk.
- Follow-up: `bun` runtime provisioning remains an open workspace prerequisite
  (pre-existing; not introduced or resolved by this ADR).
