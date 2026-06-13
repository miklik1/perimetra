/**
 * The quote lifecycle at the HTTP layer against the real containers (ADR 0053,
 * spec §14) — the I3 core. The load-bearing gate: a quote ISSUED from a site +
 * roster freezes a snapshot whose total is the site golden 129 891.504, and the
 * reproducibility check re-derives it BYTE-IDENTICALLY from its stamps (reloads
 * the immutable release/catalog/price-table versions, re-runs the pure engine +
 * renderers, deep-equals every artifact).
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

interface QuoteDetail {
  id: string;
  status: string;
  currency: string;
  total: string;
  stamps: { releaseIds: Record<string, string>; catalogVersion: number; priceTableVersion: number };
  snapshot: { money: { total: string } };
}

describe("quote lifecycle (HTTP, real stack)", () => {
  let app: NestFastifyApplication;
  let tenant: TestUser;

  const post = (user: TestUser, url: string, payload: Record<string, unknown>) =>
    inject(app, { method: "POST", url, headers: { cookie: user.cookie }, payload });

  /** The issue body: the golden three-instance site, roster by release natural key. */
  const issueBody = {
    site: steppedSite,
    instances: [
      { instanceId: "gate", releaseId: "sliding-gate@1", input: siteGateConfig },
      { instanceId: "fenceA", releaseId: "fence-run@1", input: siteFenceConfig },
      { instanceId: "fenceB", releaseId: "fence-run@1", input: siteFenceConfig },
    ],
  };

  beforeAll(async () => {
    app = await createApiApp();
    tenant = await signUpUser(app, "quote-tenant");

    // Seed the immutable stores the quote resolves stamps against. These are
    // GLOBAL and shared across itest files — tolerate a sibling having already
    // published the same fixtures (409); the rows exist for resolution either way.
    expect([201, 409]).toContain(
      (await post(tenant, "/v1/catalog-versions", { body: catalogV2 })).statusCode,
    );
    for (const body of [slidingGateV1, fenceRunV1]) {
      expect([201, 409]).toContain(
        (await post(tenant, "/v1/releases", { catalogVersion: 2, body })).statusCode,
      );
    }
    // Active price table (open-ended window covering now).
    expect(
      (
        await post(tenant, "/v1/price-tables", {
          currency: "CZK",
          effectiveFrom: "2026-01-01T00:00:00.000Z",
          dphRate: "21",
          table: sitePrices,
        })
      ).statusCode,
    ).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("issue", () => {
    it("freezes a snapshot at the site golden total 129 891.504 with full stamps", async () => {
      const res = await post(tenant, "/v1/quotes", issueBody);
      expect(res.statusCode, JSON.stringify(res.json())).toBe(201);
      const quote = res.json() as QuoteDetail;

      expect(quote.status).toBe("issued");
      expect(quote.currency).toBe("CZK");
      expect(quote.total).toBe("129891.504");
      expect(quote.snapshot.money.total).toBe("129891.504");
      expect(quote.stamps.releaseIds).toEqual({
        gate: "sliding-gate@1",
        fenceA: "fence-run@1",
        fenceB: "fence-run@1",
      });
      expect(quote.stamps.catalogVersion).toBe(2);
      expect(quote.stamps.priceTableVersion).toBe(2);
    });

    it("rejects a release that is not published (400)", async () => {
      const res = await post(tenant, "/v1/quotes", {
        ...issueBody,
        instances: [{ instanceId: "gate", releaseId: "ghost@9", input: siteGateConfig }],
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects an invalid site (422) — the engine is the gate (I5)", async () => {
      const tooSteep = {
        ...steppedSite,
        terrain: [
          { id: "s1", elevation_mm: 0 },
          { id: "s2", elevation_mm: 400 },
        ],
      };
      const res = await post(tenant, "/v1/quotes", { ...issueBody, site: tooSteep });
      expect(res.statusCode).toBe(422);
    });
  });

  describe("I3 reproducibility (the acceptance test)", () => {
    it("re-derives the issued quote byte-identically from its stamps", async () => {
      const issued = (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteDetail;

      const verify = await inject(app, {
        method: "POST",
        url: `/v1/quotes/${issued.id}/verify`,
        headers: { cookie: tenant.cookie },
      });
      expect(verify.statusCode).toBe(200);
      expect(verify.json()).toEqual({ quoteId: issued.id, reproduced: true, mismatches: [] });
    });
  });

  describe("scope isolation", () => {
    it("another tenant cannot read the quote (404)", async () => {
      const issued = (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteDetail;
      const intruder = await signUpUser(app, "quote-intruder");
      const res = await inject(app, {
        method: "GET",
        url: `/v1/quotes/${issued.id}`,
        headers: { cookie: intruder.cookie },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
