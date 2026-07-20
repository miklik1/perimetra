# ADR 0115 — The configurator renders the release's own wizard steps

**Status:** Accepted (2026-07-20 — decided by Martin during the ADR 0114 Phase 1b
configurator slice). **Supersedes ADR 0077 in part**: it replaces that ADR's
fixed five-step spine with a three-step app shell around the release's authored
steps, and it re-homes the camera choreography and the site-plan view onto a new
rule. ADR 0077's other decisions — the camera poses themselves, the hybrid
R3F/SVG coverage, the share-token flow — stand unchanged. Implements the step
model that `design/README.md` §8.2 left open as a blocking decision for Phase 1.

## Context

ADR 0077 shipped a fixed five-step Czech wizard spine — Produkt · Lokalita ·
Konfigurace · Barva a povrch · Souhrn — as part of the Bombardier UX grammar.
The spine was app-land, and it consumed the release's authored `ui.steps`
positionally: `buildFlow` seeded **Lokalita** from the release's _first_
authored step and flattened _every remaining_ authored step into
**Konfigurace**.

That was defensible when a release authored one or two steps. It does not
survive contact with the product for three reasons.

**It discards release-authored identity.** CORE_SPEC §8 makes the release the
author of its own UI, and `UiSpec` already models it fully: an ordered
`UiStep[]`, each with an id, an optional label and ordered `UiGroup`s, validated
at publish (`ui.param.uncovered` guarantees every writable parameter lands
somewhere, `ui.param.duplicate` that it lands exactly once). A release authoring
five meaningful steps rendered as two, under labels the release never wrote. The
vendor's step structure was data that the app threw away.

**The repo already contained the correct implementation, in the wrong place.**
`apps/web/app/configurator/wizard.tsx` renders `ResolvedUiStep[]` one-to-one
with, in its own words, zero product knowledge — and it is what the in-project
instance editor at `/site/:projectId` has always used. So the two step models
shipped side by side and disagreed: the same release rendered one way in the
standalone configurator and another way inside a project.

**The design canvas draws seven steps against the implemented five.** The
`design/README.md` §8.2 blocking question was whether the step list is
release-authored data or a fixed spine. The corpus already authors steps
(Rozměry / Konstrukce / Výbava a práce), so reading them faithfully recovers most
of the drawn structure from data that exists today.

## Decision

**The configurator renders the release's authored steps one-to-one, wrapped by
three app-shell steps.** `buildFlow` becomes:

```
produkt          — app shell (product picker)
«release steps»  — one BrandStep per authored UiStep, in authored order
barva            — app shell (finish picker)
souhrn           — app shell (save-to-project)
```

A release step carries its authored `id` and `label` through unchanged; the
three shell steps carry no release groups and label from the i18n catalog. The
retired `stepLokalita` / `stepKonfigurace` keys are removed from both locales.

This is a pure presentation change. There is **no schema change**, and I3 is
untouched: nothing about how a configuration derives, freezes or reproduces is
affected — only which screen a given parameter appears on.

### The two consequences, and the rule chosen for each

`UiStep` carries `id`, `label` and `groups` and nothing else — no camera hint,
no view hint. ADR 0077 keyed two presentation features on the step _kind_, so
both need a rule for steps whose kind is now simply "release":

1. **The camera pose.** The first release-authored step frames the `hero` pose;
   every later one frames `detail`. The three shell steps keep their ADR 0077
   poses (`hero` / `front` / `pullback`).
2. **The site-plan view.** The first release-authored step renders the top-down
   `SitePlanSvg` instead of the 3D scene — the treatment "Lokalita" had.

Both are a **positional carry-over** of the shipped behaviour, and they are
positional deliberately. The first authored step is the dimensions/footprint
step in every release the corpus contains, which is exactly why ADR 0077 seeded
Lokalita from it. For the golden corpus this reproduces today's visible
behaviour step for step.

Two alternatives were considered and rejected:

- **Flatten the choreography** — give every release step the same `detail` pose
  and demote the site plan to the view switch. Non-positional and honest, but it
  drops the camera animation through the middle of the flow, which is the ADR
  0077 feature the brand grammar exists for.
- **Let the release author it** (widen `UiStep` with `camera?` / `view?`) —
  structurally correct and it would kill the positional heuristic outright, but
  it is a `packages/model` schema change with publish-gate, validation and
  corpus-re-authoring impact, and it expands a reskin slice into a model slice.
  **This remains the right long-term answer and is deferred to its own ADR.**

### Step navigation keys on kind + id, not id

A release authors its step ids freely and publish validation enforces uniqueness
only _within_ the spec. A release authoring a step called `produkt` would
therefore collide with the shell step of that name, and the step nav would
silently jump to the wrong step. `flowKey(step)` returns `${kind}:${id}`, which
is unique by construction.

## Consequences

- The standalone configurator and the in-project instance editor now share one
  step model. `wizard.tsx` remains the in-project renderer; the difference
  between the two surfaces is the brand shell, not the step semantics.
- A vendor can now change the configurator's step structure by publishing a
  release, with no app deploy. That is the intended CORE_SPEC §8 property and it
  was previously unreachable from the standalone surface.
- `BrandStepKind` loses `lokalita` and `konfigurace` and gains `release`. Any
  future code switching on step kind must treat `release` as the general case
  and the other three as the exceptions — the inverse of the old shape.
- The positional camera/site-plan rule is a known wart: presentation resolves
  positionally even though content no longer does. It is recorded here rather
  than absorbed, and the deferred schema widening is the exit.
- A release authoring zero steps degrades to the three shell steps alone; a
  release with no `ui` block falls back to `defaultUi()` (one synthesized step)
  exactly as before.
