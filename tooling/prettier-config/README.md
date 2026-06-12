# @repo/prettier-config

Shared Prettier config: the repo's base formatting rules plus import sorting and Tailwind class sorting (t3-turbo pattern).

## Exports

- `@repo/prettier-config` (default export) — the `prettier.Config`: `semi`, double quotes, 2-space tabs, `trailingComma: "all"`, `printWidth: 100`, plus `@ianvs/prettier-plugin-sort-imports` (with a `<repo>` import group for `@repo/*`) and `prettier-plugin-tailwindcss` (listed last so it runs after every other transform).

## Usage

Reference it from a package/app `prettier.config.js` (or the `"prettier"` field in `package.json`):

```js
export { default } from "@repo/prettier-config";
```

Note: `prettier-plugin-tailwindcss` v4 wants a per-app `tailwindStylesheet` option pointing at each app's CSS entry to sort against the `@theme` tokens — add it as a per-app override.

## Decisions

- [ADR 0001](../../docs/adr/0001-styling-split-ui-tailwind-v4.md) — Tailwind v4 + the shared `@theme` token file the class sorter orders against.
- [ADR 0004](../../docs/adr/0004-theming-token-system.md) — the shared OKLCH `@theme` tokens the Tailwind plugin sorts.
