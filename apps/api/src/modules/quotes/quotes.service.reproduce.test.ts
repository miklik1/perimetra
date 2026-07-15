/**
 * verifyReproducibility — the I3 acceptance path — unit-tested against a REAL
 * derived snapshot (no containers). The service's loaders are stubbed to return
 * the exact immutable inputs the snapshot was frozen from, so the pure engine
 * re-derives byte-identically and the deep-equal checks hold.
 *
 * The load-bearing assertion is the ADR-0108 N-1 tolerance (expand/contract): a
 * snapshot that LACKS `technicalDrawings` (a quote issued before the frozen-
 * drawing slice) must still reproduce, and one that CARRIES it must compare it —
 * mutating the frozen drawing surfaces exactly the `technicalDrawings` mismatch,
 * nothing else.
 */
import { describe, expect, it } from "vitest";

import { deriveSite, type SiteInstance } from "@repo/engine";
import {
  catalogV2,
  fenceRunV1,
  siteFenceConfig,
  siteGateConfig,
  sitePrices,
  slidingGateV1,
  steppedSite,
} from "@repo/fixtures";
import {
  deriveTaxBreakdown,
  resolveTaxMode,
  type Catalog,
  type ProductModelRelease,
  type RoundingPolicy,
} from "@repo/model";
import {
  buildCutList,
  buildSitePlan,
  buildTechnicalDrawing,
  buildWorkshopDrawing,
} from "@repo/renderers";
import type { PriceTableDetail } from "@repo/validators/price-tables";

import { QuotesService } from "./quotes.service.js";

const roundingPolicy: RoundingPolicy = { scale: 2, mode: "half-up", granularity: "end-of-invoice" };

/** A `PriceTableDetail` whose engine body IS the site golden's table + cost — the
 *  same object the snapshot was frozen against, so re-derivation reproduces. */
const priceTableDetail = {
  id: "00000000-0000-0000-0000-000000000001",
  version: sitePrices.version,
  currency: "CZK",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveTo: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  marginFloorPct: null,
  dphRate: "21",
  roundingPolicy,
  table: sitePrices,
  cost: null,
} as unknown as PriceTableDetail;

/** The golden three-instance site — the SAME roster the site-composition and
 *  production itests issue against. Two releases, both on catalog@2. */
const siteInstances = (): SiteInstance[] =>
  [
    { instanceId: "gate", release: slidingGateV1, input: siteGateConfig },
    { instanceId: "fenceA", release: fenceRunV1, input: siteFenceConfig },
    { instanceId: "fenceB", release: fenceRunV1, input: siteFenceConfig },
  ].sort((a, b) => (a.instanceId < b.instanceId ? -1 : 1));

const catalogs = new Map<string, Catalog>([
  ["sliding-gate@1", catalogV2],
  ["fence-run@1", catalogV2],
]);

/** Build a FROZEN snapshot the same way `issue()` does — real engine + renderers
 *  against the fixtures — so the service's re-derivation reproduces it. Mirrors
 *  `artifactsOf` + `computeQuoteTax`. */
function freezeSnapshot(): { snapshot: Record<string, unknown>; stamps: unknown } {
  const instances = siteInstances();
  const result = deriveSite(steppedSite, instances, sitePrices as never, catalogs, {
    rounding: roundingPolicy,
  });
  if (!result.isValid) throw new Error("fixture site did not derive valid");

  const specs = Object.fromEntries(instances.map((i) => [i.instanceId, i.release.drawing]));
  const technicalDrawings = Object.fromEntries(
    Object.entries(result.instances).map(([id, r]) => [id, buildTechnicalDrawing(r, specs[id])]),
  );
  const taxMode = resolveTaxMode({
    supplierVatPayer: true,
    customerVatPayer: false,
    constructionAssembly: false,
  });
  const tax = deriveTaxBreakdown(
    [{ ratePct: "21", netBase: result.money.total }],
    taxMode,
    roundingPolicy,
    "CZK",
  );

  const snapshot = {
    bom: result.bom,
    totals: result.totals,
    money: result.money,
    cutList: buildCutList(result, { kerfMm: 0 }),
    drawings: {
      site: buildSitePlan(steppedSite, result),
      instances: Object.fromEntries(
        Object.entries(result.instances).map(([id, r]) => [id, buildWorkshopDrawing(r)]),
      ),
    },
    technicalDrawings,
    inputs: Object.fromEntries(
      instances.map((i) => [i.instanceId, { releaseId: i.release.id, input: i.input }]),
    ),
    site: steppedSite,
    cutOptions: { kerfMm: 0 },
    tax,
  };
  return { snapshot, stamps: result.stamps };
}

/** A QuotesService whose loaders return the exact immutable inputs `row` was
 *  frozen from — the only four methods `verifyReproducibility` calls. */
function serviceFor(row: { snapshot: Record<string, unknown>; stamps: unknown }): QuotesService {
  const releaseBy: Record<string, ProductModelRelease> = {
    "sliding-gate@1": slidingGateV1,
    "fence-run@1": fenceRunV1,
  };
  const stubs = {
    quotes: { findById: async () => ({ ...row, id: "q1" }) },
    releases: {
      loadByReleaseId: async (releaseId: string) => ({
        body: releaseBy[releaseId],
        catalogVersion: catalogV2.version,
      }),
    },
    catalogVersions: { loadCatalog: async () => catalogV2 },
    priceTables: { loadByVersion: async () => priceTableDetail },
  };
  return new QuotesService(
    stubs.quotes as never,
    stubs.releases as never,
    stubs.catalogVersions as never,
    stubs.priceTables as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never, // LedgerService — unused by verifyReproducibility
    {} as never, // NumberingService — unused by verifyReproducibility
  );
}

const scope = { userId: "u1", organizationId: "o1" } as never;

describe("verifyReproducibility — frozen technical drawing (ADR 0108, I3)", () => {
  it("reproduces a snapshot that CARRIES the frozen technical drawing", async () => {
    const row = freezeSnapshot();
    const service = serviceFor(row);
    const res = await service.verifyReproducibility(scope, "admin", "q1");
    expect(res.mismatches).toEqual([]);
    expect(res.reproduced).toBe(true);
  });

  it("still reproduces a PRE-SLICE snapshot that lacks technicalDrawings (N-1)", async () => {
    const row = freezeSnapshot();
    // A quote issued before the frozen-drawing slice froze no technical drawing.
    delete (row.snapshot as { technicalDrawings?: unknown }).technicalDrawings;
    const service = serviceFor(row);
    const res = await service.verifyReproducibility(scope, "admin", "q1");
    expect(res.mismatches).toEqual([]);
    expect(res.reproduced).toBe(true);
  });

  it("flags ONLY technicalDrawings when a frozen drawing is tampered with", async () => {
    const row = freezeSnapshot();
    const drawings = row.snapshot.technicalDrawings as Record<string, { viewId: string }>;
    const first = Object.values(drawings)[0]!;
    first.viewId = "tampered";
    const service = serviceFor(row);
    const res = await service.verifyReproducibility(scope, "admin", "q1");
    expect(res.reproduced).toBe(false);
    expect(res.mismatches).toEqual(["technicalDrawings"]);
  });
});
