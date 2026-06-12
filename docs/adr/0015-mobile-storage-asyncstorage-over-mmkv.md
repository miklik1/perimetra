# ADR 0015 — Mobile key-value storage: AsyncStorage over MMKV (keep Expo Go)

**Status:** Accepted (2026-06-02).

## Context

Mobile UI state that must survive an app restart needs a key-value store on
device. The first such state is the theme preference ([ADR 0010](0010-ui-state-zustand-store-package.md)),
already wired to `@react-native-async-storage/async-storage`. The question this
ADR settles is the **engine choice for all future mobile persistence**, not the
theme alone — because that choice has a project-wide side effect.

The two realistic options:

- **AsyncStorage** (`@react-native-async-storage/async-storage`) — the Expo-SDK
  baseline. Async API, SQLite/SharedPreferences-backed. **Bundled in Expo Go.**
  Already a dependency.
- **MMKV** (`react-native-mmkv` v4) — ~10–30× faster, **synchronous** reads,
  optional AES-256. But v4 is a **Nitro native module** (`react-native-nitro-modules`).
  Any native module outside Expo Go's bundle means the app **can no longer run in
  Expo Go** — every contributor needs a development build (`expo run:ios` /
  `expo run:android` + `expo-dev-client`) or EAS Build.

The skeleton currently runs in **Expo Go**: no `expo-dev-client`, the only config
plugins are `expo-router` / `expo-system-ui`, and every dependency is either
Expo-SDK-bundled or pure-JS. QR-scan-into-Expo-Go is a deliberate onboarding
feature — no native toolchain, runs in seconds on any machine.

## Decision

- **Use AsyncStorage** for mobile key-value persistence. It is bundled in Expo Go,
  zero native deps, already installed, and SDK-pinned (guarded by `expo install
--check`). Keeping the app Expo Go-compatible outweighs raw storage speed —
  persisted UI state here is tiny, low-frequency, boot-time data (a theme key),
  where AsyncStorage's latency is irrelevant.
- **Treat "Expo Go-compatible" as a standing constraint.** Adding any native
  module (MMKV, secure storage, custom native code) is an Expo-Go-breaking
  decision that must be made explicitly in its own ADR — not slipped in as an
  implementation detail.
- **AsyncStorage's one weakness — async hydration — is handled at the app, not the
  store.** The synchronous `ThemeStorage` seam (ADR 0010) hydrates from an
  in-memory mirror; the splash screen (`expo-splash-screen`) is held until
  `hydrateTheme()` resolves, so there is no cold-start flash of the wrong theme.
  This mirrors web's no-FOUC inline script (`apps/web/app/layout.tsx`).

## Consequences

- The app keeps running in Expo Go; onboarding stays "scan a QR code".
- Persistence is async; UI that depends on a restored value must tolerate one
  async tick or gate on it (the theme gates via the held splash).
- **MMKV is the documented upgrade path.** The day the skeleton independently
  commits to dev builds (e.g. auth / `expo-secure-store` / another native module
  lands), revisit and supersede this ADR: swap the `ThemeStorage` adapter for an
  MMKV-backed one (synchronous — the splash hold can then be dropped). The ADR
  0010 injected-adapter seam makes that a localized change in
  `apps/mobile/lib/theme.ts`, no store rewrite.
- For sensitive data (tokens), neither is the answer — that will be
  `expo-secure-store`, decided when auth lands.

## Sources

- AsyncStorage — https://docs.expo.dev/versions/latest/sdk/async-storage/
- `react-native-mmkv` (v4 Nitro module; Expo dev-build requirement) —
  https://github.com/mrousavy/react-native-mmkv
- [ADR 0010](0010-ui-state-zustand-store-package.md) (theme store + adapter seam),
  [ADR 0013](0013-expo-sdk-56-upgrade.md) (SDK 56 / RN 0.85 pins).
