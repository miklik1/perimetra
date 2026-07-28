# ADR 0134 — The kit accessibility + composition sweep: five defects that were filed as taste

**Status:** Accepted (2026-07-28 — Phase A, alongside the PER-SEC sweep). Amends the kit shipped by
[ADR 0111](0111-design-system-scale-and-component-kit.md) (tokens + primitives) and consumed by
[ADR 0117](0117-configurator-immersive-frame-and-direct-manipulation.md) §8.1 (the masked-edge scroll
rule) and [ADR 0118](0118-authenticated-app-shell.md). Supersedes nothing — each change below is a
repair to a primitive's behaviour, not a reversal of a decision.

## Context

Five items sat on the backlog as design-taste calls awaiting Martin's eye. On inspection four of them
are **accessibility or API-semantics defects** — they have a right answer that does not depend on
taste — and the fifth is a missing axis that was blocking a documented rule from being followed. They
are grouped into one ADR because they share a single root: `packages/ui` was stamped from a shadcn
baseline and then re-tokenised for the Perimetra design language, and the sweep only ever touched
**colour**. Behaviour, ARIA and component API inherited from the baseline were never re-examined
against the export.

The design export is not silent-but-authoritative here. **It draws no focus state anywhere** and it
draws no spinner, so on those two questions there was nothing to defer to — the divergence was a
leftover, not a deferred decision. That distinction is what moved these off Martin's list.

## Decision

### 1 — One focus grammar: `ring-2 ring-ring`

`Button` was the only control in the kit still speaking the shadcn focus vocabulary: a 3px
half-opacity ring plus a competing `border-ring`, with per-variant red tints on `destructive`. Every
other control — `IconButton`, `Select`, `Switch`, `Checkbox`, `Tabs`, `Pager`, `SegmentedNav`,
`StepNav`, `StatCard`, `Alert`, and `fieldInputClass` — already used `focus-visible:ring-2
focus-visible:ring-ring`. Two focus vocabularies on one screen read as two control families.

Button now speaks the kit's grammar: one width, one token, full opacity, both themes. The
`destructive` variant loses its red focus tint — **a red focus ring on a red button is decoration,
not meaning**; the destructive semantics are already carried by the fill.

Fixing this surfaced a **live bug in the same string**. The `aria-invalid` classes set ring _colour_
only (`ring-destructive/20`, `dark:…/40`) and borrowed their _width_ from `ring-[3px]`, which is a
focus-visible utility — so an invalid button showed its red ring **only while focused**, and would
have gone fully dead the moment the width source was removed. `aria-invalid` now carries its own
`ring-2` and the solid `ring-destructive`, mirroring `fieldInputClass`, the kit's only other
invalid-state ring.

### 2 — `Spinner` defaults to decorative

`Spinner` hardcoded `role="status"` and a Czech `aria-label="Načítání"`. This produced **zero live
announcements in either consumer** while actively causing harm:

- A live region announces **content changes**. This SVG mounts carrying its label and never mutates,
  so the region had nothing to announce.
- Both consumers already neutralised it by hand. `context-bar.tsx` had to pass
  `role="presentation" aria-hidden aria-label={undefined}` to stop the nested region from announcing
  a second, non-catalog string over the real one.

A primitive whose every consumer must disarm it has the wrong default. `Spinner` is now decorative
(`aria-hidden`) unless the caller gives it a name, in which case it becomes a real `status` region.
The behaviour is **derived from the prop rather than gated on a `decorative` boolean**, so the role
and the name can never contradict each other — the same rule and the same shape as `Icon`.

### 3 — `StepNav` ordinals are derived at render, not measured from the DOM

Each dot's number came from a ref callback that walked up to the rail and asked
`querySelectorAll('[data-slot="step-nav-item"]').indexOf(…)`. That reads the right answer, but only
**once**: the callback identity was stable and the span was never remounted, so React invoked it
exactly once per mount. A step appearing later left every already-mounted dot on its mount-time
number while the new dot computed a fresh, colliding one — **the precise drift the original comment
said the DOM read existed to prevent.** It also painted an empty dot on the server, because a ref
never runs there. Step sets are release-authored and vary per product, so this was reachable, not
theoretical.

Ordinals are now derived in one synchronous render-time pass (`withOrdinals`) and delivered through
`StepOrdinalContext`. Non-item children — text, `null`, a `false` from a short-circuit, a `Heading` —
pass through untouched **and do not advance the counter**, so a `{cond && <StepNav.Item/>}` leaves no
gap and a `Heading` cannot consume the number 1. Being pure render-time work, it is correct under
concurrent rendering and already right in the server HTML.

The cost is a real narrowing, and it is deliberate: **an item must be an immediate child of
`<StepNav>` or of a `<StepNav.List>`.** An item generated inside a caller's own component is invisible
to the walk and renders a blank dot. `StepNav.List` exists for exactly the case that made this bite —
`steps-rail.tsx` puts a `FadeScrollArea` between the rail and its steps, which would hide every step
from the root's walk. It renders a plain container with no layout of its own, because a scroll column
and a chip row want different ones.

### 4 — `SegmentedNav` is a group, not a `<nav>` landmark

The component rendered a `<nav>` landmark and marked the selected pill `aria-current="page"`. Both
are factually wrong for every real use: it is a segmented control that switches a view, not page
navigation. A screen-reader user heard **"Rozpad, current page"** for a control that changes no page,
and the one product consumer (`configurator/scene-column.tsx`) had to re-state the semantics by hand
through spread props.

The root is now a **named `role="group"`** and each segment is a toggle button carrying `aria-pressed`
— always emitted as `true`/`false`, because a toggle with a missing `aria-pressed` reads as a plain
button. The accessible name is **required by the prop type** (a union of `aria-label` /
`aria-labelledby`, keeping the labelledby form first-class): an unnamed group is an axe failure, and
the name is the only thing telling the user what the segments switch between.

Deliberately **not** a `tablist` either. Nothing here wires `tabpanel`s, and `role="tab"` would
additionally owe roving tabindex, arrow-key movement and `aria-controls`. Real tabs are `tabs.tsx`.
Here the native `<button>`s carry their own keyboard operation.

### 5 — `FadeScrollArea` gains a horizontal orientation

ADR 0117 §8.1 codifies the masked-edge fade and **explicitly forbids re-implementing the gradient
locally**. `FadeScrollArea` was vertical-only, so `step-chips.tsx` — a horizontally-scrolling row
whose step count is release-authored and therefore unbounded — shipped with a documented ⚠️ admitting
it scrolled with no edge cue and no way to add one. The rule was unfollowable, not unfollowed.

`orientation` is an explicit `vertical | horizontal` variant on the root (the `sheetVariants.side` /
`Separator.orientation` idiom), **not a `horizontal` boolean**: the two are alternatives, and a
boolean pair could encode "both", which this component cannot be — one scroll container, one axis,
one mask direction. The axis rides the context so it has exactly one writer, which is how a slot and
its root avoid disagreeing about which edge is "end".

The edge vocabulary is therefore **axis-neutral**: `start`/`end`, never `top`/`bottom`. Everything
else — the `--fade-scroll-length` property, the focus ring on the unmasked root, the scrollable-gated
region a11y, the no-active-edge-no-mask rule — is axis-independent and is shared verbatim rather than
duplicated per branch.

## Consequences

- **`StepNav` callers must use `StepNav.List` when a wrapper sits between the rail and its items.**
  This is the one breaking contract in the sweep. It fails visibly (blank dots), not silently, and
  `steps-rail.tsx` is updated.
- `SegmentedNav`'s accessible name is now a **type error** if missing, so the compiler carries the
  rule rather than a review comment.
- `Spinner`'s default flip is safe precisely because both existing consumers already suppressed the
  old behaviour — neither changes meaning, and `context-bar.tsx` sheds three disarming props.
- Only ONE axis is named per `FadeScrollArea` branch. This is load-bearing: a single explicit overflow
  makes CSS promote the untouched axis from `visible` to `auto`, which is what gives
  `panels/bom-table.tsx` its two-axis scroll off the vertical default. Setting both explicitly would
  silently kill that table's sideways scroll.
- **Known limitation, documented rather than solved:** in an RTL writing mode `scrollLeft` runs
  negative or inverted depending on engine, so the horizontal start/end computation would be
  mirrored. The product is `cs`-only, so there is no RTL surface to be wrong on today. A future RTL
  locale must normalise the offset in the component, not at the call sites.
- `packages/ui` is **skeleton-owned**. All five changes are owed upstream to `fullstack-skeleton`;
  until they land, a channel-A drain of these files silently reverts them. Recorded here rather than
  drained now, per the standing deferral on drains.
- The `Badge` status-tone contrast defect is **deliberately NOT in this ADR.** It is the one item in
  the group that is genuinely under-determined — the remedy repaints primary list surfaces — so it is
  rendered as a four-column decision strip on `/brand-lab` and left for Martin. See that strip's
  header note for the measured ratios.
