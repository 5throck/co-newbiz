# S6 Target Universe Draft: Growth and Viability First, No Process Narration

- Spec ID: `2026-11-17-s6-universe-growth-viability-presentation`
- Date: 2026-11-17
- Status: withdrawn 2026-11-17 — superseded by `2026-11-17-s6-universe-direction-review` (owner redirected the card to an evaluation-target direction review). Never implemented; kept only because the successor reuses §2, §4 and §6.3 by reference.
- Author: brownfield-agent persona (Row 0 design, PM dispatch; S6 `target-universe-definition`
  activity owner)
- Registration note: spec-register, `/sync`, and any code or prompt edit are NOT part of this
  task. PM registers the spec after user approval.
- ADR: none required. No DB schema change (`opportunity.target_universe_json` is a JSON
  column, migration 0062), no auth change, no MCP tool scope change (the
  `draft_universe_criteria` tool passes the route envelope through; the envelope change is
  additive). PM may record a DEC entry for the prompt contract change.
- Extends: design `2026-11-11-s6-universe-viability-criteria` (status implemented,
  DEC-20261111-05) — keeps its pinned S1 resolution chain, payload expansion, the
  `financial_criteria` record key, and its rule that technical-capability conditions are not
  universe criteria.
- Related: ADR-0118 (stage-scoped LLM decision support), ADR-0187 (data confidence grades
  A|B|C|U), ADR-0066 (value-chain stage financials plane), ADR-0139 (preserve-when-absent
  record semantics; S7 eval layer), ADR-0184 (next-intl ko/en), non-negotiable boundaries 2
  (humans record) and 4 (data confidence caps the grade).

## 1. Problem

The owner reads the S6 `목표 시장 정의` card and sees how the definition was derived, not
what it concludes. The live example on the page:

```
S1 산출물의 산업 정의(원자력 발전소 v7·신뢰도 U), 기준 시장규모($39.88B, 2026), 지역 믹스와
미드스트림 가치사슬 위치(사슬 등급 C, hops 0)를 근거로 산업·지역·규모 범위를 설정했다. S3 산출물의
위험 요인(2026–2031 CAGR 0.73% 성장 둔화 [1])과 가치사슬 단계별 재무 데이터 부재를 근거로 수익성
조건은 검증 필요로 처리하고, 기술·인증·실적 조건은 선정 기준에서 제외하여 스크리닝 단계에서 후보별
판단하도록 했다. 본 기준은 제안이며, 검토 후 기록으로 확정되어야 한다.
```

The facts a reviewer needs are all present (a $39.88B market growing at 0.73% a year, with
no profitability evidence), but they are buried inside a derivation chain. A reader has to
reconstruct the two verdicts that matter for an M&A universe: is this market growing
(`성장성`), and is there profit to be had in the stage we would buy into (`사업성`).

## 2. Root cause (verified in code)

1. **The prompt asks for a narrative, and the UI makes that narrative the definition.** The
   `s6.universe_criteria_draft` output contract (`app/web-next/prompts/prompts.json:153`) is
   `{"criteria":{"industry","region","size","viability","rationale"}}` with `rationale`
   described as "2 to 3 sentences that cite the S1 and S3 outputs". `applyUniReco`
   (`components/stages/brownfield/useBrownfieldUniverse.tsx:261-270`) writes `c.rationale`
   into the recorded `definition`, and `UniverseSection.tsx:19-24` renders `definition` as
   the card body. So the citation narrative becomes the visible definition of record.
2. **The card never shows the viability conclusion.** `UniverseSection.tsx` renders only
   `scope` and `definition`; the `financial_criteria` key added by the 2026-11-11 design is
   saved (`targets/route.ts:112-121`) but not displayed on the card.
3. **No structured growth figures reach the model.** `s1ContextLines`
   (`lib/brownfield-universe.ts:186-197`) passes the anchor size and competitive structure
   only. The S1 matrix carries growth figures (`consistency.bottomUpCagr`,
   `consistency.topDownCagr`, `externalForecast.{cagr,targetYear,marketSize,sourceLabel}`,
   `calibration.ourCagrPct`, `cagrBase` for projections — `lib/market-sizing.ts:191-262`),
   but none is in the payload. The only growth number the model saw in the example
   (`CAGR 0.73%`) came from a free-text risk factor.
4. **Provenance is written by the model, so it can be wrong.** The example attributes the
   risk factor to S3 (`S3 산출물의 위험 요인`). In the current payload, the only line labelled
   `위험 요인` is built by `s1StructureLines` (`lib/brownfield-universe.ts:263-266`) from the
   S1 matrix's `qualitative.riskFactors`; the S3 block carries capability rows only
   (`s3CapabilityLines`, :352-393). The model mislabelled the source because it composes
   citations in prose.
5. **The prohibition invites meta-commentary.** The prompt tells the model never to state
   technical-capability conditions; the model then reports its compliance
   (`기술·인증·실적 조건은 선정 기준에서 제외하여`). A rule with no output slot leaks into
   prose.

## 3. Design decisions

| ID | Decision | Why |
|---|---|---|
| D1 | The draft output is structured: `growth`, `viability`, `scope`, and figure references. The free `rationale` field is removed from the prompt contract. | Conclusion first (the repo's Explanation style) is enforced by the schema, not by a sentence in the prompt. |
| D2 | The server builds a numbered evidence catalog (`E1..En`) from the payload. The model cites catalog ids; it never writes provenance text. The visible `evidence` list is materialized by the server from the cited ids. | Fixes root cause 4. Source labels, versions, and grades are server facts, so they cannot be mislabelled. |
| D3 | Figures are `{ref, role, value}` triples. The server keeps a figure only when its value is traceable to the cited catalog item. | Honesty rule: no invented growth or profitability numbers. Traceability is checked, not requested. |
| D4 | The growth outlook label and the viability status are computed or capped by the server from traced figures. The model's label is a proposal the server can override. | The headline word must not drift from the numbers. Data confidence caps the row grade (boundary 4). |
| D5 | Visible text is checked for derivation narration and source codes. A failing field is replaced by a deterministic template, and the replacement is recorded in `checks`. | Fixes root causes 1 and 5 even when the model ignores the prompt. Predictable and testable, with no second LLM call. |
| D6 | The record gains additive keys (`growth`, `viability`, `scope_lines`, `evidence`, `presentation_version`). `definition` becomes the derived labelled scope text for downstream consumers. Older records render as today. | No migration. The S7 screening-draft and S6 web-search routes keep reading `definition` unchanged. |
| D7 | When the LLM is unavailable, the server still returns deterministic growth and viability rows built only from traced figures, with no scope proposal. | The facts exist without AI wording. The scope criteria stay a human or AI proposal and are never synthesized. |

## 4. Payload: the evidence catalog

### 4.1 Builder

A pure function `buildUniverseEvidenceCatalog(s1, stageFinancialRows, capabilityRegister)` in
`app/web-next/lib/brownfield-universe.ts` returns `EvidenceItem[]`:

```ts
interface EvidenceItem {
  id: string;            // "E1".."E16", assigned in a fixed kind order
  kind: EvidenceKind;    // see table below
  ref: string;           // server label, e.g. "S1 v7", "S1 v7 (계산)", "S3 역량 레지스터"
  version_id: string | null;  // market_sizing_version.id for S1 items
  fact: string;          // server-formatted one-line fact, ≤ 200 chars
  grade: Grade | null;   // A | B | B- | C | C- | D | U | null
  numbers: number[];     // numeric tokens extracted from `fact` plus derived equivalents (§6.3)
  years: number[];       // 4-digit years appearing in `fact`
  citeable_in: Array<"growth" | "viability" | "scope">;
}
```

| Kind | Source (all already reachable from the route) | Fact format (ko) | Grade | Citeable in |
|---|---|---|---|---|
| `s1_identity` | resolved S1 row | `산업 정의: {industryLabel} ({resolution label} v{n})` | version grade | scope |
| `s1_anchor` | `matrix.anchor.total` | `기준 시장규모 ${total}B (2026, 글로벌)` | version grade | growth, scope |
| `s1_trend_cagr` | `calibration.ourCagrPct`, else `consistency.bottomUpCagr` (same priority as `resolveEffectiveCagr`, `lib/market-calibration.ts:344-370`) | `추세 연장 CAGR {x}% (과거 성장률 연장, bottom-up)` | version grade | growth |
| `s1_topdown_cagr` | `consistency.topDownCagr` | `top-down CAGR {x}%{source label if any}` | version grade | growth |
| `s1_external_forecast` | `externalForecast` | `외부 전망 {sourceLabel}: {targetYear}년 ${marketSize}B, CAGR {x}%` | version grade | growth |
| `s1_projection` | `projection2030` summed globally (`lib/market-sizing.ts:338-348`) | `2030년 기본 시나리오 ${y}B (계산: 2026 기준 × 셀별 기본 CAGR 복리)` | version grade | growth |
| `s1_competitive` | `matrix.competitive.structure` | `경쟁 구조: {structure}` | version grade | viability, scope |
| `s1_chain` | `chainDirection.position` + `chainGrade` | `가치사슬 위치: {position} (사슬 등급 {g}, hops {n})` | chain grade | viability, scope |
| `s1_region_mix` | `matrix.regions` with weights | `지역 믹스: {code} {w}% · …` | version grade | scope |
| `s1_segments` | `matrix.segments` | `세그먼트: {label} · …` | version grade | scope |
| `s1_opportunity_factor` (≤ 3) | `qualitative.opportunityFactors[i]` | `기회 요인: {text}` | `정성 분석` section grade, else version grade | growth, viability |
| `s1_risk_factor` (≤ 3) | `qualitative.riskFactors[i]` | `위험 요인: {text}` | same | growth, viability |
| `stage_financial` (≤ 4) | `fact_industry` rows (`readStageFinancials`) | `단계 재무: {metric_key}={value} ({period}, rev{n})` | null (record has no grade column; shown as `—`) | viability |
| `stage_financial_gap` | 0 stage financial rows | `가치사슬 단계별 재무: 데이터 없음` | null | viability |
| `s3_capability_summary` | capability register | `S3 필요 역량 {n}건 (필수 {k}건)` | null | none (context only) |

Notes:

- The catalog replaces the free-form context lines in the user message. Each line is sent as
  `[E3] S1 v7 · 위험 요인: … · 신뢰도 U` so the model sees the id, source, and grade together.
  The existing `manifest` array keeps its current content (the UI's proposal-artifact line
  stays truthful).
- `s3_capability_summary` is in the catalog so the manifest stays complete, but it is not
  citeable. Capability fit is judged per candidate at S7 (t-05, t-07), as the 2026-11-11
  design fixed. The full S3 rows stay out of the visible conclusion; they remain in the user
  message under a heading saying they are context, not criteria.
- When a field is absent from the payload, its item is not created. The model cannot cite
  what does not exist. Absence is shown explicitly by the server where it matters
  (`stage_financial_gap`, and `미기록` in growth figures, see §7.2).
- The S1 matrix stores no measured historical series. The `s1_trend_cagr` figure is the S1
  pipeline's past-growth extension (`우리 추정(과거 성장률 연장)`,
  `lib/market-sizing-pipeline.ts:1404`). The design labels it `추세 연장 CAGR`, never
  `과거 CAGR`, so it is not mistaken for a measured history (open question Q2).
- S2 entry market is not added in this batch (Q5). The growth verdict is about the S1
  industry market, and mixing in the subject-market growth rate would repeat the
  subject-versus-industry confusion the 2026-11-11 design removed.

### 4.2 Grade ordering

`A > B > B- > C > C- > D > U`. A row's grade is the worst grade among its kept figures' items.
A row with no kept figures has no grade (shown `—`) and its label is forced to unverified
(§6.4).

## 5. Prompt contract (`s6.universe_criteria_draft@3`)

The prompt text is edited by the implementation dispatch. This design fixes its content.
The closed five-section skeleton and the Hangul-only-in-`# Language`-and-`# Output contract`
rule (`scripts/co-newbiz/generate-prompt-registry.ts`) are preserved.

- `# Evidence boundary` — unchanged in spirit, plus: "The evidence is a numbered catalog. Cite
  catalog ids only. Copy every number exactly as it appears in the cited item. Never compute,
  convert, or round a number that is not in the catalog."
- `# Task` — in this order:
  1. "State the growth conclusion: an outlook label, a trend label, one verdict sentence, and
     up to four figures that carry it, each with its catalog id and role."
  2. "State the business-viability conclusion: a status, one verdict sentence, up to three
     figures, and the specific data that is missing. Viability is the profit pool, margin
     structure, and pricing power of the value-chain stage the candidates sit in. When no
     value-chain stage financial item is cited, the status cannot be supported."
  3. "State the candidate pool as the consequence of those two conclusions: the industry,
     region, and size scope, one sentence each, describing which companies are in the pool."
  4. "Write conclusions, not process. Never describe how the criteria were derived, which
     outputs were used, or what was excluded. Never name source stages in the visible text;
     sources live in the catalog ids."
  5. The technical-capability prohibition from the 2026-11-11 design stays, rephrased as an
     output rule: "No scope sentence names a capability, certification, or track-record
     condition." There is no instruction to report compliance.
- `# Output contract` — the exact schema in §6.1, ONE JSON object, no code fences, field
  length limits, role and enum vocabularies.
- `# Language` — Korean values; the unverified marker is pinned here as `"검증 필요"`; the
  forbidden derivation endings (§6.4) are listed here as examples of what not to write; the
  outlook, trend, and status words are given in Korean for the verdict sentences.
- `# Proposal-only disclaimer` — unchanged. The model no longer writes a disclaimer sentence
  in its values; the UI carries the proposal notice as chrome (§8.1).

The call-site constant becomes `UNIVERSE_CRITERIA_PROMPT_VERSION =
"s6.universe_criteria_draft@3"`. `maxTokens` stays 800 (the output is shorter than today's
prose plus rationale).

## 6. Data contract

### 6.1 LLM output schema (what the model returns)

```json
{
  "growth": {
    "outlook": "growing | flat | declining | unverified",
    "trend": "accelerating | steady | slowing | unknown",
    "verdict": "string, ≤ 100 chars",
    "figures": [{ "ref": "E2", "role": "size | trend_cagr | forward_cagr | projection", "value": "string, ≤ 24 chars" }]
  },
  "viability": {
    "status": "supported | partial | unverified",
    "verdict": "string, ≤ 100 chars",
    "figures": [{ "ref": "E9", "role": "margin | profit_pool | pricing", "value": "string, ≤ 24 chars" }],
    "missing": ["string, ≤ 60 chars"]
  },
  "scope": { "industry": "string, ≤ 120", "region": "string, ≤ 120", "size": "string, ≤ 120" }
}
```

Caps: growth figures ≤ 4, viability figures ≤ 3, missing ≤ 4. Unknown keys are dropped.

### 6.2 Normalized draft (what the route returns, and what applying stores)

```ts
interface UniverseDraftView {
  presentation_version: 1;
  origin: "ai" | "deterministic";
  growth: {
    outlook: "growing" | "flat" | "declining" | "unverified";
    trend: "accelerating" | "steady" | "slowing" | "unknown";
    verdict: string;                       // ≤ 100 chars
    figures: Array<{ ref: string; role: string; label: string; value: string; grade: Grade | null }>;
    grade: Grade | null;                   // worst of kept figures
    basis: "structured" | "quoted" | "none";
  };
  viability: {
    status: "supported" | "partial" | "unverified";
    verdict: string;
    figures: Array<{ ref: string; role: string; label: string; value: string; grade: Grade | null }>;
    missing: string[];
    grade: Grade | null;
  };
  scope: { industry: string; region: string; size: string };   // "" = not proposed
  evidence: Array<{ id: string; kind: string; ref: string; version_id: string | null; fact: string; grade: Grade | null }>;
  checks: {
    dropped_figures: Array<{ ref: string; value: string; reason: "unknown_ref" | "not_citeable" | "untraced" }>;
    untraced_numbers: Array<{ field: string; token: string }>;
    forbidden_phrases: Array<{ field: string; match: string }>;
    overrides: Array<{ field: string; from: string; to: string }>;
  };
}
```

`label` is a server label per role (for example `시장 규모`, `추세 연장 CAGR`,
`전망 CAGR`). `evidence` contains only the items cited by kept figures, plus the items the
server attaches by rule (the `stage_financial_gap` item whenever viability is not supported,
and the `s1_identity` item whenever a scope line is present). The id numbering is the
catalog's, so gaps in the list are expected.

Response envelope (route): the existing fields `source`, `provider`, `note`, `manifest`,
`prompt_version`, `provenance` stay. New field `draft: UniverseDraftView | null`. The legacy
field `criteria` stays for one release as a projection, so the MCP tool and existing tests do
not break: `{industry, region, size}` from `scope`, `viability` from
`viability.verdict` (plus `missing` joined), `rationale: ""`. The parse-validity rule changes
from "industry present" to "at least one of growth, viability, or scope.industry survived
normalization".

### 6.3 Number traceability (server check)

Tokenizer: numeric tokens matching `[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[-+]?\d+(?:\.\d+)?`, with
commas removed. Exempt tokens: those preceded by `v` (versions), `E` (catalog ids), or
`hops `, and integers 0–12 with no following unit (`%`, `$`, `B`, `M`, `억`, `조`, `원`,
`년`, `배`) — counts and ordinals.

Catalog side: each item's `numbers` holds the tokens in its `fact` plus derived equivalents:
a percent figure also stored as its fraction and vice versa (the S1 matrix stores CAGRs as
fractions; the fact prints percent), and every value rounded to 0, 1, and 2 decimals.

A token `t` with `d` decimals is traced when some item value `v` satisfies `round(v, d) = t`.
Four-digit tokens from 1990 to 2100 are treated as years and must appear literally in some
item's `years`.

Application:

- **Figures** must trace against the item they cite, and that item's `citeable_in` must
  include the row. Otherwise the figure is dropped and recorded in `dropped_figures`.
- **Verdict sentences and scope lines** must trace against any catalog item. An untraced
  token is recorded in `untraced_numbers`, and the field is replaced (§6.4).
- Rounding is allowed in the shown precision (`$39.9B` traces to 39.88). Unit conversion is
  not (`약 398억 달러` does not trace). The prompt tells the model to copy values exactly, so
  this is a deliberate strictness, listed under risks.

### 6.4 Labels, forbidden phrases, and replacement

**Outlook (server-computed, D4).** The forward figure is the kept figure with role
`forward_cagr`; if none, the `trend_cagr` figure acts as the forward base. Thresholds (Q1):

| Outlook | Forward CAGR f | ko label |
|---|---|---|
| `growing` | f ≥ 3.0% | `성장` |
| `flat` | −1.0% < f < 3.0% | `정체` |
| `declining` | f ≤ −1.0% | `역성장` |
| `unverified` | no parsable forward or trend figure kept | `검증 필요` |

**Trend.** When both a `trend_cagr` and a `forward_cagr` figure are kept: `slowing` if
forward < trend − 1.0pp, `accelerating` if forward > trend + 1.0pp, else `steady`
(`basis: "structured"`). When only a quoted figure exists (a risk or opportunity factor), the
model's trend is kept only if the cited item's fact contains `둔화`/`감속` (slowing) or
`가속`/`확대` (accelerating); otherwise `unknown` (`basis: "quoted"`). Any server change to
the model's outlook or trend is recorded in `overrides`.

**Viability status cap.** `supported` requires at least one kept figure citing a
`stage_financial` item. Without one, `supported` is capped to `partial` when a kept figure
cites `s1_competitive`, `s1_chain`, or a qualitative factor, else to `unverified`. When the
status is not `supported` and `missing` is empty, the server fills the default missing list:
`가치사슬 단계별 영업이익률`, `단계별 이익 풀(매출 × 이익률)`, `가격 결정력 근거`.

**Forbidden phrases** (visible text: both verdicts and the three scope lines):

- derivation patterns: `(근거|바탕|토대)로`, and
  `(설정|처리|제외|반영|도출|판단)(했|하였|하여|하도록)`;
- source naming: `S\d{1,2}` as a word, `산출물`;
- disclaimer leakage: `제안이며`, `확정되어야`;
- scope lines only, the capability terms from the 2026-11-11 rule: `인증`, `실적`,
  `기술력`, `트랙 ?레코드`.

Adjectival uses such as `제외한` stay allowed, so a scope line like `중국을 제외한 지역`
passes.

**Replacement (D5).** A field that fails the forbidden-phrase or number check is replaced:

- `growth.verdict` becomes `{outlook label}[ · {trend label}] 전망`;
- `viability.verdict` becomes `검증 필요 — 근거 데이터 없음` for unverified, or
  `{status label}` otherwise;
- a scope line becomes `""` (shown as not proposed; a person writes it).

The modal preview shows the count of replaced fields (§8.2). A second LLM repair call was
considered and rejected: it doubles latency and cost for a rule the server can enforce
mechanically.

### 6.5 Deterministic fallback (D7)

When `completeOrFallback` does not return LLM text, the route returns `source: "synthesis"`,
`draft.origin: "deterministic"`:

- growth: figures from structured items only (`s1_anchor`, `s1_trend_cagr`,
  `s1_external_forecast` as forward, `s1_projection`); outlook and trend computed by §6.4;
  verdict from the template; `basis: "structured"`, or `unverified` when no CAGR item exists;
- viability: a `stage_financial` figure only when rows exist and status `partial` (a margin
  number alone does not make a verdict); otherwise `unverified` with the default missing
  list;
- scope: all three `""`.

The existing no-grounding guard (neither S1 nor S3 evidence) is unchanged: no draft at all.

### 6.6 Record (`target_universe_json`) — additive keys

| Key | Type | Write rule (PUT) |
|---|---|---|
| `definition` | string (existing, required) | When `scope_lines` is sent, the client composes `definition` as the labelled lines `산업: …` / `지역: …` / `규모: …` joined by newlines. Legacy records keep their free text. |
| `criteria`, `scope`, `financial_criteria`, `min_long_list` | existing | unchanged. On apply, `financial_criteria` is filled from `viability.verdict` plus `missing` when the field is empty (same as today's mapping). |
| `presentation_version` | `1` | set when any new key is present. |
| `growth` | the §6.2 growth object, without `basis` | preserve when absent; `null` clears. |
| `viability` | the §6.2 viability object | preserve when absent; `null` clears. |
| `scope_lines` | `{industry, region, size}` | preserve when absent. |
| `evidence` | the §6.2 evidence array | preserve when absent; replaced as a whole when sent. |
| `origin` | `{growth, viability, scope}` each `ai` / `deterministic` / `person` | set by the client: `person` when the saved text differs from the applied draft text. |
| `drafted` | `{prompt_version, generated_at}` | set on apply; kept for audit of which prompt produced the wording. |

PUT normalization (server, mirrors §6.1 caps with headroom for hand edits): enum values
outside the vocabulary are dropped to `unverified` / `unknown`; verdicts ≤ 160 chars; scope
lines ≤ 160; `missing` ≤ 4 × 80; figures ≤ 4 each, and a figure whose `ref` is not an
`evidence` id is dropped; evidence ≤ 16 items, `id` must match `^E\d{1,2}$`, `fact` ≤ 200.
The PUT does not re-run number tracing: a person saving the record is recording it
(boundary 2), and hand-typed text is their responsibility. Figures and evidence are not
editable in the UI (§8.3), so they reach the record only from a server-built draft.

Backward compatibility: GET passes the JSON through unchanged. A record without
`presentation_version` renders in the legacy layout (§8.1). The S7 screening-draft route
(`targets/[targetId]/screening-draft/route.ts:178-180`) and the S6 web-search route read
`definition`, which now holds the labelled scope text — better context than the old
narrative, with no code change there. No backfill: an older record converts when someone
applies a new draft and saves.

## 7. Worked example (the live record above)

Only facts in the example are used. Values not in the example are shown as `{placeholder}`.

### 7.1 Catalog the server would build (relevant items)

```
[E1] S1 v7 · 산업 정의: 원자력 발전소 (고정 버전 v7) · 신뢰도 U
[E2] S1 v7 · 기준 시장규모 $39.88B (2026, 글로벌) · 신뢰도 U
[E3] S1 v7 · 추세 연장 CAGR {consistency.bottomUpCagr — 예시에 값 없음, 없으면 항목 미생성} · 신뢰도 U
[E8] S1 v7 · 가치사슬 위치: 미드스트림 (사슬 등급 C, hops 0) · 신뢰도 C
[E9] S1 v7 · 지역 믹스: {지역 코드와 비중 — 예시에 값 없음} · 신뢰도 U
[E12] S1 v7 · 위험 요인: 2026–2031 CAGR 0.73% 성장 둔화 [1] · 신뢰도 {정성 분석 섹션 등급, 없으면 U}
[E14] S1 v7 · 가치사슬 단계별 재무: 데이터 없음 · —
```

E12 is labelled S1, not S3, because the server, not the model, writes the source.

### 7.2 Normalized draft (abridged)

```json
{
  "growth": {
    "outlook": "flat", "trend": "slowing", "basis": "quoted",
    "verdict": "시장 정체 — 2026–2031 CAGR 0.73%의 저성장 전망",
    "figures": [
      { "ref": "E2", "role": "size", "label": "시장 규모", "value": "$39.88B (2026)", "grade": "U" },
      { "ref": "E12", "role": "forward_cagr", "label": "전망 CAGR", "value": "0.73% (2026–2031)", "grade": "U" }
    ],
    "grade": "U"
  },
  "viability": {
    "status": "unverified",
    "verdict": "검증 필요 — 미드스트림 단계의 이익 풀·마진·가격 결정력 근거 없음",
    "figures": [],
    "missing": ["가치사슬 단계별 영업이익률", "단계별 이익 풀(매출 × 이익률)", "가격 결정력 근거"],
    "grade": null
  },
  "scope": {
    "industry": "원자력 발전소 산업 미드스트림 단계의 공급 기업 전체 (정체 시장 — 단계 안에서 범위를 좁히지 않음)",
    "region": "{지역 믹스 상위 지역} 소재 기업, 지역 믹스 전체를 포괄",
    "size": "규모 하한 미정 (검증 필요) — 단계 재무 확보 전까지 후보별 재무로 판단"
  },
  "evidence": ["E1", "E2", "E8", "E12", "E14 (as full items)"],
  "checks": { "dropped_figures": [], "untraced_numbers": [], "forbidden_phrases": [], "overrides": [] }
}
```

Checks on this sample: `0.73`, `2026`, `2031` trace to E12; `39.88` and `2026` trace to E2.
Outlook `flat`: f = 0.73% is inside (−1.0%, 3.0%). Trend `slowing` is kept because E12's
fact contains `둔화`. The growth grade is U (worst of E2 and E12). Viability cannot be
supported (no `stage_financial` item), so it is `unverified` with the default missing list.
If an `s1_trend_cagr` value existed (E3), the trend would be computed structurally instead.

### 7.3 Before and after on the card

Before (today; `definition` = the model's `rationale`): the five-line narrative in §1.

After:

```
목표 시장 정의                                                    [수정]
성장성   [정체] [둔화]   시장 규모 $39.88B (2026) · 전망 CAGR 0.73% (2026–2031)   [신뢰도 U]
         시장 정체 — 2026–2031 CAGR 0.73%의 저성장 전망
사업성   [검증 필요]                                                       [신뢰도 —]
         검증 필요 — 미드스트림 단계의 이익 풀·마진·가격 결정력 근거 없음
         필요 데이터: 가치사슬 단계별 영업이익률 · 단계별 이익 풀(매출 × 이익률) · 가격 결정력 근거
산업     원자력 발전소 산업 미드스트림 단계의 공급 기업 전체 (정체 시장 — 단계 안에서 범위를 좁히지 않음)
지역     {지역 믹스 상위 지역} 소재 기업, 지역 믹스 전체를 포괄
규모     규모 하한 미정 (검증 필요) — 단계 재무 확보 전까지 후보별 재무로 판단
최소 후보 수  {min_long_list}
▸ 근거 5건
AI 초안 · 사람이 저장 {date}
```

Expanded evidence (`<details>`), one line per item: `E2 · S1 v7 · 기준 시장규모 $39.88B
(2026, 글로벌) · 신뢰도 U`.

## 8. UI

### 8.1 The `목표 시장 정의` card (`UniverseSection.tsx`)

A shared presentational component `UniverseVerdictView` (new file in
`components/stages/brownfield/`) renders a `UniverseDraftView`-shaped value. The card and
the modal preview both use it.

Layout, top to bottom, as a `<dl>` with a two-column grid (`dt` label column of fixed width,
`dd` content), one row per item:

1. **Growth row** — `dt` `성장성`; `dd` line 1: outlook chip (text label, for example
   `정체`), trend chip when not `unknown` (`둔화` / `가속` / `유지`), the figures as
   `{label} {value}` separated by ` · `, and the grade chip `신뢰도 {grade}` (or `신뢰도 —`).
   Line 2: the verdict sentence.
2. **Viability row** — `dt` `사업성`; line 1: status chip (`근거 있음` / `부분 근거` /
   `검증 필요`), figures, grade chip. Line 2: verdict. Line 3, when `missing` is non-empty:
   `필요 데이터: a · b · c`.
3. **Scope rows** — `산업`, `지역`, `규모`, one sentence each; an empty line renders
   `미제안` in muted text.
4. Existing `커버리지` (legacy `scope`) and `최소 후보 수` lines, unchanged.
5. **Evidence** — `<details>` collapsed by default, summary `근거 {n}건`; each item
   `{id} · {ref} · {fact} · 신뢰도 {grade}`.
6. **Origin line** (muted caption): `AI 초안` / `결정론 요약 (AI 아님)` / `사람 작성`, per
   the record's `origin`, plus the proposal notice in the modal (§8.2). The card shows a
   saved record, so it carries no "verified" or "PASS" wording.

Rules:

- Status never by color alone: every chip carries its word; amber or green tone is
  decoration (Onyx `status-chip` classes). `검증 필요` always appears as text.
- Wrapping, no truncation: `dd` uses `whitespace-pre-wrap` and `[overflow-wrap:anywhere]`;
  no `truncate` or `line-clamp` anywhere in the card. Chips wrap with `flex-wrap`.
- The card keeps the existing `sizing-grade-card` container and the `md:grid-cols-[2fr_3fr]`
  split with the discovery card.
- Legacy records (no `presentation_version`): render as today (coverage line plus the
  `definition` paragraph), plus the `financial_criteria` line under a `사업성` label when it
  is present (it is saved but not shown today), plus a muted hint
  `이전 형식 — 초안을 다시 만들면 성장성·사업성이 먼저 표시됩니다`.
- design-lint must pass (no hard-coded colors, no icon-only buttons without `aria-label`).

### 8.2 Draft preview in the edit modal (`DiscoveryPanels.tsx`, `UniverseEditModal`)

The current list (`industry` / `region` / `size` / `viability` items, then `근거:` with the
rationale, `DiscoveryPanels.tsx:265-330`) is replaced by `UniverseVerdictView` over
`uniReco.draft`, with the evidence `<details>` collapsed. Under it: the proposal notice
`AI 제안 — 사람이 검토하고 저장해야 기록됩니다`, the existing manifest line, and, when
`checks` has entries, a muted line `형식 규칙에 맞지 않은 문구 {n}건을 기본 문구로 대체했습니다`
plus `근거에 없는 수치 {n}건 제외`. The `rationaleAlreadySaved` logic is removed; the apply
button's disabled state compares the applied draft's `drafted.generated_at` with the
record's.

### 8.3 Edit behavior

`applyUniReco` fills the form state from `draft`: growth (outlook, trend, verdict), viability
(status, verdict, missing), scope lines, and carries `figures`, `evidence`, and `drafted` as
read-only payload. `financial_criteria` is filled from the viability verdict plus missing only
when empty.

The form (`universeForm` in `useBrownfieldUniverse.tsx`) gains:

- `성장성 판단`: outlook `<select>`, trend `<select>`, verdict `<textarea rows=2>`;
- `사업성 판단`: status `<select>`, verdict `<textarea rows=2>`, missing data
  `<textarea rows=2>` (one item per line);
- `산업`, `지역`, `규모`: one `<input>` each — shown instead of the free `정의` textarea when
  the record or applied draft has `presentation_version`; the legacy `정의` textarea is
  shown otherwise;
- figures and evidence as a read-only list labelled `근거 (AI 초안에서 가져옴 · 편집 불가)`;
- the existing `재무 기준` textarea and `최소 후보 수`, unchanged.

Saving sends the new keys plus the composed `definition` (§6.6). When a person changes an
outlook, status, or verdict away from the applied draft, `origin.{row}` becomes `person` and
the card shows `사람 작성` for the record. A person may set any label; the figures and grade
chips stay the server-traced ones, so a person-chosen `성장` next to `CAGR 0.73%` stays
visibly inconsistent rather than silently "fixed". That is intended: the record is the
person's, and the evidence is what it is.

### 8.4 Locale keys (ADR-0184)

New namespace `stages.s67.universeCard` in `locales/ko.json` and `locales/en.json`; the
frontend-engineer finalizes keys. Enum words are rendered through keys, never stored in
Korean (the record stores `flat`, not `정체`).

| English meaning | Korean label (ko master) | Locale key (proposed) |
|---|---|---|
| Growth row label | `성장성` | `stages.s67.universeCard.growth` |
| Viability row label | `사업성` | `stages.s67.universeCard.viability` |
| Outlook: growing / flat / declining / unverified | `성장` / `정체` / `역성장` / `검증 필요` | `.outlook.growing` / `.flat` / `.declining` / `.unverified` |
| Trend: accelerating / steady / slowing | `가속` / `유지` / `둔화` | `.trend.accelerating` / `.steady` / `.slowing` |
| Viability status: supported / partial / unverified | `근거 있음` / `부분 근거` / `검증 필요` | `.status.supported` / `.partial` / `.unverified` |
| Grade chip | `신뢰도 {grade}` / `신뢰도 —` | `.grade` / `.gradeNone` |
| Missing data prefix | `필요 데이터:` | `.missing` |
| Scope rows | `산업` / `지역` / `규모` | `.scopeIndustry` / `.scopeRegion` / `.scopeSize` |
| Scope line not proposed | `미제안` | `.notProposed` |
| Evidence summary | `근거 {n}건` | `.evidenceCount` |
| Origin: AI draft / deterministic / person | `AI 초안` / `결정론 요약 (AI 아님)` / `사람 작성` | `.origin.ai` / `.deterministic` / `.person` |
| Proposal notice | `AI 제안 — 사람이 검토하고 저장해야 기록됩니다` | `.proposalNotice` |
| Replaced fields notice | `형식 규칙에 맞지 않은 문구 {n}건을 기본 문구로 대체했습니다` | `.replaced` |
| Dropped figures notice | `근거에 없는 수치 {n}건 제외` | `.droppedFigures` |
| Legacy record hint | `이전 형식 — 초안을 다시 만들면 성장성·사업성이 먼저 표시됩니다` | `.legacyHint` |
| Read-only evidence label in form | `근거 (AI 초안에서 가져옴 · 편집 불가)` | `.evidenceReadOnly` |
| Growth / viability judgement field labels | `성장성 판단` / `사업성 판단` | `.growthField` / `.viabilityField` |

## 9. Test plan

Under `tests/unit/`, extending `s6-universe-draft-route.test.ts` and
`brownfield-llm-support.test.ts` fixtures (temp SQLite via `CO_NEWBIZ_DB_PATH`).

1. **Catalog builder (pure).** Fixture matrix with anchor, consistency, externalForecast,
   regions, chain, qualitative with `정성 분석` section grade, plus 0 and 2 `fact_industry`
   rows. Assert ids, kinds, refs (`S1 v7`), grades, `numbers` including fraction/percent
   equivalents, the gap item when rows are 0, absent items when payload fields are absent,
   and that the S3 summary is not citeable.
2. **Normalizer (pure, new `lib/universe-presentation.ts`).** Cases: the §7 sample passes
   with zero checks; a figure citing an unknown id, a non-citeable kind, or an untraced value
   is dropped; `$39.9B` traces, `약 398억 달러` does not; a year not in the catalog fails;
   exempt tokens (`v7`, `hops 0`, `3개`) pass; each forbidden pattern triggers replacement
   and is recorded; `제외한` passes; capability terms fail only in scope lines; outlook bands
   at the 3.0 / −1.0 boundaries; structured trend vs quoted trend (`둔화` present or absent);
   viability `supported` without a stage-financial figure is capped; the default missing list
   is filled; length caps; unknown keys dropped.
3. **Route.** Envelope has `draft`, legacy `criteria` projection (`rationale: ""`),
   `prompt_version` `@3`; the user message carries `[E#]` lines; LLM failure returns the
   deterministic draft (growth figures present when CAGR items exist, scope empty,
   `origin: "deterministic"`); no-grounding unchanged; parse failure unchanged; the greenfield
   track guard unchanged (`brownfield-route-track-guard.test.ts`).
4. **Record (PUT/GET).** New keys persist; omitted keys are preserved; `null` clears; bad
   enums fall back; figure with a ref not in `evidence` is dropped; caps; legacy body
   (definition + financial_criteria only) behaves as today; GET passes keys through.
5. **UI.** The card renders the growth row before the viability row before the scope rows;
   chips contain text; evidence is collapsed by default; no `truncate` / `line-clamp` class
   in the rendered card; a legacy record renders the old layout plus the hint and the
   `financial_criteria` line; apply fills all fields; editing a verdict sets `origin` to
   `person`; save sends the composed `definition`.
6. **Prompt registry.** `bun scripts/co-newbiz/generate-prompt-registry.ts` passes the machine
   bar; snapshot of the `@3` system text; assertions that `rationale` is gone from the output
   contract and the catalog-citation rule is present.
7. **Gates.** `bun run design:lint`, i18n parity (ko/en key sets), `bun scripts/audit.ts`.

## 10. Work breakdown

| Row | Agent | Scope | Size |
|---|---|---|---|
| 1 | backend-engineer | Prompt `@3` text in `prompts.json` + registry regen; `buildUniverseEvidenceCatalog` in `lib/brownfield-universe.ts`; new pure `lib/universe-presentation.ts` (tracing, labels, forbidden phrases, replacement, deterministic fallback); route envelope (`draft`, legacy `criteria` projection); PUT normalization of the new keys in `targets/route.ts`; `types.ts` additions (`UniverseDraftView`, record keys); tests 1–4 and 6. | small–medium |
| 2 | frontend-engineer | `UniverseVerdictView`; `UniverseSection` card; modal preview in `DiscoveryPanels`; form and apply/save in `useBrownfieldUniverse` and `useBrownfieldBase` state; locale keys; tests 5 and 7. Depends on Row 1 types. | small–medium |
| — | follow-up | Wiki page `docs/wiki/ko/50-…` card description refresh (handbook-sync-audit will flag it). | small |

## 11. Risks

| Risk | Mitigation |
|---|---|
| Strict tracing drops honest prose (unit conversion, Korean number words). | The prompt says copy values exactly; replacements are counted in the preview, so drift is visible; the figures row still shows the numbers. |
| Forbidden-phrase false positives remove a good scope line. | Patterns are narrow (finite derivation endings, not stems); the line becomes `미제안`, not a fabricated text; a person writes it. |
| One threshold set for all industries (a long-cycle nuclear market reads as `정체`). | The label is a reading aid next to the figures, not a decision; thresholds are a user choice (Q1). |
| A person picks a label that contradicts the figures. | Allowed by design (boundary 2); the traced figures and grade stay beside it. |
| Evidence goes stale after an S1 rerun. | `evidence[].version_id` is stored; a staleness marker is a follow-up (§12). |
| MCP or scripts read `criteria.rationale`. | The legacy projection is kept for one release with `rationale: ""`. |
| The draft looks more authoritative because it is structured. | No PASS wording; `검증 필요` and the grade chip are always visible; the proposal notice stays on the modal; the origin line stays on the card. |

## 12. Open questions for the user (with recommendation)

| # | Question | Recommendation |
|---|---|---|
| Q1 | Outlook thresholds: `성장` ≥ 3.0%, `정체` between −1.0% and 3.0%, `역성장` ≤ −1.0%; trend gap 1.0pp. | Accept. Revisit per industry later if needed. |
| Q2 | The S1 bottom-up figure is a past-growth extension, not a measured history. Label it `추세 연장 CAGR` (not `과거 CAGR`)? | Yes, `추세 연장 CAGR`. |
| Q3 | When the LLM is down, show deterministic growth/viability rows (figures and template wording, no scope)? | Yes. |
| Q4 | Untraceable number in a verdict or scope line: replace the field (recommended), reject the whole draft, or keep it with a warning chip? | Replace the field and count it. |
| Q5 | Add the S2 entry market to the catalog now? | No, defer; it is the subject market and would blur the industry growth verdict. |
| Q6 | Older records: hint to regenerate, no automatic conversion? | Yes. |
| Q7 | Edit form: labels and wording editable, figures and evidence read-only? | Yes. |
| Q8 | Keep `financial_criteria` (the S7 t-08 bar for candidates) separate from the market-level viability verdict? | Yes, keep both; prefill one from the other only when empty. |

## 13. Follow-up note: other stage proposals (not designed here)

Several prompts share the pattern that produced this complaint: a free narrative field
described as "cite the outputs". `s3.attractiveness_recommendation`
(`rationale_draft`, cite the S1 outputs), `s4.route_recommendation` (`rationale_draft`),
`s5.entry_strategy_draft` (rationale citing the S3 gaps), `s8.business_case_adoption`
(`rationale_draft`, 3 to 5 sentences citing figures), and
`s10.deal_structure_recommendation` (rationale citing the S4, S8, and S9 outputs).
`s7.screening_draft` has per-item rationales, which are a lower risk because each sits
under a verdict. S3, S4, and S8 already lead with a structured verdict (score, track, model
id), so the narration is secondary there. S5 and S10 are the most likely to read as process
text. Not checked on screen. Recommendation: one audit pass applying this design's pattern
(conclusion fields first, a server-built evidence catalog, server-side number tracing),
scoped stage by stage. Other follow-ups: a staleness marker on `evidence[].version_id`
versus the current pinned S1 version; S2 entry market as a size-scope evidence item if Q5
changes.
