# ADR 0013 — Upgrade to Expo SDK 56 (RN 0.85 + React 19.2 + TypeScript 6.0)

**Status:** Accepted (2026-06-01)

Supersedes the SDK-55-specific version pins in
[ADR 0002](0002-reanimated-4-retained.md) (the Reanimated-4 reasoning still
holds — only the pinned versions move).

## Context

Expo SDK 56 went GA (`expo@56.0.8`): React Native 0.85, React 19.2, Hermes V1
as the default JS engine, and a new animation backend aligned with the New
Architecture. The skeleton targeted SDK 55 (RN 0.84); a reference skeleton
should sit on the freshest proven stack. With SDK 56 out, npm `latest` tags no
longer point at SDK-55 versions, so the SDK-correct pins must come from the
SDK's own `bundledNativeModules.json` (what `expo install --check` compares
against), not from "latest" — several libraries diverge from latest (e.g.
`react-native-gesture-handler` latest is `3.0.0`, but SDK 56 pins `~2.31.1`).

## Decision

- **Bump the `expo55` named catalog to `expo56`** in `pnpm-workspace.yaml` and
  repoint every `catalog:expo55` reference (`apps/mobile`, `packages/navigation`).
- **Derive all SDK-aligned pins from `expo install --check`** (SDK 56
  `bundledNativeModules`), never hand-picked from "latest":

  | package                                                                                 | SDK 56 pin |
  | --------------------------------------------------------------------------------------- | ---------- |
  | `expo`                                                                                  | `~56.0.8`  |
  | `react-native`                                                                          | `0.85.3`   |
  | `react-native-gesture-handler`                                                          | `~2.31.1`  |
  | `react-native-reanimated`                                                               | `4.3.1`    |
  | `react-native-worklets`                                                                 | `0.8.3`    |
  | `react-native-safe-area-context`                                                        | `~5.7.0`   |
  | `react-native-screens`                                                                  | `4.25.2`   |
  | `react-native-web`                                                                      | `~0.21.0`  |
  | `expo-router`                                                                           | `~56.2.8`  |
  | `expo-system-ui`                                                                        | `~56.0.5`  |
  | `expo-constants` / `-linking` / `-status-bar` / `@expo/metro-runtime` / `@expo/log-box` | `~56.0.x`  |

  `expo-system-ui` is new in this changeset — it carries the prebuild mod that
  applies `userInterfaceStyle` to Android and **must be registered in
  `app.config.ts`'s `plugins`** (`["expo-router", "expo-system-ui"]`), not merely
  installed, or Android dark mode is silently ignored.

- **Pin React to the SDK-expected `19.2.3` exactly** (drop the `^` in the
  `react19` catalog) and **enforce one React version repo-wide via
  `pnpm.overrides` (`react`/`react-dom` → `catalog:react19`)**. Without the
  override, dev/test tooling floats `react`/`react-dom` to `19.2.6`, producing a
  dual-React-instance hooks crash in web tests. One React = clean
  `expo install --check` + no duplicate-renderer hazard.
- **Adopt TypeScript 6.0** (`~6.0.3`, the SDK-56-expected version;
  typescript-eslint 8.60 supports it — peer `typescript <6.1.0`). TS 6.0 needs
  three small config migrations, all config-only (no logic changes):
  - `types: ["node"]` in `@repo/utils` and `@repo/config` — TS 6.0 stopped
    auto-including `@types/node`, so `console`/`process` globals went missing.
    Only these two packages use Node globals and carry the `@types/node` dep.
  - Removed the deprecated `baseUrl` from `@repo/ui` (errors in TS 6.0, gone in
    TS 7.0); the `paths` mapping resolves relative to the tsconfig dir unchanged.
  - Added a `declare module "*.css"` ambient to `apps/mobile/nativewind-env.d.ts`
    — TS 6.0 errors on untyped side-effect imports (`import "./global.css"`);
    NativeWind v5 / `react-native-css` ship no `*.css` module type.
- **Do not add the Reanimated/worklets Babel plugin manually** —
  `babel-preset-expo` (SDK 56) still injects it (unchanged from ADR 0002).

## Consequences

- `expo install --check` reports **"Dependencies are up to date"**;
  `expo-doctor` **21/21**; **25/25** Turbo tasks (`check-types`/`test`/`lint`/
  `build`) green; `knip` clean; **zero** peer-dependency warnings.
- `nativewind@5.0.0-preview.4` + `react-native-css@^3.0.7` + the
  `lightningcss@1.30.1` override compile and bundle cleanly on RN 0.85
  (`expo export` native bundles ~4.5–4.7 MB Hermes bytecode).
- **Mobile-web caveat:** `expo export` emits a **0-byte web CSS bundle** under
  the NativeWind v5 preview (native styles compile into the JS bundle, so iOS /
  Android are unaffected). The product's web platform is `apps/web` (Next.js +
  Tailwind v4), not the Expo web target — Expo mobile-web is **out of scope** and
  its empty CSS is a known v5-preview limitation, not a regression.
- **Device smoke-test is re-required.** Per ADR 0001 the NativeWind v5 preview
  pin is only "accepted" after an iOS + Android on-device test; the SDK 55 → 56
  change (RN 0.84 → 0.85, new animation backend) resets that precondition. The
  in-code prerequisites now exist: `userInterfaceStyle: "automatic"`, mobile UI
  on semantic tokens (`bg-background` / `text-foreground`, dark-variant ready),
  and a color-scheme readout on the home screen. The literal run cannot happen on
  the WSL2 dev box (no macOS, no Android SDK/emulator) — it is gated on an EAS
  cloud build (`eas init` + `eas build`, the same gate as E2E in
  [ADR 0005](0005-testing-two-runner-split.md)), not a local `expo run`.
- TypeScript 6.0 is now the monorepo-wide toolchain; future SDK upgrades
  continue to reconcile RN-library pins via `expo install --check` (ADR 0002 /
  0005).

## Sources

- Expo SDK 56 changelog (RN 0.85, React 19.2, Hermes V1 default, new animation
  backend): https://expo.dev/changelog/sdk-56
- Expo `bundledNativeModules.json`, `expo@56.0.8` (authoritative SDK-56 pin set;
  read via the installed package / `expo install --check`).
- typescript-eslint `8.60.0` peer range `typescript ">=4.8.4 <6.1.0"` (npm) —
  confirms TS 6.0 support.
- React Native 0.85 release notes (new animation backend, Hermes V1).
