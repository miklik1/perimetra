# ADR 0049 — Site-graph composition: port sharing, terrain injection, paired connection scopes

**Status:** Accepted (2026-06-12). Implemented in step 4 (CORE_SPEC §10).

## Context

CORE_SPEC §5 specifies the site graph — positioned, connected instances with
stepped terrain — and the invariants it must prove: shared elements counted
once (I6) and multi-instance as the native shape (I11). The spec leaves the
operational semantics open: how ownership of a shared element is decided, how
a terrain segment's elevation reaches an instance's configuration, what scope
a connection-scope constraint evaluates against, and how the aggregate BOM
merges across instances.

## Decision

1. **Sharing is declared on ports, resolved per connection (I6).** A port may
   declare `sharing: {element: <partPath>, policy: owner | consumer}`. An
   `owner` port keeps its element and provides it; a `consumer` port's element
   exists only while the port is unconnected — on connection it is dropped
   from site aggregation and the result records
   `{ownerInstanceId, ownerPartPath, consumerInstanceId, consumedPartPath}`.
   A standalone fence run therefore has both end posts; a connected run
   attaches to the neighbor's element (the previous run's end post, a gate's
   tower post). Consumer↔consumer is an error (nobody provides); a consumer
   facing a port with no sharing declaration is an error (nothing to consume).
   Dropping an element the config never emitted (`when`-excluded) is a no-op.

2. **Terrain drives configuration through the ordinary input gate (I7).** A
   release opts into terrain with `terrain: {elevationParam}` naming a
   writable `length_mm` parameter (the publish gate rejects vendor-only or
   non-length params). A placement's `terrainSegmentId` writes the segment's
   elevation into that parameter — the same write path as any input, so
   domain/type checks apply. An explicit input that contradicts the
   placement's terrain is an error (`engine.site.elevation_conflict`), never
   silently out-voted in either direction.

3. **Connection constraints evaluate per connected end against a paired
   scope.** For each connection, each end's `scope: "connection"` constraints
   run with `self.*` = that end's full post-derivation scope (params + option
   attrs + derived) and `other.*` = the opposite end's; `price.*` is excluded
   (connection rules are geometric/structural, never commercial). The
   swappable-evaluator promise (CORE_SPEC §3) extends to connections:
   `ConstraintEvaluator.evaluateConnection(release, pairScope)`. Symmetric
   rules fire on both ends — each instance reports its own violation, with
   `{connection, self, other}` addressing on the issue.

4. **Cross-release references are a vendor authoring contract, not a runtime
   check.** The publish gate validates `self.X` statically against the
   release's own scope and leaves `other.*` open: declaring a port kind
   compatible commits the vendor to every release exposing that kind carrying
   the referenced keys (vendor-only authoring makes this enforceable; a
   missing `other.*` ref at connect time throws as an authoring defect, per
   the ADR 0047 taxonomy). Port kinds must be MUTUALLY compatible — both
   ports list the other's kind.

5. **Aggregation re-sums surviving parts; BOM lines merge by component.**
   After sharing resolution, site totals are recomputed from the surviving
   parts (never by summing instance totals), and the aggregate BOM merges
   lines by `(componentCode, unit, category)` with quantities/prices summed
   and full `{instanceId, path}` provenance per source (I9 site addressing:
   `<instanceId>/<partPath>`). The site result carries the I10 money mirror
   and site stamps `{releaseIds per instance, catalogVersion,
priceTableVersion, overrideIds}` (I3); cascade layers apply per instance.

6. **Stop-at-first-errored-stage (I5).** Structural site errors (unknown
   instance/port/segment, port reuse, incompatible kinds, sharing conflicts,
   unplaced instances) or any invalid instance stop before connection
   constraints; an errored connection constraint stops before aggregation. An
   invalid site ships no partial BOM. Instance-shaped issues stay on the
   per-instance results; site-shaped issues (new `scope: "site"`) on the site
   result.

## Consequences

- The post between two fence fields is counted once structurally — proven in
  fixtures by the GATE—fenceA—fenceB corpus (aggregate = gate anchor + 2 ×
  fence − 2 shared posts, string-exact) and by the engine's synthetic-panel
  suite.
- The degenerate single-instance site reproduces the standalone instance
  result exactly (I11) — app surfaces can use `deriveSite` as the only entry
  point.
- A port participates in at most one connection in v1; fan-out (one post
  serving three runs) would need a port-multiplicity extension — deferred
  until a real site needs it.
- Sharing drops the consumer's WHOLE element; partial sharing (split
  quantities) is out of scope, matching the catalog's piece-level reality.
- Joining-method compatibility via material `joiningMethods` (CORE_SPEC §5)
  is not yet a built-in connection check — connection-scope exprs cover
  today's models; it lands when a mixed-material connection exists to verify.
