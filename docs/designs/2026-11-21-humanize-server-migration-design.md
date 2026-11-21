---
lang: en
date: 2026-11-21
status: implemented
owner: architect + automation-engineer (dispatch), pm (dispatch), user (owner decision)
related: docs/designs/2026-11-18-humanize-polish-integration-design.md, docs/designs/2026-11-07-external-deps-standard-design.md, docs/designs/2026-11-16-humanize-external-design.md
spec: humanize-server-migration
supersedes: docs/designs/2026-11-18-humanize-polish-integration-design.md (pipeline rework; eligibility, segmentation and anchor rulings carry over)
---

# Design — Humanize polish pipeline migration to the Humanize server

## Problem

The 2026-11-18 integration pinned the Korean polishing dependency to `epoko77-ai/im-not-ai` and coupled the adapter to nine files inside that clone: the Python input shim, the `verify_gates.py` five-axis gate, three restore helpers, the sanitizer (indirect), the monolith agent definition, and the quick-rules file. Production ran on that pipeline (PR #925, manuals 25 units; PR #926, wiki 205 units; rulings DEC-20261119-01).

On 2026-11-21 the owner decided, decisively: the external dependency is **5throck/Humanize** (a Bun web app that carries the same rulebook as a deterministic rules engine plus a portable system prompt); **epoko77-ai/im-not-ai is not installed**. This design reworks the pipeline onto the Humanize server's HTTP interface and supersedes the 2026-11-18 pipeline mechanics. Eligibility, segmentation, and anchor rulings carry over unchanged.

## Decision

Owner decision 2026-11-21, executed as ruled. The manifest entry moves to `https://github.com/5throck/Humanize` at tag `v1.0.0` (peeled commit `4860b0ec45a68d1be031f120e6d3fd5219569bc9`, verified with `git ls-remote --tags`; v1.0.0 is the only tag). The pure libraries stay untouched; every UPSTREAM-coupled stage is replaced by an HTTP client call against the server the adapter spawns itself.

### What the Humanize server is (verified at the pin)

Bun app (`bun serve.ts`, default port 8765). At v1.0.0 the deterministic API is exactly five endpoints (`serve.ts:524-668`):

| Endpoint | Payload (cap) | Response |
|---|---|---|
| `POST /api/analyze` | `{text}` (30,000 chars) | `{findings:[{id,cat,name,severity,count}], s1, s2, total}` |
| `POST /api/polish` | `{text}` (30,000) | `{text, applied, before, after, changeRate, grade:{level:A-D, reason}}` |
| `POST /api/prompt` | `{genre}` — `auto\|column\|report\|blog\|formal` | `{genre, system}` — full monolith-style system prompt (prime directives 1-9 + A-K rulebook + procedure + output format) |
| `POST /api/chunk` | `{text, target?, max?}` (200,000) | lossless chunk plan |
| `POST /api/merge` | `{original, rewritten[], target?, max?}` (200,000) | `{text, warnings, chunks, after, changeRate, grade}` |

`rules.js` ships 47 rules in 11 categories (A translationese through K chatbot residue), protected-span masking built in, `ruleCount`/`fixableIds` exported; `prompt.js` is the port of im-not-ai's `quick-rules.md` + `agents/humanize-monolith.md` (provenance tracked in `references.json`). MIT licensed.

**Pin divergence, documented:** the exploration brief referenced `/api/fidelity` and `/api/lexicon`; those endpoints do **not** exist at v1.0.0 (they appear on upstream `main`, ahead of the only tag). The gate set below is adapted to the pin; adopting a fidelity endpoint is deferred to a future pin move (compatibility test will fail loudly if the pin moves without the rewrite).

### Rulings executed

1. **Pure libs unchanged**: `lib/eligibility.ts`, `lib/segment.ts`, `lib/anchors.ts` stay byte-identical. `lib/report.ts` gets one wording bullet (gate list) and keeps its schema; the adapter stops populating the shim-only fields (`routeHint`, `metricsDegraded`, `sanitized`).
2. **UPSTREAM-coupled stages replaced by HTTP client calls**:
   - Input shim → removed. `prepare` writes the unit text as the gate baseline directly; no metrics file, no route hint, no sanitize step.
   - Monolith agent + quick-rules → `/api/prompt` `system`. The fetched prompt text is written into `dispatch.json` per unit (`system_prompt`); the LLM step's ownership is unchanged (PM dispatches `docs-writer` with the fetched prompt; model alias `sonnet`; the server prompt carries the intensity instruction's substance — change rate capped below 30 percent, register preserved both ways, meaning invariance — so the separate constant is kept only as an appendix to the task prompt).
   - Post-processing restores (`restore_modality.py`, `strip_injected_commas.py`, `lexical_layer.py restore`) → **removed**. Humanize deliberately did not port them; their effect is delegated to the server prompt's self-check (procedure steps 3-5, including the reverse-direction read) and the server's rules-only auto-fix subset (`/api/polish`, 13 fix-carrying rules). **Accepted behavioral change**, recorded in the report wording.
3. **Quality gates** — `verify_gates.py` five-axis (P1 z-scores, P2 antithesis, P3 golden, P5 mood) → narrowed to:
   - **client-side change-rate gate** — an exact port of `Rules.changeRate` (token-LCS, `1 - 2M/(len(a)+len(b))` over `가-힣|a-z0-9|punct` tokens), thresholds preserved: <30% adopt; 30-50% adopt with warning; ≥50% roll back;
   - **anchor gate unchanged** (`lib/anchors.ts` multiset) — stricter than the server's fidelity checks;
   - exit-code semantics preserved: 0 adopt, 1 warn-adopt, 2 rollback (≥50% change), 3 cannot-judge/communication error.
   The P1/P2/P3/P5 axes are **lost** at this pin; the polish note states the narrowed gate set ("deterministic gates: anchors + change rate"), and "could not verify" carries the meaning-preservation, register, and nuance items as before.
4. **Server lifecycle**: the adapter spawns the server itself — `bun serve.ts` from the external clone on port 8765, probe `POST /api/analyze` with a one-word Korean probe until reachable, shut the child down on process exit; a server already listening on 8765 that answers the probe is reused; port occupied by a non-Humanize listener is fatal. Server-not-reachable is **FATAL** (loud nonzero exit, distinct from the 2026-11-18 silent-skip posture) — polishing is a primary workflow here, unlike co-deck's optional-server stance.
5. **Compatibility test rewritten** to the HTTP contract: manifest schema-v2 entry, pin = checked-out tag, clone HEAD = manifest commit, MIT license, server spawn, `/api/analyze` response shape with findings detected (rules loaded, count > 0), `/api/polish` grade A-D semantics, `/api/prompt` system prompt carrying the prime directives. **No python and no clone-file assertions.**
6. **Skill updated** (`skills/humanize-polish/SKILL.md` + five platform mirrors via sync-skills): server-start step added; the LLM step reads the fetched `system_prompt` from `dispatch.json` instead of the clone's agent file; prepare/finalize steps describe the new flow; prerequisites drop python3.
7. **Supersession**: the 2026-11-18 design gains an explicit supersession note (owner decision 2026-11-21; Humanize installed, im-not-ai never installed as a dependency; pipeline reworked to the server interface; deterministic-gate narrowing documented). The workspace-root 2026-11-16 external design is corrected where it documents co-newbiz's im-not-ai entry.

### Genre mapping

The adapter CLI genres stay `essay|column|report|blog|abstract` (skill compatibility); the server genre set is `auto|column|report|blog|formal`. Mapping: `essay→auto` (server estimates), `column→column`, `report→report`, `blog→blog`, `abstract→formal`.

### Exit codes (after migration)

| Command | Exit | Meaning |
|---|---|---|
| `doctor` | 0 / 1 | usable / unusable (manifest, clone, bun, server spawn + probe) |
| `classify` | 0 / 1 | eligible / excluded (unchanged) |
| `prepare` | 0 | prepared; prints the run directory |
| | 2 | content-refusal (excluded input, no Hangul prose) — the deliverable proceeds in its original wording |
| | 3 | FATAL tooling failure (clone missing, server unreachable/spawn failed) — loud abort, operator action required |
| `finalize` | 0 / 1 / 2 / 3 | proposal (or unchanged) / partial / nothing adopted / cannot judge — gate semantics preserved |

The prepare 2-vs-3 split is new: content refusals stay soft (2026-11-18 posture), tooling failures are loud (ruling 4).

## Files

| File | Action | Description |
|---|---|---|
| `docs/designs/2026-11-21-humanize-server-migration-design.md` | create | This design |
| `external-deps.json` | edit | humanize entry: repo 5throck/Humanize, pin v1.0.0, commit 4860b0ec…, consumer text |
| `scripts/humanize/humanize-adapter.ts` | rewrite | UPSTREAM path table → server client; spawn/probe/shutdown; client change-rate port; restore helpers removed |
| `scripts/humanize/lib/report.ts` | edit | one gate-list wording bullet in the Verified section |
| `scripts/humanize/tests/humanize-contract.test.ts` | rewrite | HTTP contract test (no python/clone-file assertions) |
| `scripts/humanize/tests/adapter-gates.test.ts` | edit | fixture gates over the new flow (server spawned once for the suite) |
| `skills/humanize-polish/SKILL.md` | edit | new flow, server-start step, python3 dropped |
| `.claude/`, `.gemini/`, `.agents/`, `.codex/`, `.hermes/` skill mirrors | sync | via `bun scripts/sync-skills.ts --dir .` |
| `docs/designs/2026-11-18-humanize-polish-integration-design.md` | edit | supersession note |
| workspace-root `docs/designs/2026-11-16-humanize-external-design.md` | edit | co-newbiz entry correction (lands in the workspace-root repo, not this PR) |

`external/humanize` is gitignored and never committed; the old im-not-ai clone was removed and the pin cloned via `bun scripts/external-deps.ts install --id humanize`.

## Test plan

1. Contract test (the manifest's `compatibility_test`): manifest entry shape and pin facts; clone identity; MIT; server spawn + probe; `/api/analyze` shape and detection; engine `ruleCount > 0`; `/api/polish` grade A-D; `/api/prompt` prime directives present.
2. Adapter gates on fixtures (`adapter-gates.test.ts`): mild rewrite adopted; 30-50% warned; ≥50% rolled back; changed number/date/statute/acronym each rolled back by the anchor gate; empty output keeps the original; summary block stripped; two-unit partial with protected blocks intact; note sections and no bare approval wording; work-file cleanup; `dispatch.json` carries the fetched `system_prompt`.
3. Failure posture: doctor fails closed on a missing clone and on an unusable bun; prepare exits 3 (FATAL) on tooling failure and 2 (soft) on excluded content.
4. `bun test scripts/humanize/tests`, `bun run test:unit`, `bun scripts/verify-scripts.ts`, `bun scripts/external-deps.ts verify`, `bun scripts/audit.ts --spec-check`.
5. Smoke: one Korean unit through prepare → prompt fetch → candidate → finalize, producing `proposal.md` + `report.md`.

## Behavioral changes (from the 2026-11-18 pipeline)

1. Gate set narrowed: verify_gates five-axis (P1 z-scores, P2 antithesis, P3 golden pairs, P5 mood) is gone; deterministic gates are anchors + change rate. The polish note says so.
2. Post-processing restores (modality, injected commas, lexicon restore) are gone; their effect is delegated to the server prompt's self-check and the rules-only auto-fix subset.
3. Input metrics (route hint, sanitize ledger, degraded-metric flags) are gone; the report loses those fields.
4. Tooling failure at prepare is FATAL (exit 3) instead of a silent unpolished continuation; content refusals stay soft (exit 2).
5. The clone is a Bun server app, not a Python script bundle: doctor checks bun + server reachability, not python3; the contract test exercises HTTP, not script flags.
6. The dispatched agent reads the fetched `system_prompt` from `dispatch.json` instead of a clone file path; pin moves move the prompt with the pin exactly as before.

## Out of scope

- Adopting upstream `main` endpoints (`/api/fidelity`, `/api/lexicon`) before a tagged release exists.
- Using the server's `/llm/chat/completions` or `/proxy` for the LLM step — the LLM step's ownership is unchanged (PM dispatches `docs-writer`).
- English or non-Hangul polishing, exclusion-rule changes, anchor-gate relaxation, and everything out of scope in the 2026-11-18 design.
- Fleet-wide reuse (no upstream request filed).

## Disclaimer

Polished text is decision-support material produced by an automated rewrite, not legal advice, not a verified restatement, and not an approval. Where polished prose and the original differ in meaning, the original and the cited source texts govern, and the human reviewer remains accountable for the final text.
