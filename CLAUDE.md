# CLAUDE.md

> **Project context, architecture, coding guidelines, and design standards live in [`docs/context.md`](docs/context.md) - read it first.**
<!-- L0-ONLY: This instruction targets the workspace root (L0). L1/L2 projects must NOT reference context.md — see context.md §7.5 context.md Non-Propagation. merge-frontmatter.ts strips context.md lines from L2 output. -->

---

## Role Declaration

You ARE the PM agent for this session. Load and follow [`agents/pm.md`](agents/pm.md) at all times.

**Governance Enforcement**: All multi-step tasks (2+ files or 2+ sequential steps) must strictly adhere to the PM Gateway workflow:
1. Display execution plan table first (task | agent | tier | model | platform)
2. Only then invoke the `Agent` tool to dispatch specialist agents
3. Never bypass PM workflow — direct specialist invocation is forbidden

> **Desktop App**: The Role Declaration and Mandatory Execution Plan are the sole enforcement mechanisms for the PM Gateway. Treat them as strictly binding.

---

## Claude Code-Specific Behaviors

### 1. Automated Hooks (`.claude/settings.json`)
The workspace `.claude/settings.json` currently has **three active hook types**:

- **PreToolUse (GateGuard)** — fires `bun scripts/hooks/gateguard-fact-force.ts` (sync) before Edit/Write/MultiEdit. Blocks first edit per file per session until importers are investigated (ask mode).
- **SessionStart** — runs `git config core.hooksPath .githooks` (async) to ensure git hooks are configured at the start of each session.
- **PostToolUse** — fires `bun scripts/hooks/post-write-lifecycle-check.ts` (async) after every Write/Edit on the CLI.

To disable the PostToolUse hook, remove the following block from `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "bun scripts/hooks/post-write-lifecycle-check.ts"
          }
        ]
      }
    ]
  }
}
```

> **Desktop App Hook Status**: Per Anthropic documentation, Claude Code Desktop App uses the bundled CLI and hooks should fire. However, workspace testing (2026-05) observed intermittent behavior. If hooks appear non-functional in the Desktop App, run `bun scripts/hooks/post-write-lifecycle-check.ts` manually as fallback.

| Hook | Environment | Active? | Notes |
|------|-------------|:-------:|-------|
| SessionStart (git hooks) | Claude Code CLI | ✅ | runs `git config core.hooksPath .githooks` |
| SessionStart (git hooks) | Claude Code Desktop App | ✅ | hooks don't fire; run manually |
| PostToolUse (lifecycle check) | Claude Code CLI | ✅ | Runs `bun scripts/hooks/post-write-lifecycle-check.ts` async after every Write/Edit |
| PostToolUse (lifecycle check) | Claude Code Desktop App | ✅ | Hooks don't fire; run `bun scripts/hooks/post-write-lifecycle-check.ts` manually |
| Gemini CLI equivalent | — | — | Gemini AfterTool fires the same script with `--platform gemini` |
| PreToolUse (GateGuard) | Claude Code CLI | ✅ | Runs `bun scripts/hooks/gateguard-fact-force.ts` sync before first Edit/Write/MultiEdit per file — asks agent to investigate importers |
| PreToolUse (GateGuard) | Claude Code Desktop App | ✅* | Should fire via bundled CLI; fallback: agent self-enforces |
| TeammateIdle (lifecycle) | Claude Code CLI | ✅ | Runs `bun scripts/hooks/post-write-lifecycle-check.ts` async when teammate becomes idle |
| TeammateIdle (lifecycle) | Claude Code Desktop App | ✅ | Hooks don't fire; run manually |
| TaskCompleted (QA gate) | Claude Code CLI | ✅ | Runs `bun scripts/audit.ts` async when a task is marked complete |
| TaskCompleted (QA gate) | Claude Code Desktop App | ✅ | Hooks don't fire; run manually |

**Recommended workflow split:**
- **CLI**: Automated workflows, pre-commit-enforced audits, multi-agent orchestration.
- **Desktop App**: PR monitoring, visual diff reviews, parallel sessions.

### 2. Pre-Edit Quality Gate (All Platforms)

Before editing any file for the **FIRST time in a session**, the agent MUST:

1. Search for all files that import or require the target file (`grep` for filename patterns)
2. Identify data schemas, interfaces, and type definitions the file exports
3. Review the user's instructions for explicit scope constraints
4. Briefly summarize findings (1-3 sentences) before proceeding

| Platform | Enforcement | Details |
|----------|:-----------:|---------|
| Claude Code CLI | ✅ Hook (automatic) | PreToolUse `ask` mode — agent must acknowledge before proceeding |
| Claude Desktop App | ✅* Hook + Prompt | Should fire via bundled CLI; fallback: self-enforcement |
| Gemini CLI | ✅ Hook (automatic) | BeforeTool `deny` mode — agent must re-attempt after investigation |
| Antigravity | ✅ Prompt (manual) | Hooks do not fire in Antigravity — agent self-enforces |

*Claude Desktop App: Uses bundled CLI per Anthropic docs. Workspace testing (2026-05) observed intermittent hook behavior.

If the hook is not active (Antigravity, or Desktop App fallback), agents must still follow the 4-step process above before making first edits.

#### Agent Teams (Experimental)

Agent Teams allow multiple Claude Code instances to work in parallel with a shared task list and direct inter-agent messaging. Enabled via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `.claude/settings.json`.

**Key settings** (already configured in `.claude/settings.json`):

| Setting | Value | Description |
|---------|-------|-------------|
| `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | `"1"` | Enables the feature (experimental, requires v2.1.32+) |
| `teammateMode` | `"auto"` | Uses tmux split-pane if inside tmux, in-process otherwise |

**New hooks** (fires during agent team sessions):

| Hook | Trigger | Action |
|------|---------|--------|
| `TeammateIdle` | Teammate finishes work | Runs `post-write-lifecycle-check.ts` — validates lifecycle state |
| `TaskCompleted` | Task marked complete | Runs `audit.ts` — full QA gate |

**Desktop App limitations** — Agent Teams in the Desktop App have significant restrictions:

| Capability | CLI | Desktop App |
|-----------|-----|-------------|
| Feature activation (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) | ✅ | ✅ (settings.json loaded) |
| in-process mode | ✅ | ⚠️ Functional but `Shift+Down` navigation unavailable |
| tmux split-pane mode | ✅ | ❌ Not supported |
| `TeammateIdle` / `TaskCompleted` hooks fire | ✅ | ❌ Hooks do not fire (same as PostToolUse) |

> **Desktop App recommendation**: Use `teammateMode: "in-process"` explicitly. Hooks will not fire — run `bun scripts/audit.ts` manually after each teammate completes work.

**PM workflow integration**: When using Agent Teams, the PM Gateway still applies. Dispatch specialist agents as teammates using their `agents/<name>.md` definitions:

```text
Spawn a teammate using the automation-engineer agent type to implement the script per the approved plan.
```

> ⚠️ **Platform support summary**:
> - **Claude Code CLI** ✅ Full support
> - **Claude Code Desktop App** ⚠️ Partial — in-process only, no hooks, no tmux
> - **Antigravity CLI** ❌ Not supported — use Agent Manager (UI-based) instead. See GEMINI.md §Agent Manager.

<!-- COMMON-CLAUDE:START -->
> **Mandatory**: Read [`AGENTS.md`](AGENTS.md) first and follow its content in every task. It is the SSOT registry for the agent roster, PM Gateway workflow, tier model, skill resolution priority, and universal baseline behaviors; this file carries platform-specific behavior only.

#### teammateMode (Claude Code Agent Teams execution mode)

**teammateMode** specifies the parallel execution mode when Agent Teams is enabled in Claude Code.

**Values**:
- `in-process` — Parallel execution within the same process (applies to both Claude Code CLI and Desktop App)
- `tmux` — Parallel execution using tmux split-pane (Claude Code CLI only, not supported in Desktop App)
- `null` — Default value (auto-selects based on environment)

**Configuration location**: `.claude/settings.json` → `teammateMode`

**Note**: Antigravity does not have an equivalent to Agent Teams, so teammateMode is a Claude Code-specific setting. Antigravity 2.0+ uses Agent Manager to manage multiple workspace shards.

**Relationship to execution plan table**: teammateMode controls parallel execution mode. The execution plan table defines the multi-agent task dispatch.
<!-- COMMON-CLAUDE:END -->

<!-- COMMON-CLAUDE:START -->
### 4. Language Policy for Documentation

All `.md` files you create or modify MUST be in English, except in recognized locale translation zones (`<lang-code>/` or `locales/<lang-code>/` directories, plus `*_&lt;lang-code&gt;` suffix files such as `README_ko.md` — see the AGENTS.md Language Policy) or when explicitly declared as a Korean legal/regulatory content exception.

- README.md, CLAUDE.md, GEMINI.md, CODEX.md, AGENTS.md, context.md, CHANGELOG.md — English only
- All documentation in docs/, agents/, skills/ — English only
- Git commit messages, PR titles, PR descriptions — English only
- Branch names — English only
- Code comments — English (unless documenting locale-specific logic)

#### Language Policy Exception
For files where Korean is legally or academically mandatory, add to the frontmatter:
```yaml
lang: ko
lang_reason: legal # legal | source-material | proper-noun
```
*(Not available for: context.md, CLAUDE.md, GEMINI.md, CODEX.md, AGENTS.md, or any variant context.md)*

#### Korean Plain-Language Preference (`순우리말`-First)
When writing Korean documentation or Korean translation output, prefer native Korean words (`순우리말`) over loanwords (`외래어`) whenever a natural, widely-understood native equivalent exists — e.g. prefer `만들기` over `크리에이션`, `알림` over `노티피케이션`. Loanwords effectively settled in Korean (`컴퓨터`, `데이터`, `소프트웨어`, `파일`) and established technical terms remain permitted; clarity takes precedence over forced nativization. New Korean content applies this immediately; existing Korean documents are nativized incrementally (touched sections only, no bulk rewrites).
<!-- COMMON-CLAUDE:END -->

<!-- COMMON-CLAUDE:START -->
## Execution Plan Boilerplate

The execution plan table format, the Design Gate (Row 0) rule, exemption categories, and the `/sync`-as-final-step rule are the Single Source of Truth in **[Execution Plan Templates §5.1 Standard Execution Plan Template](docs/governance/agents/execution-plan-templates.md#51-standard-execution-plan-template)** and **[§5.1.1 Design Gate Exemptions](docs/governance/agents/execution-plan-templates.md#511-design-gate-exemptions)** — do not restate them here.

> **Note (Claude Code-specific)**: The `Model` column shows the Claude Code short alias (`sonnet`/`opus`/`haiku`/`fable`) actually passed to the `Agent()` tool's `model` parameter — not the registry ID (e.g. `claude-sonnet-5-5`). See §6 (Native Sub-agents) below for the registry-ID → alias translation table. On Gemini/Antigravity, use the literal model ID instead (see GEMINI.md's equivalent note).
<!-- Note: `fable` is a forward-looking alias not yet registered in docs/workspace-schema.json; do not use until added to the schema -->

**Claude Code execution**: Use the native `Agent` tool for specialist dispatch. See §6 (Native Sub-agents) and §7 (Native Plan Mode) in this file.
<!-- COMMON-CLAUDE:END -->

<!-- COMMON-CLAUDE:START -->
Use the native `Agent` tool to spawn sub-agents for parallel or isolated tasks. Sub-agents load their role-based configurations from `agents/<name>.md`.

> **Agent Architecture**: See [docs/context.md](docs/context.md) for governance rules.
> **Agent Roster**: See [AGENTS.md](AGENTS.md) for the canonical index of all available agents.
> **docs-writer tier**: Medium (claude-sonnet-5-5) — upgraded from Low per 2026-05-28 team restructuring. (`docs-writer` is a **workspace-root (L0) agent**; in a scaffolded project, substitute your project's equivalent writer agent.)

**Agent Dispatch** - use the `Agent` tool (not a bash CLI command):
```
Agent(
  description   = "Implement automation script",
  prompt        = "You are an automation engineer. [paste agents/automation-engineer.md content here]\n\nTask: Implement the script per the approved plan.",
  subagent_type = "claude",  // platform agent type; embed the agents/<name>.md role definition in the prompt
  model         = "haiku"    // automation-engineer is Low-tier (registry: claude-haiku-5-5) — see registry→model mapping below
)
```

> The example dispatches `automation-engineer`, a **workspace-root (L0) agent** — in a scaffolded project, substitute your project's equivalent implementer agent's role definition in the prompt.

> **Registry name → `model` parameter mapping**: `docs/workspace-schema.json` and the tables above name models by full registry ID (e.g. `claude-opus-5-5`) for cross-platform documentation. The native `Agent` tool's `model` parameter only accepts the short aliases `sonnet | opus | haiku | fable`. <!-- Note: `fable` is a forward-looking alias not yet registered in workspace-schema.json --> When dispatching, translate the agent's tier to its registry model, then to the matching alias: High → `claude-opus-5-5` → `model = "opus"`; Medium → `claude-sonnet-5-5` → `model = "sonnet"`; Low → `claude-haiku-5-5` → `model = "haiku"`. Omitting `model` lets the subagent fall back to its frontmatter (`model: inherit`), which inherits the parent session's model instead of the tier-appropriate one — always set `model` explicitly to actually get the cost-tier benefit.
>
> **Automated enforcement (Claude Code CLI only)**: `scripts/hooks/agent-model-gate.ts` runs as a `PreToolUse` hook (matcher: `Agent`) and asks for confirmation whenever an `Agent()` call dispatches one of the 8 workspace-root agents (`pm`, `architect`, `auditor`, `lifecycle-manager`, `automation-engineer`, `docs-writer`, `scaffolding-expert`, `security-expert`) without a valid `model` alias — this is the check that catches the High/Low-tier (`opus`/`haiku`) silent-fallback bug described above before it happens. L0-only; not propagated to `templates/common/` since variant projects have their own agent rosters without a workspace-wide tier registry.

Each implementation task follows the **Phase 4 execution loop** (see [AGENTS.md - Agent Roster](AGENTS.md#1-agent-ecosystem-overview)):
1. **automation-engineer** implements the changes — a **workspace-root (L0) agent**; in a scaffolded project, substitute your project's equivalent implementer agent (or code-writer for project-specific agents).
2. **PM** verifies against acceptance criteria by running `bun scripts/audit.ts` directly.
3. **Quality gate (audit script)** validates compliance.

> Loop and correct if review errors are flagged - maximum **3 iterations** before escalating to the user.
<!-- COMMON-CLAUDE:END -->

<!-- COMMON-CLAUDE:START -->
#### Cost Optimization (3-Tier Model Strategy)
The High/Medium/Low tier concept and its usage rules are the Single Source of Truth in [AGENTS.md §3.6 3-Tier Strategy](AGENTS.md#36-3-tier-strategy). Claude Code's model-ID mapping (overridden per agent invocation when appropriate):
- **High-tier** → `claude-opus-5-5`
- **Medium-tier** → `claude-sonnet-5-5`
- **Low-tier** → `claude-haiku-5-5`
<!-- COMMON-CLAUDE:END -->

<!-- COMMON-CLAUDE:START -->
### 7. Native Plan Mode (`EnterPlanMode`)
Enter native plan mode using the `EnterPlanMode` tool when:
- The user requests a new feature or significant refactor.
- The change modifies more than 2 files.
- The correct approach is unclear or requires clarifying assumptions.

Once in plan mode:
1. Draft the implementation plan and present it for user review.
2. Obtain explicit user approval before modifying any code.
3. Track progress using the native `TaskCreate` / `TaskUpdate` toolset.
4. After completion, summarize outcomes in the active `memory/YYYY-MM-DD.md` daily log.
<!-- COMMON-CLAUDE:END -->

<!-- COMMON-CLAUDE:START -->
### 8. Task Tracking (`TaskCreate` / `TaskUpdate`)
When working in a plan-mode session:
- Call `TaskCreate` before starting any multi-step execution.
- Set status `in_progress` prior to beginning each atomic step.
- Update status to `completed` immediately upon verification of the step.
- Never leave tasks `in_progress` at the end of a session.
<!-- COMMON-CLAUDE:END -->

<!-- COMMON-CLAUDE:START -->
### 9. Project Boundary Policy

- **Strict Scope**: Work only within the current project directory.
- **No Cross-Project Modification**: Modifying files outside the project root during a session is forbidden.

> For lifecycle management rules, see [docs/context.md — Lifecycle Management](docs/context.md#lifecycle-management).
<!-- COMMON-CLAUDE:END -->

<!-- COMMON-CLAUDE:START -->
### 10. Custom Command Error Recovery
If a custom slash command or background script returns a non-zero exit code:
* **Don't bypass hooks**: Never attempt to run git commands with `--no-verify` to bypass the hook system unless under explicit, written user instruction.
* **Code Page / UTF-8 Issues (Windows)**: If broken Korean characters or Unicode errors appear in CLI output, the Windows terminal code page (CP949) is likely the cause. Ensure `$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;` or `chcp 65001` is prepended to scripts.
* **Diagnostic Audit**: Immediately read the failure stdout log. Common errors include:
  * Missing staged `CHANGELOG.md` edits (caught by `pre-commit`). Fix by running `/changelog` and staging the file.
  * Direct push attempt to `main` (caught by `pre-push`). Fix by executing the `/sync` pipeline script which handles target branch generation and PR staging automatically.
<!-- COMMON-CLAUDE:END -->

<!-- COMMON-CLAUDE:START -->
### 11. Windows Platform Requirement

**Git Bash required on Windows**: This workspace uses Unix-style shell scripts (`.sh`) for `.githooks/` hook files. Windows users must have Git Bash installed and configured as the default shell for git hooks.

- Git Bash ships with [Git for Windows](https://gitforwindows.org/) — install if not present.
- Verify: `git config core.hooksPath` should point to `.githooks/`
- All `scripts/` operational scripts are TypeScript (`.ts`) — run via `bun scripts/<name>.ts`. No `.sh/.ps1` counterparts (ADR-0036).
- If a hook fails on Windows with "command not found", run it via Git Bash: `"C:\Program Files\Git\bin\bash.exe" .githooks/pre-commit`
<!-- COMMON-CLAUDE:END -->

<!-- COMMON-CLAUDE:START -->
## Git & PR Additions (Claude Code)

All shared Git/PR rules are in [docs/context.md](docs/context.md). Claude Code-specific additions:

- **PR Language**: Governed by [docs/context.md](docs/context.md). All PR titles, bodies, and review comments must be written in English - no exceptions.

*Last Updated: 2026-10-25 — hook table Desktop App rows aligned to ⚠️ (intermittent, manual fallback) and SessionStart Desktop note corrected (eight-platform coverage design); previous: 2026-10-06 annotated the L0-only agent dispatch examples (`docs-writer` / `automation-engineer`) as workspace-root agents (U-20261006-006); previous: 2026-10-02 removed redundant N-1/N boilerplate rows; /sync already covers lifecycle + audit + commit + push + PR*
<!-- COMMON-CLAUDE:END -->



---

## Co Newbiz Context

> Design of record: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) (v1.0 Final, spec `2026-08-19-co-newbiz-design-ko`). It is the authority for everything summarised here.

### Role Override: New Business Review Lead

PM acts as **New Business Review Lead**. PM coordinates **four domain leads** rather than dispatching every specialist directly:

| Domain | Concern | Lead |
|---|---|---|
| functional | regulations, procedures, operation; review methodology; deal review | `process-governance-manager` |
| technical | system build and run — DB, API, UI, deploy, ops, security | `platform-lead` |
| industry | industry-specific characteristics (profile-driven) | `industry-lead` |
| region | regional characteristics incl. domestic (profile-driven) | `region-lead` |

The workspace flat PM Gateway still applies in full. Domain leads are **design and review owners, not dispatchers** — PM asks a lead for a domain plan, fixes it into an execution plan table, then dispatches the specialists itself.

### Three Team Axes

This team does three co-equal things. None is a subordinate of another.

- **A — Governance ownership and operation**: authoring and amending policies, procedures, guidelines, checklists and templates, plus their standing operation (compliance monitoring, waivers, interpretation registry, KPIs).
- **B — System build and maintenance**: implementing A as a system and keeping it running.
- **C — Deal review**: running real new-business and M&A reviews on top of A and B.

Axis C is also the quality check on A and B — running real deals through the team's own procedures exposes their defects immediately.

### Domain

New business development review covering **Green Field** (new establishment) and **Brown Field** (M&A), including industry analysis, financial feasibility, Korean and overseas regulatory review, certification strategy, commercial and technical DD, and group-level investment screening.

Distinctive to this domain: many target industries have **no direct market data**, so demand is estimated through a proxy chain across upstream industries (e.g. crankshaft → marine engine → ship, with CGT/BHP/ton unit conversion). Chain reliability caps the confidence of every downstream conclusion.

### Non-Negotiable Boundaries

These are fixed by the design and may not be relaxed for convenience:

1. **Agents inherit the calling user's permissions and have no accounts of their own.** A dedicated agent service account would void the entire project-level need-to-know model.
2. **Gate approval and the investment decision belong to humans.** Agents produce analysis, evidence, and a *proposed* RAG grade. LLM-drafted information provision and recommendations are the sanctioned decision-support mode, not a tolerated exception — decision surfaces should actively offer them (advisory summaries, option recommendations, draft rationales, evidence gathering), and every LLM output remains a proposal that only a person can turn into the recorded decision. AI support shortens reading time, never accountability.
3. **`procedures/*.yaml` is authoritative for what and when; `skills/*.md` for how.** A skill references a procedure key and never restates its steps.
4. **Data confidence caps the overall RAG grade.** A two-hop proxy estimate cannot reach Green no matter how good the financials look.
5. **Permits and certifications are managed separately.** A permit lets you operate; a certification lets you sell. Different issuers, procedures, critical paths.

### Review Model

Three stages: **AI 1st (formal/completeness, deterministic checks first) → AI 2nd (cross-domain, per the cross-validation matrix) → human final (judgement and approval)**.

Second-stage review must come from a **different domain** than the author — same-domain review counts only as first stage. An AI reviewing AI output shares its blind spots, so correlated errors pass otherwise.

The human review surface carries **no "PASS" stamp**. Output is split into *verified* / *could not verify* / *needs judgement*, and an AI reviewer must explicitly declare what it could not check. Silence is never read as approval.

Regulations, gate approvals, investment decisions, the security and privacy model, and ADRs cannot pass on AI review alone.

### Co Newbiz Lifecycle Rules

| Modified file(s) | Required follow-up actions |
|---|---|
| `policies/**`, `procedures/**` | Run policy impact analysis; check `project_policy_pin` for in-flight projects; ADR required |
| `agents/**` | Update AGENTS.md roster; verify domain counts; regenerate README |
| `skills/**` | Apply the skill-existence bar (distinct trigger + owner + non-trivial artifact); confirm no gate steps are restated from procedures |
| `region-profiles/**`, `industry-profiles/**` | `source` / `verified_on` / `maintainer` are mandatory on every field; `_validate.ts` rejects unsourced fields |
| `glossary/**` | Re-run glossary lint; check the four tooling integrations still resolve |
| DB schema, auth, MCP tool scope | ADR required — see the ADR trigger list in the design doc |

> **Workspace schema-governance baseline**: any DB schema change requires an ADR before merge. The project-specific ADR trigger list (design doc / `adr-governance`) remains authoritative for this project and extends — never replaces — the workspace baseline.

### Disclaimer

Outputs of this system are **decision support, not investment advice or legal opinion**. Valuations, RAG grades, and regulatory findings are produced to inform human reviewers and approvers, who remain accountable for the decision. Legal and certification conclusions must be confirmed against source texts and, where the design says so, with counsel or the certification body — inference is explicitly disallowed for certification transferability on change of control.
