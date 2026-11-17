# S6 Target Universe Card: Evaluation Target Direction Review

- Spec ID: `2026-11-17-s6-universe-direction-review`
- Date: 2026-11-17
- Status: approved 2026-11-17 (all five open-question recommendations accepted; label `평가 대상 방향성` confirmed)
- Supersedes: `2026-11-17-s6-universe-growth-viability-presentation`. That doc is withdrawn
  and was never implemented (no `buildUniverseEvidenceCatalog` exists, and the route still
  pins `s6.universe_criteria_draft@2`). Its root-cause analysis (§2) and its evidence-catalog
  and number-tracing mechanics (§4, §6.3) still hold and are reused here by reference. Its
  growth/viability verdict rows, outlook thresholds and label engine (§6.4 labels, §7, §8) are
  dropped.
- Author: brownfield-agent (S6 `target-universe-definition` owner). Row 0 design, PM dispatch.
- ADR: none. There is no DB schema change (`opportunity.target_universe_json` is a JSON column,
  migration 0062), no auth change and no MCP tool scope change, and `procedures/` and
  `flow.spec.yaml` are not touched. PM records a DEC entry for the prompt contract change.
- Keeps: DEC-20261111-05 (pinned S1 resolution, `financial_criteria` key, honest unset).
  Related: ADR-0118, ADR-0139, ADR-0184, ADR-0187, and boundaries 2 and 4.

## 1. Problem

The owner decided on 2026-11-17 that the S6 card should review the direction of the
evaluation targets. It should tell a reviewer which kind of companies the longlist should
look at, and why. It should not present market growth or viability. Today the proposal only
narrates how the definition was derived: `applyUniReco`
(`components/stages/brownfield/useBrownfieldUniverse.tsx:261`) copies the model's
`rationale` into `definition`, and `UniverseSection.tsx` renders `definition` as the card
body, which hides the conclusion. The old doc's §2 gives the full root cause: the narrative
output contract, model-written provenance, and prohibition leakage.

The card's label also changes, from `목표 시장 정의` to `평가 대상 방향성` (§7.3).

## 2. Decisions

| ID | Decision |
|---|---|
| D1 | The draft is a structured direction with these fields: headline, scope (industry / region / size), value-chain position, candidate types to prioritise, directions to exclude, and a one-line basis. The free `rationale` field is removed from the contract. |
| D2 | Every direction field carries catalog refs (`E1..En`). Sources are server facts and the model never writes provenance text. This reuses the old doc's §4 catalog, with the citeable mapping changed (§4.1). |
| D3 | Growth and viability shrink to one supporting line that the server composes from S1 catalog items. There is no LLM wording, no thresholds and no outlook labels. |
| D4 | The server clamps lengths, checks citations, traces every number to a cited item, and marks uncited fields `검증 필요`. A failing field is emptied, never rewritten into new claims. |
| D5 | Storage is additive keys in `target_universe_json`. `definition` becomes the labelled direction text, so downstream readers keep working unchanged. |
| D6 | The output is proposal-only. A person edits and saves, which is the record (boundary 2). The card carries no PASS or "verified" wording. |

## 3. What the direction card contains

| Field | Content | Allowed refs (catalog kinds) |
|---|---|---|
| Headline | One sentence: which companies the longlist should look at. | any direction-citeable item |
| Scope: industry / region / size | One sentence each, describing who is in the pool. | `s1_identity`, `s1_segments`, `s1_region_mix`, `s1_anchor` (size) |
| Value-chain position | The stage or stages to look at, e.g. midstream component suppliers. | `s1_chain`, `s1_segments`, `stage_financial*` |
| Prioritise (≤ 3) | Candidate type plus a one-clause reason. | `s1_chain`, `s1_competitive`, `s1_segments`, `s1_region_mix`, qualitative factors, `stage_financial*`, `s3_capability` (Q1) |
| Exclude (≤ 3) | A direction not to pursue plus a one-clause reason. | same as Prioritise minus `s3_capability` |
| Basis | One line tying the direction to S1 and S3, citing ids only. | any citeable item |
| Market support | Server-built line covering size, growth rate and stage profitability (§4.3). | S1 and stage-financial items only |

Rules carried over from DEC-20261111-05: scope and exclude lines never name a capability,
certification or track-record condition. Candidate capability fit is judged per candidate at
S7 (t-05, t-07). Under Q1, a prioritise line may name an S3 required capability as a
preference ("already does X, which fills S3 gap Y"). It is never a pass/fail criterion.

## 4. Reuse

### 4.1 Evidence catalog (old doc §4, adopted with deltas)

Build `buildUniverseEvidenceCatalog` in `lib/brownfield-universe.ts` exactly as the old doc
§4.1 specifies: the `EvidenceItem` shape, kinds, fact formats, grades, `numbers`/`years`,
grade order (§4.2), and absence handling. It does not exist yet. There are three deltas:

1. `citeable_in` uses the field vocabulary
   `"scope" | "value_chain" | "priority" | "exclude" | "basis" | "support"`, mapped as in the
   §3 table. CAGR and projection items are citeable only in `basis` and `support`, so a growth
   number can never become a scope criterion.
2. `s3_capability_summary` is replaced by `s3_capability`: up to 5 items, required rows first,
   built from the same register `s3CapabilityLines` reads (`lib/brownfield-universe.ts:352`).
   The fact format is `S3 필요 역량: {name} ({필수|선택})`, citeable in `priority` and `basis`.
3. No S2 entry-market item in this batch (same as old Q5). See risks.

### 4.2 Route and prompt (`s6.universe_criteria_draft@3`)

- Same route (`app/api/brownfield/[oppId]/universe-criteria-draft/route.ts`) and same key.
  `UNIVERSE_CRITERIA_PROMPT_VERSION` changes from `@2` to `@3` (route.ts:42), and
  `maxTokens` stays at 800. The user message sends catalog lines as `[E3] S1 v7 · {fact} · 신뢰도 U`.
  The `manifest` keeps its current content.
- The prompt keeps the closed five-section skeleton and the Hangul placement rule
  (`scripts/co-newbiz/generate-prompt-registry.ts`).
  - `# Task` order: headline, scope, value chain, prioritise, exclude, basis. "Write which
    companies to look at and why, not how you derived it. Cite catalog ids for every field.
    Copy numbers exactly from the cited item. Never name source stages in visible text."
  - The capability rule becomes an output rule with no request to report compliance.
  - `# Output contract`: the §5.1 schema. `# Language`: `검증 필요` pinned, plus the
    old doc §6.4 derivation endings as examples of what not to write. `# Proposal-only
    disclaimer`: unchanged.
- `purpose` in `prompts.json` becomes `S6 평가 대상 방향성 초안 — S1·S3 근거 인용`. Regenerate
  the registry (`lib/prompts.generated.ts`, `lib/pm-catalog.generated.ts`).

### 4.3 Market support line (server-only)

`{시장 규모 $XB (2026) [E2]} · {성장률 Y% ({kind label}) [Ek]} · {단계 수익성: metric=value [Em] | 검증 필요 [Egap]}`.
The growth source priority is `s1_external_forecast` > `s1_topdown_cagr` > `s1_trend_cagr`,
each labelled by kind (`외부 전망`, `top-down`, `추세 연장`). When no CAGR item exists, the
growth segment reads `성장률 S1 미기록`. In that case a quoted CAGR in a risk or opportunity
factor may appear in the model's basis line, citing that factor. The server never extracts
it. There are no outlook words and no thresholds.

## 5. Data contract

### 5.1 LLM output (one JSON object)

```json
{ "direction": {
  "headline": { "text": "≤ 90", "refs": ["E1"] },
  "scope": { "industry": { "text": "≤ 120", "refs": [] }, "region": { "text": "≤ 120", "refs": [] }, "size": { "text": "≤ 120", "refs": [] } },
  "value_chain": { "text": "≤ 100", "refs": [] },
  "prioritise": [{ "type": "≤ 60", "why": "≤ 80", "refs": [] }],
  "exclude":    [{ "type": "≤ 60", "why": "≤ 80", "refs": [] }],
  "basis": { "text": "≤ 140", "refs": [] } } }
```

### 5.2 Server validation (new pure `lib/universe-direction.ts`)

1. **Shape and clamp.** Unknown keys are dropped. Lists are capped at 3 and refs at 4 per
   field. Text is clamped to its cap at the last word boundary, and each clamp is recorded in
   `checks.clamped`.
2. **Citation check.** A ref must exist in the catalog and be citeable in that field.
   Otherwise it is dropped (`checks.dropped_refs`, reason `unknown_ref | not_citeable`).
3. **Number tracing.** Use the old doc §6.3 tokenizer, exemptions, derived equivalents and
   year rule, with one change: tokens trace against the field's own cited items, not against
   any catalog item. An untraced token empties that field, or drops that list entry, and is
   recorded (`checks.untraced_numbers`). So no number reaches the card without a traceable
   source.
4. **Forbidden phrases.** Use the old doc §6.4 lists (derivation endings, `S\d{1,2}`,
   `산출물`, disclaimer leakage). Capability terms (`인증`, `실적`, `기술력`, `트랙 ?레코드`) are
   checked in scope and exclude only. A failing field is emptied (`checks.forbidden_phrases`).
5. **Honest marker.** Each field gets `unverified: true` when it keeps text but has zero valid
   refs, or when its text contains `검증 필요`. The server never deletes the model's own
   `검증 필요`.
6. **Grade.** `grade` is the worst grade among all kept refs (old §4.2 order). It is a
   confidence chip, not a RAG grade (boundary 4).
7. **Validity.** The draft is valid when the headline or at least one scope field survives.
   Otherwise the route returns the existing parse-failure envelope.
8. **Deterministic fallback.** When the LLM is unavailable, the route returns
   `origin: "deterministic"` with the support line and evidence only, and every direction
   field empty. The existing no-grounding guard is unchanged.

### 5.3 Normalized view and envelope

```ts
interface DirField { text: string; refs: string[]; unverified: boolean }
interface DirItem { type: string; why: string; refs: string[]; unverified: boolean }
interface UniverseDirectionView {
  direction_version: 1; origin: "ai" | "deterministic";
  headline: DirField; scope: { industry: DirField; region: DirField; size: DirField };
  value_chain: DirField; prioritise: DirItem[]; exclude: DirItem[]; basis: DirField;
  support: { segments: Array<{ label: string; value: string; ref: string; grade: Grade | null }> };
  evidence: EvidenceView[];   // cited items only, plus the support-line items
  grade: Grade | null;
  checks: { clamped; dropped_refs; untraced_numbers; forbidden_phrases };
}
```

The envelope adds `draft: UniverseDirectionView | null`. `criteria` stays for one release as
a projection for the MCP `draft_universe_criteria` tool and existing tests: `{industry,
region, size}` from scope, with `viability: ""` and `rationale: ""`.

### 5.4 Record (`target_universe_json`), additive keys, no migration

| Key | Rule (PUT in `targets/route.ts`) |
|---|---|
| `definition` (existing, required) | When `direction` is sent, the client composes labelled lines: `산업:` / `지역:` / `규모:` / `가치사슬:` / `우선:` / `제외:`. It stays the first key, because `deal-shapes/recommend` reads the first 600 characters of the raw JSON. |
| `scope`, `criteria`, `financial_criteria`, `min_long_list` | Unchanged. The direction does not prefill `financial_criteria` (honest unset, DEC-20261111-05). |
| `direction_version` | `1` when `direction` is present. |
| `direction` | The view without `checks` and `origin`. Preserved when absent; `null` clears it. The server re-applies the clamps and drops refs not in `evidence`. It does not re-trace hand edits, because a saving person is recording (boundary 2). |
| `evidence` | Replaced whole when sent. `id` must match `^E\d{1,2}$`, at most 16 items. |
| `origin` | `{headline, scope, value_chain, prioritise, exclude}`, each `ai`, `deterministic` or `person`. |
| `drafted` | `{prompt_version, generated_at}`, set on apply. |

S7 `screening-draft` (route.ts:180) and the S6 web-search route read `definition` and get the
labelled direction text with no code change. Legacy records without `direction_version`
render as today.

## 6. Proposal-only boundary

The route returns a proposal. Only a person's save writes the record, and the agent never
calls the PUT. A person may edit any conclusion text, and that field's origin becomes
`person`. Refs and evidence stay visible next to edited text. There is no auto-save, no
"verified" or PASS wording, and `검증 필요` always renders as text. The Short List cut and all
gates remain human-only (boundary 2).

## 7. UI

### 7.1 Card (`UniverseSection.tsx`, new shared `UniverseDirectionView` component)

```
평가 대상 방향성                                                        [수정]
결론     원자력 발전소 미드스트림 기자재 공급 기업을 롱리스트로 본다          [신뢰도 C]
범위     산업 …  ·  지역 …  ·  규모 … [검증 필요]
가치사슬  미드스트림 (기자재·부품 공급)
우선     1) {유형} — {이유}   2) …
제외     1) {유형} — {이유}
시장 근거 시장 규모 $39.88B (2026) · 성장률 S1 미기록 · 단계 수익성 검증 필요
최소 후보 수  {n}
▸ 근거 보기 (1줄 근거 + 근거 {n}건)
AI 초안 · 사람이 저장 {date}
```

- The conclusion comes first. The basis line and the evidence list sit in one `<details>`,
  collapsed by default.
- It is a `<dl>` grid with wrapping and no truncation (`whitespace-pre-wrap`,
  `[overflow-wrap:anywhere]`). Every chip has a text label and is never color-only. An empty
  field renders a muted `미제안`.
- Legacy record: the coverage and `definition` paragraph as today, plus the muted hint
  `이전 형식 — 초안을 다시 만들면 방향성이 먼저 표시됩니다`.
- The modal preview (`DiscoveryPanels.tsx` `UniverseEditModal`) reuses the component. It adds
  the proposal notice `AI 제안 — 사람이 검토하고 저장해야 기록됩니다` and counts of
  emptied fields and dropped refs, and it removes `rationaleAlreadySaved`.

### 7.2 Editable vs read-only

| Editable (form) | Read-only |
|---|---|
| Headline; industry / region / size; value chain; prioritise and exclude items (type and why, add or remove up to 3); `재무 기준`; `최소 후보 수` | refs, basis line, market support line, evidence, grade chip, `unverified` flags from the draft |

### 7.3 Label rename and inventory

The new label is ko `평가 대상 방향성` and en `Evaluation target direction` (Q2). Locale
values change. Key names stay as they are (opaque ids, three call sites), which avoids
parity churn.

| Location | Current (ko / en) | New (ko / en) |
|---|---|---|
| `common.editTargetMarketDefinition` | `목표 시장 정의 수정` / Edit target market definition | `평가 대상 방향성 수정` / Edit evaluation target direction |
| `stages.s67.universeSection.targetMarketDefinition`, `…targetMarketDefinition2` | `목표 시장 정의` / Target market definition | `평가 대상 방향성` / Evaluation target direction |
| `stages.s67.universeSection.startTargetMarketDefinition` | `목표 시장 정의 시작` / Start target market definition | `평가 대상 방향성 정하기` / Set evaluation target direction |
| `stages.s67.universeSection.notYetDefinedThisIs` | criteria wording | reworded to "which companies the longlist should look at" |
| `stages.s67.useBrownfieldUniverse.failedToSaveTheTarget` | `목표 시장 정의 저장 실패` / Failed to save the target market definition | `평가 대상 방향성 저장 실패` / Failed to save the evaluation target direction |
| `stages.s67.useBrownfieldUniverse.saveTargetMarket` | `목표 시장 저장` / Save target market | `방향성 저장` / Save direction |
| `stages.s67.discoveryPanels.inputsOnlyTheCandidateEligibility` | quotes the `목표 시장 저장` button | quotes `방향성 저장` / "save direction" |
| `stages.s67.discoveryPanels.noCandidatesToProposeRefine` | `…목표 시장 정의를 구체화한…` / …refine the target market definition… | `…평가 대상 방향성을 구체화한…` / …refine the evaluation target direction… |
| `processBlockers.s6_target_universe` | `Target Universe 정의` / Target universe definition | `평가 대상 방향성(Target Universe)` / Evaluation target direction (Target Universe) |
| `lib/review/stage-artifact-labels.ts:31` (S6 flow-banner tab, hardcoded ko, no en) | `S6 대상 기업군(Target Universe) 정의` | `S6 평가 대상 방향성(Target Universe)`. The key `stage:S6:1` is unchanged. `review-coverage.test.ts` checks keys and non-empty labels only. |
| `targets/route.ts:86` error text | "definition (target market definition) is required." | "definition (evaluation target direction) is required." |
| `docs/wiki/ko/50-…`, `51-…` | old label | follow-up handbook refresh |

Unchanged: `killCriteria.titles.universe_cannot_be_defined`, the checklist kill-criterion
title, which is referred to glossary-curator for its odd ko `대상 우주`. `flow.spec.yaml`,
procedures, the DB key and the API also stay unchanged.

**Glossary.** `Target Universe` has no entry in `glossary/*.yaml`. It is the process and
artifact name in `flow.spec.yaml` (S6 outputs, requiredArtifacts). Rule: `Target Universe`
stays the process and record name, and `평가 대상 방향성` is the UI label of the card that
presents it. The tab and blocker labels carry `(Target Universe)` so the two connect. None of
`평가`, `대상`, `방향성` or `평가 대상` is a glossary ko form, so the new strings add no drift
and `GLOSSARY_DRIFT_BASELINE = 217` (`tests/unit/i18n-audit.test.ts:96`) is unaffected. The
frontend row re-runs that test.

## 8. Tests (`tests/unit/`, temp SQLite via `CO_NEWBIZ_DB_PATH`)

1. **Catalog:** old doc §9.1 cases, plus the new `citeable_in` mapping, `s3_capability` items
   (required first, at most 5), and CAGR items not citeable in scope.
2. **Normalizer (`universe-direction.ts`):**
   - clamps are recorded;
   - unknown and non-citeable refs are dropped;
   - numbers trace against the field's own refs only (a number citing E2 but valued from E12
     fails);
   - the old §9.2 tracing cases hold;
   - forbidden phrases empty the field, and capability terms fail in scope and exclude but
     pass in prioritise;
   - `unverified` is set for zero refs and kept for the model's own `검증 필요`;
   - the grade is the worst kept ref;
   - the validity rule holds.
3. **Support line:** source priority, the `성장률 S1 미기록` path, stage-financial versus gap
   segments, and no outlook words.
4. **Route:** the envelope has `draft` and `prompt_version` `@3`; the `criteria` projection
   has empty `viability` and `rationale`; `[E#]` lines are in the user message;
   deterministic fallback; no-grounding, parse-failure and track guard
   (`brownfield-route-track-guard.test.ts`) unchanged.
5. **Record:** new keys persist; preserve-when-absent; `null` clears; refs outside `evidence`
   are dropped; `definition` is still the first key; legacy body unchanged.
6. **UI:** conclusion row first; `<details>` collapsed; no `truncate`/`line-clamp`; chips have
   text; `미제안` for empty fields; legacy hint; edits set `origin` to `person`; save composes
   `definition`; new labels render in ko and en.
7. **Gates:** prompt registry regen passes and has an `@3` snapshot with no `rationale`;
   `bun run design:lint`; i18n parity and glossary drift ≤ 217; `review-coverage.test.ts`;
   `bun scripts/audit.ts`.

## 9. Work breakdown

| Row | Agent | Scope | Depends |
|---|---|---|---|
| 1 | backend-engineer | Catalog builder (§4.1); `lib/universe-direction.ts` (§5.2, §4.3); prompt `@3`, `purpose` and registry regen; route envelope and `criteria` projection; PUT normalization (§5.4); `targets/route.ts:86` message; `types.ts`; tests 1–5 and the registry gate. | — |
| 2 | frontend-engineer | `UniverseDirectionView`; card; modal preview; form, apply and save in `useBrownfieldUniverse`; ko/en locale values (§7.3); `stage-artifact-labels.ts:31`; tests 6–7. | Row 1 types |
| — | follow-up | Wiki `50-…`/`51-…` refresh (handbook-sync-audit); glossary-curator referral for `대상 우주` and an optional `Target Universe` term (Q5). | — |

## 10. Risks

| Risk | Mitigation |
|---|---|
| Strict per-field tracing empties honest text (unit conversion, rounding across items). | The prompt says to copy exactly. Emptied fields are counted in the preview and the person writes the text. |
| The direction reads as a decision. | Proposal notice, origin line, `검증 필요` chips and confidence chip; no PASS wording. |
| Prioritise lines drift into capability knock-outs. | Capability terms are allowed only in prioritise and phrased as a preference. Scope and exclude are checked mechanically. |
| Size scope without the S2 entry market looks thin. | Size cites the S1 anchor, or is marked `검증 필요`. S2 as a catalog item is a follow-up. |
| A reader matches the blocker or tab to the card wrongly after the rename. | The `(Target Universe)` parenthetical on the tab and blocker; the card title matches the new label. |
| MCP or scripts read `criteria.rationale`. | Projection kept for one release with `rationale: ""`. |
| Raw-JSON readers (`deal-shapes/recommend`, 600 chars) lose `definition`. | `definition` stays the first key, and this is tested. |

## 11. Open questions

| # | Question | Recommendation |
|---|---|---|
| Q1 | May a prioritise line name an S3 required capability as a preference (never in scope or exclude, never pass/fail)? | Yes. Filling the S3 gap is why the route is M&A. DEC-20261111-05 still bars it from criteria. |
| Q2 | Label: ko `평가 대상 방향성` / en "Evaluation target direction", with `(Target Universe)` kept on the tab and blocker labels only? | Accept as proposed. |
| Q3 | Should the server build the market support line, or the model? | Server only. It is deterministic and needs no label engine. |
| Q4 | Untraced number or forbidden phrase: empty the field and count it, or keep it with a warning chip? | Empty and count. A person rewrites it. |
| Q5 | Register `Target Universe` in `glossary/business.yaml` now? | Defer to glossary-curator. Registering it with ko `평가 대상 방향성` would add drift wherever the en label omits "Target Universe", so decide its ko form first. |
