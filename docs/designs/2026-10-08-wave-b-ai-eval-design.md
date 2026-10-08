---
title: Wave B — AI Evaluation, LLM Hardening, Observability, and RAG Calibration
status: approved
date: 2026-10-08
owner: platform-lead
contributors: quant-methodologist (calibration method), risk-officer (kill-criteria expectations), antitrust-agent (antitrust expectations), backend-engineer (implementation), sre (observability), security-engineer (eval data handling)
related_adrs: []
---

# Wave B — AI Evaluation Design

> Pre-approved by the user in chat on 2026-10-08 (all wave designs pre-approved). PM records the committee-default promotion decision separately, after B-3 data exists.

## 1. Context

The web app calls an LLM from several places, but none of them is measured against a known answer:

- `app/web-next/lib/llm.ts` — `complete()` / `completeOrFallback()`: plain text completion with a deterministic synthesis fallback. No structured output, no schema validation, no retry, no streaming, no prompt caching, no provider token usage.
- `app/web-next/lib/review/ai-second.ts` — AI 2nd-stage cross-domain review. Cost uses `estimateTokens()` (chars / 4), not real usage.
- `app/web-next/lib/committee-llm.ts`, `committee-agents.ts` — committee LLM mode, gated behind `CO_NEWBIZ_COMMITTEE_AGENTS` (off by default).
- `app/web-next/lib/llm-executors.ts` — `makeLlmBusinessCaseExecutor()`, `makeLlmDdTailorExecutor()` (DD checklist tailoring via `dd-checklist-tailor.ts`).
- `app/web-next/lib/agent-orchestrator.ts`, `agent-chains.ts` — stage LLM recommendations.
- `db/lib/rag-engine.ts` — deterministic RAG grading including the data-confidence cap.

The configured provider is Anthropic-compatible (model `GLM-5.3-Flash`, custom base URL). The design must stay provider-agnostic: Anthropic-compatible and OpenAI-compatible adapters behind one interface, capability flags rather than provider name checks.

Fourteen pilots (`docs/pilots/pilot-001` … `pilot-014`) are walked through the process with public facts. Several have public outcomes (008 KFTC conditional approval, 010 KFTC prohibition, 009 closed acquisition, 003 suspended restructuring). These are the only ground truth we have.

## 2. Goals and non-goals

Goals:

1. A versioned golden dataset derived only from public facts already written in the pilot docs.
2. `bun run eval`: score deterministic engines (always, in CI) and LLM-backed functions (opt-in) per stage and function, with a scoreboard.
3. Harden `lib/llm.ts`: structured output, Zod validation, one repair retry, streaming, prompt caching, real token usage.
4. Per-deal token and cost observability plus OpenTelemetry GenAI spans (no-op by default).
5. RAG calibration (Brier score, reliability table) and a measurement of whether the confidence cap reduces overconfidence.
6. A written decision rule for promoting committee LLM mode to default.

Non-goals: changing RAG weights or kill criteria (governance change, ADR + policy path); fine-tuning; any agent auto-approval. Gate approval and investment decisions stay human (design boundary 2). Eval scores are evidence for people, not a pass stamp.

## 3. Golden dataset (B-2)

### 3.1 Location and versioning

```
tests/eval/golden/
  VERSION                      # semver; bump on any expectation change
  schema.ts                    # Zod schema; the single source for the file format
  cases/pilot-008.yaml ...     # one file per pilot
  CHANGELOG.md                 # why each expectation changed, with pilot-doc citation
```

YAML for human review; the loader validates with the Zod schema and fails CI on any invalid file.

### 3.2 Case shape

```yaml
case_id: pilot-008
golden_version: 1.0.0
source_doc: docs/pilots/pilot-008-delivery-hero-woowa-brothers.md
deal_type: brownfield
public_outcome: { kind: conditional_approval, authority: KFTC, known: true }
inputs_ref: fixtures/pilot-008.input.json   # facts as of the decision date only
expectations:
  - stage: S6
    function: antitrust_flags
    expected: { filing_required: true, hhi_flag: high, remedy_likely: structural }
    citation: "pilot-008 §<section>"
  - stage: S7
    function: rag_dimensions
    expected: { market: amber, regulatory: red, financial: green }
    tolerance: one_grade              # exact | one_grade
  - stage: S7
    function: kill_criteria
    expected: { hits: [] }
  - stage: S7
    function: confidence_cap
    expected: { cap_applies: false }
```

Expectation types: `antitrust_flags`, `rag_dimensions` (per-dimension grade), `rag_overall`, `kill_criteria` (set of hit keys), `confidence_cap` (whether data confidence must cap the grade), `dd_tailoring` (required checklist items that must be kept), `review_findings` (issues the AI 2nd review must raise).

### 3.3 Authoring rules

- Every expectation carries a `citation` to a section in the pilot doc. No citation, no expectation.
- Only public facts already in the pilot doc. No new research in this wave.
- `inputs_ref` contains facts dated before the decision; the outcome is never part of the input (leakage control, §9).
- Cases without a public outcome (most of 001–014 are "in progress") still give process-level expectations (kill-criteria, cap, antitrust flags) but are excluded from outcome calibration (§6).
- Authors: antitrust-agent (antitrust), risk-officer (kill criteria), process-governance-manager (RAG dimensions), quant-methodologist (confidence cap). Second-domain review per the cross-validation matrix before a version bump.

Initial outcome-labelled set: 008 (conditional approval), 010 (prohibition), 009 (closed), 003 (suspended). Others are added when the pilot doc states a public outcome.

## 4. Eval harness (B-2)

### 4.1 Command

`bun run eval` (root `package.json`) runs `scripts/eval/run.ts`:

| Flag | Effect |
|---|---|
| (none) | deterministic suites only; no network; used in unit CI |
| `--llm` | also run LLM suites; requires a configured provider; refuses without `CO_NEWBIZ_EVAL_LLM=1` |
| `--suite <name>` | one suite (e.g. `rag`, `review-ai2`, `committee`, `dd-tailor`, `stage-reco`, `business-case`) |
| `--max-cost-usd <n>` | hard budget; aborts before exceeding (default 2.00) |
| `--repeat <k>` | runs each LLM case k times to measure variance (default 1) |

### 4.2 Suites

| Suite | Target | Scoring |
|---|---|---|
| `rag` | `db/lib/rag-engine.ts` | exact / within-one-grade per dimension; overall exact; cap applied correctly |
| `kill` | kill-criteria evaluation | set precision / recall on hit keys |
| `antitrust` | deterministic HHI / filing logic | flag accuracy |
| `review-ai2` | `lib/review/ai-second.ts` | recall of expected findings (LLM judge forbidden; match by finding key) plus "declared could-not-verify" present |
| `stage-reco` | `agent-orchestrator.ts` / `agent-chains.ts` | schema-valid rate; agreement with expected grade direction |
| `committee` | `committee-llm.ts` | per-member vote vs expected; dissent captured; schema-valid rate |
| `dd-tailor` | `makeLlmDdTailorExecutor` | required items retained (must be 100%); items dropped with reason |
| `business-case` | `makeLlmBusinessCaseExecutor` | schema-valid rate; numbers traceable to inputs |

New LLM call sites found later in `app/web-next/lib` get a suite before they ship (Verification §11).

Scoring is deterministic: structured output is compared field by field. No LLM-as-judge in this wave; it would share blind spots with the system under test.

### 4.3 Scoreboard

Each run writes `docs/reports/eval/YYYY-MM-DD-<run-id>.md` and a JSON twin. Header records: golden version, git SHA, provider, base URL host (no secrets), model id, prompt hash per function (SHA-256 of the rendered system prompt template), temperature, repeat count, total tokens (input / output / cache-read / cache-write) and cost. Body: one table per suite (stage × function × score, n, failures listed by case id), plus a "could not evaluate" section. Deterministic-only runs in CI do not write a report; they assert thresholds.

## 5. `lib/llm.ts` hardening (B-1)

### 5.1 Interface

```ts
completeStructured<T>(opts: {
  messages; system; schema: z.ZodType<T>; schemaName: string;
  cache?: { system?: boolean }; meta: AgentCallMeta; signal?: AbortSignal;
}): Promise<{ value: T; usage: LlmUsage; source: "llm" } | SynthesisResult>
stream(opts): AsyncIterable<LlmStreamEvent>   // text deltas + final usage
interface LlmUsage { inputTokens; outputTokens; cacheReadTokens; cacheWriteTokens; model; provider }
```

`complete()` stays for backward compatibility and returns `usage` too.

### 5.2 Behaviour

1. **Structured output**: convert the Zod schema to JSON Schema; use the provider-native mechanism when the adapter declares it (Anthropic-compatible: forced single tool with `input_schema`; OpenAI-compatible: `response_format: json_schema`). Otherwise instruct-and-parse.
2. **Validation**: always `schema.safeParse` the result, even when the provider claims schema enforcement.
3. **One repair retry**: on parse or validation failure, send one follow-up containing the Zod error path list (no raw output echo beyond the failing fields). Second failure falls back to synthesis and is logged as `validation_failed`.
4. **Streaming**: used where the UI shows long prose (committee deliberation, review narrative). Structured calls are not streamed to the UI.
5. **Prompt caching**: adapter capability `promptCache`; for Anthropic-compatible, `cache_control` on the stable system prompt and procedure context. Unsupported providers ignore the flag silently. Cache hits appear in usage.
6. **Real usage**: read `usage` from the provider response. `estimateTokens()` in `review/ai-second.ts` becomes a fallback only when the response has no usage, and the record is flagged `usage_estimated: true`.
7. **Capability detection** comes from config (`CO_NEWBIZ_LLM_CAPS=structured,cache,stream`), not from the model name, because a custom base URL (GLM-5.3-Flash) may support a subset.

## 6. Observability (B-1)

- `logAgentCall` gains `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `costUsd`, `usageEstimated`, `projectId` (deal), `functionName`, `promptHash`.
- Cost table: `config/llm-pricing.yaml` (model id → per-million input / output / cache-read / cache-write price, `source`, `verified_on`). Unknown model → `costUsd: null` and a warning, never a guess.
- Per-deal rollup query for the existing agent-call log; exposed through the existing API, no new UI in this wave.
- OpenTelemetry GenAI semantic conventions: span `gen_ai.chat` with `gen_ai.system`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, plus `co_newbiz.project_id`, `co_newbiz.function`. Prompt and completion content are **not** recorded (MNPI). Exporter enabled only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; default is the no-op tracer, so there is zero runtime cost and no new dependency on the default path beyond `@opentelemetry/api`.

## 7. RAG calibration (B-3)

Method owner: quant-methodologist; documented in `docs/methodology/rag-calibration.md`.

- **Mapping**: Green/Amber/Red → proposed probability of a favourable outcome (initial 0.8 / 0.5 / 0.2; the mapping is itself documented and versioned).
- **Outcome label**: favourable = closed or approved (including conditional); unfavourable = prohibited, abandoned, suspended. Only pilots with a public outcome in the pilot doc.
- **Metrics**: Brier score overall; reliability table (bin = grade; predicted vs observed rate, n per bin); computed twice — with and without the data-confidence cap — to measure whether the cap lowers overconfidence (Brier delta and the count of Green predictions on unfavourable outcomes).
- **Small-n honesty**: with n ≈ 4 the report shows bootstrap intervals and states "insufficient for weight changes". Calibration results inform, they do not retune weights; any change goes through the policy path with an ADR.

## 8. Committee LLM mode promotion rule (B-3)

`CO_NEWBIZ_COMMITTEE_AGENTS` may become default-on only when all of these hold on the same golden version, model id and prompt hashes, over `--repeat 3`:

| Criterion | Threshold |
|---|---|
| Schema-valid rate (after repair) | ≥ 99% |
| Member vote agreement with expected | ≥ 80%, and not below deterministic-mode agreement |
| Kill-criteria hits surfaced in deliberation | 100% recall |
| Run-to-run vote flip rate | ≤ 10% |
| Explicit "could not verify" declarations present | 100% of sessions |
| Median cost per session | within `config/llm-pricing.yaml` budget line set by PM |

PM records the decision as a decision record citing the scoreboard file. A model or prompt-hash change voids the promotion until re-run. Human gate approval is unchanged either way.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Eval leakage: pilot outcomes are public and likely in model training data; prompts may also contain outcome text | Inputs are facts dated before the decision; a leakage lint fails if outcome keywords (e.g. "prohibited", "approved") appear in `inputs_ref`; report notes training-data contamination as an unremovable limitation |
| Small n (4 outcome-labelled cases, 14 total) | Bootstrap intervals; no weight retuning from eval; thresholds framed as gates for regression, not proofs of accuracy |
| LLM cost | Opt-in flag, `--max-cost-usd` hard cap, prompt caching, cost recorded per run |
| Overfitting prompts to the golden set | Golden set changes need a version bump and second-domain review; held-out cases added as pilots mature |
| Provider capability drift at custom base URL | Capabilities configured explicitly; validation always runs regardless |
| MNPI in telemetry | No prompt/completion content in spans or logs; golden set is public-only |

## 10. PR split

| PR | Content |
|---|---|
| **B-1** LLM hardening + observability | `lib/llm.ts` structured / repair / stream / cache / usage; adapter capability flags; `ai-second.ts` uses real usage; `logAgentCall` extensions; `config/llm-pricing.yaml`; OTel GenAI spans (no-op default); unit tests with a mocked provider |
| **B-2** Golden set + harness + scoreboard | `tests/eval/golden/**` (schema, 14 cases, leakage lint); `scripts/eval/run.ts`; `bun run eval`; deterministic suites wired into unit CI; first opt-in LLM scoreboard under `docs/reports/eval/` |
| **B-3** Calibration + committee rule | `docs/methodology/rag-calibration.md`; calibration suite (Brier, reliability, cap delta); committee promotion criteria encoded as a check in the harness |

B-1 lands first (B-2 needs usage and structured output); B-3 depends on B-2.

## 11. Verification

- `bun run test` passes; deterministic eval suites run inside unit CI and fail on threshold regression.
- `bun run eval` with no provider configured completes and skips LLM suites with a clear message.
- Mocked-provider tests: schema-valid path, invalid then repaired, invalid twice → synthesis fallback, usage parsed, cache tokens parsed, missing usage → `usage_estimated: true`.
- OTel: with no endpoint, no exporter is constructed; with an endpoint, spans carry GenAI attributes and no content.
- Golden loader rejects an expectation without a citation and an input containing outcome keywords.
- One opt-in LLM run against the configured provider produces a scoreboard with model id, provider, prompt hashes and cost.
- Inventory check: every `complete`/`completeStructured` call site in `app/web-next/lib` maps to a suite.
- `bun scripts/audit.ts` passes.

## 12. Accessibility and preview

- B-1, B-2, B-3: no UI change. Accessibility review: not applicable. Preview: not applicable.
- Streaming touches existing committee/review screens only as incremental text into existing regions; those regions must keep `aria-live="polite"` and not move focus. If that cannot be met, streaming stays off for that screen.
- A per-deal cost panel is out of scope. If added later, it must follow Onyx 3.0 (design-guide, tokens, `design:lint`), use a data table rather than colour-only states, and pass the accessibility-audit skill (WCAG 2.1 AA) before merge.
