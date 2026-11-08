---
lang: ko
lang_reason: source-material
---

# S4 decision tab: localized route (sub-track) option labels

Status: Implemented (defect fix, no new screen). Author: frontend-engineer. Quotes Korean catalog values (`common.subTrack.*`) as source material.

1. Defect: the "라우트 * (Brownfield)" select on `/deals/{id}/s4` rendered raw codes (`m_and_a`, `jv`, `strategic_investment`, `minority_investment`, `partnership`, `rbd`, `corporate_venture`) as option text.
2. Root cause: `DecisionTab.tsx` printed the `subs` map value (the code itself, from `constants.ts` GF_SUB/BF_SUB) instead of resolving a catalog key. The labels already existed.
3. Reuse: `common.subTrack.*` (ko/en) via `SUB_TRACK_KEY` in `lib/label-keys.ts`, already used by the recorded-decision card, the history table, the process page, and the charter; no new catalog keys. Existing ko labels (M&A, JV(합작), 전략적 투자, 소수지분 투자, 전략 제휴, R&BD(공동연구), 사내벤처(CVC)) are kept to stay consistent with those surfaces.
4. Change: new pure helper `subTrackLabelKey(code)` returns the catalog key, or the raw code for an unknown code; the options render `resolveLabelTokens(subTrackLabelKey(k), tr)`, so an unknown code still shows as-is rather than blank.
5. Audit: route-code renderings in history rows, recorded card, scope panels, process/charter pages already resolve through `SUB_TRACK_KEY`/`trackKeysText`; the select options were the only raw site. Route-advisory and proposals surfaces render track/signal text, not sub-track codes.
6. Tests: `tests/unit/route-label-localization.test.ts` (known code, unknown fallback, every GF_SUB/BF_SUB code localized in ko and en); `labels.test.ts` and `i18n-audit.test.ts` stay green.
7. Hygiene: touched `DecisionTab.tsx` was re-formatted by biome and two pre-existing a11y lint errors on the scrollable table wrapper got scoped suppressions (keyboard-scrollable region pattern shared with `.table-scroll` elsewhere).
8. Design-lint: no tokens, colors, or components changed; the options are native `<option>` text only.
9. Out of scope: the "(Brownfield)" suffix in the select label stays as-is; renaming ko wording is a glossary decision, not part of this fix.
