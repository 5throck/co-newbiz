# UI polish: projects back navigation, token table sizing, inbox gate link

Date: 2026-10-11. Owner: frontend-engineer. Status: implemented in the same change set (adjudicated 2026-10-25, DEC-20261025-03).

## Items

1. Projects list back navigation. The /projects screen used only an in-page breadcrumb, while other deal-less list screens (portfolio view, companies, market, opportunities, synergy) use the top-bar back button labelled with the review/deal board name and have no breadcrumb. AppShell now treats the exact path /projects as a project-family screen with a back target to /deals and the same label; the in-page breadcrumb is removed from the projects page. Sub-paths (archives, project detail) are unchanged.
2. Personal API token table (connected apps). The shared fixed-layout list-table rule gave every column equal width, so the label column was too wide and the monospace id and date cells overflowed. A pat-token-table modifier switches to auto layout with a 48rem minimum inside the existing table-scroll wrapper (horizontal scroll on narrow widths), no-wrap cells with per-column minimum widths (id, scope, status, dates, actions), and an ellipsis label column with a title tooltip. Dates use a compact ko-KR short date-time format. Tokens only, no hardcoded colors or pixel font sizes.
3. Inbox gate HOLD link. The link opened the opportunity detail (stage S2), but the Screening gate decision form lives in the S3 synergy result. Gate holds now link to the stage tab hosting the gate form: screening to S3, pre_fs to S5, target_screening to S7, fs to S8, dd to S9, entity_ic and group_ic to S11. Unknown gates keep the previous fallback. Which items appear in the inbox is unchanged.

## Tests

- tests/unit/inbox.test.ts: gate hold href per gate, id encoding, fallback.
- tests/unit/connected-apps-page.test.ts: sizing classes, scroll wrapper, tooltip, short date format.
- bun run design:lint and tsc --noEmit.

## Accessibility

The back control is the existing top-bar link (44px target on mobile). Table keeps caption, scoped headers and the sr-only actions header; horizontal scroll container stays keyboard reachable. Ellipsized labels expose the full text through title and the revoke button aria-label.

## Preview verification

Logged-in browser at 1280, 768 and 375 widths: back button on /projects lands on the board; no overlapping adjacent cells in the token table (bounding-box check); inbox gate HOLD button href. No write actions are triggered.
