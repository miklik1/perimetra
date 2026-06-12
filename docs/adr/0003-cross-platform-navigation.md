# ADR 0003 — Per-platform routing + in-repo route contract (no Solito)

**Status:** Accepted (2026-05-19)

## Context

Web uses Next.js 16 App Router; mobile uses expo-router (SDK 55). There is
currently no shared navigation/routing/linking layer. The question: adopt a
cross-platform navigation library (Solito), collapse to one router everywhere,
or keep routing per-platform and share only logic.

Findings:

- **Solito** is alive but stagnant: latest release v5.0.0 (2024-10-21), no
  2026 releases, single maintainer, ~4.1k stars. The maintainer has publicly
  pivoted web-first; Solito 5 itself dropped react-native-web from its core and
  now re-exports real `next/link` on web. Putting a thin abstraction between two
  fast-moving frameworks creates a permanent upgrade gate (every Next major _and_
  every Expo SDK must be Solito-blessed before either can move) — concentration
  risk for a multi-year base.
- **Expo Router for web** is not production-mature: Expo's RSC web support is
  beta/experimental in 2026 (no full Stack/Tabs/Drawer in RSC mode, RSC→HTML
  server rendering unsupported, production deployment "not recommended yet").
  Collapsing to it would trade away the strongest web asset (real Next.js: RSC,
  SEO, streaming, the web platform).
- **The 2026 consensus** (create-t3-turbo, the actively-maintained reference
  monorepo) deliberately excludes Solito and writes routing per-platform,
  sharing API/types/logic via packages: _"the platforms are different enough
  that they should be treated differently."_

## Decision

- **Keep Next.js App Router and expo-router as separate routing layers.** Do
  not adopt Solito as an architectural pillar. Do not collapse to one router.
- Add a thin in-repo route contract instead:
  - **`@repo/navigation`** (new package): a typed route registry — route names
    and params as TS types, plus pure path-builder functions
    (`routes.user(id) => "/user/${id}"`). One source of truth; both apps import
    it so URLs / deep links cannot drift.
  - **`Link` / `useNavigate` in `@repo/ui`** via the file-extension resolution
    already in use: `link.tsx` wraps `next/link`; `link.native.tsx` wraps
    expo-router's `Link`. Same props (the typed `href` from the registry),
    different implementations, no runtime abstraction — Metro/Next resolve by
    extension.
  - Route trees stay native per app (`apps/web/app/**`, `apps/mobile/app/**`).
    Each route file is a thin wrapper feeding params into a shared screen body
    in `@repo/ui` / `@repo/shared`.
- **SEO/content web pages use plain DOM + Tailwind, not RN primitives**, to
  preserve RSC (see [ADR 0006](0006-split-ui-web-dom-mobile-rn.md)).

If a future requirement is large numbers of pixel-identical CRUD screens on both
platforms, Solito may be reconsidered — but only behind `@repo/ui`'s `Link`, as
a swappable detail, never as a pillar.

## Consequences

- Screens are written per-platform where platforms genuinely diverge
  (navigation gestures, headers, tab bars, deep links, SEO/metadata). Shared
  _screen bodies_ live in packages; per-app route files are thin.
- Zero third-party routing coupling; each framework upgrades independently with
  no cross-gate.
- Slightly more boilerplate (two route files per screen) — accepted as the
  price of optionality and per-platform UX freedom.

## Sources

- https://github.com/nandorojo/solito/releases (v5.0.0, 2024-10-21; no 2026
  releases)
- https://github.com/nandorojo/solito/discussions/428 (maintainer web-first
  stance)
- https://docs.expo.dev/guides/server-components/ (Expo RSC beta, 2026)
- https://github.com/t3-oss/create-t3-turbo (Solito intentionally excluded;
  per-platform screens)
