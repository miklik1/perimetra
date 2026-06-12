# ADR 0001 — Split UI: web Tailwind v4 + shadcn, mobile NativeWind v5; shared token theme

**Status:** Accepted (2026-05-26) — supersedes the earlier shared-UI / Tailwind-v3 framing.
Implemented (2026-06-01): mobile promoted to the v5 preview — see [Implementation](#implementation-2026-06-01).

## Context

Earlier drafts of this skeleton shared a single `@repo/ui` built on React Native
primitives, rendered on web via react-native-web. That forced: web UI
client-only (no RSC), a Tailwind v3 lock (NativeWind 4 requires Tailwind v3),
react-native-web coupling, and dual test runners on a shared package.

We have since chosen the **split-UI / logic-only model** (see the architecture
overview): share types, API, validation, and business logic; write UI
separately per platform. This is the create-t3-turbo model. Verified against
create-t3-turbo `main` (late May 2026):

- **No react-native-web anywhere.** `apps/nextjs` is pure React DOM.
- `packages/ui` is web-only shadcn/radix DOM (CVA, radix, `tailwind-merge`); no
  `react-native`, no `nativewind`. `apps/expo` writes its own RN + NativeWind
  UI and does not import the web UI package.
- One shared Tailwind v4 design-token theme (`@acme/tailwind-config/theme`,
  CSS-first `@theme` with OKLCH tokens) imported by both apps' CSS.
- Mobile runs **`nativewind@5.0.0-preview.2` + `tailwindcss@^4.1.16`**, pinned
  exact (no caret), Metro `withNativewind`, no `tailwind.config.js`.

Splitting the UI **deletes the Tailwind v3 lock**: because web uses zero
NativeWind, web is free to use Tailwind v4 + shadcn with full RSC. NativeWind
now touches mobile only — and the NativeWind v5 risks previously flagged
(Next.js/Turbopack + lightningcss + react-native-web on the web build) **no
longer exist here**, because that web surface is gone. The remaining v5 risk is
mobile-only (Metro) and far smaller.

The pull toward v5 on mobile is **token unification**: a single Tailwind v4
`@theme` token file can serve both platforms. If mobile stayed on NativeWind 4
(Tailwind v3), that file could not be shared with web's Tailwind v4 `@theme` —
we'd maintain two token sources and sync by hand.

## Decision

- **Web** (`apps/web`): Tailwind **v4** + shadcn/radix DOM components. No
  NativeWind, no react-native-web. Full RSC.
- **Mobile** (`apps/mobile`): React Native primitives + **NativeWind v5**
  (Tailwind v4), **pinned to an exact preview** (no caret) to freeze preview
  churn — mirroring t3-turbo's discipline. Configure CSS-first via Metro
  `withNativewind`; no `tailwind.config.js`.
- **Shared tokens**: one Tailwind v4 `@theme` CSS file (e.g.
  `@repo/tailwind-config/theme`, OKLCH tokens) imported by both apps. Single
  source of truth for colors/spacing/radii (see
  [ADR 0004](0004-theming-token-system.md)).
- **Version specifics to settle at implementation:** pin the latest stable v5
  preview (5.0.0-preview.4 was current 2026-05-15); apply the `lightningcss`
  override pin (`1.30.1`) the v5 docs require; align Reanimated/worklets to the
  SDK 55 pins ([ADR 0002](0002-reanimated-4-retained.md)). Our target (Expo SDK
  55 + RN 0.84 + preview.4) is **less proven** than t3-turbo's (SDK 54 +
  preview.2), so a build smoke-test on iOS + Android + the mobile bundle is a
  precondition of accepting the pin.

## Consequences

- Web gets the full modern stack now (Tailwind v4, shadcn, RSC, minimal client
  JS) with no NativeWind dependency or v5 wait.
- Mobile carries mobile-only v5-preview risk: dark-mode quirks, the
  `lightningcss` deserialization pin, sparse migration docs, and **manual
  upgrades** (exact pin = no automatic bumps). Accepted as the price of one
  shared Tailwind v4 token model and alignment with the reference template.
- Buttons/cards are written twice (web DOM vs RN). Cheap; they diverge anyway;
  shared tokens keep them visually consistent.
- When NativeWind v5 reaches GA, drop the exact pin to a caret range; no
  architectural change.

## Implementation (2026-06-01)

The v5 promotion landed with these concrete pins (freshness-checked against npm on
the day):

- `nativewind` **`5.0.0-preview.4`** — exact, no caret (catalog `tailwind4`). This is
  still the latest preview (published 2026-05-15); `nativewind@latest` is `4.2.4`, which
  supports Tailwind v3 only and was the cause of the prior `mobile#build` failure.
- `react-native-css` **`^3.0.7`** — NativeWind v5's runtime peer (added to `apps/mobile`).
- `lightningcss` **`1.30.1`** — pinned via root `pnpm.overrides` (avoids the v5
  deserialize error).
- `tailwindcss` / `@tailwindcss/postcss` stay `4.3.0` (shared with web).
- Reanimated/worklets already on the SDK 55 catalog pins (`~4.2.3` / `~0.8.1`) — no change.

Mobile config: `global.css` rewritten to the v5 CSS-first imports + `@import
"@repo/tailwind-config/theme"` (the **same** token file web imports — one source of
truth, ADR 0004); deleted `tailwind.config.js` and `base.css`; `metro.config.cjs` →
`withNativeWind(config)` (no `{ input }`); `babel.config.cjs` reduced to
`babel-preset-expo` (dropped the `nativewind` JSX transform/plugin). No
`postcss.config` is needed — Metro compiles the CSS via lightningcss, not PostCSS
(verified: `expo export` is byte-identical with and without it).

**Still pending acceptance:** the iOS + Android device smoke-test (the current
SDK 56 / RN 0.85 target — see [ADR 0013](0013-expo-sdk-56-upgrade.md) — is less
proven than t3-turbo's SDK 54 / preview.2). The `expo export` bundle is green in
CI, but dark mode (v5 class-based / `VariableContextProvider`) and on-device
rendering must be confirmed before the preview pin is "accepted".

This **cannot run on the current dev box** (WSL2: no macOS for `expo run:ios`, no
Android SDK/emulator for `expo run:android`). The acceptance path is therefore an
**EAS cloud build** — `eas init` to link a project, then `eas build -p ios|android`
(or the scaffolded e2e workflow's build artifacts, [ADR 0005](0005-testing-two-runner-split.md))
installed on a real device/simulator. The same `eas init` gate also blocks E2E
activation, so the two land together. Until then the pin stays preview-pinned but
unaccepted; the `expo export` green is necessary, not sufficient.

## Sources

- create-t3-turbo `main` (verified late May 2026): `apps/expo/package.json`
  (`nativewind 5.0.0-preview.2`, `react-native-css 3.0.1`), `pnpm-workspace.yaml`
  catalog (`tailwindcss ^4.1.16`), `tooling/tailwind/theme.css` (OKLCH `@theme`),
  `packages/ui` (web-only radix/CVA, no react-native).
- https://www.nativewind.dev/v5 ; https://www.nativewind.dev/v5/getting-started/installation (lightningcss `1.30.1` pin)
- npm registry: `nativewind` `preview` = 5.0.0-preview.4 (2026-05-15).
