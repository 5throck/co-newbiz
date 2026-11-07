---
title: "AI review plumbing filter must be tested on real Korean reviewer output, not English strings"
author: SungHyuk
date: 2026-11-07
branch: pr/20261107-194334-fix-review-keep-system-plumbing-out-of-a
cost: { minutes: 23, tokens: 73210 }
id: l-79fabe34
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - app/web-next/components/ReviewBuckets.tsx
  - app/web-next/components/ReviewProvenance.tsx
  - app/web-next/lib/review/ai-second.ts
  - app/web-next/lib/review/engine.ts
  - app/web-next/lib/review/gate-artifacts.ts
  - app/web-next/lib/review/internal-item-filter.ts
  - app/web-next/lib/review/internal-item-patterns.json
  - app/web-next/lib/review/review-item-keys.ts
  - app/web-next/locales/en.json
---

## Decided
- System plumbing (ids, null track before S4, reviewer routing) is moved out of AI review buckets into a "provenance" list, stored inside the existing review JSON. There is no schema change, and stored rows are reclassified at read time instead of being rewritten.
- Items that only talk about identifiers or schema fields are filtered from the verified bucket too, not only from could_not_verify and needs_judgement.

## Tried and ruled out
- The first filter version passed its unit tests, which used English strings, but dropped nothing on the live dev review. The AI 2nd reviewer writes in the UI locale (Korean), with Latin field names followed by Korean particles, e.g. "track 필드", "track이 null", "track 미지정".
- Treating "근거" (rationale) alone as a deal-content term kept plumbing items, so it was dropped from the deal-term list.

## Watch out
- Pin filter tests to real stored review rows. Read them read-only from the dev DB.
- The AI 2nd cache key (contentHash) was deliberately left unchanged. Old reviews are not re-run; only read-time reclassification applies to them.

In the code: app/web-next/lib/review/internal-item-filter.ts, internal-item-patterns.json (ko/en detection vocabulary, kept out of TS for i18n-lint), tests/unit/review-internal-items.test.ts (real-row fixture from review_stage 01M6T67CR1NBVQPJ6BVK791BGC).
