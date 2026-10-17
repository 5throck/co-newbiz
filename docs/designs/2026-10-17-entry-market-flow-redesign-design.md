---
title: "Entry-market flow full redesign — one state machine, structured derivation chain, organic three-tab integration"
status: accepted
date: 2026-10-17
owner: platform-lead
lang: ko
lang_reason: proper-noun
---

# Entry-market flow full redesign — one state machine, structured derivation chain, organic three-tab integration

Korean appears only as UI labels/product terms in backticks. All prose is English. Code paths are relative to `app/web-next/` unless stated.

- Status: **Accepted** (2026-10-17 — decider approved in chat ("진행해줘") in reply to the summary presented for approval; chat approval of the summary, no separate sign-off document). Drafted by platform-lead; slices 1+2 under implementation.
- ADR: [ADR-0179](../adr/0179-market-anchor-scope-compatibility.md) — this design does **not** touch the accepted factor-ratio rules (Amendment 2026-10-17 §B): ratio-only factors, mandatory per-step source, strict S1→S2 direction, human-only writes, confidence lowering per step all **stand unchanged**. A short amendment note points here.
- Builds on: ADR-0179 slices A/B (+ lazy auto-link follow-up), the 2026-10-16 scope-compatibility design, and the non-negotiables (#2 human decision ownership, #4 data confidence caps the grade).

## 1. Problem statement (decider feedback, 2026-10-17)

1. **Absolute-field wiring in the 대상 범위 step.** Besides region selection, the scope step shows fields that read as 연매출/판매대수 absolute inputs.
2. **Free 단계 추가 in the 진입시장 유도 step.** The arbitrary add-step control is unnecessary and breaks the AI 배수 추천 — the AI draft does not populate the steps properly.
3. **Fragmentation.** The three tabs do not work organically together — no shared status, each tab fetches independently, the derived value lives only in tab 3, and nothing on S2 shows which anchor is actually in force.

## 2. Verified current state (code, 2026-10-17)

### 2.1 The "absolute fields" identified exactly

`TargetScopeEditor.tsx` renders exactly four inputs: region checkboxes (`TARGET_SCOPE_REGIONS`), a free-text 세그먼트 input, a **`unit_basis` select**, and 저장. There is **no absolute-value input anywhere in the scope step.** The 연매출/판매대수 reading comes from the `unit_basis` dropdown's option labels (`lib/target-scope.ts`):

```ts
export const TARGET_SCOPE_UNIT_BASES = ["krw_m_year", "units_year", "usd_m_year"] as const;
export const TARGET_SCOPE_UNIT_BASIS_LABEL = {
  krw_m_year: "연매출 (백만원/년)",
  units_year: "판매대수 (대/년)",
  usd_m_year: "연매출 (백만 USD/년)",
};
```

It is an **enum describing the linked anchor's unit basis**, not a value field — but nothing on screen says so, and it sits inline among the person's own inputs as if it were one. The raw opportunity anchor columns `opportunity.market_size_krw_m` / `growth_rate` are **not rendered anywhere in the UI** (verified: the only S2 mention is the type declaration at `app/opportunities/[id]/page.tsx:25`); they live as server-side legacy fallbacks — `lib/business-case-generator.ts:1340` (`derived ?? legacy ?? 50000`) and the S2 completion guidance in `lib/process-flow.ts:182`.

### 2.2 Why the AI draft fails to populate steps (root cause analysis)

The draft path is `POST /api/opportunities/:id/entry-market-derivation/draft` → `completeDetailed([systemMessage("s2.entry_market_draft"), userPrompt])` → `extractJsonObject` → `normalizeEntryMarketDerivationInput` → client `setSteps(draft.steps.map(toForm))`. Code-verified defects, in likelihood order:

1. **The prompt's JSON template is not valid JSON.** The user prompt ends with:
   `JSON만 출력: {"steps":[{"base":"s1_anchor","factor":0.0-1.0 배율,"source":"출처 문장","as_of":"YYYY-MM-DD","note":"선택", ...}]}`
   `0.0-1.0 배율` is a prose placeholder inside a value slot. A model imitating the template emits `"factor": "0.3 배율"` (or similar strings); `normalizeEntryMarketDerivationInput` is deliberately **strict and all-or-nothing** (`factor` must be a finite number in (0,1]), so the whole chain is rejected → `draft: null` → the panel shows the failure note and **nothing populates**. This is the most plausible mechanism for the decider-observed "the AI draft does not populate the steps properly."
2. **`extractJsonObject` is brittle to prose.** It slices `text.indexOf("{") .. lastIndexOf("}")` and requires the whole slice to parse. A reply with any prose between two brace groups (or an explanatory preamble plus JSON) fails wholesale.
3. **No retry/repair.** One call, one parse, one rejection — a fixable near-miss (string factor, trailing comma) is terminal.
4. **Interaction with free add-step.** Even when the draft succeeds, `recommend()` **replaces all form rows** with the draft (discarding any manual steps), and the always-present 단계 추가 invites rows the draft never intended — the two controls fight each other.

Unverified: which defect actually fired in the decider's session (no LLM call was replayed; see §9).

Also noted: a duplicated `if (!matrix || typeof matrix !== "object") return null;` line in the draft route (harmless; clean up in passing).

### 2.3 Fragmentation (code-verified)

- **Three independent data owners.** `EntryMarketFlow` fetches `/target-scope` (uses only `linked_sizing`, discards `scope`) and `/entry-market-derivation`; `TargetScopeEditor` fetches `/target-scope` again; `EntryMarketDerivationPanel` fetches `/entry-market-derivation` again. `scopeSet` reaches the parent only through the child's `onScopeChange` callback, so the parent's status rail is a *shadow* of child state, not a source of truth.
- **No cross-tab reaction.** Changing the linked S1 in tab 1 silently re-bases the anchor underneath an existing derivation (tab 3) — no warning, no reset prompt; the S1 `computed`/scope verdicts simply change on next remount. Saving a scope in tab 2 does not refresh tab 3's scope verdict except via remount-on-tab-switch.
- **Derived value visibility.** `저장된 도출값` renders only inside tab 3. Nothing on S2 — and no persistent strip in the card — states which anchor is in force for S8 (derived vs legacy opportunity fields vs the 50,000 default).
- **S8 flags are a separate universe.** `resolveAnchorScopeFlag` / `resolveDerivedEntryMarket` recompute live server-side, but S2 shows none of it; the person cannot see, at the point of editing, what the S8 side will conclude.

### 2.4 What already works and must be preserved

- Gating semantics (locked tabs visible with disable reasons; link-without-scope warning), pure gating logic in `lib/entry-market-flow.ts` (exported string constants, ASCII-only tests).
- Human-only writes: PUT `/sizing-link` (audited, manual-override freeze via audit lineage), PUT `/entry-market-derivation` (atomic whole-chain replace, strict validation, absolute amounts impossible by key whitelist), `origin: "ai_suggested"` display-only marker.
- Server-side invariants: `derived(t) = S1_anchor(t) × Πf` always computed, never stored; bit-identity of the generator path when unlinked/chain-absent (`caseInputsBaseForProject` seam); `market_size_krw_m/growth_rate` legacy fallback order.

## 3. Redesign principle

**One card, one state, one fetch.** The card is a read-only-projection of a single `FlowState` derived from one GET; every tab is a *view* onto a slice of that state; the only writes remain the three existing human-only PUTs. Nothing server-side changes semantically — this is a state-ownership and interaction redesign.

## 4. The state machine

```
UNLINKED ──(PUT sizing-link)──▶ LINKED
LINKED ──(PUT target-scope)──▶ SCOPED
SCOPED ──(PUT entry-market-derivation)──▶ DERIVED
any ──(newer completed S1 version exists && provenance=manual)──▶ +STALE flag (advisory, never blocks)
any ──(PUT sizing-link clear)──▶ back toward UNLINKED (derivation kept but flagged anchorless by server 409 semantics — see §5.3)
```

Canonical states and their meaning:

| State | Meaning | Tab 1 | Tab 2 | Tab 3 | Anchor in force (S8) |
|---|---|---|---|---|---|
| `UNLINKED` | No S1 link (and lazy auto-link found nothing) | 연결 없음 | locked | locked | legacy `market_size_krw_m` → 50,000 default |
| `LINKED_UNSCOPED` | Link exists, no target scope | 자동/수동 | editable, 미설정 | editable with 범위 미설정 warning | legacy fields |
| `LINKED_SCOPED` | Link + scope, no derivation chain | 자동/수동 | 설정 | empty-state with AI 추천 primary action | legacy fields (anchor-scope flag ok/mismatch/unknown per `resolveAnchorScopeFlag`) |
| `DERIVED` | Link + scope + chain | 자동/수동 | 설정 | chain + computed value | **derived value** (`; entry_market=derived` run-note provenance) |

`DERIVED` + `STALE` (manual link pinned to a non-latest version) renders the 기존 `더 최신 S1 버전 있음` hint and adds one line: re-pinning re-bases the chain's anchor (see §5.3). The state is **derived, never stored** — computed by a new pure module from data the existing GETs already return (plus the additive extension in §5.1), so no migration and no new server state.

## 5. Design

### 5.1 One source of truth

- New pure module `lib/entry-market-flow-state.ts`: `deriveFlowState({ link, provenance, newerVersionAvailable, scope, derivation, computed }) → FlowState` where `FlowState = { state, stale, anchorInForce: "derived" | "legacy_opportunity" | "legacy_default", chips: {…}, warnings: {…} }`. It absorbs and supersedes `deriveEntryFlowStatus`/`deriveEntryTabs` in `lib/entry-market-flow.ts` (that module's exported string constants and test discipline carry over; the module is retired or re-exported — see open decision OD-4).
- The parent `EntryMarketFlow` owns ALL loading. The GET `/entry-market-derivation` response gains **additive** fields so one fetch covers the card: `scope_set: boolean`, `scope_unit_basis: string | null` (from the already-read `target_scope_json` column — the GET route already SELECTs it), and `legacy_anchor: { market_size_krw_m: number | null; growth_rate: number | null } | null`. No endpoint changes shape; nothing is removed. `TargetScopeEditor` and `EntryMarketDerivationPanel` become pure presentational children fed by props (their own fetches are deleted).
- **Card-header status strip** (always visible, outside the tabs): state chip (`도출값 사용 중` / `레거시 기회 필드 앵커` / `S1 미연결`), linked S1 `vN · 신뢰도`, and — when `DERIVED` — the computed 진입시장 value with the 배율 곱. This is the single place the anchor-in-force appears; tabs no longer each restate it.

### 5.2 Scope step (tab 2) — regions + segments only

- Person inputs: **regions and segments only.**
- `unit_basis` **stays as data** (the anchor-scope comparison and the share-guard read it; removing it would break `extractSizingVersionScope` symmetry and the scope verdict) but leaves the input row: it renders inside the 연결된 S1 reference strip as a read-only field initialized from the linked version's declared `unit_basis` (falling back to `krw_m_year`), with a one-line caption `앵커의 단위 구분 — 절대값 입력이 아닙니다`. It remains editable only via the same PUT body (unchanged payload; the control merely moves). This resolves the decider's "unnecessary absolute fields" reading without a schema or API change.
- The reference strip (linked S1 scope/anchor/confidence — slice A feature) stays, promoted to the top of the tab.

### 5.3 Derivation step (tab 3) — structured chain, no free add-step

- **Fixed 2-step base shape.** The chain renders as two named, always-present cards:
  - `1. 지역 비중` (region factor) — placeholder guidance: the share of the anchor's declared region scope this deal's regions represent.
  - `2. 세그먼트 비율` (segment factor) — the share of the remaining market the deal's segments represent.
  Each card edits `factor / source / as_of / note / region_tags / segment_tags` exactly as today; the server payload is byte-identical (`base` chain as today). The names are **labels over positions**, not new schema.
- **단계 추가 (free add) is removed.** Additional steps (3..6) appear **only when the AI draft returns more than two steps** — they render as `3+. AI 초안 추가 인자` rows, editable like the base two, so a justified extra factor (e.g. a channel or timing ratio the S1 context justifies) survives to save. A person can remove any extra row and can remove/re-add nothing else; an empty state has exactly two rows.
- **Editing stored chains with >2 steps** (legacy of the current design): all stored steps render and stay editable/removable; the count cannot grow beyond what exists or what the draft supplies.
- **AI 배수 추천 becomes the primary action** of the empty state (one button; fills BOTH fixed steps — factor + source + as_of drafts — in one action, per the brief). Manual-only entry remains possible by typing into the two cards; 저장 is disabled until the mandatory fields pass the existing client pre-check.
- **Link-change reaction.** When a derivation exists and the person changes the linked S1 version in tab 1, the card shows a confirm-styled inline warning before the PUT: `도출 사슬이 연결되어 있습니다 — S1 버전을 바꾸면 사슬의 앵커가 새 버전의 1차년도 값으로 다시 계산됩니다.` Proceeding re-bases (server semantics already do exactly this; the design adds only the warning). Clearing the link with a chain present warns that the chain becomes unreachable (GET 409 `not_linked`) and the anchor falls back to legacy — matching server truth.

### 5.4 AI draft fix (root cause)

1. **Prompt template becomes valid, minimal JSON.** The user-prompt instruction line is replaced with a concrete, valid example (numeric factor literal, real-shaped source/as_of strings) plus an explicit `factor는 JSON 숫자 리터럴(예: 0.35)이며 문자열이 아닙니다` rule; the system prompt (`prompts.generated.ts` source `prompts/prompts.json`) gains the same sentence. No other prompt content changes.
2. **Hardened extraction.** `extractJsonObject` tries, in order: whole-text parse → fenced ```json block → first balanced-brace object. Each attempt independent; first parse wins.
3. **One repair retry.** On strict-validation failure, the route makes exactly one follow-up call passing the validator's Korean error message (`단계 1의 factor는 (0,1] 숫자여야 합니다`) and the rejected text, asking for corrected JSON only. Still strictly validated; still writes nothing. Both calls are logged under the existing agent-call meta (`s2.entry_market_draft`).
4. **Honest failure.** If both attempts fail, the note names the failing rule (today's message already does) — but with the fixed shape the dominant failure mode (template-imitated string factors) is eliminated at the source.
5. The draft fills the **fixed two cards first** (step 1 = region factor, step 2 = segment factor, in that order); draft steps beyond two land as the `3+` extra rows. `origin: "ai_suggested"` handling is unchanged.

### 5.5 Raw opportunity anchor fields per state

| State | `opportunity.market_size_krw_m / growth_rate` |
|---|---|
| `DERIVED` | Hidden entirely from the card; S8 uses the derived value (`business-case-generator.ts:1340` order unchanged: `derived ?? legacy ?? 50000`). The header strip shows only 도출값. |
| `LINKED_*` / `UNLINKED` | Still not rendered as inputs (they never were UI inputs); the header strip shows `앵커: 레거시 기회 필드 (N KRW M)` or `앵커: 기본값 50,000 — 시장규모 미확정` so the fallback is at least *visible* where the flow lives. The ratio fallback path is untouched — bit-identity preserved by construction (display-only addition). |

`process-flow.ts:182` guidance text stays as-is (it is S2 completion gating, not the card).

### 5.6 Organic integration rules

1. Every tab derives its enable/warning text from `FlowState` — no tab computes its own gating.
2. Writes flow through the parent: each child exposes `onSaved(mutatedSlice)`; the parent re-derives from refetched data (one parallel refetch of the two GETs) and every tab — including the header strip — updates in the same tick. No more remount-dependent freshness.
3. The S8-facing flags (`resolveAnchorScopeFlag`, `resolveDerivedEntryMarket`, share-guard, ratio guard) are **untouched** — they already recompute live server-side. The card's header strip quotes the same underlying state so the person previews what S8 will conclude; no new server coupling.

## 6. Migration / compatibility

- **Schema: zero changes.** `target_scope_json`, `entry_market_derivation_json`, `sizing_analysis_id/sizing_version_id`, payloads — all untouched. Existing derivation chains (pilot currently has none) render fine under the fixed-shape UI (extra stored steps stay editable).
- **API: additive only.** `/entry-market-derivation` GET gains three optional fields; no request/response shape removed; both PUTs byte-identical; no route breaks.
- **Golden / bit-identity constraints.** Generator inputs bit-identical when unlinked/chain-absent (verified at the `caseInputsBaseForProject` seam, per ADR-0179 slice B); run-note fragments still appended only when they fire; `lib/irr-guard.ts`, `lib/anchor-scope.ts`, `lib/share-guard.ts` untouched.
- **Tests.** Existing `tests/unit/entry-market-flow.test.ts` and `tests/unit/entry-market-derivation.test.ts` keep passing (exported constants preserved or re-exported); new tests per slice below.

## 7. Execution plan

Each slice is independently shippable and merges on green tests; slices 2–4 depend on slice 1's `FlowState` only for the tabs they touch.

| Slice | Scope (files) | Tests | Acceptance criteria |
|---|---|---|---|
| **1. One state, one fetch, header strip** | new `lib/entry-market-flow-state.ts`; `EntryMarketFlow.tsx` (owns all loading; header strip; link-change warning); GET `/entry-market-derivation/route.ts` (additive `scope_set` / `scope_unit_basis` / `legacy_anchor`); `TargetScopeEditor.tsx` + `EntryMarketDerivationPanel.tsx` become props-fed (fetches removed); retire/absorb `lib/entry-market-flow.ts` per OD-4 | unit: `entry-market-flow-state.test.ts` (state table over all 4 states × stale × anchor-in-force); route test for additive fields; existing flow tests green | One GET powers the card; header strip shows state + anchor-in-force; changing link with a chain present warns; no console refetch storms; locked-tab semantics unchanged |
| **2. Structured derivation UI** | `EntryMarketDerivationPanel.tsx` (fixed 2 cards, labels 지역 비중/세그먼트 비율; 단계 추가 removed; AI-draft-shaped extra rows 3+; legacy >2-step chains editable; AI 추천 as empty-state primary) | unit: form-shape mapper tests (2-step normalize, draft >2 mapping, legacy chain edit round-trip); save payload byte-equal to today for a fixed fixture | No free add control; empty state = exactly two named cards; stored arbitrary chains still editable and save-identical; AI draft fills both cards in one action |
| **3. AI draft reliability** | `draft/route.ts` (valid JSON template; hardened `extractJsonObject`; one repair retry; dedupe the doubled null-check); `prompts/prompts.json` + regenerate `prompts.generated.ts` (factor-is-a-number rule) | unit: extractor cases (clean JSON / fenced / prose-wrapped / two-object); validator-retry prompt builder; recorded-fixture tests for a good and a repaired draft (LLM not called in tests) | Given a template-imitating reply with string factors, the repair retry returns a valid draft; no draft path writes; failure note names the rule |
| **4. Scope-step cleanup + legacy anchor visibility** | `TargetScopeEditor.tsx` (unit_basis control moved into the linked-S1 reference strip with the 절대값 아님 caption; regions/segments as the only input row); header-strip legacy-anchor line (slice 1 render, slice 4 polish) | unit: unit-basis initialization from linked version scope; PUT body unchanged for a fixture | Scope step shows no control that reads as an absolute value input; unit_basis survives PUT round-trip; legacy/default anchor visible in the strip |

## 8. Open decisions (with recommendations)

| # | Decision | Recommendation |
|---|---|---|
| OD-1 | Fixed 2-step shape vs AI-determined step count | **Fixed 2-step base + draft-justified extras (§5.3).** The two factors are the domain's canonical decomposition (region → segment); a free count is what broke the flow. Extras stay possible where genuinely justified, without a person conjuring arbitrary rows. |
| OD-2 | Where legacy anchor fields render | **Header strip only** (§5.5). They were never UI inputs; rendering them as fields would reintroduce the absolute-value confusion. `process-flow` guidance unchanged. |
| OD-3 | Does `unit_basis` stay in the scope step? | **Stay as data, move out of the input row** (§5.2). Removing it breaks scope-verdict symmetry; keeping it inline caused the decider's complaint. If the decider prefers full removal, it must instead be derived from the linked version's declared scope — that is OD-3b and costs a fallback rule for unscoped anchors. |
| OD-4 | Fate of `lib/entry-market-flow.ts` | **Fold into `entry-market-flow-state.ts`**, re-export the string constants from the old path for one release so the ASCII-only test discipline and imports stay green, then delete the shim in a later wave. |
| OD-5 | Repair-retry cost | One extra LLM call, only on strict-validation failure, person-initiated surface — acceptable; no ambient calls introduced. |
| OD-6 | Should the card block re-pinning S1 when a chain exists? | **No — warn only** (§5.3). Re-basing on re-pin is the accepted S1→S2 semantics (`derived(t)` follows S1 re-basing without recomputation); blocking would contradict ADR-0179 §B.4's direction. |

## 9. Honest limits / unverified

- **The exact AI-draft failure mode was not replayed.** §2.2 items are code-verified defects, but which one fired in the decider's session needs one live draft call against the pilot opportunity to confirm (slice 3's fixture tests pin the mechanism either way).
- Not browser-verified (the whole ADR-0179 chain shares this status); slice acceptance includes a manual pass on dev (port 7748) before each merge.
- The 50,000-default visibility line (§5.5) is a wording decision the decider may want rephrased — it surfaces an internal fallback that was previously invisible.
- Pilot has no stored derivation chain, so the legacy >2-step edit path is tested by fixture only, not against production data.
