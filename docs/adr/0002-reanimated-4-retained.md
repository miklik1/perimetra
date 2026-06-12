# ADR 0002 — Retain Reanimated 4 (no NativeWind conflict)

**Status:** Accepted (2026-05-19) — version pins partly superseded by
[ADR 0013](0013-expo-sdk-56-upgrade.md)

> **Note (2026-06-01):** the specific SDK-55 pins below
> (`react-native-reanimated ~4.2.1`, `react-native-worklets ~0.7.4`) are
> superseded by the SDK-56 pins in [ADR 0013](0013-expo-sdk-56-upgrade.md)
> (`reanimated 4.3.1`, `worklets 0.8.3`). The core decision — **keep Reanimated
> 4, enforce alignment via `expo install --check`, never hand-pin** — is
> unchanged.

## Context

An initial review flagged a suspected conflict: "NativeWind 4 only supports
Reanimated v3," while `apps/mobile` declares `react-native-reanimated ~4.2.3`
and `react-native-worklets ~0.8.1` (Reanimated v4). Online opinion is
contradictory. A focused primary-source verification was performed.

Findings:

- `nativewind@4.2.4` declares no Reanimated peer itself; it pins
  `react-native-css-interop@0.2.4`, whose `peerDependencies` include
  `"react-native-reanimated": ">=3.6.2"` (required, not optional). The range is
  open-ended — **Reanimated 4.x satisfies it. No install-time conflict.**
- Reanimated is inert plumbing for basic styling; it is exercised only by
  `transition-*` / animation utility classes (which NativeWind's own docs call
  experimental — use Reanimated directly for complex animation).
- **Expo SDK 55 ships Reanimated `4.2.1` + worklets `0.7.4`** (Expo
  `bundledNativeModules.json`, branch `sdk-55`). SDK 54+ made the New
  Architecture mandatory; **Reanimated 4 only supports New Arch, Reanimated 3 is
  legacy-arch only.** On SDK 55, Reanimated 4 is the supported path;
  downgrading to v3 would fight the SDK and is the _higher_-risk choice.
- The "NativeWind doesn't support Reanimated 4" claim was briefly true during
  the SDK 53→54 transition (Aug–Sep 2025, NativeWind ≤4.1.x) and was **fixed in
  NativeWind 4.2.1+**. Maintainer danstepanov, nativewind discussion #1529,
  2025-09-29, verbatim: _"Nativewind v4 and v5 both support
  react-native-reanimated v4."_ The discussion is closed. The claim is now an
  outdated myth.
- The skeleton's `apps/mobile/babel.config.cjs` is already correct: it does not
  manually add the reanimated or worklets Babel plugin. `babel-preset-expo` on
  SDK 55 injects the worklets plugin automatically; adding either manually
  causes a duplicate-plugin error.

The only real risk: the skeleton's `~4.2.3` / `~0.8.1` are **ahead** of SDK
55's pinned `4.2.1` / `0.7.4`. With Expo Go / precompiled libraries the native
C++ is fixed at the SDK versions; a JS/native worklets skew produces the runtime
error _"Mismatched JavaScript and native versions of worklets."_

## Decision

- **Keep Reanimated 4.** Do not downgrade to Reanimated 3.
- NativeWind on mobile is v5 ([ADR 0001](0001-styling-split-ui-tailwind-v4.md)),
  which also requires Reanimated 4+ ("Nativewind v5 uses internal features that
  depend on Reanimated v4+") — same constraint, no change. (Reanimated 4 is also
  what NativeWind 4.2.1+ supports, so this holds across the eventual upgrade
  path.)
- **Align Reanimated/worklets to the SDK 55 pins:** `react-native-reanimated`
  → `~4.2.1`, `react-native-worklets` → `~0.7.4`. Enforce via
  `npx expo install --check` / `npx expo-doctor` rather than hand-pinning.
- Do not add the reanimated or worklets Babel plugin manually (leave
  `babel-preset-expo` to inject it).

## Consequences

- No NativeWind ↔ Reanimated incompatibility exists. The earlier risk flag is
  retracted.
- Version alignment is enforced by Expo tooling, so future SDK upgrades
  reconcile these automatically (`expo install --check` in CI is recommended —
  see [ADR 0005](0005-testing-two-runner-split.md)).
- Complex animation should use Reanimated directly, not NativeWind
  `transition-*` utilities (experimental, iOS/Android-inconsistent).

## Sources

- npm registry: `react-native-css-interop@0.2.4` peerDependencies.
- Expo `bundledNativeModules.json`, branch `sdk-55` (reanimated 4.2.1 /
  worklets 0.7.4).
- https://github.com/nativewind/nativewind/discussions/1529 (maintainer:
  "v4 and v5 both support reanimated v4", 2025-09-29, closed)
- https://github.com/expo/expo/discussions/39130 (SDK 54 nativewind+reanimated
  working config; root cause = NativeWind ≤4.1.x, fixed by 4.2.1)
- https://github.com/software-mansion/react-native-reanimated/discussions/8778
  (JS/native worklets version-mismatch error)
- https://expo.dev/changelog/sdk-54 (New Arch mandatory; Reanimated 4 = New Arch
  only)
