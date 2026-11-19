---
title: "Korean polishing (Humanize KR) is integrated as a pinned read-only external dependency with one adapter and one skill, applied only to Korean document outputs…"
author: SungHyuk
date: 2026-11-18
branch: pr/20261118-114850-docs-mcp-align-package-distribution-docs
cost: { minutes: 2, tokens: 23171 }
id: l-86962eda
scope: repo
status: active
src: agent
touches:
  - external-deps.json
  - scripts/lib/external-deps.ts
---

## Decided
Humanize KR (upstream epoko77-ai/im-not-ai, MIT, Korean-only, 5,000-character input limit) is added through the repo's external-dependency machinery: a pinned entry in the external-deps manifest installed read-only under external/humanize, with exactly one adapter file coupling to it and one polishing skill owned by the docs writer. First pin candidate is v2.4.7 (latest remote tag seen on 2026-11-18; re-check before pinning).
Scope, chosen by the user: automatic polishing before output of Korean-language document deliverables (requested documents, reports, summaries, Korean-counterpart manuals and wiki pages). English documents, code and YAML are skipped because the tool only handles Hangul text.
Exclusions, chosen by the user: policy, procedure, ADR, legal-opinion text and quotations are never polished. One changed sentence can change regulatory meaning, and this project verifies legal conclusions against source text.
Polished output stays a proposal: the human review surface must still say what was changed and what could not be verified, never a bare "polished" stamp.

## Tried and ruled out
Installing it as a global Claude plugin per user: dropped because it lives outside the repo, so there is no pin, license gate or integrity check and the external machinery would go unused.
Polish only when asked ("polish this"): dropped because the user wants polishing before output by default.
Polish everything and attach a before/after diff: dropped because it multiplies the review load.

## Watch out
Upstream's own rules cap change rate (warning above 30 percent, rollback above 50 percent) and forbid altering numbers, dates, proper nouns, statute references and English acronyms; the adapter must keep those gates rather than bypass them.
Inputs over 5,000 characters need upstream's chunking and reassembly scripts.
New work lands after PR #919 merges (sequential branch rule). Adding an agent would trigger roster and lifecycle updates, so prefer a skill.

In the code:
- external-deps.json and scripts/lib/external-deps.ts (schema v2: license, usage as-is, adapter, compatibility_test)
- co-work's external-deps.json is the worked example (ppt-master, kordoc, rhwp, officecli)
- upstream clone for inspection: /Users/techcross/git/im-not-ai
