# ADR 1000 — Reserve ADR numbers ≥1000 for skeleton-authored decisions; 0001–0999 stays derived-project territory

**Status:** Accepted (2026-07-09). This ADR is the first number issued under the new rule. It supersedes only the numbering-partition clause of ADR 0042, not the rest of it.

## Context

The stamp-out script (`scripts/create-project`) marks the ADR numbering boundary at the moment a project is derived: everything up to the skeleton's current highest ADR is "inherited," and the new project's own decisions start at `highest + 1` (ADR 0042; `docs/adr/0000-inherited-from-skeleton.md`). That boundary is frozen **in the derived project** at stamp-out, but the skeleton does not stop numbering there — it keeps adding its own new ADRs (0045, 0046, 0047…) using the same flat 0001+ sequence. The two sequences — "the skeleton's own future decisions" and "this project's own decisions" — share one numbering namespace with no reserved gap between them, so they collide the moment either side grows past the other's starting point.

This has already happened, more than once:

- `mercata` (stamped 2026-06-14, boundary 0045) independently authored `0046-rls-by-guc-tenancy-floor.md`. The skeleton later authored its own `0046-deployment-tier-vercel-target-env.md` — an unrelated topic, the same number, in two different repos.
- Worse: `mercata`'s own `0046-rls-by-guc-tenancy-floor.md` decision (adopt RLS via a transaction-scoped GUC) is the **opposite** conclusion to the skeleton's later `0049-tenancy-app-level-scoping-not-rls.md` (reject RLS for the skeleton). Different numbers, the same subject, contradictory decisions — exactly the confusion ADR numbers exist to prevent.
- Every one of `perimetra`, `mercata`, `anyora-platform` and `booking` has its own, unrelated `0045`–`0049` — none of them the skeleton's `0045`–`0049` — because all four were stamped at the same 0044 boundary and all four, plus the skeleton itself, kept counting up from there independently.
- `mercata` already worked around this by hand: its own `docs/adr/0000-inherited-from-skeleton.md` documents a manual "drain and renumber" ritual — every skeleton ADR that lands after stamp-out is renumbered into a free slot at the tail of `mercata`'s own sequence, with a hand-maintained skeleton-number → local-number map. That is real, working discipline, but it is per-project, manual, and undocumented at the skeleton level — every derived project either reinvents it or lives with the collision.

`docs/managing-updates.md`'s ownership table and its "ADR numbering is partitioned" bullet describe the boundary as static (`0001–0044 skeleton`, `0045+ project`) and assume future skeleton ADRs stay "below your project's marker" — an assumption already false for every existing derived project, because skeleton ADRs 0045–0049 sit at or above every derived project's 0045 marker. ADR 0042's Decision section states the same now-stale boundary. Neither document anticipated the skeleton continuing to grow past the boundary it hands out to derived projects.

## Decision

Split the flat 0001+ sequence into two disjoint ranges, **going forward only**:

- **0001–0999** stays exactly what it already is: the shared legacy range plus every derived project's own decisions, starting at whatever boundary that project's `docs/adr/0000-inherited-from-skeleton.md` recorded at stamp-out (today: 0045 for `perimetra`/`mercata`/`anyora-platform`/`booking`; 0050 for any project stamped after this ADR). This skeleton **never authors a new ADR below 1000 again** — 0001–0049 are the last skeleton ADRs that will ever occupy this range.
- **1000+** is reserved for **skeleton-authored ADRs added from this point on** — decisions the skeleton makes about its own template code, independent of any one derived project. This ADR is the first: **1000**. The next skeleton ADR is 1001, and so on.

**Already-published ADRs 0001–0049 are never renumbered.** Every citation in this skeleton, in `CONTEXT.md` files, in code comments (`// see ADR 0038`), and in every derived repo's inherited-ADR list and drain-mapping stays valid forever. This ADR changes only where the _next_ skeleton ADR goes, not where any existing one lives.

`docs/adr/README.md`, `docs/managing-updates.md` are updated prose-only (no renumbering) to state the band going forward. The stamp-out script (`scripts/create-project/index.mjs`) is fixed so its "highest ADR" scan ignores files numbered ≥1000 — otherwise the first project stamped after this ADR lands would compute its own starting number as 1001 instead of 0050, immediately defeating the reservation this ADR creates.

Existing manual per-project drain/renumber rituals (mercata's) are **not required going forward** for any skeleton ADR numbered ≥1000 — those numbers can never collide with a derived project's own 0001–0999 range by construction, so there is nothing to drain-and-renumber. mercata's existing 0045–0049 drain mapping is historical and stays as-is; nothing here asks it to be redone.

## Consequences

- No further "skeleton ADR N happens to equal derived-project ADR N on an unrelated topic" collisions are possible going forward: the two sequences are now in disjoint number spaces by construction, not by convention.
- The gap between 0049 and 1000 is deliberate whitespace, not a typo. The highest-numbered derived project today (`perimetra`) sits around 0104, so there is enormous headroom before 1000 is ever a practical concern for any one project's own decisions, and this skeleton is expected to author well under 950 more ADRs of its own over its lifetime.
- A human authoring a new skeleton ADR must now pick the next number in the 1000+ band, not "highest + 1" in the old flat sequence. The "Numbering band (ADR 1000)" note in `docs/adr/README.md` says so explicitly, since there is no scaffolding script for skeleton-authored ADRs to enforce it mechanically.
- `docs/managing-updates.md`'s ownership table is corrected: `docs/adr/1000+` is added to the skeleton-owned row, and the "ADR numbering is partitioned" bullet stops asserting that future skeleton ADRs stay below a derived project's marker — instead it states the band rule and flags 0045–0049 as a grandfathered, pre-rule exception that may already collide with some derived project's own range (informational only; not to be renumbered on either side).
- `scripts/create-project/index.mjs`'s ADR-boundary scan is fixed to exclude the ≥1000 band, so every future stamp-out keeps computing 0050 (the correct, permanent legacy-range starting point) instead of drifting into the reserved band as soon as this ADR's own file exists in the tree.
- This ADR supersedes only the numbering-partition clause of ADR 0042 ("≤0044 skeleton-owned … ≥0045 project-owned") for anything going forward; the rest of ADR 0042 (stamp-out mechanics, scope stability, two-channel updates) is unchanged and not re-opened.

## Sources

- ADR 0042 (template lifecycle — the original, now partially superseded, numbering-partition statement).
- `docs/managing-updates.md` (the stale ownership table and partition bullet this ADR corrects).
- `scripts/create-project/index.mjs` (the boundary-computing code this ADR's companion fix updates).
- `mercata/docs/adr/0000-inherited-from-skeleton.md` (the manual drain-and-renumber workaround this ADR makes unnecessary for future skeleton ADRs); `mercata/docs/adr/0046-rls-by-guc-tenancy-floor.md` versus this skeleton's `0049-tenancy-app-level-scoping-not-rls.md` (the confirmed contradictory-decision collision that motivated this ADR).
