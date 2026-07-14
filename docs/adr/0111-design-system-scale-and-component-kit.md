# ADR 0111 — Design-system scale extension + component-kit expansion

**Status:** Accepted (2026-07-14 — Martin asked to "drastically improve, extend,
fine-tune" the design system as a whole, built on the Vercel composition patterns).
**Implementation:** Implemented (token scale + primitive tune-up + ~12 new compound
components + the `/brand-lab` eyes-on gallery). Extends ADR 0072 (the brand system)
and ADR 0078 (the typeface trio); does not supersede them.

## Context

ADR 0072 landed the Bombardier-derived brand **foundation** and applied it
configurator-first, explicitly deferring the full system. Two years of surface work
later, three gaps had accumulated:

1. **The token scale was minimal.** One radius (`--radius`), two shadows
   (`soft`/`soft-lg`), and a single editorial type token (`--text-display`). No
   motion, no status colours, no radius/elevation/type ladders — so components
   hard-coded `rounded-2xl` / `rounded-md`, and there was no systematic
   soft-geometry grammar.

2. **The kit was half-migrated.** The ADR 0072 primitives (`Panel`, `StepNav`,
   `IconButton`, `Badge`, `DisplayLabel`) were on-brand, but the older `Button`
   default, `Toast`, and the form-field inputs were still stamped-skeleton shadcn:
   hard borders, `shadow-lg`, `rounded-md`, and — most visibly — the leftover
   shadcn **blue** `--color-primary` / `--color-ring` rendering off-brand across
   ~35 button consumers and every focus ring. `Toast`'s four status variants were
   pixel-identical (all `border-border bg-background`) because no status tokens
   existed.

3. **The component vocabulary was thin** relative to the reference: no icon+label
   segmented nav, no hero metric card, no dialog/sheet/tabs/tooltip/popover, no
   branded form controls beyond a render-prop field shell.

The reference (Dribbble "Bombardier — Seamless Plane Configurator", RonDesignLab)
remains the mood/structure north star. The copper-single-accent, flat-matte
(no-glass), warm-grey-field decisions from ADR 0072 are **settled and kept** — this
is _extend + tune_, not a re-brand.

## Decision

**1 — Extend the shared `@theme` token file into a full system** (`tooling/
tailwind-config/theme.css`, still the one OKLCH source, ADR 0004), with dark parity:

- **Radius** — semantic soft-geometry scale (`--radius-inset/control/card/card-lg`
  → `rounded-*` utilities), deliberately named so it never clobbers Tailwind's
  numeric `rounded-lg` scale.
- **Elevation** — a `--shadow-soft-sm` (pill) and `--shadow-float` (dialog/popover/
  floating panel) added to the existing soft/soft-lg ladder.
- **Type** — `--text-title` (32) and `--text-metric` (40) added below the display
  token, tokenising the reference hierarchy.
- **Motion** — one brand ease (`--ease-brand`, a calm ease-out) for the "Seamless"
  feel; durations stay Tailwind literals at the call site.
- **Status** — `--color-success/warning/info` (+ `-foreground` + `-subtle`), calm
  and muted. **`warning` is a separate token from `--color-deviation`**: deviation
  is the CORE*SPEC §6 \_domain* signal (always amber + an extra cue), warning is the
  generic UI-status tone — kept apart so the §6 plane can never alias a routine
  warning (the same "separate planes" discipline ADR 0072 applied to copper vs
  amber).
- **Spotlight** — `--color-spotlight` (steel-blue `#96ADC2`, the reference's
  summary-card fill): a _second_ calm accent, scoped to hero/metric cards
  (`StatCard`) so it never competes with copper for CTA duty.
- **Retire the blue** — `--color-primary` → brand ink (`#1A1A1A`, the Bombardier
  active-pill grammar; copper stays the opt-in accent CTA, never the default);
  `--color-ring` → copper. This de-blues every default button and focus ring
  app-wide — desired, and the reason it lives in the token layer, not per component.

**2 — Bring the half-migrated primitives onto one grammar** (public APIs preserved
so the ~35 button + 8 form consumers do not break): `Button` (ink default, brand
ease, `rounded-control`, opt-in `pill` shape), `Toast` (flat-matte chrome +
`shadow-float`, one distinct status rail per severity), the field input classes
(recessed-chrome, hairline inset ring, copper focus ring, no hard border), `Panel`
(`rounded-card`), `Badge` (gains success/warning/info tones), plus the brand ease on
`StepNav`/`IconButton`.

**3 — Expand the kit with compound components built on the Vercel composition
patterns** (compound + `React.use()` context, explicit variants over boolean modes,
children over render-props, no `forwardRef`, `data-slot` convention, `radix-ui` for
behaviour, no new deps): `SegmentedNav`, `StatCard`, `Field` (+ `Input`/`Textarea`,
the compound successor to the render-prop `FieldShell`), `Select`, `Switch`/
`Checkbox`, `Tooltip`, `Popover`, `Pager`, `Tabs`, `Dialog`/`Sheet`, `Skeleton`/
`Spinner`/`Separator`, and `EmptyState`.

**4 — Eyes-on verification** — a dev-only `/brand-lab` gallery route (hard-404 in
production, the `/scene-lab`·`/drawing-lab` pattern) renders every token and
primitive in both variants; `scripts/verify/capture-brand.mjs` screenshots it
headless so the render is _seen_, not just type-checked (the standing "never call a
render correct without eyes on it" rule, applied to the 2D kit).

## Consequences

- **Still one token source of truth.** The whole brand shifts from `theme.css`; the
  new components consume only semantic tokens.
- **App-wide de-blue** is a one-token change with wide reach: every previously-blue
  default button and focus ring becomes ink/copper. No surface layout was reskinned
  in this ADR — that adoption sweep (configurator polish, the under-branded site
  canvas, the global `bg-field` body) remains the ADR 0072 follow-on.
- `FieldShell` (render-prop) stays for its existing consumers; `Field` is the
  compound successor for new work — no forced migration.
- The `.design-sync` converter's `componentSrcMap` and `previews/` gain the new
  primitives (the `.ds-css/theme.css` + compiled closure must be regenerated before
  the next design-system sync — it goes stale silently).
- Design taste (exact copper against a lit render, motion timing) remains a render
  pass owed to Martin — the `/brand-lab` captures are the artifact for it.

Related: ADR 0072 (the brand system this extends), ADR 0078 (the typeface trio),
ADR 0004 (the shared token file), ADR 0073/0102 (the `/scene-lab`·`/drawing-lab`
headless-capture verification pattern this mirrors); vault
`2026-06-23 Brand design extraction — Bombardier`.
