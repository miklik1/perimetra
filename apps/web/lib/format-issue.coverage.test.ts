import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import {
  applyArtifactOverrides,
  deriveInstance,
  deriveSite,
  domainIssue,
  gateInputKeys,
  missingParams,
  resolveCascade,
  type Issue,
  type Part,
  type PriceTable,
  type SiteInstance,
} from "@repo/engine";
import {
  catalogV2,
  fenceRunV1,
  siteFenceConfig,
  siteGateConfig,
  sitePrices,
  slidingGateGoldens,
  slidingGateV1,
  steppedSite,
} from "@repo/fixtures";
import { cs, en } from "@repo/i18n";
import {
  expr,
  type Catalog,
  type Override,
  type ParameterDef,
  type ProductModelRelease,
  type Site,
} from "@repo/model";

import type { IssueTranslator } from "./format-issue";

/**
 * The ENUMERATION TEST (CAR-14) — the load-bearing acceptance for the `issues.*`
 * catalog. It does not trust a hand-maintained list: it actually DERIVES the
 * golden corpus (`@repo/fixtures`) plus a battery of cheap, deliberately
 * invalid inputs exercising every corner of the engine's error taxonomy
 * (ADR 0047 — input gate, overrides, deviations, catalog/option resolution,
 * site-structural validation) and the vendor-authored constraint keys the
 * fixtures corpus currently carries, collects every emitted `Issue.key`, and
 * asserts EACH ONE has both a `cs` and `en` entry under `issues.*`
 * (packages/i18n) — so a future engine/release change that emits a new,
 * uncatalogued key fails HERE instead of silently falling back to the generic
 * "unknown issue" sentence in production.
 *
 * Placement: `apps/web` is DAG-allowed to import both `@repo/fixtures` (test-
 * only — see its own docblock) and `@repo/i18n` (`tooling/eslint/base.js`'s
 * `type: "app"` allow-list carries both), so this test can live where the two
 * meet without violating the package boundaries (ADR 0008/0011).
 */

const found = new Set<string>();
function collect(issues: readonly Issue[]): void {
  for (const issue of issues) found.add(issue.key);
}

// --- The golden corpus itself (mostly the "clean" happy path; kept for the
// spec's own framing — "derive the golden corpus" — even though the corpus is
// curated to be valid and is not expected to contribute many keys). ---------
for (const golden of slidingGateGoldens) {
  collect(deriveInstance(slidingGateV1, golden.config, golden.prices, catalogV2).issues);
}
const goldenSiteInstances: SiteInstance[] = [
  { instanceId: "gate", release: slidingGateV1, input: siteGateConfig },
  { instanceId: "fenceA", release: fenceRunV1, input: siteFenceConfig },
  { instanceId: "fenceB", release: fenceRunV1, input: siteFenceConfig },
];
const goldenSiteCatalogs = new Map<string, Catalog>([
  ["sliding-gate@1", catalogV2],
  ["fence-run@1", catalogV2],
]);
collect(deriveSite(steppedSite, goldenSiteInstances, sitePrices, goldenSiteCatalogs).issues);

// --- Forced failure paths: the input gate (engine.input.*) -----------------
// Pure functions taking a bare ParameterDef/release — no full derivation
// needed, mirroring packages/engine/src/scope.test.ts-style unit coverage.
collect(gateInputKeys(slidingGateV1, { nope: 1 })); // unknown_param
collect(gateInputKeys(slidingGateV1, { "a.b": 1 })); // reserved_key
collect(gateInputKeys(slidingGateV1, { opening_width_mm: "not-a-number" })); // bad_type
collect(gateInputKeys(slidingGateV1, { opening_width_mm: 500 })); // below_min (domain min 2000)
collect(gateInputKeys(slidingGateV1, { opening_width_mm: 12000 })); // above_max (domain max 8000)
collect(gateInputKeys(slidingGateV1, { suspension_angle: 50 })); // not_in_enum (allowed: 35/40/45)
collect(missingParams(slidingGateV1, new Set())); // missing_param (every non-defaulted param)

const vendorOnlyRelease = {
  parameters: [{ key: "vendor_only", type: "int", adjustability: "vendor" }],
} as unknown as ProductModelRelease;
collect(gateInputKeys(vendorOnlyRelease, { vendor_only: 1 })); // not_adjustable

// `off_step`/`pattern` domains exist on no CURRENT release parameter — the
// pure `domainIssue(param, value)` needs only a minimal ParameterDef.
const stepParam: ParameterDef = {
  key: "step_param",
  type: "int",
  domain: { kind: "range", min: 0, max: 100, step: 5 },
  adjustability: "user",
};
const offStep = domainIssue(stepParam, 7);
if (offStep) found.add(offStep.key);

const patternParam: ParameterDef = {
  key: "pattern_param",
  type: "text",
  domain: { kind: "pattern", pattern: "^[A-Z]+$" },
  adjustability: "user",
};
const patternIssue = domainIssue(patternParam, "lowercase");
if (patternIssue) found.add(patternIssue.key);

// --- Option / catalog resolution --------------------------------------------
collect(
  deriveInstance(
    slidingGateV1,
    { ...siteGateConfig, fill_type_id: "nonexistent" },
    sitePrices,
    catalogV2,
  ).issues,
); // engine.option.unresolved

const emptyCatalog: Catalog = {
  id: "empty@1",
  version: 1,
  materials: [],
  sections: [],
  components: [],
};
collect(deriveInstance(slidingGateV1, siteGateConfig, sitePrices, emptyCatalog).issues); // engine.catalog.unresolved

// --- Vendor-authored constraint keys (current fixtures corpus) -------------
collect(
  deriveInstance(
    slidingGateV1,
    { ...siteGateConfig, opening_width_mm: 7000 },
    sitePrices,
    catalogV2,
  ).issues,
); // sliding.opening_width.wide (domain-valid, over the 6000 judgment limit)
collect(
  deriveInstance(slidingGateV1, { ...siteGateConfig, clear_height_mm: 2200 }, sitePrices, catalogV2)
    .issues,
); // sliding.clear_height.tall (domain-valid, over the 2000 judgment limit)
collect(
  deriveInstance(fenceRunV1, { ...siteFenceConfig, run_length_mm: 25000 }, sitePrices, catalogV2)
    .issues,
); // fence.run.long (domain-valid, over the 20000 judgment limit)

// sliding.fill.overlap_within_max is an I2 DATA guard: no currently-authored
// fill option violates it, so proving the key needs a deliberately-broken
// clone of one option's `max_overlap_mm` (ADR 0098) — cheap, no new release.
const overlapRelease: ProductModelRelease = {
  ...slidingGateV1,
  optionSets: (slidingGateV1.optionSets ?? []).map((set) =>
    set.key === "fill"
      ? {
          ...set,
          options: set.options.map((option) =>
            option.id === "planka_100_3d"
              ? { ...option, attrs: { ...option.attrs, max_overlap_mm: 0 } }
              : option,
          ),
        }
      : set,
  ),
};
collect(
  deriveInstance(
    overlapRelease,
    { ...siteGateConfig, fill_type_id: "planka_100_3d" },
    sitePrices,
    catalogV2,
  ).issues,
);

// --- Overrides + deviations (resolveCascade) --------------------------------
const override = (patch: Partial<Override>): Override => ({
  id: "o",
  scope: "tenant",
  scopeRef: "x",
  target: "param:opening_width_mm",
  value: 1,
  author: "test",
  createdAt: "2026-01-01",
  ...patch,
});

collect(
  resolveCascade(slidingGateV1, siteGateConfig, sitePrices, {
    tenant: [override({ scope: "quote", target: "param:opening_width_mm", value: 3000 })],
  }).issues,
); // engine.override.scope_mismatch
collect(
  resolveCascade(slidingGateV1, siteGateConfig, sitePrices, {
    tenant: [override({ target: "bogus:xyz" })],
  }).issues,
); // engine.override.bad_target
collect(
  resolveCascade(slidingGateV1, siteGateConfig, sitePrices, {
    tenant: [override({ target: "price:frame_kit", value: -5 })],
  }).issues,
); // engine.override.bad_price
collect(
  resolveCascade(slidingGateV1, siteGateConfig, sitePrices, {
    tenant: [override({ target: "price:brand_new_code", value: 10 })],
  }).issues,
); // engine.override.new_price_code (warn)
collect(
  resolveCascade(slidingGateV1, siteGateConfig, sitePrices, {
    tenant: [override({ target: "artifact:frame.lprofile.quantity", value: 2 })],
  }).issues,
); // engine.override.artifact_scope (artifact overrides are quote-only)
collect(
  resolveCascade(slidingGateV1, siteGateConfig, sitePrices, {
    quote: [
      override({ scope: "quote", target: "artifact:frame.lprofile.quantity", value: "nope" }),
    ],
  }).issues,
); // engine.override.bad_value
collect(
  resolveCascade(slidingGateV1, siteGateConfig, sitePrices, {
    quote: [override({ scope: "quote", target: "artifact:frame.lprofile.quantity", value: 5 })],
  }).issues,
); // engine.override.pricing_resolution_required
collect(
  resolveCascade(slidingGateV1, siteGateConfig, sitePrices, {
    quote: [override({ scope: "quote", target: "param:opening_width_mm", value: 9500 })],
  }).issues,
); // engine.deviation.out_of_bounds (deviation bounds 1800–9000)
collect(
  resolveCascade(slidingGateV1, siteGateConfig, sitePrices, {
    quote: [override({ scope: "quote", target: "param:opening_width_mm", value: 8500 })],
  }).issues,
); // engine.deviation.reason_required (mode "warn", no reason)
collect(
  resolveCascade(slidingGateV1, siteGateConfig, sitePrices, {
    quote: [
      override({
        scope: "quote",
        target: "param:opening_width_mm",
        value: 8500,
        reason: "customer request",
      }),
    ],
  }).issues,
); // engine.deviation.applied (warn) — also exercises the optional `note` fragment

// --- Artifact overrides (applyArtifactOverrides) ----------------------------
const barePart: Part = {
  path: "x",
  componentCode: "c",
  name: "n",
  unit: "piece",
  quantity: 1,
  category: "material",
};
const partWithLength: Part = { ...barePart, lengthMm: 1000 };

collect(
  applyArtifactOverrides(
    [barePart],
    [override({ scope: "quote", target: "artifact:ghost.quantity", value: 5 })],
  ).issues,
); // engine.override.artifact_missing
collect(
  applyArtifactOverrides(
    [barePart],
    [
      override({
        scope: "quote",
        target: "artifact:x.quantity",
        value: 3,
        pricingResolution: "reprice",
      }),
    ],
  ).issues,
); // engine.override.cannot_reprice (no pricePerUnit to reprice from)
collect(
  applyArtifactOverrides(
    [partWithLength],
    [
      override({
        scope: "quote",
        target: "artifact:x.lengthMm",
        value: 1200,
        reason: "sales asked",
      }),
    ],
  ).issues,
); // engine.deviation.artifact (warn) — also exercises the optional `reason` fragment

// --- Site-structural validation (deriveSite) --------------------------------
// A minimal, fully-deriving synthetic release (mirrors packages/engine/src/
// site.test.ts's "panel") — every scenario below must still complete a clean
// per-instance derivation for the OTHER, non-broken instances in the call.
const mini: ProductModelRelease = {
  id: "mini@1",
  modelId: "mini",
  version: 1,
  status: "published",
  parameters: [
    {
      key: "len",
      type: "length_mm",
      domain: { kind: "range", min: 1000, max: 4000 },
      adjustability: "user",
    },
    {
      key: "elev",
      type: "length_mm",
      domain: { kind: "range", min: -1000, max: 1000 },
      default: 0,
      adjustability: "user",
    },
  ],
  constraints: [],
  derivation: {
    derived: [],
    parts: [
      {
        path: "body",
        resolve: { role: "body" },
        name: "Body",
        bom: { unit: "piece", quantity: expr("1"), category: "material" },
      },
    ],
  },
  ports: [
    { id: "a", kind: "k.a", compatibleKinds: ["k.b"] },
    {
      id: "b",
      kind: "k.b",
      compatibleKinds: ["k.a"],
      sharing: { element: "body", policy: "owner" },
    },
    {
      id: "mid",
      kind: "k.mid",
      compatibleKinds: ["k.mid", "k.bare"],
      sharing: { element: "body", policy: "consumer" },
    },
    { id: "bare", kind: "k.bare", compatibleKinds: ["k.mid"] },
  ],
  terrain: { elevationParam: "elev" },
};
const miniNoTerrain: ProductModelRelease = { ...mini, id: "mini@2" };
delete (miniNoTerrain as Partial<ProductModelRelease>).terrain;

const miniCatalog: Catalog = {
  id: "cat@mini",
  version: 1,
  materials: [],
  sections: [],
  components: [{ code: "body", name: "Body", unit: "piece", roles: ["body"] }],
};
const miniCatalogs = new Map<string, Catalog>([
  ["mini@1", miniCatalog],
  ["mini@2", miniCatalog],
]);
const miniPrices: PriceTable = {
  version: 1,
  components: { body: 1 },
  manufacturing: { rate: 0, multiplier: 0 },
  installation: 0,
};
const flatTerrain: Site["terrain"] = [{ id: "t0", elevation_mm: 0 }];
const place = (...ids: string[]): Site["placements"] =>
  ids.map((instanceId, i) => ({
    instanceId,
    pose: { origin_mm: { x: i * 1000, y: 0 } },
    terrainSegmentId: "t0",
  }));
const inst = (id: string, release: ProductModelRelease = mini): SiteInstance => ({
  instanceId: id,
  release,
  input: { len: 2000 },
});

collect(
  deriveSite(
    { id: "s", terrain: flatTerrain, placements: place("A"), connections: [] },
    [inst("A"), inst("A")],
    miniPrices,
    miniCatalogs,
  ).issues,
); // engine.site.duplicate_instance
collect(
  deriveSite(
    { id: "s", terrain: flatTerrain, placements: place("A", "GHOST"), connections: [] },
    [inst("A")],
    miniPrices,
    miniCatalogs,
  ).issues,
); // engine.site.unknown_instance
collect(
  deriveSite(
    { id: "s", terrain: flatTerrain, placements: place("A", "A"), connections: [] },
    [inst("A")],
    miniPrices,
    miniCatalogs,
  ).issues,
); // engine.site.duplicate_placement
collect(
  deriveSite(
    { id: "s", terrain: flatTerrain, placements: [], connections: [] },
    [inst("A")],
    miniPrices,
    miniCatalogs,
  ).issues,
); // engine.site.unplaced_instance
collect(
  deriveSite(
    {
      id: "s",
      terrain: flatTerrain,
      placements: [
        { instanceId: "A", pose: { origin_mm: { x: 0, y: 0 } }, terrainSegmentId: "nope" },
      ],
      connections: [],
    },
    [inst("A")],
    miniPrices,
    miniCatalogs,
  ).issues,
); // engine.site.unknown_terrain_segment
collect(
  deriveSite(
    { id: "s", terrain: flatTerrain, placements: place("A"), connections: [] },
    [inst("A", miniNoTerrain)],
    miniPrices,
    miniCatalogs,
  ).issues,
); // engine.site.terrain_unbound
collect(
  deriveSite(
    {
      id: "s",
      terrain: [...flatTerrain, { id: "t0", elevation_mm: 5 }],
      placements: place("A"),
      connections: [],
    },
    [inst("A")],
    miniPrices,
    miniCatalogs,
  ).issues,
); // engine.site.duplicate_terrain_segment
collect(
  deriveSite(
    {
      id: "s",
      terrain: flatTerrain,
      placements: place("A", "B"),
      connections: [
        { a: { instanceId: "A", portId: "a" }, b: { instanceId: "B", portId: "nope" } },
      ],
    },
    [inst("A"), inst("B")],
    miniPrices,
    miniCatalogs,
  ).issues,
); // engine.site.unknown_port
collect(
  deriveSite(
    {
      id: "s",
      terrain: flatTerrain,
      placements: place("A", "B", "C"),
      connections: [
        { a: { instanceId: "A", portId: "a" }, b: { instanceId: "B", portId: "b" } },
        { a: { instanceId: "A", portId: "a" }, b: { instanceId: "C", portId: "b" } },
      ],
    },
    [inst("A"), inst("B"), inst("C")],
    miniPrices,
    miniCatalogs,
  ).issues,
); // engine.site.port_reused
collect(
  deriveSite(
    {
      id: "s",
      terrain: flatTerrain,
      placements: place("A", "B"),
      connections: [{ a: { instanceId: "A", portId: "a" }, b: { instanceId: "B", portId: "a" } }],
    },
    [inst("A"), inst("B")],
    miniPrices,
    miniCatalogs,
  ).issues,
); // engine.site.port_incompatible
collect(
  deriveSite(
    {
      id: "s",
      terrain: flatTerrain,
      placements: place("A", "B"),
      connections: [
        { a: { instanceId: "A", portId: "mid" }, b: { instanceId: "B", portId: "mid" } },
      ],
    },
    [inst("A"), inst("B")],
    miniPrices,
    miniCatalogs,
  ).issues,
); // engine.site.sharing_conflict
collect(
  deriveSite(
    {
      id: "s",
      terrain: flatTerrain,
      placements: place("A", "B"),
      connections: [
        { a: { instanceId: "A", portId: "mid" }, b: { instanceId: "B", portId: "bare" } },
      ],
    },
    [inst("A"), inst("B")],
    miniPrices,
    miniCatalogs,
  ).issues,
); // engine.site.sharing_unprovided
collect(
  deriveSite(
    {
      id: "s",
      terrain: [{ id: "t1", elevation_mm: 80 }],
      placements: [
        { instanceId: "A", pose: { origin_mm: { x: 0, y: 0 } }, terrainSegmentId: "t1" },
      ],
      connections: [],
    },
    [{ instanceId: "A", release: mini, input: { len: 2000, elev: 500 } }],
    miniPrices,
    miniCatalogs,
  ).issues,
); // engine.site.elevation_conflict

// fence.connection.top_step — the real gate+fence corpus, terrain stepped past
// the fence model's 200 mm rule (mirrors @repo/fixtures's own negative test).
const tooSteep: Site = {
  ...steppedSite,
  terrain: [
    { id: "s1", elevation_mm: 0 },
    { id: "s2", elevation_mm: 400 },
  ],
};
collect(deriveSite(tooSteep, goldenSiteInstances, sitePrices, goldenSiteCatalogs).issues);

// --- Every key the corpus + engine taxonomy is known to be able to emit ----
// today (kept in sync with the forcing above — a key dropped from the forcing
// AND from here would silently stop being exercised; the assertion below
// still catches drift the other way — a key emitted but never catalogued).
const EXPECTED_KEYS = [
  "engine.override.scope_mismatch",
  "engine.override.bad_target",
  "engine.override.bad_price",
  "engine.override.new_price_code",
  "engine.override.artifact_scope",
  "engine.override.bad_value",
  "engine.override.pricing_resolution_required",
  "engine.override.artifact_missing",
  "engine.override.cannot_reprice",
  "engine.input.unknown_param",
  "engine.input.not_adjustable",
  "engine.input.bad_type",
  "engine.input.below_min",
  "engine.input.above_max",
  "engine.input.off_step",
  "engine.input.not_in_enum",
  "engine.input.pattern",
  "engine.input.reserved_key",
  "engine.input.missing_param",
  "engine.option.unresolved",
  "engine.catalog.unresolved",
  "engine.deviation.out_of_bounds",
  "engine.deviation.reason_required",
  "engine.deviation.applied",
  "engine.deviation.artifact",
  "engine.site.duplicate_instance",
  "engine.site.duplicate_terrain_segment",
  "engine.site.unknown_instance",
  "engine.site.duplicate_placement",
  "engine.site.unknown_terrain_segment",
  "engine.site.terrain_unbound",
  "engine.site.unplaced_instance",
  "engine.site.unknown_port",
  "engine.site.port_reused",
  "engine.site.port_incompatible",
  "engine.site.sharing_conflict",
  "engine.site.sharing_unprovided",
  "engine.site.elevation_conflict",
  "sliding.opening_width.wide",
  "sliding.clear_height.tall",
  "sliding.fill.overlap_within_max",
  "fence.run.long",
  "fence.connection.top_step",
] as const;

const csIssues = createTranslator({
  locale: "cs",
  messages: cs,
  namespace: "issues",
}) as unknown as IssueTranslator;
const enIssues = createTranslator({
  locale: "en",
  messages: en,
  namespace: "issues",
}) as unknown as IssueTranslator;

describe("issues.* catalog coverage (CAR-14 enumeration test)", () => {
  it("actually forced every expected key to be emitted (the forcing scenarios still work)", () => {
    for (const key of EXPECTED_KEYS) {
      expect(found.has(key), `expected "${key}" to have been emitted by a forcing scenario`).toBe(
        true,
      );
    }
  });

  it("has a cs AND en catalog entry for every issue key the corpus + taxonomy emitted", () => {
    expect(found.size).toBeGreaterThanOrEqual(EXPECTED_KEYS.length);
    const missingCs = [...found].filter((key) => !csIssues.has(key));
    const missingEn = [...found].filter((key) => !enIssues.has(key));
    expect(missingCs, "keys missing a cs catalog entry").toEqual([]);
    expect(missingEn, "keys missing an en catalog entry").toEqual([]);
  });
});
