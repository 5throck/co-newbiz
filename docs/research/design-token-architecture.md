---
lang: en
counterpart: design-token-architecture_ko.md
---

# Research Note — Design Token Architecture (W3C DTCG) Standard Practices

> 🌐 External reference material. Researched: 2026-09-05. For comparing the handbook-variables.css token system against industry standards.

## Standard Practices

1. **W3C DTCG standard formalized**: the Design Tokens Community Group released the stable v2025.10
   specification on 2025-10-28 (with participation from 40+ organizations including Adobe, Figma, Google,
   and Microsoft) — the `$value`/`$type` common schema and references in the `{color.brand.500}` form are
   interpreted consistently across platforms
2. **The 3-tier architecture is the dominant recommendation**: Primitive (`blue-500`) → Semantic
   (`action-color`) → Component (`button-bg-primary`) — when the tiers are divided correctly, changing a
   single value propagates cleanly across the entire UI. Most token confusion arises from collapsing the
   tiers into one (components referencing raw hex directly)
3. **Start with a small scope**: begin with 30–50 tokens covering color, spacing, typography, and radius —
   a list of 400 tokens nobody adopts is the same failure pattern as a 300-component library nobody uses
4. **Single source of truth (SSOT) principle**: define one source per token and generate the rest from it —
   if Figma and code drift apart, you are effectively maintaining two design systems
5. **Governance**: token changes must be treated with the same weight as shared API changes — a PR that
   changes `color-primary-500` from blue to green must not be merged without review

## co-newbiz mapping

- The `--bg/--text/--border/--accent` system in `handbook-variables.css` already follows a
  **purpose-based Semantic tier** (consistent with the no-hardcoded-colors rule) — whether the Primitive
  tier (raw hex) is separated into its own file needs separate verification.
- The ":root → prefers-color-scheme → .dark" 3-tier dark mode points in the same direction as DTCG's
  principle that "references must be interpreted consistently across platforms" — the co-newbiz rule that
  new colors must be defined in all 3 tiers is a concrete implementation of the governance recommendation
  to "treat token changes like API changes."

## Sources

- Design Tokens Community Group, "Design Tokens Format Module 2025.10" — https://www.designtokens.org/tr/drafts/format/ (accessed 2026-09-05)
- CoderCops, "Design Tokens in 2026: The W3C Format Finally Standardizing Cross-Platform Design" — https://blog.codercops.com/blog/design-tokens-2026-w3c-format-guide (accessed 2026-09-05)
- The Masterly, "Design Tokens: A Practical Guide to Naming, Tiers, and the Figma-to-Code Workflow" — https://www.themasterly.com/blog/design-tokens (accessed 2026-09-05)
- Malaka Venugopal Reddy, "Design tokens with the W3C standard" — https://malakavenu.com/articles/design-tokens-w3c-2026 (accessed 2026-09-05)
