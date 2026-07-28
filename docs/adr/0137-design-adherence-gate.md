# ADR 0137 — The design-adherence gate is blocking from the start, and it does not run on oxlint

**Status:** Accepted (2026-07-28 — Phase A). Supersedes the wiring decision recorded in
`design/README.md` §1.3 ("wire it into `pnpm lint` as a separate, non-blocking `lint:design` task
during the first surface, and promote it to blocking once the first two surfaces pass it clean").
Related: [ADR 0111](0111-design-system-scale-and-component-kit.md) (the tokens and kit this measures),
[ADR 0114](0114-design-canvas-adoption.md) §7.1 (the deliberate absence of spacing tokens),
[ADR 1029](1029-the-guards-were-guarding-nothing.md) (the failure class this ADR is mostly about).

## Context

The design export ships `_adherence.oxlintrc.json`, the only automated adherence gate that comes with
it. It was never wired. The original plan was a non-blocking task promoted to blocking "after the
first two surfaces" — and **seven surfaces have since shipped**, so the ramp's own trigger condition
passed unnoticed. A promotion that depends on someone remembering a threshold is not a plan; the gate
either blocks or it does not exist.

Wiring it turned up something worse than lateness.

### The export's adherence config cannot enforce anything under oxlint

Measured against the pinned `oxlint@1.75.0`, **every rule in that file is a no-op in this repo**:

| Rule                                                      | Why it does nothing here                                                                                                                             |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-restricted-syntax` — raw hex, raw px, non-system font | **Not implemented by oxlint.** It refuses the entire config: `Rule 'no-restricted-syntax' not found in plugin 'eslint'`.                             |
| `react/forbid-elements`                                   | Ships `{"forbid": []}` — a no-op by construction.                                                                                                    |
| `no-restricted-imports`                                   | Targets `components/general/**`, paths that exist only INSIDE the export. This repo's kit is `packages/ui/src/components/ui`, so it matches nothing. |

The file also carries a vendor `x-omelette` key that oxlint rejects outright, so it does not even
load without preprocessing.

Had this been wired as planned — `oxlint -c _adherence.oxlintrc.json` — the task would have either
hard-failed on the config or, once the vendor key was stripped, passed green while auditing
**nothing**. That is precisely [ADR 1029](1029-the-guards-were-guarding-nothing.md)'s failure class,
with the extra harm that a named `lint:design` task in the gate output reads as done.

## Decision

**1 — The export stays the source of truth; ESLint becomes the engine.**
`tooling/eslint/design-adherence.js` READS `_adherence.oxlintrc.json` and hands its rule payloads to
ESLint. The rules are not restated in code, so a re-export changes the gate with no edit here. ESLint
implements `no-restricted-syntax` and uses the same esquery selector dialect the config is already
written in, so the payloads transfer verbatim.

The export directory name carries a per-export uuid, so it is **discovered, not hard-coded** — and
exactly one export must be present. Zero means the gate has no source; more than one means nobody can
say which is authoritative. Both throw.

**2 — It rides the existing `lint` task, not a new one.**
`pnpm lint` already runs in CI and in the definition of done at `--max-warnings 0`. Folding the block
into `apps/web/eslint.config.js` and `packages/ui/eslint.config.js` makes the gate blocking from the
first commit with **nothing to half-wire** — the [ADR 0133](0133-route-segment-credential-manifest.md)
lesson, where a guard living outside any workspace needed four separate wirings to be real. The
promised standalone `lint:design` script is therefore **not created**: a second task enforcing the
same rules would duplicate the failure output and add a wiring that can rot. The name survives only in
this ADR and in the superseded README line.

**3 — The raw-px check is read, validated, and deliberately NOT enforced.**
It is written for a `var()`-authoring world. This repo styles with Tailwind utilities, where an
arbitrary value is the sanctioned escape hatch and **the design system's own kit uses one** (`Badge`
is `text-[10px]`). More decisively, it contradicts a standing decision: **ADR 0114 §7.1 declined to
tokenise the spacing scale on purpose** — the rung vocabulary is a comment, not a token set — so there
is frequently no token to move a value to. The 14 hits on real surfaces are rail widths (`w-[220px]`,
`w-[68px]`) and the 44px WCAG touch target, none of which the export ships a token for. Enforcing it
would force either a fake tokenisation or a tree of disable comments; both are worse than saying
plainly that it is off.

It is still **read and anti-vacuity-checked**, so a re-export that drops or renames it fails the
build. Re-enabling it requires the export to ship width/size tokens and ADR 0114 §7.1 to be revisited.

**4 — Fail closed, and prove it.**
Everything throws rather than degrading to an empty rule set: a missing export, an ambiguous one, a
malformed JSON, an entry without a selector, a dropped check, or a filter that leaves zero rules
enforced. `design-adherence.test.ts` pins these properties, and the anti-vacuity path was
**disarm-verified** — dropping the hex rule from the export makes the suite fail with the exact
message a real re-export regression would produce.

## Consequences

- **The gate is blocking today and the tree is clean**: `apps/web` and `packages/ui` both pass at
  `--max-warnings 0`. What it enforces is the hex-colour and font-family checks; what it does not is
  stated above rather than left to be discovered.
- **Four exemptions, each for a surface with no CSS token plane** — recorded because an unexplained
  exemption is indistinguishable from an oversight:
  - `app/configurator/scene/**` — a colour is a MATERIAL INPUT to a WebGL shader; `var(--color-…)` is
    not something three.js can resolve. Same "not this world" reason the directory already disables
    `react/no-unknown-property`.
  - `app/brand-lab/**` — the token gallery's job is to display raw token VALUES as swatches, so a
    literal colour is the subject matter.
  - `drawing-svg.tsx` and `technical-drawing-svg.tsx` — print renderers. An A4 traveler or §29 doklad
    must render the same ink whoever prints it; following the viewer's colour scheme would be the bug.
- **Booked, not taken:** `drawing-svg.tsx` hardcodes the deviation amber as `#f59e0b`, which
  duplicates `--color-deviation` and can drift from it. The exemption above is what currently hides it.
- **Glob trap, recorded because it shipped green for one run:** a Next.js dynamic segment is spelled
  `[id]`, which a glob reads as a **character class** — so an ignore of
  `app/quotes/[id]/production/technical-drawing-svg.tsx` matches nothing and the file stays linted.
  The ignores are keyed by unique basename instead. Any future path-shaped ignore crossing a dynamic
  segment has the same trap.
- **`oxlint` is NOT added as a dependency.** It was installed to measure the claims above and then
  removed, along with the catalog entry that was in flight for it. Nothing in the gate runs oxlint, so
  keeping it would have been a dead dependency with a plausible-looking name — the kind that makes a
  future reader assume the adherence config is being executed as written.
- `tooling/eslint` gains a `./design-adherence` export subpath, kept in lockstep with the package's
  `exports` map per the repo's deep-import rule.
