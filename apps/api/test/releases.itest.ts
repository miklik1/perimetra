/**
 * The immutable vendor stores at the HTTP layer against the real containers
 * (ADR 0053, spec §14). The load-bearing gate: a release + catalog published
 * through the API, FETCHED BACK, and run through the pure engine reproduces the
 * step-4 goldens byte-identically — proving the JSONB round-trips through
 * persistence without drift (I2/I3), exactly as the in-memory fixtures harness
 * (packages/fixtures/site-composition.test.ts) locks them.
 *
 * Also covers immutability (re-publish → 409, I3) and the publish gates
 * (unknown catalog → 400; malformed body → 400).
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { deriveInstance, deriveSite, type SiteInstance } from "@repo/engine";
import {
  catalogV2,
  fenceRunV1,
  planka_100_2d_3panel,
  siteFenceConfig,
  siteGateConfig,
  siteGolden,
  sitePrices,
  slidingGateV1,
  steppedSite,
} from "@repo/fixtures";
import { type Catalog, type ProductModelRelease, type Site } from "@repo/model";

import { DB } from "../src/common/db/db.module.js";
import {
  assignReleases,
  createApiApp,
  inject,
  orgIdOf,
  promotePlatformAdmin,
  signUpUser,
  type TestUser,
} from "./setup/app.js";

interface ReleaseDetail {
  id: string;
  releaseId: string;
  modelId: string;
  version: number;
  catalogVersion: number;
  status: string;
  body: ProductModelRelease;
}
interface CatalogDetail {
  id: string;
  version: number;
  body: Catalog;
}

describe("immutable release + catalog stores (HTTP, real stack)", () => {
  let app: NestFastifyApplication;
  let admin: TestUser;
  let gate: ReleaseDetail;
  let fence: ReleaseDetail;

  beforeAll(async () => {
    app = await createApiApp();
    const db = app.get<Db>(DB);
    admin = await signUpUser(app, "vendor-admin");
    // Publishing is VENDOR-only (ADR 0062): the publisher must be the platform
    // operator. Promote, then assign to its own org so the tenant-scoped list +
    // GET /:id (also ADR 0062) resolve the rows below.
    await promotePlatformAdmin(db, admin.id);

    // Global immutable stores are SHARED across itest files — a sibling may
    // have published these fixtures already (409). Tolerate that; the rows the
    // assertions need exist either way.
    const cat = await inject(app, {
      method: "POST",
      url: "/v1/catalog-versions",
      headers: { cookie: admin.cookie },
      payload: { body: catalogV2 },
    });
    expect([201, 409]).toContain(cat.statusCode);

    for (const body of [slidingGateV1, fenceRunV1]) {
      const res = await inject(app, {
        method: "POST",
        url: "/v1/releases",
        headers: { cookie: admin.cookie },
        payload: { catalogVersion: 2, body },
      });
      expect([201, 409]).toContain(res.statusCode);
    }

    await assignReleases(app, admin, await orgIdOf(db, admin.id), [
      "sliding-gate@1",
      "fence-run@1",
    ]);

    // Resolve the persisted rows for the round-trip + derivation assertions.
    const list = (
      await inject(app, {
        method: "GET",
        url: "/v1/releases?limit=100",
        headers: { cookie: admin.cookie },
      })
    ).json() as { items: ReleaseDetail[] };
    const find = async (releaseId: string): Promise<ReleaseDetail> => {
      const summary = list.items.find((r) => r.releaseId === releaseId)!;
      return (
        await inject(app, {
          method: "GET",
          url: `/v1/releases/${summary.id}`,
          headers: { cookie: admin.cookie },
        })
      ).json() as ReleaseDetail;
    };
    gate = await find("sliding-gate@1");
    fence = await find("fence-run@1");
  });

  afterAll(async () => {
    await app.close();
  });

  describe("publish + round-trip integrity", () => {
    it("stores the release body byte-identically (frozen status=published)", () => {
      expect(gate.body).toEqual({ ...slidingGateV1, status: "published" });
      expect(fence.body).toEqual({ ...fenceRunV1, status: "published" });
      expect(gate).toMatchObject({
        releaseId: "sliding-gate@1",
        modelId: "sliding-gate",
        version: 1,
        catalogVersion: 2,
      });
    });

    it("strips internal columns from the list response (spec §8)", () => {
      // The summary carries no body; the detail does. Neither leaks a raw column.
      // (Body is intentional release data, gated on write — not a leak class.)
      expect(gate).not.toHaveProperty("ownerId");
    });
  });

  describe("delta-0 reproduction THROUGH persistence (I2/I3)", () => {
    /** Roster built from the FETCHED (persisted) release bodies, not the fixtures. */
    const instances = (): SiteInstance[] => [
      { instanceId: "gate", release: gate.body, input: siteGateConfig },
      { instanceId: "fenceA", release: fence.body, input: siteFenceConfig },
      { instanceId: "fenceB", release: fence.body, input: siteFenceConfig },
    ];

    let catalog: Catalog;
    beforeAll(async () => {
      catalog = (
        (
          await inject(app, {
            method: "GET",
            url: "/v1/catalog-versions/by-version/2",
            headers: { cookie: admin.cookie },
          })
        ).json() as CatalogDetail
      ).body;
    });

    // Per-release catalog map (ADR 0065) — both products on catalog@2 here.
    const siteCatalogs = (): ReadonlyMap<string, Catalog> =>
      new Map([
        ["sliding-gate@1", catalog],
        ["fence-run@1", catalog],
      ]);

    it("the GATE — fenceA — fenceB aggregate is string-exact 129 891.504", () => {
      const result = deriveSite(steppedSite, instances(), sitePrices, siteCatalogs());
      expect(result.isValid).toBe(true);
      expect(result.money).toEqual(siteGolden.site.moneyTotals);
      expect(result.money.total).toBe("129891.504");
      expect(result.stamps.releaseIds).toEqual({
        gate: "sliding-gate@1",
        fenceA: "fence-run@1",
        fenceB: "fence-run@1",
      });
      expect(result.stamps.catalogVersions).toEqual({
        "sliding-gate@1": 2,
        "fence-run@1": 2,
      });
    });

    it("removing the fence joint restores fenceB's post: 130 241.504 (I8)", () => {
      const unjoined: Site = { ...steppedSite, connections: [steppedSite.connections[0]!] };
      const result = deriveSite(unjoined, instances(), sitePrices, siteCatalogs());
      expect(result.money.total).toBe(siteGolden.siteWithoutFenceJoint.moneyTotal);
    });

    it("the standalone gate reproduces the Excel configurator anchor 81 451.504", () => {
      const result = deriveInstance(
        gate.body,
        planka_100_2d_3panel.config,
        planka_100_2d_3panel.prices,
        catalog,
      );
      expect(result.isValid).toBe(true);
      expect(result.money.total).toBe(String(planka_100_2d_3panel.expectedTotalPrice));
    });
  });

  describe("immutability + publish gates (I3)", () => {
    it("re-publishing a catalog version is a 409", async () => {
      const res = await inject(app, {
        method: "POST",
        url: "/v1/catalog-versions",
        headers: { cookie: admin.cookie },
        payload: { body: catalogV2 },
      });
      expect(res.statusCode).toBe(409);
    });

    it("re-publishing a release is a 409", async () => {
      const res = await inject(app, {
        method: "POST",
        url: "/v1/releases",
        headers: { cookie: admin.cookie },
        payload: { catalogVersion: 2, body: slidingGateV1 },
      });
      expect(res.statusCode).toBe(409);
    });

    it("publishing a release against an unpublished catalog is a 400", async () => {
      const res = await inject(app, {
        method: "POST",
        url: "/v1/releases",
        headers: { cookie: admin.cookie },
        payload: {
          catalogVersion: 999,
          body: { ...slidingGateV1, id: "sliding-gate@2", version: 2 },
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects a malformed release body with 400", async () => {
      const res = await inject(app, {
        method: "POST",
        url: "/v1/releases",
        headers: { cookie: admin.cookie },
        payload: { catalogVersion: 2, body: { nope: true } },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects a release that ships no fixtures with 422 (I2 publish gate)", async () => {
      const res = await inject(app, {
        method: "POST",
        url: "/v1/releases",
        headers: { cookie: admin.cookie },
        payload: {
          catalogVersion: 2,
          body: { ...slidingGateV1, id: "no-fix@1", version: 1, fixtures: [] },
        },
      });
      expect(res.statusCode).toBe(422);
      expect((res.json() as { code: string }).code).toBe("release_invalid");
    });

    it("requires authentication (401 without a session)", async () => {
      const res = await inject(app, { method: "GET", url: "/v1/releases" });
      expect(res.statusCode).toBe(401);
    });
  });
});
