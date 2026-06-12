# ADR 0006 — Split UI: web DOM/RSC, mobile RN; share logic not pixels

**Status:** Accepted (2026-05-26) — supersedes the earlier "`@repo/ui` is
client-only" ADR, which assumed the shared-RN-UI model we have now abandoned

## Context

We chose the split-UI / logic-only model ([ADR 0001](0001-styling-split-ui-tailwind-v4.md)),
matching create-t3-turbo. The previous ADR argued `@repo/ui` had to be
client-only and Jest-tested because it rendered RN primitives on web via
react-native-web. **That premise is gone** — there is no react-native-web on
web anymore.

create-t3-turbo confirms the shape: `packages/ui` is web-only (radix/CVA DOM),
`apps/expo` writes its own RN + NativeWind UI, and only design tokens + logic
packages (`api`, `auth`, `db`, `validators`) are shared.

## Decision

- **Web UI** lives in a web-only package (e.g. `@repo/ui-web`) or in
  `apps/web`: shadcn/radix + plain DOM, Tailwind v4. **RSC-capable** — server
  components by default, `"use client"` only at interactive leaves. No
  react-native, no react-native-web.
- **Mobile UI** lives in `apps/mobile` (or `@repo/ui-native`): React Native
  primitives + NativeWind v5. Not imported by web.
- **Shared, not pixels:** types, API client, validation schemas, business
  logic, query hooks, the route contract ([ADR 0003](0003-cross-platform-navigation.md)),
  and the design-token theme ([ADR 0004](0004-theming-token-system.md)).
- Primitive components (Button, Card, Input) are written once per platform.
  Tokens keep them consistent; do not attempt to share their rendering.

## Consequences

- Web keeps full RSC, streaming, SEO, minimal client JS — no client-only tax,
  no Tailwind v3 lock, no RNW fragility.
- Shared packages are pure TS/DOM, so they test under Vitest; only `apps/mobile`
  needs Jest ([ADR 0005](0005-testing-two-runner-split.md)). Simpler than the
  shared-RN-UI model.
- Cost: primitive UI written twice. Bounded and low; the components diverge by
  platform anyway (hover/keyboard/SEO vs touch/gesture/safe-area).
- `next.config.js` no longer needs `transpilePackages` for react-native /
  react-native-web — drop them when refactoring (keep only genuine TS workspace
  packages if their build requires it).

## Sources

- create-t3-turbo `packages/ui` (web-only radix/CVA), `apps/expo/src/app/*`
  (RN + NativeWind, no `@acme/ui` import) — verified late May 2026.
- https://www.nativewind.dev/docs/getting-started/installation/nextjs
