# ADR 0103 — The fence family (`fence-run@1`) is the FIL `Ploty` calculator as data

**Status:** **Accepted** (2026-07-09 — CAR-32). As-built: `packages/fixtures/src/releases/fence-run.ts`

- `catalog/catalog-v2.ts` + `golden/fence-run.ts`, locked by `fence-run.spacing.test.ts`
  (7-fill spacing + priced golden) and `fence-run.drawing.test.ts`. Geometry eyes-on
  done (`?scene=fence-run` per fill type; the ADR-0102 render taste gate is decoupled
  and does not block this).

## Context

The `fence-run@1` fixture was a harness placeholder: `anchored: false`, aluminium-only,
a single made-up `planka_100` option, a bespoke `fillRows = floor((clear_height−100)/
min_spacing)` fill count, no posts/carriers matching the fabricator, no steel, no
drawing. It existed to prove the SITE mechanics (ports, terrain, the shared-post rule),
not to price a real fence — so a fence a FIL estimator configures emitted the wrong BOM
and price. The 2026-07-08 gates↔perimetra parity analysis named fence the top
FIL-usability blocker, and CAR-32 is the fix: author `fence-run@1` as a REAL,
FIL-Excel-anchored family on the locked ADR-0098 spacing engine.

Ground truth is `~/gates/reference_files_unlocked/2026-PC_Ploty_FINAL_PC.xlsx`
(`Kalkulace` + `Výplet`, **formulas, not cached values** — the VZOR carries leftover
multi-field sample data, `excel-ground-truth`).

## Decision (as-built)

1. **A `fence-run@1` instance is ONE uniform run — the Excel's per-field "Pole" block.**
   The Excel quotes up to seven _different_ fields (`Počet různých polí`, max 7), each with
   its own clear width / height and a `počet polí` count. In perimetra that is several runs
   composed on a SITE sharing boundary posts (the shared-post rule) — not one release with
   heterogeneous bays. One instance derives N identical bays; the FIL per-bay formulas drive
   everything, so a run of N equal bays reproduces N copies of one Pole byte-for-byte.

2. **Input is `run_length_mm`, the bay subdivision is derived** (`fieldCount =
roundUp(run_length / 2500)`, `fieldWidth = run_length / fieldCount`). The estimator's
   manual sheet takes a per-bay clear width; the site-drawn perimetra fence takes a run
   length and derives the bays. Keeping `run_length_mm` (rather than switching to per-bay
   inputs) preserves the site-canvas UX and the cross-release gate↔fence contract
   (`topLine`, `ground_elevation_mm`, the `fence.start`/`fence.end` ports) with no churn to
   the tenancy/quote seams. The 2500 mm max bay is FIL-typical (FIL-confirm pending).

3. **The Výplet spacing is the SHARED ADR-0098 chain, fed the raw clear height.** Unlike the
   branka/gate families (which divide by a reduced carrier length), the fence divides by
   `clear_height` directly and the h-profil carrier length `fillZoneHeight` is the chain's
   _output_ (Excel F26 = konce1 + gaps·pitch + konce2). Same count→gaps→rawPitch→pitch
   (capped at `max.rozteč` unless `Vypnout max.?`) structure, not a fork. The seven fills
   carry the **`Ploty`** Výplet numbers (the Branky/Samonosna sheets differ — a product's
   end-offsets are its own, so the numbers are NOT copied from the gate families).

4. **Fence labour is FLAT per field, not hours × rate.** Excel Výroba (500/field) and Montáž
   (650/field) are per-field flat lines. They are modelled as dedicated catalog components
   (`fence_manufacturing` / `fence_installation`, distinct roles) priced per piece in the
   price table — decoupled from the gate families' `manufacturing.rate` scalar (a shared
   price table can't be both 790 hours-rate and 500 per-field). `manufacturing_hours` is
   dropped from the fence.

5. **Posts (Sloup 100) are priced per metre and split for the shared-post rule.** Excel
   `Sloup 100` @ 1080/m; T21 sums every post's metres then rounds. Perimetra keeps
   `posts.start` (consumer) / `posts.end` (owner) / `posts.line` as separate parts so the
   site can drop a consumed boundary post — each rounds `roundUp(clear_height/1000)`
   per-post, which **coincides** with the Excel summed rounding only when the height is a
   whole number of metres. The byte-true golden therefore uses `clear_height = 2000`.

6. **Steel is real.** `catalog@2` gains `sloup_100(_steel)`, `h_profile_25(_steel)`, the
   `jakl_100x100` / `h25` sections (alu + steel), the caps/footing/labour components, and
   reuses the existing fills + `h_profile_50`. `frame_material` switches the whole run.

7. **The family authors a `DrawingSpec`** (front elevation dimensions bound to derived keys
   - a section across the first bay), so it inherits its 2D drawing free (ADR 0102).

## The byte-true anchor

LAMELA 113 3D, bay 2000 × 2000, 4 bays, installation on — every line derived from the Excel
formulas and locked in `golden/fence-run.ts`:

- spacing reproduces the workbook's own Pole-1 cells: **K32 = 21, F26 = 1987, J33 = 94,
  F27 = 1930** (the transcription-faithfulness proof);
- priced total **63 756.8** (h-profil 32 m × 210 + Výplň 163 m × 217 + Sloup 10 m × 1080 +
  caps/footing/connector + Výroba 4 × 500 + Montáž 4 × 650). PLAŇKA 100 2D (the 2D / h-25
  path) = **60 836.4**; steel (regression, the workbook is alu-only) = **49 950.8**.

## Consequences

- **The site golden re-baselines** from 129 891.5 to **134 723.5** (the fence is FIL-real
  now): the standalone fence 24 570 → 28 796, VAT → 28 291.94, gross → 163 015.44, cost →
  82 889.86, and the downstream tax/nábídka goldens + the api integration + web assertions
  move with it. This is intended — the old number was the placeholder's.
- **The fence h-profil (210/m) and fill connector (4.95) differ from the gate families'
  shared components** (200 / 5) because they come from a different workbook. A real tenant
  has one price list and reconciles them; each golden stays byte-true to its own source.
- **`catalog@2` is edited in place** (pre-users, dev-mode, regenerated on every seed) rather
  than bumped to `@3` — I3 immutability is a runtime property of persisted quotes, of which
  there are none. A future catalog change touching a live tenant bumps the version (ADR 0100).

### Documented limitations (follow-ups, not blockers)

- **The shared-post rule shares the post PROFILE metres, not its caps/footing.** Dropping the
  consumer's `posts.start` part removes the Sloup metres but not the cap/patka lines keyed to
  post count, so a connected boundary double-counts one cap set per shared post. The byte-true
  STANDALONE golden is unaffected; site cap-sharing is a §6-override-territory follow-up.
- **`pref. mezera` (Excel F23, the preferred gap that switches the divisor to
  `max_overlap + gap`) is not exposed.** All real configs use 0; the param is deferred so an
  unset input can't emit a wrong number.
- **The "no posts / masonry" (`T186 ≠ 2`) variant is out of scope** — this family always bills
  posts.
- **The bottom lamella dips ~7–21 mm below the panel base** because a plank is centred on its
  Excel drill slot (konce1 above the carrier foot) and its half-height exceeds that offset —
  FIL-faithful, not a datum error (locked, commented).
- **The Ploty `max. rozteč` caps (142–180) are high**, so no in-domain 3D fill hits the pitch
  cap; the 2D/3D divergence is carried by the carrier (h-25 vs h-50) + the fill's own
  end-offsets, not a bound cap.

## Alternatives rejected

- **Per-bay `field_width_mm` + `field_count` inputs** (Excel-shaped): more faithful to the
  manual sheet but breaks the site-canvas length-driven UX and forces a rename cascade across
  the tenancy/quote seams for no numeric benefit (the formulas are identical either way).
- **A single summed `posts` part** (byte-true summed rounding for any height): incompatible
  with the part-drop shared-post mechanism, which needs `posts.start`/`posts.end` as separate
  droppable parts. Resolved by the whole-metre-height golden instead.
