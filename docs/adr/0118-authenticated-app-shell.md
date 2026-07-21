# ADR 0118 — The authenticated app shell (one registry, three density renderings)

**Status:** Accepted (2026-07-21 — decided by Martin: "go" on the design-wave
Phase 1c slice). Delivers the app shell that `design/README.md` §4 specifies and
§11.1 places in Phase 1 alongside the configurator. Builds on
[ADR 0114](0114-design-canvas-adoption.md) (the design authority) and frames the
surface built in [ADR 0116](0116-configurator-commercial-plumbing-and-surface.md)
/ [ADR 0117](0117-configurator-immersive-frame-and-direct-manipulation.md).
**Supersedes the CAR-12 top-bar `NavShell`** (the flat nine-entry `bg-chrome`
header), which this shell removes.

## Context

The design authority (§4.1–4.5) specifies an authenticated app shell: an
**invariant, role-filtered surface registry** rendered at three densities —
a 220 px labelled rail (≥1280 px), a 68 px icon rail (768–1279 px), and a bottom
tab bar plus a top app bar (<768 px). "The rail item set is invariant across
breakpoints; only density changes." The shipped `NavShell` was none of that: a
flat nine-entry top bar in the old surface vocabulary (`configurator`,
`projects`, `quotes`, …), rendered as a `<header>` **sibling above** `{children}`.

Two structural facts shaped the build:

- The new registry is a different set in **tenant vocabulary** (Přehled,
  Poptávky, Nabídky, Zakázky, Katalog + a footer group Platforma/Nastavení), with
  routes demoted to tabs (a project is a pre-issue quote under Nabídky; account/
  team/admin move under Nastavení). `nav-registry.ts` was named by §4.5 as the
  artifact to rewrite.
- A rail beside the content is a **wrapping** layout, not a sibling above it.
  That wrap is what lets the shell retire the configurator's hand-duplicated
  `h-[calc(100dvh-3.5rem)]` coupling (the only consumer of the old top-bar
  height), replacing a magic number linked to `NavShell` by comment alone with a
  properly sized `<main>` slot.

## Decision

### 1. Registry rewrite — §4.1 vocabulary, §4.3 role matrix

`NAV_ENTRIES` becomes seven entries carrying `icon`, `group: "main" | "footer"`,
an optional `countKey`, and an optional `activeMatch`. Visibility predicates
mirror §4.3: `anyOrgMember` (Přehled, Zakázky), `adminOrSales` (Poptávky,
Nabídky, Katalog — **workshop loses the priced surfaces**, because a nabídka is
constitutively priced and the configurator prices what it configures, so routing
workshop there is a dead end), always-on (Nastavení — reachable even by an
org-less/still-resolving `role: null` session), and `isPlatformAdmin` (Platforma,
orthogonal to org role). `visibleNavEntries` stays the **single filter** so
"membership is invariant" is enforceable rather than aspirational; a new
`isNavEntryActive` centralises active-state matching (own route, prefix-matched,
plus `activeMatch` section children).

### 2. One rule, three renderings

`nav-shell.tsx` is retired. `components/app-shell/` splits into `SideRail` /
`IconRail` / `TabBar` / `MobileTopBar` over a shared `NavRowLink`, all pure
consumers of `visibleNavEntries`. The three renderings are toggled **purely by
CSS breakpoints** (`hidden xl:flex` / `hidden md:flex xl:hidden` / `flex
md:hidden`), never a JS media query — so there is no hydration hazard and the
a11y tree only ever carries the one visible nav. The icon rail labels via a real
`Tooltip` + `aria-label` (never the native `title`); every touch control is
44 px; the footer group (Platforma above Nastavení) is pinned to the rail bottom
and, on mobile, lives behind the top-bar avatar menu (never a tab).

### 3. The shell wraps children and kills the height coupling

Mounted in `app/providers.tsx` (it reads `useAuth`/`/v1/me` via
`useRole`/`usePlatformAdmin`), the shell **wraps** `{children}` in an `h-dvh`
flex container — a row `[rail][main]` on desktop/tablet, a column
`[top-bar][main][tab-bar]` on mobile. The content slot is a **role-neutral
`<div>`, not a `<main>`**: every page already renders its own `<main>`, so a
wrapping `<main>` would nest two "main" landmarks on every framed route (an
app-wide a11y regression the adversarial pass caught). The configurator drops
`h-[calc(100dvh-3.5rem)]` for `h-full`. On unauthenticated / public / print
routes the shell renders `{children}` **bare — never null** — so each page's own
`AuthGuard` fallback still shows; the flip to framed is joint with that guard
(both read the same `isAuthenticated`), so nothing resizes on auth-resolve.

### 4. The §4.2 print-chrome bug, and tab-bar suppression

`isChromelessRoute` now also matches the `/traveler` suffix — the two print
routes were rendering full app chrome onto a `window.print()` A4 (the live §4.2
bug). The mobile tab bar is suppressed where the surface owns a primary bottom
action bar (`/configurator`) **and** when the main group is empty (`role: null`
and the fail-closed first-paint flash — an empty bordered strip reads as broken,
while the top-bar avatar menu keeps the escape affordance).

### 5. Recorded deviations (§11.2)

- **Nastavení points at `/account`, not `/settings`.** The tabbed `/settings`
  section index is the 1c-2 slice; until it exists the footer entry targets its
  first tab (an existing route) so it never 404s, and `activeMatch` keeps the
  whole section (`/account`, `/account/security`, `/team`, `/team/legal-profile`,
  `/admin`) highlighted.
- **The §4.4 "avatar button" renders the account initial**, not a profile image —
  no avatar-image data model exists yet.
- **Count pills are absent.** The `GET /v1/me/nav-counts` endpoint is the 1c-3
  slice; an empty pill is worse than none, so 1c-1 renders none (the `countKey`
  metadata is in the registry, ready to wire).

## Adversarial review and eyes-on

The mandated review found **14 real defects** that the green gate
(build/types/lint/knip/507 web tests) could not: the nested `<main>` landmark
(app-wide); no branded `focus-visible` ring on any of the four shell controls
(the recurring missing-focus class); a broken active state on the framed
`/projects` and `/site/:id` Nabídky routes (no `activeMatch`); the empty tab-bar
strip for `role: null`; and — most valuable — a test that asserted **all four
rails present at once** (jsdom applies no media queries) and so never pinned the
breakpoint-collapse invariant, the core of the shell. All fixed; the collapse
rule is now pinned by per-rail display-class assertions, and the single-landmark
contract by a test whose child owns its `<main>`.

Eyes-on (§12.1 item 6) was cleared against a password-reset dev tenant: the
configurator + immersive frame at all six ship-bar widths in **both themes**, no
horizontal body scroll and no page errors at any width, side rail / icon rail /
mobile top bar rendering correctly per density.

**Harness fix (recorded lesson).** The eyes-on surfaced that
`capture-configurator.mjs`'s dark-mode technique — seed `localStorage
theme=dark` plus a post-load `classList.add("dark")` — **raced `ThemeEffect`** on
heavier desktop pages and silently produced LIGHT "dark" captures, so prior
desktop dark eyes-on (ADR 0116/0117) were unreliable. Replaced with a
**context-per-theme `colorScheme`** (proven by in-loop computed-style logging:
all six dark widths render `--color-chrome` dark). `capture-brand.mjs` /
`capture-production.mjs` share the old technique and are flagged for the same fix.

## Alternatives rejected

- **A JS breakpoint hook** for the three renderings — a hydration hazard the
  CSS-toggled approach avoids.
- **A blanket `min-h-screen` → `min-h-full` codemod** on the ~40 framed pages
  (the shell now bounds `<main>`, so `min-h-screen` over-scrolls on mobile): unsafe
  because `min-h-screen` is _correct_ in the bare/unauthenticated branch. Fixed
  per-surface as each is reskinned (§5 — contents untouched this wave).

## Consequences

The shell now frames every authenticated surface. Surfaces not yet reskinned
(quotes, projects, site, admin) render their old look inside the new rail — the
§5 scope fence (reskinned app shell only, contents untouched) — and are restyled
per phase. No schema change; the shell is pure app-land, so I1/I3/I5 are
untouched. The `/settings` section index (1c-2) and the `nav-counts` endpoint +
realtime pills (1c-3) are the queued follow-ons.
