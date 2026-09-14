# Design: S1 linked-industry pinning and child-row hierarchy

- Date: 2026-09-14
- Status: implemented
- Supersedes (in part): `2026-09-14-s1-industry-list-pinning-design.md` — the "pins apply to roots only; a linked industry's own pinned state never matters" decision.

## Problem

User report on the S1 industry list (`/market`), two issues:

1. A linked (child) industry such as `유압식 브레이커` renders no ★ pin button, so it cannot be favorited at all. The original pinning design assumed "pin state only makes sense for something that can appear at root" — real usage showed users want to pin individual linked industries (a complement like `유압식 브레이커` can be the actual target of interest, not its anchor).
2. When a group is expanded, child rows indented by only `1rem` with a `↳` marker read as same-level rows — the child row's leading glyph sits left of the parent's name, so the hierarchy is not visually apparent.

## Approach

Frontend only (`app/web-next/app/market/page.tsx`); the `PATCH /api/market-overview/industry/{id}` pinned branch already works for any industry id, and `pinned` flows through `GET /api/market-overview` for every row — no backend change.

- **Star on every row**: the ★/☆ button renders unconditionally (root and `relation` rows alike). Child rows keep the `↳` marker and relation chip after the star.
- **Deeper child indent**: child row `paddingLeft` raised `1rem → 2rem`, so the child's star sits clearly right of the parent's star and the child name lands well right of the parent name.
- **Pinned-only promotion**: `displayedGroups` no longer just filters groups by `g.ind.pinned`. In `★ 핵심만 보기` mode: pinned roots keep their whole group (children ride along, unchanged); a pinned child whose anchor is NOT pinned is promoted to its own top-level row (`children: []`), matching the pin button's tooltip promise ("`'핵심만 보기'에서 최상위로 표시됩니다`"). A `promoted` set guards against double-promotion if a child ever appears under multiple anchors.
- Tooltip on the `★ 핵심만 보기` chip updated to describe both behaviors.

## Verification

- `bunx tsc --noEmit` clean.
- Manual matrix: (a) pin a linked child in `전체 보기` → ★ persists after refetch; (b) toggle `핵심만 보기` → the child appears as its own top-level starred row; (c) pin both anchor and child → whole group shows with the child starred inline; (d) unpin → child returns to its nested position.
