# ADR 0140 — The theme override was a missing control, not a missing feature

**Status:** Accepted (2026-07-28).
**Implementation:** Implemented.

Completes ADR [0010](0010-ui-state-zustand-store-package.md)'s preference model on web.
Relates to ADR [0111](0111-design-system-scale-and-component-kit.md) (`SegmentedNav`)
and ADR [0026](0026-web-security-headers-csp.md) (the no-FOUC script's CSP nonce).

## Context

A user on the web app was locked to whatever colour scheme the OS reported, with
no way to override it. This had been carried on the "for Martin" list as a fenced
feature awaiting a product decision, which mis-described it: nothing about it was
undecided, and it is a defect on a shipped surface.

The reason it was mis-filed is that the gap looks bigger than it is. Everything
underneath the control already exists and is already correct:

- `packages/store` models the preference as `light | dark | system` with
  `setTheme`, and `DEFAULT_THEME` is `system`.
- `apps/web/lib/theme.ts` binds that store to a `localStorage` adapter that is
  SSR-guarded, validates the stored string, and writes synchronously.
- `ThemeEffect` resolves the preference against `matchMedia`, applies `.dark` to
  the document element, and re-resolves on OS flip — `system` is already the only
  mode that subscribes to the OS.
- The no-FOUC script in the root layout reads the same `localStorage["theme"]`
  key before first paint.
- The ICU keys `theme.{label,light,dark,system}` already exist in **both** the
  `cs` and `en` catalogs, with zero call sites.
- Mobile has shipped a toggle since ADR 0010.

The only thing missing on web was a component that calls `setTheme`. Every hit
for `setTheme` in the repo was the store's own definition and mobile's toggle.

## Decision

**Ship the control and nothing else.** A `ThemeToggle` client component in
`apps/web/components/settings/` rendered in a section on `/account`, built on the
kit's `SegmentedNav` / `SegmentedNavItem` — three segments, one pressed.

**`setTheme`, never the store's `toggle()`.** `toggle()` is a two-way light↔dark
flip that can never produce `system`. A control built on it would make the
default unreachable once touched, which is worse than having no control: the user
could no longer hand the decision back to the OS.

**`/account`, not `/settings`.** It is a per-person display preference, and
`localStorage` makes it per-device — which matches what the profile tab already
implies. The section shape is copied from `/account/security`.

**`localStorage` only — no server column.** No user-preferences store exists (the
sole per-user preference column in 26 tables is `user.locale`), and adding one
would not remove the local write regardless: the no-FOUC script runs before any
session data exists, so `localStorage` is load-bearing whatever else is true. A
server-synced preference would be an _additive_ cross-device layer, cheapest as a
`user.additionalFields` sibling of `user.locale`, and is deliberately not built
here.

**Gate the pressed state on mount.** The storage adapter returns the `system`
default on the server, so a user whose stored preference is `dark` would have the
server mark `system` pressed and the client mark `dark` — a hydration mismatch on
every authenticated page load. A `mounted` flag keeps the first client render
byte-identical to the server's, then flips. This costs nothing visually, because
the no-FOUC script has already applied the actual theme; only which pill reads as
pressed settles a tick late.

## Consequences

- The override is reachable, persists across reloads, and agrees with the
  pre-paint script by construction — both write and read the same raw key/value,
  so there is no second pre-paint writer to keep in sync.
- No new i18n work, no new storage, no backend, no schema. The diff is one
  component, one section, one test file.
- The test asserts the _stored_ value is the raw preference string, not just that
  the store updated. That is the coupling that would break silently: the inline
  script forces dark only on the exact string `"dark"`, so a serialised value
  would leave first paint disagreeing with the control on every load.
- **Dark mode remains undesigned** (`design/README.md` §dark). Shipping the
  control does not make dark a reviewed second skin — it exposes tokens and
  surfaces that have never had an eyes-on pass. That is stated here rather than
  quietly inherited: this ADR ships the _escape hatch_, and a per-surface dark
  pass is a separate, much larger slice.
- Upstream: `fullstack-skeleton` has the same asymmetry (a mobile toggle, no web
  one), so this is owed back to the skeleton as a channel-A contribution.
