# ADR 0004 — Shared Tailwind v4 `@theme` token system

**Status:** Accepted (2026-05-26) — revised for the split-UI / Tailwind-v4 model
(supersedes the earlier `rgb(var() / <alpha-value>)` v3 framing)

## Context

Under the split-UI model ([ADR 0001](0001-styling-split-ui-tailwind-v4.md)) both
platforms are on **Tailwind v4**: web natively, mobile via NativeWind v5. Tailwind
v4 is CSS-first — tokens live in a `@theme` block in CSS, not a JS config. This
removes the NativeWind-4 / Tailwind-3 footgun entirely (bare `var(--token)`
losing `<alpha-value>`, the `rgb(var(--token) / <alpha-value>)` channel hack);
Tailwind v4 handles modern color (OKLCH) and alpha natively.

create-t3-turbo demonstrates the pattern: a single
`tooling/tailwind/theme.css` (`@theme inline` with OKLCH tokens, `@variant dark`
overrides, radius/shadow vars) exported as `@acme/tailwind-config/theme` and
`@import`-ed by both `apps/nextjs/src/app/styles.css` and
`apps/expo/src/styles.css`.

The earlier skeleton's `tailwind.config.shared.js` (bare `var(--background)`,
plus a mobile `global.css` with no token values) is obsolete and should be
removed.

## Decision

**Single source of truth = one Tailwind v4 `@theme` CSS file, imported by both
apps.**

1. **`packages/tailwind-config/theme.css`** (or `@repo/tailwind-config/theme`) —
   CSS-first `@theme` with OKLCH semantic tokens and dark-variant overrides:
   ```css
   @theme {
     --color-background: oklch(1 0 0);
     --color-foreground: oklch(0.21 0.006 285);
     --color-primary: oklch(0.62 0.19 259);
     /* muted, border, card, destructive, radius, ... */
   }
   @variant dark {
     --color-background: oklch(0.21 0.006 285);
     --color-foreground: oklch(0.98 0 0);
   }
   ```
2. **Web** `apps/web/.../styles.css`:
   ```css
   @import "tailwindcss";
   @import "@repo/tailwind-config/theme";
   @source "../../../packages/ui/src/*.{ts,tsx}";
   @custom-variant dark (&:where(.dark, .dark *));
   ```
3. **Mobile** `apps/mobile/src/styles.css` (NativeWind v5):
   ```css
   @import "tailwindcss/theme.css" layer(theme);
   @import "tailwindcss/preflight.css" layer(base);
   @import "tailwindcss/utilities.css";
   @import "nativewind/theme";
   @import "@repo/tailwind-config/theme";
   ```
4. **Semantic tokens only** in components (`bg-background`,
   `text-muted-foreground`) — never raw palette. shadcn / react-native-reusables
   naming for ecosystem compatibility.
5. **Dark mode**: system default; offer light/dark/system toggle. Web drives a
   `.dark`/`.light` class on `<html>`; native uses NativeWind v5's color-scheme
   API (v5 deprecates NativeWind's own `useColorScheme` in favor of RN's
   `useColorScheme` + `Appearance.setColorScheme()` — confirm against the pinned
   preview at implementation).
6. **Mobile config is CSS-first** — no `tailwind.config.js`; Metro
   `withNativewind`. Apply the `lightningcss` `1.30.1` override the v5 docs
   require.

## Consequences

- One token file, both platforms, Tailwind v4 throughout — visual consistency
  by construction, no manual token sync.
- No more channel/alpha hacks; OKLCH + native v4 alpha.
- Web no-flash on Next.js App Router still applies for the explicit-theme case:
  cookie → server-render the class on `<html>` → inline pre-paint script →
  `suppressHydrationWarning`. (Web UI is RSC/DOM here, so the themed tree is not
  forced client-only — see [ADR 0006](0006-split-ui-web-dom-mobile-rn.md).)
- v5 dark-mode behavior is a known preview rough edge; validate during the
  build smoke-test required by ADR 0001.

## Sources

- create-t3-turbo `tooling/tailwind/theme.css`, `apps/nextjs/src/app/styles.css`,
  `apps/expo/src/styles.css` (verified late May 2026).
- https://www.nativewind.dev/v5/guides/themes (v5 CSS-first theming)
- https://tailwindcss.com/docs/theme (`@theme`, v4)
