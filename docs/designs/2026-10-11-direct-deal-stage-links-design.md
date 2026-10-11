# Direct Deal-Stage Links From the Deal Board and Related Screens — Design

- **Date**: 2026-10-11
- **Status**: draft (Design Gate Row 0)
- **Owner**: frontend-engineer
- **ADR**: none required (no DB, auth or MCP change; one API field value changes, field name kept)
- **Scope**: replace links of the form `/opportunities?opportunity=<id>` with direct `/deals/<id>/<stage>` links.

## 1. Problem

S1-S3 are list-structured and a deal carries one current stage, but the deal board and
several screens link to the flat route `/opportunities?opportunity=<id>`. The CarrierGate
component redirects that to `/deals/<id>/s2` (FLAT_ROUTE_STAGE.opportunities = s2) whatever
the real stage, adds a redirect hop and shows an "auto-moved" notice. An assessed (S3) or
selected (S4) deal therefore always opens S2.

## 2. Design

One pure, client-safe helper module `app/web-next/lib/deal-links.ts`:

- `dealStageHref(id, stage?)` builds `/deals/<encoded id>/<s1..s12>`; stage accepts upper or
  lower case. An unknown or missing stage falls back to `/deals/<id>`, the deal overview,
  which resolves either carrier through the process API and shows the current stage with a
  button to the stage screen (it does not redirect; it is the generic "open this deal" link).
- `opportunityStatusHref(id, status)` maps board statuses: identified to S2, assessed to S3,
  selected to S4; anything else uses the overview fallback.

Call sites (six):

| Site | New target |
|---|---|
| deals board opportunity card | the card's own stage via opportunity status |
| deals board HOLD/aging row (opportunity) | `gateHoldHref` (gate stage tab, for example screening goes to S3) |
| portfolio-view "no industry" list | deal overview (status not in that API item) |
| projects list "view opportunity" link | deal overview (the source opportunity is already promoted) |
| project process "opportunity stage" link | the opportunity's current stage if it has one, else overview |
| portfolio-overlap server `href` value | stage by opportunity status (field name unchanged) |

The flat routes and CarrierGate stay unchanged, so old deep links, bookmarks and
notifications still resolve.

## 3. Accessibility

Link texts are unchanged, so accessible names stay the same. Removing the redirect hop
removes the transient "auto-moved" status message, and the focus lands directly on the target
stage page. No new interactive elements.

## 4. Preview notes

On the deal board, an assessed card should link to `/deals/<id>/s3`; a hold row for the
screening gate should link to the S3 tab; clicking never passes through the flat route.

## 5. Tests

Unit tests for the helper (each stage, unknown stage, id encoding, status mapping), source
reading tests that the six sites no longer contain the redirect href, and the updated
portfolio-overlap expectation.
