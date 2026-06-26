/**
 * The per-tenant price-table store at the HTTP layer against the real
 * containers (ADR 0053, spec §14). Gates: (1) effective-date resolution picks
 * the right version for a given instant; (2) a price table resolved THROUGH the
 * API, fed to the pure engine, reproduces the site golden 129 891.504 — the
 * stamped priceTableVersion resolves to a byte-identical table (I3);
 * (3) re-publishing a version is a 409 (immutable).
 *
 * Releases/catalog come from the fixtures here (this file gates the PRICE
 * round-trip; the release round-trip is releases.itest.ts).
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deriveSite, type PriceTable, type SiteInstance } from "@repo/engine";
import {
  catalogV2,
  fenceRunV1,
  siteFenceConfig,
  siteGateConfig,
  sitePrices,
  slidingGateV1,
  steppedSite,
} from "@repo/fixtures";

import { createApiApp, inject, signUpUser, type TestUser } from "./setup/app.js";

interface PriceTableDetail {
  id: string;
  version: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  dphRate: string;
  table: PriceTable;
}

const instances = (): SiteInstance[] => [
  { instanceId: "gate", release: slidingGateV1, input: siteGateConfig },
  { instanceId: "fenceA", release: fenceRunV1, input: siteFenceConfig },
  { instanceId: "fenceB", release: fenceRunV1, input: siteFenceConfig },
];

describe("price-table store (HTTP, real stack)", () => {
  let app: NestFastifyApplication;
  let tenant: TestUser;

  const publish = (user: TestUser, payload: Record<string, unknown>) =>
    inject(app, {
      method: "POST",
      url: "/v1/price-tables",
      headers: { cookie: user.cookie },
      payload,
    });

  beforeAll(async () => {
    app = await createApiApp();
    tenant = await signUpUser(app, "price-tenant");

    // v2: the site price table (sitePrices.version === 2), window Jan–Jun 2026.
    const v2 = await publish(tenant, {
      currency: "CZK",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2026-06-01T00:00:00.000Z",
      dphRate: "21",
      table: sitePrices,
    });
    expect(v2.statusCode, JSON.stringify(v2.json())).toBe(201);

    // v3: a later open-ended window (distinct version).
    const v3 = await publish(tenant, {
      currency: "CZK",
      effectiveFrom: "2026-06-01T00:00:00.000Z",
      dphRate: "21",
      table: { ...sitePrices, version: 3 },
    });
    expect(v3.statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  const resolveActive = async (asOf?: string): Promise<PriceTableDetail> => {
    const url = asOf
      ? `/v1/price-tables/active?asOf=${encodeURIComponent(asOf)}`
      : "/v1/price-tables/active";
    const res = await inject(app, { method: "GET", url, headers: { cookie: tenant.cookie } });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
    return res.json() as PriceTableDetail;
  };

  describe("effective-date resolution", () => {
    it("resolves the version whose window covers asOf", async () => {
      expect((await resolveActive("2026-03-01T00:00:00.000Z")).version).toBe(2);
      expect((await resolveActive("2026-09-01T00:00:00.000Z")).version).toBe(3);
    });

    it("defaults asOf to now (past the v3 cutover → v3)", async () => {
      expect((await resolveActive()).version).toBe(3);
    });
  });

  describe("delta-0 reproduction THROUGH the resolved table (I3)", () => {
    it("the API-resolved v2 table reproduces the site golden 129 891.504", async () => {
      const resolved = await resolveActive("2026-03-01T00:00:00.000Z");
      expect(resolved.table.version).toBe(2);
      const result = deriveSite(
        steppedSite,
        instances(),
        resolved.table,
        // Per-release catalog map (ADR 0065) — both products on catalog@2.
        new Map([
          ["sliding-gate@1", catalogV2],
          ["fence-run@1", catalogV2],
        ]),
      );
      expect(result.isValid).toBe(true);
      expect(result.money.total).toBe("129891.5");
      expect(result.stamps.priceTableVersion).toBe(2);
    });
  });

  describe("immutability", () => {
    it("re-publishing a version is a 409", async () => {
      const res = await publish(tenant, {
        currency: "CZK",
        effectiveFrom: "2027-01-01T00:00:00.000Z",
        dphRate: "21",
        table: sitePrices, // version 2 again
      });
      expect(res.statusCode).toBe(409);
    });

    it("another tenant has no active table (scope isolation, 404)", async () => {
      const other = await signUpUser(app, "price-tenant-other");
      const res = await inject(app, {
        method: "GET",
        url: "/v1/price-tables/active",
        headers: { cookie: other.cookie },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
