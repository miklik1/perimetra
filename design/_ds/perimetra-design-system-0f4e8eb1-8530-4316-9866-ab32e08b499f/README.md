# Perimetra — build conventions (read before styling anything)

**No provider/wrapper is required for most components** — they render bare (no theme/router/i18n
context). Fonts and tokens load through `styles.css`'s import closure — never link CSS manually. The
**one exception**: `Tooltip` must be wrapped in `<TooltipProvider>` (once, near the app root) — its
trigger/content throw without it. `Dialog`, `Sheet`, `Popover`, `Select`, `Tabs` need no provider.

## The styling idiom: Tailwind utilities over SEMANTIC tokens only

Never raw palette values, never hex, never arbitrary `[oklch(...)]`. The system is near-monochrome:
a warm-grey field, flat matte-white chrome lifted by **soft shadows (never glass/blur)**, ONE copper
accent, one steel-blue spotlight, and a separate deviation-amber plane. The default action is **ink**
(`bg-primary`), not blue and not copper — copper is the sparingly-used accent CTA. Vocabulary (all real,
from the shipped theme):

| Family            | Utilities                                                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surfaces          | `bg-background` `bg-card` `bg-popover` `bg-field` (paper canvas) `bg-field-raised` `bg-chrome` (matte white card) `bg-chrome-subtle` (recessed inputs/fills)                                   |
| Text              | `text-foreground` `text-muted-foreground` `text-card-foreground` `text-chrome-foreground` `text-destructive`                                                                                  |
| Default action    | `bg-primary text-primary-foreground` — near-black **ink**, the default button/action (`Button` default variant). Not blue.                                                                    |
| Brand accent      | `bg-copper text-copper-foreground hover:bg-copper-hover` — **the one chromatic accent; CTAs only, once or twice per screen** (or `Button variant="copper"`)                                    |
| Spotlight         | `bg-spotlight text-spotlight-foreground` (`bg-spotlight-subtle`) — steel-blue, **hero/metric cards ONLY** (`StatCard`); a second calm accent, never a CTA                                     |
| Deviation signal  | `bg-deviation text-deviation-foreground` — §6 deviation plane ONLY; never a second decorative accent, never aliased with copper                                                               |
| Status            | `bg-success` `bg-warning` `bg-info` (+ `-subtle` tint bg, + `text-success/warning/info`) — calm UI status. `warning` is a SEPARATE plane from the amber `deviation` signal                     |
| Nav               | `bg-nav-active text-nav-active-foreground` — the active step/segmented pill                                                                                                                   |
| Borders/focus     | `border-border` `border-input` `border-destructive`; prefer a hairline `ring-1 ring-inset ring-border/60` over a hard border; focus is the copper `ring-ring` (`focus-visible:ring-2`)         |
| Elevation         | `shadow-soft-sm` (pills/toggles) `shadow-soft` (cards) `shadow-soft-lg` (raised) `shadow-float` (dialogs/popovers/floating) — the only depth cues, never glass                                |
| Radius            | `rounded-inset` (8, chips) `rounded-control` (12, buttons/inputs) `rounded-card` (20, cards/panels) `rounded-card-lg` (24, hero) `rounded-full` (pills/circles). Do NOT use `rounded-md/lg/xl`. |
| Motion            | `ease-brand` + `duration-200` on transitions — the calm "Seamless" easing                                                                                                                    |
| Type roles        | `font-sans` = Synonym (body/UI, the default) · `font-display` = Chillax (headings/step labels) · `font-data` = Amulya (dimensions/prices/numeric emphasis) · `font-mono` = Geist Mono (codes) |
| Type scale        | `text-display` (enormous light step label) · `text-title` (32, panel/section title) · `text-metric` (40, big numerals — `StatCard`)                                                            |

Dark mode: `.dark` on an ancestor flips every token (`@custom-variant dark`); don't hand-write dark colors.

## Content rules

Czech-first (`cs`) product copy. Dimensions as `3 600 × 1 800 mm` (thin-space thousands, W × H, mm).
Prices as `48 250 Kč bez DPH`, always in `font-data tabular-nums`. Codes like `AL-PRF-40` in mono.
No emoji in product UI. Workshop-facing surfaces never show prices.

## Where the truth lives

- `styles.css` → imports `fonts/fonts.css` (the four brand faces) + `_ds_bundle.css` (all token
  custom properties + compiled component utilities). Read these before inventing anything.
- Per component: `components/<group>/<Name>/<Name>.d.ts` is the props contract;
  `<Name>.prompt.md` shows composition. Compound components (`Field`, `Select`, `Tabs`, `Dialog`,
  `StatCard`, `EmptyState`, `SegmentedNav`) compose named sub-parts — see their `.prompt.md`.

## Idiomatic build snippet

```tsx
import { Button, StatCard } from "@repo/ui";

<div className="bg-chrome shadow-soft rounded-card p-6" style={{ maxWidth: 380 }}>
  <p className="font-display text-title">Brána posuvná</p>
  <p className="text-muted-foreground text-sm">3 600 × 1 800 mm · RAL 7016</p>
  <p className="font-data text-lg tabular-nums">48 250 Kč bez DPH</p>
  <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
    <Button variant="copper">Vytvořit nabídku</Button>
    <Button variant="ghost">Zrušit</Button>
  </div>
</div>;
```

# PerimetraUI (@repo/ui@0.0.0)

This design system is the published @repo/ui React library, bundled as a single
browser global. All 35 components are the real upstream code.

## Where things are

- `_ds_bundle.js` — the whole-DS bundle at the project root; loads every component to `window.PerimetraUI`. First line is a `/* @ds-bundle: … */` metadata header.
- `styles.css` — the single stylesheet entry: it `@import`s the tokens, fonts, and component styles (`_ds_bundle.css`). Link this one file.
- `components/<group>/<Name>/<Name>.prompt.md` (example JSX + variants), `<Name>.d.ts` (types), `<Name>.html` (variant grid).
- `tokens/*.css` — CSS custom properties, names verbatim from upstream.
- `fonts/` — `@font-face` files + `fonts.css` (when the package ships fonts).

For a specific component, `read_file("components/<group>/<Name>/<Name>.prompt.md")`.

## Loading

Add these two lines to your page once (React must be on the page first):

```html
<link rel="stylesheet" href="styles.css">
<script src="_ds_bundle.js"></script>
```

Components are then available at `window.PerimetraUI.*`. Mount into a dedicated child node (e.g. `<div id="ds-root">`), not the host page's own React root, so the two trees don't collide:

```jsx
const { ArrayField } = window.PerimetraUI;
ReactDOM.createRoot(document.getElementById('ds-root')).render(<ArrayField />);
```

## Tokens

197 CSS custom properties from @repo/ui. Names are
preserved verbatim from upstream. They are declared inside `_ds_bundle.css` (this DS ships one compiled stylesheet rather than separate token files).

- **color** (101): `--color-red-500`, `--color-amber-400`, `--color-amber-500`, …
- **spacing** (6): `--radius-inset`, `--tw-space-y-reverse`, `--tw-ring-inset`, …
- **typography** (16): `--font-sans`, `--font-mono`, `--font-weight-light`, …
- **radius** (8): `--radius-md`, `--radius-lg`, `--radius-xl`, …
- **shadow** (11): `--shadow-soft`, `--shadow-soft-lg`, `--shadow-soft-sm`, …
- **other** (55): `--spacing`, `--container-xs`, `--container-sm`, …

## Components

### forms
- `ArrayField`
- `DisclosureSection`
- `EnumSelect`
- `FieldShell`

### general
- `Badge`
- `Button`
- `Checkbox`
- `DefectList`
- `Dialog`
- `DisplayLabel`
- `EmptyState`
- `Field`
- `FieldError`
- `IconButton`
- `IconCluster`
- `Input`
- `NavTree`
- `Pager`
- `Panel`
- `Popover`
- `SegmentedNav`
- `SegmentedNavItem`
- `Select`
- `Separator`
- `Sheet`
- `Skeleton`
- `Spinner`
- `StatCard`
- `StepNav`
- `Switch`
- `Tabs`
- `Textarea`
- `Toast`
- `ToastViewport`
- `Tooltip`
