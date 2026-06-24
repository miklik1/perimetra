# ADR 0072 — Perimetra brand design system (the Bombardier-derived editorial foundation)

**Status:** Accepted (2026-06-24 — the HQ brand/UI build order; Martin decided
the design direction). **Shipped** (Slice A of the v1 configurator brand + live-3D
workstream; ADR 0073–0077 are the 3D techniques built on this foundation).

## Context

Martin chose the Bombardier "Seamless Plane Configurator" as the **whole**
Perimetra brand language — premium editorial minimalism, confidence through
restraint (vault note `2026-06-23 Brand design extraction`, Martin's seven decided
answers). The visual system: a near-monochrome **warm-grey field**, **flat-matte
white chrome** lifted by soft shadows (explicitly **no glassmorphism**), **one**
chromatic accent (**industrial copper `#B87333`**), editorial display-scale type,
and soft-geometry controls (pills, circular icon clusters).

Two constraints shape how this lands:

1. The repo already has the right machinery — Tailwind v4 with a single shared
   OKLCH `@theme` token file (`tooling/tailwind-config/theme.css`, ADR 0004, web +
   mobile) and a CVA component kit (`packages/ui`, **no shadcn in new work**). A
   "clean, DRY, scalable, unifiable" brand system means **extending that one
   system**, never forking a parallel one (CSS modules / styled-components / a
   second token source are all rejected).
2. The full-app reskin (editor/admin/quotes) is a **follow-on**. This slice lands
   the **canonical token + primitive foundation** and applies it **configurator-
   first**, so the design system is proven on the hero surface without a risky
   big-bang restyle of every surface at once.

## Decision

**Additive, role-named brand tokens in the shared `@theme` file** (OKLCH — exact
conversions of the decided hexes, so the file stays uniform):

- `--color-field` (`#EDEDED`) / `--color-field-raised` (`#F0F0F0`) — the paper-like
  canvas the whole surface floats on.
- `--color-chrome` (`#FFF`) / `--color-chrome-subtle` (`#F8F8F8`) +
  `--color-chrome-foreground` — flat-matte card surfaces.
- `--color-copper` (`#B87333`) + `-hover` (`#A8662C`) + `-foreground` — the single
  UI accent.
- `--color-deviation` (`#F59E0B`, amber) + `-foreground` — the CORE_SPEC §6 signal,
  kept on its **own token**, never the copper one, so the two warm tones can never
  alias (Direction #2's "separate planes" rule lives in the token layer, not in
  component heads). The §6 signal is always amber + an extra cue (emissive / marker
  / badge), never hue-alone — enforced by keeping it a distinct token.
- `--color-nav-active` (`#1A1A1A`) + `-foreground` — the active step pill.
- `--shadow-soft` / `--shadow-soft-lg` (rgba 0.06–0.10) — the only depth cue over
  flat chrome (NOT glass — Direction #1).
- `--text-display` (6rem, light, tight tracking) — the editorial step-label scale.

Dark-variant overrides keep every token valid app-wide (field/chrome/nav flip;
copper/deviation are hue-stable); the configurator pins light.

**New CVA kit primitives in `packages/ui`** (semantic-token-only, `data-slot`
convention, same pattern as `Button`): `Panel` (flat-matte soft-shadow chrome),
`StepNav` (centered pill step-bar, near-black active, sequential-forward/free-back),
`Badge` (neutral/copper/**deviation**/outline tones), `DisplayLabel` (responsive
display scale), `IconButton` + `IconCluster` (the circular viewport control
vocabulary), and a `copper` / `copper-outline` `Button` variant. `cn`'s
`tailwind-merge` (v3) already dedupes the custom token suffixes (`bg-copper`,
`shadow-soft`, `text-display` — verified empirically), so **no merge-config change
was needed** — the system stays clean as-is.

**Applied configurator-first**: warm-grey field background, `Panel` chrome on the
wizard/results, `StepNav` pills, copper "Další" CTA, recessed inputs. **No
structural or flow change** — the generated `UiSpec` wizard is untouched; the
premium hero layout, the giant `DisplayLabel`, and the 5-step CZ flow land with the
Part-B slice (ADR 0077).

## Consequences

- **One token source of truth** (`theme.css`, web + mobile). The brand foundation
  is now canonical; editor/admin/quotes adopt it in the follow-on reskin sweep by
  swapping to the same tokens/primitives — no new mechanism.
- `DisplayLabel` / `IconButton` / `IconCluster` ship now but are consumed by the
  later v1 slices (the viewport controls in D/E, the hero label in F); they are
  public kit exports (entry-export, so `knip` is clean).
- **Render-time taste pass owed to Martin** (not a build blocker): the exact copper
  shade against a _lit 3D render_ (and the copper-vs-amber side-by-side) is
  calibrated once the studio-lighting slice (ADR 0074) produces a render — the
  token makes that a one-line change.

Related: vault `2026-06-23 Brand design extraction — Bombardier`; CORE_SPEC §6
(deviation signal); ADR 0004 (the shared token file); ADR 0051/0052 (the
configurator/site surfaces reskinned here); ADR 0073–0077 (the live-3D quartet +
camera built on this foundation).
