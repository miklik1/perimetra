# ADR 0136 — `dimensionRole` on `ParameterDef`: the release names its own spatial dimensions

**Status:** Accepted (2026-07-28). Discharges the deferral recorded in
[ADR 0117](0117-configurator-immersive-frame-and-direct-manipulation.md) §3
("The principled replacement is a schema `dimensionRole`, deferred behind its own
ADR"). Supersedes nothing; ADR 0117 §3's positional heuristic survives as a
documented fallback rather than as the primary mechanism.

## Context

ADR 0117 shipped the CORE_SPEC §7.6 direct-manipulation loop: corner resize
handles and editable dimension pills that write a release parameter through the
same input state the wizard form field writes. To draw a width pill, the
configurator has to answer a question the release never answered: **which
parameter is the width, and which is the height?**

ADR 0117 §3 answered it positionally — "the first two visible `range`-domain
parameters, by declaration order, are the width and the height" — and recorded
that as a heuristic in need of a principled replacement. The heuristic works on
the shipped corpus only because every authored release happens to declare its
spatial pair first (`opening_width_mm`, `clear_height_mm` on the sliding and
swing gates; `clear_width_mm`/`clear_height_mm` on the branka;
`run_length_mm`/`clear_height_mm` on the fence run). It is silently wrong for any
release that declares, say, a bounded `panel_count` or a `ground_elevation_mm`
before its opening width — the pills would then address and drag the wrong
parameter, with no defect and no visible error. That is precisely the failure
mode CORE_SPEC's "product knowledge is data, not code" rule exists to prevent:
the app was inferring vendor knowledge instead of reading it.

ADR 0117 also names a second consumer waiting on the same schema work (§4, the
per-part toolbar). This ADR deliberately does **not** build that. §4 settled that
the release authors no binding from a rendered part to a parameter and that §7.6
and the §5 scope fence forbid inventing one. This slice is the parameter-level
role, nothing more.

ADR 0117 fixed no value set. Fixing it is this ADR's job.

## Decision

### 1. The enum is exactly `'width' | 'height'`

```ts
export type DimensionRole = "width" | "height";
```

Two members, matching exactly the two dimensions §7.6 addresses — the top pill
plus the corner handle's horizontal axis, and the right pill. No speculative
`depth`, `length`, `thickness` or `diameter`.

The asymmetry that decides this: **adding a member later is additive and free**
(an old release simply never carries the new value; the gate's rules are written
per-role and generalise; the editor's select gains an option), while **removing
one is not** — a published release is immutable (I3), so a value that ever
reached a frozen `body` is in the corpus forever and every future reader must
keep understanding it. Under that asymmetry the correct move is to ship the
smallest set with a real consumer today and grow it when a release needs the
growth, rather than to guess at a vocabulary and be stuck with the guesses.

`width` is deliberately the **horizontal spatial extent**, not "the width of an
opening". That is why the fence run authors `dimensionRole: "width"` on
`run_length_mm`: the role names the axis the handle drags, and the vendor's own
`label` ("Délka plotu") carries the product language. Roles are geometry; labels
are wording.

### 2. It is DESCRIPTIVE metadata — the invariant that keeps it cheap

`dimensionRole` enters **no expression scope, no derivation and no price path**.
It is not referenceable from an Expr, it produces no `slotScopes` entry, no
derived key reads it, and no BOM line or price is a function of it. It exists to
let a UI address a parameter it was already allowed to write.

This is the load-bearing constraint, and it must survive future edits: the moment
`dimensionRole` becomes referenceable from an expression, it stops being metadata
and starts being able to move a derived value — and then re-authoring a release's
roles could shift a golden total. As long as it stays descriptive, authoring it
on a fixture provably cannot move `129891.504` / `79039.86` / `81451.504`,
because nothing downstream of the engine ever reads it.

### 3. Three publish-gate rules, because an unusable role is a lie

The field is optional, but an _authored_ role must be one the manipulation layer
can actually honour. `validateRelease` gains three defect codes inside the
existing parameter pass:

- **`dimensionRole.duplicate`** — at most one parameter per role. Two widths is
  not a preference the app can resolve; it is an authoring error, and resolving
  it silently (first wins) would reintroduce exactly the positional guessing this
  ADR removes.
- **`dimensionRole.domain`** — the parameter must carry a `range` domain with
  numeric `min` AND `max`. §7.6's own rule: the drag clamps to the domain (the
  outer rail), so a parameter with no bounds cannot clamp a drag. ADR 0117
  already skipped such parameters silently; with an explicit role, silence is
  wrong — the vendor asked for a pill that cannot be built, and the gate says so.
- **`dimensionRole.vendor`** — the parameter must not be
  `adjustability: "vendor"`. This mirrors the existing `ui.param.vendor` rule and
  the I7 contract: the schema, not UI convention, decides who may write a value,
  and a pill that edits a vendor-only parameter is a write the input gate would
  reject. Better to refuse the release than to ship a control that 403s itself.

All three are emitted at `parameters[<key>].dimensionRole`, which the editor's
`where`↔fieldId bijection reproduces in both directions.

Because the store is immutable and `validateRelease` only runs on the publish
path, these rules can never invalidate an already-frozen release. They gate NEW
publishes — including `apps/api/src/seed.ts`, which re-publishes the golden
corpus through the services, which is why the fixture authoring and the rules
land in the same commit.

### 4. The configurator prefers the role and keeps the positional fallback

`dimensionBindings` now takes `{ width, height }` explicitly instead of
`ranges[0]`/`ranges[1]`, and `ConfiguratorInner` resolves that pair by scanning
the resolved UI for `def.dimensionRole === "width"` / `"height"` first. The ADR
0117 positional scan runs **only when neither role is authored anywhere in the
release**.

The fallback is kept, and kept whole-release rather than per-dimension, for two
reasons. First, compatibility: every release published before this ADR carries no
roles, and those releases must keep working un-reauthored — including the
immutable ones that can never be re-authored. Second, honesty about mixed
authoring: if a vendor authors only `width`, the height pill is simply absent
(§7.6 — a control that cannot address a form-exposed parameter is not shown)
rather than being back-filled positionally from a parameter the vendor did not
nominate. A half-authored release yields a half-populated toolbar, which is
legible; a half-authored release silently completed by a heuristic is not.

### 5. The editor authors it, through the existing `'none'` sentinel precedent

`paramDraftSchema` gains `dimensionRole: z.enum(["none", "width", "height"])`,
following exactly the `domainKind` / `deviationMode` / `valueMode` precedent: the
form always holds a value, `"none"` is the editor-only sentinel that `buildParam`
omits from the built `ParameterDef`, and `draftParam` maps a missing field back
to `"none"`. The parameters workbench renders it as an `EnumSelect` beside
adjustability. The strict deep-equal round-trip in `draft.test.ts`
(`buildReleaseFromDraft(parse(draftFromRelease(r)))` must reproduce `r`) is the
canary that the three-way mapping is complete.

### 6. No migration, no backfill, no wire change

`packages/validators`' `releaseSchema.body` is `z.unknown()` by deliberate design
(the deep shape is gated server-side rather than mirrored in zod), the api's
`assertReleaseEnvelope` is a shallow six-key typeof check, `validateRelease` is
hand-rolled and never enumerates or rejects extra keys, and the store is a
`jsonb` column written verbatim. So an optional field added to `ParameterDef`
crosses the wire, passes the gate and persists with **zero** changes to any of
those layers, and existing frozen rows simply lack the key.

## Consequences

- **I3 is untouched, and this is a structural property rather than a test
  result.** `verifyReproducibility` re-derives from the quote's stamps and
  deep-equal-compares the ARTIFACTS (bom / prices / drawings / technicalDrawings),
  never the release body; the engine reads `key`, `type`, `domain`, `default` /
  `defaultExpr` and `deviation` off a `ParameterDef` and ignores everything else.
  A quote stamped on a pre-change release body re-derives byte-identically after
  this change, because neither the frozen body nor the code that consumes it moved.
- **A re-authored release is a NEW release.** Adding roles to the fixture
  releases changes the body a _future_ publish freezes — it does not and cannot
  mutate `sliding-gate@1` in an existing database. A dev/seed database seeded
  before this change keeps the role-less body and keeps working through the
  positional fallback; a re-seed publishes the role-carrying body. Both are
  correct, and the goldens are identical either way.
- **The positional fallback is now load-bearing legacy, and must not be deleted**
  until every release a running tenant is pinned to carries roles — which, for
  immutable published releases, means never. It is documented as such at both its
  definition and its call site.
- The three new defect codes are a **publish-time** gate only. A release
  published before this ADR that would violate one of them (e.g. no release ever
  authored a role, so none can) stays published; the codes exist to stop the next
  publish, not to retroactively condemn the corpus.
- The ADR 0117 §4 per-part toolbar remains deferred. It needs a part→parameter
  binding the release does not author, which is a different piece of schema work
  and a different ADR; a `dimensionRole` on a parameter says nothing about which
  rendered part a spacing stepper would address.
- `resolveUi` passes the whole `ParameterDef` through as `ResolvedUiParam.def`,
  so the field reached the configurator with no change to `packages/model/src/ui.ts`,
  and the editor's "Changes vs {releaseId}" diff picks it up for free (parameters
  are diffed as whole objects, keyed by business key).

## Sources

- `docs/rebuild/CORE_SPEC.md` §7.6 (direct manipulation), §3 (vendor authoring,
  the "but not there" knowledge), §1 I3 (frozen re-derivability) and I7 (the
  schema decides who may write a value).
- [ADR 0117](0117-configurator-immersive-frame-and-direct-manipulation.md) §3 and
  §4 — the deferral this ADR discharges and the scope fence it respects.
- [ADR 0068](0068-structured-release-editor.md) — the structured release editor,
  its `'none'`-sentinel field convention and the `where`↔fieldId bijection.
- [ADR 0053](0053-quote-lifecycle.md) — the freeze and
  `verifyReproducibility`, the layer this change had to prove it cannot disturb.
