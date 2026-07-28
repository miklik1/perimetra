# ADR 0139 — A computed string is not a rendered pixel

**Status:** Accepted (2026-07-28).
**Implementation:** Implemented.

Corrects the font-wiring premise recorded in ADR [0138](0138-w16-channel-a-drain.md)
and the scope claim in ADR [0078](0078-brand-typeface-trio.md). Amends the token
comment in `tooling/tailwind-config/theme.css`. Relates to skeleton ADR
[1036](1036-one-font-chain-entered-through-the-token.md), whose body this repo
drained in W16.

## Context

ADR 0138 recorded, and the project hub repeated, that the ADR 0078 brand trio
had "been inert in the browser since it shipped" — that every surface had been
rendering the OS system font for three months, and that repairing it would
re-render the whole product. That claim was wrong, and it was wrong in a way
worth writing down, because the measurement that produced it looked rigorous.

The scoping defect it described is real. Tailwind v4's `@theme` emits the role
tokens at `:root`. A `var()` inside a custom-property declaration is substituted
on the element that **declares** the property — not on the element where the
property is eventually used — so a `--font-synonym` declared on `<body>` is
invisible to a `--font-sans` declared at `:root`. Measured directly:
`getComputedStyle(document.documentElement).getPropertyValue("--font-synonym")`
returned the empty string, while the same read at `<body>` returned
`"synonym", "synonym Fallback"`. Every role token was therefore resolving through
its fallback arm, exactly as ADR 0138 said.

What ADR 0138 got wrong was the conclusion it drew from that. The evidence was a
comparison of `getComputedStyle().fontFamily` **strings** between the two
placements. They do differ — `Synonym, ui-sans-serif, …` against
`synonym, "synonym Fallback", ui-sans-serif, …` — and the difference was read as
the system font winning. A computed-value string is not a rasterised glyph, and
nothing in that comparison measured which face the browser actually selected.

Two facts, neither of them visible in a computed string, cancel the bug for three
of the four roles:

1. **`@font-face` rules are document-global.** Only the custom property was
   scoped to `<body>`. The faces themselves were registered on the document and
   were always available to any selector, at any depth.
2. **CSS font-family names are ASCII case-insensitive**, and `next/font/local`
   does not mint a hashed family — it names each face after its JS variable
   (`synonym`, `chillax`, `amulya`, `geistMono`). The token's literal fallback
   said `"Synonym"`. Those match.

So the fallback arm resolved to the real face. Measured at 64 px on the running
app, rendered width of one string: the body's own chain 1451, an explicit
`"Synonym"` 1451, an explicit `synonym` 1451 — against 1615–1620 for
`system-ui` / `sans-serif` / a deliberately nonexistent family. Chillax (1523)
and Amulya (1502) likewise sat nowhere near the platform stack. Moving the
classes to `<html>` changed the computed string and left the width at 1451. A
headless capture of `/brand-lab` settles it independently: the display face
renders with Chillax's geometric single-storey `g` and open apertures, which no
platform grotesque produces.

**`--font-mono` is the exception, and it is a genuine defect.** Its fallback arm
was the _generic_ `ui-monospace`, not a family name, so there was nothing for the
case-insensitive accident to land on. It resolved to
`ui-monospace, SFMono-Regular, "Liberation Mono", Menlo, monospace` and rendered
at 1001.81; Geist Mono renders at 993. ADR 0078's claim that "`--font-mono` now
actually resolves to Geist Mono (it previously fell through to the Tailwind
default)" was false on the day it was written — the face never rendered, while
`GeistMonoVF.woff` was preloaded on every page. A literal `"Geist Mono"` would
not have saved it either: the space defeats the match against `geistMono`.

## Decision

**Declare the four `next/font` variables on `<html>`, where the tokens that
consume them are declared.** The classes move off `<body>`; the styling classes
(`bg-background text-foreground font-sans antialiased`) stay. This is the wiring
ADR 0078 intended and described; it was simply never true.

**Give `--font-mono` a family-name fallback** (`var(--font-geist-mono, "Geist Mono")`,
with `ui-monospace` retained further down the stack) so it matches its three
siblings in shape. With the variable now in scope the fallback is not the load-
bearing path for web, but leaving one role structurally different from the others
is how the original asymmetry went unnoticed.

**Keep a fallback inside every `var()`.** A `var()` that resolves to nothing
invalidates the whole declaration at computed-value time (skeleton ADR 1036),
which would poison the token for the two consumers that have no `next/font` at
all — `packages/ui/src/styles.css` and `apps/mobile/global.css`.

**Correct the two false statements in the token comment** rather than deleting
them: that custom-property substitution is "lazy" so a `<body>`-scoped variable
is in scope below it (it is not), and that the literal fallbacks serve "mobile
expo-font" (mobile registers no fonts at all — it declares no `expo-font`
dependency, uses none of the four role utilities, and its CSS export is a
zero-byte file).

**Pin it with a test that reads the resolved chain and measures what it
rasterises** — `apps/web/e2e/font-wiring.spec.ts`, on `/login` so the hermetic
suite can carry it. It asserts each `--font-*` variable is readable at `:root`,
then compares the rendered width of each token's resolved chain against its
intended face and against the platform generic. It never looks at a class name,
because a class-name assertion is precisely what stays green through this bug:
the classes were present the entire time, on the wrong element.

## Consequences

- **No visual change for sans, display or data.** The `<html>` move is a
  rendering no-op for those three; it makes the variable load-bearing as
  designed, and pulls `next/font`'s metric-adjusted `Fallback` faces into the
  swap path, which is a CLS improvement rather than a steady-state one. The
  re-render ADR 0138 warned about does not happen, and the existing `/brand-lab`
  and `.verify/*` corpora remain valid — they were always captured on the real
  faces.
- **Geist Mono now renders**, at 24 source call sites. The visible ones are the
  release editor's `ExprField` and JSON islands, `/admin` and `/platform`, the
  TOTP backup-code grid on `/account/security`, and `KeyValueList`. This is the
  slice's only pixel change.
- **Disarm-verified.** Moving the classes back to `<body>` reds exactly two of
  the five assertions — the `:root` scope pin and `--font-mono` — and leaves the
  other three green. That asymmetry is the correct result, not a weak test: it
  encodes which roles genuinely depend on the wiring and which were only ever
  rescued by the case-insensitive match.
- **The general lesson, which is not about fonts.** When a CSS custom property is
  defined in terms of another custom property, the inner `var()` is resolved in
  the scope of the **declaring** element. Any framework that injects variables at
  one level while a token layer consumes them at a higher level has this bug
  available. And when checking whether a style change landed, a computed-value
  string is not evidence — measure the rendered result. Pushed to the vault
  Engineering findings for the fleet, because the same `@theme`-at-`:root` +
  `next/font`-on-`<body>` pattern exists in `fullstack-skeleton`, where the
  accidental rescue may equally be masking it.
- **Left open, found while measuring and deliberately not smuggled in:**
  `tabular-nums` is a no-op on Synonym and Chillax (neither ships a `tnum`
  feature; only Amulya does), so numeric-alignment sites carrying `tabular-nums`
  without `font-data` on the same element or an ancestor are not aligning. That
  is a typography-taste question about which face owns numerals, not a wiring
  defect, and it belongs with the `/brand-lab` pass.

## Sources

- Measured on the running app (`WEB_PORT=3002`), Chromium via Playwright: root-vs-body
  custom-property reads, rendered-width comparison per face, `document.fonts` inventory.
- `apps/web/scripts/verify/capture-typography.mjs` — the capture + resolved-chain
  probe used for the eyes-on confirmation.
- `next/font/local` family naming: `next/dist/compiled/@next/font/dist/local/loader.js`,
  which emits `font-family: <jsVariableName>` when no custom family is supplied.
- CSS Values 4 §on custom-property substitution; CSS Fonts 4 §font family name matching.
