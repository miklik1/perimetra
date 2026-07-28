# ADR 1036 — One font chain, entered through the token; the face variable lives on `<html>`

**Status:** Accepted (2026-07-27). Amends [ADR 0004](0004-theming-token-system.md),
which documented the shared `@theme` as colours + radius only — typography now
lives there too; the amendment note is appended to that ADR rather than rewritten
into it. Extends [ADR 0001](0001-styling-split-ui-tailwind-v4.md) (the shared
token file is imported by three surfaces, two of which have no `next/font`).
Names [ADR 0025](0025-web-e2e-playwright-shared-vitest-config.md) as the home of
the browser-level assertion this change does _not_ add.

**Provenance.** Ported from `mercata` ADR 0142 (commit `2dc3f54`), which found the
mechanism by reading computed styles out of Chromium against its running app. The
mechanism is identical here. **The framing is not, and the difference matters:**
mercata's token layer went inert when its own `--font-app` was introduced, so the
defect was traceable to one prior change. This skeleton had no font tokens at all,
and the natural conclusion — "there is nothing to be inert, this is a latent trap
we are pre-empting" — is **wrong**. It is measured wrong below.

## Context

On `main`, the font wiring was three files:

- `tooling/tailwind-config/theme.css` — an `@theme` block of OKLCH colours plus
  `--radius`. No typography token of any kind.
- `apps/web/app/layout.tsx` — two `next/font/local` faces (Geist Sans, Geist
  Mono), both `.variable` classes on `<body>`.
- `apps/web/app/globals.css` — one rule naming the next/font variable directly:
  `body { font-family: var(--font-geist-sans), Arial, Helvetica, sans-serif; }`.

### The mechanism

A CSS custom property's `var()`s are substituted **on the element where the
property is declared**, and only the _result_ inherits; the value is never
re-substituted further down the tree. Tailwind v4's `@theme` compiles to `:root`
— that is, `<html>`. `next/font`'s `.variable` class emits the face variable on
whichever element carries the class, and here that was `<body>`, one level too
low. Any `@theme` token reading `--font-geist-sans` therefore resolves it at
`:root`, where it is undefined, and bakes its fallback in permanently.

The failure mode is **"a different typeface"**. No tofu, no console warning, no
failed network request, no layout break. Nothing in types, lint, unit tests or a
screenshot review can see it: a screenshot of the system UI font still looks like
a font. Each of the three files reads as correct on its own — the defect exists
only in the _relationship_ between where a variable is defined and where the token
that reads it is declared.

### This was not latent. The split already shipped, and here is the measurement

Tailwind v4.3.0 **declares `--font-sans` at `:root` itself**, so the token layer
did not need a token of ours to be affected. Compiling the web app's entry
stylesheet through `@tailwindcss/postcss` 4.3.0 against the **unmodified** tree
(candidates `font-sans`, `font-mono`) emits:

```text
@layer theme {
  :root, :host {
    --font-sans: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji",
      "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ...;
    --default-font-family: var(--font-sans);
  }
}
@layer base {
  html, :host {
    font-family: var(--default-font-family, ui-sans-serif, system-ui, sans-serif, ...);
  }
}
@layer utilities {
  .font-sans { font-family: var(--font-sans); }
}
```

So on `main`: `<html>` and every `font-sans` utility computed to the **OS system
stack**, while `<body>` alone rendered Geist — reached by exactly one route, the
`globals.css` rule naming `--font-geist-sans` directly, on the one element where
it happened to be defined. The document carried **two font chains that
disagreed**, and anything carrying a font utility took the losing one.

This ADR therefore **resolves an existing split**; it does not pre-empt a future
one. That distinction changes the consequence section: this is a visible typeface
change on every surface that uses a font utility, not a no-op hardening.

## Decision

### 1. Typography joins the shared `@theme`, as two tokens

```css
--font-app: var(--font-geist-sans, ui-sans-serif);
--font-sans:
  var(--font-app), ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji",
  "Segoe UI Symbol", "Noto Color Emoji";
```

`--font-app` is the app face — the single swap point. `--font-sans` is
**Tailwind 4.3.0's own default sans value verbatim, with `var(--font-app),`
prepended**. Prepending rather than re-authoring the chain is deliberate:
mercata's chain ends `… "Helvetica Neue", Arial, sans-serif` and drops
`"Apple Color Emoji"`, `"Segoe UI Emoji"`, `"Segoe UI Symbol"` and
`"Noto Color Emoji"`. Copying it verbatim would have regressed emoji rendering to
whatever the first matching family happens to cover — a silent downgrade traded
for nothing. When Tailwind's default stack changes, re-derive; do not hand-write.

**The `, ui-sans-serif` fallback inside `--font-app` is load-bearing.** Three
entry points import this file: `apps/web/app/globals.css`,
`packages/ui/src/styles.css` and `apps/mobile/global.css` (NativeWind). Only the
first has a `next/font` integration, so on the other two `--font-geist-sans` does
not exist at all — and a `var()` with no fallback that resolves to nothing makes
the whole declaration **invalid at computed-value time**, which would poison
`--font-sans` with it, since `--font-sans` reads `--font-app`. The fallback is
what makes the degradation work. It is commented as such in the token file.

**The placement contract is stated in the token file**, not only here: these
tokens are declared at `:root`, therefore a consuming app **must** define the face
variable on `<html>`. A consumer that defines it one element too low silently
re-creates the inert layer, and gets no error to tell it so.

**No `--font-display` and no `--font-mono`.** Neither skeleton has tenant font
pairing, so a display token would ship an unused utility; and a `--font-mono`
token would only shadow Tailwind's own mono stack, which nothing here needs
(see 3).

### 2. The face variable moves to `<html>`, and the document enters the chain once

`geistSans.variable` goes on `<html>` in `layout.tsx`, and `globals.css` becomes:

```css
body {
  font-family: var(--font-sans);
}
```

— the token layer's leaf, never a face and never a framework variable. Naming one
directly in a document rule is precisely what forked the chain into two
disagreeing halves; the rule carries a comment saying so.

### 3. Geist Mono is dropped — the `localFont` call and the vendored file

It was preloaded on **every** page with zero consumers. From a production build of
the unmodified tree, `apps/web/.next/server/next-font-manifest.json`:

```text
"[project]/apps/web/app/page": [
  "static/media/GeistVF-s.p.0e569l9b0bre8.woff",
  "static/media/GeistMonoVF-s.p.1lv5tp2fpjxdz.woff"
]
```

— the same pair on all four routes. A repo-wide grep for `font-mono`,
`--font-mono`, `geist-mono`, `<code`, `<pre`, `<kbd` and `<samp` returns exactly
one hit: the `variable: "--font-geist-mono"` declaration itself. 67,864 bytes
preloaded per page to render nothing.

Removing it is **visually inert**, because Tailwind's preflight already styles
those elements from its own stack:

```text
code, kbd, samp, pre {
  font-family: var(--default-mono-font-family, ui-monospace, SFMono-Regular, Menlo, ...);
}
```

That is what `code`/`pre` rendered before this change and what they render after.
Wiring the face instead would have meant vendoring bytes for a typeface nothing
renders — the opposite trade. **Recovering it later means restoring
`apps/web/app/fonts/GeistMonoVF.woff` _and_ adding a `--font-mono` token, in one
change**; either half alone is a no-op, and the `localFont` half alone reproduces
exactly the preload-with-no-consumer state this removes.

### 4. The invariant is pinned at its cause, and the test states what it cannot prove

`apps/web/app/font-wiring.test.ts` is a **source / class-contract test**, shaped
like the existing `apps/web/next-config-wiring.test.ts`: a `// @vitest-environment
node` docblock (the app's default environment is jsdom) and `readFileSync` over
`import.meta.url`. It asserts the `.variable` class is on `<html>` and not on
`<body>`; that the body rule enters through `var(--font-sans)` and names no
`--font-geist*` variable; that `--font-app` keeps its bare-value fallback; that
`--font-sans` derives from `--font-app` and keeps the emoji tail; that no CDN host
appears in any of the three files; and that mono stays dropped.

It **strips block comments before matching**. Every file in this chain documents
the rule it implements, in prose that quotes the rule nearly verbatim — without
stripping, the explanation satisfies the assertion that exists to check the
explanation is still true. Verified: with the stripper replaced by the identity
function, the mono guard fails on correct source purely because the prose names
`GeistMonoVF.woff`.

**What it cannot prove, stated in its own header:** neither jsdom nor node can see
a computed font. jsdom loads no `@font-face` resources and performs no
custom-property substitution over Tailwind's compiled stylesheet, which is not
even generated in a unit run. The test therefore pins the invariant at its
**cause** — which element carries the variable — while the only proof of the
**effect** is reading computed styles out of a real browser against both
`next dev` and a production build. That assertion belongs in the Playwright suite
(ADR 0025), and is not added here.

## Consequences

- **Typography changes visibly on any surface using a font utility.** Before, a
  `font-sans` utility rendered the operator's OS UI font while `<body>` rendered
  Geist; now both render Geist. The skeleton's own pages carry no font utilities
  today, so its screenshots are unchanged — but a repo stamped from it that adds
  one gets the vendored face instead of a silent system-font fallback.
- **Verified after the change**, by recompiling the same entry stylesheet:
  `:root` now carries `--font-app: var(--font-geist-sans, ui-sans-serif)` and
  `--font-sans: var(--font-app), ui-sans-serif, …, "Noto Color Emoji"`, with
  `.font-sans { font-family: var(--font-sans) }` and preflight's `html` rule both
  reading the same token. With `.variable` on `<html>`, all three resolve to the
  vendored face.
- **Per-page preload drops by 67,864 bytes** with no visual change, since the
  removed face was never rendering.
- **`packages/ui` and `apps/mobile` are unaffected by design.** Both import the
  same token file and neither defines `--font-geist-sans`, so `--font-app` falls
  back to `ui-sans-serif` there exactly as before. Neither surface generates a
  `font-sans` utility today, so the new declarations are inert on them — which is
  the whole reason the fallback must stay.
- **What a repo drained from this skeleton must do.** Swapping the app face is a
  two-file change made together: the `next/font` call in `layout.tsx` (name and
  file) and the inner variable name inside `--font-app`. Three things must not be
  disturbed while doing it: the `.variable` class stays on `<html>`, the
  bare-value fallback stays inside `--font-app`, and no document rule ever names a
  face or a framework variable — it enters through `var(--font-sans)`. A repo that
  adds a tenant font pairing adds `--font-display` then, deriving it from
  `--font-app`; a repo that renders code adds `--font-mono` then, and only then.
- **ADR 0004's colours-only framing is superseded on this point** and carries an
  appended amendment note pointing here. Its stale claim that wiring into the
  apps' CSS entry points "lands in migration item 3" is corrected in the token
  file's header — all three entry points have been wired for some time.

## Sources

- `mercata` ADR 0142 `0142-satoshi-self-host-and-the-inert-font-token.md`,
  commit `2dc3f54` (2026-07-24) — the browser-measured original.
- CSS Custom Properties for Cascading Variables Level 1, §3
  (substitution occurs at computed-value time on the declaring element).
- `tailwindcss@4.3.0` `theme.css` (the `--font-sans` default and
  `--default-font-family`) and `preflight.css` (the `html` and
  `code, kbd, samp, pre` rules).
