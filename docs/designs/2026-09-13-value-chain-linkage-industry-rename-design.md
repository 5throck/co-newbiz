---
lang: ko
lang_reason: source-material
---

# Value-chain linkage industry rename — retire the "프록시 산업" label

Date: 2026-09-13
Status: implemented

## Problem

ADR-0126 renamed the user-facing "프록시 체인" surface to "가치사슬 연계" (project sub-navigation, S1 section title, committee stance copy), but the residual term "프록시 산업" (proxy industry) survived in several user-visible places:

- the S1 analysis-scope modal: status copy "1차 프록시 산업 분석 실행 중…", rerun button "1차 프록시 분석 다시 실행";
- the related-candidates API: viewer-role error message and the orchestrator agent `purpose` string "1차 프록시 산업 분석 — …";
- the strategy catalog module name "프록시 산업연쇄 추정";
- the glossary alias "프록시 산업 체인" on the Proxy Chain term;
- the as-built architecture docs (ui-spec, api-spec) describing the same feature.

The modal title itself already reads "가치사슬 연계 산업 선택", so the surrounding copy contradicted the heading.

## Decision

"프록시 산업" is retired in favor of "가치사슬 연계 산업" (value-chain linkage industry), completing the ADR-0126 direction. The shorthand "1차 프록시 분석" is spelled out as "1차 가치사슬 연계 산업 분석" everywhere it appeared, and the strategy catalog module becomes "가치사슬 연계 산업 추정" (dropping the redundant "산업연쇄" doubling that a literal substitution would have produced).

The Proxy Chain glossary term keeps its Korean headword "프록시 체인" and English name "Proxy Industry Chain" (methodology vocabulary; the skill id `proxy-industry-chain` and the agent roster are unchanged), but its lookup alias becomes "가치사슬 연계 산업" so the new user-facing name resolves to the right term in tooltips, the glossary UI, and MCP `lookup_term`. The generated projection `app/web-next/lib/glossary-data.generated.ts` is updated to mirror the YAML.

## Changed files

- `app/web-next/app/api/market-overview/related-candidates/route.ts` — comment, viewer-role error copy, agent `purpose` string.
- `app/web-next/app/market/page.tsx` — modal status copy, rerun button label, two comments.
- `app/web-next/app/strategy/page.tsx` — strategy catalog module name.
- `glossary/technical.yaml` — Proxy Chain alias 프록시 산업 체인 → 가치사슬 연계 산업.
- `app/web-next/lib/glossary-data.generated.ts` — regenerated alias projection.
- `docs/architecture/ui-spec.md`, `docs/architecture/api-spec.md` — as-built copy aligned.

## Out of scope

- "프록시 체인" as methodology vocabulary in glossary definitions, procedures, templates, and ADR text (kept per ADR-0126, which scoped the rename to user-facing surfaces; historical 구칭 references stay).
- Other "프록시" compounds with different meanings (market-sizing proxy variables, "2-hop 프록시 추정" reliability-grade copy, committee "프록시 불확실성").
- Past deliverables under `workspace/deliverables/` and `memory/archive/` meeting notes, which are historical records.
- English vocabulary and identifiers (`proxy-industry-chain` skill, `Proxy Industry Chain` en term, route paths).
