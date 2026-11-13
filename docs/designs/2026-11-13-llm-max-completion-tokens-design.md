---
title: LLM token-parameter fix — provider-aware max_completion_tokens via knob + api.openai.com heuristic + memoized in-band probe
date: 2026-11-13
status: Implemented (Design Gate ADR-0074 — Row 0 accepted per DEC-20261113-02; default-budget section amended by user decision 2026-11-13, see §3.5; §8.3 temperature follow-up implemented by user decision 2026-11-13, see §8.3)
owner: backend-engineer (design; PM dispatch per DEC-20261113-02)
reviewers_required: process-governance-manager (AI-2nd, functional domain — author is technical domain), owner (human approval)
decision_record: docs/decisions/DEC-20261113-02.md
related: ADR-0074 (Design Gate), ADR-0075 (env-check pre-flight), design 2026-11-13-env-single-source-design (root .env SSOT; §8.1 probe follow-up), design 2026-08-31-pipeline-execution-environment, ADR-0128 (agent run ledger), docs/standards/llm-interaction-standard.md §13.3 (programmatic LLM calls)
---

# LLM token-parameter fix — provider-aware `max_completion_tokens` via knob + api.openai.com heuristic + memoized in-band probe

## 1. Conclusion (the chosen mechanism)

The openai-compatible/custom branch of `buildRequest` stops sending a hard-coded `max_tokens`.
It instead resolves the output-cap **parameter name** through one resolver, evaluated in this
order:

```
1. CO_NEWBIZ_LLM_MAX_TOKENS_PARAM  (explicit knob: max_completion_tokens | max_tokens | auto)
2. auto + baseUrl host == api.openai.com          →  max_completion_tokens   (heuristic)
3. auto + any other host                          →  max_tokens              (compatibility default)
4. an HTTP 400 whose body matches the unsupported-parameter error signature
   → resend ONCE with max_completion_tokens at the ORIGINAL budget, and memoize
     the decision per provider|baseUrl|model for the process lifetime
```

The anthropic branch (`llm.ts:509`) and the gemini branch (`llm.ts:539`) do not change. The
default output budget is provider-aware (openai-compatible/custom **6000**, anthropic/gemini
**1500** — user decision of 2026-11-13 amending DEC-20261113-02 point 5, evidence in §3.5),
and the empty-response ×4 retry remains but the ×4 multiplier is now explicitly bound to
empty-response failures only, so a parameter-format 400 resends at the original budget rather
than silently inflating the cap.

Mental model: think of the parameter name as a **plug adapter**. Anthropic and Gemini sockets
already have the right plug. OpenAI's own socket changed shape (it now wants
`max_completion_tokens`), while most third-party OpenAI-compatible sockets still accept only the
old plug. The adapter rule is: known socket (api.openai.com) → new plug immediately; unknown
socket → old plug first, and if the socket rejects it *by telling us the new shape in its own
words* (the 400 signature), switch once and remember the answer for the life of the process. No
probe traffic is wasted on a socket we already recognize.

## 2. Problem and verified state (2026-11-13)

Every claim below was re-verified against the working tree; anchors are file:line.

### 2.1 The failure and the bug path

- Dev S1 re-analysis: all LLM calls fail with `LLM HTTP 400: Unsupported parameter: 'max_tokens'
  is not supported with this model. Use 'max_completion_tokens' instead.`
- Config (repo-root .env, SSOT per DEC-20261113-01): `CO_NEWBIZ_LLM_PROVIDER=openai-compatible`,
  `CO_NEWBIZ_LLM_BASE_URL` host `api.openai.com`, model `gpt-6.1-terra` (secret values not
  reproduced anywhere in this document).
- `app/web-next/lib/llm.ts` `buildRequest(cfg, spec)` (:494) has exactly three branches:
  - anthropic (:503–531): sends `max_tokens` (:509) — **correct** for the Anthropic Messages API.
  - gemini (:533–542): sends `generationConfig.maxOutputTokens` (:539) — **correct**.
  - openai-compatible/custom (:544–559): sends `max_tokens` (:548) — **the bug path**. The default
    budget is 1500 (:497).

### 2.2 The fix is provably centralized

- `buildRequest` is called from exactly two sites: `runProvider` (:139, JSON path) and the
  streaming fetch (:427). Both pass a `CallSpec`; neither builds a body elsewhere.
- Consumers across the repo only pass a `maxTokens` budget into `complete` / `completeDetailed` /
  `completeStructured` / `stream` — 20+ files (`dry-run.ts`, `llm-executors.ts`, `llm-json.ts`,
  `committee-llm.ts`, `agent-chains.ts`, `market-sizing-pipeline.ts`, …). A repository-wide grep
  for `max_tokens` outside `node_modules` finds request-body writers at exactly three places:
  `llm.ts:509` (anthropic, correct), `llm.ts:548` (the bug), and `scripts/co-newbiz/env-check.ts:141`
  (a probe — see §2.4). No caller hardcodes a request body.

### 2.3 Retry and error mechanics to preserve

- `runProvider` (:129–156) attempts twice. Attempt 1 multiplies the budget ×4
  (`(spec.maxTokens ?? 1500) * 4`, :135). This ×4 exists for reasoning models that return an
  EMPTY response after spending the budget on reasoning — the empty-response throw is :148
  (`"LLM returned an empty response (reasoning tokens may have exhausted max_tokens)."`, prose
  only). Today the ×4 applies to ANY first-attempt failure, including an HTTP 400.
- The streaming path (:423–434) does **not** go through `runProvider` — it is a single fetch with
  no in-function retry; errors propagate to callers that have their own batch/retry loops.
- `extractFinishReason` (:616–621) reads provider-reported `finish_reason` / `stop_reason`.
  `llm-json.ts:236` matches `/length|max_tokens/i` against it to classify truncation — this is a
  regex over the PROVIDER's reported value, not over our request parameter. OpenAI reports
  `finish_reason: "length"` when `max_completion_tokens` cuts output off, so the regex already
  covers the new world. **No change needed** (verified reading the consumer).
- `dry-run.ts` `DRY_RUN_MAX_TOKENS = 1500` (:33) feeds `CallSpec.maxTokens` (:111, :121, :357, :368,
  :653) — a name-only coincidence with the wire parameter. It is an internal budget knob; no change.

### 2.4 The second request-building site (out of scope, registered)

`scripts/co-newbiz/env-check.ts:138–141` — the ADR-0075 `--probe` LLM check — hardcodes the
Anthropic `/v1/messages` endpoint and `max_tokens: 8` **regardless of provider**. With today's dev
config it would probe the wrong endpoint with the wrong parameter anyway. This is the
"env-check LLM probe provider-awareness" follow-up already registered by
design 2026-11-13-env-single-source-design §8.1; this batch does not touch it, and the probe runs
only on explicit `--probe` (never in the pipeline hot path).

### 2.5 Which providers are configured in this workspace (hosts only, no values)

| Channel | Provider value | baseUrl host | Model | Effect of this design |
|---|---|---|---|---|
| Dev (repo-root .env) | `openai-compatible` | `api.openai.com` | `gpt-6.1-terra` | Heuristic fires on call 1 → `max_completion_tokens`, zero failed probes |
| Prod (.env.prod, compose env_file) | `anthropic` | z.ai anthropic-compatible endpoint | GLM family | **No change** — anthropic branch untouched; prod boot behavior value-neutral |
| Any future `openai-compatible` / `custom` on a third-party host (vLLM, Ollama, proxies, z.ai openai mode) | — | not api.openai.com | — | `max_tokens` first (unchanged behavior); one in-band probe fallback only if the endpoint itself demands the new name |

### 2.6 External evidence

The 400 error and the reasoning-budget semantics are documented provider behavior, not our
inference: OpenAI's newer models (GPT-5/o-series family) reject `max_tokens` in Chat Completions
and require `max_completion_tokens`; for reasoning models the ceiling counts reasoning tokens +
output tokens combined, so small caps produce empty or truncated content; and sampling parameters
such as `temperature` are restricted (fixed at 1) on those models — the same "unsupported
parameter" error family [Source: OpenAI community thread "what is going on with the gpt-5 api",
https://community.openai.com/t/what-is-going-on-with-the-gpt-5-api/1338030, accessed 2026-11-13;
LiteLLM issue 13381, https://github.com/BerriAI/litellm/issues/13381, accessed 2026-11-13;
Semantic Kernel issue 12899, https://github.com/microsoft/semantic-kernel/issues/12899,
accessed 2026-11-13]. Community reports further note that `reasoning_effort="none"` can be
ignored while `max_completion_tokens` is set on some model versions
[Source: https://community.openai.com/t/gpt-5-4-ignores-reasoning-effort-none-when-max-completion-tokens-is-used/1378362, accessed 2026-11-13].

## 3. Design

### 3.1 The parameter resolver (new, pure, unit-testable)

`buildRequest` gains one internal helper (pure function, exported for tests only or exercised via
mocked fetch — either is acceptable to the implementer as long as tests assert behavior, not
internals):

```
resolveTokenCapParam(cfg, memo) → "max_tokens" | "max_completion_tokens"
  knob = env CO_NEWBIZ_LLM_MAX_TOKENS_PARAM, trimmed, lowercased
  if knob == "max_tokens" | "max_completion_tokens" → knob          (explicit wins)
  if knob absent or "auto":
    if host(cfg.baseUrl) === "api.openai.com"  → "max_completion_tokens"
    else → memo[key(cfg)] ?? "max_tokens"
  key(cfg) = `${cfg.provider}|${cfg.baseUrl ?? "(default)"}|${cfg.model ?? "(default)"}`
```

- The exact-host comparison is on the HOST (URL parsing, not substring match on the whole URL) so
  `https://api.openai.com.evil.example` cannot match. The documented heuristic is an exact host
  match; a future allowlist of known OpenAI-first-generation hosts (e.g. Azure OpenAI endpoints)
  extends the same comparison, it does not loosen it.
- The knob is documented in the root `.env.sample` with its three values; no other config changes.
- `custom` provider and `openai-compatible` share the branch today and share the resolver —
  no separate treatment.

### 3.2 The in-band probe fallback (memoized)

One shared helper, used by both transport paths:

```
noteParamRejection(cfg, status, bodyText): boolean
  → true when status == 400 AND bodyText matches the signature
    /max_tokens[\x27 ]+is not supported with this model/i  (case-tolerant on quoting)
```

- **JSON path (`runProvider`)**: in the catch (:151–153), if `noteParamRejection` fires, write
  `memo[key(cfg)] = "max_completion_tokens"` and throw a REFINED error whose message states the
  adapted behavior (see §3.4). Because the loop already runs a second attempt, attempt 1 rebuilds
  the body via `buildRequest` — which now resolves to `max_completion_tokens` from the memo —
  with the ORIGINAL budget (the ×4 multiplier condition narrows, §3.3).
- **Streaming path (:423–434)**: on a non-OK response, if `noteParamRejection` fires, write the
  memo, then throw the error as today. There is no mid-generator resend; the caller-level retry
  (batch/attempt loops in `llm-json.ts`, committee chains) re-enters with a corrected body. The
  cold-start cost is at most one 400 per concurrent burst — concurrent in-flight calls can each
  observe one failed call before the memo lands — after which the memo makes all subsequent
  calls correct, and only on third-party hosts that actually reject the old name (and only if
  no earlier JSON call already populated the memo).
  On the currently configured dev provider the heuristic answers before any probe is needed, so
  the observed cost is zero.
- Memo scope: module-level `Map`, process lifetime. A server restart re-probes; that is accepted
  (the probe is one failed request, and persistence would be state without a consumer). Memo is
  never consulted when the knob is explicit.

### 3.3 Retry semantics: ×4 binds to empty responses only

Attempt 1's budget becomes:

```
attempt 1 budget = (previous failure was the empty-response throw)
                   ? (spec.maxTokens ?? 1500) * 4
                   : (spec.maxTokens ?? 1500)
```

Rationale: the ×4 exists to give a reasoning model a bigger ceiling after it burned the first
ceiling on reasoning with no text (:148 comment). A parameter-format 400 is a request-construction
error — resending it with a 4× cap silently changes cost semantics for a formatting problem.
Everything else in `runProvider` (two attempts, usage accumulation across attempts via `addUsage`,
the 60 s transport timeout, `spec.signal` precedence) is unchanged.

### 3.4 Error and log wording

- The empty-response message (:148) mentions `max_tokens` in prose. Reword to be parameter-neutral
  (`reasoning tokens may have exhausted the output-token cap`) so it stays true for both parameter
  names — prose only, no behavior.
- The adaptive-resend path prepends one line to the thrown message:
  `LLM HTTP 400: endpoint rejected 'max_tokens'; retrying with 'max_completion_tokens'` before the
  provider text, so the run ledger (ADR-0128 `logAgentCall` failure reason) records what happened
  even when attempt 1 also fails.
- `redactedDiagnostic` in `llm-json.ts` is unchanged (it already redacts and logs by category).

### 3.5 Reasoning-budget interplay: provider-aware default budgets (AMENDED by user decision, 2026-11-13)

> **Amendment (user decision, 2026-11-13, amending DEC-20261113-02 point 5 "default budget 1500
> stays UNCHANGED").** The default output budget becomes provider-aware at the three default
> sites (`runProvider` base budget, `completeStructured` base, `buildRequest` fallback):
>
> | Provider branch | Old default | New default |
> |---|---|---|
> | openai-compatible / custom / openai (unknown providers resolve to this branch) | 1500 | **6000** |
> | anthropic (production path — z.ai anthropic-compatible endpoint) | 1500 | 1500 (unchanged) |
> | gemini | 1500 | 1500 (unchanged) |
>
> PM evidence review backing the openai-compatible 6000 default (llm_call_log, successful calls,
> historical providers):
>
> | Evidence | Value |
> |---|---|
> | Max observed output tokens, all successful calls (n=151, incl. Chair minutes pass draft) | 5,332 tokens |
> | S1 main call "S1 pipeline — market-analysis step output" (n=282; purpose label translated from the Korean log purpose) | mean 684, max 3,200 tokens |
> | Existing empty-response retry ceiling (1500 × 4) | 6,000 tokens |
>
> Rationale: 6,000 is today's last-resort retry ceiling, so a 6000 first-attempt default aligns
> the first attempt with the ceiling reasoning models can actually need (the empty-response
> ×4 path exists precisely because a 1500 cap gets exhausted by reasoning, `llm.ts` :148) and
> removes one wasted round-trip per reasoning-model call. A budget is a ceiling, not a target —
> providers bill actual usage, so the cost risk is bounded to worst-case reasoning consumption.
> Consequence: the empty-response ×4 retry on the openai branch now ceilings at 24,000 (6000 × 4);
> on anthropic/gemini it stays 6,000, byte-identical to today.

With `max_completion_tokens` on OpenAI reasoning models, the ceiling includes reasoning tokens
(§2.6). Consequences under the amended default:

- The 6000 default makes the first attempt self-sufficient for the observed output distribution
  (max 5,332) while still admitting the empty-response ×4 retry (24,000) as the residual
  mitigation; `llm-json.ts:236` still classifies a parsed-but-cut tail as `truncated`.
- A model-aware budget floor (or passing `reasoning_effort` where supported) still needs LIVE
  evidence — actual reasoning-token consumption of `gpt-6.1-terra` on real S1 batches — before a
  number beyond 6000 can be justified. If S1 batches show repeated empty-response retries at
  24,000, that is the evidence the §8.2 follow-up needs.
- **Dry-run limitation (registered follow-up, §8.4):** `dry-run.ts` `DRY_RUN_MAX_TOKENS = 1500`
  stays untouched as the dry-run cost-estimate constant. Because it feeds an explicit
  `CallSpec.maxTokens`, the provider-aware default does not apply there — a reasoning model under
  a 1500 dry-run cap can still produce an empty response. Accepted for now; the dry-run path is
  an estimate surface, not a production output surface.
- `temperature: 0.3` (default, former `buildRequest` openai-branch value) WAS rejected by the
  configured reasoning model — confirmed live at Row 1 (`Unsupported value: 'temperature' does not
  support 0.3 with this model. Only the default (1) value is supported.`). Resolved by the §8.3
  follow-up, implemented the same day by user decision: `temperature` is omitted entirely from the
  openai-compatible/custom body. See §8.3 for the decision record.

### 3.6 What does not change

- Anthropic branch (production path): body, headers, `thinking: { type: "disabled" }`, retry —
  all byte-identical. (Temperature kept here and on gemini; only the openai-compatible/custom
  branch omits it — §8.3 user decision, 2026-11-13.)
- Gemini branch: unchanged.
- `resolveUrl`, `buildHeaders`, `parseUsage`, `extractText`, `extractFinishReason`,
  `extractToolInput`: unchanged.
- `DRY_RUN_MAX_TOKENS`, `CallSpec.maxTokens` field name, all 20+ consumer call sites: unchanged.
- `env-check.ts` probe: unchanged (registered follow-up elsewhere).
- `.env.prod` and production boot: value-neutral, behavior-neutral.

## 4. Risks and mitigations

| Risk | Assessment | Mitigation |
|---|---|---|
| Heuristic grows stale (OpenAI re-accepts `max_tokens`, or renames again) | Low: the in-band probe fallback is signature-based on the provider's OWN error text, so a rename produces a new 400 that the knob can override and the signature can be extended for | Knob as the always-available override; signature regex isolated in one helper |
| Third-party strict validator rejects `max_completion_tokens` sent by mistake (heuristic host list too broad in future) | Not present in this design: only the exact host `api.openai.com` takes the new name without a probe; everything else proves it first | Exact-host match; probe-before-switch for all others |
| One extra failed request per process per exotic endpoint | Accepted: memo makes it once; the currently configured dev provider is heuristic-covered (zero probes) | §3.2 memoization; probe cost is a 400 response, not a token spend |
| Streaming path cold-start failure on a third-party host that rejects the old name | One failed stream call before the memo is set; caller-level retry absorbs it | §3.2 memo write in the stream error path; documented limitation |
| ×4-narrowing changes behavior someone relied on | The ×4 was never meaningful for HTTP 400s (a 400 does not consume tokens); narrowing only prevents a budget inflation that had no effect anyway — resend after a param 400 at the original budget is behavior-equivalent in cost | Test pins both retry budgets (AC 6, 7) |
| Empty-response loops on reasoning models with a small cap | Amended default 6000 on the openai branch covers the observed output distribution (max 5,332); retry ×4 (24,000) still fires when reasoning exhausts the cap | Documented limitation + follow-up §8.2 with a live-evidence trigger; dry-run path keeps 1500 and its limitation is registered (§8.4) |
| `CO_NEWBIZ_LLM_MAX_TOKENS_PARAM` typo silently ignored | Low: an invalid value is treated as `auto` with a one-shot warning naming the invalid value (no secrets) | runtime one-shot warning (llm.ts) + env-check warning at pre-flight time (same severity class as the whitespace warnings, warning not failure) |
| Memo key collision across config changes within one process | Key includes provider + baseUrl + model, so a mid-process config change (dev-only scenario) re-probes | Key composition (§3.1) |
| `temperature` omission silently discards caller sampling tuning (0.2–0.4) on openai-compatible/custom | Accepted by user decision (§8.3, 2026-11-13): omission is strictly safer than a probe because temperature is optional in the OpenAI contract and universally accepted when absent | Documented limitation; anthropic/gemini keep the value; no caller asserts the wire value on this branch; tests pin the omission (AC 13) |

## 5. Alternatives considered

1. **Blanket swap** (`max_completion_tokens` for all openai-compatible/custom) — REJECTED: most
   third-party OpenAI-compatible servers (vLLM, Ollama, proxies, z.ai openai mode) implement the
   older contract where only `max_tokens` is honored; the swap silently removes the output cap
   (unbounded output, unbounded cost) on every non-OpenAI endpoint, and strict validators reject
   the unknown parameter outright (DEC-20261113-02 alternatives item 1).
2. **Endpoint heuristic only** — REJECTED as sole mechanism: deterministic and zero-cost for the
   current dev provider, but brittle for OpenAI-first-generation gateways behind custom domains,
   and it hardcodes a vendor fact with no override. KEPT as the accelerator (§3.1 step 2).
3. **Adaptive retry only** (no heuristic, no knob) — REJECTED: works, but wastes one failed request
   on the provider we can already recognize, and leaves no escape hatch, forcing tests to simulate
   network failures to pin behavior a config value could state. KEPT as the core fallback.
4. **Explicit knob only** (mandatory choice) — REJECTED as default-on friction: every provider
   change would require an .env edit for something the resolver can decide. KEPT as override,
   default `auto`.
5. **Boot-time capability probe** (call `/models` or a feature endpoint once at startup) —
   REJECTED: adds a boot-time network dependency and new failure modes; the in-band 400 signature
   is the provider stating the exact answer at the exact moment it matters.
6. **Rename `CallSpec.maxTokens` / touch `DRY_RUN_MAX_TOKENS`** — REJECTED: internal budgets with
   a name-only coincidence to the wire parameter; renaming churns 20+ files for zero behavior.

## 6. Accessibility

No user-facing interaction surface changes — this is transport-layer request construction and
console/ledger error text. Operator-facing output (the adaptive-resend log line, the reworded
empty-response message) is plain text in plain language and never relies on color alone to convey
severity. Exemption from the WCAG screen checklist is stated here per docs/context.md.

## 7. Acceptance criteria (all testable via mocked fetch; no live network in tests)

Existing harness anchor: `tests/unit/llm-structured.test.ts` already mocks `globalThis.fetch` and
captures every outgoing parsed body (`calls.push({ url, body: JSON.parse(init.body) })`, :47–48),
with per-provider env configuration via `configure(provider, caps, model)` (:37–44). New cases
extend this suite (or a sibling `tests/unit/llm-token-param.test.ts` reusing the same helpers).

1. **anthropic unchanged**: with provider `anthropic`, the captured body contains `max_tokens` and
   no `max_completion_tokens`; body is otherwise byte-identical to today's shape.
2. **gemini unchanged**: with provider `gemini`, the cap lives at `generationConfig.maxOutputTokens`;
   neither wire parameter appears at top level.
3. **Heuristic**: with provider `openai-compatible` and `CO_NEWBIZ_LLM_BASE_URL` host
   `api.openai.com`, the first captured body contains `max_completion_tokens` and no `max_tokens`.
4. **Compatibility default + probe fallback**: with a non-OpenAI host and no knob, the first body
   contains `max_tokens`; when the mock replies 400 with the unsupported-parameter text, the second
   captured body contains `max_completion_tokens` at the ORIGINAL budget (not ×4); the call
   succeeds against the corrected request.
5. **Memoization**: after case 4's flip, a subsequent call in the same process sends
   `max_completion_tokens` on the FIRST attempt (no intervening 400) — proven by a fresh mock that
   counts replies served.
6. **×4 binds to empty responses**: with provider `anthropic` (or a non-OpenAI host after the
   heuristic), an empty-response mock then a success shows the second body's cap == first × 4;
   with a 400-param mock then a success, the second body's cap == the original.
7. **Knob**: `CO_NEWBIZ_LLM_MAX_TOKENS_PARAM=max_tokens` forces `max_tokens` even on the
   api.openai.com host; `=max_completion_tokens` forces the new name on a third-party host with no
   probe; `=auto` or unset behaves per 3–5; an unrecognized value behaves as `auto`.
8. **Streaming path memo**: a streaming call on a third-party host that 400s with the signature
   throws as today, and the NEXT call (streaming or JSON) in the same process sends
   `max_completion_tokens` on the first attempt.
9. **Regression guard**: existing suites green — `llm-structured`, `llm-json-batching`,
   `llm-executors`, `committee-llm`, `stage-llm-recommendations` — with no change to their
   expectations beyond the param-name assertions added here.
10. **Error wording**: the failure reason recorded via `logAgentCall` on a doubly-failing endpoint
    contains the adaptive-resend line from §3.4 (asserted through the run-ledger row or the thrown
    message, per the existing test idioms).
11. **Provider-aware default budgets (user decision 2026-11-13, §3.5)**: with no explicit
    `maxTokens`, the openai-compatible/custom branch sends a 6000 cap and the anthropic and gemini
    branches send 1500 — asserted at all three default sites (runProvider base budget via
    `completeDetailed`, `completeStructured` base, `buildRequest` fallback), including the
    anthropic byte-identical body assertion.
12. **Knob hygiene warnings**: an unrecognized `CO_NEWBIZ_LLM_MAX_TOKENS_PARAM` value produces a
    one-shot runtime warning naming the invalid value (no secrets) and behaves as `auto`; env-check
    emits a warning (not a failure) for the same condition.
13. **Temperature omission on the openai branch (§8.3 user decision, 2026-11-13)**: with
    `CallSpec.temperature` explicitly set, the openai-compatible/custom body contains NO
    `temperature` key (asserted on the api.openai.com heuristic host, a third-party compatibility
    host, and the `custom` provider, including `completeStructured`, whose base spec always sets a
    temperature); the anthropic body still carries it (AC 1's byte-identical assertion) and
    `generationConfig.temperature` on gemini is unchanged.

## 8. Follow-ups (registered, not this batch)

1. **env-check LLM probe provider-awareness** — already registered as
   design 2026-11-13-env-single-source-design §8.1; the probe must speak the configured provider's
   endpoint AND parameter name (it can reuse this design's resolver).
2. **Model-aware output-budget floor** — the 2026-11-13 user decision (§3.5) raised the
   openai-compatible first-attempt default to 6000, aligned with the previous retry ceiling. If
   live S1 runs on `gpt-6.1-terra` still show repeated empty-response retries (now at 24,000),
   raise the default further (or pass `reasoning_effort` where supported) with the measured
   reasoning-token consumption as evidence.
3. **Reasoning-model sampling-parameter enforcement — IMPLEMENTED (user decision, 2026-11-13).**
   The Row 1 live verification returned exactly the predicted error:
   `Unsupported value: 'temperature' does not support 0.3 with this model. Only the default (1)
   value is supported.` The user chose **omission over a probe**: `temperature` is removed from the
   openai-compatible/custom branch request body ENTIRELY — no adaptive probe, and the default (1)
   is NOT sent explicitly. Rationale: omission is universally accepted (the parameter is optional
   in the OpenAI Chat Completions API and in third-party OpenAI-compatible servers), so it is
   strictly safer than the probe pattern; a probe adds a failure mode the resolver never needed,
   and sending `temperature: 1` explicitly would still be rejected by any future server that
   disallows the parameter altogether. Accepted cost: per-call sampling tuning (the 0.2–0.4 values
   set by synergy-pipeline, llm-executors, committee-llm, market-sizing-pipeline, and others) is
   silently lost on this branch — every openai-compatible/custom call now runs at the provider's
   default temperature. The anthropic (z.ai production path) and gemini branches KEEP temperature,
   byte-identical bodies; `CallSpec.temperature` stays as a field so those callers are unchanged.
   No knob, no memo, no config: the omission is unconditional on the branch.
4. **Dry-run reasoning-model empty-response limitation** — `DRY_RUN_MAX_TOKENS = 1500` stays as
   the dry-run cost-estimate constant (untouched by design), so a reasoning model under the 1500
   dry-run cap can still return an empty response where the production path (6000) would not. If
   dry-run output quality degrades on reasoning providers, give the dry-run budget the same
   provider-aware treatment; requires live evidence first.

## 9. KNOWN / INFERRED / ASSUMED / UNKNOWN

- **KNOWN** (verified today, file:line): all anchors in §2 — the three buildRequest branches
  (:509/:539/:548), the two call sites (:139/:427), the ×4 retry (:135), the empty-response message
  (:148), the finishReason regex (llm-json.ts:236), DRY_RUN_MAX_TOKENS (dry-run.ts:33), the
  env-check probe (env-check.ts:138–141), the mocked-fetch test harness capturing request bodies
  (tests/unit/llm-structured.test.ts:47–48), and the two configured provider channels (§2.5, hosts
  only). The 400 error text and the reasoning-budget/sampling-parameter semantics of OpenAI
  reasoning models are KNOWN external facts with cited sources (§2.6). The sampling-parameter
  restriction itself is KNOWN by live verification (Row 1, 2026-11-13): `gpt-6.1-terra` rejected
  `temperature: 0.3` with `Unsupported value: 'temperature' does not support 0.3 with this model.
  Only the default (1) value is supported.` — resolved by omission per §8.3.
- **INFERRED**: the fix is complete once `buildRequest` resolves the parameter name — derived from
  the grep showing request-body writers exist only at llm.ts:509/:548 and env-check.ts:141 (§2.2);
  the streaming cold-start cost is once per process — derived from the memo design (§3.2).
- **ASSUMED**: no other code path in the repo builds an OpenAI Chat Completions body outside
  `llm.ts` and the env-check probe (grep-based; a deeper AST-level check happens at Row 1 when the
  implementer touches the file).
- **UNKNOWN** (as of Row 0; temperature item since RESOLVED live, see §8.3): whether
  `gpt-6.1-terra` imposes a minimum `max_completion_tokens` floor — only live runs answer
  this; which third-party hosts this project will actually target in the future — the compatibility
  default keeps them on today's behavior, so the answer can stay unknown without risk.

## References

- [OpenAI community — "what is going on with the gpt-5 api" (max_completion_tokens includes reasoning tokens; empty responses with small caps)](https://community.openai.com/t/what-is-going-on-with-the-gpt-5-api/1338030) — accessed 2026-11-13
- [LiteLLM issue #13381 — gpt-5 rejects max_tokens, requires max_completion_tokens](https://github.com/BerriAI/litellm/issues/13381) — accessed 2026-11-13
- [Semantic Kernel issue #12899 — InvalidRequestException with gpt-5 on max_tokens](https://github.com/microsoft/semantic-kernel/issues/12899) — accessed 2026-11-13
- [OpenAI community — gpt-5.4 ignores reasoning_effort="none" when max_completion_tokens is used](https://community.openai.com/t/gpt-5-4-ignores-reasoning-effort-none-when-max-completion-tokens-is-used/1378362) — accessed 2026-11-13
