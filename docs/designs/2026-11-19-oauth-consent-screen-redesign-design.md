---
lang: en
date: 2026-11-19
status: implemented
owner: ux-designer-agent (design), pm (dispatch)
related: docs/designs/2026-10-08-wave-m-mcp-parity-design.md (§4.2/§10/§11 — consent design of record), docs/designs/2026-11-19-oauth-manual-client-registration-design.md, docs/design-system/design-guide.md, docs/design-system/design-tokens.md, docs/design-system/design-screens.md, ADR-0154, ADR-0203
spec: oauth-consent-screen-redesign
---

# Design — OAuth Consent Screen Redesign (`외부 앱 연결 허용`)

## Problem

The consent screen (`app/web-next/app/oauth/authorize/page.tsx`) carries every required
security fact, but not in a form a user can *decide* from. The single most
phishing-discriminating fact — the redirect return host (`chatgpt.com`) — is buried as
the second `<strong>` inside a running sentence
(`objLead` + user_id + `objMid` + redirect_host). The unverified-client warning is a
bare text paragraph with no icon and no box, visually identical to the boundary note
below it. The whole decision renders as flat document flow inside the full workspace
chrome (docked sidebar + topbar), which in a hosted popup window (ChatGPT / Claude.ai
open the consent in a small window) crushes the usable width and makes the screen read
as "just another internal page" rather than a trust decision.

Owner-approved direction (2026-11-19): **(1) `시각 레이아웃 정돈`** — Onyx token-based
card layout, typography, spacing; **(2) `신뢰·보안 신호 강화`** — the redirect return
host becomes the visually discriminating element; the unverified warning gets
icon + warning-box treatment.

Out of scope (owner-set): scope-granular consent (backend change, deferred), any
API/backend modification, an admin verify-client UI.

## Data contract (real, unchanged)

The page consumes `GET /api/oauth/authorize` →
`{ valid, client: { client_id, name, verified }, redirect_host, scopes: [{ scope: "read"|"write"|"propose", allowed }], user_id }`
and posts the decision to `POST /api/oauth/authorize` → `{ redirect_to }`.
Approve is disabled when any scope has `allowed: false`. No new field is introduced;
this design only re-renders what the contract already returns.

## JTBD

**Persona**: a logged-in co-newbiz user (deal analyst / operator).
**Job**: *when an external AI app asks for access to my account, judge quickly and
confidently WHO is asking and WHAT it gets, so I can grant or refuse without falling
for phishing.*

Two sub-jobs fall out of it: (a) verify identity — is the app who its name claims
(verified badge + return host must agree); (b) bound the grant — which permissions,
and which of them my role cannot give. The screen must make (a) answerable at a
glance and (b) answerable by scanning one list.

## Screen-type judgment (explicit)

This is a **trust-decision screen, not a stage screen**. It sits outside the S1–S12
navigation tree and the project/deal sub-screen model, so the closest doctrine pattern
is **P3 Decision** (human decides approve/reject) borrowed for its decision-block
semantics — but none of the stage furniture applies: no StageFrame, no StageTabs, no
stage-linkage (`입력/출력` handoff) strips, no CRUD form standard. The design-components
rule "every new detail screen must include StageTabs" does **not** apply: this screen
is not entered from a list into a detail view; its only exits are the two decision
buttons and the error-state links. Recording this judgment here so the exemption is a
decision, not an oversight.

## Current state, annotated

```
/app-content padding (full workspace chrome: sidebar + topbar visible)
┌──────────────────────────────────────────────────────────────┐
│ h1 외부 앱 연결 허용                                          │
│                                                              │
│ h2 ChatGPT [검증된 앱]                     ← chip only, OK   │
│ ▸ DEFECT D1: 이 앱이 {user_id} 계정의 권한 범위 안에서         │
│   co-newbiz에 접근하도록 허용합니다. 승인 후 돌아갈 주소:       │
│   **chatgpt.com**                          ← host buried in  │
│                                              prose, plain    │
│                                              <strong>, no    │
│                                              block, no mono  │
│ ▸ DEFECT D2: 관리자가 확인하지 않은 앱입니다…  ← bare <p>,     │
│   no icon, no box; indistinguishable from    any other      │
│                                              paragraph       │
│ h3 요청 권한                                                 │
│ ▸ DEFECT D3: bare <dl>, rows visually undivided; not-allowed │
│   chip floats at caption size inside the dd                  │
│ ▸ DEFECT D4: noGateNote <p> looks the same as D2's paragraph │
│                                                              │
│ [허용(primary)] [거부(ghost)]               ▸ DEFECT D5:     │
│   approve first in DOM/tab order → habitual Enter lands on   │
│   the grant; disabled approve (blocked scopes) shows no      │
│   reason beside the button                                   │
└──────────────────────────────────────────────────────────────┘
▸ DEFECT D6 (container): renders inside .app-shell workspace chrome;
  `.objective` has no global style (only scoped under
  .deal-overview-head in styles.css), so it renders as unstyled body text.
```

Defect register:

| # | Defect | Fix in this design |
|---|---|---|
| D1 | Redirect return host — THE phishing discriminator — is inline prose | Dedicated host block: labeled, boxed, `--font-mono`, `--fs-h2`, largest emphasized text on the screen (§ Proposed layout) |
| D2 | Unverified warning is a bare paragraph, no icon, no box | Icon + warning box (`--amber-*` token pair, ⚠ icon + full text — never color-only) |
| D3 | Scope `<dl>` has no row separation; blocked-scope chip is weak | Scope rows as divided list inside the card; chip unchanged semantically (status-red + text), row padding `--space-3` + `--border-subtle` divider |
| D4 | Boundary note (noGateNote) has no distinct treatment | Muted note box (`--surface-2` bg, `--radius-md`), visually distinct from warning (amber) and from body copy |
| D5 | Approve is first in DOM/tab order; disabled approve shows no adjacent reason | Deny leads (fail-safe first tab stop), approve trails as the commit action; blocked approve renders via PrimaryAction with `disabledReason` text |
| D6 | Consent decision renders inside workspace chrome; in a hosted popup the docked sidebar crushes width | `/oauth/*` renders bare (no shell), consent card centered at 32rem (§ Container) |

## Proposed layout

### Container

- `AppShell` bare-path branch (currently `/login`, `/register`) gains `/oauth/`:
  the consent screen renders without sidebar/topbar, centered card on `--bg`.
  Frontend-only change (`components/AppShell.tsx` pathname check); the unauthenticated
  login detour is unaffected — ADR-0154's `?next=/oauth/...` carry and the existing
  `useEffect` redirect still run before the bare early-return render.
- Card: `.card` (surface + border + `--radius-3xl` + 24px padding, all token-native),
  `max-width: 32rem`, centered. ≤480px: card spans full width with `--space-3`
  margins; 320px reflow without horizontal page scroll (WCAG 1.4.10).
- The host popup is the real viewport (typically ~400–600px wide); the layout is
  designed single-column first, never two-column.

### Normal case (verified client, all scopes allowed)

```
        (bare chrome — no sidebar, no topbar, --bg page)
┌──────────────────────────────────────────────────────────┐
│  외부 앱 연결 허용                                (h1, --fs-h1 800,
│                                                   focus target on load)
│  ┌ .card ─────────────────────────────────────────────┐
│  │ ChatGPT   [✓ 검증된 앱]                 h2 + status-chip
│  │                                                  (status-green, icon+text)
│  │ 이 앱이 아래 계정의 권한 범위 안에서 co-newbiz에      consentLead
│  │ 접근하도록 허용합니다.                        (--fs-body, --muted-fg no —
│  │                                              body copy --fg)
│  │ 계정     analyst@co-newbiz        fact row: label(--fs-caption,
│  │                                   --muted-fg) + value in --font-mono
│  │ ┌ 돌아갈 주소 블록 ─────────────────────────────┐
│  │ │ ↗ 승인 후 돌아갈 주소          (label, --fs-caption, --muted-fg)
│  │ │ ┌──────────────────────────────────────────┐ │
│  │ │ │         chatgpt.com                      │ │ host value: --font-mono,
│  │ │ │                                          │ │ --fs-h2, weight 700,
│  │ │ └──────────────────────────────────────────┘ │ --surface-2 bg,
│  │ │                                              │ --radius-md, centered
│  │ │ 연결하려는 앱의 주소와 일치하는지 확인하세요.   │ redirectHostCaution
│  │ │ 일치하지 않으면 승인하지 마세요.               │ (--fs-caption, --muted-fg)
│  │ └──────────────────────────────────────────────┘
│  │        host block is NOT a link — evidence, not navigation;
│  │        no click target, no copy button (nothing to act on)
│  └────────────────────────────────────────────────────┘
│  ┌ .card — 요청 권한 (h3, --fs-h3 700) ────────────────┐
│  │ read     읽기 — 접근 권한이 있는 검토 건·용어집·…      scope row
│  │ ────────────────────────────────────────────────────  (--border-subtle
│  │ write    쓰기 — 사용자 이름으로 검토 자료를 등록·…      divider, --space-3
│  │ ────────────────────────────────────────────────────   row padding;
│  │ propose  제안 — 결정 제안만 기록합니다. …               scope name dt in
│  └────────────────────────────────────────────────────┘  --font-mono)
│  ┌ note box ──────────────────────────────────────────┐
│  │ 어떤 권한도 게이트 승인·투자 결정·종결을 실행하지      noGateNote, --surface-2
│  │ 않습니다. 연결은 언제든 "연결된 앱" 화면에서           bg, --radius-md,
│  │ 해지할 수 있습니다.                                   --fs-caption
│  └────────────────────────────────────────────────────┘
│                                                          deny LEADS,
│  [ 거부 ]                        [ 허용 ]                approve TRAILS
│  (btn-danger)                    (PrimaryAction →       (commit position,
│                                   btn-primary)           right = end of reading
│                                                          flow in both LTR/RTL)
└──────────────────────────────────────────────────────────┘
```

### Any-scope-not-allowed case (blocked)

```
│  ┌ .card — 요청 권한 ──────────────────────────────────┐
│  │ read     읽기 — …                                    │
│  │ ──────────────────────────────────────────────────── │
│  │ write    쓰기 — … 등록·수정합니다(게이트 승인·투자      │
│  │          결정은 불가)  [✕ 현재 역할로는 부여할 수 없음]  │ chip: status-chip
│  │ ──────────────────────────────────────────────────── │ status-red, icon+text
│  │ propose  제안 — …                                     │ (unchanged keys)
│  └────────────────────────────────────────────────────┘
│
│  [ 거부 ]        부여할 수 없는 권한이 있어 허용할 수      [ 허용(비활성) ]
│  (btn-danger,    없습니다. ← approveBlockedNote           (PrimaryAction
│   enabled)       rendered as .primary-reason text          disabled, reason
│                  beside the button — WCAG 3.3.3            via aria-describedby)
```

Deny stays fully usable; only the grant is disabled, and the *reason* is text beside
the button, not a tooltip and not color alone.

### Unverified-client case

Same as normal except, directly under the h2/lead:

```
│  │ ChatGPT Pro  [⚠ 미검증 앱]                status-chip status-amber
│  │ 이 앱이 아래 계정의 …
│  │ ┌ warning box ─────────────────────────────────────┐
│  │ │ ⚠ 관리자가 확인하지 않은 앱입니다. 앱 이름과        │ --amber-bg bg,
│  │ │   돌아갈 주소를 직접 알고 있는 경우에만             │ --amber-border border,
│  │ │   허용하세요.                                      │ ⚠ icon + text
│  │ └──────────────────────────────────────────────────┘ │ (WCAG 1.4.1)
│  │ …host block follows — with a lookalike name the user │
│  │   now reads the HOST first: "ChatGPT Pro" +          │
│  │   chatgpt-connect.example.net → refuse               │
```

The discriminating pair is then side by side in one glance: **name claim** (h2) vs
**return host** (mono block). A phishing client that claims a brand name cannot fake
the host the server extracted from the registered redirect URI.

### Error states (unchanged semantics, new container)

`loadFailed` / `invalidHeading` / `invalidMissingBody` / `invalidBody` / `backToApp`
paths keep their exact copy, `role="alert"`, `<details class="review-dev">` dev note,
and links (`viewConnectedApps` as `btn-primary` — the one primary of the error view —
`goDealBoard` as `btn-ghost`). They render inside the same centered `.card` container.
`PageState state="loading"` unchanged.

## Components and tokens consumed (named from the doctrine)

| Element | Component / class | Tokens |
|---|---|---|
| Page container | `.card` (design-guide §6) | `--surface`, `--border`, `--radius-3xl`, 24px padding (`--space-6`) |
| h1 / h2 / h3 | `@layer base` heading rules (design-tokens.md) — no utility sizing | `--fs-h1/--fs-h2/--fs-h3`, weights 800/700/700 |
| Verified / unverified chip | `.status-chip.status-green / .status-amber` (unchanged) | `--green-*`, `--amber-*` pairs |
| Warning box (unverified) | **new local block** (escalated for catalog registration — see § Escalation) | `--amber-bg`, `--amber-border`, `--amber-fg`, `--radius-md`, `--space-3` padding |
| Fact rows (`계정`) | definition list, dt label | `--fs-caption`, `--muted-fg`, `--font-mono` for the id value |
| Host block | **new local block** (escalated) | `--surface-2`, `--radius-md`, `--font-mono`, `--fs-h2`, weight 700, `--space-2`/`--space-3` rhythm |
| Scope list | divided `<dl>` rows | `--border-subtle`, `--space-3`, `--font-mono` for scope-name dt |
| Not-allowed chip | `.status-chip.status-red` (unchanged) | `--red-*` pair |
| Boundary note | muted note box | `--surface-2`, `--radius-md`, `--fs-caption`, `--muted-fg` |
| Approve | `PrimaryAction` (`components/ui.tsx`) → `.btn-primary` | `--primary`, `--focus-ring`; `disabled` + `disabledReason` → `.primary-reason` |
| Deny | `Button variant="danger"` → `.btn-danger` | `--red-fg`, `--red-border`, `color-mix` red/surface per existing class |
| Loading / error | `PageState` (unchanged) | — |
| Focus | global `:focus-visible` rule (unchanged) | `--accent`, `--focus-ring-offset` |

Spacing rhythm throughout: `--space-1..4,6,8` only — card gap `--space-6` between the
three cards, `--space-3` inside lists, `--space-2` between label and value. No raw
px/rem spacing, no raw colors (`design:lint` enforced). Amount notation rules do not
apply (no financial figures on this screen).

## Primary action call (recorded decision)

**Approve (`허용`) remains the single `.btn-primary`. Deny (`거부`) is upgraded from
default ghost to `btn-danger` and placed FIRST in DOM/tab order.**

Reasoning:

1. The design of record for this screen (wave-m §11) fixes the frame: "The page has
   one primary action ('Confirm decision'). 'Reject' is secondary." Making deny the
   filled primary would contradict the recorded decision without adding safety.
2. The real phishing risk is not "deny is too quiet" — it is "the grant button is
   habituated". The fix that addresses the root cause is upstream of the buttons:
   the host block (D1) does the discrimination work before the user reaches the
   action row. Removing the primary would just relocate the habit to whichever
   button is filled.
3. Deny must never be visually suppressed — so it gets full visual mass via the
   doctrine's sanctioned `.btn-danger` variant (tinted fill + red border, ≥4.5:1
   text contrast in both themes), not a quiet ghost. Danger styling is reserved
   elsewhere for consequential actions; on a consent screen refusal *is* the
   consequential, safe-side action, and giving it red prominence costs nothing —
   a user who intends to grant is not confused by a red Deny sitting beside the
   blue Allow.
4. Deny-first order makes the first Tab stop and the accidental-Enter target the
   **fail-safe** path: a keyboard user who tabs once and hits Enter, or a user
   mashing Enter after focus lands in the action row, refuses rather than grants.
   Approve sits at the trailing (commit) position.

Rejected alternative: deny as the filled primary (inverts task completion, retrains
"red = proceed" across the product, contradicts wave-m §11); approve-first order
kept as-is (leaves the habitual-Enter risk on the grant side).

## Security content preservation (all existing semantics kept)

| Existing element | Disposition |
|---|---|
| Client name + verified/unverified chip | Kept verbatim; chip classes unchanged |
| `user_id` | Kept; moved into a labeled fact row (mono) |
| `redirect_host` | Kept; promoted to the host block (D1) |
| Per-scope list with `allowed: false` chips | Kept verbatim (keys `scopeRead/Write/Propose`, `scopeNotAllowedChip`) |
| `unverifiedNote` warning | Kept verbatim; icon + warning-box treatment added |
| `noGateNote` boundary line | Kept verbatim; muted note box |
| Deny path | Kept; upgraded prominence (see primary-action call) |
| Approve disabled when any scope `allowed: false` | Kept; reason now surfaced beside the button (`approveBlockedNote`) |
| Heading focus on load + `aria-live` status (`approving`/`denying`/`returning`) | Preserved exactly |
| Error/invalid states and their links | Preserved exactly, new container |
| No action on load; nothing auto-fires | Preserved (wave-m §11 rule) |

## Embedded accessibility checklist (WCAG 2.1 AA, both themes)

- [ ] **2.4.3 / focus**: h1 keeps `tabIndex={-1}` + `ref.focus()` on data arrival
      (`info` or `error`) — preserved behavior, not redesigned.
- [ ] **4.1.3 status messages**: `<p aria-live="polite" class="sr-only">` status line
      preserved verbatim; announce strings unchanged (`approving`, `denying`,
      `returning`).
- [ ] **1.4.1 not color-only**: verified/unverified chips keep text labels; the
      warning box pairs ⚠ icon (aria-hidden) with full text; not-allowed chip keeps
      its text label. No state in this design is conveyed by color alone.
- [ ] **Host block semantics**: account + host render as definition-list label/value
      pairs so screen readers announce `승인 후 돌아갈 주소: chatgpt.com` as a fact,
      not prose. The host is plain text — never a link (it must not be a click
      target at all).
- [ ] **2.1.1 keyboard**: the entire decision is reachable and operable by keyboard:
      h1 (focused) → account row → host block → scope rows → note → `[거부]` →
      `[허용]`. No traps; no new interactive elements besides the two buttons.
- [ ] **2.4.7 focus visible**: global `:focus-visible` token ring applies; buttons
      keep ≥24px targets (existing padding).
- [ ] **3.3.3 error suggestion**: disabled approve shows `approveBlockedNote` as
      adjacent text (`.primary-reason`, linked via `aria-describedby` by
      PrimaryAction), never disabled-state alone.
- [ ] **1.4.3 contrast**: all pairs from token sets already covered by
      `bun run contrast:check` (CI). New pair to verify: `--amber-fg` on
      `--amber-bg` (warning box) — must pass 4.5:1 both themes before merge.
- [ ] **1.4.10 reflow**: 320px viewport — card reflows single-column, no horizontal
      page scroll; the mono host string is the longest unbreakable token
      (`chatgpt.com` ≈ 11ch at `--fs-h2` mono — fits; a pathological host is
      `overflow-wrap: anywhere` inside the block).
- [ ] **2.3.3 / reduced motion**: no new animation; `.card` transition inherits
      existing behavior (static under `prefers-reduced-motion` as elsewhere).
- [ ] **Screen reader landmarks**: single `<main aria-labelledby="consent-heading">`
      preserved; h1→h2→h3 hierarchy preserved; `<details class="review-dev">` dev
      notes preserved.
- [ ] **RTL/locale**: `dir` comes from the root layout; the action row uses logical
      order (deny leading in DOM), so RTL rendering mirrors automatically.
      `word-break: keep-all` (global) applies to Korean copy.
- [ ] Mechanical gates: `bun run design:lint` (no hardcoded colors, no icon-only
      buttons without labels), `bun run contrast:check`, axe-core clean, i18n
      key-parity test green.

## i18n — new and changed keys (`pages.oauthAuthorize.*`, both catalogs)

| Key | Status | ko | en |
|---|---|---|---|
| `consentLead` | **new** | `이 앱이 아래 계정의 권한 범위 안에서 co-newbiz에 접근하도록 허용합니다.` | `This app will access co-newbiz within the permission scope of the account below.` |
| `accountLabel` | **new** | `계정` | `Account` |
| `redirectHostLabel` | **new** | `승인 후 돌아갈 주소` | `Redirect address after approval` |
| `redirectHostCaution` | **new** | `연결하려는 앱의 주소와 일치하는지 확인하세요. 일치하지 않으면 승인하지 마세요.` | `Check that this matches the app you are connecting. If it does not match, do not approve.` |
| `approveBlockedNote` | **new** | `현재 역할로는 부여할 수 없는 권한이 있어 허용할 수 없습니다.` | `Some permissions cannot be granted with your current role, so the connection cannot be approved.` |
| `objLead` | **removed** | (superseded by `consentLead` + `accountLabel`) | — |
| `objMid` | **removed** | (superseded by `redirectHostLabel` + host block) | — |

Unchanged keys reused as-is: `heading`, `headingFailed`, `invalidHeading`,
`invalidMissingBody`, `invalidBody`, `backToApp`, `devNote`, `viewConnectedApps`,
`goDealBoard`, `chipVerified`, `chipUnverified`, `unverifiedNote`,
`requestedScopesHeading`, `scopeRead`, `scopeWrite`, `scopePropose`,
`scopeNotAllowedChip`, `noGateNote`, `approveBtn`, `denyBtn`, `loadFailed`,
`approving`, `denying`, `returning`, `decideFailed`. `pages.titles.oauthAuthorize`
unchanged.

Removals must land in **both** `ko.json` and `en.json` in the same PR (key-parity
test fails a one-sided change). Korean copy follows the plain-language preference;
`i18n-audit` must report no missing key.

## Escalation list (doctrine gaps → design-system-agent)

1. **Mono emphasis tier missing.** design-guide §4 scopes JetBrains Mono to
   "code/IDs" at `--fs-caption` only. The host block needs a large mono identity
   string (`--font-mono` at `--fs-h2`, weight 700). This design proceeds with that
   deliberate emphasis; design-system-agent should either sanction it as a named
   role (e.g. "identity string") or provide a token-based alternative.
2. **No callout/warning-box component in the catalog.** design-components.md and
   `components/ui.tsx` have status chips but no generic callout (info/warning/note,
   icon + body) pattern; GateDecisionPanel is domain-specific. This design builds
   the warning box and note box as local token-styled blocks; request catalog
   registration of a `Callout` component (variants: warning amber / note muted,
   icon+text multi-encoded by construction) once a second consumer appears.
3. **Icon vocabulary entry.** DESIGN-CHECKLIST item 4 requires new icons to be
   registered (`도메인 개념당 1개`). The host block uses a return-target/external
   reference glyph (↗ class) and the warning uses ⚠; ⚠ already appears in signal
   vocabulary (design-guide §3.2), the return-target glyph needs a vocabulary
   ruling or an existing-icon nomination.
4. **Chromeless consent surface is not a registered pattern.** design-screens.md P0
   Shell is "the skeleton shared by every screen", yet login/register (and now this)
   render bare. Request a registered variant note ("chromeless dialog pages:
   /login, /register, /oauth/*") so the exemption is doctrinal, matching the S11
   tabbed-variant precedent.
5. **btn-danger for a non-destructive refusal.** Doctrine pairs `.btn-danger` with
   destructive data actions (confirm-dialog rule). Using it for *deny* on a consent
   screen is a reasoned call (§ Primary action call). If design-system-agent rules
   against it, the fallback is `btn-ghost` with full-width equal-size treatment —
   the fail-safe tab order (deny first) carries the safety then, not the styling.

## Handoff

**To**: PM (Design Gate approval) → `frontend-engineer` (implementation), with
`design-system-agent` reviewing the escalations above.

**Reasoning in one line**: the screen already has every security fact; the redesign
changes only *form* — one card per decision question (who is asking → what it gets →
what it can never do), with the server-verified return host promoted to the largest
emphasized element so name-vs-host mismatch is visible before the action row is
reached.

**Real contract**: as stated above (GET/POST `/api/oauth/authorize`); no API change,
no new fields, no schema change. Implementation is confined to
`app/web-next/app/oauth/authorize/page.tsx`, `app/web-next/components/AppShell.tsx`
(bare-path branch gaining `/oauth/`), `app/web-next/locales/ko.json` / `en.json`,
and at most a few scoped rules in `app/web-next/app/styles.css` (tokens only).

**Implementation notes for frontend-engineer**:

- Use `PrimaryAction` for approve so the disabled-reason contract
  (`disabled` + `disabledReason` → adjacent `.primary-reason` + `aria-describedby`)
  is honored; note PrimaryAction's viewer-role fallback (`common.viewerReadOnly`)
  supersedes the scope reason when the caller is a viewer — acceptable, the viewer
  is the broader block.
- Deny: `Button variant="danger"`; DOM order deny → approve.
- The host value gets `overflow-wrap: anywhere` (pathological allowlisted hosts) —
  mono + wrap is fine inside the block.
- Preserve the `SCOPE_KEY` resolution and `PARAM_KEYS` forwarding exactly; no
  behavioral change in `decide()`.
- Keep `generateMetadata` title unchanged (`pages.titles.oauthAuthorize`).

**Measurable success criteria**:

1. **Phishing-judgment (primary)**: in a moderated check (n ≥ 5, both themes), users
   shown a lookalike-name client (e.g. name "ChatGPT Pro", redirect host
   `chatgpt-connect.example.net`) identify the mismatch **before** pressing any
   button in ≥ 90% of runs, with judgment time ≤ 10 s from screen load. First
   baseline measurement — the current layout provides no comparable figure because
   the host is prose.
2. **Unverified-warning noticeability**: ≥ 90% of participants recall `이 앱은
   검증되지 않았다` in an immediate post-task probe, and the warning box is
   attended (fixation or explicit mention) before the first decision in every run.
3. **Mechanical**: `design:lint`, `contrast:check` (AA both themes), axe-core, and
   i18n parity all green; 320px reflow without horizontal scroll; keyboard-only
   path (load → deny, load → blocked-approve observation) completes with visible
   focus at every stop.
4. **Preview verification (ADR-0065 / ADR-0070)**: dev server; verify at 1280px,
   a popup-simulated 560px, and 375px; at minimum one approve flow and one blocked
   flow exercised; notes/screenshots in the PR description.

**Scope guard**: no scope-granular consent, no API/backend change, no admin
verify-client UI, no registry registration by the designer (PM runs the Design Gate;
`spec-register` follows the workspace flow after approval).

## Out of scope

Scope-granular consent (deferred backend work); client logo/avatar (no asset source
in the contract — a logo slot is also a phishing surface and is deliberately not
introduced); client_id display (operator-level detail, no decision value for the
persona); changes to token lifetimes, scopes, or the redirect-host allowlist
(ADR-0154/0203 domain); localization beyond ko/en.

## Disclaimer

This design is decision support, not a security certification. The phishing
resistance claimed in the success criteria is a usability hypothesis until the
moderated check runs; where this document conflicts with ADR-0154/ADR-0203 or the
code, the ADRs and the code govern.
