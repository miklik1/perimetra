/**
 * The quote lifecycle at the HTTP layer against the real containers (ADR 0053,
 * spec §14) — the I3 core. The load-bearing gate: a quote ISSUED from a site +
 * roster freezes a snapshot whose total is the site golden 129 891.504, and the
 * reproducibility check re-derives it BYTE-IDENTICALLY from its stamps (reloads
 * the immutable release/catalog/price-table versions, re-runs the pure engine +
 * renderers, deep-equals every artifact).
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { user as userTable } from "@repo/db/schema/auth";
import { quote as quoteTable } from "@repo/db/schema/quotes";
import {
  catalogV2,
  fenceRunV1,
  siteCosts,
  siteFenceConfig,
  siteGateConfig,
  sitePrices,
  slidingGateV1,
  steppedSite,
} from "@repo/fixtures";

import { DB } from "../src/common/db/db.module.js";
import { createApiApp, inject, signUpUser, type TestUser } from "./setup/app.js";

interface QuoteDetail {
  id: string;
  status: string;
  currency: string;
  total: string;
  stamps: { releaseIds: Record<string, string>; catalogVersion: number; priceTableVersion: number };
  snapshot: { money: { total: string }; costMoney?: { total: string } };
}

/** The active price table the quote stamps against — with a cost layer (ADR
 *  0059) so the snapshot freezes cost and verify re-derives it (I3). */
const priceTableBody = {
  currency: "CZK",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  dphRate: "21",
  table: sitePrices,
  cost: siteCosts,
};

describe("quote lifecycle (HTTP, real stack)", () => {
  let app: NestFastifyApplication;
  let db: Db;
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
    db = app.get<Db>(DB);
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
    expect((await post(tenant, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
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
      // Cost-of-goods is frozen in the snapshot (ADR 0059) — verify re-derives it.
      expect(quote.snapshot.costMoney?.total).toBe("79039.86");
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

    it("reproduces regardless of the caller's instance order (canonical sort, I3)", async () => {
      // Reversed caller order — without the canonical instance sort, JSONB key
      // reordering on re-derivation would flip the bom/sources/overrideIds array
      // order and false-negative the deep-equal.
      const reordered = { ...issueBody, instances: [...issueBody.instances].reverse() };
      const issued = (await post(tenant, "/v1/quotes", reordered)).json() as QuoteDetail;
      const verify = await inject(app, {
        method: "POST",
        url: `/v1/quotes/${issued.id}/verify`,
        headers: { cookie: tenant.cookie },
      });
      expect(verify.statusCode).toBe(200);
      expect(verify.json() as { reproduced: boolean; mismatches: string[] }).toEqual({
        quoteId: issued.id,
        reproduced: true,
        mismatches: [],
      });
    });
  });

  describe("org-scope isolation (ADR 0055)", () => {
    it("a different org cannot read the quote (404, no existence oracle)", async () => {
      const issued = (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteDetail;
      // A fresh user is auto-provisioned a SEPARATE org — so this is now an
      // org-boundary probe, not just a user one.
      const intruder = await signUpUser(app, "quote-intruder");
      const res = await inject(app, {
        method: "GET",
        url: `/v1/quotes/${issued.id}`,
        headers: { cookie: intruder.cookie },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("I3 durability (owner_id RESTRICT, ADR 0055)", () => {
    it("refuses to hard-delete a user who authored a quote (the frozen artifact survives)", async () => {
      // Fresh user so the destructive delete attempt can't poison the shared tenant.
      // Releases/catalog are GLOBAL (seeded above); the price table is per-org
      // (ADR 0055) so this fresh org needs its own before it can issue.
      const author = await signUpUser(app, "quote-author");
      expect((await post(author, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
      const issued = (await post(author, "/v1/quotes", issueBody)).json() as QuoteDetail;
      expect(issued.total).toBe("129891.504");

      // owner_id is ON DELETE RESTRICT: deleting the author must fail at the FK,
      // proving the I3 commercial record cannot vanish with its creator.
      await expect(db.delete(userTable).where(eq(userTable.id, author.id))).rejects.toThrow();

      // And the quote is still there.
      const [row] = await db.select().from(quoteTable).where(eq(quoteTable.id, issued.id)).limit(1);
      expect(row?.id).toBe(issued.id);
    });
  });
});
