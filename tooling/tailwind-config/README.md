# @repo/tailwind-config

The single shared Tailwind v4 `@theme` token file (OKLCH semantic tokens + a dark variant) imported by both platforms (ADR 0004).

## Exports

- `@repo/tailwind-config/theme` — `theme.css`: the `@theme` block of OKLCH semantic color tokens (`--color-background`, `--color-primary`, `--color-muted-foreground`, …) plus dark-variant overrides. shadcn / react-native-reusables naming for ecosystem compatibility.

## Usage

`@import` it from each app's CSS entry (mirrors `apps/web/app/globals.css` and `apps/mobile/global.css`):

```css
@import "@repo/tailwind-config/theme";
```

Use semantic tokens only in components (`bg-background`, `text-muted-foreground`) — never the raw palette. Web consumes it via Tailwind v4; mobile via NativeWind v5.

## Decisions

- [ADR 0004](../../docs/adr/0004-theming-token-system.md) — one shared Tailwind v4 `@theme` token file (OKLCH) for both platforms.
- [ADR 0001](../../docs/adr/0001-styling-split-ui-tailwind-v4.md) — web Tailwind v4 + mobile NativeWind v5 over the shared `@theme`.
- [ADR 0006](../../docs/adr/0006-split-ui-web-dom-mobile-rn.md) — tokens are shared even though rendered UI is not.
