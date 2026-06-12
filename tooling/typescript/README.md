# @repo/typescript-config

Shared `tsconfig` presets: one strict base extended into library, web-library, Next.js, and Expo variants.

## Exports

Referenced by relative path in each package's `tsconfig.json` (not via an exports map):

- `@repo/typescript-config/base.json` — strict base (`strict`, `noUncheckedIndexedAccess`, `isolatedModules`, NodeNext, ES2022 + DOM libs).
- `@repo/typescript-config/library.json` — base + Bundler resolution, ESNext modules, `jsx: react-jsx`, `noEmit` (platform-neutral / RN-compatible libraries — no DOM lib).
- `@repo/typescript-config/web-library.json` — `library.json` + DOM / DOM.Iterable libs (web-only packages, e.g. `@repo/ui`).
- `@repo/typescript-config/nextjs.json` — base + the Next plugin, `jsx: preserve`, `@/*` paths.
- `@repo/typescript-config/expo.json` — base + Bundler resolution, `jsx: react-jsx`, `@/*` paths.

## Usage

Extend the matching preset in a package's `tsconfig.json` (mirrors the shared packages):

```jsonc
{
  "extends": "@repo/typescript-config/library.json",
  "include": ["src"],
}
```

`@repo/ui` extends `web-library.json`; `apps/web` extends `nextjs.json`; `apps/mobile` extends `expo.json`.

## Decisions

- [ADR 0013](../../docs/adr/0013-expo-sdk-56-upgrade.md) — TypeScript 6.0 / React 19.2 alignment for the Expo SDK 56 toolchain.
- [ADR 0008](../../docs/adr/0008-shared-package-boundaries.md) — `library.json` vs `web-library.json` keeps platform-neutral packages from depending on DOM types.

## Adding a package

`pnpm gen package` scaffolds the new package's `tsconfig.json` extending the appropriate preset.
